/**
 * Servidor de Señalización WebRTC para Vigía
 * Diseñado y preparado para despliegue en Render (Web Service).
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const servidorHttp = http.createServer(app);
const wss = new WebSocket.Server({ server: servidorHttp });

// Almacén en memoria de salas activas
// Estructura: salaId -> { id, emisores: Map, visores: Map, creadoEn: Date }
const salas = new Map();

function obtenerOCrearSala(salaId) {
  if (!salas.has(salaId)) {
    salas.set(salaId, {
      id: salaId,
      emisores: new Map(),
      visores: new Map(),
      creadoEn: new Date(),
    });
    console.log(`[SALA CREADA] Sala "${salaId}" iniciada.`);
  }
  return salas.get(salaId);
}

function limpiarSalaSiVacia(salaId) {
  const sala = salas.get(salaId);
  if (sala && sala.emisores.size === 0 && sala.visores.size === 0) {
    salas.delete(salaId);
    console.log(`[SALA ELIMINADA] Sala "${salaId}" vacía y cerrada.`);
  }
}

// -------------------------------------------------------------
// Endpoints HTTP para Render y Monitoreo
// -------------------------------------------------------------

// Ruta raíz: Información general del estado del servidor
app.get('/', (req, res) => {
  const totalSalas = salas.size;
  let totalEmisores = 0;
  let totalVisores = 0;

  salas.forEach((s) => {
    totalEmisores += s.emisores.size;
    totalVisores += s.visores.size;
  });

  res.json({
    servicio: 'Vigía - Servidor de Señalización WebRTC',
    estado: 'ACTIVO',
    uptimeSegundos: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    metricas: {
      salasActivas: totalSalas,
      emisoresConectados: totalEmisores,
      visoresConectados: totalVisores,
      conexionesTotales: wss.clients.size,
    },
    version: '1.0.0',
  });
});

// Endpoint de Health Check (específico para Render)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    conexiones: wss.clients.size,
  });
});

// Endpoint para consultar salas activas
app.get('/api/salas', (req, res) => {
  const listaSalas = [];
  salas.forEach((s, id) => {
    listaSalas.push({
      id,
      emisores: s.emisores.size,
      visores: s.visores.size,
      creadoEn: s.creadoEn,
    });
  });
  res.json({ salas: listaSalas });
});

// -------------------------------------------------------------
// Servidor WebSocket: Protocolo de Señalización WebRTC
// -------------------------------------------------------------

wss.on('connection', (ws, req) => {
  ws.esVivo = true;
  ws.clienteId = `usr_${Math.random().toString(36).substring(2, 9)}`;
  ws.salaId = null;
  ws.rol = null; // 'emisor' (Móvil) | 'visor' (Web)

  const ipRemota = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[CONEXIÓN] Cliente conectado (${ws.clienteId}) desde ${ipRemota}`);

  ws.on('pong', () => {
    ws.esVivo = true;
  });

  ws.on('message', (datosBrutos) => {
    try {
      const mensaje = JSON.parse(datosBrutos.toString());
      procesarMensaje(ws, mensaje);
    } catch (error) {
      console.error(`[ERROR JSON] Mensaje inválido de ${ws.clienteId}:`, error.message);
      ws.send(JSON.stringify({ tipo: 'error', mensaje: 'Formato JSON inválido.' }));
    }
  });

  ws.on('close', () => {
    manejarDesconexion(ws);
  });

  ws.on('error', (err) => {
    console.error(`[ERROR WS] Cliente ${ws.clienteId}:`, err.message);
  });
});

function procesarMensaje(ws, mensaje) {
  const tipo = mensaje.tipo;

  switch (tipo) {
    // 1. UNIRSE A UNA SALA (Móvil o Web)
    case 'unirse': {
      const salaId = (mensaje.salaId || 'sala-vigia-principal').trim();
      const rol = mensaje.rol === 'emisor' ? 'emisor' : 'visor';
      const dispositivoId = mensaje.dispositivoId || ws.clienteId;

      ws.salaId = salaId;
      ws.rol = rol;
      ws.dispositivoId = dispositivoId;

      const sala = obtenerOCrearSala(salaId);

      if (rol === 'emisor') {
        sala.emisores.set(ws.clienteId, ws);
        console.log(`[EMISOR UNIDO] ${dispositivoId} (${ws.clienteId}) en sala "${salaId}"`);
      } else {
        sala.visores.set(ws.clienteId, ws);
        console.log(`[VISOR UNIDO] ${dispositivoId} (${ws.clienteId}) en sala "${salaId}"`);
      }

      // Confirmar al cliente que se unió exitosamente
      ws.send(JSON.stringify({
        tipo: 'unido',
        clienteId: ws.clienteId,
        salaId: salaId,
        rol: rol,
        emisoresEnSala: sala.emisores.size,
        visoresEnSala: sala.visores.size,
      }));

      // Notificar a todos en la sala sobre el nuevo participante
      difundirASala(salaId, {
        tipo: 'peer-unido',
        clienteId: ws.clienteId,
        dispositivoId: ws.dispositivoId,
        rol: rol,
        emisoresEnSala: sala.emisores.size,
        visoresEnSala: sala.visores.size,
      }, ws.clienteId);

      break;
    }

    // 2. OFERTA SDP (Enviada por el Emisor Móvil a los Visores Web)
    case 'oferta': {
      if (!ws.salaId) return;
      const sala = salas.get(ws.salaId);
      if (!sala) return;

      console.log(`[OFERTA SDP] De ${ws.clienteId} (${ws.rol}) en sala "${ws.salaId}"`);

      // Si se especifica un destinatario, se envía directo; si no, a todos los visores
      if (mensaje.destinatarioId && sala.visores.has(mensaje.destinatarioId)) {
        const destinatario = sala.visores.get(mensaje.destinatarioId);
        destinatario.send(JSON.stringify({
          tipo: 'oferta',
          sdp: mensaje.sdp,
          remitenteId: ws.clienteId,
          dispositivoId: ws.dispositivoId,
        }));
      } else {
        sala.visores.forEach((visor) => {
          if (visor.readyState === WebSocket.OPEN) {
            visor.send(JSON.stringify({
              tipo: 'oferta',
              sdp: mensaje.sdp,
              remitenteId: ws.clienteId,
              dispositivoId: ws.dispositivoId,
            }));
          }
        });
      }
      break;
    }

    // 3. RESPUESTA SDP (Enviada por el Visor Web de vuelta al Emisor)
    case 'respuesta': {
      if (!ws.salaId) return;
      const sala = salas.get(ws.salaId);
      if (!sala) return;

      console.log(`[RESPUESTA SDP] De ${ws.clienteId} (${ws.rol}) en sala "${ws.salaId}"`);

      if (mensaje.destinatarioId && sala.emisores.has(mensaje.destinatarioId)) {
        const emisor = sala.emisores.get(mensaje.destinatarioId);
        emisor.send(JSON.stringify({
          tipo: 'respuesta',
          sdp: mensaje.sdp,
          remitenteId: ws.clienteId,
        }));
      } else {
        // Enviar a todos los emisores de la sala
        sala.emisores.forEach((emisor) => {
          if (emisor.readyState === WebSocket.OPEN) {
            emisor.send(JSON.stringify({
              tipo: 'respuesta',
              sdp: mensaje.sdp,
              remitenteId: ws.clienteId,
            }));
          }
        });
      }
      break;
    }

    // 4. CANDIDATO ICE (Intercambio de rutas de red)
    case 'candidato-ice': {
      if (!ws.salaId) return;
      const sala = salas.get(ws.salaId);
      if (!sala) return;

      const paqueteIce = {
        tipo: 'candidato-ice',
        candidato: mensaje.candidato,
        remitenteId: ws.clienteId,
      };

      if (mensaje.destinatarioId) {
        // Enviar al destinatario específico (ya sea emisor o visor)
        const objetivo = sala.emisores.get(mensaje.destinatarioId) || sala.visores.get(mensaje.destinatarioId);
        if (objetivo && objetivo.readyState === WebSocket.OPEN) {
          objetivo.send(JSON.stringify(paqueteIce));
        }
      } else {
        // Si no hay destinatario específico: si soy emisor -> a visores; si soy visor -> a emisores
        const destinoMap = ws.rol === 'emisor' ? sala.visores : sala.emisores;
        destinoMap.forEach((peer) => {
          if (peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify(paqueteIce));
          }
        });
      }
      break;
    }

    // 5. PING / LATENCIA MANUAL (Opcional del cliente Flutter)
    case 'ping': {
      ws.send(JSON.stringify({ tipo: 'pong', timestamp: Date.now() }));
      break;
    }

    // 6. COMANDO REMOTO DE RESOLUCIÓN (Bidireccional: Web <-> Móvil)
    case 'comando-resolucion': {
      if (!ws.salaId) return;
      const sala = salas.get(ws.salaId);
      if (!sala) return;

      console.log(`[COMANDO RESOLUCIÓN] De ${ws.clienteId} (${ws.rol}) en sala "${ws.salaId}": ${mensaje.resolucionId}`);
      difundirASala(ws.salaId, {
        tipo: 'comando-resolucion',
        resolucionId: mensaje.resolucionId,
        ancho: mensaje.ancho,
        alto: mensaje.alto,
        fps: mensaje.fps,
        remitenteId: ws.clienteId,
      }, ws.clienteId);
      break;
    }

    default:
      console.warn(`[TIPO DESCONOCIDO] ${tipo} de ${ws.clienteId}`);
      break;
  }
}

function difundirASala(salaId, carga, excluirClienteId = null) {
  const sala = salas.get(salaId);
  if (!sala) return;

  const cargaStr = JSON.stringify(carga);
  const enviarA = (peer) => {
    if (peer.clienteId !== excluirClienteId && peer.readyState === WebSocket.OPEN) {
      peer.send(cargaStr);
    }
  };

  sala.emisores.forEach(enviarA);
  sala.visores.forEach(enviarA);
}

function manejarDesconexion(ws) {
  if (!ws.salaId) {
    console.log(`[DESCONEXIÓN] Cliente ${ws.clienteId} sin sala desconectado.`);
    return;
  }

  const sala = salas.get(ws.salaId);
  if (sala) {
    if (ws.rol === 'emisor') {
      sala.emisores.delete(ws.clienteId);
    } else {
      sala.visores.delete(ws.clienteId);
    }

    console.log(`[SALIDA] ${ws.dispositivoId || ws.clienteId} (${ws.rol}) abandonó sala "${ws.salaId}".`);

    // Notificar a los sobrevivientes
    difundirASala(ws.salaId, {
      tipo: 'peer-salio',
      clienteId: ws.clienteId,
      dispositivoId: ws.dispositivoId,
      rol: ws.rol,
      emisoresEnSala: sala.emisores.size,
      visoresEnSala: sala.visores.size,
    });

    limpiarSalaSiVacia(ws.salaId);
  }
}

// -------------------------------------------------------------
// Heartbeat Activo: Prevenir cortes de conexión en Render
// Render cierra WebSockets inactivos después de 55 segundos.
// -------------------------------------------------------------
const intervaloHeartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.esVivo) {
      console.log(`[HEARTBEAT TIMEOUT] Cerrando conexión inactiva ${ws.clienteId}`);
      return ws.terminate();
    }
    ws.esVivo = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(intervaloHeartbeat);
});

// -------------------------------------------------------------
// Iniciar el Servidor
// -------------------------------------------------------------
servidorHttp.listen(PORT, () => {
  console.log(`==============================================`);
  console.log(`📡 VIGÍA - SERVIDOR DE SEÑALIZACIÓN WEBRTC`);
  console.log(`🚀 Puerto: ${PORT}`);
  console.log(`🌐 HTTP Status: http://localhost:${PORT}/`);
  console.log(`💓 Health Check: http://localhost:${PORT}/health`);
  console.log(`⚡ WebSocket URL: ws://localhost:${PORT}`);
  console.log(`☁️  Preparado para Render (PORT = process.env.PORT)`);
  console.log(`==============================================`);
});
