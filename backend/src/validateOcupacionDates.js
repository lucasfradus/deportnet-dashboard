const MAX_DIAS_INCLUSIVE = 15;

const ISO_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalISO(iso) {
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

function diffDaysInclusive(desdeDt, hastaDt) {
  const a = new Date(
    desdeDt.getFullYear(),
    desdeDt.getMonth(),
    desdeDt.getDate()
  ).getTime();
  const b = new Date(
    hastaDt.getFullYear(),
    hastaDt.getMonth(),
    hastaDt.getDate()
  ).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Ocupación: solo YYYY-MM-DD, desde ≤ hasta, máx. 15 días inclusive.
 * No limitamos a "hoy": DeportNet puede mostrar turnos futuros y el usuario usa ejemplos futuros.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateOcupacionDateRange(desde, hasta) {
  const desdeDt = parseLocalISO(desde);
  const hastaDt = parseLocalISO(hasta);
  if (!desdeDt) {
    return { ok: false, error: 'Fecha desde inválida (use YYYY-MM-DD)' };
  }
  if (!hastaDt) {
    return { ok: false, error: 'Fecha hasta inválida (use YYYY-MM-DD)' };
  }
  if (desdeDt > hastaDt) {
    return {
      ok: false,
      error: 'La fecha desde no puede ser posterior a la fecha hasta',
    };
  }
  const dias = diffDaysInclusive(desdeDt, hastaDt);
  if (dias > MAX_DIAS_INCLUSIVE) {
    return {
      ok: false,
      error: `DeportNet solo permite hasta ${MAX_DIAS_INCLUSIVE} días por consulta. Tu rango tiene ${dias} días (desde/hasta inclusive).`,
    };
  }
  return { ok: true };
}

module.exports = { validateOcupacionDateRange, MAX_DIAS_INCLUSIVE };
