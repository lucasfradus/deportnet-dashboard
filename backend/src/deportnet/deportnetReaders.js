const fs = require('fs');
const path = require('path');

const clasePruebaPatterns = require('../../../shared/clase-prueba-patterns.json');

const DEBUG_DIR = path.join(__dirname, '..', '..', 'debug');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function parseMoneyToNumber(text) {
  if (!text) return 0;
  // Ejemplos: "$292,141.00" o "$292.141,00"
  const cleaned = String(text)
    .replace(/\s+/g, ' ')
    .replace(/[^0-9.,-]/g, '');

  if (!cleaned) return 0;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let decimalSep = '';
  if (lastDot > lastComma) decimalSep = '.';
  else if (lastComma > lastDot) decimalSep = ',';

  // Caso sin separador decimal (ej: "12345")
  if (!decimalSep) return Number(cleaned);

  // Si decimalSep es ".", miles es ","
  if (decimalSep === '.') {
    const normalized = cleaned.replace(/,/g, '');
    return Number(normalized);
  }

  // Si decimalSep es ",", miles es "."
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  return Number(normalized);
}

function escapeRegExpLite(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildConceptRegexFromExpectedText(expectedText) {
  // Divide por guiones ( '-' o '–') tolerando espacios.
  const tokens = String(expectedText)
    .split(/\s*[-–]\s*/g)
    .map((t) => t.trim())
    .filter(Boolean);

  // Construye regex tolerante al tipo de guion y espacios.
  const pattern = tokens.map(escapeRegExpLite).join('\\s*[-–]\\s*');
  return new RegExp(pattern, 'i');
}

async function sumarCantidadClasesPrueba(page, sedeNombre) {
  const configuredText = clasePruebaPatterns[sedeNombre];
  const expectedText = configuredText
    ? configuredText
    : `${sedeNombre} - Pilates - Clase de prueba`;

  const conceptRegex = buildConceptRegexFromExpectedText(expectedText);

  // Asumimos tabla del reporte: columnas (td[0]=Concepto, td[1]=Cantidad, td[2]=Importe).
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  let sum = 0;

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const conceptCell = await row.locator('td').first().innerText().catch(() => '');
    if (!conceptCell) continue;

    if (!conceptRegex.test(conceptCell)) continue;

    const qtyText = await row.locator('td').nth(1).innerText().catch(() => '');
    const qty = parseInt(String(qtyText).replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(qty)) sum += qty;
  }

  return sum;
}

async function leerTotalFacturado(page, meta) {
  // En el sistema antiguo el bloque puede estar off-screen o no ser "visible"
  // aunque exista en el DOM, por eso usamos estado 'attached' como base.
  const label = page
    .locator('text=/Total\\s*(facturado|cobrado)\\s*:?/i')
    .first();

  try {
    await label.waitFor({ state: 'attached', timeout: 15000 });
    const txt = (await label.textContent()) || '';
    const monto = parseMoneyToNumber(txt);
    if (monto > 0) return monto;
  } catch (_) {
    // Fallback más abajo
  }

  // Fallback: buscar en el texto completo de la página.
  const bodyText = await page.locator('body').textContent().catch(() => '');
  const match = String(bodyText).match(
    /Total\s*(?:facturado|cobrado)\s*:?\s*\$?\s*([\d.,]+)/i
  );
  if (match) return parseMoneyToNumber(match[1]);

  // Si el reporte vive en un iframe, el body del documento principal no lo incluye.
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const frameText = await frame.locator('body').textContent().catch(() => '');
      const m = String(frameText).match(
        /Total\s*(?:facturado|cobrado)\s*:?\s*\$?\s*([\d.,]+)/i
      );
      if (m) return parseMoneyToNumber(m[1]);
    } catch (_) {
      // Ignorar frames que no se puedan leer
    }
  }

  // Debug: buscamos "total"/"facturado" y redactamos dígitos.
  const lower = String(bodyText).toLowerCase();
  const redact = (s) => String(s).replace(/\d/g, '#');
  const phrases = [
    'total facturado',
    'total cobrado',
    'factur',
    'facturado',
    'cobrado',
    'total',
  ];
  const contexts = phrases
    .map((ph) => {
      const pos = lower.indexOf(ph);
      if (pos < 0) return null;
      const start = Math.max(0, pos - 80);
      const end = Math.min(bodyText.length, pos + 220);
      return `${ph}: ${redact(bodyText.slice(start, end))}`;
    })
    .filter(Boolean);

  const contextMsg = contexts.length ? `\nContexto encontrado:\n${contexts.join('\n')}` : '';

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const sede = meta && meta.sede ? String(meta.sede) : 'sede';
  const screenshotPath = path.join(DEBUG_DIR, `total_fail_${sede}_${ts}.png`);

  // Debug: guardamos también si aparece "facturado" en cada frame.
  const allFrames = page.frames();
  const frameFacts = [];
  for (let i = 0; i < allFrames.length; i++) {
    try {
      const t = await allFrames[i].locator('body').textContent().catch(() => '');
      const lowerT = String(t).toLowerCase();
      const hasFacturado = lowerT.includes('factur');
      const hasTotal = lowerT.includes('total');
      const redactNums = (s) => String(s).replace(/\d/g, '#');

      const posTotal = hasTotal ? lowerT.indexOf('total') : -1;
      const posFactur = hasFacturado ? lowerT.indexOf('factur') : -1;

      const mkSnippet = (pos) => {
        if (pos < 0) return '';
        const start = Math.max(0, pos - 80);
        const end = Math.min(String(t).length, pos + 220);
        return redactNums(String(t).slice(start, end));
      };

      frameFacts.push({
        i,
        hasFacturado,
        hasTotal,
        snippetTotal: mkSnippet(posTotal),
        snippetFactur: mkSnippet(posFactur),
      });
    } catch (_) {
      frameFacts.push({
        i,
        hasFacturado: false,
        hasTotal: false,
        snippetTotal: '',
        snippetFactur: '',
      });
    }
  }

  const debugTxtPath = path.join(DEBUG_DIR, `total_fail_${sede}_${ts}.txt`);
  fs.writeFileSync(
    debugTxtPath,
    `sede=${sede}\n${contextMsg}\nframes=${JSON.stringify(frameFacts, null, 2)}\n`,
    'utf8'
  );

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  throw new Error(
    `No se pudo leer "Total facturado" del reporte.${contextMsg}\nDebug: ${screenshotPath}\nDebug: ${debugTxtPath}`
  );
}

module.exports = {
  DEBUG_DIR,
  parseMoneyToNumber,
  sumarCantidadClasesPrueba,
  leerTotalFacturado,
};

