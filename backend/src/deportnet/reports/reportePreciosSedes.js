const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const preciosSedesPlanesActivos = require('../../../../shared/precios-sedes-planes-activos.json');
const localesDefault = require('../../../../shared/locales.json');

const { login, selectSucursal } = require('../deportnetActions');
const { parseMoneyToNumber, DEBUG_DIR } = require('../deportnetReaders');

const REPORT_URL = 'https://deportnet.com/reportConcepts';

/** Nombre en locales.json → nombre corto que suele aparecer como primer segmento en el reporte */
function extractSedeNameFromLocale(locale) {
  const s = String(locale || '').trim();
  if (/^CLIC Pilates\s*-\s*/i.test(s)) return s.replace(/^CLIC Pilates\s*-\s*/i, '').trim();
  if (/^Pilates\s*-\s*/i.test(s)) return s.replace(/^Pilates\s*-\s*/i, '').trim();
  return s;
}

function normalizeText(str) {
  return String(str || '')
    .replace(/[–−]/g, '-')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Estructura: "Local - ..." o "Local - Pilates - ...".
 * Tras el local (y opcional "Pilates"), el resto es el nombre del plan/servicio.
 */
function parseNombreConcepto(raw) {
  const full = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[–−]/g, '-')
    .trim();
  if (!full) return null;
  const parts = full.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const localSegment = parts[0];
  let i = 1;
  if (parts[i] && /^pilates$/i.test(parts[i])) i += 1;
  const serviceTail = parts.slice(i).join(' - ');
  return { localSegment, serviceTail, parts };
}

function trimRemainderToPayment(remainderNorm) {
  const deb = 'debito automatico';
  const ef = 'efectivo/transferencia';
  let out = String(remainderNorm || '');
  const idxDeb = out.indexOf(deb);
  if (idxDeb >= 0) return out.slice(0, idxDeb + deb.length).trim();
  const idxEf = out.indexOf(ef);
  if (idxEf >= 0) return out.slice(0, idxEf + ef.length).trim();
  return out;
}

/** Sufijos basura en nombres de concepto (NO USAR, asteriscos, etc.) */
function stripTrailingJunk(norm) {
  return String(norm || '')
    .replace(/\s*-\s*no\s+usar\b[\s\S]*$/i, '')
    .replace(/\*+/g, '')
    .replace(/\s+-\s*$/g, '')
    .trim();
}

/** Clave normalizada para comparar fila del reporte vs ítem del JSON */
function planeMatchKey(text) {
  if (!text) return '';
  return stripTrailingJunk(trimRemainderToPayment(normalizeText(text)));
}

/**
 * Unifica variantes como "Mensual - 1 vxs - 15 Debito Automatico" → misma clave que sin el "15".
 */
function canonicalPlanKey(key) {
  let k = String(key || '').trim();
  if (!k) return '';
  k = k.replace(/\s+-\s+\d+\s+(?=debito automatico\b)/gi, ' - ');
  k = k.replace(/\s+\d+\s+(?=debito automatico\b)/g, ' ');
  k = k.replace(/\s+/g, ' ').trim();
  return k;
}

/** Compara planes con o sin prefijo "Pilates - " (mismo catálogo en JSON y cola del reporte). */
function unifiedPlanComparable(normCanon) {
  return String(normCanon || '')
    .replace(/^pilates\s*-\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {{ plane: string, score: number } | null} score 3 = match exacto, 2 = match canonical (variantes)
 */
function findMatchingPlaneScored(text) {
  if (!text) return null;
  const tailExact = planeMatchKey(text);
  const tailCanon = canonicalPlanKey(tailExact);
  const tailUnified = unifiedPlanComparable(tailCanon);
  if (!tailCanon && !tailUnified) return null;

  let bestPlane = null;
  let bestScore = 0;

  /** Sedes como Escobar: servicio "… Pilates - Clase de prueba" sin medio de pago; mismo producto que CDP + Efectivo en catálogo. */
  const CDP_UNIFIED_EFECTIVO = 'clase de prueba - efectivo/transferencia';

  for (const plane of preciosSedesPlanesActivos) {
    const pExact = planeMatchKey(plane);
    const pCanon = canonicalPlanKey(pExact);
    const pUnified = unifiedPlanComparable(pCanon);
    let score = 0;
    if (tailExact && pExact && tailExact === pExact) score = 3;
    else if (tailCanon && pCanon && tailCanon === pCanon) score = 2;
    else if (tailUnified && pUnified && tailUnified === pUnified) score = 2;
    else if (tailUnified === 'clase de prueba' && pUnified === CDP_UNIFIED_EFECTIVO) score = 2;
    if (score > bestScore) {
      bestScore = score;
      bestPlane = plane;
    }
  }
  return bestScore ? { plane: bestPlane, score: bestScore } : null;
}

/**
 * Con sede ya elegida en DeportNet, muchas filas vienen solo con el nombre del plan
 * (sin "Pilara - …"). Probamos varias formas de obtener el texto comparable al JSON.
 */
/**
 * @returns {{ plane: string, score: number } | null}
 */
function resolveMatchedPlaneScored(nombreRaw, parsed, sedeShortNorm) {
  if (!nombreRaw || !parsed) return null;

  let best = null;

  const consider = (text) => {
    const m = findMatchingPlaneScored(text);
    if (!m) return;
    if (!best || m.score > best.score) best = m;
  };

  if (rowBelongsToSede(parsed, sedeShortNorm)) {
    consider(parsed.serviceTail);
  }

  consider(nombreRaw);

  if (parsed.parts.length >= 2) {
    consider(parsed.parts.slice(1).join(' - '));
  }

  return best;
}

function parsePriceCell(text) {
  const priceText = String(text || '');
  const hasDigits = /[0-9]/.test(priceText);
  if (!hasDigits) return null;
  const n = parseMoneyToNumber(priceText);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detecta índices de columnas en thead (Nombre, Estado, Precio 1..3).
 */
function mapConceptTableColumns(headerTexts) {
  const headers = headerTexts.map((t) => String(t).replace(/\s+/g, ' ').trim());
  const idx = (pred) => headers.findIndex(pred);

  let nombreIdx = idx(
    (h) => /^(nombre|concepto|servicio|descripcion)$/i.test(h) || /concepto/i.test(h)
  );
  if (nombreIdx < 0) nombreIdx = 0;

  const estadoIdx = idx((h) => /^estado$/i.test(h));
  let precio1Idx = idx((h) => /precio\s*1/i.test(h));
  if (precio1Idx < 0) precio1Idx = idx((h) => /precio[^\w]*1/i.test(h));
  let precio2Idx = idx((h) => /precio\s*2/i.test(h));
  let precio3Idx = idx((h) => /precio\s*3/i.test(h));

  if (precio1Idx < 0) {
    throw new Error(
      `Precios Sedes: no se encontró columna "Precio 1". Encabezados: ${JSON.stringify(headers)}`
    );
  }

  // Si los th vienen vacíos o raros, asumimos columnas contiguas tras Precio 1
  if (precio2Idx < 0) precio2Idx = precio1Idx + 1;
  if (precio3Idx < 0) precio3Idx = precio2Idx + 1;

  return {
    nombreIdx,
    // Sin th "Estado": suele ser la columna siguiente al nombre
    estadoIdx: estadoIdx >= 0 ? estadoIdx : nombreIdx + 1,
    precio1Idx,
    precio2Idx,
    precio3Idx,
  };
}

function rowBelongsToSede(parsed, sedeShortNorm) {
  if (!parsed) return false;
  const loc = normalizeText(parsed.localSegment);
  if (loc === sedeShortNorm) return true;
  // Filas sin prefijo de sede: "Pilates - …" en el contexto de la sucursal elegida
  if (loc === 'pilates') return true;
  return false;
}

function shouldSkipGroupRow(nombreCell) {
  return /servicios\s*\/\s*membres/i.test(String(nombreCell || ''));
}

async function findFirstDataRowWithMinTd(table, minTd) {
  const trs = table.locator('tbody tr');
  const n = await trs.count();
  for (let i = 0; i < n; i++) {
    const row = trs.nth(i);
    const tdCount = await row.locator('td').count();
    if (tdCount >= minTd) {
      const cells = await row.locator('td').allTextContents().catch(() => []);
      return { rowIndex: i, tdCount, cells };
    }
  }
  return null;
}

/**
 * Desfase cuando hay más <td> que <th> (ej. columna de acción/check sin encabezado).
 */
function applyTdColumnShift(cols, shift) {
  if (!shift || shift < 0) return cols;
  return {
    nombreIdx: cols.nombreIdx + shift,
    estadoIdx: cols.estadoIdx + shift,
    precio1Idx: cols.precio1Idx + shift,
    precio2Idx: cols.precio2Idx + shift,
    precio3Idx: cols.precio3Idx + shift,
  };
}

/**
 * Elige la tabla con encabezado "Precio 1" y filas de datos con suficientes celdas.
 */
async function locateConceptsTable(page) {
  const tables = page.locator('table');
  const n = await tables.count();
  let fallbackWithHeader = null;
  for (let i = 0; i < n; i++) {
    const t = tables.nth(i);
    const theadTh = await t.locator('thead tr th').allTextContents().catch(() => []);
    const hasPrecioHeader = theadTh.some((h) => /precio\s*1/i.test(String(h)));
    if (!hasPrecioHeader) continue;
    if (!fallbackWithHeader) fallbackWithHeader = t;
    const sample = await findFirstDataRowWithMinTd(t, 4);
    if (sample) return t;
  }
  for (let i = 0; i < n; i++) {
    const t = tables.nth(i);
    const firstRowTh = await t.locator('tbody tr').first().locator('th').allTextContents().catch(() => []);
    if (!firstRowTh.some((h) => /precio\s*1/i.test(String(h)))) continue;
    const sample = await findFirstDataRowWithMinTd(t, 4);
    if (sample) return t;
  }
  if (fallbackWithHeader) return fallbackWithHeader;
  return tables.first();
}

async function readHeaderTextsFromTable(table) {
  let headerTexts = await table.locator('thead tr').first().locator('th').allTextContents().catch(() => []);
  if (!headerTexts.length) {
    headerTexts = await table.locator('thead tr th').allTextContents().catch(() => []);
  }
  if (!headerTexts.length) {
    const tr0 = table.locator('tbody tr').first();
    headerTexts = await tr0.locator('th').allTextContents().catch(() => []);
  }
  return headerTexts.map((t) => String(t).replace(/\s+/g, ' ').trim());
}

async function waitForConceptsTable(page, debugWaitBase, tableLocator) {
  await page
    .screenshot({ path: `${debugWaitBase}_before_wait.png`, fullPage: true })
    .catch(() => {});

  try {
    await tableLocator.locator('tbody tr').first().waitFor({ timeout: 60000 });
  } catch (e) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    fs.writeFileSync(
      `${debugWaitBase}.txt`,
      [
        `error=${e && e.message ? e.message : String(e)}`,
        `body_snippet=${bodyText.slice(0, 2000)}`,
      ].join('\n') + '\n',
      'utf8'
    );
    await page.screenshot({ path: `${debugWaitBase}_after_timeout.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Precios Sedes: no apareció la tabla (tbody tr). Ver ${debugWaitBase}_before_wait.png y .txt`
    );
  }
}

/**
 * Recorre las sedes indicadas (o shared/locales.json), abre reportConcepts sin filtros extra,
 * lee Nombre | Estado | Precio 1..3 y emite filas que matchean precios-sedes-planes-activos.json.
 */
async function obtenerPreciosSedes({ sedes, onRow, onProgress, isCancelled }) {
  const sedesList =
    Array.isArray(sedes) && sedes.length > 0 ? sedes : Array.isArray(localesDefault) ? localesDefault : [];

  if (!sedesList.length) {
    throw new Error('Precios Sedes: no hay sedes (lista vacía y locales.json vacío).');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await login(page);

    const ts0 = new Date().toISOString().replace(/[:.]/g, '-');
    const stepsBase = path.join(DEBUG_DIR, `precios_sedes_steps_${ts0}`);

    const safeStepName = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '');

    const stepSnap = async (idx, name, extraLines = []) => {
      try {
        const safe = safeStepName(name);
        const snapPath = `${stepsBase}_${idx}_${safe}.png`;
        await page.screenshot({ path: snapPath, fullPage: true }).catch(() => {});
        const txtPath = `${stepsBase}_${idx}_${safe}.txt`;
        fs.writeFileSync(
          txtPath,
          [`step=${idx}`, `name=${name}`, ...extraLines].join('\n') + '\n',
          'utf8'
        );
      } catch (_) {}
    };

    await stepSnap(1, 'after_login');

    const sedesTotal = sedesList.length;
    let sedeIndex = 0;

    for (const sedeLocale of sedesList) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      const sedeShort = extractSedeNameFromLocale(sedeLocale);
      const sedeShortNorm = normalizeText(sedeShort);

      if (typeof onProgress === 'function') {
        onProgress({
          processed: sedeIndex,
          total: sedesTotal,
          sede: sedeLocale,
        });
      }

      try {
        await selectSucursal(page, sedeLocale);
        await page.waitForTimeout(1200);
      } catch (err) {
        console.error(`Precios Sedes: selectSucursal falló para "${sedeLocale}"`, err);
        sedeIndex += 1;
        continue;
      }

      await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      const tsWait = new Date().toISOString().replace(/[:.]/g, '-');
      const debugWaitBase = path.join(DEBUG_DIR, `precios_sedes_wait_${tsWait}_${safeStepName(sedeShort)}`);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const debugBase = path.join(DEBUG_DIR, `precios_sedes_${ts}_${safeStepName(sedeShort)}`);

      await page.waitForLoadState('networkidle').catch(() => {});
      await page
        .locator('th')
        .filter({ hasText: /precio\s*1/i })
        .first()
        .waitFor({ timeout: 45000 })
        .catch(() => {});

      const conceptsTable = await locateConceptsTable(page);
      await waitForConceptsTable(page, debugWaitBase, conceptsTable);

      await stepSnap(2, `table_${safeStepName(sedeShort)}`, [`sede=${sedeLocale}`]);

      const headerTexts = await readHeaderTextsFromTable(conceptsTable);
      let cols;
      try {
        cols = mapConceptTableColumns(headerTexts);
      } catch (err) {
        fs.writeFileSync(
          `${debugBase}_header_error.txt`,
          JSON.stringify({ headerTexts, err: String(err) }, null, 2),
          'utf8'
        );
        throw err;
      }

      const hdrLen = headerTexts.length;
      const sampleShift = await findFirstDataRowWithMinTd(conceptsTable, 4);
      let tdShift = 0;
      if (sampleShift && sampleShift.tdCount > hdrLen) {
        tdShift = sampleShift.tdCount - hdrLen;
      }
      cols = applyTdColumnShift(cols, tdShift);

      fs.writeFileSync(
        `${debugBase}.txt`,
        JSON.stringify(
          {
            sedeLocale,
            sedeShort,
            headerTexts,
            headerLen: hdrLen,
            sampleTdCount: sampleShift ? sampleShift.tdCount : null,
            tdShift,
            cols,
            sampleFirstCells: sampleShift ? sampleShift.cells.slice(0, 6) : null,
          },
          null,
          2
        ) + '\n',
        'utf8'
      );

      const rows = conceptsTable.locator('tbody tr');
      const totalRows = await rows.count();
      const rowMatches = [];

      for (let r = 0; r < totalRows; r++) {
        if (typeof isCancelled === 'function' && isCancelled()) break;

        const row = rows.nth(r);
        const cells = await row.locator('td').allTextContents().catch(() => []);
        if (!cells.length) continue;

        const nombreRaw = String(cells[cols.nombreIdx] ?? '').trim();
        if (!nombreRaw || shouldSkipGroupRow(nombreRaw)) continue;

        const estadoRaw = String(cells[cols.estadoIdx] ?? '').trim();
        const estadoNorm = normalizeText(estadoRaw);
        if (!/activo/.test(estadoNorm)) continue;

        const parsed = parseNombreConcepto(nombreRaw);
        if (!parsed) continue;

        if (normalizeText(parsed.localSegment) === 'multisucursal') continue;

        const scored = resolveMatchedPlaneScored(nombreRaw, parsed, sedeShortNorm);
        if (!scored) continue;

        const precio1 = parsePriceCell(cells[cols.precio1Idx] ?? '');

        rowMatches.push({
          plane: scored.plane,
          score: scored.score,
          precio1,
          nombreFila: nombreRaw,
        });
      }

      const bestByPlane = new Map();
      for (const m of rowMatches) {
        const prev = bestByPlane.get(m.plane);
        if (!prev || m.score > prev.score) bestByPlane.set(m.plane, m);
      }

      if (typeof onRow === 'function') {
        for (const m of bestByPlane.values()) {
          onRow({
            sede: sedeLocale,
            sedeShort,
            plan: m.plane,
            nombreFila: m.nombreFila,
            precio1: m.precio1,
          });
        }
      }

      sedeIndex += 1;

      if (typeof onProgress === 'function') {
        onProgress({
          processed: sedeIndex,
          total: sedesTotal,
          sede: sedeLocale,
        });
      }
    }

    return { ok: true };
  } finally {
    await browser.close();
  }
}

module.exports = { obtenerPreciosSedes, findMatchingPlaneScored };
