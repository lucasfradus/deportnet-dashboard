const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const {
  login,
  selectSucursal,
  setFechaRango,
  goToCobros,
  marcarAgrupar,
  ejecutarBusqueda,
} = require('../deportnetActions');
const { sumarCantidadClasesPrueba } = require('../deportnetReaders');

const localesDefault = require('../../../../shared/locales.json');
const clasePruebaPatterns = require('../../../../shared/clase-prueba-patterns.json');

function extractSedeNameFromLocale(locale) {
  const s = String(locale || '').trim();
  if (/^CLIC Pilates\s*-\s*/i.test(s)) return s.replace(/^CLIC Pilates\s*-\s*/i, '').trim();
  if (/^Pilates\s*-\s*/i.test(s)) return s.replace(/^Pilates\s*-\s*/i, '').trim();
  return s;
}

const DEBUG_DIR = path.join(__dirname, '..', '..', 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

function escapeRegExpLite(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildConceptRegexFromExpectedText(expectedText) {
  // Replica la tolerancia de `sumarCantidadClasesPrueba`:
  // - Divide por guiones '-' o '–'
  // - Une tokens permitiendo espacios/guiones equivalentes
  const tokens = String(expectedText)
    .split(/\s*[-–]\s*/g)
    .map((t) => t.trim())
    .filter(Boolean);

  const pattern = tokens.map(escapeRegExpLite).join('\\s*[-–]\\s*');
  return new RegExp(pattern, 'i');
}

function isClasePruebaServiceText(serviceText, locale, sedePrefix) {
  const text = String(serviceText || '');
  if (!text.trim()) return false;

  const sedeBase = `${sedePrefix} - Pilates - Clase de prueba`;
  const configured = clasePruebaPatterns[locale];

  // Permitimos tanto la versión "base" como la versión exacta configurada
  // (por ejemplo, Palermo Hollywood incluye "Efectivo/Transferencia").
  const candidates = [];
  candidates.push(sedeBase);
  if (configured) candidates.push(configured);

  // Matching tolerante por regex contra todo el campo (incluye posibles saltos de línea).
  for (const cand of candidates) {
    const re = buildConceptRegexFromExpectedText(cand);
    if (re.test(text)) return true;
  }

  return false;
}

async function clickBuscar(page) {
  try {
    const btn = page.getByRole('button', { name: /Buscar/i }).first();
    await btn.waitFor({ timeout: 5000 }).catch(() => {});
    await btn.click({ force: true, timeout: 5000 });
    return;
  } catch (_) {
    // ignore
  }

  try {
    const link = page.getByRole('link', { name: /Buscar/i }).first();
    await link.waitFor({ timeout: 5000 }).catch(() => {});
    await link.click({ force: true, timeout: 5000 });
  } catch (_) {
    // Algunos reportes cargan automáticamente al cambiar fechas
  }
}

async function waitTableRows(page, timeoutMs = 60000, debugLabel = 'table') {
  try {
    // En algunos reportes la fila existe en DOM pero no está "visible" inmediatamente.
    await page
      .locator('table tbody tr')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
  } catch (e) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(DEBUG_DIR, `conversion_wait_${debugLabel}_${ts}.png`);
    const txtPath = path.join(DEBUG_DIR, `conversion_wait_${debugLabel}_${ts}.txt`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    } catch (_) {}
    try {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      fs.writeFileSync(
        txtPath,
        [
          `error=${e && e.message ? e.message : String(e)}`,
          `debugLabel=${debugLabel}`,
          `body_snippet=${bodyText.slice(0, 2000)}`,
        ].join('\n') + '\n',
        'utf8'
      );
    } catch (_) {}
    throw e;
  }
}

async function readTableHeaderIndexes(page) {
  const headers = await page.locator('table thead tr th').allTextContents().catch(() => []);

  const headersNorm = headers
    .map((h) =>
      String(h || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  const findIndex = (pred) => headersNorm.findIndex((hn) => pred(hn));

  const emailIdx = findIndex((hn) => hn === 'email' || hn.endsWith('email'));
  const prevServicioIdx = findIndex((hn) => hn.includes('servicio/membresia') && hn.includes('previo'));
  const servicioIdx = findIndex((hn) => hn.includes('servicio/membresia') && !hn.includes('previo'));

  return { headers, emailIdx, prevServicioIdx, servicioIdx };
}

async function readTableRowsAsCells(page) {
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  const out = [];

  for (let r = 0; r < rowCount; r++) {
    const row = rows.nth(r);
    const cells = await row.locator('td').allTextContents().catch(() => []);
    out.push(cells);
  }

  return out;
}

async function readRowCellText(row, tdIdx) {
  return row.locator('td').nth(tdIdx).innerText().catch(() => '');
}

async function aplicarFiltrosEnReporte(page, reportUrl, desde, hasta, debugLabel) {
  // Retry simple ante timeouts intermitentes de red.
  let gotoOk = false;
  let lastErr = null;
  for (let i = 0; i < 2 && !gotoOk; i++) {
    try {
      await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      gotoOk = true;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(1200);
    }
  }
  if (!gotoOk) throw lastErr || new Error(`No se pudo abrir ${reportUrl}`);
  await page.waitForTimeout(1500);

  await setFechaRango(page, desde, hasta);
  await page.waitForTimeout(500);

  await clickBuscar(page);
  await waitTableRows(page, 120000, debugLabel);
}

/**
 * Conversión:
 * - Numerador (Convertidos): en `branchMembersRenovationsReport`,
 *   socios cuyo "Servicio/Membresía previo" es Clase de prueba (para la sede),
 *   y cuyo "Servicio/Membresía" actual NO es Clase de prueba.
 * - Denominador (Clase de prueba): en `reportCustomerCharges`,
 *   socios con "Servicio/Membresía" actual = Clase de prueba (para la sede).
 */
async function obtenerReporteConversionClasesPrueba({
  desde,
  hasta,
  sedes,
  onSede,
  onProgress,
  isCancelled,
}) {
  const sedesAUsar = Array.isArray(sedes) ? sedes : localesDefault;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  const reportRenovacionesUrl = 'https://deportnet.com/branchMembersRenovationsReport';

  try {
    await login(page);

    const resultados = [];
    const total = sedesAUsar.length;
    let processed = 0;

    const ts0 = new Date().toISOString().replace(/[:.]/g, '-');

    for (const localeSede of sedesAUsar) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      if (typeof onProgress === 'function') {
        onProgress({ processed, total, sede: localeSede });
      }

      await selectSucursal(page, localeSede);

      const sedePrefix = extractSedeNameFromLocale(localeSede);

      // --- Numerador: renovaciones ---
      const convertidosEmails = new Set();
      try {
        await aplicarFiltrosEnReporte(
          page,
          reportRenovacionesUrl,
          desde,
          hasta,
          `renov_${String(localeSede).replace(/[\\\\/:*?\"<>|]/g, '_')}`
        );

        const { emailIdx, prevServicioIdx, servicioIdx } = await readTableHeaderIndexes(page);
        if (emailIdx < 0 || prevServicioIdx < 0 || servicioIdx < 0) {
          throw new Error(
            `No se detectaron columnas requeridas en renovaciones. emailIdx=${emailIdx}, prevServicioIdx=${prevServicioIdx}, servicioIdx=${servicioIdx}`
          );
        }

        const sedeBase = `${sedePrefix} - Pilates - Clase de prueba`;
        const configured = clasePruebaPatterns[localeSede];
        const candidates = [sedeBase, configured].filter(Boolean);

        let debugMatches = [];
        let sampleRows = [];

        // El filtrado se hace en el navegador para evitar transferir la tabla completa.
        const evalRes = await page.$$eval(
          'table tbody tr',
          (trs, arg) => {
            const escapeRegExpLite = (str) =>
              String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const buildConceptRegexFromExpectedText = (expectedText) => {
              const tokens = String(expectedText)
                .split(/\\s*[-–]\\s*/g)
                .map((t) => t.trim())
                .filter(Boolean);
              const pattern = tokens.map(escapeRegExpLite).join('\\\\s*[-–]\\\\s*');
              return new RegExp(pattern, 'i');
            };

            const regexes = (arg.candidates || []).map(buildConceptRegexFromExpectedText);

            const emails = new Set();
            const debugOut = [];
            const sampleOut = [];

            const matchAny = (txt) => {
              const s = String(txt || '');
              if (!s.trim()) return false;
              return regexes.some((re) => re.test(s));
            };

            for (const tr of trs) {
              const tds = Array.from(tr.querySelectorAll('td'));
              const email = (tds[arg.emailIdx]?.innerText || '').trim();
              if (!email) continue;

              const servicioPrev = (tds[arg.prevServicioIdx]?.innerText || '').trim();
              const servicioActual = (tds[arg.servicioIdx]?.innerText || '').trim();

              const prevMatch = matchAny(servicioPrev);
              const currMatch = matchAny(servicioActual);

              if (sampleOut.length < 30 && email) {
                sampleOut.push({
                  email,
                  prevMatch,
                  currMatch,
                  servicioPrev: String(servicioPrev).trim().slice(0, 220),
                  servicioActual: String(servicioActual).trim().slice(0, 220),
                });
              }

              if (prevMatch && !currMatch) {
                emails.add(email);
                if (debugOut.length < 25) {
                  debugOut.push({
                    email,
                    servicioPrev: String(servicioPrev).trim().slice(0, 180),
                    servicioActual: String(servicioActual).trim().slice(0, 180),
                    prevEsClasePrueba: prevMatch,
                    actualEsClasePrueba: currMatch,
                  });
                }
              }
            }

            return {
              emails: Array.from(emails),
              debugMatches: debugOut,
              sampleRows: sampleOut,
            };
          },
          { emailIdx, prevServicioIdx, servicioIdx, candidates }
        );

        convertidosEmails.clear();
        for (const e of evalRes.emails || []) convertidosEmails.add(e);
        debugMatches = evalRes.debugMatches || [];
        sampleRows = evalRes.sampleRows || [];

        if (convertidosEmails.size === 0) {
          const debugBase = path.join(
            DEBUG_DIR,
            `conversion_convertidos_${ts0}_${String(localeSede).replace(/[\\\\/:*?\"<>|]/g, '_')}.txt`
          );

          // sampleRows ya viene desde el navegador.
          fs.writeFileSync(
            debugBase,
            [
              `sede=${localeSede}`,
              `sedePrefix=${sedePrefix}`,
              `desde=${desde}`,
              `hasta=${hasta}`,
              `emailIdx=${emailIdx}`,
              `prevServicioIdx=${prevServicioIdx}`,
              `servicioIdx=${servicioIdx}`,
              `convertidos=${convertidosEmails.size}`,
              `ejemplosConvertidos=${JSON.stringify(debugMatches, null, 2)}`,
              '',
              'Muestras para revisar matching (primeras filas con email):',
              JSON.stringify(sampleRows, null, 2),
            ].join('\n'),
            'utf8'
          );
        }
      } catch (e) {
        // Para no romper todo el reporte si una sede falla, dejamos conteos en 0 y seguimos.
        // (Si preferís hard-fail, lo cambiamos a throw.)
        convertidosEmails.clear();
        try {
          const debugBase = path.join(
            DEBUG_DIR,
            `conversion_convertidos_error_${ts0}_${String(localeSede).replace(/[\\\\/:*?\"<>|]/g, '_')}.txt`
          );
          fs.writeFileSync(
            debugBase,
            [
              `error=${e && e.message ? e.message : String(e)}`,
              `sede=${localeSede}`,
              `sedePrefix=${sedePrefix}`,
              `desde=${desde}`,
              `hasta=${hasta}`,
            ].join('\n') + '\n',
            'utf8'
          );
        } catch (_) {}
      }

      // --- Denominador: clases de prueba ---
      // Reutilizamos la misma lógica existente del reporte quincenal.
      let denominadorCantidad = 0;
      try {
        await goToCobros(page);
        await setFechaRango(page, desde, hasta);
        await marcarAgrupar(page);
        await ejecutarBusqueda(page);
        denominadorCantidad = await sumarCantidadClasesPrueba(page, localeSede);
      } catch (e) {
        denominadorCantidad = 0;
        try {
          const debugBase = path.join(
            DEBUG_DIR,
            `conversion_denom_error_${ts0}_${String(localeSede).replace(/[\\\\/:*?\"<>|]/g, '_')}.txt`
          );
          fs.writeFileSync(
            debugBase,
            [
              `error=${e && e.message ? e.message : String(e)}`,
              `sede=${localeSede}`,
              `sedePrefix=${sedePrefix}`,
              `desde=${desde}`,
              `hasta=${hasta}`,
            ].join('\n') + '\n',
            'utf8'
          );
        } catch (_) {}
      }

      const convertidos = convertidosEmails.size;
      const denominador = Number(denominadorCantidad) || 0;
      const conversionPct = denominador > 0 ? (convertidos / denominador) * 100 : null;

      resultados.push({
        sede: localeSede,
        denominador,
        numerador: convertidos,
        conversionPct,
      });

      processed += 1;
      if (typeof onSede === 'function') {
        onSede({
          sede: localeSede,
          denominador,
          numerador: convertidos,
          conversionPct,
          processed,
          total,
        });
      }
    }

    return resultados;
  } finally {
    await browser.close();
  }
}

module.exports = { obtenerReporteConversionClasesPrueba };

