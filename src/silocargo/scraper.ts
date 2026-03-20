import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { execSync } from "child_process";

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
  rawData: Record<string, string>;
}

const LOGIN_RETRY_ATTEMPTS = 3;
const LOGIN_RETRY_DELAY_MS = 2000;
const NAVIGATION_TIMEOUT = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cachedChromiumPath: string | null = null;

function getChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (cachedChromiumPath) return cachedChromiumPath;

  const candidates = [
    "chromium-browser",
    "chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  for (const candidate of candidates) {
    try {
      const resolved = execSync(`which ${candidate} 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (resolved) {
        cachedChromiumPath = resolved;
        return resolved;
      }
    } catch {
      continue;
    }
  }

  try {
    const nixPath = execSync("ls /nix/store/*/bin/chromium-browser 2>/dev/null | head -1", { encoding: "utf-8" }).trim();
    if (nixPath) {
      cachedChromiumPath = nixPath;
      return nixPath;
    }
  } catch {
    // fall through
  }

  cachedChromiumPath = "chromium-browser";
  return "chromium-browser";
}

export class SilocargoScraper {
  private baseUrl: string;
  private user: string;
  private password: string;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() {
    const rawUrl = process.env.SILOCARGO_URL || "https://dsv.colombiasoftware.net";
    try {
      const parsed = new URL(rawUrl);
      this.baseUrl = `${parsed.protocol}//${parsed.host}`;
    } catch {
      this.baseUrl = rawUrl;
    }
    this.user = process.env.SILOCARGO_USER || "";
    this.password = process.env.SILOCARGO_PASSWORD || "";

    if (!this.user || !this.password) {
      throw new Error("SILOCARGO_USER and SILOCARGO_PASSWORD environment variables are required");
    }
  }

  private async launchBrowser(): Promise<void> {
    if (this.browser) return;

    console.log("[SILOCARGO] Lanzando navegador headless...");
    this.browser = await puppeteer.launch({
      executablePath: getChromiumPath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await this.page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  async login(): Promise<boolean> {
    for (let attempt = 1; attempt <= LOGIN_RETRY_ATTEMPTS; attempt++) {
      try {
        console.log(`[SILOCARGO] Intentando login en ${this.baseUrl} (intento ${attempt}/${LOGIN_RETRY_ATTEMPTS})...`);

        await this.launchBrowser();
        if (!this.page) throw new Error("No se pudo crear página del navegador");

        const loginUrl = `${this.baseUrl}/index.php?page=LoginPage`;
        console.log(`[SILOCARGO] Navegando a: ${loginUrl}`);

        await this.page.goto(loginUrl, { waitUntil: "networkidle2" });

        const currentUrl = this.page.url();
        console.log(`[SILOCARGO] Página cargada: ${currentUrl}`);

        const formFields = await this.page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll("form input"));
          return inputs.map((input) => ({
            name: input.getAttribute("name") || "",
            type: input.getAttribute("type") || "text",
            id: input.getAttribute("id") || "",
          }));
        });

        console.log(`[SILOCARGO] Campos del formulario: ${formFields.map((f) => `${f.name}(${f.type})`).join(", ")}`);

        const userField = formFields.find(
          (f) => (f.type === "text" || f.type === "email") &&
            (f.name.toLowerCase().includes("user") || f.name.toLowerCase().includes("usuario") ||
             f.name.toLowerCase().includes("login") || f.name.toLowerCase().includes("email")),
        );

        const passField = formFields.find((f) => f.type === "password");

        if (!userField || !passField) {
          console.warn("[SILOCARGO] No se encontraron campos de usuario/contraseña estándar");
          if (attempt < LOGIN_RETRY_ATTEMPTS) {
            await sleep(LOGIN_RETRY_DELAY_MS * attempt);
            await this.closeBrowser();
          }
          continue;
        }

        console.log(`[SILOCARGO] Completando: usuario=${userField.name}, contraseña=${passField.name}`);

        const userSelector = userField.id ? `#${userField.id}` : `input[name="${userField.name}"]`;
        const passSelector = passField.id ? `#${passField.id}` : `input[name="${passField.name}"]`;

        await this.page.click(userSelector);
        await this.page.type(userSelector, this.user, { delay: 50 });

        await this.page.click(passSelector);
        await this.page.type(passSelector, this.password, { delay: 50 });

        const submitButton = formFields.find((f) => f.type === "submit");
        if (submitButton) {
          const btnSelector = submitButton.id
            ? `#${submitButton.id}`
            : `input[name="${submitButton.name}"][type="submit"]`;
          console.log(`[SILOCARGO] Haciendo click en botón: ${submitButton.name}`);
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT }).catch(() => null),
            this.page.click(btnSelector),
          ]);
        } else {
          console.log("[SILOCARGO] No se encontró botón submit, enviando formulario con Enter");
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT }).catch(() => null),
            this.page.keyboard.press("Enter"),
          ]);
        }

        await sleep(1000);

        const postLoginUrl = this.page.url();
        console.log(`[SILOCARGO] URL post-login: ${postLoginUrl}`);

        const postLoginCheck = await this.page.evaluate(() => {
          const html = document.documentElement.innerHTML.toLowerCase();
          const hasPasswordField = document.querySelector("input[type='password']") !== null;
          const hasLoginError = html.includes("contraseña incorrecta") ||
            html.includes("usuario no encontrado") ||
            html.includes("invalid password") ||
            html.includes("credenciales inválidas") ||
            html.includes("login failed") ||
            html.includes("acceso denegado") ||
            html.includes("datos incorrectos") ||
            html.includes("error de autenticación");
          const pageTitle = document.title || "";
          return { hasPasswordField, hasLoginError, pageTitle, htmlLength: html.length };
        });

        console.log(`[SILOCARGO] Verificación post-login: password_field=${postLoginCheck.hasPasswordField}, login_error=${postLoginCheck.hasLoginError}, title="${postLoginCheck.pageTitle}", html_length=${postLoginCheck.htmlLength}`);

        if (postLoginCheck.hasLoginError) {
          console.warn(`[SILOCARGO] Error de login detectado en intento ${attempt}`);
          await this.closeBrowser();
          if (attempt < LOGIN_RETRY_ATTEMPTS) {
            await sleep(LOGIN_RETRY_DELAY_MS * attempt);
          }
          continue;
        }

        const urlIsLoginPage = postLoginUrl.toLowerCase().includes("loginpage") || postLoginUrl.toLowerCase().includes("/login");
        const titleIsLogin = postLoginCheck.pageTitle.toLowerCase().includes("login");

        if (urlIsLoginPage || titleIsLogin) {
          console.warn(`[SILOCARGO] Login no verificado en intento ${attempt} - aún en página de login (url_login=${urlIsLoginPage}, title_login=${titleIsLogin})`);
          await this.closeBrowser();
          if (attempt < LOGIN_RETRY_ATTEMPTS) {
            await sleep(LOGIN_RETRY_DELAY_MS * attempt);
          }
          continue;
        }

        console.log("[SILOCARGO] Login exitoso (verificado)");
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SILOCARGO] Error en login intento ${attempt}/${LOGIN_RETRY_ATTEMPTS}: ${message}`);
        await this.closeBrowser();
        if (attempt < LOGIN_RETRY_ATTEMPTS) {
          await sleep(LOGIN_RETRY_DELAY_MS * attempt);
        }
      }
    }

    console.error("[SILOCARGO] Login fallido después de todos los intentos");
    return false;
  }

  async fetchSolicitudes(): Promise<Solicitud[]> {
    const loginOk = await this.login();
    if (!loginOk) {
      throw new Error("No se pudo hacer login en SILOCARGO");
    }

    if (!this.page) {
      throw new Error("Navegador no inicializado después del login");
    }

    try {
      console.log("[SILOCARGO] Navegando al módulo ConfirmarSolicitudDsv...");

      const possibleUrls = [
        `${this.baseUrl}/index.php?page=ConfirmarSolicitudDsv`,
        `${this.baseUrl}/index.php?page=Solicitud.ConfirmarSolicitudDsv`,
        `${this.baseUrl}/ConfirmarSolicitudDsv`,
        `${this.baseUrl}/ConfirmarSolicitudDsv/Index`,
      ];

      let moduleFound = false;

      for (const url of possibleUrls) {
        try {
          console.log(`[SILOCARGO] Probando URL: ${url}`);
          await this.page.goto(url, { waitUntil: "networkidle2" });

          const currentUrl = this.page.url();
          if (currentUrl.toLowerCase().includes("login")) {
            console.warn("[SILOCARGO] Redirigido a login, sesión expirada");
            await this.closeBrowser();
            throw new Error("Sesión expirada, se requiere re-login");
          }

          const hasTable = await this.page.evaluate(() => {
            return document.querySelectorAll("table").length > 0;
          });

          if (hasTable) {
            console.log(`[SILOCARGO] Módulo encontrado en: ${url}`);
            moduleFound = true;
            break;
          }

          const pageContent = await this.page.evaluate(() => document.documentElement.innerHTML);
          if (pageContent.length > 500) {
            console.log(`[SILOCARGO] Página cargada sin tabla pero con contenido (${pageContent.length} chars): ${url}`);
            moduleFound = true;
            break;
          }
        } catch (navErr: unknown) {
          const message = navErr instanceof Error ? navErr.message : String(navErr);
          if (message.includes("Sesión expirada")) throw navErr;
          console.warn(`[SILOCARGO] Error accediendo ${url}: ${message}`);
          continue;
        }
      }

      if (!moduleFound) {
        await this.closeBrowser();
        throw new Error("No se pudo acceder al módulo ConfirmarSolicitudDsv en ninguna URL conocida");
      }

      const solicitudes = await this.extractSolicitudes();
      await this.closeBrowser();
      return solicitudes;
    } catch (err: unknown) {
      await this.closeBrowser();
      throw err;
    }
  }

  private async extractSolicitudes(): Promise<Solicitud[]> {
    if (!this.page) return [];

    const tableData = await this.page.evaluate(() => {
      const tables = document.querySelectorAll("table");
      if (tables.length === 0) return { headers: [] as string[], rows: [] as string[][] };

      let targetTable = tables[0];
      let maxRows = 0;
      tables.forEach((t) => {
        const rowCount = t.querySelectorAll("tr").length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          targetTable = t;
        }
      });

      const headers: string[] = [];
      const headerCells = targetTable.querySelectorAll("thead tr th, tr:first-child th");
      headerCells.forEach((cell) => {
        headers.push((cell.textContent || "").trim().toLowerCase());
      });

      const rows: string[][] = [];
      const dataRows = headers.length > 0
        ? targetTable.querySelectorAll("tbody tr")
        : targetTable.querySelectorAll("tr");

      dataRows.forEach((row, idx) => {
        if (headers.length === 0 && idx === 0) return;
        const cells: string[] = [];
        row.querySelectorAll("td").forEach((cell) => {
          cells.push((cell.textContent || "").trim());
        });
        if (cells.length >= 2) {
          rows.push(cells);
        }
      });

      return { headers, rows };
    });

    const solicitudes: Solicitud[] = [];

    for (let i = 0; i < tableData.rows.length; i++) {
      const cells = tableData.rows[i];
      const rawData: Record<string, string> = {};

      tableData.headers.forEach((header, idx) => {
        if (idx < cells.length) {
          rawData[header] = cells[idx];
        }
      });

      if (tableData.headers.length === 0) {
        cells.forEach((cell, idx) => {
          rawData[`col_${idx}`] = cell;
        });
      }

      const solicitud: Solicitud = {
        id: this.findField(rawData, tableData.headers, cells, ["id", "numero", "no", "nro", "solicitud", "código", "codigo"], 0),
        fecha: this.findField(rawData, tableData.headers, cells, ["fecha", "date", "fecha solicitud", "fecha_solicitud"], 1),
        origen: this.findField(rawData, tableData.headers, cells, ["origen", "from", "procedencia", "ciudad origen"], 2),
        destino: this.findField(rawData, tableData.headers, cells, ["destino", "to", "ciudad destino", "destino final"], 3),
        estado: this.findField(rawData, tableData.headers, cells, ["estado", "status", "estatus"], 4),
        producto: this.findField(rawData, tableData.headers, cells, ["producto", "product", "mercancía", "mercancia", "carga"], 5),
        cantidad: this.findField(rawData, tableData.headers, cells, ["cantidad", "qty", "quantity", "peso", "toneladas"], 6),
        vehiculo: this.findField(rawData, tableData.headers, cells, ["vehiculo", "vehículo", "placa", "tipo vehiculo"], 7),
        observaciones: this.findField(rawData, tableData.headers, cells, ["observaciones", "obs", "notas", "comments", "observacion"], 8),
        rawData,
      };

      if (solicitud.id || solicitud.fecha) {
        if (!solicitud.id && solicitud.fecha) {
          solicitud.id = `auto_${solicitud.fecha}_${i}`;
          console.warn(`[SILOCARGO] Solicitud sin ID, asignado ID automático: ${solicitud.id}`);
        }
        solicitudes.push(solicitud);
      }
    }

    console.log(`[SILOCARGO] Se encontraron ${solicitudes.length} solicitudes`);
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
}
