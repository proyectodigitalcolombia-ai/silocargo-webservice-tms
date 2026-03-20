import fs from "fs";
import path from "path";
import type { Solicitud } from "./scraper";

const STATE_FILE = path.join(process.cwd(), ".silocargo-state.json");

interface StoreState {
  processedIds: string[];
  lastSolicitudes: Solicitud[];
  lastSync: string | null;
  lastSyncStatus: "success" | "error" | null;
  lastError: string | null;
  syncCount: number;
  sentCount: number;
}

const defaultState: StoreState = {
  processedIds: [],
  lastSolicitudes: [],
  lastSync: null,
  lastSyncStatus: null,
  lastError: null,
  syncCount: 0,
  sentCount: 0,
};

let state: StoreState = { ...defaultState };

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const loaded = JSON.parse(raw) as Partial<StoreState>;
      state = { ...defaultState, ...loaded };
      console.log(`[SILOCARGO Store] Estado cargado: ${state.processedIds.length} IDs procesados`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SILOCARGO Store] Error cargando estado: ${message}`);
  }
}

function saveState(): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SILOCARGO Store] Error guardando estado: ${message}`);
  }
}

loadState();

export function isProcessed(id: string): boolean {
  return state.processedIds.includes(id);
}

export function markAsProcessed(id: string): void {
  if (!state.processedIds.includes(id)) {
    state.processedIds.push(id);
    if (state.processedIds.length > 10000) {
      state.processedIds = state.processedIds.slice(-5000);
    }
    saveState();
  }
}

export function getNewSolicitudes(solicitudes: Solicitud[]): Solicitud[] {
  return solicitudes.filter((s) => s.id && !isProcessed(s.id));
}

export function updateLastSync(solicitudes: Solicitud[], status: "success" | "error", error?: string): void {
  state.lastSolicitudes = solicitudes;
  state.lastSync = new Date().toISOString();
  state.lastSyncStatus = status;
  state.lastError = error || null;
  state.syncCount++;
  saveState();
}

export function incrementSentCount(count: number): void {
  state.sentCount += count;
  saveState();
}

export function getLastSolicitudes(): Solicitud[] {
  return state.lastSolicitudes;
}

export function getStatus(): {
  lastSync: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  processedCount: number;
  lastSolicitudesCount: number;
  syncCount: number;
  sentCount: number;
  isRunning: boolean;
} {
  return {
    lastSync: state.lastSync,
    lastSyncStatus: state.lastSyncStatus,
    lastError: state.lastError,
    processedCount: state.processedIds.length,
    lastSolicitudesCount: state.lastSolicitudes.length,
    syncCount: state.syncCount,
    sentCount: state.sentCount,
    isRunning: jobRunning,
  };
}

let jobRunning = false;

export function setJobRunning(running: boolean): void {
  jobRunning = running;
}
