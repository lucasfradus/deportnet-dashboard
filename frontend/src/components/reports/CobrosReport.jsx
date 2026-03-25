import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  Box,
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export default function CobrosReport({ data }) {
  const chartData = useMemo(() => {
    const labelsFull = data.map((r) => r.sede);
    const labelsShort = labelsFull.map((s) =>
      String(s).replace(/^CLIC Pilates\s*-\s*/i, '')
    );

    return {
      labels: labelsShort,
      datasets: [
        {
          label: 'Total cobrado',
          data: data.map((r) => r.montoFacturado),
          backgroundColor: 'rgba(25, 118, 210, 0.5)',
          borderColor: 'rgba(25, 118, 210, 1)',
          borderWidth: 1,
        },
      ],
    };
  }, [data]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const num = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
            const sedeFull = data[ctx.dataIndex]?.sede;
            return `${sedeFull ? `${sedeFull} ` : ''}${formatCurrencyARS(num)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          font: { size: 12 },
          maxRotation: 0,
          minRotation: 0,
          autoSkip: false,
        },
      },
      y: {
        ticks: {
          font: { size: 13 },
          callback: (value) => {
            const num = typeof value === 'number' ? value : Number(value);
            return formatCurrencyARS(num);
          },
        },
      },
    },
  }), [data]);

  const totalGeneral = useMemo(
    () => data.reduce((acc, r) => acc + (r.montoFacturado || 0), 0),
    [data]
  );

  return (
    <Grid container spacing={2}>
      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Gráfico
          </Typography>
          <Box
            sx={{
              bgcolor: 'background.paper',
              p: 1,
              borderRadius: 1,
              width: '100%',
              height: 500,
            }}
          >
            <Bar data={chartData} options={chartOptions} />
          </Box>
        </Paper>
      </Grid>

      <Grid xs={12}>
        <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Tabla
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Total general: {formatCurrencyARS(totalGeneral)}
          </Typography>

          <TableContainer sx={{ width: '100%' }}>
            <Table size="small" sx={{ width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell>Sede</TableCell>
                  <TableCell align="right">Clases de Prueba</TableCell>
                  <TableCell align="right">Total cobrado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.sede}>
                    <TableCell>{r.sede}</TableCell>
                    <TableCell align="right">{r.cantidadClasePrueba ?? 0}</TableCell>
                    <TableCell align="right">
                      {formatCurrencyARS(r.montoFacturado)}
                    </TableCell>
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

