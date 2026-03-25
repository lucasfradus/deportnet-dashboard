import {
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
} from '@mui/material';

/** Si hubo socios en la celda, asumimos al menos 1 clase (evita % vacío si falla el conteo de fechas). */
function sesionesEfectivas(socios, sesionesReportadas) {
  if (socios <= 0) return 0;
  const s = Number(sesionesReportadas) || 0;
  return Math.max(s, 1);
}

function pctOcupacion(socios, sesiones, cap) {
  const ses = sesionesEfectivas(socios, sesiones);
  const capTotal = ses * cap;
  if (capTotal <= 0) return socios === 0 ? 0 : null;
  return Math.min(100, (socios / capTotal) * 100);
}

function cellBgPct(pct, disabled) {
  if (disabled) return 'grey.200';
  if (pct == null || !Number.isFinite(pct)) return 'action.hover';
  const t = Math.min(1, pct / 100);
  return `rgba(25, 118, 210, ${0.12 + t * 0.55})`;
}

function formatPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
}

export default function OcupacionMatrixReport({ data, streaming = false }) {
  if (!data || !Array.isArray(data.horas)) return null;

  if (data.horas.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body1">
          No hay filas de horario en la plantilla (<code>shared/horarios-sedes.json</code>) para esta sede, o no hubo
          datos en el rango elegido. Revisá el JSON, las fechas (máx. 15 días) y que la sucursal coincida con el
          nombre en DeportNet.
        </Typography>
      </Paper>
    );
  }

  const {
    sede,
    desde,
    hasta,
    diasLabels,
    horas,
    matrix,
    sesionesPorCelda,
    capacidadPorTurno = 10,
    slotValid,
    totalOcurrencias,
    plantillaArchivo,
  } = data;

  const cap = Number(capacidadPorTurno) > 0 ? Number(capacidadPorTurno) : 10;

  const matrixSafe = horas.map((_, i) => {
    const row = Array.isArray(matrix?.[i]) ? matrix[i] : [];
    return Array.from({ length: 7 }, (_, j) => Number(row[j]) || 0);
  });

  const sesionesSafe = horas.map((_, i) => {
    const row = Array.isArray(sesionesPorCelda?.[i]) ? sesionesPorCelda[i] : [];
    return Array.from({ length: 7 }, (_, j) => Number(row[j]) || 0);
  });

  let capacidadTotal = 0;
  for (let i = 0; i < horas.length; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      if (slotValid && slotValid[i]?.[j] === false) continue;
      const socios = matrixSafe[i]?.[j] ?? 0;
      const ses = sesionesEfectivas(socios, sesionesSafe[i][j]);
      capacidadTotal += ses * cap;
    }
  }

  const pctGlobal =
    capacidadTotal > 0
      ? Math.min(100, ((totalOcurrencias ?? 0) / capacidadTotal) * 100)
      : (totalOcurrencias ?? 0) === 0
        ? 0
        : null;

  const pctFila = (i) => {
    let socios = 0;
    let capSum = 0;
    for (let j = 0; j < 7; j += 1) {
      if (slotValid && slotValid[i]?.[j] === false) continue;
      const c = matrixSafe[i]?.[j] ?? 0;
      socios += c;
      capSum += sesionesEfectivas(c, sesionesSafe[i][j]) * cap;
    }
    if (capSum <= 0) return socios === 0 ? 0 : null;
    return Math.min(100, (socios / capSum) * 100);
  };

  const pctCol = (j) => {
    let socios = 0;
    let capSum = 0;
    for (let i = 0; i < horas.length; i += 1) {
      if (slotValid && slotValid[i]?.[j] === false) continue;
      const c = matrixSafe[i]?.[j] ?? 0;
      socios += c;
      capSum += sesionesEfectivas(c, sesionesSafe[i][j]) * cap;
    }
    if (capSum <= 0) return socios === 0 ? 0 : null;
    return Math.min(100, (socios / capSum) * 100);
  };

  return (
    <Grid container spacing={2}>
      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
            <Typography variant="h6" fontWeight={700}>
              Ocupación por día y horario
            </Typography>
            {streaming && <Chip size="small" color="primary" label="Actualizando celdas…" />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            <strong>{sede}</strong> · {desde} → {hasta}. Cada celda muestra el porcentaje de cupos ocupados respecto de
            las clases dictadas en ese día y horario en el período: se consideran hasta <strong>{cap} socios</strong>{' '}
            por clase. La grilla sigue <strong>{plantillaArchivo || 'shared/horarios-sedes.json'}</strong>; las celdas
            grises son horarios que no ofrecés ese día. Fuente:{' '}
            <a href="https://deportnet.com/branchMembersClassesReport" target="_blank" rel="noreferrer">
              branchMembersClassesReport
            </a>
            .
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Ocupación global del período: <strong>{formatPct(pctGlobal)}</strong>
            {typeof totalOcurrencias === 'number' ? (
              <>
                {' '}
                · <strong>{totalOcurrencias}</strong> filas de socio/clase contabilizadas
              </>
            ) : null}
          </Typography>

          <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 520 }}>
              <TableHead>
                <TableRow>
                  <TableCell
                    sx={{ fontWeight: 700, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}
                  >
                    Hora
                  </TableCell>
                  {(diasLabels || []).map((d) => (
                    <TableCell key={d} align="center" sx={{ fontWeight: 700, minWidth: 56 }}>
                      {d}
                    </TableCell>
                  ))}
                  <TableCell align="center" sx={{ fontWeight: 700 }}>
                    Σ
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {horas.map((hora, i) => (
                  <TableRow key={hora}>
                    <TableCell
                      sx={{
                        fontWeight: 600,
                        position: 'sticky',
                        left: 0,
                        bgcolor: 'background.paper',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {hora}
                    </TableCell>
                    {(matrixSafe[i] || []).map((socios, j) => {
                      const enabled = !slotValid || slotValid[i]?.[j] !== false;
                      const sesiones = sesionesSafe[i][j] ?? 0;
                      const pct = enabled ? pctOcupacion(socios, sesiones, cap) : null;
                      const sesTitulo = sesionesEfectivas(socios, sesiones);
                      const title = enabled
                        ? socios > 0
                          ? `${socios} socios · ${sesTitulo} ${sesTitulo === 1 ? 'clase' : 'clases'} · cap. ${sesTitulo * cap}`
                          : 'Sin socios en este día/hora'
                        : undefined;
                      return (
                        <TableCell
                          key={`${hora}-${j}`}
                          align="center"
                          title={title}
                          sx={{
                            bgcolor: cellBgPct(pct, !enabled),
                            fontWeight: pct && pct > 0 ? 600 : 400,
                            color: !enabled ? 'text.disabled' : 'inherit',
                          }}
                        >
                          {!enabled ? '—' : formatPct(pct)}
                        </TableCell>
                      );
                    })}
                    <TableCell align="center" sx={{ fontWeight: 700 }} title="Promedio ponderado por cupo en la fila">
                      {formatPct(pctFila(i))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, position: 'sticky', left: 0, bgcolor: 'grey.100' }}>
                    Σ
                  </TableCell>
                  {(diasLabels || []).map((_, j) => (
                    <TableCell
                      key={`sum-d-${j}`}
                      align="center"
                      sx={{ fontWeight: 700, bgcolor: 'grey.100' }}
                      title="Promedio ponderado por cupo en la columna"
                    >
                      {formatPct(pctCol(j))}
                    </TableCell>
                  ))}
                  <TableCell
                    align="center"
                    sx={{ fontWeight: 700, bgcolor: 'grey.200' }}
                    title="Ocupación global del período"
                  >
                    {formatPct(pctGlobal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Grid>
    </Grid>
  );
}
