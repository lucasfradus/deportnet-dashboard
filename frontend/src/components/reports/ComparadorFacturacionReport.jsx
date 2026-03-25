import {
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { formatCurrencyARS } from '../../utils/formatCurrencyARS';

export default function ComparadorFacturacionReport({ comparativoRows }) {
  const periodLabels = comparativoRows[0]?.periodos?.map((p) => p.label) || [];

  return (
    <Grid container spacing={2}>
      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Cobros Sede (rango por mes)
          </Typography>

          <TableContainer sx={{ width: '100%' }}>
            <Table size="small" sx={{ width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell>Sede</TableCell>
                  {periodLabels.map((label) => (
                    <TableCell key={label} align="right">
                      {label}
                    </TableCell>
                  ))}
                  <TableCell align="right">Variación %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comparativoRows.map((r) => {
                  const periodos = Array.isArray(r.periodos) ? r.periodos : [];
                  const prev = periodos[periodos.length - 2]?.monto;
                  const curr = periodos[periodos.length - 1]?.monto;

                  let varPct = null;
                  if (
                    typeof prev === 'number' &&
                    !Number.isNaN(prev) &&
                    prev !== 0 &&
                    typeof curr === 'number' &&
                    !Number.isNaN(curr)
                  ) {
                    varPct = ((curr - prev) / prev) * 100;
                  }

                  const isUp = typeof varPct === 'number' && varPct > 0;
                  const isDown = typeof varPct === 'number' && varPct < 0;
                  const arrow = isUp ? '^' : isDown ? 'v' : '-';
                  const color = isUp ? '#2e7d32' : isDown ? '#d32f2f' : '#666';

                  return (
                    <TableRow key={r.sede}>
                      <TableCell>{r.sede}</TableCell>
                      {periodLabels.map((_, idx) => {
                        const v = periodos[idx]?.monto ?? null;
                        return (
                          <TableCell key={`${r.sede}_${idx}`} align="right">
                            {typeof v === 'number' && !Number.isNaN(v)
                              ? formatCurrencyARS(v)
                              : '-'}
                          </TableCell>
                        );
                      })}
                      <TableCell align="right">
                        {typeof varPct === 'number' && !Number.isNaN(varPct) ? (
                          <span style={{ color, fontWeight: 700 }}>
                            {arrow} {varPct.toFixed(1)}%
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Grid>
    </Grid>
  );
}

