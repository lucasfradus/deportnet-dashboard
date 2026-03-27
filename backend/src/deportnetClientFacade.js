const { obtenerReporteQuincenal } = require('./deportnet/reports/reporteCobrosQuincenal');
const { obtenerReporteCobrosComparativoSede } = require('./deportnet/reports/reporteCobrosComparativoSede');
const { obtenerPreciosSedes } = require('./deportnet/reports/reportePreciosSedes');
const { obtenerReporteConversionClasesPrueba } = require('./deportnet/reports/reporteConversionClasesPrueba');
const { obtenerReporteOcupacionClases } = require('./deportnet/reports/reporteOcupacionClases');
const { obtenerReporteSociosActivos } = require('./deportnet/reports/reporteSociosActivos');

module.exports = {
  obtenerReporteQuincenal,
  obtenerReporteCobrosComparativoSede,
  obtenerPreciosSedes,
  obtenerReporteConversionClasesPrueba,
  obtenerReporteOcupacionClases,
  obtenerReporteSociosActivos,
};

