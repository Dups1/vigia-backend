# 📡 Vigía Backend - Servidor de Señalización WebRTC

Servidor de señalización (Signaling Server) ligero y de alta velocidad para **Vigía**, diseñado para coordinar la transmisión de video P2P de ultra baja latencia (<200 ms) entre la aplicación móvil de campo y la consola web de monitoreo.

Listo para desplegar en **[Render](https://render.com)** como un **Web Service**.

---

## 🚀 Arquitectura y Funcionalidad

1. **Protocolo WebSocket Nativo (`ws`)**:
   - Intercambio de ofertas y respuestas SDP (`offer` / `answer`).
   - Intercambio de candidatos de red ICE (`ice-candidate`).
   - Agrupación por salas (`salaId`), permitiendo conectar múltiples cámaras con sus respectivos supervisores web.
2. **Heartbeat Inteligente (Anti-inactividad)**:
   - Envía pings periódicos cada 25 segundos para evitar que el reverse proxy de Render corte la conexión WebSocket por inactividad.
3. **Endpoints HTTP de Diagnóstico**:
   - `GET /`: Métricas en vivo (salas activas, emisores y visores conectados, uptime).
   - `GET /health`: Health check para Render (código HTTP 200).
   - `GET /api/salas`: Listado JSON de salas activas.

---

## 🛠️ Ejecución Local

1. Accede a la carpeta:
   ```bash
   cd vigia-backend
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Inicia el servidor:
   ```bash
   npm start
   ```
   *Para modo desarrollo con recarga automática:*
   ```bash
   npm run dev
   ```
4. Abre en tu navegador `http://localhost:3000` para comprobar el estado.

---

## ☁️ Guía de Despliegue en Render (Paso a Paso)

Render ofrece alojamiento gratuito con soporte nativo para **WebSockets (WSS)** y certificados SSL automáticos.

### Opción 1: Despliegue desde el Repositorio de GitHub

1. Sube tu proyecto a GitHub (incluyendo la carpeta `vigia-backend/`).
2. Entra en tu panel de **[Render Dashboard](https://dashboard.render.com/)**.
3. Haz clic en el botón **New +** y selecciona **Web Service**.
4. Conecta tu repositorio de GitHub.
5. Configura los campos del servicio:
   - **Name**: `vigia-backend` (o el nombre que prefieras).
   - **Region**: `Oregon (US West)` o la más cercana a tus usuarios.
   - **Root Directory**: `vigia-backend` *(Muy importante si está dentro del repositorio de Flutter)*.
   - **Runtime**: `Node`.
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
6. En la sección **Advanced**:
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: `Yes`
7. Haz clic en **Create Web Service**.

### Opción 2: Despliegue Automático con `render.yaml` (Blueprint)
Render detectará automáticamente el archivo `render.yaml` incluido en esta carpeta.

---

## 🌐 URLs Resultantes en Render

Una vez desplegado en Render, obtendrás una URL pública como:
```text
https://vigia-backend.onrender.com
```

Para conectarte desde Flutter en la app móvil y en la web:
```text
HTTP / Health:  https://vigia-backend.onrender.com/health
WebSocket:      wss://vigia-backend.onrender.com
```

---

## 📨 Protocolo de Mensajes WebSocket

### 1. Unirse a una Sala
```json
{
  "tipo": "unirse",
  "salaId": "sala-vigia-1",
  "rol": "emisor", // "emisor" para el móvil, "visor" para la consola web
  "dispositivoId": "CAM-01"
}
```

### 2. Enviar Oferta SDP (Móvil -> Web)
```json
{
  "tipo": "oferta",
  "salaId": "sala-vigia-1",
  "sdp": "v=0\r\no=- ...",
  "destinatarioId": "usr_opcional"
}
```

### 3. Enviar Respuesta SDP (Web -> Móvil)
```json
{
  "tipo": "respuesta",
  "salaId": "sala-vigia-1",
  "sdp": "v=0\r\no=- ...",
  "destinatarioId": "usr_emisor"
}
```

### 4. Intercambiar Candidatos ICE
```json
{
  "tipo": "candidato-ice",
  "salaId": "sala-vigia-1",
  "candidato": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  },
  "destinatarioId": "usr_destino"
}
```
