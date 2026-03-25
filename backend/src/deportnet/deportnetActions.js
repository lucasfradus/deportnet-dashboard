const requireEnv = require('dotenv').config;

requireEnv();

const BASE_URL = 'https://deportnet.com/';

function parseDayFromISO(isoDate) {
  // Esperamos "YYYY-MM-DD"
  const parts = String(isoDate).split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(
      `Formato de fecha inválido (se espera YYYY-MM-DD): ${isoDate}`
    );
  }
  const [, , day] = parts;
  return day;
}

function formatISOToDMY(isoDate) {
  // Esperamos "YYYY-MM-DD"
  const parts = String(isoDate).split('-');
  if (parts.length !== 3)
    throw new Error(`Formato de fecha inválido: ${isoDate}`);
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

  // Esperamos un tiempo fijo para que cargue la pantalla luego del login.
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

  // Primero intento match flexible.
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
  // Intentamos ir directo a "Cobros a clientes"
  // (según la sede el menú "Reportes" puede estar colapsado/expandido).
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

  await page
    .getByRole('link', { name: /Reportes/i })
    .first()
    .click({ force: true });

  const cobros = page.getByRole('link', { name: 'Cobros a clientes' }).first();
  await cobros.waitFor({ state: 'attached', timeout: 15000 });
  await cobros.scrollIntoViewIfNeeded();
  await cobros.click({ timeout: 15000, force: true });
  await page.waitForLoadState('networkidle');
}

/**
 * Intenta rellenar desde/hasta. Usa "attached" + force: Material a vece marca el input como no visible.
 * Angular suele poner formControlName en el DOM como formcontrolname="dateFrom" sin atributo name.
 */
async function tryFillParFechas(page, desdeLoc, hastaLoc, desdeDMY, hastaDMY) {
  const a = desdeLoc.first();
  const b = hastaLoc.first();
  await a.waitFor({ state: 'attached', timeout: 15000 });
  await b.waitFor({ state: 'attached', timeout: 15000 });
  await a.scrollIntoViewIfNeeded();
  await b.scrollIntoViewIfNeeded();
  await a.click({ force: true });
  await a.fill('', { force: true });
  await a.fill(desdeDMY, { force: true });
  await b.click({ force: true });
  await b.fill('', { force: true });
  await b.fill(hastaDMY, { force: true });
  await page.waitForTimeout(400);
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} root Documento o iframe
 */
function locatorsParesFechaDesdeHasta(root) {
  return [
    // branchMembersClassesReport (jQuery datepicker, según DOM real DeportNet)
    [root.locator('#dateFrom'), root.locator('#dateTo')],
    [root.locator('input#dateFrom'), root.locator('input#dateTo')],
    [
      root.locator('input.datepicker[name="dateFrom"]'),
      root.locator('input.datepicker[name="dateTo"]'),
    ],
    [root.locator('input[name="dateFrom"]'), root.locator('input[name="dateTo"]')],
    [
      root.locator('input[formcontrolname="dateFrom"]'),
      root.locator('input[formcontrolname="dateTo"]'),
    ],
    [
      root.locator('[formcontrolname="dateFrom"]'),
      root.locator('[formcontrolname="dateTo"]'),
    ],
    [
      root.locator('input.mat-mdc-input-element[name="dateFrom"]'),
      root.locator('input.mat-mdc-input-element[name="dateTo"]'),
    ],
    [
      root.locator('input.mat-mdc-input-element[formcontrolname="dateFrom"]'),
      root.locator('input.mat-mdc-input-element[formcontrolname="dateTo"]'),
    ],
    [
      root.getByRole('textbox', { name: 'dateFrom' }),
      root.getByRole('textbox', { name: 'dateTo' }),
    ],
    [root.getByPlaceholder('Fecha desde'), root.getByPlaceholder('Fecha hasta')],
    [root.getByPlaceholder(/fecha\s*desde/i), root.getByPlaceholder(/fecha\s*hasta/i)],
  ];
}

function todosLosRoots(page) {
  return page.frames();
}

async function trySetJQueryDatepickerIds(page, root, desdeDMY, hastaDMY) {
  const df = root.locator('#dateFrom');
  const dt = root.locator('#dateTo');
  if ((await df.count()) === 0 || (await dt.count()) === 0) return false;
  await df.first().evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, desdeDMY);
  await dt.first().evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, hastaDMY);
  await page.waitForTimeout(400);
  return true;
}

async function setFechaRango(page, desdeISO, hastaISO) {
  const desdeDMY = formatISOToDMY(desdeISO);
  const hastaDMY = formatISOToDMY(hastaISO);

  const roots = todosLosRoots(page);
  const pares = roots.flatMap((root) => locatorsParesFechaDesdeHasta(root));

  for (const root of roots) {
    try {
      if (await trySetJQueryDatepickerIds(page, root, desdeDMY, hastaDMY)) return;
    } catch (_) {
      /* siguiente root */
    }
  }

  for (const [desdeLoc, hastaLoc] of pares) {
    try {
      if ((await desdeLoc.count()) === 0 || (await hastaLoc.count()) === 0) continue;
      await tryFillParFechas(page, desdeLoc, hastaLoc, desdeDMY, hastaDMY);
      return;
    } catch (_) {
      // siguiente par
    }
  }

  // Segundo intento: tipeo + Enter (algunos flujos viejos)
  for (const [desdeLoc, hastaLoc] of pares) {
    try {
      if ((await desdeLoc.count()) === 0 || (await hastaLoc.count()) === 0) continue;
      const a = desdeLoc.first();
      const b = hastaLoc.first();
      await a.waitFor({ state: 'attached', timeout: 10000 });
      await b.waitFor({ state: 'attached', timeout: 10000 });
      await a.click({ force: true });
      await a.fill('', { force: true });
      await a.fill(desdeDMY, { force: true });
      await page.keyboard.press('Enter');
      await b.click({ force: true });
      await b.fill('', { force: true });
      await b.fill(hastaDMY, { force: true });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      return;
    } catch (_) {}
  }

  // Fallback por calendario (clic en día): mismos pares (documento + iframes)
  const dayDesde = parseDayFromISO(desdeISO);
  const dayHasta = parseDayFromISO(hastaISO);

  let lastErr = null;
  for (const [od, oh] of pares) {
    try {
      if ((await od.count()) === 0 || (await oh.count()) === 0) continue;
      await od.first().click({ timeout: 10000, force: true });
      await page
        .getByRole('link', { name: String(dayDesde), exact: true })
        .click({ timeout: 10000 });

      await oh.first().click({ timeout: 10000, force: true });
      await page
        .getByRole('link', { name: String(dayHasta), exact: true })
        .click({ timeout: 10000 });
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  throw (
    lastErr ||
    new Error(
      'setFechaRango: no se encontraron #dateFrom/#dateTo ni name=dateFrom/dateTo (revisá iframe o ruta del reporte).'
    )
  );
}

async function marcarAgrupar(page) {
  // Toggle como en el script de prueba.
  await page.locator('#labelCheckGroup > i').click();
}

async function ejecutarBusqueda(page) {
  await page.getByRole('link', { name: /Buscar/i }).click();
  await page.waitForLoadState('networkidle');

  // Click en "XX conceptos encontrados -"
  // para expandir el resultado donde aparece el total.
  try {
    const conceptosStrict = page
      .getByText(/\d+\s+conceptos encontrados\s*[-–]\s*/i)
      .first();
    await conceptosStrict.scrollIntoViewIfNeeded();
    await conceptosStrict.click({ timeout: 15000, force: true });
  } catch (_) {
    try {
      const conceptosLoose = page
        .getByText(/conceptos encontrados\s*[-–]\s*/i)
        .first();
      await conceptosLoose.scrollIntoViewIfNeeded();
      await conceptosLoose.click({ timeout: 15000, force: true });
    } catch (_) {
      // Si no se puede, seguimos igual para que el lector de total intente capturar.
    }
  }

  await page.waitForLoadState('networkidle');
}

module.exports = {
  login,
  selectSucursal,
  goToCobros,
  setFechaRango,
  formatISOToDMY,
  marcarAgrupar,
  ejecutarBusqueda,
};

