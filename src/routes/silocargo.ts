import { Router, type IRouter } from "express";
import { getLastSolicitudes, getStatus, runSyncCycle } from "../silocargo";

const router: IRouter = Router();

router.get("/silocargo/solicitudes", (_req, res) => {
  try {
    const solicitudes = getLastSolicitudes();
    res.json({
      success: true,
      count: solicitudes.length,
      data: solicitudes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

router.post("/silocargo/sync", async (_req, res) => {
  try {
    console.log("[SILOCARGO API] Sincronización manual solicitada");
    const result = await runSyncCycle();
    res.json({
      success: !result.error,
      message: result.error ? `Error: ${result.error}` : "Sincronización completada",
      total: result.total,
      newCount: result.newCount,
      sent: result.sent,
      failed: result.failed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

router.get("/silocargo/status", (_req, res) => {
  try {
    const status = getStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
