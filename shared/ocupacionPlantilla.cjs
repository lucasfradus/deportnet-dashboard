'use strict';

/**
 * Lógica única de plantilla ocupación (backend + diagnósticos).
 * Archivo .cjs para require() desde Node sin transpilar.
 */

const fs = require('fs');
const path = require('path');

const DIA_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function normalizeHora(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t || null;
  const h = String(parseInt(m[1], 10)).padStart(2, '0');
  return `${h}:${m[2]}`;
}

function horaSortKey(horaNorm) {
  const m = String(horaNorm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return 9999;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Primer path existente: env, relativo al archivo del reporte, cwd en raíz o en backend/.
 */
function resolveHorariosSedesPath(reportsDir) {
  const candidates = [];
  if (process.env.OCUPACION_HORARIOS_JSON && String(process.env.OCUPACION_HORARIOS_JSON).trim()) {
    candidates.push(String(process.env.OCUPACION_HORARIOS_JSON).trim());
  }
  if (reportsDir) {
    candidates.push(path.join(reportsDir, '..', '..', '..', '..', 'shared', 'horarios-sedes.json'));
  }
  candidates.push(path.join(process.cwd(), 'shared', 'horarios-sedes.json'));
  candidates.push(path.join(process.cwd(), '..', 'shared', 'horarios-sedes.json'));

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return path.resolve(c);
  }
  return path.resolve(
    reportsDir
      ? path.join(reportsDir, '..', '..', '..', '..', 'shared', 'horarios-sedes.json')
      : path.join(process.cwd(), 'shared', 'horarios-sedes.json')
  );
}

function cargarMapaHorariosPorSede(reportsDir) {
  const p = resolveHorariosSedesPath(reportsDir);
  if (!fs.existsSync(p)) {
    throw new Error(`No existe ${p}. Creá shared/horarios-sedes.json con la plantilla por sede.`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (raw.sedes && typeof raw.sedes === 'object' && !Array.isArray(raw.sedes)) {
    return raw.sedes;
  }
  if (raw.sede && raw.horarios && typeof raw.horarios === 'object') {
    return { [String(raw.sede).trim()]: { horarios: raw.horarios } };
  }
  throw new Error(
    'horarios-sedes.json: formato inválido. Usá { "sedes": { "Nombre sucursal": { "horarios": { "lunes": [...], ... } } } } o { "sede", "horarios" }.'
  );
}

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

function plantillaParaSede(sedeNombre, reportsDir) {
  const mapa = cargarMapaHorariosPorSede(reportsDir);
  const want = String(sedeNombre || '').trim();
  let entry = mapa[want];
  if (!entry) {
    const key = Object.keys(mapa).find((k) => k.trim() === want);
    if (key) entry = mapa[key];
  }
  if (!entry || !entry.horarios || typeof entry.horarios !== 'object' || Array.isArray(entry.horarios)) {
    throw new Error(
      `No hay plantilla en horarios-sedes.json para la sucursal "${sedeNombre}". Agregala bajo "sedes" con "horarios": { "lunes": …, … } (no un array vacío).`
    );
  }
  return normalizarHorariosPorDia(entry.horarios);
}

/**
 * Lista de "HH:MM" o mapa { "HH:MM": [ nivel, activo ] }.
 */
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

function resumenDiaParaError(diaVal) {
  if (diaVal == null) return 'ausente';
  if (Array.isArray(diaVal)) return `array(${diaVal.length})`;
  if (typeof diaVal === 'object') return `objeto(${Object.keys(diaVal).length} claves)`;
  return typeof diaVal;
}

function construirPlantillaTabla(horariosPorDia) {
  const slotsPorDia = {};
  for (const dk of DIA_KEYS) {
    slotsPorDia[dk] = slotsDelDia(horariosPorDia[dk]);
  }
  const set = new Set();
  for (const dk of DIA_KEYS) {
    for (const s of slotsPorDia[dk]) {
      set.add(s.horaNorm);
    }
  }
  const horas = Array.from(set).sort((a, b) => horaSortKey(a) - horaSortKey(b));

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
  return { horas, slotValid, slotActivo, nivelClase, matrix, slotsPorDia };
}

module.exports = {
  DIA_KEYS,
  normalizeHora,
  horaSortKey,
  resolveHorariosSedesPath,
  cargarMapaHorariosPorSede,
  plantillaParaSede,
  slotsDelDia,
  construirPlantillaTabla,
  resumenDiaParaError,
};
