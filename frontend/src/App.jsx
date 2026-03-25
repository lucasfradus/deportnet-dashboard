import { useRef, useState } from 'react';
import { Container, Stack, Tab, Tabs, Typography } from '@mui/material';
import './App.css';

import locales from '../../shared/locales.json';
import planesPreciosSedes from '../../shared/precios-sedes-planes-activos.json';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { reportDefs, resolveApiStreamUrl } from './constants/reportDefs';
import ReportFilters from './components/ReportFilters';
import LocalesSelector from './components/LocalesSelector';
import CobrosReport from './components/reports/CobrosReport';
import PreciosSedesReport from './components/reports/PreciosSedesReport';
import ComparadorFacturacionReport from './components/reports/ComparadorFacturacionReport';
import ConversionReport from './components/reports/ConversionReport';
import OcupacionMatrixReport from './components/reports/OcupacionMatrixReport';
import {
  validarRangoFechasBusqueda,
  validarRangoFechasOcupacion,
  OCUPACION_MAX_DIAS,
} from './utils/fechaBusqueda';
import { buildOcupacionSkeleton } from './utils/ocupacionSkeleton';
import { consumeSseStream } from './utils/consumeSseStream';

export default function App() {
  const [selectedReportId, setSelectedReportId] = useState(reportDefs[0].id);
  const selectedReport =
    reportDefs.find((r) => r.id === selectedReportId) || reportDefs[0];

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [sedesSeleccionadas, setSedesSeleccionadas] = useState(locales);

  const [data, setData] = useState([]);
  /** Matriz plan → sede → precio 1 (número o null si no hubo match) */
  const [preciosMatrix, setPreciosMatrix] = useState({});
  /** Orden de columnas (sedes) fijado al iniciar el reporte */
  const [preciosSedesColumnas, setPreciosSedesColumnas] = useState([]);
  const [comparativoRows, setComparativoRows] = useState([]);
  const [conversionRows, setConversionRows] = useState([]);
  const [ocupacionData, setOcupacionData] = useState(null);
  const [ocupacionStepLog, setOcupacionStepLog] = useState([]);
  const [error, setError] = useState(null);

  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState({
    processed: 0,
    total: locales.length,
    sede: '',
    message: '',
    phase: '',
  });

  /** AbortController del fetch SSE (reemplaza EventSource: mejor con proxy Vite y streams largos) */
  const streamCtrlRef = useRef(null);
  const lastStreamMsgAtRef = useRef(0);
  const streamingRef = useRef(false);
  const ocupacionPhaseRef = useRef('');
  const requiresDateRange =
    selectedReportId === 'cobros_quincenal' ||
    selectedReportId === 'cobros_sede_comparativo' ||
    selectedReportId === 'conversion_clase_prueba' ||
    selectedReportId === 'ocupacion';

  const progressTotalForReport = () => {
    if (selectedReportId === 'ocupacion') return 1;
    if (requiresDateRange && selectedReportId !== 'ocupacion') {
      return sedesSeleccionadas.length || 0;
    }
    if (selectedReportId === 'precios_sedes') return sedesSeleccionadas.length || 0;
    return 0;
  };

  const cancelar = () => {
    setError(null);
    streamingRef.current = false;
    if (streamCtrlRef.current) {
      try {
        streamCtrlRef.current.abort();
      } catch (e) {
        void e; // ignore
      }
      streamCtrlRef.current = null;
    }
    lastStreamMsgAtRef.current = 0;
    setStreaming(false);
    setProgress({
      processed: 0,
      total: progressTotalForReport(),
      sede: '',
      message: '',
      phase: '',
    });
    setOcupacionStepLog([]);
    ocupacionPhaseRef.current = '';
  };

  const generarReporte = () => {
    if (requiresDateRange && (!desde || !hasta)) return;

    const reportId = selectedReportId;

    if (requiresDateRange) {
      if (reportId === 'ocupacion') {
        const errOcup = validarRangoFechasOcupacion(desde, hasta);
        if (errOcup) {
          setError(errOcup);
          return;
        }
      } else {
        const errFechas = validarRangoFechasBusqueda(desde, hasta);
        if (errFechas) {
          setError(errFechas);
          return;
        }
      }
    }

    if (reportId === 'ocupacion' && sedesSeleccionadas.length !== 1) {
      setError('Seleccioná exactamente una sucursal.');
      return;
    }

    // Cancelamos si el usuario dispara otra vez.
    cancelar();

    setError(null);
    // Limpiamos el estado del reporte anterior
    setData([]);
    setPreciosMatrix({});
    setPreciosSedesColumnas([]);
    setComparativoRows([]);
    setConversionRows([]);
    setOcupacionStepLog([]);
    ocupacionPhaseRef.current = '';

    if (reportId === 'ocupacion') {
      const sedeUnica = sedesSeleccionadas[0] || '';
      const sk = buildOcupacionSkeleton(sedeUnica, desde, hasta);
      if (!sk) {
        setError('No hay plantilla en shared/horarios-sedes.json para la sucursal seleccionada.');
        setOcupacionData(null);
        return;
      }
      setOcupacionData(sk);
      setProgress({
        processed: 0,
        total: 1,
        sede: sedeUnica,
        message: 'Preparando tabla…',
        phase: 'prep',
      });
    } else {
      setOcupacionData(null);
      setProgress({ processed: 0, total: progressTotalForReport(), sede: '', message: '', phase: '' });
    }
    setStreaming(true);
    streamingRef.current = true;
    lastStreamMsgAtRef.current = Date.now();

    if (reportId === 'precios_sedes') {
      const columnasSedes =
        sedesSeleccionadas.length > 0 ? [...sedesSeleccionadas] : [...locales];
      const matrix = {};
      for (const plan of planesPreciosSedes) {
        if (!plan || typeof plan !== 'string') continue;
        matrix[plan] = Object.fromEntries(columnasSedes.map((s) => [s, null]));
      }
      setPreciosMatrix(matrix);
      setPreciosSedesColumnas(columnasSedes);
    }

    const url = new URL(resolveApiStreamUrl(selectedReport.streamUrl));
    if (requiresDateRange) {
      url.searchParams.set('desde', desde);
      url.searchParams.set('hasta', hasta);
    }
    if (reportId === 'ocupacion') {
      url.searchParams.set('sede', sedesSeleccionadas[0] || '');
    } else {
      // Para respetar "sin sedes", pasamos sedes vacío si no hay selección.
      url.searchParams.set('sedes', sedesSeleccionadas.length ? sedesSeleccionadas.join(',') : '');
    }

    const ac = new AbortController();
    streamCtrlRef.current = ac;

    const handleSseMessage = (msg) => {
      if (!msg || !msg.type) return;
      lastStreamMsgAtRef.current = Date.now();

      if (msg.type === 'connected') {
        if (reportId === 'ocupacion') {
          setProgress((prev) => ({
            ...prev,
            message:
              prev.phase === 'prep' && (!prev.message || prev.message.includes('Preparando'))
                ? 'Conectado al servidor…'
                : prev.message,
          }));
        }
      }

      if (msg.type === 'progress') {
        setProgress((prev) => ({
          processed: msg.processed ?? prev.processed,
          total: msg.total ?? prev.total,
          sede: msg.sede != null && String(msg.sede).length > 0 ? msg.sede : prev.sede,
          message:
            typeof msg.message === 'string' && msg.message.length > 0 ? msg.message : prev.message,
          phase:
            typeof msg.phase === 'string' && msg.phase.length > 0 ? msg.phase : prev.phase,
        }));

        if (reportId === 'ocupacion' && msg.message) {
          const ph = msg.phase || '';
          const prevPh = ocupacionPhaseRef.current;
          if (ph && ph !== prevPh) {
            ocupacionPhaseRef.current = ph;
            setOcupacionStepLog((p) => [...p.slice(-28), msg.message]);
          } else if (ph === 'procesando' && msg.processed && msg.total) {
            const n = msg.processed;
            if (n % 80 === 0 || n === msg.total) {
              setOcupacionStepLog((p) => [...p.slice(-28), msg.message]);
            }
          }
        }
      }

      if (msg.type === 'ocupacion_partial' && reportId === 'ocupacion') {
        setOcupacionData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            matrix: msg.matrix,
            sesionesPorCelda: msg.sesionesPorCelda ?? prev.sesionesPorCelda,
            totalesPorDia: msg.totalesPorDia,
            totalesPorHora: msg.totalesPorHora,
            totalOcurrencias: msg.totalOcurrencias ?? prev.totalOcurrencias,
            ocupacionStreaming: true,
          };
        });
      }

      if (msg.type === 'result') {
        if (reportId === 'cobros_quincenal') {
          setData((prev) => [
            ...prev,
            {
              sede: msg.sede,
              montoFacturado: msg.montoFacturado,
              cantidadClasePrueba: msg.cantidadClasePrueba ?? 0,
            },
          ]);
        } else if (reportId === 'precios_sedes') {
          const plan = msg.plan ?? '';
          const sede = msg.sede ?? '';
          if (!plan || !sede) return;
          setPreciosMatrix((prev) => {
            const bySede = prev[plan];
            if (!bySede) return prev;
            return {
              ...prev,
              [plan]: {
                ...bySede,
                [sede]: msg.precio1 ?? null,
              },
            };
          });
        } else if (reportId === 'cobros_sede_comparativo') {
          setComparativoRows((prev) => [
            ...prev,
            {
              sede: msg.sede,
              periodos: Array.isArray(msg.periodos) ? msg.periodos : [],
            },
          ]);
        } else if (reportId === 'conversion_clase_prueba') {
          setConversionRows((prev) => [
            ...prev,
            {
              sede: msg.sede,
              denominador: msg.denominador ?? 0,
              numerador: msg.numerador ?? 0,
              conversionPct: msg.conversionPct ?? null,
            },
          ]);
        } else if (reportId === 'ocupacion' && msg.ocupacion) {
          setOcupacionData({ ...msg.ocupacion, ocupacionStreaming: false });
        }
      }

      if (msg.type === 'done') {
        setStreaming(false);
        streamingRef.current = false;
        if (streamCtrlRef.current === ac) streamCtrlRef.current = null;
      }

      if (msg.type === 'cancelled') {
        setStreaming(false);
        streamingRef.current = false;
        if (streamCtrlRef.current === ac) streamCtrlRef.current = null;
        ac.abort();
      }

      if (msg.type === 'error') {
        setError(msg.detalle || msg.error || 'Error generando reporte');
        setStreaming(false);
        streamingRef.current = false;
        if (streamCtrlRef.current === ac) streamCtrlRef.current = null;
        ac.abort();
      }
    };

    void (async () => {
      try {
        await consumeSseStream(url, { signal: ac.signal, onMessage: handleSseMessage });
      } catch (e) {
        if (ac.signal.aborted || e?.name === 'AbortError') return;
        if (streamingRef.current) {
          setError(e?.message || 'Error de conexión con el servidor. ¿Está el backend en el puerto 4000?');
        }
      } finally {
        streamingRef.current = false;
        setStreaming(false);
        if (streamCtrlRef.current === ac) streamCtrlRef.current = null;
      }
    })();
  };

  const ocupacionIndeterminate =
    selectedReportId === 'ocupacion' &&
    streaming &&
    ['start', 'prep', 'login', 'sucursal', 'reporte', 'fechas', 'buscar', 'tabla'].includes(
      progress.phase
    );

  const percent = (() => {
    if (!streaming) return 0;
    if (selectedReportId === 'ocupacion') {
      if (progress.phase === 'listo') return 100;
      if (progress.phase === 'procesando' && progress.total > 0) {
        return Math.min(100, Math.round((progress.processed / progress.total) * 100));
      }
      return 0;
    }
    return progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;
  })();

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={2}>
        <Typography variant="h4" fontWeight={700}>
          Reportes
        </Typography>

        <Tabs
          value={selectedReportId}
          onChange={(_, v) => {
            if (streaming) cancelar();
            if (v === 'ocupacion') {
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
          requiresDateRange={requiresDateRange}
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
          stepLog={selectedReportId === 'ocupacion' ? ocupacionStepLog : []}
          error={error}
          dateRangeHint={
            selectedReportId === 'ocupacion'
              ? `DeportNet permite como máximo ${OCUPACION_MAX_DIAS} días por consulta (inclusive entre desde y hasta).`
              : undefined
          }
          extraGenerateDisabled={
            selectedReportId === 'ocupacion' && sedesSeleccionadas.length !== 1
          }
        />

        <LocalesSelector
          locales={locales}
          sedesSeleccionadas={sedesSeleccionadas}
          setSedesSeleccionadas={setSedesSeleccionadas}
          streaming={streaming}
          selectionMode={selectedReportId === 'ocupacion' ? 'single' : 'multiple'}
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

        {selectedReportId === 'cobros_sede_comparativo' &&
          comparativoRows.length > 0 && (
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
      </Stack>
    </Container>
  );
}
