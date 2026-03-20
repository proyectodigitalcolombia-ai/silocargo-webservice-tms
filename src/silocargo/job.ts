import { SilocargoScraper } from "./scraper";
import { getNewSolicitudes, markAsProcessed, updateLastSync, incrementSentCount, setJobRunning } from "./store";
import { forwardBatch } from "./forwarder";

const POLLING_INTERVAL_MS = 3 * 60 * 1000;
const SCRAPE_RETRY_ATTEMPTS = 2;
const SCRAPE_RETRY_DELAY_MS = 5000;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSyncCycle(): Promise<{
  total: number;
  newCount: number;
  sent: string[];
  failed: string[];
  error?: string;
}> {
  if (isSyncing) {
    console.log("[SILOCARGO Job] Sincronización ya en curso, ignorando...");
    return { total: 0, newCount: 0, sent: [], failed: [], error: "Sync already in progress" };
  }

  isSyncing = true;
  console.log("[SILOCARGO Job] === Iniciando ciclo de sincronización ===");

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= SCRAPE_RETRY_ATTEMPTS; attempt++) {
    try {
      const scraper = new SilocargoScraper();
      const allSolicitudes = await scraper.fetchSolicitudes();

      console.log(`[SILOCARGO Job] Total solicitudes encontradas: ${allSolicitudes.length}`);

      const newSolicitudes = getNewSolicitudes(allSolicitudes);
      console.log(`[SILOCARGO Job] Solicitudes nuevas: ${newSolicitudes.length}`);

      if (newSolicitudes.length === 0) {
        updateLastSync(allSolicitudes, "success");
        console.log("[SILOCARGO Job] No hay solicitudes nuevas para enviar");
        isSyncing = false;
        return { total: allSolicitudes.length, newCount: 0, sent: [], failed: [] };
      }

      const { sent, failed } = await forwardBatch(newSolicitudes);

      for (const id of sent) {
        markAsProcessed(id);
      }

      if (sent.length > 0) {
        incrementSentCount(sent.length);
      }

      updateLastSync(allSolicitudes, failed.length > 0 ? "error" : "success",
        failed.length > 0 ? `${failed.length} solicitudes fallaron: ${failed.join(", ")}` : undefined);

      console.log(`[SILOCARGO Job] Ciclo completado: ${sent.length} enviadas, ${failed.length} fallidas`);
      isSyncing = false;
      return { total: allSolicitudes.length, newCount: newSolicitudes.length, sent, failed };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      console.error(`[SILOCARGO Job] Error en scraping intento ${attempt}/${SCRAPE_RETRY_ATTEMPTS}: ${message}`);

      if (attempt < SCRAPE_RETRY_ATTEMPTS) {
        const delay = SCRAPE_RETRY_DELAY_MS * attempt;
        console.log(`[SILOCARGO Job] Reintentando scraping en ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  console.error(`[SILOCARGO Job] Ciclo falló después de ${SCRAPE_RETRY_ATTEMPTS} intentos`);
  updateLastSync([], "error", lastError);
  isSyncing = false;
  return { total: 0, newCount: 0, sent: [], failed: [], error: lastError };
}

export function startPolling(): void {
  if (pollingTimer) {
    console.log("[SILOCARGO Job] Polling ya está activo");
    return;
  }

  console.log(`[SILOCARGO Job] Iniciando polling cada ${POLLING_INTERVAL_MS / 1000} segundos`);
  setJobRunning(true);

  runSyncCycle().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SILOCARGO Job] Error en primer ciclo: ${message}`);
  });

  pollingTimer = setInterval(() => {
    runSyncCycle().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SILOCARGO Job] Error en ciclo de polling: ${message}`);
    });
  }, POLLING_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    setJobRunning(false);
    console.log("[SILOCARGO Job] Polling detenido");
  }
}

export function isPollingActive(): boolean {
  return pollingTimer !== null;
}
