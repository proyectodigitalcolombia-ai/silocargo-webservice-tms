import app from "./app";
import { logger } from "./lib/logger";
import { startPolling } from "./silocargo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  logger.info({ port }, "Server listening");

  if (process.env.SILOCARGO_USER && process.env.SILOCARGO_PASSWORD && process.env.TMS_WEBHOOK_URL) {
    logger.info("Configuración SILOCARGO completa, iniciando polling automático...");
    startPolling();
  } else {
    const missing: string[] = [];
    if (!process.env.SILOCARGO_USER) missing.push("SILOCARGO_USER");
    if (!process.env.SILOCARGO_PASSWORD) missing.push("SILOCARGO_PASSWORD");
    if (!process.env.TMS_WEBHOOK_URL) missing.push("TMS_WEBHOOK_URL");
    logger.warn({ missing }, "Polling SILOCARGO desactivado — variables faltantes");
  }
});
