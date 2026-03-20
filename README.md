# SILOCARGO Webservice TMS

Servicio de integración que hace scraping del portal SILOCARGO DSV, detecta solicitudes nuevas y las reenvía automáticamente a un webhook TMS.

## Arquitectura

```
SILOCARGO Portal (Puppeteer) → Store (JSON) → Forwarder (axios) → TMS Webhook
```

## Instalación en Replit

1. Importa este repositorio en tu cuenta de Replit  
   (`New Repl → Import from GitHub`)
2. Instala dependencias:  
   ```bash
   npm install
   ```
3. Crea el archivo `.env` basado en `.env.example`:  
   ```
   SILOCARGO_URL=https://dsv.colombiasoftware.net
   SILOCARGO_USER=tu_usuario
   SILOCARGO_PASSWORD=tu_contraseña
   TMS_WEBHOOK_URL=https://tu-sistema-tms.com/webhook/solicitudes
   PORT=3000
   ```
4. Ejecuta el servidor:  
   ```bash
   npm run dev
   ```

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Estado del servicio |
| `GET` | `/api/silocargo/status` | Estado del polling y última sincronización |
| `GET` | `/api/silocargo/solicitudes` | Listado de últimas solicitudes encontradas |
| `POST` | `/api/silocargo/sync` | Dispara una sincronización manual inmediata |

## Comportamiento automático

- Al iniciar, el servidor verifica las variables de entorno
- Si las 3 variables (`SILOCARGO_USER`, `SILOCARGO_PASSWORD`, `TMS_WEBHOOK_URL`) están presentes, inicia **polling automático cada 3 minutos**
- Cada ciclo: hace login → scraping → detecta solicitudes nuevas → reenvía al webhook
- El estado se persiste en `.silocargo-state.json` para no reenviar solicitudes ya procesadas

## Variables de entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `SILOCARGO_URL` | No | URL base del portal (default: `https://dsv.colombiasoftware.net`) |
| `SILOCARGO_USER` | Sí | Usuario de acceso al portal |
| `SILOCARGO_PASSWORD` | Sí | Contraseña de acceso al portal |
| `TMS_WEBHOOK_URL` | Sí | URL donde se envían las solicitudes nuevas |
| `PORT` | No | Puerto del servidor (default: `3000`) |
| `CHROMIUM_PATH` | No | Ruta manual a Chromium si la detección automática falla |
