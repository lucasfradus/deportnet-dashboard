const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  obtenerPreciosSedes,
  obtenerReporteQuincenal,
  obtenerReporteCobrosComparativoSede,
  obtenerReporteConversionClasesPrueba,
  obtenerReporteOcupacionClases,
  obtenerReporteSociosActivos,
} = require('./deportnetClientFacade');
const { validateSearchDateRange } = require('./validateSearchDates');
const { validateOcupacionDateRange } = require('./validateOcupacionDates');
const { requireAuth } = require('./authMiddleware');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());

// ── SSE helpers ───────────────────────────────────────────────────────────────

/**
 * Parsea ?sedes=a,b,c de la query.
 * - Sin parámetro → undefined (el reporte usa todas las sedes por defecto)
 * - Parámetro vacío → [] (sin sedes)
 * - Con valor → array de strings
 */
function parseSedesParam(query) {
  if (!Object.prototype.hasOwnProperty.call(query || {}, 'sedes')) return undefined;
  const s = query.sedes;
  return typeof s === 'string' && s.trim() ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Inicializa una respuesta SSE: cabeceras, flag cancelled, evento connected.
 * Retorna `send` (escribe un evento) e `isCancelled` (consulta el flag).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ extraHeaders?: Record<string, string> }} [opts]
 */
function initSse(req, res, { extraHeaders = {} } = {}) {
  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'connected', from: 'server' });

  return { send, isCancelled: () => cancelled };
}

/**
 * Heartbeat SSE cada 20 s para evitar timeouts de proxy/navegador en scraping largo.
 * @param {(payload: object) => void} send
 * @returns {ReturnType<typeof setInterval>}
 */
function startHeartbeat(send) {
  return setInterval(() => {
    try { send({ type: 'heartbeat' }); } catch { /* ignore */ }
  }, 20000);
}

// ─────────────────────────────────────────────────────────────────────────────

const healthPayload = () => ({
  ok: true,
  service: 'deportnet-dashboard-backend',
  ocupacionStream: '/api/report/ocupacion/stream',
  tip: 'Si ves 404 en /api/ping pero este JSON en / o /ping, hay un proxy mal o otro proceso en :4000',
});

/** Raíz: útil si algo intercepta solo /api/* */
app.get('/', (_req, res) => {
  res.json({ ...healthPayload(), path: '/' });
});

/** Sin prefijo /api (mismo diagnóstico que /api/ping) */
app.get('/ping', (_req, res) => {
  res.json({ ...healthPayload(), path: '/ping' });
});

/** Comprobar que es este backend (útil si ves "Cannot GET" en otras rutas: otro proceso en :4000) */
app.get('/api/ping', (_req, res) => {
  res.json({ ...healthPayload(), path: '/api/ping' });
});

// ── Autenticación ─────────────────────────────────────────────────────────────
// AUTH_USERS en .env: "usuario1:clave1,usuario2:clave2"
// JWT_SECRET en .env: clave secreta para firmar tokens (cámbiala en producción)
app.post('/api/auth/login', express.json(), (req, res) => {
  const { username, password } = req.body || {};
  const rawUsers = process.env.AUTH_USERS || '';
  const users = Object.fromEntries(
    rawUsers.split(',')
      .map((entry) => { const i = entry.trim().indexOf(':'); return i < 0 ? null : [entry.slice(0, i).trim(), entry.slice(i + 1).trim()]; })
      .filter(Boolean)
  );

  if (!username || !password || users[username] !== password) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const secret = process.env.JWT_SECRET || 'changeme';
  if (secret === 'changeme') console.warn('[auth] JWT_SECRET no configurado — usá una clave segura en producción');

  const token = jwt.sign({ username }, secret, { expiresIn: '24h' });
  res.json({ token });
});

// Protege todos los endpoints de reportes
app.use('/api/report', requireAuth);

// Streaming con SSE (Server-Sent Events).
// IMPORTANTE: EventSource solo soporta GET, por eso el stream es GET.
// Query:
// - desde=YYYY-MM-DD
// - hasta=YYYY-MM-DD
// - sedes=sedes1,sedes2,... (opcional)
app.get('/api/report/quincenal/stream', async (req, res) => {
  const { desde, hasta } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }
  const fechasQuincenal = validateSearchDateRange(desde, hasta);
  if (!fechasQuincenal.ok) {
    return res.status(400).json({ error: fechasQuincenal.error });
  }

  const sedesArray = parseSedesParam(req.query);
  const { send, isCancelled } = initSse(req, res);
  const heartbeat = startHeartbeat(send);

  try {
    const results = await obtenerReporteQuincenal({
      desde,
      hasta,
      sedes: sedesArray,
      isCancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede });
      },
      onSede: ({ sede, montoFacturado, cantidadClasePrueba, processed, total }) => {
        send({ type: 'result', sede, montoFacturado, cantidadClasePrueba, processed, total });
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done', results });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Precios Sedes (reporte de conceptos)
app.get('/api/report/precios-sedes/stream', async (req, res) => {
  const sedesArray = parseSedesParam(req.query);
  const { send, isCancelled } = initSse(req, res);
  const heartbeat = startHeartbeat(send);

  try {
    await obtenerPreciosSedes({
      sedes: sedesArray,
      isCancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onRow: ({ sede, plan, precio1 }) => {
        send({ type: 'result', sede, plan, precio1 });
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Socios activos (reportMembersWithValidActivities): sin rango de fechas, una lectura por sucursal
// Query: sedes=sede1,sede2,... (opcional; vacío = todas las de locales.json)
app.get('/api/report/socios-activos/stream', async (req, res) => {
  const sedesArray = parseSedesParam(req.query);
  const { send, isCancelled } = initSse(req, res);
  const heartbeat = startHeartbeat(send);

  try {
    await obtenerReporteSociosActivos({
      sedes: sedesArray,
      isCancelled,
      onProgress: ({ processed, total, sede, message, phase }) => {
        send({
          type: 'progress',
          processed,
          total,
          sede: sede || '',
          message: message || '',
          phase: phase || '',
        });
      },
      onSede: (payload) => {
        send({
          type: 'result',
          sociosActivosSede: {
            sede: payload.sede,
            filasTotales: payload.filasTotales ?? 0,
            filasRawDom: payload.filasRawDom ?? null,
            sociosUnicosPorNombre: payload.sociosUnicosPorNombre ?? null,
            sociosUnicosSoloCdpEfectivo: payload.sociosUnicosSoloCdpEfectivo ?? null,
            conteosPorPlan: payload.conteosPorPlan ?? {},
            anomalias: payload.anomalias || [],
            error: payload.error || null,
          },
        });
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Comparativo de cobros por sede: mismo rango de días por mes
app.get('/api/report/cobros-sede-comparativo/stream', async (req, res) => {
  const { desde, hasta, monthsBack } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }
  const fechasComparativo = validateSearchDateRange(desde, hasta);
  if (!fechasComparativo.ok) {
    return res.status(400).json({ error: fechasComparativo.error });
  }

  const sedesArray = parseSedesParam(req.query);
  const { send, isCancelled } = initSse(req, res);
  const heartbeat = startHeartbeat(send);

  try {
    await obtenerReporteCobrosComparativoSede({
      desde,
      hasta,
      sedes: sedesArray,
      monthsBack: monthsBack ? Number(monthsBack) : 1,
      isCancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onSede: ({ sede, periodos, processed, total }) => {
        send({ type: 'result', sede, periodos, processed, total });
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Conversión de Clase de prueba por sede
// Query: desde, hasta, sedes (opcional)
app.get('/api/report/conversion-clase-prueba/stream', async (req, res) => {
  const { desde, hasta } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }
  const fechasConversion = validateSearchDateRange(desde, hasta);
  if (!fechasConversion.ok) {
    return res.status(400).json({ error: fechasConversion.error });
  }

  const sedesArray = parseSedesParam(req.query);
  const { send, isCancelled } = initSse(req, res);
  const heartbeat = startHeartbeat(send);

  try {
    await obtenerReporteConversionClasesPrueba({
      desde,
      hasta,
      sedes: sedesArray,
      isCancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onSede: ({ sede, denominador, numerador, conversionPct, processed, total }) => {
        send({ type: 'result', sede, denominador, numerador, conversionPct, processed, total });
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Ocupación (clases / socios por sucursal): máx. 15 días, una sucursal por ejecución
// Query: desde, hasta, sede (nombre completo como en locales.json)
app.get('/api/report/ocupacion/stream', async (req, res) => {
  const { desde, hasta, sede } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }
  if (!sede || !String(sede).trim()) {
    return res.status(400).json({ error: 'Indicá una sucursal (parámetro sede)' });
  }
  const fechasOcup = validateOcupacionDateRange(desde, hasta);
  if (!fechasOcup.ok) {
    return res.status(400).json({ error: fechasOcup.error });
  }

  const { send, isCancelled } = initSse(req, res, { extraHeaders: { 'X-Accel-Buffering': 'no' } });
  const heartbeat = startHeartbeat(send);

  try {
    const sedeStr = String(sede).trim();
    send({ type: 'progress', phase: 'start', message: 'Iniciando…', processed: 0, total: 1, sede: sedeStr });

    // Deja que los primeros chunks salgan al cliente antes del trabajo largo (Playwright)
    await new Promise((r) => setImmediate(r));

    const data = await obtenerReporteOcupacionClases({
      desde,
      hasta,
      sede: sedeStr,
      isCancelled,
      emit: (payload) => {
        if (isCancelled()) return;
        send(payload);
      },
    });

    if (isCancelled()) {
      send({ type: 'cancelled' });
      return res.end();
    }

    const { diagnostico: _ocupacionDiag, ...ocupacionCliente } = data;
    send({ type: 'result', ocupacion: ocupacionCliente });
    send({ type: 'progress', phase: 'listo', message: 'Reporte listo', processed: 1, total: 1, sede: sedeStr });
    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({ type: 'error', error: err?.message ?? String(err) });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Sirve el frontend en producción (después de todos los endpoints /api)
const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/*splat', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
  console.log(
    'Health: GET /  |  GET /ping  |  GET /api/ping  (si /api/ping da 404, otro proceso usa el puerto o el código no es este archivo)',
  );
});

