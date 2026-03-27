import { OCUPACION_MAX_DIAS } from '../utils/fechaBusqueda';

/**
 * URL final del stream SSE.
 * - Dev y preview: usa window.location.origin (ej. :5173), el proxy de Vite reenvía /api/* a :4000.
 * - Producción: mismo origen que la página (asumís /api detrás de nginx).
 * - Opcional: VITE_API_ORIGIN=https://tu-api.com en .env para apuntar a otro servidor.
 */
export function resolveApiStreamUrl(pathname) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const envOrigin = import.meta.env?.VITE_API_ORIGIN;
  if (envOrigin) {
    return `${String(envOrigin).replace(/\/$/, '')}${p}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${p}`;
  }
  return p;
}

/**
 * @typedef {Object} ReportDef
 * @property {string} id
 * @property {string} label
 * @property {string} streamUrl
 * @property {boolean} requiresDateRange - Si el reporte necesita filtro desde/hasta.
 * @property {'single' | 'multiple'} sedeMode - Si acepta una o varias sedes.
 * @property {string} [dateRangeHint] - Texto de ayuda opcional bajo el selector de fechas.
 */

/** @type {ReportDef[]} */
export const reportDefs = [
  {
    id: 'cobros_quincenal',
    label: 'Cobros',
    streamUrl: '/api/report/quincenal/stream',
    requiresDateRange: true,
    sedeMode: 'multiple',
  },
  {
    id: 'cobros_sede_comparativo',
    label: 'Comparador de Facturacion',
    streamUrl: '/api/report/cobros-sede-comparativo/stream',
    requiresDateRange: true,
    sedeMode: 'multiple',
  },
  {
    id: 'precios_sedes',
    label: 'Precios Sedes',
    streamUrl: '/api/report/precios-sedes/stream',
    requiresDateRange: false,
    sedeMode: 'multiple',
  },
  {
    id: 'conversion_clase_prueba',
    label: 'Conversion',
    streamUrl: '/api/report/conversion-clase-prueba/stream',
    requiresDateRange: true,
    sedeMode: 'multiple',
  },
  {
    id: 'ocupacion',
    label: 'Ocupación',
    streamUrl: '/api/report/ocupacion/stream',
    requiresDateRange: true,
    sedeMode: 'single',
    dateRangeHint: `DeportNet permite como máximo ${OCUPACION_MAX_DIAS} días por consulta (inclusive entre desde y hasta).`,
  },
  {
    id: 'socios_activos',
    label: 'Socios activos',
    streamUrl: '/api/report/socios-activos/stream',
    requiresDateRange: false,
    sedeMode: 'multiple',
  },
];
