import app from "./app";
import { startPolling } from "./silocargo";

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`[SILOCARGO] Servidor activo en puerto ${port}`);

  if (process.env.SILOCARGO_USER && process.env.SILOCARGO_PASSWORD && process.env.TMS_WEBHOOK_URL) {
    console.log("[SILOCARGO] Configuración completa detectada, iniciando polling automático...");
    startPolling();
  } else {
    const missing: string[] = [];
    if (!process.env.SILOCARGO_USER) missing.push("SILOCARGO_USER");
    if (!process.env.SILOCARGO_PASSWORD) missing.push("SILOCARGO_PASSWORD");
    if (!process.env.TMS_WEBHOOK_URL) missing.push("TMS_WEBHOOK_URL");
    console.log(`[SILOCARGO] Polling desactivado — variables faltantes: ${missing.join(", ")}`);
    console.log("[SILOCARGO] Configure las variables de entorno y reinicie el servidor.");
  }
});
