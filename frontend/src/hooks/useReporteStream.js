import { useRef, useState } from 'react';
import locales from '../../../shared/locales.json';
import planesPreciosSedes from '../../../shared/precios-sedes-planes-activos.json';
import { resolveApiStreamUrl } from '../constants/reportDefs';
import { buildOcupacionSkeleton } from '../utils/ocupacionSkeleton';
import { consumeSseStream } from '../utils/consumeSseStream';
import { validarRangoFechasBusqueda, validarRangoFechasOcupacion } from '../utils/fechaBusqueda';

/**
 * Maneja el ciclo de vida completo de un stream SSE para un reporte:
 * estado de datos, progreso, errores, y las acciones generarReporte/cancelar.
 */
export function useReporteStream({ reportId, report, desde, hasta, sedesSeleccionadas }) {
  const [data, setData] = useState([]);
  const [preciosMatrix, setPreciosMatrix] = useState({});
  const [preciosSedesColumnas, setPreciosSedesColumnas] = useState([]);
  const [comparativoRows, setComparativoRows] = useState([]);
  const [conversionRows, setConversionRows] = useState([]);
  const [ocupacionData, setOcupacionData] = useState(null);
  const [ocupacionStepLog, setOcupacionStepLog] = useState([]);
  /** @type {ReturnType<typeof useState<null | { sedesColumnas: string[], planes: string[], matrix: object, erroresPorSede: object, anomaliasPorSede: object, filasPorSede: object, filasDomPorSede: object, sociosUnicosSoloCdpPorSede: object }>>} */
  const [sociosActivos, setSociosActivos] = useState(null);
  const [error, setError] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState({
    processed: 0,
    total: sedesSeleccionadas.length,
    sede: '',
    message: '',
    phase: '',
  });

  const streamCtrlRef = useRef(null);
  const streamingRef = useRef(false);
  const ocupacionPhaseRef = useRef('');

  const cancelar = () => {
    setError(null);
    streamingRef.current = false;
    if (streamCtrlRef.current) {
      try { streamCtrlRef.current.abort(); } catch { /* ignore */ }
      streamCtrlRef.current = null;
    }
    setStreaming(false);
    setProgress({
      processed: 0,
      total: report.sedeMode === 'single' ? 1 : sedesSeleccionadas.length || 0,
      sede: '',
      message: '',
      phase: '',
    });
    setOcupacionStepLog([]);
    setSociosActivos(null);
    ocupacionPhaseRef.current = '';
  };

  const generarReporte = () => {
    if (report.requiresDateRange && (!desde || !hasta)) return;

    if (report.requiresDateRange) {
      const errFechas = report.sedeMode === 'single'
        ? validarRangoFechasOcupacion(desde, hasta)
        : validarRangoFechasBusqueda(desde, hasta);
      if (errFechas) { setError(errFechas); return; }
    }

    if (report.sedeMode === 'single' && sedesSeleccionadas.length !== 1) {
      setError('Seleccioná exactamente una sucursal.');
      return;
    }
    if (reportId === 'socios_activos' && sedesSeleccionadas.length === 0) {
      setError('Seleccioná al menos una sucursal.');
      return;
    }

    // Cancela stream anterior si hay uno corriendo
    cancelar();
    setError(null);

    // Limpia estado del reporte anterior
    setData([]);
    setPreciosMatrix({});
    setPreciosSedesColumnas([]);
    setComparativoRows([]);
    setConversionRows([]);
    setSociosActivos(null);
    setOcupacionStepLog([]);
    ocupacionPhaseRef.current = '';

    if (report.sedeMode === 'single') {
      const sedeUnica = sedesSeleccionadas[0] || '';
      const sk = buildOcupacionSkeleton(sedeUnica, desde, hasta);
      if (!sk) {
        setError('No hay plantilla en shared/horarios-sedes.json para la sucursal seleccionada.');
        setOcupacionData(null);
        return;
      }
      setOcupacionData(sk);
      setProgress({ processed: 0, total: 1, sede: sedeUnica, message: 'Preparando tabla…', phase: 'prep' });
    } else {
      setOcupacionData(null);
      setProgress({ processed: 0, total: sedesSeleccionadas.length || 0, sede: '', message: '', phase: '' });
    }

    if (reportId === 'precios_sedes') {
      const cols = sedesSeleccionadas.length > 0 ? [...sedesSeleccionadas] : [...locales];
      const matrix = {};
      for (const plan of planesPreciosSedes) {
        if (!plan || typeof plan !== 'string') continue;
        matrix[plan] = Object.fromEntries(cols.map((s) => [s, null]));
      }
      setPreciosMatrix(matrix);
      setPreciosSedesColumnas(cols);
    }

    if (reportId === 'socios_activos') {
      setSociosActivos({
        sedesColumnas: [...sedesSeleccionadas],
        planes: [...planesPreciosSedes],
        matrix: {},
        erroresPorSede: {},
        anomaliasPorSede: {},
        filasPorSede: {},
        filasDomPorSede: {},
        sociosUnicosSoloCdpPorSede: {},
      });
    }

    const url = new URL(resolveApiStreamUrl(report.streamUrl));
    if (report.requiresDateRange) {
      url.searchParams.set('desde', desde);
      url.searchParams.set('hasta', hasta);
    }
    if (reportId === 'ocupacion') {
      url.searchParams.set('sede', sedesSeleccionadas[0] || '');
    } else {
      url.searchParams.set('sedes', sedesSeleccionadas.length ? sedesSeleccionadas.join(',') : '');
    }

    const ac = new AbortController();
    streamCtrlRef.current = ac;
    setStreaming(true);
    streamingRef.current = true;

    const handleMessage = (msg) => {
      if (!msg?.type) return;

      if (msg.type === 'connected' && reportId === 'ocupacion') {
        setProgress((prev) => ({
          ...prev,
          message:
            prev.phase === 'prep' && (!prev.message || prev.message.includes('Preparando'))
              ? 'Conectado al servidor…'
              : prev.message,
        }));
      }

      if (msg.type === 'progress') {
        setProgress((prev) => ({
          processed: msg.processed ?? prev.processed,
          total: msg.total ?? prev.total,
          sede: msg.sede != null && String(msg.sede).length > 0 ? msg.sede : prev.sede,
          message: typeof msg.message === 'string' && msg.message.length > 0 ? msg.message : prev.message,
          phase: typeof msg.phase === 'string' && msg.phase.length > 0 ? msg.phase : prev.phase,
        }));

        if (reportId === 'ocupacion' && msg.message) {
          const ph = msg.phase || '';
          const prevPh = ocupacionPhaseRef.current;
          if (ph && ph !== prevPh) {
            ocupacionPhaseRef.current = ph;
            setOcupacionStepLog((p) => [...p.slice(-28), msg.message]);
          } else if (ph === 'procesando' && msg.processed && msg.total) {
            if (msg.processed % 80 === 0 || msg.processed === msg.total) {
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
            { sede: msg.sede, montoFacturado: msg.montoFacturado, cantidadClasePrueba: msg.cantidadClasePrueba ?? 0 },
          ]);
        } else if (reportId === 'precios_sedes') {
          const plan = msg.plan ?? '';
          const sede = msg.sede ?? '';
          if (!plan || !sede) return;
          setPreciosMatrix((prev) => {
            const bySede = prev[plan];
            if (!bySede) return prev;
            return { ...prev, [plan]: { ...bySede, [sede]: msg.precio1 ?? null } };
          });
        } else if (reportId === 'cobros_sede_comparativo') {
          setComparativoRows((prev) => [
            ...prev,
            { sede: msg.sede, periodos: Array.isArray(msg.periodos) ? msg.periodos : [] },
          ]);
        } else if (reportId === 'conversion_clase_prueba') {
          setConversionRows((prev) => [
            ...prev,
            { sede: msg.sede, denominador: msg.denominador ?? 0, numerador: msg.numerador ?? 0, conversionPct: msg.conversionPct ?? null },
          ]);
        } else if (reportId === 'ocupacion' && msg.ocupacion) {
          setOcupacionData({ ...msg.ocupacion, ocupacionStreaming: false });
        } else if (reportId === 'socios_activos' && msg.sociosActivosSede) {
          const p = msg.sociosActivosSede;
          setSociosActivos((prev) => {
            if (!prev) return prev;
            const matrix = { ...prev.matrix };
            const errores = { ...prev.erroresPorSede };
            const anom = { ...prev.anomaliasPorSede };
            const filas = { ...prev.filasPorSede, [p.sede]: p.filasTotales ?? 0 };
            const filasDom = { ...prev.filasDomPorSede };
            const sociosSoloCdp = { ...prev.sociosUnicosSoloCdpPorSede };
            if (!p.error) {
              filasDom[p.sede] = typeof p.filasRawDom === 'number' ? p.filasRawDom : (p.filasTotales ?? 0);
              if (typeof p.sociosUnicosSoloCdpEfectivo === 'number') {
                sociosSoloCdp[p.sede] = p.sociosUnicosSoloCdpEfectivo;
              }
            }
            if (p.error) {
              errores[p.sede] = p.error;
            } else {
              delete errores[p.sede];
              for (const [plan, n] of Object.entries(p.conteosPorPlan || {})) {
                if (!matrix[plan]) matrix[plan] = {};
                matrix[plan] = { ...matrix[plan], [p.sede]: n };
              }
            }
            anom[p.sede] = Array.isArray(p.anomalias) ? p.anomalias : [];
            return { ...prev, matrix, erroresPorSede: errores, anomaliasPorSede: anom, filasPorSede: filas, filasDomPorSede: filasDom, sociosUnicosSoloCdpPorSede: sociosSoloCdp };
          });
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
        setError(msg.error || 'Error generando reporte');
        setStreaming(false);
        streamingRef.current = false;
        if (streamCtrlRef.current === ac) streamCtrlRef.current = null;
        ac.abort();
      }
    };

    void (async () => {
      try {
        await consumeSseStream(url, { signal: ac.signal, onMessage: handleMessage });
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
    reportId === 'ocupacion' &&
    streaming &&
    ['start', 'prep', 'login', 'sucursal', 'reporte', 'fechas', 'buscar', 'tabla'].includes(progress.phase);

  const percent = (() => {
    if (!streaming) return 0;
    if (reportId === 'ocupacion') {
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

  return {
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
  };
}
