import horarios from '../../../shared/horarios-sedes.json';

const DIA_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIA_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function normalizeHora(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = String(parseInt(m[1], 10)).padStart(2, '0');
  return `${h}:${m[2]}`;
}

function horaSortKey(horaNorm) {
  const m = String(horaNorm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return 9999;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Misma lógica que el backend (plantilla vacía) para mostrar la grilla al instante al generar.
 */
export function buildOcupacionSkeleton(sede, desde, hasta) {
  const entry = horarios.sedes?.[sede];
  if (!entry?.horarios) return null;

  const hPorDia = entry.horarios;
  const set = new Set();
  for (const dk of DIA_KEYS) {
    const arr = hPorDia[dk];
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      const n = normalizeHora(t);
      if (n) set.add(n);
    }
  }
  const horas = Array.from(set).sort((a, b) => horaSortKey(a) - horaSortKey(b));
  if (!horas.length) return null;

  const slotValid = horas.map((h) =>
    DIA_KEYS.map((dk) => {
      const arr = hPorDia[dk];
      if (!Array.isArray(arr)) return false;
      return arr.some((t) => normalizeHora(t) === h);
    })
  );

  const matrix = horas.map(() => [0, 0, 0, 0, 0, 0, 0]);
  const sesionesPorCelda = horas.map(() => [0, 0, 0, 0, 0, 0, 0]);
  const totalesPorDia = [0, 0, 0, 0, 0, 0, 0];
  const totalesPorHora = horas.map(() => 0);

  return {
    sede,
    desde,
    hasta,
    diasLabels: DIA_LABELS,
    horas,
    matrix,
    sesionesPorCelda,
    capacidadPorTurno: 10,
    slotValid,
    totalesPorDia,
    totalesPorHora,
    totalOcurrencias: 0,
    plantillaArchivo: 'shared/horarios-sedes.json',
    ocupacionStreaming: true,
  };
}
