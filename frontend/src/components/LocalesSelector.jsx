import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

export default function LocalesSelector({
  locales,
  sedesSeleccionadas,
  setSedesSeleccionadas,
  streaming,
  /** 'multiple' | 'single' — en single solo una sucursal por ejecución */
  selectionMode = 'multiple',
}) {
  const single = selectionMode === 'single';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography fontWeight={700}>Locales</Typography>
            <Typography variant="body2" color="text.secondary">
              {single
                ? 'Elegí una sucursal'
                : `Seleccionados: ${sedesSeleccionadas.length} / ${locales.length}`}
            </Typography>
          </Box>

          {!single && (
            <Stack direction="row" spacing={1}>
              <Button
                onClick={() => setSedesSeleccionadas(locales)}
                disabled={streaming}
              >
                Todos
              </Button>
              <Button
                onClick={() => setSedesSeleccionadas([])}
                disabled={streaming}
              >
                Limpiar
              </Button>
            </Stack>
          )}
        </Stack>

        <Grid container spacing={1}>
          {locales.map((sede) => {
            const checked = sedesSeleccionadas.includes(sede);
            return (
              <Grid item xs={12} sm={6} md={4} key={sede}>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={checked}
                      disabled={streaming}
                      onChange={(e) => {
                        if (single) {
                          if (e.target.checked) {
                            setSedesSeleccionadas([sede]);
                          }
                          return;
                        }
                        if (e.target.checked) {
                          setSedesSeleccionadas((prev) =>
                            Array.from(new Set([...prev, sede]))
                          );
                        } else {
                          setSedesSeleccionadas((prev) =>
                            prev.filter((x) => x !== sede)
                          );
                        }
                      }}
                    />
                  )}
                  label={<Typography variant="body2">{sede}</Typography>}
                />
              </Grid>
            );
          })}
        </Grid>
      </Stack>
    </Paper>
  );
}

