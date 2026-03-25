const { chromium } = require('playwright');

const localesDefault = require('../../../../shared/locales.json');

const {
  login,
  selectSucursal,
  goToCobros,
  setFechaRango,
  marcarAgrupar,
  ejecutarBusqueda,
} = require('../deportnetActions');

const { leerTotalFacturado } = require('../deportnetReaders');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseISODateParts(iso) {
  const [y, m, d] = String(iso || '')
    .split('-')
    .map((x) => Number(x));
  return { y, m, d };
}

function isoFromYMD(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Reporte comparativo por meses:
 * - Compara el mismo rango de días (desde/hasta) entre mes actual y meses anteriores.
 */
async function obtenerReporteCobrosComparativoSede({
  desde,
  hasta,
  sedes,
  onSede,
  onProgress,
  monthsBack = 1,
  isCancelled,
}) {
  const sedesAUsar = Array.isArray(sedes) ? sedes : localesDefault;
  const monthsBackSafe = Number.isFinite(Number(monthsBack))
    ? Math.max(0, Math.floor(Number(monthsBack)))
    : 1;

  const { y: baseY, m: baseM, d: baseDDesde } = parseISODateParts(desde);
  const { y: baseY2, m: baseM2, d: baseDHasta } = parseISODateParts(hasta);
  if (!baseY || !baseM || !baseDDesde || !baseDHasta || !baseY2 || !baseM2) {
    throw new Error(`Cobros comparativo: 'desde/hasta' inválidas: ${desde} - ${hasta}`);
  }

  // Asumimos que `desde` y `hasta` están dentro del mismo mes.
  // Usamos solo la parte "día del mes" para replicar en meses anteriores.
  const dayDesde = baseDDesde;
  const dayHasta = baseDHasta;

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

  const mesES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const buildPeriodForOffset = (offset) => {
    // offset=0 => mes base; offset=1 => mes anterior.
    const dt = new Date(Date.UTC(baseY, baseM - 1, 1));
    dt.setUTCMonth(dt.getUTCMonth() - offset);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;

    const maxD = daysInMonth(y, m);
    const d1 = Math.min(dayDesde, maxD);
    const d2 = Math.min(dayHasta, maxD);

    const desdeISO = isoFromYMD(y, m, d1);
    const hastaISO = isoFromYMD(y, m, d2);

    const label = `${mesES[m - 1]} ${y} (${pad2(d1)}-${pad2(d2)})`;
    return { desdeISO, hastaISO, label };
  };

  // Queremos mostrar de más antiguo -> más nuevo.
  // offset=monthsBackSafe => mes más antiguo; offset=0 => mes actual.
  const periodos = [];
  for (let i = monthsBackSafe; i >= 0; i--) {
    periodos.push(buildPeriodForOffset(i));
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await login(page);

    const resultados = [];
    const total = sedesAUsar.length;
    let processed = 0;

    for (const sede of sedesAUsar) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      if (typeof onProgress === 'function') {
        onProgress({ processed, total, sede });
      }

      await selectSucursal(page, sede);

      const periodosResults = [];
      for (const p of periodos) {
        // Volvemos al reporte para asegurar el estado correcto.
        await goToCobros(page);
        await setFechaRango(page, p.desdeISO, p.hastaISO);
        await marcarAgrupar(page);
        await ejecutarBusqueda(page);

        const monto = await leerTotalFacturado(page, { sede });
        periodosResults.push({ label: p.label, monto: monto ?? null });
      }

      resultados.push({
        sede,
        periodos: periodosResults.map((x) => ({
          label: x.label,
          monto: x.monto,
        })),
      });

      processed += 1;
      if (typeof onSede === 'function') {
        onSede({
          sede,
          periodos: periodosResults.map((x) => ({
            label: x.label,
            monto: x.monto,
          })),
          processed,
          total,
        });
      }
    }

    return resultados;
  } finally {
    await browser.close();
  }
}

module.exports = { obtenerReporteCobrosComparativoSede };

