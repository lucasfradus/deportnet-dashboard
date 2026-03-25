/** Fecha local en YYYY-MM-DD (coherente con input type="date"). */
export function fechaLocalHoyISO() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/**
 * @returns {string | null} Mensaje de error o null si el rango es válido.
 */
export function validarRangoFechasBusqueda(desde, hasta) {
  const hoy = fechaLocalHoyISO();
  if (desde > hoy) {
    return 'La fecha desde no puede ser posterior al día de hoy';
  }
  if (hasta > hoy) {
    return 'La fecha hasta no puede ser posterior al día de hoy';
  }
  if (desde > hasta) {
    return 'La fecha desde no puede ser posterior a la fecha hasta';
  }
  return null;
}

export const OCUPACION_MAX_DIAS = 15;

function parseIsoLocal(iso) {
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1], 10);
  const mo = Number(m[2], 10) - 1;
  const d = Number(m[3], 10);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/**
 * Ocupación: desde ≤ hasta, máx. 15 días inclusive. Sin tope "hoy" (puede haber turnos futuros).
 * @returns {string | null}
 */
export function validarRangoFechasOcupacion(desde, hasta) {
  if (!desde || !hasta) return 'Indicá fecha desde y hasta';
  if (desde > hasta) {
    return 'La fecha desde no puede ser posterior a la fecha hasta';
  }
  const a = parseIsoLocal(desde);
  const b = parseIsoLocal(hasta);
  if (!a || !b) return 'Fechas inválidas';
  const dias =
    Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (dias > OCUPACION_MAX_DIAS) {
    return `DeportNet permite hasta ${OCUPACION_MAX_DIAS} días por consulta. Este rango tiene ${dias} días (inclusive).`;
  }
  return null;
}
