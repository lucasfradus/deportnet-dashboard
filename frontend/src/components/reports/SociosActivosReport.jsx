import { useMemo, useState } from 'react';
import {
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';

/**
 * @param {object} props
 * @param {string[]} props.sedesColumnas orden de columnas por sucursal
 * @param {string[]} props.planes ordenados
 * @param {Record<string, Record<string, number>>} props.matrix plan → sede → cantidad
 * @param {Record<string, string>} props.erroresPorSede
 * @param {Record<string, { texto: string, cantidad: number }[]>} props.anomaliasPorSede
 * @param {Record<string, number>} props.filasPorSede socios únicos procesados (post dedupe)
 * @param {Record<string, number>} [props.filasDomPorSede] filas <tr> en el DOM (puede ser el doble si hay duplicados)
 * @param {Record<string, number>} [props.sociosUnicosSoloCdpPorSede] solo CDP sin fidelizar (ver texto cabecera), por sede
 */

/** @typedef {'asc' | 'desc'} SortDir */

/**
 * @param {string} orderBy 'plan' | 'total' | `sede:${string}`
 * @param {SortDir} order
 */
function comparePlanesForMatrix(pa, pb, orderBy, order, sedesColumnas, matrix, erroresPorSede) {
  const mult = order === 'asc' ? 1 : -1;
  const valSede = (plan, sede) => {
    if (erroresPorSede[sede]) return null;
    return matrix[plan]?.[sede] ?? 0;
  };
  const cmpNum = (va, vb) => {
    const aNull = va === null;
    const bNull = vb === null;
    if (aNull && bNull) return pa.localeCompare(pb, 'es', { sensitivity: 'base' });
    if (aNull) return 1;
    if (bNull) return -1;
    if (va !== vb) return mult * (va < vb ? -1 : 1);
    return pa.localeCompare(pb, 'es', { sensitivity: 'base' });
  };

  if (orderBy === 'plan') {
    return mult * pa.localeCompare(pb, 'es', { sensitivity: 'base' });
  }
  if (orderBy === 'total') {
    const ta = sedesColumnas.reduce((acc, s) => acc + (valSede(pa, s) ?? 0), 0);
    const tb = sedesColumnas.reduce((acc, s) => acc + (valSede(pb, s) ?? 0), 0);
    if (ta !== tb) return mult * (ta < tb ? -1 : 1);
    return pa.localeCompare(pb, 'es', { sensitivity: 'base' });
  }
  if (orderBy.startsWith('sede:')) {
    const sede = orderBy.slice(5);
    return cmpNum(valSede(pa, sede), valSede(pb, sede));
  }
  return 0;
}

function AnomaliasTable({ sede, list }) {
  const [orderBy, setOrderBy] = useState(/** @type {'cantidad' | 'texto'} */ ('cantidad'));
  const [order, setOrder] = useState(/** @type {SortDir} */ ('desc'));

  const sorted = useMemo(() => {
    const copy = [...list];
    const mult = order === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      if (orderBy === 'texto') {
        const c = a.texto.localeCompare(b.texto, 'es', { sensitivity: 'base' });
        if (c !== 0) return mult * c;
        return mult * (a.cantidad < b.cantidad ? -1 : a.cantidad > b.cantidad ? 1 : 0);
      }
      if (a.cantidad !== b.cantidad) return mult * (a.cantidad < b.cantidad ? -1 : 1);
      return a.texto.localeCompare(b.texto, 'es', { sensitivity: 'base' });
    });
    return copy;
  }, [list, order, orderBy]);

  const requestSort = (col) => {
    const isAsc = orderBy === col && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(col);
  };

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" fontWeight={600}>
        {sede}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>
              <TableSortLabel
                active={orderBy === 'texto'}
                direction={orderBy === 'texto' ? order : 'asc'}
                onClick={() => requestSort('texto')}
              >
                Servicio/Membresía (original)
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 600, width: 100 }}>
              <TableSortLabel
                active={orderBy === 'cantidad'}
                direction={orderBy === 'cantidad' ? order : 'asc'}
                onClick={() => requestSort('cantidad')}
              >
                Socios
              </TableSortLabel>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={`${sede}-${row.texto}`}>
              <TableCell sx={{ fontSize: 13, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                {row.texto}
              </TableCell>
              <TableCell align="right">{row.cantidad}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

export default function SociosActivosReport({
  sedesColumnas,
  planes,
  matrix,
  erroresPorSede = {},
  anomaliasPorSede = {},
  filasPorSede = {},
  filasDomPorSede = {},
  sociosUnicosSoloCdpPorSede = {},
}) {
  const [matrixOrderBy, setMatrixOrderBy] = useState(/** @type {string} */ ('plan'));
  const [matrixOrder, setMatrixOrder] = useState(/** @type {SortDir} */ ('asc'));

  const totalClientes = useMemo(
    () => sedesColumnas.reduce((acc, s) => acc + (filasPorSede[s] ?? 0), 0),
    [sedesColumnas, filasPorSede]
  );

  const totalSociosSoloCdp = useMemo(
    () =>
      sedesColumnas.reduce((acc, s) => acc + (sociosUnicosSoloCdpPorSede[s] ?? 0), 0),
    [sedesColumnas, sociosUnicosSoloCdpPorSede]
  );

  const sociosUnicosSinCdp = Math.max(0, totalClientes - totalSociosSoloCdp);

  const tieneResumenCabecera = sedesColumnas.some((s) => typeof filasPorSede[s] === 'number');

  if (!sedesColumnas?.length) return null;

  const totalPlan = (plan) =>
    sedesColumnas.reduce((acc, sede) => acc + (matrix[plan]?.[sede] ?? 0), 0);

  const totalSede = (sede) =>
    planes.reduce((acc, plan) => acc + (matrix[plan]?.[sede] ?? 0), 0);

  const granTotal = planes.reduce((acc, plan) => acc + totalPlan(plan), 0);

  const sortedPlanes = useMemo(() => {
    const copy = [...planes];
    copy.sort((pa, pb) =>
      comparePlanesForMatrix(pa, pb, matrixOrderBy, matrixOrder, sedesColumnas, matrix, erroresPorSede)
    );
    return copy;
  }, [planes, matrixOrderBy, matrixOrder, sedesColumnas, matrix, erroresPorSede]);

  const requestMatrixSort = (property) => {
    const isAsc = matrixOrderBy === property && matrixOrder === 'asc';
    setMatrixOrder(isAsc ? 'desc' : 'asc');
    setMatrixOrderBy(property);
  };

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
          Socios activos por plan
        </Typography>
        {tieneResumenCabecera ? (
          <Stack spacing={0.75} sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1">
              Socios únicos: <strong>{totalClientes}</strong>
            </Typography>
            <Typography variant="subtitle1">
              Solo CDP sin fidelizar: <strong>{totalSociosSoloCdp}</strong>
            </Typography>
            <Typography variant="subtitle1">
              Socios únicos sin CDP: <strong>{sociosUnicosSinCdp}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Socios únicos:</strong> clientes distintos usando <em>email</em> cuando la fila trae correo (así no
              mezclamos homónimos); si no hay email, el nombre de la columna «Nombre» o «Socio», normalizado.
              <strong>Solo CDP sin fidelizar:</strong> tras colapsar duplicados del mismo cliente con el mismo texto de
              servicio, queda un único servicio no vacío y es clase de prueba (CDP Efectivo/Transferencia y variantes).
              Las filas con servicio vacío no cuentan como segundo plan. <strong>Sin CDP:</strong> socios únicos menos
              solo CDP sin fidelizar. Varios locales: suma por sede.
            </Typography>
          </Stack>
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          La tabla cuenta <strong>clientes por plan</strong> (agrupados por email/socio): si alguien tiene dos planes
          activos, suma en ambas columnas. Solo entran servicios que matchean{' '}
          <code>shared/precios-sedes-planes-activos.json</code> (misma lógica que Precios sedes). El resto aparece abajo
          como anomalía. Fuente:{' '}
          <a href="https://deportnet.com/reportMembersWithValidActivities" target="_blank" rel="noreferrer">
            reportMembersWithValidActivities
          </a>
          .
        </Typography>

        <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 480 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, minWidth: 220 }}>
                  <TableSortLabel
                    active={matrixOrderBy === 'plan'}
                    direction={matrixOrderBy === 'plan' ? matrixOrder : 'asc'}
                    onClick={() => requestMatrixSort('plan')}
                  >
                    Plan (normalizado)
                  </TableSortLabel>
                </TableCell>
                {sedesColumnas.map((s) => {
                  const key = `sede:${s}`;
                  return (
                    <TableCell key={s} align="center" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <TableSortLabel
                        active={matrixOrderBy === key}
                        direction={matrixOrderBy === key ? matrixOrder : 'asc'}
                        onClick={() => requestMatrixSort(key)}
                      >
                        {s}
                      </TableSortLabel>
                    </TableCell>
                  );
                })}
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  <TableSortLabel
                    active={matrixOrderBy === 'total'}
                    direction={matrixOrderBy === 'total' ? matrixOrder : 'asc'}
                    onClick={() => requestMatrixSort('total')}
                  >
                    Σ
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedPlanes.map((plan) => (
                <TableRow key={plan}>
                  <TableCell sx={{ whiteSpace: 'normal', maxWidth: 360 }}>{plan}</TableCell>
                  {sedesColumnas.map((sede) => {
                    const err = erroresPorSede[sede];
                    const n = matrix[plan]?.[sede];
                    return (
                      <TableCell key={`${plan}-${sede}`} align="center">
                        {err ? (
                          <Typography variant="caption" color="error">
                            —
                          </Typography>
                        ) : n != null && n > 0 ? (
                          n
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {totalPlan(plan)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>Σ por sucursal</TableCell>
                {sedesColumnas.map((sede) => {
                  const err = erroresPorSede[sede];
                  return (
                    <TableCell key={`sum-${sede}`} align="center" sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>
                      {err ? (
                        <Typography variant="caption" color="error" title={err}>
                          error
                        </Typography>
                      ) : (
                        totalSede(sede)
                      )}
                    </TableCell>
                  );
                })}
                <TableCell align="center" sx={{ fontWeight: 700, bgcolor: 'grey.200' }}>
                  {granTotal}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {sedesColumnas.some((s) => (filasPorSede[s] ?? 0) > 0 || erroresPorSede[s]) && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Filas leídas por sucursal
          </Typography>
          <Stack spacing={0.5}>
            {sedesColumnas.map((s) => {
              const unicas = filasPorSede[s] ?? 0;
              const dom =
                typeof filasDomPorSede[s] === 'number' ? filasDomPorSede[s] : unicas;
              const dupNote = dom > unicas ? ` (${dom} filas en la tabla; duplicados en DOM omitidos del conteo)` : '';
              return (
              <Typography key={s} variant="body2" color="text.secondary">
                <strong>{s}</strong>: {unicas} socios únicos{dupNote}
                {erroresPorSede[s] ? (
                  <Typography component="span" variant="caption" color="error" sx={{ ml: 1 }}>
                    ({erroresPorSede[s]})
                  </Typography>
                ) : null}
              </Typography>
            );
            })}
          </Stack>
        </Paper>
      )}

      {sedesColumnas.some((s) => (anomaliasPorSede[s] || []).length > 0) && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Textos de servicio sin patrón esperado (revisar en DeportNet)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            No matchearon ninguna entrada del catálogo de planes. Revisá el nombre en DeportNet o agregá el plan al
            JSON.
          </Typography>
          <Stack spacing={2}>
            {sedesColumnas.map((sede) => {
              const list = anomaliasPorSede[sede] || [];
              if (!list.length) return null;
              return <AnomaliasTable key={sede} sede={sede} list={list} />;
            })}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
