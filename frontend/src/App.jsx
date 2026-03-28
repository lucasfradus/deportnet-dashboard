import { useState } from 'react';
import { Button, Container, Stack, Tab, Tabs, Typography } from '@mui/material';
import './App.css';

import locales from '../../shared/locales.json';
import planesPreciosSedes from '../../shared/precios-sedes-planes-activos.json';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { reportDefs } from './constants/reportDefs';
import { useReporteStream } from './hooks/useReporteStream';
import { clearToken, isAuthenticated } from './utils/auth';
import LoginPage from './components/LoginPage';
import ReportFilters from './components/ReportFilters';
import LocalesSelector from './components/LocalesSelector';
import CobrosReport from './components/reports/CobrosReport';
import PreciosSedesReport from './components/reports/PreciosSedesReport';
import ComparadorFacturacionReport from './components/reports/ComparadorFacturacionReport';
import ConversionReport from './components/reports/ConversionReport';
import OcupacionMatrixReport from './components/reports/OcupacionMatrixReport';
import SociosActivosReport from './components/reports/SociosActivosReport';
export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={() => { clearToken(); setAuthenticated(false); }} />;
}

function Dashboard({ onLogout }) {
  const [selectedReportId, setSelectedReportId] = useState(reportDefs[0].id);
  const selectedReport = reportDefs.find((r) => r.id === selectedReportId) || reportDefs[0];

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [sedesSeleccionadas, setSedesSeleccionadas] = useState(locales);

  const handleUnauthorized = () => { clearToken(); onLogout(); };

  const {
    data,
    preciosMatrix,
    preciosSedesColumnas,
    comparativoRows,
    conversionRows,
    ocupacionData,
    ocupacionStepLog,
    sociosActivos,
    error,
    streaming,
    progress,
    generarReporte,
    cancelar,
    percent,
    ocupacionIndeterminate,
  } = useReporteStream({ reportId: selectedReportId, report: selectedReport, desde, hasta, sedesSeleccionadas, onUnauthorized: handleUnauthorized });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" fontWeight={700}>
            Reportes
          </Typography>
          <Button variant="outlined" size="small" onClick={onLogout}>
            Cerrar sesión
          </Button>
        </Stack>

        <Tabs
          value={selectedReportId}
          onChange={(_, v) => {
            if (streaming) cancelar();
            if (reportDefs.find((r) => r.id === v)?.sedeMode === 'single') {
              setSedesSeleccionadas((prev) =>
                prev.length ? [prev[0]] : locales.length ? [locales[0]] : []
              );
            }
            setSelectedReportId(v);
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {reportDefs.map((r) => (
            <Tab key={r.id} value={r.id} label={r.label} />
          ))}
        </Tabs>

        <Typography variant="body2" color="text.secondary" sx={{ mb: -1 }}>
          {selectedReport.label}
        </Typography>

        <ReportFilters
          requiresDateRange={selectedReport.requiresDateRange}
          desde={desde}
          hasta={hasta}
          setDesde={setDesde}
          setHasta={setHasta}
          streaming={streaming}
          generarReporte={generarReporte}
          cancelar={cancelar}
          percent={percent}
          progress={progress}
          linearVariant={ocupacionIndeterminate ? 'indeterminate' : 'determinate'}
          stepLog={selectedReport.sedeMode === 'single' ? ocupacionStepLog : []}
          error={error}
          dateRangeHint={selectedReport.dateRangeHint}
          extraGenerateDisabled={
            (selectedReport.sedeMode === 'single' && sedesSeleccionadas.length !== 1) ||
            (selectedReportId === 'socios_activos' && sedesSeleccionadas.length === 0)
          }
        />

        <LocalesSelector
          locales={locales}
          sedesSeleccionadas={sedesSeleccionadas}
          setSedesSeleccionadas={setSedesSeleccionadas}
          streaming={streaming}
          selectionMode={selectedReport.sedeMode}
        />

        {selectedReportId === 'cobros_quincenal' && data.length > 0 && (
          <CobrosReport data={data} />
        )}

        {selectedReportId === 'precios_sedes' && preciosSedesColumnas.length > 0 && (
          <PreciosSedesReport
            planesList={planesPreciosSedes}
            sedesList={preciosSedesColumnas}
            preciosMatrix={preciosMatrix}
          />
        )}

        {selectedReportId === 'cobros_sede_comparativo' && comparativoRows.length > 0 && (
          <ComparadorFacturacionReport comparativoRows={comparativoRows} />
        )}

        {selectedReportId === 'conversion_clase_prueba' && (
          <ConversionReport conversionRows={conversionRows} />
        )}

        {selectedReportId === 'ocupacion' && ocupacionData && (
          <OcupacionMatrixReport
            data={ocupacionData}
            streaming={Boolean(ocupacionData.ocupacionStreaming)}
          />
        )}

        {selectedReportId === 'socios_activos' && sociosActivos?.sedesColumnas?.length > 0 && (
          <SociosActivosReport
            sedesColumnas={sociosActivos.sedesColumnas}
            planes={sociosActivos.planes}
            matrix={sociosActivos.matrix}
            erroresPorSede={sociosActivos.erroresPorSede}
            anomaliasPorSede={sociosActivos.anomaliasPorSede}
            filasPorSede={sociosActivos.filasPorSede}
            filasDomPorSede={sociosActivos.filasDomPorSede}
            sociosUnicosSoloCdpPorSede={sociosActivos.sociosUnicosSoloCdpPorSede}
          />
        )}
      </Stack>
    </Container>
  );
}
