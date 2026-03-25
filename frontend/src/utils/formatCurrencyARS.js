export function formatCurrencyARS(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
}

