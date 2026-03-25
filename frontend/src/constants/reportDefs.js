/**
 * URL final del stream SSE.
 * - En `vite` dev: por defecto va directo a Express :4000 (evita 404 si el proxy no aplica).
 * - Opcional: `VITE_API_ORIGIN=https://tu-api.com` en .env
 * - En build producción: mismo origen que la página (asumís /api detrás de nginx) salvo que definas VITE_API_ORIGIN.
 */
export function resolveApiStreamUrl(pathname) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const envOrigin = import.meta.env?.VITE_API_ORIGIN;
  if (envOrigin) {
    return `${String(envOrigin).replace(/\/$/, '')}${p}`;
  }
  if (import.meta.env?.DEV) {
    return `http://localhost:4000${p}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${p}`;
  }
  return p;
}

export const reportDefs = [
  {
    id: 'cobros_quincenal',
    label: 'Cobros',
    streamUrl: '/api/report/quincenal/stream',
  },
  {
    id: 'cobros_sede_comparativo',
    label: 'Comparador de Facturacion',
    streamUrl: '/api/report/cobros-sede-comparativo/stream',
  },
  {
    id: 'precios_sedes',
    label: 'Precios Sedes',
    streamUrl: '/api/report/precios-sedes/stream',
  },
  {
    id: 'conversion_clase_prueba',
    label: 'Conversion',
    streamUrl: '/api/report/conversion-clase-prueba/stream',
  },
  {
    id: 'ocupacion',
    label: 'Ocupación',
    streamUrl: '/api/report/ocupacion/stream',
  },
];
