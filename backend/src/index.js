const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  obtenerPreciosSedes,
  obtenerReporteQuincenal,
  obtenerReporteCobrosComparativoSede,
  obtenerReporteConversionClasesPrueba,
  obtenerReporteOcupacionClases,
} = require('./deportnetClientFacade');
const { validateSearchDateRange } = require('./validateSearchDates');
const { validateOcupacionDateRange } = require('./validateOcupacionDates');

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/api/report/quincenal', async (req, res) => {
  try {
    const { desde, hasta, sedes } = req.body || {};

    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
    }

    const fechas = validateSearchDateRange(desde, hasta);
    if (!fechas.ok) {
      return res.status(400).json({ error: fechas.error });
    }

    const data = await obtenerReporteQuincenal({
      desde,
      hasta,
      sedes,
    });

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Error generando reporte',
      detalle: err && err.message ? err.message : String(err),
    });
  }
});

// Streaming con SSE (Server-Sent Events).
// IMPORTANTE: EventSource solo soporta GET, por eso el stream es GET.
// Query:
// - desde=YYYY-MM-DD
// - hasta=YYYY-MM-DD
// - sedes=sedes1,sedes2,... (opcional)
app.get('/api/report/quincenal/stream', async (req, res) => {
  const { desde, hasta, sedes } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }

  const fechasQuincenal = validateSearchDateRange(desde, hasta);
  if (!fechasQuincenal.ok) {
    return res.status(400).json({ error: fechasQuincenal.error });
  }

  const hasSedesParam = Object.prototype.hasOwnProperty.call(req.query || {}, 'sedes');
  let sedesArray = undefined;
  if (hasSedesParam) {
    if (typeof sedes === 'string' && sedes.trim().length) {
      sedesArray = sedes.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      // Si el parámetro existe pero viene vacío, respetamos "sin sedes".
      sedesArray = [];
    }
  }

  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'connected', from: 'server' });

  try {
    const results = await obtenerReporteQuincenal({
      desde,
      hasta,
      sedes: sedesArray,
      isCancelled: () => cancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede });
      },
      onSede: ({ sede, montoFacturado, cantidadClasePrueba, processed, total }) => {
        send({
          type: 'result',
          sede,
          montoFacturado,
          cantidadClasePrueba,
          processed,
          total,
        });
      },
    });

    if (cancelled) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done', results });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500);
    }
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      detalle: err && err.message ? err.message : String(err),
    });
    res.end();
  }
});

// Precios Sedes (reporte de conceptos)
app.get('/api/report/precios-sedes/stream', async (req, res) => {
  const { sedes } = req.query || {};

  const hasSedesParam = Object.prototype.hasOwnProperty.call(req.query || {}, 'sedes');
  let sedesArray = undefined;
  if (hasSedesParam) {
    if (typeof sedes === 'string' && sedes.trim().length) {
      sedesArray = sedes.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      sedesArray = [];
    }
  }

  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'connected', from: 'server' });

  try {
    await obtenerPreciosSedes({
      sedes: sedesArray,
      isCancelled: () => cancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onRow: ({ sede, plan, precio1 }) => {
        send({
          type: 'result',
          sede,
          plan,
          precio1,
        });
      },
    });

    if (cancelled) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      detalle: err && err.message ? err.message : String(err),
    });
    res.end();
  }
});

// Comparativo de cobros por sede: mismo rango de días por mes
app.get('/api/report/cobros-sede-comparativo/stream', async (req, res) => {
  const { desde, hasta, sedes, monthsBack } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }

  const fechasComparativo = validateSearchDateRange(desde, hasta);
  if (!fechasComparativo.ok) {
    return res.status(400).json({ error: fechasComparativo.error });
  }

  const hasSedesParam = Object.prototype.hasOwnProperty.call(req.query || {}, 'sedes');
  let sedesArray = undefined;
  if (hasSedesParam) {
    if (typeof sedes === 'string' && sedes.trim().length) {
      sedesArray = sedes.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      sedesArray = [];
    }
  }

  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'connected', from: 'server' });

  try {
    await obtenerReporteCobrosComparativoSede({
      desde,
      hasta,
      sedes: sedesArray,
      monthsBack: monthsBack ? Number(monthsBack) : 1,
      isCancelled: () => cancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onSede: ({
        sede,
        periodos,
        processed,
        total,
      }) => {
        send({
          type: 'result',
          sede,
          periodos,
          processed,
          total,
        });
      },
    });

    if (cancelled) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      detalle: err && err.message ? err.message : String(err),
    });
    res.end();
  }
});

// Conversión de Clase de prueba por sede
// Query:
// - desde=YYYY-MM-DD
// - hasta=YYYY-MM-DD
// - sedes=sedes1,sedes2,... (opcional)
app.get('/api/report/conversion-clase-prueba/stream', async (req, res) => {
  const { desde, hasta, sedes } = req.query || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Faltan fechas: desde y/o hasta' });
  }

  const fechasConversion = validateSearchDateRange(desde, hasta);
  if (!fechasConversion.ok) {
    return res.status(400).json({ error: fechasConversion.error });
  }

  const hasSedesParam = Object.prototype.hasOwnProperty.call(req.query || {}, 'sedes');
  let sedesArray = undefined;
  if (hasSedesParam) {
    if (typeof sedes === 'string' && sedes.trim().length) {
      sedesArray = sedes.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      sedesArray = [];
    }
  }

  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'connected', from: 'server' });

  // Heartbeat real (con data:) para evitar que navegadores/proxies disparen
  // `EventSource.onerror` por "inactividad" durante scraping largo.
  const heartbeat = setInterval(() => {
    try {
      send({ type: 'heartbeat' });
    } catch (e) {
      // ignore
    }
  }, 20000);

  try {
    await obtenerReporteConversionClasesPrueba({
      desde,
      hasta,
      sedes: sedesArray,
      isCancelled: () => cancelled,
      onProgress: ({ processed, total, sede }) => {
        send({ type: 'progress', processed, total, sede: sede || '' });
      },
      onSede: ({
        sede,
        denominador,
        numerador,
        conversionPct,
        processed,
        total,
      }) => {
        send({
          type: 'result',
          sede,
          denominador,
          numerador,
          conversionPct,
          processed,
          total,
        });
      },
    });

    if (cancelled) {
      send({ type: 'cancelled' });
      return res.end();
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      detalle: err && err.message ? err.message : String(err),
    });
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

  let cancelled = false;
  req.on('close', () => {
    cancelled = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'connected', from: 'server' });

  const heartbeat = setInterval(() => {
    try {
      send({ type: 'heartbeat' });
    } catch (e) {
      void e;
    }
  }, 20000);

  try {
    const sedeStr = String(sede).trim();
    send({
      type: 'progress',
      phase: 'start',
      message: 'Iniciando…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });

    // Deja que los primeros chunks salgan al cliente antes del trabajo largo (Playwright)
    await new Promise((r) => setImmediate(r));

    const data = await obtenerReporteOcupacionClases({
      desde,
      hasta,
      sede: sedeStr,
      isCancelled: () => cancelled,
      emit: (payload) => {
        if (cancelled) return;
        send(payload);
      },
    });

    if (cancelled) {
      send({ type: 'cancelled' });
      return res.end();
    }

    const { diagnostico: _ocupacionDiag, ...ocupacionCliente } = data;
    send({ type: 'result', ocupacion: ocupacionCliente });
    send({
      type: 'progress',
      phase: 'listo',
      message: 'Reporte listo',
      processed: 1,
      total: 1,
      sede: sedeStr,
    });
    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500);
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      detalle: err && err.message ? err.message : String(err),
    });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
  console.log(
    'Health: GET /  |  GET /ping  |  GET /api/ping  (si /api/ping da 404, otro proceso usa el puerto o el código no es este archivo)',
  );
});

