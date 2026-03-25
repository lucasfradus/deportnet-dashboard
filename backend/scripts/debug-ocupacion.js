/**
 * Prueba local del reporte de ocupación (mismas credenciales que el backend).
 *
 *   cd backend
 *   node scripts/debug-ocupacion.js
 *
 * Opcional: DESDE=2026-03-01 HASTA=2026-03-15 SEDE="CLIC Pilates - Palermo Hollywood"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { obtenerReporteOcupacionClases } = require('../src/deportnet/reports/reporteOcupacionClases');

const desde = process.env.DESDE || '2026-03-01';
const hasta = process.env.HASTA || '2026-03-15';
const sede = process.env.SEDE || 'CLIC Pilates - Palermo Hollywood';

(async () => {
  try {
    const data = await obtenerReporteOcupacionClases({
      desde,
      hasta,
      sede,
      isCancelled: () => false,
    });
    const d = data.diagnostico || {};

    console.log('\n=== DIAGNÓSTICO (compará con ~495 filas en DeportNet) ===\n');
    console.log(JSON.stringify(d, null, 2));

    console.log('\n=== MUESTRA: PRIMERAS FILAS DEL REPORTE (celdas TAB) ===');
    console.log(
      `filasProcesadas=${d.filasIteradas ?? '?'} | volcadasEnArchivo=${d.lineasVolcadasEnArchivo ?? '?'} | max=${d.maxLineasArchivoConfig ?? '?'}`
    );
    (d.muestraPrimerasFilas || []).forEach((ln, i) => {
      console.log(`${String(i + 1).padStart(4)}\t${ln}`);
    });
    if ((d.muestraUltimasFilas || []).length) {
      console.log('\n=== MUESTRA: ÚLTIMAS FILAS (si hubo truncado visual) ===');
      d.muestraUltimasFilas.forEach((ln, i) => {
        console.log(`…\t${ln}`);
      });
    }
    console.log('\n=== LISTADO COMPLETO (hasta OCUPACION_DEBUG_MAX_FILAS) ===');
    console.log('Abrí:', `${String(d.archivoDebug || 'backend/debug/ocupacion_*')}.txt`);
    console.log('Buscá la sección: === FILAS LEÍDAS DEL REPORTE ===\n');

    console.log('\n=== RESUMEN ===');
    console.log('totalOcurrencias (sumados en matriz / plantilla):', data.totalOcurrencias);
    console.log('filas hora en tabla:', data.horas?.length);
    console.log('\nSi filasIteradas ≈ 495 y sumadosEnMatriz es bajo, revisá horarios-sedes.json vs horas reales (muestraHorasFueraPlantilla).');
    console.log('Si filasTrEnDom es ~10–20 y cdkVirtualViewport true, revisá virtual scroll / filas leídas arriba.\n');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
