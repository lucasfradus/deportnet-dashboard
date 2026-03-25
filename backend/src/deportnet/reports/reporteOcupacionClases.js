const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { login, selectSucursal, setFechaRango } = require('../deportnetActions');
const { DEBUG_DIR } = require('../deportnetReaders');

/**
 * Reporte oficial DeportNet (misma ruta que en el navegador).
 * Probamos también variante en mayúscula por si el servidor es case-sensitive.
 */
const REPORT_URLS = [
  'https://deportnet.com/branchMembersClassesReport',
  'https://deportnet.com/BranchMembersClassesReport',
];

const DIA_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Cupos por turno/clase para calcular % de ocupación (configurable por env). */
const CAPACIDAD_MAX_POR_TURNO =
  Number.parseInt(String(process.env.OCUPACION_CAPACIDAD_TURNO || '10'), 10) || 10;

/** Claves en horarios-sedes.json (lunes=0 … domingo=6, alineado con lunesIndexFromDate). */
const DIA_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function pathHorariosSedes() {
  return path.join(__dirname, '../../../../shared/horarios-sedes.json');
}

/**
 * Acepta:
 * - { sedes: { "Nombre": { horarios: { lunes: [...], ... } } } }
 * - { sede: "Nombre", horarios: { ... } } (una sola sede)
 */
function cargarMapaHorariosPorSede() {
  const p = pathHorariosSedes();
  if (!fs.existsSync(p)) {
    throw new Error(`No existe ${p}. Creá shared/horarios-sedes.json con la plantilla por sede.`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (raw.sedes && typeof raw.sedes === 'object' && !Array.isArray(raw.sedes)) {
    return raw.sedes;
  }
  if (raw.sede && raw.horarios && typeof raw.horarios === 'object') {
    return { [String(raw.sede).trim()]: { horarios: raw.horarios } };
  }
  throw new Error(
    'horarios-sedes.json: formato inválido. Usá { "sedes": { "Nombre sucursal": { "horarios": { "lunes": [...], ... } } } } o { "sede", "horarios" }.'
  );
}

function plantillaParaSede(sedeNombre) {
  const mapa = cargarMapaHorariosPorSede();
  const entry = mapa[sedeNombre];
  if (!entry || !entry.horarios || typeof entry.horarios !== 'object') {
    throw new Error(
      `No hay plantilla en horarios-sedes.json para la sucursal "${sedeNombre}". Agregala bajo "sedes".`
    );
  }
  return entry.horarios;
}

/**
 * Filas = unión de todos los horarios de la plantilla (HH:MM normalizado), ordenadas.
 * slotValid[i][j] = true si ese horario está definido para ese día en el JSON.
 */
function construirPlantillaTabla(horariosPorDia) {
  const set = new Set();
  for (const dk of DIA_KEYS) {
    const arr = horariosPorDia[dk];
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      const n = normalizeHora(t);
      if (n) set.add(n);
    }
  }
  const horas = Array.from(set).sort((a, b) => horaSortKey(a) - horaSortKey(b));

  const slotValid = horas.map((h) =>
    DIA_KEYS.map((dk) => {
      const arr = horariosPorDia[dk];
      if (!Array.isArray(arr)) return false;
      return arr.some((t) => normalizeHora(t) === h);
    })
  );

  const matrix = horas.map(() => [0, 0, 0, 0, 0, 0, 0]);
  return { horas, slotValid, matrix };
}

function lunesIndexFromDate(dt) {
  return (dt.getDay() + 6) % 7;
}

function parseFechaDMY(s) {
  const raw = String(s || '').trim();
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function normalizeHora(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t || null;
  const h = String(parseInt(m[1], 10)).padStart(2, '0');
  return `${h}:${m[2]}`;
}

function horaSortKey(horaNorm) {
  const m = String(horaNorm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return 9999;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Layout fijo DeportNet branchMembersClassesReport:
 * 0 Profesor, 1 Servicio/Membresía, 2 Actividad, 3 Fecha, 4 Hora, 5 Utilizado, 6 Socio
 */
const LAYOUT_7_FECHA_HORA = { fechaIdx: 3, horaIdx: 4, utilizadoIdx: 5 };

/** Si una sola celda trae la fila separada por tabs (copiar/pegar), la partimos. */
function normalizarCeldasFila(cells) {
  const out = [];
  for (const c of cells) {
    const s = String(c ?? '');
    if (s.includes('\t') && s.split('\t').filter(Boolean).length >= 5) {
      out.push(...s.split('\t').map((x) => x.trim()));
    } else {
      out.push(s.trim());
    }
  }
  return out;
}

/** Detecta índices por contenido: primera celda con fecha dd/mm/aaaa y primera con hora HH:MM. */
function inferColumnIndicesFromCells(cells) {
  let fechaIdx = -1;
  let horaIdx = -1;
  for (let i = 0; i < cells.length; i += 1) {
    const c = String(cells[i] ?? '').trim();
    if (fechaIdx < 0 && parseFechaDMY(c)) fechaIdx = i;
    if (horaIdx < 0 && /^\d{1,2}:\d{2}/.test(c)) horaIdx = i;
  }
  if (fechaIdx >= 0 && horaIdx >= 0 && fechaIdx !== horaIdx) {
    return { fechaIdx, horaIdx, utilizadoIdx: cells.length >= 6 ? 5 : -1 };
  }
  if (cells.length >= 7) {
    return { ...LAYOUT_7_FECHA_HORA };
  }
  return null;
}

/** Solo nombres exactos (evita matchear "Membresía" u otros textos por error). */
function mapOcupacionColumnsFromHeaders(headerTexts) {
  const headers = headerTexts.map((t) => String(t).replace(/\s+/g, ' ').trim());
  const fechaIdx = headers.findIndex((h) => /^fecha$/i.test(h));
  const horaIdx = headers.findIndex((h) => /^hora$/i.test(h));
  const utilizadoIdx = headers.findIndex((h) => /^utilizado$/i.test(h));
  if (fechaIdx < 0 || horaIdx < 0 || fechaIdx === horaIdx) {
    throw new Error(
      `Ocupación: encabezados Fecha/Hora no encontrados. Encabezados: ${JSON.stringify(headers)}`
    );
  }
  return { fechaIdx, horaIdx, utilizadoIdx };
}

function resolverIndicesColumnas(headerTexts, sampleCells) {
  const cells = sampleCells ? normalizarCeldasFila(sampleCells) : [];
  if (cells.length && filaPareceDatos(cells)) {
    const inf = inferColumnIndicesFromCells(cells);
    if (inf) return { cols: inf, source: 'inferido_datos' };
  }
  if (headerTexts && headerTexts.length) {
    try {
      return { cols: mapOcupacionColumnsFromHeaders(headerTexts), source: 'encabezados' };
    } catch (_) {}
  }
  if (cells.length >= 7) {
    return { cols: { ...LAYOUT_7_FECHA_HORA }, source: 'layout_7_fijo' };
  }
  return null;
}

function applyTdShift(cols, shift) {
  if (!shift || shift < 0) return cols;
  return {
    fechaIdx: cols.fechaIdx + shift,
    horaIdx: cols.horaIdx + shift,
    utilizadoIdx: cols.utilizadoIdx >= 0 ? cols.utilizadoIdx + shift : cols.utilizadoIdx,
  };
}

async function findFirstDataRowWithMinCells(rowLocator, cellSel, minCells) {
  const n = await rowLocator.count();
  for (let i = 0; i < n; i++) {
    const row = rowLocator.nth(i);
    const cells = await row.locator(cellSel).allTextContents().catch(() => []);
    if (cells.length >= minCells) {
      return { cellCount: cells.length, cells };
    }
  }
  return null;
}

async function findBestOcupacionTable(page) {
  const tables = page.locator('table');
  const n = await tables.count();
  let best = { score: -1, table: null };
  for (let i = 0; i < n; i++) {
    const t = tables.nth(i);
    let score = 0;
    const th = await t.locator('thead tr th, tr.mat-header-row th, tr.mat-mdc-header-row th').allTextContents().catch(() => []);
    const thJoined = th.map((x) => String(x));
    if (thJoined.some((h) => /fecha/i.test(h)) && thJoined.some((h) => /hora/i.test(h))) score += 10;

    const bodyText = await t.innerText().catch(() => '');
    const dateHits = (bodyText.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || []).length;
    score += Math.min(dateHits, 30);

    if (score > best.score) best = { score, table: t };
  }
  if (best.table && best.score > 0) return best.table;
  return tables.first();
}

async function readHeaderTexts(table) {
  const selectors = [
    () => table.locator('thead tr').first().locator('th'),
    () => table.locator('thead tr th'),
    () => table.locator('tr.mat-header-row th, tr.mat-mdc-header-row th').first(),
    () => table.locator('tbody tr').first().locator('th'),
  ];
  for (const getLoc of selectors) {
    try {
      const loc = getLoc();
      const list = await loc.allTextContents();
      if (list && list.length) {
        return list.map((t) => String(t).replace(/\s+/g, ' ').trim());
      }
    } catch (_) {}
  }
  return [];
}

/**
 * Abre el reporte y deja trazas.
 * Debe llamarse **después** de `selectSucursal` (igual que conversión/cobros): si no, el formulario con #dateFrom no está en el DOM.
 */
async function abrirReporteBranchMembersClasses(page, log) {
  let lastError = null;
  for (const url of REPORT_URLS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2000);
    } catch (e) {
      lastError = e;
      continue;
    }

    const actual = page.url();
    log.push(`goto: ${url}`);
    log.push(`url_final: ${actual}`);

    const enLogin =
      (await page.getByPlaceholder('Correo electrónico').isVisible().catch(() => false)) ||
      (await page.getByRole('button', { name: 'Entrar' }).isVisible().catch(() => false));

    if (enLogin) {
      log.push('error: pantalla de login (sesión no válida en este contexto)');
      lastError = new Error('Al abrir el reporte se mostró el login. Revisá credenciales o cookies.');
      continue;
    }

    const pareceReporte =
      /branchmembersclassesreport/i.test(actual) ||
      (await page
        .getByText(/profesor|servicio\/membres/i)
        .first()
        .isVisible()
        .catch(() => false));

    if (pareceReporte) {
      log.push('ok: página del reporte reconocida');
      return;
    }

    log.push('advertencia: URL sin "branchMembersClassesReport" pero se continúa (SPA con routing interno)');
    return;
  }
  throw lastError || new Error('No se pudo abrir branchMembersClassesReport');
}

/** Toda la lógica de selectores vive en deportnetActions.setFechaRango (name, formcontrolname, placeholders, etc.). */
async function setFechasBranchReport(page, desdeISO, hastaISO) {
  await setFechaRango(page, desdeISO, hastaISO);
}

async function marcarReporteDetallado(page) {
  const tries = [
    async () => {
      const cb = page.getByRole('checkbox', { name: /reporte\s*detallado|detallado/i });
      await cb.first().waitFor({ state: 'attached', timeout: 6000 });
      if (!(await cb.first().isChecked().catch(() => false))) {
        await cb.first().click({ force: true });
      }
    },
    async () => {
      const lab = page.locator('label').filter({ hasText: /reporte\s*detallado|detallado/i }).first();
      await lab.waitFor({ state: 'visible', timeout: 5000 });
      await lab.click({ force: true });
    },
  ];
  for (const t of tries) {
    try {
      await t();
      await page.waitForTimeout(300);
      return;
    } catch (_) {}
  }
}

async function ejecutarBusquedaReporte(page) {
  const clicks = [
    () => page.getByRole('button', { name: /buscar|consultar|aplicar|generar/i }).first().click(),
    () => page.getByRole('link', { name: /buscar|consultar/i }).first().click(),
    () => page.locator('input[type="submit"][value*="Buscar" i]').first().click(),
    () => page.locator('button[type="submit"]').first().click(),
  ];
  for (const fn of clicks) {
    try {
      await fn();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      return;
    } catch (_) {}
  }
}

function filaPareceDatos(cells) {
  const joined = cells.join(' ');
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(joined) && /\d{1,2}:\d{2}/.test(joined);
}

/**
 * Resuelve filas/celdas: HTML clásico o Angular Material (mat-row / mat-cell).
 */
async function resolveRowsAndCells(table) {
  const cellSel = 'td, mat-cell, td.mat-mdc-cell, td.mat-cell';

  let rowLocator = table.locator('tbody tr');
  let n = await rowLocator.count();

  if (n === 0) {
    rowLocator = table.locator('tbody tr.mat-mdc-row, tbody tr.mat-row, tbody tr[mat-row]');
    n = await rowLocator.count();
  }

  if (n === 0) {
    rowLocator = table.locator('tr.mat-mdc-row, tr.mat-row, tr[mat-row]');
    n = await rowLocator.count();
  }

  return { rowLocator, cellSel, rowCount: n };
}

/**
 * Angular Material + CDK suele renderizar solo ~10–20 filas en el DOM.
 * Sin hacer scroll, Playwright ve pocas filas aunque el reporte tenga cientos.
 * @returns {string[][]|null} filas como arrays de celdas, o null si no hay viewport virtual.
 */
async function recolectarFilasConVirtualScroll(page, rowLocator, cellSel) {
  const vp = page.locator('cdk-virtual-scroll-viewport').first();
  if ((await vp.count()) === 0) return null;

  const seen = new Set();
  const rows = [];

  const captureVisible = async () => {
    const n = await rowLocator.count();
    for (let r = 0; r < n; r += 1) {
      const raw = await rowLocator.nth(r).locator(cellSel).allTextContents().catch(() => []);
      const cells = normalizarCeldasFila(raw);
      if (!filaPareceDatos(cells)) continue;
      const key = cells.join('|#|');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(cells);
    }
  };

  await vp.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await captureVisible();

  for (let i = 0; i < 2500; i += 1) {
    const done = await vp.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 3
    );
    if (done) break;
    await vp.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollTop + Math.max(48, Math.floor(el.clientHeight * 0.35)), el.scrollHeight);
    });
    await page.waitForTimeout(35);
    await captureVisible();
  }

  await vp.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(200);
  await captureVisible();

  return rows;
}

function procesarCeldasOcupacion(cells, cols, horariosPlantilla, horaToRow) {
  const out = {
    ok: false,
    reason: '',
    dow: null,
    horaNorm: null,
    rowIdx: null,
  };
  if (cells.length < Math.max(cols.fechaIdx, cols.horaIdx) + 1) {
    out.reason = 'short_cells';
    return out;
  }
  if (!filaPareceDatos(cells)) {
    out.reason = 'no_patron_fecha_hora';
    return out;
  }
  const fechaRaw = String(cells[cols.fechaIdx] ?? '').trim();
  const horaRaw = String(cells[cols.horaIdx] ?? '').trim();
  if (!fechaRaw || !horaRaw) {
    out.reason = 'fecha_hora_vacias';
    return out;
  }
  const dt = parseFechaDMY(fechaRaw);
  const horaNorm = normalizeHora(horaRaw);
  if (!dt || !horaNorm) {
    out.reason = 'parse_fecha_hora';
    return out;
  }
  const dow = lunesIndexFromDate(dt);
  const diaKey = DIA_KEYS[dow];
  const slotsDia = Array.isArray(horariosPlantilla[diaKey])
    ? horariosPlantilla[diaKey].map((t) => normalizeHora(t)).filter(Boolean)
    : [];
  if (!slotsDia.includes(horaNorm)) {
    out.reason = 'fuera_plantilla';
    out.dow = dow;
    out.horaNorm = horaNorm;
    return out;
  }
  const rowIdx = horaToRow.get(horaNorm);
  if (rowIdx === undefined) {
    out.reason = 'fuera_plantilla_fila';
    out.horaNorm = horaNorm;
    return out;
  }
  out.ok = true;
  out.dow = dow;
  out.horaNorm = horaNorm;
  out.rowIdx = rowIdx;
  out.fechaKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
  return out;
}

async function obtenerReporteOcupacionClases({ desde, hasta, sede, isCancelled, emit: emitRaw }) {
  if (!sede || !String(sede).trim()) {
    throw new Error('Ocupación: indicá una sucursal.');
  }

  const sedeStr = String(sede).trim();
  const emit =
    typeof emitRaw === 'function'
      ? (payload) => {
          try {
            emitRaw(payload);
          } catch (_) {
            /* ignore */
          }
        }
      : () => {};

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  const navLog = [];

  try {
    emit({
      type: 'progress',
      phase: 'login',
      message: 'Conectando a DeportNet…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    await login(page);

    emit({
      type: 'progress',
      phase: 'sucursal',
      message: 'Seleccionando sucursal…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    // Mismo orden que reporteConversion / cobros: sucursal primero, luego URL del reporte (si no, no aparecen #dateFrom / #dateTo).
    await selectSucursal(page, sede);
    await page.waitForTimeout(1500);

    emit({
      type: 'progress',
      phase: 'reporte',
      message: 'Abriendo reporte de clases…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    await abrirReporteBranchMembersClasses(page, navLog);
    await page.waitForTimeout(1500);

    emit({
      type: 'progress',
      phase: 'fechas',
      message: 'Aplicando fechas y opciones…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    // Filtros de fecha (datepicker jQuery en DeportNet)
    await page
      .locator(
        '#dateFrom,#dateTo,input[name="dateFrom"],input[name="dateTo"],input[formcontrolname="dateFrom"],input[formcontrolname="dateTo"]'
      )
      .first()
      .waitFor({ state: 'attached', timeout: 45000 })
      .catch(() => {});

    await setFechasBranchReport(page, desde, hasta);
    await marcarReporteDetallado(page);

    emit({
      type: 'progress',
      phase: 'buscar',
      message: 'Buscando datos en DeportNet…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    await ejecutarBusquedaReporte(page);

    emit({
      type: 'progress',
      phase: 'tabla',
      message: 'Esperando resultados en la tabla…',
      processed: 0,
      total: 1,
      sede: sedeStr,
    });
    await page
      .locator('td, mat-cell')
      .filter({ hasText: /\d{1,2}\/\d{1,2}\/\d{4}/ })
      .first()
      .waitFor({ state: 'attached', timeout: 60000 })
      .catch(() => {});

    const table = await findBestOcupacionTable(page);
    let headerTexts = await readHeaderTexts(table);
    const { rowLocator, cellSel, rowCount: initialRowCount } = await resolveRowsAndCells(table);

    let sampleForInfer = null;
    for (let i = 0; i < Math.min(initialRowCount, 15); i += 1) {
      const raw = await rowLocator.nth(i).locator(cellSel).allTextContents().catch(() => []);
      const cells = normalizarCeldasFila(raw);
      if (filaPareceDatos(cells)) {
        sampleForInfer = cells;
        break;
      }
    }

    const resolved = resolverIndicesColumnas(headerTexts, sampleForInfer);
    if (!resolved) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const debugBase = path.join(DEBUG_DIR, `ocupacion_${ts}_header_fail`);
      await page.screenshot({ path: `${debugBase}.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(
        `${debugBase}.txt`,
        JSON.stringify(
          { navLog, headerTexts, sampleForInfer, initialRowCount },
          null,
          2
        ),
        'utf8'
      );
      throw new Error(
        'Ocupación: no se pudieron detectar columnas Fecha/Hora (sin filas de datos reconocibles).'
      );
    }

    let { cols } = resolved;
    const colSource = resolved.source;

    const hdrLen = headerTexts.length;
    const sample = await findFirstDataRowWithMinCells(
      rowLocator,
      cellSel,
      Math.max(cols.horaIdx + 1, 4)
    );
    let tdShift = 0;
    if (
      colSource === 'encabezados' &&
      sample &&
      hdrLen > 0 &&
      sample.cellCount > hdrLen
    ) {
      tdShift = sample.cellCount - hdrLen;
      cols = applyTdShift(cols, tdShift);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const debugBase = path.join(DEBUG_DIR, `ocupacion_${ts}`);
    const totalTrDom = await rowLocator.count();
    const tieneViewportVirtual = (await page.locator('cdk-virtual-scroll-viewport').count()) > 0;
    let rowsCells = null;
    let usoRecoleccionVirtual = false;
    if (tieneViewportVirtual) {
      rowsCells = await recolectarFilasConVirtualScroll(page, rowLocator, cellSel);
      usoRecoleccionVirtual = true;
    }

    const sampleRows = [];
    const sampleN = Math.min(usoRecoleccionVirtual ? rowsCells.length : totalTrDom, 8);
    for (let i = 0; i < sampleN; i += 1) {
      if (usoRecoleccionVirtual) {
        sampleRows.push(rowsCells[i]);
      } else {
        const raw = await rowLocator.nth(i).locator(cellSel).allTextContents().catch(() => []);
        sampleRows.push(normalizarCeldasFila(raw));
      }
    }

    fs.writeFileSync(
      `${debugBase}.txt`,
      JSON.stringify(
        {
          reporte: 'branchMembersClassesReport',
          navLog,
          sede,
          url_final: page.url(),
          headerTexts,
          hdrLen,
          tdShift,
          colSource,
          cols,
          rowCountDom: totalTrDom,
          tieneViewportVirtual,
          filasRecolectadasVirtual: usoRecoleccionVirtual ? rowsCells.length : null,
          cellSel,
          sampleRows,
        },
        null,
        2
      ),
      'utf8'
    );
    await page.screenshot({ path: `${debugBase}.png`, fullPage: true }).catch(() => {});

    const horariosPlantilla = plantillaParaSede(sede);
    const { horas, slotValid, matrix } = construirPlantillaTabla(horariosPlantilla);
    if (!horas.length) {
      throw new Error(
        `Plantilla vacía en horarios-sedes.json para "${sede}": agregá al menos un horario en algún día.`
      );
    }
    const horaToRow = new Map(horas.map((h, i) => [h, i]));
    const fechasUnicasPorCelda = horas.map(() =>
      Array.from({ length: 7 }, () => new Set())
    );

    const totalFilas = usoRecoleccionVirtual ? rowsCells.length : totalTrDom;
    emit({
      type: 'progress',
      phase: 'datos',
      message: `${totalFilas} ${totalFilas === 1 ? 'dato obtenido' : 'datos obtenidos'}`,
      processed: 0,
      total: Math.max(1, totalFilas),
      sede: sedeStr,
    });

    const diagnostico = {
      modoLectura: usoRecoleccionVirtual ? 'virtual_scroll' : 'dom_filas',
      filasTrEnDom: totalTrDom,
      cdkVirtualViewport: tieneViewportVirtual,
      filasIteradas: 0,
      skippedShortCells: 0,
      skippedNoPatron: 0,
      skippedFechaHoraVacias: 0,
      skippedParse: 0,
      skippedFueraPlantilla: 0,
      sumadosEnMatriz: 0,
      muestraHorasFueraPlantilla: [],
      /** Primeras filas leídas (texto TAB); el .txt puede traer más líneas */
      muestraPrimerasFilas: [],
      muestraUltimasFilas: [],
      lineasVolcadasEnArchivo: 0,
    };

    const maxLineasArchivo = Math.min(
      8000,
      Math.max(
        50,
        Number.parseInt(String(process.env.OCUPACION_DEBUG_MAX_FILAS || '2500'), 10) || 2500
      )
    );
    const lineasReporteTexto = [];

    let totalOcurrencias = 0;
    let skippedParse = 0;
    let skippedFueraPlantilla = 0;

    const totalesPorDia = [0, 0, 0, 0, 0, 0, 0];
    const totalesPorHora = horas.map(() => 0);

    const pushMuestraFuera = (horaNorm) => {
      if (!horaNorm || diagnostico.muestraHorasFueraPlantilla.length >= 12) return;
      if (!diagnostico.muestraHorasFueraPlantilla.includes(horaNorm)) {
        diagnostico.muestraHorasFueraPlantilla.push(horaNorm);
      }
    };

    const emitPartial = (processedRows) => {
      emit({
        type: 'ocupacion_partial',
        matrix: matrix.map((row) => [...row]),
        sesionesPorCelda: fechasUnicasPorCelda.map((row) => row.map((s) => s.size)),
        totalesPorDia: [...totalesPorDia],
        totalesPorHora: [...totalesPorHora],
        totalOcurrencias,
        processedRows,
        totalRows: totalFilas,
      });
    };

    const procesarUnaFila = (cells) => {
      diagnostico.filasIteradas += 1;
      if (lineasReporteTexto.length < maxLineasArchivo) {
        const linea = cells
          .map((c) =>
            String(c ?? '')
              .replace(/\r?\n/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          )
          .join('\t');
        lineasReporteTexto.push(linea);
      }
      const pr = procesarCeldasOcupacion(cells, cols, horariosPlantilla, horaToRow);
      if (pr.reason === 'short_cells') {
        diagnostico.skippedShortCells += 1;
        return;
      }
      if (pr.reason === 'no_patron_fecha_hora') {
        diagnostico.skippedNoPatron += 1;
        return;
      }
      if (pr.reason === 'fecha_hora_vacias') {
        diagnostico.skippedFechaHoraVacias += 1;
        return;
      }
      if (pr.reason === 'parse_fecha_hora') {
        skippedParse += 1;
        diagnostico.skippedParse += 1;
        return;
      }
      if (pr.reason === 'fuera_plantilla' || pr.reason === 'fuera_plantilla_fila') {
        skippedFueraPlantilla += 1;
        diagnostico.skippedFueraPlantilla += 1;
        pushMuestraFuera(pr.horaNorm);
        return;
      }
      if (pr.ok && pr.rowIdx != null && pr.dow != null) {
        matrix[pr.rowIdx][pr.dow] += 1;
        fechasUnicasPorCelda[pr.rowIdx][pr.dow].add(
          pr.fechaKey || `${String(cells[cols.fechaIdx] ?? '').trim()}`
        );
        totalOcurrencias += 1;
        diagnostico.sumadosEnMatriz += 1;
        totalesPorDia[pr.dow] += 1;
        totalesPorHora[pr.rowIdx] += 1;
      }
    };

    const debeEmitirMatriz = (idx) => {
      if (totalFilas <= 200) return true;
      if (idx % 4 === 0 || idx === totalFilas) return true;
      return false;
    };

    if (usoRecoleccionVirtual) {
      for (let r = 0; r < rowsCells.length; r += 1) {
        if (typeof isCancelled === 'function' && isCancelled()) break;
        procesarUnaFila(rowsCells[r]);
        const idx = r + 1;
        emit({
          type: 'progress',
          phase: 'procesando',
          message: `Procesando ${idx} de ${totalFilas}`,
          processed: idx,
          total: Math.max(1, totalFilas),
          sede: sedeStr,
        });
        if (debeEmitirMatriz(idx)) emitPartial(idx);
      }
    } else {
      for (let r = 0; r < totalTrDom; r += 1) {
        if (typeof isCancelled === 'function' && isCancelled()) break;
        const raw = await rowLocator.nth(r).locator(cellSel).allTextContents().catch(() => []);
        const cells = normalizarCeldasFila(raw);
        procesarUnaFila(cells);
        const idx = r + 1;
        emit({
          type: 'progress',
          phase: 'procesando',
          message: `Procesando ${idx} de ${totalFilas}`,
          processed: idx,
          total: Math.max(1, totalFilas),
          sede: sedeStr,
        });
        if (debeEmitirMatriz(idx)) emitPartial(idx);
      }
    }

    if (totalFilas === 0) {
      emit({
        type: 'progress',
        phase: 'procesando',
        message: 'No hay filas en la tabla para el rango',
        processed: 0,
        total: 1,
        sede: sedeStr,
      });
      emitPartial(0);
    }

    diagnostico.esperadoDeportNet495Referencia =
      'Si DeportNet muestra ~495 filas y filasIteradas es mucho menor, suele ser virtual scroll (ahora se intenta recorrer).';
    diagnostico.archivoDebug = debugBase;
    diagnostico.lineasVolcadasEnArchivo = lineasReporteTexto.length;
    diagnostico.maxLineasArchivoConfig = maxLineasArchivo;
    diagnostico.muestraPrimerasFilas = lineasReporteTexto.slice(0, 45);
    diagnostico.muestraUltimasFilas =
      lineasReporteTexto.length > 55 ? lineasReporteTexto.slice(-8) : [];

    const bloqueLineas = [
      '',
      '=== FILAS LEÍDAS DEL REPORTE (una por línea, celdas separadas por TAB) ===',
      `filasProcesadas=${diagnostico.filasIteradas} lineasVolcadasAqui=${lineasReporteTexto.length} maxConfig=${maxLineasArchivo} (subí con OCUPACION_DEBUG_MAX_FILAS=5000)`,
      '',
      ...lineasReporteTexto,
      '',
    ].join('\n');

    fs.appendFileSync(
      `${debugBase}.txt`,
      `${bloqueLineas}\nstats: sumadosEnMatriz=${totalOcurrencias} skippedParse=${skippedParse} skippedFueraPlantilla=${skippedFueraPlantilla} filasIteradas=${diagnostico.filasIteradas} modo=${diagnostico.modoLectura} trDom=${totalTrDom}\ndiagnostico=${JSON.stringify({ ...diagnostico, muestraPrimerasFilas: `[${diagnostico.muestraPrimerasFilas.length} items]`, muestraUltimasFilas: `[${diagnostico.muestraUltimasFilas.length} items]` })}\n`,
      'utf8'
    );

    let sesionesPorCelda = fechasUnicasPorCelda.map((row) => row.map((s) => s.size));
    for (let ri = 0; ri < horas.length; ri += 1) {
      for (let dj = 0; dj < 7; dj += 1) {
        const m = matrix[ri][dj] || 0;
        if (m > 0 && sesionesPorCelda[ri][dj] === 0) {
          sesionesPorCelda[ri][dj] = 1;
        }
      }
    }

    return {
      sede,
      desde,
      hasta,
      reporteUrl: REPORT_URLS[0],
      diasLabels: [...DIA_LABELS],
      horas,
      matrix,
      sesionesPorCelda,
      capacidadPorTurno: CAPACIDAD_MAX_POR_TURNO,
      slotValid,
      totalesPorHora,
      totalesPorDia,
      totalOcurrencias,
      plantillaArchivo: 'shared/horarios-sedes.json',
      diagnostico,
      ocupacionStreaming: false,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { obtenerReporteOcupacionClases, REPORT_URLS };
