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

function formatPrecio1(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? formatCurrencyARS(v) : '—';
}

/**
 * Filas = planes en precios-sedes-planes-activos.json
 * Columnas = sedes
 * Celdas = Precio 1 del concepto matcheado en DeportNet
 */
export default function PreciosSedesReport({ planesList, sedesList, preciosMatrix }) {
  const planes = Array.isArray(planesList)
    ? planesList.filter((p) => typeof p === 'string' && p.trim().length)
    : [];

  return (
    <Grid container spacing={2}>
      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Precios Sedes
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Una fila por servicio en <code>precios-sedes-planes-activos.json</code>. Cada columna es una
            sede; el valor es <strong>Precio 1</strong> del concepto activo en{' '}
            <a href="https://deportnet.com/reportConcepts" target="_blank" rel="noreferrer">
              reportConcepts
            </a>
            .
          </Typography>
          <TableContainer sx={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 400 }}>
              <TableHead>
                <TableRow>
                  <TableCell
                    sx={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      bgcolor: 'background.paper',
                      fontWeight: 700,
                      minWidth: 220,
                      boxShadow: 1,
                    }}
                  >
                    Servicio / plan
                  </TableCell>
                  {sedesList.map((sede) => (
                    <TableCell
                      key={sede}
                      align="right"
                      sx={{ fontWeight: 700, whiteSpace: 'nowrap', minWidth: 120 }}
                    >
                      {sede}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {planes.map((plan) => (
                  <TableRow key={plan}>
                    <TableCell
                      sx={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        bgcolor: 'background.paper',
                        maxWidth: 320,
                        boxShadow: 1,
                      }}
                    >
                      {plan}
                    </TableCell>
                    {sedesList.map((sede) => {
                      const v = preciosMatrix[plan]?.[sede];
                      return (
                        <TableCell key={`${plan}|${sede}`} align="right">
                          {formatPrecio1(v)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Grid>
    </Grid>
  );
}
