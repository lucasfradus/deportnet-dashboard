const ISO_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(iso) {
  const s = String(iso).trim();
  const m = s.match(ISO_REGEX);
  if (!m) return null;
  const y = Number(m[1], 10);
  const mo = Number(m[2], 10) - 1;
  const d = Number(m[3], 10);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }
  return dt;
}

function startOfTodayLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * Valida rango de búsqueda: YYYY-MM-DD, sin fechas futuras, desde <= hasta.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateSearchDateRange(desde, hasta) {
  const desdeDt = parseLocalDate(desde);
  const hastaDt = parseLocalDate(hasta);
  if (!desdeDt) {
    return { ok: false, error: 'Fecha desde inválida (use YYYY-MM-DD)' };
  }
  if (!hastaDt) {
    return { ok: false, error: 'Fecha hasta inválida (use YYYY-MM-DD)' };
  }
  const today = startOfTodayLocal();
  if (desdeDt > today) {
    return {
      ok: false,
      error: 'La fecha desde no puede ser posterior al día de hoy',
    };
  }
  if (hastaDt > today) {
    return {
      ok: false,
      error: 'La fecha hasta no puede ser posterior al día de hoy',
    };
  }
  if (desdeDt > hastaDt) {
    return {
      ok: false,
      error: 'La fecha desde no puede ser posterior a la fecha hasta',
    };
  }
  return { ok: true };
}

module.exports = { validateSearchDateRange };
