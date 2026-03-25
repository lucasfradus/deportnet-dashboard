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

export default function ConversionReport({ conversionRows }) {
  return (
    <Grid container spacing={3}>
      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Conversión (Clase de prueba)
          </Typography>

          <TableContainer sx={{ width: '100%' }}>
            <Table size="small" sx={{ width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell>Sede</TableCell>
                  <TableCell align="right">Clase de prueba</TableCell>
                  <TableCell align="right">Convertidos</TableCell>
                  <TableCell align="right">Conversion %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {conversionRows.map((r) => {
                  const sedeShort = String(r.sede || '')
                    .replace(/^CLIC Pilates\s*-\s*/i, '')
                    .replace(/^Pilates\s*-\s*/i, '');

                  const denominador =
                    typeof r.denominador === 'number' && !Number.isNaN(r.denominador)
                      ? r.denominador
                      : 0;
                  const numerador =
                    typeof r.numerador === 'number' && !Number.isNaN(r.numerador)
                      ? r.numerador
                      : 0;

                  const conversionPct =
                    typeof r.conversionPct === 'number' && !Number.isNaN(r.conversionPct)
                      ? `${r.conversionPct.toFixed(2)}%`
                      : '-';

                  return (
                    <TableRow key={r.sede}>
                      <TableCell>{sedeShort}</TableCell>
                      <TableCell align="right">{denominador}</TableCell>
                      <TableCell align="right">{numerador}</TableCell>
                      <TableCell align="right">{conversionPct}</TableCell>
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

