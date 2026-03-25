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

const {
  leerTotalFacturado,
  sumarCantidadClasesPrueba,
} = require('../deportnetReaders');

async function obtenerReporteQuincenal({
  desde,
  hasta,
  sedes,
  onSede,
  onProgress,
  isCancelled,
}) {
  // Si `sedes` viene como array, lo respetamos incluso si está vacío.
  // Si no viene (undefined), usamos la lista por defecto.
  const sedesAUsar = Array.isArray(sedes) ? sedes : localesDefault;

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
      await goToCobros(page);
      await setFechaRango(page, desde, hasta);
      await marcarAgrupar(page);
      await ejecutarBusqueda(page);

      const monto = await leerTotalFacturado(page, { sede });
      const cantidadClasePrueba = await sumarCantidadClasesPrueba(page, sede);

      resultados.push({ sede, montoFacturado: monto, cantidadClasePrueba });

      processed += 1;
      if (typeof onSede === 'function') {
        onSede({
          sede,
          montoFacturado: monto,
          cantidadClasePrueba,
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

module.exports = { obtenerReporteQuincenal };

