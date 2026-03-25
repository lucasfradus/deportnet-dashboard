import { Alert, Box, Button, Grid, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import TextFieldDate from './TextFieldDate';
import { fechaLocalHoyISO } from '../utils/fechaBusqueda';

export default function ReportFilters({
  requiresDateRange,
  desde,
  hasta,
  setDesde,
  setHasta,
  streaming,
  generarReporte,
  cancelar,
  percent,
  progress,
  error,
  /** 'determinate' | 'indeterminate' — ocupación usa indeterminate hasta tener filas */
  linearVariant = 'determinate',
  /** Pasos detallados (ocupación): se muestran debajo de la barra */
  stepLog = [],
  /** Texto opcional bajo los campos de fecha (ej. límite de 15 días) */
  dateRangeHint,
  /** Deshabilitar "Generar" aunque las fechas estén (ej. falta elegir una sede) */
  extraGenerateDisabled = false,
}) {
  const fechaMaxBusqueda = fechaLocalHoyISO();

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Grid container spacing={2} alignItems="flex-end">
          {requiresDateRange && (
            <>
              <Grid item xs={12} md={3}>
                <TextFieldDate
                  label="Fecha desde"
                  value={desde}
                  onChange={setDesde}
                  disabled={streaming}
                  max={fechaMaxBusqueda}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextFieldDate
                  label="Fecha hasta"
                  value={hasta}
                  onChange={setHasta}
                  disabled={streaming}
                  max={fechaMaxBusqueda}
                />
              </Grid>
            </>
          )}
          {requiresDateRange && dateRangeHint && (
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                {dateRangeHint}
              </Typography>
            </Grid>
          )}
          <Grid item xs={12} md={6}>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                variant="contained"
                onClick={generarReporte}
                disabled={
                  streaming ||
                  (requiresDateRange && (!desde || !hasta)) ||
                  extraGenerateDisabled
                }
              >
                {streaming ? 'Generando...' : 'Generar reporte'}
              </Button>
              <Button
                variant="outlined"
                onClick={cancelar}
                disabled={!streaming}
              >
                Cancelar
              </Button>
            </Stack>
          </Grid>
        </Grid>

        {streaming && (
          <Box>
            <LinearProgress variant={linearVariant} value={linearVariant === 'determinate' ? percent : undefined} />
            {progress.message && (
              <Typography variant="body2" color="primary" fontWeight={600} sx={{ mt: 1 }}>
                {progress.message}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {progress.phase === 'procesando' && progress.total > 0
                ? `${progress.sede || '…'} · ${progress.processed} / ${progress.total}`
                : `Sucursal: ${progress.sede || '…'}`}
            </Typography>
            {stepLog.length > 0 && (
              <Box
                component="ul"
                sx={{
                  m: 0,
                  mt: 1,
                  pl: 2,
                  maxHeight: 160,
                  overflow: 'auto',
                  fontSize: 12,
                  color: 'text.secondary',
                }}
              >
                {stepLog.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
                ))}
              </Box>
            )}
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
}

