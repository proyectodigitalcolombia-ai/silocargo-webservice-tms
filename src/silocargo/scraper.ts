import axios, { type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";

export interface Solicitud {
  id: string;
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
  rawData: Record<string, string>;
}

const BASE_URL = process.env.SILOCARGO_URL || "https://dsv.colombiasoftware.net";
const LOGIN_URL = `${BASE_URL}/index.php?page=LoginPage`;
const MODULE_URLS = [
  `${BASE_URL}/index.php?page=Despacho.Transportadora.ConfirmarSolicitudDsv`,
  `${BASE_URL}/index.php?page=Despacho.Transportadora.ConfirmarSolicitudDapsa`,
  `${BASE_URL}/index.php?page=Despacho.Transportadora.HomeDSV`,
  `${BASE_URL}/index.php?page=ConfirmarSolicitudDsv`,
  `${BASE_URL}/index.php?page=Solicitud.ConfirmarSolicitudDsv`,
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SilocargoScraper {
  private user: string;
  private password: string;
  private http: AxiosInstance;
  private cookies: string[] = [];

  constructor() {
    this.user = process.env.SILOCARGO_USER || "";
    this.password = process.env.SILOCARGO_PASSWORD || "";

    if (!this.user || !this.password) {
      throw new Error("SILOCARGO_USER and SILOCARGO_PASSWORD environment variables are required");
    }

    this.http = axios.create({
      baseURL: BASE_URL,
      maxRedirects: 5,
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
      validateStatus: (status) => status < 400,
    });

    // Interceptor para manejar cookies manualmente
    this.http.interceptors.response.use((response) => {
      const setCookie = response.headers["set-cookie"];
      if (setCookie) {
        for (const cookie of setCookie) {
          const cookiePart = cookie.split(";")[0];
          const [name] = cookiePart.split("=");
          // Reemplazar cookie si ya existe, si no agregar
          const idx = this.cookies.findIndex((c) => c.startsWith(`${name}=`));
          if (idx >= 0) {
            this.cookies[idx] = cookiePart;
          } else {
            this.cookies.push(cookiePart);
          }
        }
      }
      return response;
    });

    this.http.interceptors.request.use((config) => {
      if (this.cookies.length > 0) {
        config.headers["Cookie"] = this.cookies.join("; ");
      }
      return config;
    });
  }

  /**
   * Extrae todos los campos de un formulario (inputs hidden, text, select, submit)
   * ignorando campos disabled. Si el PRADO_PAGESTATE está en el documento pero fuera
   * del formulario seleccionado, también lo incluye.
   */
  private extractFormData(html: string): { formData: Record<string, string>; formAction: string; pageState: string } {
    const $ = cheerio.load(html);
    const formData: Record<string, string> = {};

    // Recoger todos los inputs del documento (formularios anidados no válidos en HTML
    // son tratados por los parsers como parte del mismo formulario)
    $("input, select, textarea").each((_i, el) => {
      const name = $(el).attr("name");
      const disabled = $(el).attr("disabled");
      if (!name || disabled) return;
      const tagName = (el as any).tagName?.toLowerCase();
      if (tagName === "select") {
        const selected = $(el).find("option[selected]").attr("value") || $(el).find("option").first().attr("value") || "";
        formData[name] = selected;
      } else {
        formData[name] = $(el).attr("value") || "";
      }
    });

    // Acción del primer <form> encontrado
    const formAction = $("form").first().attr("action") || LOGIN_URL;
    const pageState = formData["PRADO_PAGESTATE"] || "";
    return { formData, formAction, pageState };
  }

  async login(): Promise<boolean> {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`[SILOCARGO] Intento de login ${attempt}/${MAX_ATTEMPTS}...`);

        // ── PASO A: GET página de login ──────────────────────────────────────
        console.log(`[SILOCARGO] Obteniendo página de login: ${LOGIN_URL}`);
        const getResp = await this.http.get(LOGIN_URL);
        const html = typeof getResp.data === "string" ? getResp.data : JSON.stringify(getResp.data);
        console.log(`[SILOCARGO] Página de login obtenida: ${html.length} chars, cookies: ${this.cookies.join("; ").substring(0, 100)}`);

        // ── PASO B: Extraer formulario de credenciales ────────────────────────
        const { formData, formAction } = this.extractFormData(html);

        const userFieldName = Object.keys(formData).find((k) =>
          k.toLowerCase().includes("usuario") || k.toLowerCase().includes("user") || k.toLowerCase().includes("login") || k.toLowerCase().includes("email")
        );
        const passFieldName = Object.keys(formData).find((k) =>
          k.toLowerCase().includes("clave") || k.toLowerCase().includes("password") || k.toLowerCase().includes("pass") || k.toLowerCase().includes("pwd")
        );

        if (!userFieldName || !passFieldName) {
          console.warn(`[SILOCARGO] No se encontraron campos de login. Campos: ${Object.keys(formData).join(", ")}`);
          this.cookies = [];
          if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
          continue;
        }

        formData[userFieldName] = this.user;
        formData[passFieldName] = this.password;

        // PRADO: postback target → nombre del botón submit (SIEMPRE requerido para que PRADO ejecute el handler)
        const btnStep1 = Object.keys(formData).find((k) => k.toLowerCase().includes("btningresar") || k.toLowerCase().includes("btnlogin") || k.toLowerCase().includes("btnentrar"));
        if (btnStep1) {
          formData["PRADO_POSTBACK_TARGET"] = btnStep1;
          formData["PRADO_POSTBACK_PARAMETER"] = "";
          // Añadir el valor del botón submit
          formData[btnStep1] = formData[btnStep1] || "Ingresar";
        }
        // IDLockHidden anti-bot: simular clic real
        const lockStep1 = Object.keys(formData).find((k) => k.toLowerCase().includes("idlockhidden") && (btnStep1 ? k.toLowerCase().includes(btnStep1.toLowerCase().split("$").pop()?.toLowerCase() || "") : true));
        if (lockStep1) formData[lockStep1] = "true";

        console.log(`[SILOCARGO] Paso B — enviando credenciales (user=${userFieldName})`);
        const postTarget = formAction.startsWith("http") ? formAction : `${BASE_URL}/${formAction.replace(/^\//, "")}`;
        const { html: step1Html, responseUrl: step1Url, status: step1Status } = await this.postForm(postTarget, formData, LOGIN_URL);
        console.log(`[SILOCARGO] Respuesta paso B: ${step1Html.length} chars, status=${step1Status}, url=${step1Url}`);

        // ── PASO C: Detectar si hay selector de Centro de Costo ───────────────
        const hasCostCenter = step1Html.includes("centrocosto") || step1Html.includes("BtnContinuar") || step1Html.includes("CentroCostoPanel");
        const isLoggedIn = this.detectLoginSuccess(step1Html, step1Url);

        if (isLoggedIn) {
          console.log(`[SILOCARGO] Login exitoso en paso B (sin selector de centro de costo)`);
          return true;
        }

        if (!hasCostCenter) {
          // Verificar error de credenciales
          const loginError = step1Html.toLowerCase().includes("contraseña incorrecta") ||
            step1Html.toLowerCase().includes("usuario no encontrado") ||
            step1Html.toLowerCase().includes("credenciales") ||
            step1Html.toLowerCase().includes("acceso denegado");
          if (loginError) {
            console.error(`[SILOCARGO] Credenciales incorrectas — verificar SILOCARGO_USER y SILOCARGO_PASSWORD`);
            return false;
          }
          console.warn(`[SILOCARGO] Respuesta inesperada en paso B (no hay Centro de Costo ni login exitoso)`);
          this.cookies = [];
          if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
          continue;
        }

        // ── PASO C: Extraer y enviar formulario de Centro de Costo ───────────
        console.log(`[SILOCARGO] Paso C — seleccionando Centro de Costo y continuando...`);
        const $step1 = cheerio.load(step1Html);
        const { formData: step2Data, formAction: step2Action } = this.extractFormData(step1Html);

        // Configurar botón BtnContinuar
        const btnStep2 = Object.keys(step2Data).find((k) => k.toLowerCase().includes("btncontinuar"));
        // PRADO necesita POSTBACK_TARGET y POSTBACK_PARAMETER explícitamente
        if (btnStep2) {
          step2Data["PRADO_POSTBACK_TARGET"] = btnStep2;
          step2Data["PRADO_POSTBACK_PARAMETER"] = "";
        }
        const lockStep2 = Object.keys(step2Data).find((k) => k.toLowerCase().includes("idlockhidden") && k.toLowerCase().includes("continuar"));
        if (lockStep2) step2Data[lockStep2] = "true";
        if (btnStep2) step2Data[btnStep2] = "Continuar";
        console.log(`[SILOCARGO] Paso C — campos: ${Object.keys(step2Data).join(", ")}`);

        // Seleccionar Centro de Costo por nombre (SILOCARGO_CENTRO_COSTO) o usar el primero
        const ccField = Object.keys(step2Data).find((k) => k.toLowerCase().includes("centrocosto"));
        if (ccField) {
          // Enumerar todas las opciones disponibles
          const $ccSelect = $step1(`select[name="${ccField}"]`);
          const allOptions: { value: string; label: string }[] = [];
          $ccSelect.find("option").each((_i, opt) => {
            allOptions.push({ value: $step1(opt).attr("value") || "", label: $step1(opt).text().trim() });
          });
          console.log(`[SILOCARGO] Centros de Costo disponibles: ${allOptions.map((o) => `${o.value}="${o.label}"`).join(" | ")}`);

          const targetCC = process.env.SILOCARGO_CENTRO_COSTO || "";
          if (targetCC) {
            const match = allOptions.find(
              (o) => o.label.toLowerCase().includes(targetCC.toLowerCase()) || o.value === targetCC
            );
            if (match) {
              step2Data[ccField] = match.value;
              console.log(`[SILOCARGO] Centro de costo seleccionado por env: ${match.value} = "${match.label}"`);
            } else {
              console.warn(`[SILOCARGO] No se encontró Centro de Costo "${targetCC}", usando el primero disponible: ${step2Data[ccField]}`);
            }
          } else {
            console.log(`[SILOCARGO] Centro de costo seleccionado (primero/default): ${step2Data[ccField]} — configure SILOCARGO_CENTRO_COSTO para cambiar`);
          }
        }

        const step2Target = step2Action.startsWith("http") ? step2Action : `${BASE_URL}/${step2Action.replace(/^\//, "")}`;
        const { html: step2Html, responseUrl: step2Url, status: step2Status, redirectLocation } = await this.postForm(
          step2Target, step2Data, step1Url, { debug: true, maxRedirects: 0 }
        );
        console.log(`[SILOCARGO] Respuesta paso C: status=${step2Status}, html=${step2Html.length} chars, redirect="${redirectLocation ?? "none"}", url=${step2Url}`);

        // Un 302 desde el paso C indica login exitoso: PRADO redirige al app principal
        if (step2Status === 302 || step2Status === 301 || this.detectLoginSuccess(step2Html, step2Url)) {
          console.log(`[SILOCARGO] Login exitoso en paso C (status=${step2Status}, Centro de Costo seleccionado)`);
          console.log(`[SILOCARGO] Cookies activas: ${this.cookies.join("; ")}`);
          // Seguir la redirección manualmente si hay un Location
          const resolvedRedirect = redirectLocation && redirectLocation.trim()
            ? (redirectLocation.startsWith("http") ? redirectLocation : `${BASE_URL}/${redirectLocation.replace(/^\//, "")}`)
            : null;
          if (resolvedRedirect) {
            console.log(`[SILOCARGO] Siguiendo redirección a: ${resolvedRedirect}`);
            try {
              await this.http.get(resolvedRedirect);
            } catch (_e) { /* ignorar */ }
          }
          // Intentar acceder a la página principal del portal para confirmar la sesión y listar links
          try {
            const mainResp = await this.http.get(`${BASE_URL}/index.php`, { maxRedirects: 5 });
            const mainHtml = typeof mainResp.data === "string" ? mainResp.data : "";
            const mainUrl: string = mainResp.request?.res?.responseUrl || "";
            console.log(`[SILOCARGO] Verificación sesión → url=${mainUrl}, html=${mainHtml.length}`);
            // Guardar HTML para inspección
            fs.writeFileSync("/tmp/silocargo_dashboard.html", mainHtml, "utf8");
            // Buscar patrones "page=" en todo el HTML (incluso JS)
            const pageMatches = [...mainHtml.matchAll(/page=([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
            const uniquePages = [...new Set(pageMatches)].slice(0, 60);
            console.log(`[SILOCARGO] Páginas en dashboard (${uniquePages.length}): ${uniquePages.join(" | ")}`);
            // Buscar "solicitud" (case-insensitive)
            const solRefs = [...mainHtml.matchAll(/[A-Za-z0-9_.]*[Ss]olicitud[A-Za-z0-9_.]*/g)].map((m) => m[0]);
            const uniqueSol = [...new Set(solRefs)].slice(0, 20);
            console.log(`[SILOCARGO] Referencias a Solicitud: ${uniqueSol.join(" | ")}`);
          } catch (_e) { console.error("[SILOCARGO] Error inspeccionando dashboard:", _e); }
          return true;
        }

        console.warn(`[SILOCARGO] Login no verificado después del paso C en intento ${attempt}`);
        this.cookies = [];
        if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SILOCARGO] Error en login intento ${attempt}: ${message}`);
        this.cookies = [];
        if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
      }
    }

    console.error("[SILOCARGO] Login fallido después de todos los intentos");
    return false;
  }

  private async postForm(
    url: string,
    formData: Record<string, string>,
    referer: string,
    options: { debug?: boolean; maxRedirects?: number } = {}
  ): Promise<{ html: string; responseUrl: string; status: number; redirectLocation?: string }> {
    const body = new URLSearchParams(formData).toString();
    const maxRedirects = options.maxRedirects ?? 10;
    const resp = await this.http.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": referer,
        "Origin": BASE_URL,
      },
      maxRedirects,
      validateStatus: (s) => s < 500,
    });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    const responseUrl: string = resp.request?.res?.responseUrl || resp.config?.url || url;
    const redirectLocation: string | undefined = resp.headers["location"] as string | undefined;
    if (options.debug) {
      console.log(`[SILOCARGO DEBUG] status=${resp.status}, location="${redirectLocation ?? "none"}", html_len=${html.length}`);
    }
    return { html, responseUrl, status: resp.status, redirectLocation };
  }

  private detectLoginSuccess(html: string, responseUrl: string): boolean {
    const lower = html.toLowerCase();
    const urlNotLogin = !responseUrl.toLowerCase().includes("loginpage");
    const bigPage = html.length > 15000;
    const hasLogout = lower.includes("cerrar sesión") || lower.includes("cerrar sesion");
    const $ = cheerio.load(html);
    const title = $("title").text().toLowerCase();
    const titleNotLogin = title.length > 0 && !title.includes("login");
    return urlNotLogin || bigPage || hasLogout || titleNotLogin;
  }

  async fetchSolicitudes(): Promise<Solicitud[]> {
    const loginOk = await this.login();
    if (!loginOk) {
      throw new Error("No se pudo hacer login en SILOCARGO");
    }

    // Navegar a Buscar_107 (el módulo de solicitudes accesible para esta cuenta)
    const buscarUrls = [
      `${BASE_URL}/index.php?page=Despacho.Transportadora.HomeDSV`,
      `${BASE_URL}/index.php?page=Despacho.Transportadora.Buscar_107`,
      `${BASE_URL}/index.php?page=Despacho.Transportadora.Home`,
      `${BASE_URL}/index.php`,
    ];

    let buscarHtml = "";
    let buscarUrl = "";
    for (const url of buscarUrls) {
      try {
        const resp = await this.http.get(url, { maxRedirects: 5 });
        const html = typeof resp.data === "string" ? resp.data : "";
        const finalUrl: string = resp.request?.res?.responseUrl || url;
        console.log(`[SILOCARGO] Módulo cargado: ${html.length} chars, url=${finalUrl}`);
        if (!finalUrl.toLowerCase().includes("login") && html.length > 10000) {
          buscarHtml = html;
          buscarUrl = finalUrl;
          break;
        }
      } catch (_e) { /* continuar */ }
    }

    if (!buscarHtml) {
      throw new Error("No se pudo acceder al módulo de búsqueda de solicitudes");
    }

    fs.writeFileSync("/tmp/silocargo_buscar.html", buscarHtml, "utf8");

    // Extraer todos los campos del formulario de búsqueda
    const $buscar = cheerio.load(buscarHtml);
    const formData: Record<string, string> = {};
    $buscar("#ctl0_MainModule_ctl0 input, #ctl0_MainModule_ctl0 select, #ctl0_MainModule_ctl0 textarea").each((_, el) => {
      const name = $buscar(el).attr("name");
      const value = $buscar(el).attr("value") || "";
      const type = $buscar(el).attr("type") || "text";
      if (name && type !== "submit" && type !== "image") {
        formData[name] = value;
      }
    });
    // Incluir también el PRADO_PAGESTATE fuera del form si está
    if (!formData["PRADO_PAGESTATE"]) {
      const ps = $buscar('input[name="PRADO_PAGESTATE"]').attr("value") || "";
      if (ps) formData["PRADO_PAGESTATE"] = ps;
    }

    // Configurar la búsqueda: sin filtros de fecha (todos los registros)
    // Limpiar campos de fecha para traer todos
    delete formData["ctl0$MainModule$fechacreacion_desde"];
    delete formData["ctl0$MainModule$fechacreacion_hasta"];
    delete formData["ctl0$MainModule$fechacargue_desde"];
    delete formData["ctl0$MainModule$fechacargue_hasta"];
    delete formData["ctl0$MainModule$fechaentrega_desde"];
    delete formData["ctl0$MainModule$fechaentrega_hasta"];
    delete formData["ctl0$MainModule$horacargue_desde"];
    delete formData["ctl0$MainModule$horacargue_hasta"];
    delete formData["ctl0$MainModule$horaentrega_desde"];
    delete formData["ctl0$MainModule$horaentrega_hasta"];

    // Botón buscar (simular clic)
    formData["ctl0$MainModule$btnBuscar"] = "Buscar";
    formData["ctl0$MainModule$IDLockHidden_ctl0_MainModule_btnBuscar"] = "true";

    // PRADO_POSTBACK_TARGET
    formData["PRADO_POSTBACK_TARGET"] = "ctl0$MainModule$btnBuscar";
    formData["PRADO_POSTBACK_PARAMETER"] = "";

    const formAction = $buscar("#ctl0_MainModule_ctl0").attr("action") || `/index.php?page=Despacho.Transportadora.Buscar_107`;
    const postUrl = formAction.startsWith("http") ? formAction : `${BASE_URL}${formAction.startsWith("/") ? "" : "/"}${formAction}`;

    console.log(`[SILOCARGO] Enviando búsqueda a ${postUrl} (sin filtro de fecha)`);
    const { html: resultHtml, responseUrl: resultUrl } = await this.postForm(postUrl, formData, buscarUrl);
    console.log(`[SILOCARGO] Resultado página 1: ${resultHtml.length} chars, url=${resultUrl}`);
    fs.writeFileSync("/tmp/silocargo_results.html", resultHtml, "utf8");

    if (resultUrl.toLowerCase().includes("login")) {
      throw new Error("Sesión expirada durante la búsqueda de solicitudes");
    }

    const allSolicitudes: Solicitud[] = this.extractSolicitudesFromHtml(resultHtml);
    const allIds = new Set(allSolicitudes.map((s) => s.id));
    console.log(`[SILOCARGO] Página 1: ${allSolicitudes.length} solicitudes`);

    // ── Paginación PRADO (ventanas deslizantes) ───────────────────────────────
    // El portal muestra hasta 10 páginas a la vez con un botón ">" para el
    // siguiente grupo. Se navega cada enlace numérico y, al llegar al ">",
    // se avanza al siguiente grupo y se repite, hasta MAX_PAGES en total.
    const MAX_PAGES = parseInt(process.env.SILOCARGO_MAX_PAGES || "30", 10);

    let currentHtml = resultHtml;
    let pagesNavigated = 1; // ya contamos la página 1
    const visitedPostbacks = new Set<string>();

    while (pagesNavigated < MAX_PAGES) {
      const windowLinks = this.extractPageLinks(currentHtml);
      if (windowLinks.length === 0) break;

      // Primer link no visitado: preferir numérico, luego ">"
      const nextLink = windowLinks.find((l) => !visitedPostbacks.has(l.postbackId));
      if (!nextLink) break;

      visitedPostbacks.add(nextLink.postbackId);

      try {
        // Construir form data desde el HTML actual (PRADO_PAGESTATE cambia en cada página)
        const $current = cheerio.load(currentHtml);
        const pageFormData: Record<string, string> = {};
        $current("input, select, textarea").each((_, el) => {
          const name = $current(el).attr("name");
          const disabled = $current(el).attr("disabled");
          if (!name || disabled) return;
          const tagName = (el as any).tagName?.toLowerCase();
          if (tagName === "select") {
            pageFormData[name] = $current(el).find("option[selected]").attr("value") || $current(el).find("option").first().attr("value") || "";
          } else {
            pageFormData[name] = $current(el).attr("value") || "";
          }
        });

        pageFormData["PRADO_POSTBACK_TARGET"] = nextLink.postbackId;
        pageFormData["PRADO_POSTBACK_PARAMETER"] = "";

        console.log(`[SILOCARGO] Navegando a página ${nextLink.pageNum} (postback: ${nextLink.postbackId})...`);
        const { html: pageHtml, responseUrl: pageUrl } = await this.postForm(postUrl, pageFormData, resultUrl);

        if (pageUrl.toLowerCase().includes("login")) {
          console.warn(`[SILOCARGO] Sesión expirada en página ${nextLink.pageNum}, deteniendo paginación`);
          break;
        }

        const pageSolicitudes = this.extractSolicitudesFromHtml(pageHtml);
        let newInPage = 0;
        for (const s of pageSolicitudes) {
          if (!allIds.has(s.id)) {
            allSolicitudes.push(s);
            allIds.add(s.id);
            newInPage++;
          }
        }
        console.log(`[SILOCARGO] Página ${nextLink.pageNum}: ${pageSolicitudes.length} rows, ${newInPage} nuevas únicas (total: ${allSolicitudes.length})`);

        currentHtml = pageHtml;
        pagesNavigated++;
        await sleep(400);
      } catch (pageErr: unknown) {
        const msg = pageErr instanceof Error ? pageErr.message : String(pageErr);
        console.warn(`[SILOCARGO] Error navegando página ${nextLink.pageNum}: ${msg}`);
        break;
      }
    }

    console.log(`[SILOCARGO] Total solicitudes extraídas (${pagesNavigated} páginas): ${allSolicitudes.length}`);
    return allSolicitudes;
  }

  /**
   * Extrae los links de páginas del paginador PRADO.
   * Incluye tanto links numéricos como ">" (siguiente grupo de páginas).
   * Excluye "<" (página anterior) para avanzar siempre hacia adelante.
   */
  private extractPageLinks(html: string): Array<{ pageNum: string; postbackId: string }> {
    const $ = cheerio.load(html);
    const links: Array<{ pageNum: string; postbackId: string }> = [];

    $("a[id*='Resultados_ctl0_ctl']").each((_i, el) => {
      const id = $(el).attr("id") || "";
      const text = $(el).text().trim();
      // Solo páginas numéricas o ">" (siguiente grupo). Excluir "<" (anterior).
      if (/^\d+$/.test(text) || text === ">") {
        const postbackId = id.replace(/_/g, "$");
        links.push({ pageNum: text, postbackId });
      }
    });

    return links;
  }

  private extractSolicitudesFromHtml(html: string): Solicitud[] {
    const $ = cheerio.load(html);
    const solicitudes: Solicitud[] = [];

    // Verificar mensaje del servidor
    const mensaje = $("#ctl0_MainModule_mensaje").text().trim();
    console.log(`[SILOCARGO] Mensaje servidor: "${mensaje || "(vacío)"}"`);
    if (mensaje && /no se encontr/i.test(mensaje)) {
      console.log("[SILOCARGO] Servidor reporta: sin registros");
      return [];
    }

    // Extraer nombre de la transportadora del formulario de búsqueda
    const transportadoraNombre = $("#ctl0_MainModule_transportadora_nombre").text().trim() ||
      process.env.SILOCARGO_TRANSPORTADORA || "";
    if (transportadoraNombre) {
      console.log(`[SILOCARGO] Transportadora: ${transportadoraNombre}`);
    }

    // La tabla de resultados tiene ID fijo: ctl0_MainModule_Resultados
    let $table = $("#ctl0_MainModule_Resultados");
    if (!$table.length) {
      // Fallback: buscar la tabla con más columnas th (no el formulario tabForm)
      let maxTh = 0;
      $("table").each((_i, tbl) => {
        const thCount = $(tbl).find("th").length;
        if (thCount > maxTh) { maxTh = thCount; $table = $(tbl); }
      });
      if (!$table.length) {
        console.warn("[SILOCARGO] No se encontró tabla de resultados");
        return [];
      }
    }

    // Extraer encabezados desde <thead>
    const headers: string[] = [];
    $table.find("thead th").each((_i, th) => {
      headers.push($(th).text().replace(/\s+/g, " ").trim().toLowerCase());
    });

    // Índice del campo origen_destino
    const origenDestinoIdx = headers.findIndex((h) => /origen.*destino|destino.*origen/i.test(h));
    const estadoIdx = headers.findIndex((h) => /estado/i.test(h));
    const clienteIdx = headers.findIndex((h) => /cliente/i.test(h));
    const sitioIdx = headers.findIndex((h) => /sitio/i.test(h));
    const fechaCargueIdx = headers.findIndex((h) => /cargue/i.test(h));
    const fechaEntregaIdx = headers.findIndex((h) => /entrega/i.test(h));
    const fechaCreacionIdx = headers.findIndex((h) => /creaci/i.test(h));

    console.log(`[SILOCARGO] Encabezados (${headers.length}): ${headers.join(" | ")}`);

    // Extraer filas del <tbody>
    let rowCount = 0;
    $table.find("tbody tr").each((_rowIdx, row) => {
      const $tds = $(row).find("td");
      if ($tds.length < 2) return;

      // Extraer ID y transportadora_codigo desde el link <a href='?...&solser_codigo=XXXX&transportadora_codigo=YYYY'>
      const $firstTd = $tds.eq(0);
      const $link = $firstTd.find("a[href]");
      let solicitudId = "";
      let transportadoraCodigo = "";
      if ($link.length) {
        const href = $link.attr("href") || "";
        const solMatch = href.match(/solser_codigo=([^&]+)/);
        const tpMatch = href.match(/transportadora_codigo=([^&]+)/);
        solicitudId = solMatch ? solMatch[1] : $link.text().trim();
        transportadoraCodigo = tpMatch ? tpMatch[1] : "";
      }
      if (!solicitudId) {
        solicitudId = $firstTd.text().replace(/\s+/g, " ").trim();
      }
      if (!solicitudId) return; // sin ID, omitir

      // Extraer texto de cada celda (normalizar espacios)
      const cells: string[] = [];
      $tds.each((_i, td) => {
        cells.push($(td).text().replace(/\s+/g, " ").trim());
      });

      // Dividir campo origen / destino (separados por dos saltos <br/><br/>)
      let origen = "";
      let destino = "";
      if (origenDestinoIdx >= 0) {
        const $td = $tds.eq(origenDestinoIdx);
        // Reemplazar <br> por "|" para luego split
        const innerHtml = $td.html() || "";
        const parts = innerHtml.replace(/<br\s*\/?>/gi, "|").split("|").map((s) => s.trim()).filter(Boolean);
        origen = parts[0] || "";
        destino = parts[1] || "";
      }

      const rawData: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (idx < cells.length) rawData[h] = cells[idx];
      });
      rawData["_link_solser_codigo"] = solicitudId;

      const solicitud: Solicitud = {
        id: solicitudId,
        fecha: cells[fechaCreacionIdx] || cells[fechaCargueIdx] || "",
        origen,
        destino,
        estado: estadoIdx >= 0 ? cells[estadoIdx] || "" : "",
        producto: sitioIdx >= 0 ? cells[sitioIdx] || "" : "",
        cantidad: "",
        vehiculo: clienteIdx >= 0 ? cells[clienteIdx] || "" : "",
        observaciones: "",
        transportadora: transportadoraNombre,
        transportadoraCodigo,
        rawData,
      };

      solicitudes.push(solicitud);
      rowCount++;
    });

    console.log(`[SILOCARGO] Tabla de resultados: ${headers.length} cols, ${rowCount} filas`);
    return solicitudes;
  }

  private findField(
    rawData: Record<string, string>,
    headers: string[],
    cells: string[],
    possibleNames: string[],
    fallbackIndex: number,
  ): string {
    for (const name of possibleNames) {
      if (rawData[name]) return rawData[name];
      const headerIdx = headers.findIndex((h) => h.includes(name));
      if (headerIdx >= 0 && headerIdx < cells.length) return cells[headerIdx];
    }
    return cells[fallbackIndex] || "";
  }

  // Método vacío para compatibilidad — ya no usamos Puppeteer
  async closeBrowser(): Promise<void> {}
}
