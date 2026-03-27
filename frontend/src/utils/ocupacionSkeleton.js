import horarios from '../../../shared/horarios-sedes.json';

const DIA_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIA_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function normalizarHorariosPorDia(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const inner = raw.horarios;
  if (
    inner &&
    typeof inner === 'object' &&
    !Array.isArray(inner) &&
    DIA_KEYS.some((k) => Object.prototype.hasOwnProperty.call(inner, k))
  ) {
    return inner;
  }
  return raw;
}

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

/** Misma lógica que el backend (reporteOcupacionClases). */
function slotsDelDia(diaVal) {
  if (Array.isArray(diaVal)) {
    return diaVal
      .map((t) => {
        const horaNorm = normalizeHora(t);
        return horaNorm ? { horaNorm, nivel: null, activo: true } : null;
      })
      .filter(Boolean);
  }
  if (diaVal && typeof diaVal === 'object') {
    const out = [];
    for (const [rawKey, meta] of Object.entries(diaVal)) {
      const horaNorm = normalizeHora(rawKey);
      if (!horaNorm) continue;
      let nivel = null;
      let activo = true;
      if (Array.isArray(meta)) {
        if (meta[0] != null && String(meta[0]).trim() !== '') nivel = String(meta[0]).trim();
        if (meta.length >= 2) activo = Boolean(meta[1]);
      } else if (meta && typeof meta === 'object') {
        if (meta.nivel != null && String(meta.nivel).trim() !== '') nivel = String(meta.nivel).trim();
        activo = meta.activo !== false;
      }
      out.push({ horaNorm, nivel, activo });
    }
    return out;
  }
  return [];
}

/**
 * Misma lógica que el backend (plantilla vacía) para mostrar la grilla al instante al generar.
 */
export function buildOcupacionSkeleton(sede, desde, hasta) {
  const entry = horarios.sedes?.[sede];
  if (!entry?.horarios || Array.isArray(entry.horarios)) return null;

  const hPorDia = normalizarHorariosPorDia(entry.horarios);
  const slotsPorDia = {};
  for (const dk of DIA_KEYS) {
    slotsPorDia[dk] = slotsDelDia(hPorDia[dk]);
  }

  const set = new Set();
  for (const dk of DIA_KEYS) {
    for (const s of slotsPorDia[dk]) {
      set.add(s.horaNorm);
    }
  }
  const horas = Array.from(set).sort((a, b) => horaSortKey(a) - horaSortKey(b));
  if (!horas.length) return null;

  const slotValid = horas.map((h) =>
    DIA_KEYS.map((dk) => slotsPorDia[dk].some((s) => s.horaNorm === h))
  );

  const slotActivo = horas.map((h) =>
    DIA_KEYS.map((dk) => {
      const found = slotsPorDia[dk].find((s) => s.horaNorm === h);
      return found ? found.activo : false;
    })
  );

  const nivelClase = horas.map((h) =>
    DIA_KEYS.map((dk) => {
      const found = slotsPorDia[dk].find((s) => s.horaNorm === h);
      return found?.nivel ?? null;
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
    slotActivo,
    nivelClase,
    totalesPorDia,
    totalesPorHora,
    totalOcurrencias: 0,
    plantillaArchivo: 'shared/horarios-sedes.json',
    ocupacionStreaming: true,
  };
}
