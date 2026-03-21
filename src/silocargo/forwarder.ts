import axios from "axios";
import type { Solicitud } from "./scraper";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function getWebhookUrl(): string {
  const url = process.env.TMS_WEBHOOK_URL;
  if (!url) {
    throw new Error("TMS_WEBHOOK_URL environment variable is required");
  }
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function forwardSolicitud(solicitud: Solicitud): Promise<boolean> {
  const webhookUrl = getWebhookUrl();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const endpoint = webhookUrl;

      console.log(`[SILOCARGO Forward] Enviando solicitud ${solicitud.id} a ${endpoint} (intento ${attempt}/${MAX_RETRIES})`);

      const response = await axios.post(endpoint, {
        solicitudId: solicitud.id,
        fecha: solicitud.fecha,
        origen: solicitud.origen,
        destino: solicitud.destino,
        estado: solicitud.estado,
        producto: solicitud.producto,
        cantidad: solicitud.cantidad,
        vehiculo: solicitud.vehiculo,
        observaciones: solicitud.observaciones,
        transportadora: solicitud.transportadora,
        transportadoraCodigo: solicitud.transportadoraCodigo,
        rawData: solicitud.rawData,
        source: "silocargo",
        syncTimestamp: new Date().toISOString(),
      }, {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
        },
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log(`[SILOCARGO Forward] Solicitud ${solicitud.id} enviada exitosamente (HTTP ${response.status})`);
        return true;
      }

      console.warn(`[SILOCARGO Forward] Respuesta inesperada HTTP ${response.status} para solicitud ${solicitud.id}`);

      if (response.status >= 400 && response.status < 500) {
        console.error(`[SILOCARGO Forward] Error cliente ${response.status}, no se reintenta`);
        return false;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SILOCARGO Forward] Error en intento ${attempt}/${MAX_RETRIES}: ${message}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.log(`[SILOCARGO Forward] Reintentando en ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  console.error(`[SILOCARGO Forward] Solicitud ${solicitud.id} falló después de ${MAX_RETRIES} intentos`);
  return false;
}

export async function forwardBatch(solicitudes: Solicitud[]): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];

  for (const solicitud of solicitudes) {
    const success = await forwardSolicitud(solicitud);
    if (success) {
      sent.push(solicitud.id);
    } else {
      failed.push(solicitud.id);
    }
  }

  return { sent, failed };
}
