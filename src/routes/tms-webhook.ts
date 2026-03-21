import { Router, type IRouter, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import axios from "axios";

const router: IRouter = Router();

const STORE_FILE = path.join(process.cwd(), "data", "tms_solicitudes.json");

interface AceptacionData {
  tipoSolicitud: string;
  tipoServicio: string;
  departamentoOrigen: string;
  ciudadOrigen: string;
  departamentoDestino: string;
  ciudadDestino: string;
  fechaCargue: string;
  horaCargue: string;
  peso: string;
  unidadPeso: string;
  volumen: string;
  unidadVolumen: string;
  vehiculo: string;
  claseVehiculo: string;
  fechaCreacion: string;
  horaCreacion: string;
  horasCargueEstimado: string;
  empresa: string;
  centroCosto: string;
  tipoOperacion: string;
  solicitudBase: string;
  obsevacion: string;
  nombreTransportadora: string;
  valorFlete: string;
  estadoLicitacion: string;
  numDocumentoCliente: string;
  cliente: string;
  direccionCliente: string;
  telefonoCliente: string;
  remitente: string;
  contactoRemitente: string;
  telefonoRemitente: string;
  direccionRemitente: string;
  destinatario: string;
  contactoEntrega: string;
  direccionEntrega: string;
  telefonoEntrega: string;
  fechaEntregaEstimada: string;
  horaEntregaEstimada: string;
  proyecto: string;
  sitio: string;
  numeroPedido: string;
  nombreEmpaque: string;
  cantidad: string;
  valorMercancia: string;
  monedaValor: string;
  alto: string;
  largo: string;
  ancho: string;
  unidadMedidaMercancia: string;
  numeroUN: string;
  naturalezaCarga: string;
  descripcionMercancia: string;
  pesoMercancia: string;
  unidadPesoMercancia: string;
  volumenMercancia: string;
  unidadVolumenMercancia: string;
  documentoTransporte: string;
  tipoDocumento: string;
  numOrden: string;
  valorArancelIva: string;
  arancelMoneda: string;
  claseVehiculoMercancia: string;
  placaVehiculo: string;
  solicitudServicioBase: string;
  aceptadaEn: string;
}

interface TmsSolicitud {
  solicitudId: string;
  fecha: string;
  origen: string;
  destino: string;
  estado: string;
  producto: string;
  cantidad: string;
  vehiculo: string;
  observaciones: string;
  transportadora: string;
  transportadoraCodigo: string;
  rawData?: Record<string, string>;
  source?: string;
  syncTimestamp: string;
  receivedAt: string;
  aceptada?: boolean;
  aceptacion?: AceptacionData;
}

function loadStore(): TmsSolicitud[] {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      return JSON.parse(raw) as TmsSolicitud[];
    }
  } catch {
    /* noop */
  }
  return [];
}

function saveStore(data: TmsSolicitud[]): void {
  try {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[TMS Webhook] Error guardando store:", err);
  }
}

let solicitudesStore: TmsSolicitud[] = loadStore();

router.post("/webhook/solicitud", (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TmsSolicitud>;

    if (!body.solicitudId) {
      res.status(400).json({ success: false, error: "solicitudId es requerido" });
      return;
    }

    const nueva: TmsSolicitud = {
      solicitudId: String(body.solicitudId),
      fecha: body.fecha || "",
      origen: body.origen || "",
      destino: body.destino || "",
      estado: body.estado || "",
      producto: body.producto || "",
      cantidad: body.cantidad || "",
      vehiculo: body.vehiculo || "",
      observaciones: body.observaciones || "",
      transportadora: body.transportadora || "",
      transportadoraCodigo: body.transportadoraCodigo || "",
      rawData: body.rawData,
      source: body.source || "silocargo",
      syncTimestamp: body.syncTimestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };

    const existingIdx = solicitudesStore.findIndex((s) => s.solicitudId === nueva.solicitudId);
    if (existingIdx >= 0) {
      const existing = solicitudesStore[existingIdx];
      nueva.aceptada = existing.aceptada;
      nueva.aceptacion = existing.aceptacion;
      solicitudesStore[existingIdx] = nueva;
      console.log(`[TMS Webhook] Solicitud actualizada: ${nueva.solicitudId}`);
    } else {
      solicitudesStore.unshift(nueva);
      console.log(`[TMS Webhook] Nueva solicitud recibida: ${nueva.solicitudId}`);
    }

    saveStore(solicitudesStore);

    const externalUrl = process.env.TMS_RENDER_FORWARD_URL;
    if (externalUrl) {
      setImmediate(async () => {
        try {
          const resp = await axios.post(externalUrl, nueva, {
            timeout: 10000,
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
          });
          console.log(`[TMS Webhook] Reenvío a Render → HTTP ${resp.status} (${externalUrl})`);
        } catch (fwdErr: unknown) {
          const msg = fwdErr instanceof Error ? fwdErr.message : String(fwdErr);
          console.warn(`[TMS Webhook] Reenvío a Render falló: ${msg}`);
        }
      });
    }

    res.json({ success: true, solicitudId: nueva.solicitudId, action: existingIdx >= 0 ? "updated" : "created" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[TMS Webhook] Error procesando solicitud:", message);
    res.status(500).json({ success: false, error: message });
  }
});

router.post("/webhook/solicitud/:id/aceptar", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<AceptacionData>;

    const idx = solicitudesStore.findIndex((s) => s.solicitudId === id);
    if (idx < 0) {
      res.status(404).json({ success: false, error: "Solicitud no encontrada" });
      return;
    }

    const aceptacion: AceptacionData = {
      tipoSolicitud: body.tipoSolicitud || "",
      tipoServicio: body.tipoServicio || "",
      departamentoOrigen: body.departamentoOrigen || "",
      ciudadOrigen: body.ciudadOrigen || "",
      departamentoDestino: body.departamentoDestino || "",
      ciudadDestino: body.ciudadDestino || "",
      fechaCargue: body.fechaCargue || "",
      horaCargue: body.horaCargue || "",
      peso: body.peso || "",
      unidadPeso: body.unidadPeso || "Kg",
      volumen: body.volumen || "",
      unidadVolumen: body.unidadVolumen || "m3",
      vehiculo: body.vehiculo || "",
      claseVehiculo: body.claseVehiculo || "",
      fechaCreacion: body.fechaCreacion || "",
      horaCreacion: body.horaCreacion || "",
      horasCargueEstimado: body.horasCargueEstimado || "",
      empresa: body.empresa || "",
      centroCosto: body.centroCosto || "",
      tipoOperacion: body.tipoOperacion || "",
      solicitudBase: body.solicitudBase || "",
      obsevacion: body.obsevacion || "",
      nombreTransportadora: body.nombreTransportadora || "",
      valorFlete: body.valorFlete || "",
      estadoLicitacion: body.estadoLicitacion || "OFERTADO",
      numDocumentoCliente: body.numDocumentoCliente || "",
      cliente: body.cliente || "",
      direccionCliente: body.direccionCliente || "",
      telefonoCliente: body.telefonoCliente || "",
      remitente: body.remitente || "",
      contactoRemitente: body.contactoRemitente || "",
      telefonoRemitente: body.telefonoRemitente || "",
      direccionRemitente: body.direccionRemitente || "",
      destinatario: body.destinatario || "",
      contactoEntrega: body.contactoEntrega || "",
      direccionEntrega: body.direccionEntrega || "",
      telefonoEntrega: body.telefonoEntrega || "",
      fechaEntregaEstimada: body.fechaEntregaEstimada || "",
      horaEntregaEstimada: body.horaEntregaEstimada || "",
      proyecto: body.proyecto || "",
      sitio: body.sitio || "",
      numeroPedido: body.numeroPedido || "",
      nombreEmpaque: body.nombreEmpaque || "",
      cantidad: body.cantidad || "",
      valorMercancia: body.valorMercancia || "",
      monedaValor: body.monedaValor || "",
      alto: body.alto || "",
      largo: body.largo || "",
      ancho: body.ancho || "",
      unidadMedidaMercancia: body.unidadMedidaMercancia || "",
      numeroUN: body.numeroUN || "",
      naturalezaCarga: body.naturalezaCarga || "",
      descripcionMercancia: body.descripcionMercancia || "",
      pesoMercancia: body.pesoMercancia || "",
      unidadPesoMercancia: body.unidadPesoMercancia || "",
      volumenMercancia: body.volumenMercancia || "",
      unidadVolumenMercancia: body.unidadVolumenMercancia || "",
      documentoTransporte: body.documentoTransporte || "",
      tipoDocumento: body.tipoDocumento || "",
      numOrden: body.numOrden || "",
      valorArancelIva: body.valorArancelIva || "",
      arancelMoneda: body.arancelMoneda || "",
      claseVehiculoMercancia: body.claseVehiculoMercancia || "",
      placaVehiculo: body.placaVehiculo || "",
      solicitudServicioBase: body.solicitudServicioBase || "",
      aceptadaEn: new Date().toISOString(),
    };

    solicitudesStore[idx].aceptada = true;
    solicitudesStore[idx].aceptacion = aceptacion;
    solicitudesStore[idx].estado = "ACEPTADA";
    saveStore(solicitudesStore);

    console.log(`[TMS Webhook] Solicitud ACEPTADA: ${id}`);
    res.json({ success: true, solicitudId: id, aceptadaEn: aceptacion.aceptadaEn });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[TMS Webhook] Error aceptando solicitud:", message);
    res.status(500).json({ success: false, error: message });
  }
});

router.get("/webhook/solicitudes", (_req: Request, res: Response) => {
  res.json({
    success: true,
    count: solicitudesStore.length,
    data: solicitudesStore,
  });
});

router.delete("/webhook/solicitudes", (_req: Request, res: Response) => {
  solicitudesStore = [];
  saveStore(solicitudesStore);
  res.json({ success: true, message: "Store limpiado" });
});

router.get("/webhook/dashboard", (_req: Request, res: Response) => {
  const aceptadas = solicitudesStore.filter((s) => s.aceptada).length;
  const terminadoRe = /finaliz|entregad|cancelad/i;

  const rows = solicitudesStore
    .map((s) => {
      const dataAttr = escAttr(JSON.stringify({
        solicitudId: s.solicitudId,
        origen: s.origen,
        destino: s.destino,
        fecha: s.fecha,
        vehiculo: s.vehiculo,
        observaciones: s.observaciones,
        transportadora: s.transportadora,
        estado: s.estado,
        aceptada: s.aceptada || false,
        aceptacion: s.aceptacion || {},
      }));

      const accionBtn = s.aceptada
        ? `<span class="badge-aceptada">✓ ACEPTADA</span>`
        : `<button class="btn-aceptar" onclick='openModal(${JSON.stringify(JSON.stringify({
            solicitudId: s.solicitudId,
            origen: s.origen,
            destino: s.destino,
            fecha: s.fecha,
            vehiculo: s.vehiculo,
            observaciones: s.observaciones,
            transportadora: s.transportadora,
            estado: s.estado,
          }))})'  title="Aceptar solicitud">✔ Aceptar</button>`;

      // Una solicitud está "gestionada" si fue aceptada o su estado es terminal
      const gestionada = s.aceptada || terminadoRe.test(s.estado);

      return `
      <tr data-gestionada="${gestionada}">
        <td><strong>${escHtml(s.solicitudId)}</strong></td>
        <td>${escHtml(s.transportadora)}</td>
        <td>${escHtml(s.origen)}</td>
        <td>${escHtml(s.destino)}</td>
        <td>${escHtml(s.vehiculo)}</td>
        <td><span class="estado estado-${slugify(s.estado)}">${escHtml(s.estado)}</span></td>
        <td>${escHtml(s.fecha)}</td>
        <td style="font-size:11px;color:#888">${escHtml((s.receivedAt || "").replace("T", " ").substring(0, 19))}</td>
        <td>${accionBtn}</td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>SafeNode: Silocargo ↔ Webservice TMS</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#f0f2f5;padding:20px}
    .card{max-width:1200px;margin:auto;background:white;padding:24px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    h2{margin-bottom:4px;color:#1a1a2e}
    .subtitle{color:#666;font-size:14px;margin-bottom:20px}
    .stats{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
    .stat{background:#f0f2f5;border-radius:8px;padding:12px 20px;text-align:center}
    .stat strong{display:block;font-size:24px;color:#1a73e8}
    .stat span{font-size:12px;color:#555}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#1a2e5a;color:white;padding:10px 12px;text-align:left;white-space:nowrap}
    td{padding:8px 12px;border-bottom:1px solid #eee;vertical-align:middle}
    tr:hover td{background:#f8f9ff}
    .empty{text-align:center;padding:40px;color:#aaa;font-size:15px}
    .estado{display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase}
    .estado-finalizada{background:#e6f4ea;color:#1e7e34}
    .estado-pendiente{background:#fff3cd;color:#856404}
    .estado-cancelada{background:#fce8e6;color:#c5221f}
    .estado-asignada{background:#e8f0fe;color:#1a73e8}
    .estado-aceptada{background:#e6f4ea;color:#1e7e34;font-weight:700}
    .estado-novedad-transportadora{background:#fff0e0;color:#c05a00}
    .badge{background:#1a73e8;color:white;border-radius:12px;padding:2px 8px;font-size:12px}
    .badge-aceptada{background:#1e7e34;color:white;border-radius:4px;padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap}
    .refresh-btn{float:right;background:#1a2e5a;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}
    .refresh-btn:hover{background:#243d78}
    .btn-aceptar{background:#f5a623;color:white;border:none;padding:5px 12px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;transition:background .2s}
    .btn-aceptar:hover{background:#d4891a}

    /* MODAL */
    .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;overflow-y:auto}
    .overlay.active{display:flex;align-items:flex-start;justify-content:center;padding:20px}
    .modal{background:white;border-radius:12px;width:100%;max-width:900px;margin:auto;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    .modal-header{background:#1a2e5a;color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .modal-header h3{font-size:16px;font-weight:700}
    .modal-close{background:none;border:none;color:white;font-size:22px;cursor:pointer;line-height:1;padding:0 4px}
    .modal-close:hover{color:#ffd}
    .tabs{display:flex;border-bottom:2px solid #e8ecf0;background:#f7f9fc;overflow-x:auto}
    .tab{padding:10px 16px;cursor:pointer;font-size:12px;font-weight:600;color:#666;white-space:nowrap;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .2s}
    .tab.active{color:#1a2e5a;border-bottom-color:#1a2e5a;background:white}
    .tab:hover:not(.active){color:#1a2e5a;background:#eef2ff}
    .tab-content{display:none;padding:20px 24px}
    .tab-content.active{display:block}
    .section-title{font-size:13px;font-weight:700;color:#1a2e5a;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e8ecf0}
    .form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 16px}
    .form-grid.cols2{grid-template-columns:repeat(2,1fr)}
    .form-group{display:flex;flex-direction:column;gap:4px}
    .form-group.full{grid-column:1/-1}
    .form-group.span2{grid-column:span 2}
    label{font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px}
    input,select,textarea{width:100%;padding:7px 10px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;color:#1a1a2e;background:#f9fafb;font-family:inherit}
    input:focus,select:focus,textarea:focus{outline:none;border-color:#1a73e8;background:white}
    textarea{resize:vertical;min-height:60px}
    .modal-footer{background:#f7f9fc;padding:16px 24px;display:flex;justify-content:flex-end;gap:12px;border-top:1px solid #e8ecf0}
    .btn-cancelar{background:white;color:#666;border:1px solid #d0d5dd;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}
    .btn-cancelar:hover{background:#f0f2f5}
    .btn-confirmar{background:#1e7e34;color:white;border:none;padding:10px 28px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;letter-spacing:.5px}
    .btn-confirmar:hover{background:#165a26}
    .toast{position:fixed;bottom:24px;right:24px;background:#1e7e34;color:white;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:9999;display:none;box-shadow:0 4px 12px rgba(0,0,0,.2)}
    .toast.error{background:#c5221f}
    .filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
    .filter-bar span{font-size:13px;color:#555;font-weight:600}
    .filter-btn{padding:6px 18px;border-radius:20px;border:2px solid #1a2e5a;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;background:white;color:#1a2e5a}
    .filter-btn.active{background:#1a2e5a;color:white}
    .filter-btn:hover:not(.active){background:#eef2ff}
    .count-badge{font-size:11px;background:#f0f2f5;color:#555;border-radius:10px;padding:1px 7px;margin-left:4px}
    .filter-btn.active .count-badge{background:rgba(255,255,255,.25);color:white}
    .row-hidden{display:none}
    @media(max-width:640px){.form-grid{grid-template-columns:1fr}.form-grid.cols2{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="card">
    <button class="refresh-btn" onclick="location.reload()">↻ Actualizar</button>
    <h2>SafeNode: Silocargo ↔ Webservice TMS</h2>
    <p class="subtitle">Solicitudes recibidas desde el portal DSV · Última actualización: ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}</p>

    <div class="stats">
      <div class="stat"><strong class="badge">${solicitudesStore.length}</strong><span>Total solicitudes</span></div>
      <div class="stat"><strong style="color:#1e7e34">${aceptadas}</strong><span>Aceptadas</span></div>
      <div class="stat"><strong>${solicitudesStore.filter((s) => /finaliz/i.test(s.estado)).length}</strong><span>Finalizadas</span></div>
      <div class="stat"><strong>${solicitudesStore.filter((s) => /pendiente/i.test(s.estado)).length}</strong><span>Pendientes</span></div>
      <div class="stat"><strong id="stat-sin-gestionar">${solicitudesStore.filter((s) => !s.aceptada && !terminadoRe.test(s.estado)).length}</strong><span>Sin gestionar</span></div>
    </div>

    <div class="filter-bar">
      <span>Vista:</span>
      <button class="filter-btn active" id="btn-sin-gestionar" onclick="setFiltro('sin-gestionar')">
        Sin gestionar <span class="count-badge" id="cnt-sin-gestionar">${solicitudesStore.filter((s) => !s.aceptada && !terminadoRe.test(s.estado)).length}</span>
      </button>
      <button class="filter-btn" id="btn-todas" onclick="setFiltro('todas')">
        Todas <span class="count-badge" id="cnt-todas">${solicitudesStore.length}</span>
      </button>
    </div>

    <table>
      <thead>
        <tr>
          <th>Solicitud</th>
          <th>Transportadora</th>
          <th>Origen</th>
          <th>Destino</th>
          <th>Vehículo</th>
          <th>Estado</th>
          <th>Fecha Cargue</th>
          <th>Recibida</th>
          <th>Acción</th>
        </tr>
      </thead>
      <tbody id="tabla-body">
        ${rows || '<tr><td colspan="9" class="empty">Sin solicitudes recibidas aún. El scraper las enviará automáticamente.</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- MODAL -->
  <div class="overlay" id="overlay" onclick="handleOverlayClick(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="modal-title">Aceptar Solicitud</h3>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="switchTab('datos-servicio')">Datos Servicio</div>
        <div class="tab" onclick="switchTab('datos-licitacion')">Datos Licitación</div>
        <div class="tab" onclick="switchTab('datos-cliente')">Datos Cliente</div>
        <div class="tab" onclick="switchTab('datos-remitente')">Datos Remitente</div>
        <div class="tab" onclick="switchTab('info-entrega')">Información Entrega</div>
        <div class="tab" onclick="switchTab('mercancia')">Mercancía</div>
      </div>

      <!-- TAB: Datos Servicio -->
      <div class="tab-content active" id="tab-datos-servicio">
        <div class="section-title">— Datos servicio</div>
        <div class="form-grid">
          <div class="form-group"><label>Nº de Solicitud</label><input id="f-solicitudId" readonly style="background:#e8ecf0;color:#444"/></div>
          <div class="form-group"><label>Tipo de Solicitud</label><input id="f-tipoSolicitud"/></div>
          <div class="form-group"><label>Tipo de Servicio</label><input id="f-tipoServicio" value="NACIONAL"/></div>
          <div class="form-group"><label>Departamento Origen</label><input id="f-departamentoOrigen"/></div>
          <div class="form-group"><label>Ciudad Origen</label><input id="f-ciudadOrigen"/></div>
          <div class="form-group"><label>Departamento Destino</label><input id="f-departamentoDestino"/></div>
          <div class="form-group"><label>Ciudad Destino</label><input id="f-ciudadDestino"/></div>
          <div class="form-group"><label>Fecha de Cargue</label><input id="f-fechaCargue" type="date"/></div>
          <div class="form-group"><label>Hora de Cargue</label><input id="f-horaCargue" type="time"/></div>
          <div class="form-group"><label>Peso</label><input id="f-peso" type="number"/></div>
          <div class="form-group"><label>Unidad de Medida Peso</label><input id="f-unidadPeso" value="Kg"/></div>
          <div class="form-group"><label>Volumen</label><input id="f-volumen" type="number"/></div>
          <div class="form-group"><label>Unidad de Medida Volumen</label><input id="f-unidadVolumen" value="m3"/></div>
          <div class="form-group"><label>Vehículo</label><input id="f-vehiculo"/></div>
          <div class="form-group"><label>Clase Vehículo</label><input id="f-claseVehiculo"/></div>
          <div class="form-group"><label>Fecha de Creación</label><input id="f-fechaCreacion" type="date"/></div>
          <div class="form-group"><label>Hora de Creación</label><input id="f-horaCreacion" type="time"/></div>
          <div class="form-group"><label>Horas de Cargue (Estimado)</label><input id="f-horasCargueEstimado"/></div>
          <div class="form-group"><label>Empresa</label><input id="f-empresa"/></div>
          <div class="form-group"><label>Centro de Costo</label><input id="f-centroCosto" value="BOGOTA"/></div>
          <div class="form-group"><label>Tipo de Operación</label><input id="f-tipoOperacion"/></div>
          <div class="form-group"><label>Solicitud de Servicio Base</label><input id="f-solicitudBase"/></div>
          <div class="form-group full"><label>Obsevación</label><textarea id="f-obsevacion"></textarea></div>
        </div>
      </div>

      <!-- TAB: Datos Licitación -->
      <div class="tab-content" id="tab-datos-licitacion">
        <div class="section-title">— Datos licitación</div>
        <div class="form-grid">
          <div class="form-group span2"><label>Nombre Transportadora</label><input id="f-nombreTransportadora"/></div>
          <div class="form-group"><label>Valor Flete</label><input id="f-valorFlete" type="number"/></div>
          <div class="form-group span2"><label>Estado</label><input id="f-estadoLicitacion" value="OFERTADO"/></div>
        </div>
      </div>

      <!-- TAB: Datos Cliente -->
      <div class="tab-content" id="tab-datos-cliente">
        <div class="section-title">— Datos cliente</div>
        <div class="form-grid">
          <div class="form-group"><label>Nº Documento</label><input id="f-numDocumentoCliente"/></div>
          <div class="form-group"><label>Cliente</label><input id="f-cliente"/></div>
          <div class="form-group"><label>Teléfono</label><input id="f-telefonoCliente"/></div>
          <div class="form-group full"><label>Dirección</label><input id="f-direccionCliente"/></div>
        </div>
      </div>

      <!-- TAB: Datos Remitente -->
      <div class="tab-content" id="tab-datos-remitente">
        <div class="section-title">— Datos remitente</div>
        <div class="form-grid">
          <div class="form-group"><label>Remitente</label><input id="f-remitente"/></div>
          <div class="form-group"><label>Contacto</label><input id="f-contactoRemitente"/></div>
          <div class="form-group"><label>Teléfono</label><input id="f-telefonoRemitente"/></div>
          <div class="form-group full"><label>Dirección</label><input id="f-direccionRemitente"/></div>
        </div>
      </div>

      <!-- TAB: Información Entrega -->
      <div class="tab-content" id="tab-info-entrega">
        <div class="section-title">— Información entrega Nº 1</div>
        <div class="form-grid">
          <div class="form-group"><label>Destinatario</label><input id="f-destinatario"/></div>
          <div class="form-group"><label>Contacto</label><input id="f-contactoEntrega"/></div>
          <div class="form-group"><label>Teléfono</label><input id="f-telefonoEntrega"/></div>
          <div class="form-group full"><label>Dirección</label><input id="f-direccionEntrega"/></div>
          <div class="form-group"><label>Fecha Entrega Estimada</label><input id="f-fechaEntregaEstimada" type="date"/></div>
          <div class="form-group"><label>Hora Entrega Estimada</label><input id="f-horaEntregaEstimada" type="time"/></div>
          <div class="form-group"><label>Proyecto</label><input id="f-proyecto"/></div>
          <div class="form-group"><label>Sitio</label><input id="f-sitio"/></div>
          <div class="form-group"><label>Número de Pedido</label><input id="f-numeroPedido"/></div>
        </div>
      </div>

      <!-- TAB: Mercancía -->
      <div class="tab-content" id="tab-mercancia">
        <div class="section-title">— Mercancía Nº 1</div>
        <div class="form-grid">
          <div class="form-group"><label>Nombre Empaque</label><input id="f-nombreEmpaque"/></div>
          <div class="form-group"><label>Cantidad</label><input id="f-cantidad" type="number"/></div>
          <div class="form-group"><label>Valor</label><input id="f-valorMercancia" type="number"/></div>
          <div class="form-group"><label>Moneda Valor</label><input id="f-monedaValor"/></div>
          <div class="form-group"><label>Alto</label><input id="f-alto" type="number"/></div>
          <div class="form-group"><label>Largo</label><input id="f-largo" type="number"/></div>
          <div class="form-group"><label>Ancho</label><input id="f-ancho" type="number"/></div>
          <div class="form-group"><label>Unidad de Medida</label><input id="f-unidadMedidaMercancia"/></div>
          <div class="form-group"><label>Número UN</label><input id="f-numeroUN"/></div>
          <div class="form-group full"><label>Naturaleza de la Carga</label><input id="f-naturalezaCarga"/></div>
          <div class="form-group full"><label>Descripción</label><input id="f-descripcionMercancia"/></div>
          <div class="form-group"><label>Peso</label><input id="f-pesoMercancia" type="number"/></div>
          <div class="form-group"><label>Unidad de Medida Peso</label><input id="f-unidadPesoMercancia"/></div>
          <div class="form-group"><label>Volumen</label><input id="f-volumenMercancia" type="number"/></div>
          <div class="form-group"><label>Unidad de Medida Volumen</label><input id="f-unidadVolumenMercancia"/></div>
          <div class="form-group"><label>Documento de Transporte</label><input id="f-documentoTransporte"/></div>
          <div class="form-group"><label>Tipo Documento</label><input id="f-tipoDocumento"/></div>
          <div class="form-group"><label>Nº de Orden</label><input id="f-numOrden"/></div>
          <div class="form-group"><label>Valor Arancel IVA</label><input id="f-valorArancelIva"/></div>
          <div class="form-group"><label>Arancel Moneda</label><input id="f-arancelMoneda"/></div>
          <div class="form-group"><label>Clase Vehículo</label><input id="f-claseVehiculoMercancia"/></div>
          <div class="form-group"><label>Placa Vehículo</label><input id="f-placaVehiculo"/></div>
          <div class="form-group"><label>Solicitud Servicio Base</label><input id="f-solicitudServicioBase"/></div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancelar" onclick="closeModal()">Cancelar</button>
        <button class="btn-confirmar" onclick="aceptarSolicitud()">✔ ACEPTAR</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    var currentSolicitudId = null;
    var filtroActual = 'sin-gestionar';

    function setFiltro(filtro) {
      filtroActual = filtro;
      var rows = document.querySelectorAll('#tabla-body tr[data-gestionada]');
      rows.forEach(function(tr) {
        var gestionada = tr.getAttribute('data-gestionada') === 'true';
        if (filtro === 'sin-gestionar') {
          tr.classList.toggle('row-hidden', gestionada);
        } else {
          tr.classList.remove('row-hidden');
        }
      });
      document.getElementById('btn-sin-gestionar').classList.toggle('active', filtro === 'sin-gestionar');
      document.getElementById('btn-todas').classList.toggle('active', filtro === 'todas');
    }

    document.addEventListener('DOMContentLoaded', function() {
      setFiltro('sin-gestionar');
    });

    function openModal(jsonStr) {
      var d = JSON.parse(jsonStr);
      currentSolicitudId = d.solicitudId;
      document.getElementById('modal-title').textContent = 'Aceptar Solicitud: ' + d.solicitudId;

      // Datos servicio
      setVal('f-solicitudId', d.solicitudId);
      setVal('f-tipoSolicitud', '');
      setVal('f-tipoServicio', 'NACIONAL');
      var origen = (d.origen || '').split(' - ');
      setVal('f-ciudadOrigen', origen[0] || '');
      setVal('f-departamentoOrigen', origen[1] || '');
      var destino = (d.destino || '').split(' - ');
      setVal('f-ciudadDestino', destino[0] || '');
      setVal('f-departamentoDestino', destino[1] || '');
      setVal('f-fechaCargue', isoDate(d.fecha));
      setVal('f-horaCargue', '');
      setVal('f-peso', '');
      setVal('f-unidadPeso', 'Kg');
      setVal('f-volumen', '');
      setVal('f-unidadVolumen', 'm3');
      setVal('f-vehiculo', d.vehiculo || '');
      setVal('f-claseVehiculo', '');
      setVal('f-fechaCreacion', '');
      setVal('f-horaCreacion', '');
      setVal('f-horasCargueEstimado', '');
      setVal('f-empresa', '');
      setVal('f-centroCosto', 'BOGOTA');
      setVal('f-tipoOperacion', '');
      setVal('f-solicitudBase', '');
      setVal('f-obsevacion', d.observaciones || '');

      // Datos licitación
      setVal('f-nombreTransportadora', d.transportadora || 'TRANSPORTES SARVI LTDA');
      setVal('f-valorFlete', '');
      setVal('f-estadoLicitacion', 'OFERTADO');

      // Limpiar resto
      ['f-numDocumentoCliente','f-cliente','f-telefonoCliente','f-direccionCliente',
       'f-remitente','f-contactoRemitente','f-telefonoRemitente','f-direccionRemitente',
       'f-destinatario','f-contactoEntrega','f-telefonoEntrega','f-direccionEntrega',
       'f-fechaEntregaEstimada','f-horaEntregaEstimada','f-proyecto','f-sitio','f-numeroPedido',
       'f-nombreEmpaque','f-cantidad','f-valorMercancia','f-monedaValor',
       'f-alto','f-largo','f-ancho','f-unidadMedidaMercancia','f-numeroUN',
       'f-naturalezaCarga','f-descripcionMercancia','f-pesoMercancia','f-unidadPesoMercancia',
       'f-volumenMercancia','f-unidadVolumenMercancia','f-documentoTransporte','f-tipoDocumento',
       'f-numOrden','f-valorArancelIva','f-arancelMoneda','f-claseVehiculoMercancia',
       'f-placaVehiculo','f-solicitudServicioBase'].forEach(function(id){ setVal(id,''); });

      switchTab('datos-servicio');
      document.getElementById('overlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      document.getElementById('overlay').classList.remove('active');
      document.body.style.overflow = '';
      currentSolicitudId = null;
    }

    function handleOverlayClick(e) {
      if (e.target === document.getElementById('overlay')) closeModal();
    }

    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
      var idx = ['datos-servicio','datos-licitacion','datos-cliente','datos-remitente','info-entrega','mercancia'].indexOf(name);
      document.querySelectorAll('.tab')[idx].classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
    }

    function setVal(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val || '';
    }

    function getVal(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    function isoDate(dateStr) {
      if (!dateStr) return '';
      var m = dateStr.match(/(\\d{4}-\\d{2}-\\d{2})/);
      if (m) return m[1];
      var parts = dateStr.split('/');
      if (parts.length === 3) return parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
      return '';
    }

    function showToast(msg, isError) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast' + (isError ? ' error' : '');
      t.style.display = 'block';
      setTimeout(function(){ t.style.display = 'none'; }, 3500);
    }

    async function aceptarSolicitud() {
      if (!currentSolicitudId) return;
      var btn = document.querySelector('.btn-confirmar');
      btn.disabled = true;
      btn.textContent = 'Enviando...';

      var payload = {
        tipoSolicitud: getVal('f-tipoSolicitud'),
        tipoServicio: getVal('f-tipoServicio'),
        departamentoOrigen: getVal('f-departamentoOrigen'),
        ciudadOrigen: getVal('f-ciudadOrigen'),
        departamentoDestino: getVal('f-departamentoDestino'),
        ciudadDestino: getVal('f-ciudadDestino'),
        fechaCargue: getVal('f-fechaCargue'),
        horaCargue: getVal('f-horaCargue'),
        peso: getVal('f-peso'),
        unidadPeso: getVal('f-unidadPeso'),
        volumen: getVal('f-volumen'),
        unidadVolumen: getVal('f-unidadVolumen'),
        vehiculo: getVal('f-vehiculo'),
        claseVehiculo: getVal('f-claseVehiculo'),
        fechaCreacion: getVal('f-fechaCreacion'),
        horaCreacion: getVal('f-horaCreacion'),
        horasCargueEstimado: getVal('f-horasCargueEstimado'),
        empresa: getVal('f-empresa'),
        centroCosto: getVal('f-centroCosto'),
        tipoOperacion: getVal('f-tipoOperacion'),
        solicitudBase: getVal('f-solicitudBase'),
        obsevacion: getVal('f-obsevacion'),
        nombreTransportadora: getVal('f-nombreTransportadora'),
        valorFlete: getVal('f-valorFlete'),
        estadoLicitacion: getVal('f-estadoLicitacion'),
        numDocumentoCliente: getVal('f-numDocumentoCliente'),
        cliente: getVal('f-cliente'),
        direccionCliente: getVal('f-direccionCliente'),
        telefonoCliente: getVal('f-telefonoCliente'),
        remitente: getVal('f-remitente'),
        contactoRemitente: getVal('f-contactoRemitente'),
        telefonoRemitente: getVal('f-telefonoRemitente'),
        direccionRemitente: getVal('f-direccionRemitente'),
        destinatario: getVal('f-destinatario'),
        contactoEntrega: getVal('f-contactoEntrega'),
        direccionEntrega: getVal('f-direccionEntrega'),
        telefonoEntrega: getVal('f-telefonoEntrega'),
        fechaEntregaEstimada: getVal('f-fechaEntregaEstimada'),
        horaEntregaEstimada: getVal('f-horaEntregaEstimada'),
        proyecto: getVal('f-proyecto'),
        sitio: getVal('f-sitio'),
        numeroPedido: getVal('f-numeroPedido'),
        nombreEmpaque: getVal('f-nombreEmpaque'),
        cantidad: getVal('f-cantidad'),
        valorMercancia: getVal('f-valorMercancia'),
        monedaValor: getVal('f-monedaValor'),
        alto: getVal('f-alto'),
        largo: getVal('f-largo'),
        ancho: getVal('f-ancho'),
        unidadMedidaMercancia: getVal('f-unidadMedidaMercancia'),
        numeroUN: getVal('f-numeroUN'),
        naturalezaCarga: getVal('f-naturalezaCarga'),
        descripcionMercancia: getVal('f-descripcionMercancia'),
        pesoMercancia: getVal('f-pesoMercancia'),
        unidadPesoMercancia: getVal('f-unidadPesoMercancia'),
        volumenMercancia: getVal('f-volumenMercancia'),
        unidadVolumenMercancia: getVal('f-unidadVolumenMercancia'),
        documentoTransporte: getVal('f-documentoTransporte'),
        tipoDocumento: getVal('f-tipoDocumento'),
        numOrden: getVal('f-numOrden'),
        valorArancelIva: getVal('f-valorArancelIva'),
        arancelMoneda: getVal('f-arancelMoneda'),
        claseVehiculoMercancia: getVal('f-claseVehiculoMercancia'),
        placaVehiculo: getVal('f-placaVehiculo'),
        solicitudServicioBase: getVal('f-solicitudServicioBase'),
      };

      try {
        var resp = await fetch('/api/webhook/solicitud/' + currentSolicitudId + '/aceptar', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        var data = await resp.json();
        if (data.success) {
          showToast('✔ Solicitud ' + currentSolicitudId + ' ACEPTADA correctamente');
          closeModal();
          setTimeout(function(){ location.reload(); }, 1200);
        } else {
          showToast('Error: ' + (data.error || 'Desconocido'), true);
          btn.disabled = false;
          btn.textContent = '✔ ACEPTAR';
        }
      } catch(e) {
        showToast('Error de conexión: ' + e.message, true);
        btn.disabled = false;
        btn.textContent = '✔ ACEPTAR';
      }
    }

    setTimeout(function(){ location.reload(); }, 60000);
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

function escHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default router;
