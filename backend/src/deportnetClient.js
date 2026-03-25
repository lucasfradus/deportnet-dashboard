const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const BASE_URL = 'https://deportnet.com/';

const localesDefault = require('../../shared/locales.json');
const clasePruebaPatterns = require('../../shared/clase-prueba-patterns.json');
const preciosSedesPlanesActivos = require('../../shared/precios-sedes-planes-activos.json');

const DEBUG_DIR = path.join(__dirname, '..', 'debug');
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

function parseDayFromISO(isoDate) {
  // Esperamos "YYYY-MM-DD"
  const parts = String(isoDate).split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Formato de fecha inválido (se espera YYYY-MM-DD): ${isoDate}`);
  }
  const [, , day] = parts;
  return day;
}

function formatISOToDMY(isoDate) {
  // Esperamos "YYYY-MM-DD"
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) throw new Error(`Formato de fecha inválido: ${isoDate}`);
  const [yyyy, mm, dd] = parts;
  return `${dd}/${mm}/${yyyy}`;
}

async function login(page) {
  const user = process.env.DEPORNET_USER;
  const pass = process.env.DEPORNET_PASS;
  if (!user || !pass) {
    throw new Error(
      'Faltan credenciales. Setea DEPORNET_USER y DEPORNET_PASS en backend/.env'
    );
  }

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await page.getByPlaceholder('Correo electrónico').fill(user);
  await page.locator('#main_login_password').fill(pass);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Esperamos que el sistema cargue una pantalla típica
  // Algunos sistemas hacen requests persistentes, así que 'networkidle' puede
  // tardar demasiado. Usamos un wait corto.
  await page.waitForTimeout(2000);
  // En algunos reportes la landing luego del login puede variar.
  // No bloqueamos si "SUCURSALES" no aparece inmediatamente.
  await page
    .getByText('SUCURSALES', { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(() => {});
}

async function selectSucursal(page, sedeNombre) {
  await page.getByText('SUCURSALES', { exact: true }).click();
  const escapeRegExp = (s) =>
    String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Construimos regex tolerante a espacios extra/guiones/etc.
  // Ej: "Pilates Office" -> /Pilates\s*.*\s*Office/i
  const tokens = String(sedeNombre).trim().split(/\s+/).filter(Boolean);
  const sedeRegex = tokens.length
    ? new RegExp(tokens.map(escapeRegExp).join('\\s*.*\\s*'), 'i')
    : new RegExp(escapeRegExp(sedeNombre), 'i');

  // Primero intento match flexible (sin exactitud estricta).
  const sedeLink = page.getByRole('link', { name: sedeRegex }).first();
  try {
    await sedeLink.waitFor({ state: 'attached', timeout: 15000 });
    await sedeLink.scrollIntoViewIfNeeded();
    await sedeLink.click({ timeout: 15000, force: true });
  } catch (_) {
    // Fallback: buscar por texto parcial (algunos labels pueden traer espacios extra).
    const sedeText = page.getByText(sedeRegex, { exact: false }).first();
    await sedeText.waitFor({ state: 'attached', timeout: 15000 });
    await sedeText.scrollIntoViewIfNeeded();
    await sedeText.click({ timeout: 15000, force: true });
  }
  await page.waitForLoadState('networkidle');
}

async function goToCobros(page) {
  // Intentamos ir directo a "Cobros a clientes" (según la sede el menú "Reportes"
  // puede estar colapsado/expandido distinto).
  try {
    const cobros = page.getByRole('link', { name: 'Cobros a clientes' }).first();
    await cobros.waitFor({ state: 'attached', timeout: 15000 });
    await cobros.scrollIntoViewIfNeeded();
    await cobros.click({ timeout: 15000, force: true });
    await page.waitForLoadState('networkidle');
    return;
  } catch (_) {
    // fallback más abajo
  }

  // fallback: Reportes -> Cobros a clientes
  await page.getByRole('link', { name: /Reportes/i }).first().click({ force: true });
  const cobros = page.getByRole('link', { name: 'Cobros a clientes' }).first();
  await cobros.waitFor({ state: 'attached', timeout: 15000 });
  await cobros.scrollIntoViewIfNeeded();
  await cobros.click({ timeout: 15000, force: true });
  await page.waitForLoadState('networkidle');
}

async function setFechaRango(page, desdeISO, hastaISO) {
  const desdeInput = page.getByPlaceholder('Fecha desde');
  const hastaInput = page.getByPlaceholder('Fecha hasta');

  const desdeDMY = formatISOToDMY(desdeISO);
  const hastaDMY = formatISOToDMY(hastaISO);

  // Primero intentamos tipeo directo (evita problemas de mes/año del datepicker).
  // Si el sistema no acepta tipeo, caemos al método por "día".
  try {
    await desdeInput.click();
    await desdeInput.fill('');
    await desdeInput.type(desdeDMY);
    await page.keyboard.press('Enter');

    await hastaInput.click();
    await hastaInput.fill('');
    await hastaInput.type(hastaDMY);
    await page.keyboard.press('Enter');

    // Pequeña espera para que el sistema procese el cambio de fechas.
    await page.waitForTimeout(500);
    return;
  } catch (_) {
    // Fallback por día
  }

  const dayDesde = parseDayFromISO(desdeISO);
  const dayHasta = parseDayFromISO(hastaISO);

  // Click en input -> selector -> click en el día por número (como tu script)
  await page.getByPlaceholder('Fecha desde').click();
  await page.getByRole('link', { name: String(dayDesde), exact: true }).click();

  await page.getByPlaceholder('Fecha hasta').click();
  await page.getByRole('link', { name: String(dayHasta), exact: true }).click();
}

async function marcarAgrupar(page) {
  // Toggle como en el script de prueba
  await page.locator('#labelCheckGroup > i').click();
}

async function ejecutarBusqueda(page) {
  await page.getByRole('link', { name: /Buscar/i }).click();
  await page.waitForLoadState('networkidle');

  // En tu script de prueba, después de "Buscar" hacés click en:
  // "XX conceptos encontrados -"
  // Ese click suele abrir/expandir el resultado donde aparece el total.
  try {
    // Regex estricto: número + "conceptos encontrados" + guion ( '-' o '–' ).
    const conceptosStrict = page
      .getByText(/\d+\s+conceptos encontrados\s*[-–]\s*/i)
      .first();
    await conceptosStrict.scrollIntoViewIfNeeded();
    await conceptosStrict.click({ timeout: 15000, force: true });
  } catch (_) {
    try {
      // Regex flexible: solo "conceptos encontrados" + guion.
      const conceptosLoose = page
        .getByText(/conceptos encontrados\s*[-–]\s*/i)
        .first();
      await conceptosLoose.scrollIntoViewIfNeeded();
      await conceptosLoose.click({ timeout: 15000, force: true });
    } catch (_) {
      // Si no se puede, seguimos igual para que el lector de total intente
      // capturar lo que haya en pantalla.
    }
  }
  await page.waitForLoadState('networkidle');
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
  // Ej: tokens ["Pilara","Pilates","Clase de prueba"] -> /Pilara\s*[-–]\s*Pilates\s*[-–]\s*Clase de prueba/i
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
  // Esto evita depender de un locator exacto cuando hay cambios de layout.
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

  // Contexto mínimo para debug: buscamos "total"/"facturado" y redactamos dígitos.
  const lower = String(bodyText).toLowerCase();
  const redact = (s) => String(s).replace(/\d/g, '#');
  const phrases = ['total facturado', 'total cobrado', 'factur', 'facturado', 'cobrado', 'total'];
  const contexts = phrases
    .map((ph) => {
      const pos = lower.indexOf(ph);
      if (pos < 0) return null;
      const start = Math.max(0, pos - 80);
      const end = Math.min(bodyText.length, pos + 220);
      return `${ph}: ${redact(bodyText.slice(start, end))}`;
    })
    .filter(Boolean);

  const contextMsg = contexts.length
    ? `\nContexto encontrado:\n${contexts.join('\n')}`
    : '';

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

  await page
    .screenshot({ path: screenshotPath, fullPage: true })
    .catch(() => {});

  throw new Error(
    `No se pudo leer "Total facturado" del reporte.${contextMsg}\nDebug: ${screenshotPath}\nDebug: ${debugTxtPath}`
  );
}

async function obtenerReporteQuincenal({
  desde,
  hasta,
  sedes,
  onSede,
  onProgress,
  isCancelled,
}) {
  // Si `sedes` viene como array, lo respetamos incluso si está vacío.
  // Si no viene (undefined), usamos la lista por defecto.
  const sedesAUsar = Array.isArray(sedes) ? sedes : localesDefault;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await login(page);

    const resultados = [];
    const total = sedesAUsar.length;
    let processed = 0;

    for (const sede of sedesAUsar) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      if (typeof onProgress === 'function') {
        onProgress({ processed, total, sede });
      }

      await selectSucursal(page, sede);
      await goToCobros(page);
      await setFechaRango(page, desde, hasta);
      await marcarAgrupar(page);
      await ejecutarBusqueda(page);
      const monto = await leerTotalFacturado(page, { sede });
      const cantidadClasePrueba = await sumarCantidadClasesPrueba(page, sede);

      resultados.push({ sede, montoFacturado: monto, cantidadClasePrueba });

      processed += 1;
      if (typeof onSede === 'function') {
        onSede({
          sede,
          montoFacturado: monto,
          cantidadClasePrueba,
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseISODateParts(iso) {
  const [y, m, d] = String(iso || '').split('-').map((x) => Number(x));
  return { y, m, d };
}

function isoFromYMD(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function isoMin(a, b) {
  return String(a) <= String(b) ? a : b;
}

function isoMax(a, b) {
  return String(a) >= String(b) ? a : b;
}

/**
 * Reporte comparativo por meses para una misma sede:
 * - Compara el mismo rango de días (definido por `desde` y `hasta`)
 *   entre el mes actual (offset=0) y meses anteriores (offset>0).
 */
async function obtenerReporteCobrosComparativoSede({
  desde,
  hasta,
  sedes,
  onSede,
  onProgress,
  monthsBack = 1,
  isCancelled,
}) {
  const sedesAUsar = Array.isArray(sedes) ? sedes : localesDefault;
  const monthsBackSafe = Number.isFinite(Number(monthsBack))
    ? Math.max(0, Math.floor(Number(monthsBack)))
    : 1;

  const { y: baseY, m: baseM, d: baseDDesde } = parseISODateParts(desde);
  const { y: baseY2, m: baseM2, d: baseDHasta } = parseISODateParts(hasta);
  if (!baseY || !baseM || !baseDDesde || !baseDHasta || !baseY2 || !baseM2) {
    throw new Error(`Cobros comparativo: 'desde/hasta' inválidas: ${desde} - ${hasta}`);
  }

  // Asumimos que `desde` y `hasta` están dentro del mismo mes (por UI normal).
  // Usamos solo la parte "día del mes" para replicar en meses anteriores.
  const dayDesde = baseDDesde;
  const dayHasta = baseDHasta;

  const pad2Local = (n) => String(n).padStart(2, '0');
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

  const mesES = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  const buildPeriodForOffset = (offset) => {
    // offset=0 => mes base; offset=1 => mes anterior.
    const dt = new Date(Date.UTC(baseY, baseM - 1, 1));
    dt.setUTCMonth(dt.getUTCMonth() - offset);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;

    const maxD = daysInMonth(y, m);
    const d1 = Math.min(dayDesde, maxD);
    const d2 = Math.min(dayHasta, maxD);

    const desdeISO = isoFromYMD(y, m, d1);
    const hastaISO = isoFromYMD(y, m, d2);

    const label = `${mesES[m - 1]} ${y} (${pad2Local(d1)}-${pad2Local(d2)})`;

    return { desdeISO, hastaISO, label };
  };

  // Queremos mostrar de más antiguo -> más nuevo.
  // offset=monthsBackSafe => mes más antiguo; offset=0 => mes actual.
  const periodos = [];
  for (let i = monthsBackSafe; i >= 0; i--) {
    periodos.push(buildPeriodForOffset(i));
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await login(page);

    const resultados = [];
    const total = sedesAUsar.length;
    let processed = 0;

    for (const sede of sedesAUsar) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      if (typeof onProgress === 'function') {
        onProgress({ processed, total, sede });
      }

      await selectSucursal(page, sede);

      const periodosResults = [];
      for (const p of periodos) {
        // Volvemos al reporte para asegurar el estado correcto.
        await goToCobros(page);
        await setFechaRango(page, p.desdeISO, p.hastaISO);
        await marcarAgrupar(page);
        await ejecutarBusqueda(page);
        const monto = await leerTotalFacturado(page, { sede });
        periodosResults.push({
          label: p.label,
          monto: monto ?? null,
          desdeISO: p.desdeISO,
          hastaISO: p.hastaISO,
        });
      }

      resultados.push({
        sede,
        periodos: periodosResults.map((x) => ({
          label: x.label,
          monto: x.monto,
        })),
      });

      processed += 1;
      if (typeof onSede === 'function') {
        onSede({
          sede,
          periodos: periodosResults.map((x) => ({
            label: x.label,
            monto: x.monto,
          })),
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

async function obtenerPreciosSedes({
  sedes,
  onRow,
  onProgress,
  isCancelled,
}) {
  const sedesWanted = Array.isArray(sedes) ? sedes : undefined;
  const sedeWanted0 = sedesWanted && sedesWanted.length ? sedesWanted[0] : '';
  const sedeContextSelected = Boolean(sedeWanted0);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await login(page);
    // Nota: screenshots por paso para depurar sucursal/tabla.
    const ts0 = new Date().toISOString().replace(/[:.]/g, '-');
    const stepsBase = path.join(DEBUG_DIR, `precios_sedes_steps_${ts0}`);

    const safeStepName = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\\-]/g, '');

    const stepSnap = async (idx, name, extraLines = []) => {
      try {
        const safe = safeStepName(name);
        const snapPath = `${stepsBase}_${idx}_${safe}.png`;
        await page
          .screenshot({ path: snapPath, fullPage: true })
          .catch(() => {});
        const txtPath = `${stepsBase}_${idx}_${safe}.txt`;
        fs.writeFileSync(
          txtPath,
          [
            `step=${idx}`,
            `name=${name}`,
            `sedeWanted0=${sedeWanted0}`,
            ...extraLines,
          ].join('\n') + '\n',
          'utf8'
        );
      } catch (_) {}
    };

    await stepSnap(1, 'after_login');

    // Ir al reporte "Precios Sedes" (Reportes de conceptos)
    await page.goto('https://deportnet.com/reportConcepts', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);
    await stepSnap(2, 'after_goto_reportConcepts');

    // IMPORTANTE: para que el contenido de la tabla corresponda a la sucursal
    // seleccionada (y no a la sede por defecto), primero seleccionamos la sede.
    if (sedeWanted0) {
      try {
        await selectSucursal(page, sedeWanted0);
        await page.waitForTimeout(1200);
        // En DeportNet, al cambiar sucursal suele recargar otra vista (dashboard).
        // Para asegurar el contexto correcto, volvemos explícitamente al reporte.
        await page.goto('https://deportnet.com/reportConcepts', {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForTimeout(1500);
      } catch (_) {
        // Si el selector falla por cambios en la UI, igual intentamos por texto.
      }
    }
    await stepSnap(3, 'after_selectSucursal');

    // Filtro: Servicios/Membresias
    // Intentamos varias estrategias por si es select/option o lista.
    const servicesText = 'Servicios/Membresias';
    try {
      const loc = page.getByText(servicesText, { exact: false }).first();
      await loc.waitFor({ timeout: 5000 }).catch(() => {});
      await loc.click({ force: true, timeout: 5000 });
    } catch (_) {}

    try {
      const loc = page.getByRole('option', { name: /Servicios\/Membresias/i }).first();
      await loc.waitFor({ timeout: 5000 }).catch(() => {});
      await loc.click({ force: true, timeout: 5000 });
    } catch (_) {}
    await stepSnap(4, 'after_filter_servicios_membresias');

    // Checkbox: Activos
    try {
      const activos = page.getByRole('checkbox', { name: /Activos/i }).first();
      await activos.waitFor({ timeout: 5000 }).catch(() => {});
      const checked = await activos.isChecked().catch(() => null);
      if (checked === false || checked === null) {
        await activos.click({ force: true, timeout: 5000 });
      }
    } catch (_) {
      // Fallback: click por texto
      try {
        await page.getByText(/Activos/i).first().click({ force: true, timeout: 5000 });
      } catch (_) {}
    }
    await stepSnap(5, 'after_checkbox_activos');

    // Botón Buscar (o equivalente)
    try {
      const buscarBtn = page.getByRole('button', { name: /Buscar/i }).first();
      await buscarBtn.waitFor({ timeout: 5000 }).catch(() => {});
      await buscarBtn.click({ force: true, timeout: 5000 });
    } catch (_) {
      try {
        const buscarLink = page.getByRole('link', { name: /Buscar/i }).first();
        await buscarLink.waitFor({ timeout: 5000 }).catch(() => {});
        await buscarLink.click({ force: true, timeout: 5000 });
      } catch (_) {
        // si el reporte carga automáticamente con filtros, seguimos igual
      }
    }
    await stepSnap(6, 'after_click_buscar');

    // Esperar tabla
    const tsWait = new Date().toISOString().replace(/[:.]/g, '-');
    const debugWaitBase = path.join(DEBUG_DIR, `precios_sedes_wait_${tsWait}`);
    await page
      .screenshot({ path: `${debugWaitBase}_before_wait.png`, fullPage: true })
      .catch(() => {});

    try {
      await page.locator('table tbody tr').first().waitFor({ timeout: 60000 });
    } catch (e) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      fs.writeFileSync(
        `${debugWaitBase}.txt`,
        [
          `error=${e && e.message ? e.message : String(e)}`,
          `body_has_pilates=${/pilates/i.test(bodyText)}`,
          `body_snippet=${bodyText.slice(0, 2000)}`,
        ].join('\n') + '\n',
        'utf8'
      );
      await page
        .screenshot({ path: `${debugWaitBase}_after_timeout.png`, fullPage: true })
        .catch(() => {});
      throw new Error(
        `Precios Sedes: no se encontró 'table tbody tr' luego de aplicar filtros. Ver ${debugWaitBase}_before_wait.png/.txt`
      );
    }

    // Guardamos un sample de filas para confirmar la sede real en la grilla.
    try {
      const sampleServices = [];
      const sampleCount = 6;
      for (let i = 0; i < sampleCount; i++) {
        const servicioSample = await page
          .locator('table tbody tr')
          .nth(i)
          .locator('td')
          .first()
          .innerText()
          .catch(() => '');
        if (servicioSample) {
          sampleServices.push(servicioSample.trim());
        }
      }
      await stepSnap(7, 'after_table_loaded', [
        `sampleServices=${JSON.stringify(sampleServices)}`,
      ]);
    } catch (_) {
      await stepSnap(7, 'after_table_loaded');
    }

    const headerTexts = await page.locator('table thead tr th').allTextContents();
    const headerSedesAll = headerTexts.slice(1).map((t) => String(t).trim()).filter(Boolean);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const debugBase = path.join(DEBUG_DIR, `precios_sedes_${ts}`);
    await page
      .screenshot({ path: `${debugBase}.png`, fullPage: true })
      .catch(() => {});

    const totalRowsDebug = await page.locator('table tbody tr').count();
    const firstRow = page.locator('table tbody tr').first();
    const firstRowCells = await firstRow
      .locator('td')
      .allTextContents()
      .catch(() => []);
    const firstServicioDebug =
      firstRowCells && firstRowCells.length ? String(firstRowCells[0]).trim() : '';

    // Debug de índices: guardamos td de las primeras filas.
    const sampleRows = [];
    try {
      for (let i = 0; i < Math.min(5, totalRowsDebug); i++) {
        const rowI = page.locator('table tbody tr').nth(i);
        const cellsI = await rowI
          .locator('td')
          .allTextContents()
          .catch(() => []);
        sampleRows.push({ i, cells: cellsI });
      }
    } catch (_) {}

    fs.writeFileSync(
      `${debugBase}.txt`,
      [
        `sedesWanted=${JSON.stringify(sedesWanted || null)}`,
        `headerSedesAll=${JSON.stringify(headerSedesAll)}`,
        `totalRows=${totalRowsDebug}`,
        `firstServicio=${firstServicioDebug}`,
        `firstRowCells=${JSON.stringify(firstRowCells)}`,
        `sampleRows=${JSON.stringify(sampleRows, null, 2)}`,
      ].join('\n') + '\n',
      'utf8'
    );

    if (!headerSedesAll.length) {
      throw new Error(
        `Precios Sedes: no se detectaron encabezados de sedes en la tabla. Ver ${debugBase}.png/.txt`
      );
    }
    if (totalRowsDebug === 0) {
      throw new Error(
        `Precios Sedes: la tabla no tiene filas. Ver ${debugBase}.png/.txt`
      );
    }

    const normalize = (s) =>
      String(s)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const extractSedeNameFromLocale = (locale) => {
      const s = String(locale || '').trim();
      if (/^CLIC Pilates\s*-\s*/i.test(s)) return s.replace(/^CLIC Pilates\s*-\s*/i, '').trim();
      if (/^Pilates\s*-\s*/i.test(s)) return s.replace(/^Pilates\s*-\s*/i, '').trim();
      return s;
    };

    // Normalizamos para comparar strings con diacríticos/espacios.
    const normalizeText = (str) => {
      return String(str || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const extractPlanRemainder = (servicioText) => {
      const servicioStr = String(servicioText || '');
      // Caso actual: ".... - Pilates - <REMAINDER>"
      // Nota: usamos [\\s\\S]* para que capture saltos de línea dentro del td.
      const m = /Pilates\s*-\s*([\s\S]*)$/i.exec(servicioStr);
      if (m && m[1]) return m[1];
      // Fallback si cambia el formato y ya no existe "Pilates -":
      // ".... <REMAINDER con Mensual - ...>"
      const m2 = /(Mensual\s*-\s*[\s\S]*)$/i.exec(servicioStr);
      if (m2 && m2[1]) return m2[1];
      return '';
    };

    const trimRemainderToPayment = (remainderNorm) => {
      const deb = 'debito automatico';
      const ef = 'efectivo/transferencia';
      let out = String(remainderNorm || '');
      const idxDeb = out.indexOf(deb);
      if (idxDeb >= 0) {
        out = out.slice(0, idxDeb + deb.length).trim();
        return out;
      }
      const idxEf = out.indexOf(ef);
      if (idxEf >= 0) {
        out = out.slice(0, idxEf + ef.length).trim();
        return out;
      }
      return out;
    };

    const planesNorm = Array.isArray(preciosSedesPlanesActivos)
      ? preciosSedesPlanesActivos.map((p) => normalizeText(p))
      : [];

    const sedePrefixWanted0 = sedeWanted0
      ? extractSedeNameFromLocale(sedeWanted0)
      : '';

    // Solo nos interesa "Precio 1".
    // headerSedesAll es headerTexts.slice(1): [Estado, Precio 1, Precio 2, ...]
    const precio1HeaderIdx = headerSedesAll.findIndex((h) => /Precio\s*1/i.test(String(h)));
    if (precio1HeaderIdx < 0) {
      throw new Error(
        `Precios Sedes: no se detectó columna "Precio 1". headerSedesAll=${JSON.stringify(
          headerSedesAll
        )}`
      );
    }

    // tdIdx: td[0]=servicio, td[1]=Estado, td[2]=Precio 1...
    const precio1TdIdx = 1 + precio1HeaderIdx;
    const precio1SedeLabel = sedePrefixWanted0 || 'Precio 1';

    const totalRows = totalRowsDebug;
    let processed = 0;

    if (typeof onProgress === 'function') {
      onProgress({ processed, total: totalRows, sede: '' });
    }

    const rows = page.locator('table tbody tr');
    const debugSamples = [];
    const maxDebugSamples = 12;
    let matchedCount = 0;
    let debugWritten = false;
    const debugRowSamples = [];
    const maxDebugRowSamples = 8;
    let debugRowSamplesWritten = false;
    for (let r = 0; r < totalRows; r++) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      const row = rows.nth(r);
      const servicioRaw = await row
        .locator('td')
        .first()
        .innerText()
        .catch(() => '');
      const servicio = String(servicioRaw).trim();
      if (!servicio) continue;

      // Saltamos el bloque/grupo cuando la primera celda es el título del filtro.
      if (/servicios\/membres/i.test(servicio)) continue;

      // Estado en la tabla (Activo/Inactivo) => td[1]
      const estadoRaw = await row
        .locator('td')
        .nth(1)
        .innerText()
        .catch(() => '');
      const estadoText = String(estadoRaw);
      const estadoNorm = normalizeText(estadoText);

      // Debug: guardamos los primeros renglones reales (aunque no matcheen)
      // para validar índices y formato de texto.
      if (debugRowSamples.length < maxDebugRowSamples) {
        const remainderDbg = extractPlanRemainder(servicio);
        const remainderDbgNorm = normalizeText(remainderDbg);
        const remainderDbgNormTrim = trimRemainderToPayment(remainderDbgNorm);
        const matchPlaneDbg = planesNorm.some(
          (p) => remainderDbgNormTrim === p
        );
        const looksLikePlan =
          remainderDbgNorm.includes('mensual') ||
          remainderDbgNorm.includes('pack') ||
          remainderDbgNorm.includes('vxs');

        const sedePrefixNorm = sedePrefixWanted0
          ? normalizeText(`${sedePrefixWanted0} - Pilates`)
          : '';
        const servicioNormDbg = normalizeText(servicio);
        // Si seleccionamos sucursal con DeportNet, no dependemos del prefijo de texto.
        const sedeMatchesWanted = sedeContextSelected
          ? true
          : sedePrefixNorm
            ? servicioNormDbg.includes(sedePrefixNorm)
            : true;

        if (looksLikePlan && sedeMatchesWanted) {
          debugRowSamples.push({
            servicio,
            estadoText,
            estadoNorm,
            remainderDbgNorm: remainderDbgNormTrim,
            matchPlaneDbg,
          });
        }
      }
      if (!debugRowSamplesWritten && debugRowSamples.length >= maxDebugRowSamples) {
        try {
          fs.writeFileSync(
            `${debugBase}_rowsSamples.txt`,
            [
              `precio1SedeLabel=${precio1SedeLabel}`,
              `sedePrefixWanted0=${sedePrefixWanted0}`,
              `totalRows=${totalRows}`,
              `planesNorm=${JSON.stringify(planesNorm)}`,
              `rowsSamples=${JSON.stringify(debugRowSamples, null, 2)}`,
            ].join('\n') + '\n',
            'utf8'
          );
          debugRowSamplesWritten = true;
        } catch (_) {}
      }

      if (!/activo/.test(estadoNorm)) continue;

      // Si ya seleccionamos la sucursal, el filtrado por texto de sede suele ser frágil
      // porque DeportNet puede cambiar el formato del nombre en pantalla.
      if (!sedeContextSelected && sedePrefixWanted0) {
        const sedePrefixNorm = normalizeText(`${sedePrefixWanted0} - Pilates`);
        const servicioNorm = normalizeText(servicio);
        if (!servicioNorm.includes(sedePrefixNorm)) continue;
      }

      // Extraemos el resto luego de "Pilates - "
      // Ej: "Palermo Hollywood - Pilates - Mensual - 1 vxs - Debito Automatico"
      const remainder = extractPlanRemainder(servicio);
      if (!remainder) continue;
      const remainderNorm = trimRemainderToPayment(normalizeText(remainder));

      // Solo aceptar planes definidos (a veces el resto trae sufijos adicionales,
      // por eso usamos igualdad o includes).
      const matchPlane = planesNorm.some((p) => remainderNorm === p);
      if (!matchPlane) {
        if (debugSamples.length < maxDebugSamples) {
          debugSamples.push({
            servicio,
            estadoText,
            remainderNorm,
          });
        }
        if (!debugWritten && debugSamples.length >= maxDebugSamples) {
          try {
            fs.writeFileSync(
              `${debugBase}_filterSamples.txt`,
              [
                `precio1SedeLabel=${precio1SedeLabel}`,
                `sedePrefixWanted0=${sedePrefixWanted0}`,
                `totalRows=${totalRows}`,
                `matchedCount=${matchedCount}`,
                `planesNorm=${JSON.stringify(planesNorm)}`,
                `samples=${JSON.stringify(debugSamples, null, 2)}`,
              ].join('\n') + '\n',
              'utf8'
            );
            debugWritten = true;
          } catch (_) {
            // ignore
          }
        }
        continue;
      }

      matchedCount += 1;

      const priceRaw = await row
        .locator('td')
        .nth(precio1TdIdx)
        .innerText()
        .catch(() => '');
      const priceText = String(priceRaw);
      const hasDigits = /[0-9]/.test(priceText);
      const precio1 = hasDigits ? parseMoneyToNumber(priceText) : null;

      processed += 1;
      if (typeof onSede === 'function') {
        // No usamos en este reporte.
      }

      if (typeof onRow === 'function') {
        onRow({
          servicio,
          precio1,
          precio1SedeLabel,
          processed,
          total: totalRows,
        });
      }

      if (typeof onProgress === 'function') {
        onProgress({ processed, total: totalRows, sede: servicio });
      }
    }

    if (debugSamples.length && typeof debugBase === 'string') {
      try {
        fs.writeFileSync(
          `${debugBase}_filterSamples.txt`,
          [
            `precio1SedeLabel=${precio1SedeLabel}`,
            `sedePrefixWanted0=${sedePrefixWanted0}`,
            `totalRows=${totalRows}`,
            `matchedCount=${matchedCount}`,
            `planesNorm=${JSON.stringify(planesNorm)}`,
            `samples=${JSON.stringify(debugSamples, null, 2)}`,
          ].join('\n') + '\n',
          'utf8'
        );
      } catch (_) {
        // Ignorar fallos de debug
      }
    }

    return { rows: [] };
  } finally {
    await browser.close();
  }
}

// Fachada: el backend ahora exporta desde módulos más pequeños.
// Dejamos este archivo para compatibilidad histórica.
module.exports = require('./deportnetClientFacade');

