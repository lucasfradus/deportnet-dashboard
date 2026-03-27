const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { login, selectSucursal } = require('../deportnetActions');
const { findMatchingPlaneScored } = require('./reportePreciosSedes');

const localesDefault = require('../../../../shared/locales.json');

const REPORT_URLS = [
  'https://deportnet.com/reportMembersWithValidActivities',
  'https://deportnet.com/ReportMembersWithValidActivities',
];

const DEBUG_DIR = path.join(__dirname, '..', '..', 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

/** Plan canónico en precios-sedes-planes-activos (el texto en DeportNet suele llevar prefijo de sucursal). */
const PLAN_CANONICO_CDP_EFECTIVO = 'Pilates - Clase de prueba - Efectivo/Transferencia';

function foldDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Encuentra un plan del catálogo precios-sedes-planes-activos.json (misma lógica que Precios sedes).
 * Incluye variantes "Pilates Reformer - …" que en muchas sedes no matchean el patrón " - Pilates - ".
 */
function matchServicioAlCatalogo(rawServicio) {
  const full = String(rawServicio || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!full) return null;

  const candidates = [full];
  const m = full.match(/^(?:.*?)\s*-\s*Pilates\s*-\s*(.+)$/i);
  if (m) {
    const rest = m[1].trim();
    candidates.push(`Pilates - ${rest}`, rest);
  }
  const mRef = full.match(/^(?:.*?)\s*-\s*Pilates\s+Reformer\s*-\s*(.+)$/i);
  if (mRef) {
    const rest = mRef[1].trim();
    candidates.push(`Pilates Reformer - ${rest}`, `Pilates - ${rest}`, rest);
  }

  let best = null;
  for (const c of candidates) {
    const hit = findMatchingPlaneScored(c);
    if (hit && (!best || hit.score > best.score)) best = hit;
  }

  if (!best) {
    const lo = foldDiacritics(full)
      .replace(/[–−]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (
      /\bclase\s+de\s+prueba\b/.test(lo) &&
      !/\b(mensual|trimestral|semestral|clase\s+individual|clase\s+suelta|pack\s+\d|pack\s+ilimitado)\b/i.test(lo)
    ) {
      best = { plane: PLAN_CANONICO_CDP_EFECTIVO, score: 1 };
    }
  }

  return best;
}

function normHeader(h) {
  return String(h || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Misma cantidad de entradas que <th> en el DOM (no filtrar vacíos: desalinea índices con <td>).
 */
function normHeadersAlineados(headers) {
  return headers.map((h) => normHeader(h));
}

function indiceServicioMembresia(headersNorm) {
  const compact = (s) => String(s || '').replace(/\s+/g, '');
  const byStrict = headersNorm.findIndex((hn) => /^servicio\/membresia$/i.test(compact(hn)));
  if (byStrict >= 0) return byStrict;
  return headersNorm.findIndex(
    (hn) => hn.includes('servicio') && hn.includes('membres') && !hn.includes('previo')
  );
}

function indiceEmail(headersNorm) {
  return headersNorm.findIndex(
    (hn) =>
      hn === 'email' ||
      hn.includes('correo') ||
      hn.endsWith(' email') ||
      /^e-?mail$/i.test(hn)
  );
}

function indiceSocio(headersNorm) {
  return headersNorm.findIndex((hn) => hn === 'socio' || hn.startsWith('socio '));
}

/** Columna «Nombre» del reporte; si no existe, se usa «Socio» como respaldo. */
function indiceNombreColumna(headersNorm, socioIdx) {
  const byExact = headersNorm.findIndex((hn) => hn === 'nombre');
  if (byExact >= 0) return byExact;
  const byWord = headersNorm.findIndex(
    (hn) => /\bnombre\b/.test(hn) && !hn.includes('usuario') && !hn.includes('servicio')
  );
  if (byWord >= 0) return byWord;
  return socioIdx;
}

function normNombreDesdeCelda(raw) {
  const s = foldDiacritics(String(raw || ''))
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return s;
}

/** Cliente para cabecera: email si hay @; si no, nombre normalizado (evita homónimos con distinto mail). */
function claveClienteCabecera(cells, emailIdx, nombreIdx) {
  const emailRaw =
    emailIdx >= 0 && cells[emailIdx] != null ? String(cells[emailIdx]).trim().toLowerCase() : '';
  const email = foldDiacritics(emailRaw).replace(/\s+/g, ' ').trim();
  if (email && email.includes('@')) return `e:${email}`;
  const nombreNorm = normNombreDesdeCelda(cells[nombreIdx] != null ? cells[nombreIdx] : '');
  if (nombreNorm) return `n:${nombreNorm}`;
  return null;
}

/** Igualdad de filas duplicadas (Material): mismo cliente + mismo texto de servicio. */
function servicioNormParaDedupe(rawServicio) {
  const t = foldDiacritics(String(rawServicio || ''))
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return t || '__empty__';
}

/** Fila con servicio de clase de prueba (catálogo CDP Efectivo o texto equivalente). */
function filaEsServicioPrueba(rawServicio) {
  const full = String(rawServicio || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!full) return false;
  const hit = matchServicioAlCatalogo(full);
  if (hit && hit.plane === PLAN_CANONICO_CDP_EFECTIVO) return true;
  const lo = foldDiacritics(full)
    .replace(/[–−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\bclase\s+de\s+prueba\b/.test(lo)) return false;
  if (/\b(mensual|trimestral|semestral|clase\s+individual|clase\s+suelta|pack\s+\d|pack\s+ilimitado)\b/i.test(lo)) {
    return false;
  }
  return true;
}

function claveDedupeFila(cells, socioIdx, emailIdx) {
  const emailRaw = emailIdx >= 0 && cells[emailIdx] != null ? String(cells[emailIdx]).trim().toLowerCase() : '';
  const email = foldDiacritics(emailRaw).replace(/\s+/g, ' ').trim();
  if (email && email.includes('@')) return `e:${email}`;
  const socioRaw = socioIdx >= 0 && cells[socioIdx] != null ? String(cells[socioIdx]).trim() : '';
  const socio = foldDiacritics(socioRaw)
    .toLowerCase()
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (socio) return `s:${socio}`;
  return '';
}

async function leerCeldasFila(row, minCells) {
  let cells = await row.getByRole('cell').allTextContents().catch(() => []);
  if (cells.length >= minCells) return cells;
  cells = await row.locator(':scope > td').allTextContents().catch(() => []);
  if (cells.length >= minCells) return cells;
  return row.locator('td').allTextContents().catch(() => []);
}

async function abrirReporteSociosActivos(page) {
  let lastErr;
  for (const url of REPORT_URLS) {
    let ok = false;
    for (let i = 0; i < 2 && !ok; i += 1) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        ok = true;
      } catch (e) {
        lastErr = e;
        await page.waitForTimeout(1200);
      }
    }
    if (ok) {
      await page.waitForTimeout(2000);
      return url;
    }
  }
  throw lastErr || new Error('No se pudo abrir el reporte de socios activos');
}

async function esperarTabla(page, sedeLabel, timeoutMs = 120000) {
  try {
    await page.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: timeoutMs });
  } catch (e) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(sedeLabel).replace(/[\\/:*?"<>|]/g, '_');
    const png = path.join(DEBUG_DIR, `socios_activos_wait_${safe}_${ts}.png`);
    const txt = path.join(DEBUG_DIR, `socios_activos_wait_${safe}_${ts}.txt`);
    try {
      await page.screenshot({ path: png, fullPage: true }).catch(() => {});
    } catch (_) {}
    try {
      const body = await page.locator('body').innerText().catch(() => '');
      fs.writeFileSync(txt, `${e?.message || e}\n\n${body.slice(0, 4000)}`, 'utf8');
    } catch (_) {}
    throw e;
  }
}

/**
 * Lee tabla DeportNet.
 * - Matriz: agrupa por email/socio (varios servicios por persona).
 * - Cabecera: cliente = email si hay @, si no nombre en columna Nombre/Socio. Se colapsan filas duplicadas
 *   (mismo cliente + mismo servicio normalizado). Solo CDP sin fidelizar = un solo servicio distinto y es prueba.
 */
async function leerConteosPorPlan(page) {
  const table = page.locator('table').filter({ has: page.locator('tbody tr') }).first();
  const headers = await table.locator('thead tr th').allTextContents().catch(() => []);
  const headersNorm = normHeadersAlineados(headers);
  const servicioIdx = indiceServicioMembresia(headersNorm);
  if (servicioIdx < 0) {
    throw new Error(
      `No se encontró la columna Servicio/Membresía. Encabezados: ${JSON.stringify(headers)}`
    );
  }
  const emailIdx = indiceEmail(headersNorm);
  const socioIdx = indiceSocio(headersNorm);
  const nombreIdx = indiceNombreColumna(headersNorm, socioIdx);
  if (nombreIdx < 0) {
    throw new Error(
      `No se encontró columna Nombre ni Socio para el recuento. Encabezados: ${JSON.stringify(headers)}`
    );
  }
  const minCells = Math.max(
    servicioIdx + 1,
    nombreIdx + 1,
    emailIdx >= 0 ? emailIdx + 1 : 0,
    socioIdx >= 0 ? socioIdx + 1 : 0,
  );

  let rows = table.locator('tbody tr.mat-row');
  if ((await rows.count()) === 0) {
    rows = table.locator('tbody tr');
  }

  const n = await rows.count();

  const seenFpCabecera = new Set();
  /** @type {Map<string, { servicios: Set<string>, rawPorServNorm: Map<string, string> }>} */
  const porClienteCabecera = new Map();

  let lastCk = null;
  for (let r = 0; r < n; r += 1) {
    const row = rows.nth(r);
    const cells = await leerCeldasFila(row, minCells);
    if (cells.length < minCells) continue;

    let ck = claveClienteCabecera(cells, emailIdx, nombreIdx);
    if (!ck) {
      // DeportNet deja vacías las celdas de identificación en filas secundarias
      // del mismo cliente (solo conserva fecha y servicio). Usamos el último cliente visto.
      if (!lastCk) continue;
      ck = lastCk;
    } else {
      lastCk = ck;
    }

    const rawServicio =
      cells[servicioIdx] != null
        ? String(cells[servicioIdx])
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';

    const servNorm = servicioNormParaDedupe(rawServicio);
    const fp = `${ck}|${servNorm}`;
    if (seenFpCabecera.has(fp)) continue;
    seenFpCabecera.add(fp);

    if (!porClienteCabecera.has(ck)) {
      porClienteCabecera.set(ck, { servicios: new Set(), rawPorServNorm: new Map() });
    }
    const ag = porClienteCabecera.get(ck);
    ag.servicios.add(servNorm);
    if (!ag.rawPorServNorm.has(servNorm)) {
      ag.rawPorServNorm.set(servNorm, rawServicio);
    }
  }

  const sociosUnicosPorNombreReporte = porClienteCabecera.size;
  let sociosUnicosSoloCdpEfectivo = 0;
  for (const ag of porClienteCabecera.values()) {
    const distintosNoVacios = [...ag.servicios].filter((s) => s !== '__empty__');
    if (distintosNoVacios.length !== 1) continue;
    const onlyNorm = distintosNoVacios[0];
    const raw = ag.rawPorServNorm.get(onlyNorm) || '';
    if (filaEsServicioPrueba(raw)) sociosUnicosSoloCdpEfectivo += 1;
  }

  const anomaliasMap = new Map();
  /** @type {Map<string, { planes: Set<string>, filaSinMatch: boolean, nombreNorm: string }>} */
  const grupos = new Map();

  let lastGroupKey = null;
  for (let r = 0; r < n; r += 1) {
    const row = rows.nth(r);
    const cells = await leerCeldasFila(row, minCells);
    if (cells.length < minCells) continue;

    const dedupe = claveDedupeFila(cells, socioIdx, emailIdx);
    let groupKey;
    if (dedupe) {
      groupKey = dedupe;
      lastGroupKey = dedupe;
    } else {
      // Fila secundaria sin identificador: hereda el cliente anterior
      groupKey = lastGroupKey || `fila:${r}`;
    }

    const nombreGrupo = normNombreDesdeCelda(cells[nombreIdx] != null ? cells[nombreIdx] : '');

    const rawServicio =
      cells[servicioIdx] != null
        ? String(cells[servicioIdx])
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';

    if (!rawServicio) {
      continue;
    }

    const hit = matchServicioAlCatalogo(rawServicio);

    if (!grupos.has(groupKey)) {
      grupos.set(groupKey, {
        planes: new Set(),
        filaSinMatch: false,
        nombreNorm: '',
      });
    }
    const g = grupos.get(groupKey);
    if (nombreGrupo && !g.nombreNorm) g.nombreNorm = nombreGrupo;

    if (hit && hit.plane) {
      g.planes.add(hit.plane);
    } else {
      g.filaSinMatch = true;
      const textoServicio = rawServicio;
      anomaliasMap.set(textoServicio, (anomaliasMap.get(textoServicio) || 0) + 1);
    }
  }

  const conteosPorPlan = {};
  for (const g of grupos.values()) {
    for (const plane of g.planes) {
      conteosPorPlan[plane] = (conteosPorPlan[plane] || 0) + 1;
    }
  }

  const anomalias = Array.from(anomaliasMap.entries())
    .map(([texto, cantidad]) => ({ texto, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    filasTotales: sociosUnicosPorNombreReporte,
    filasRawDom: n,
    sociosUnicosPorNombre: sociosUnicosPorNombreReporte,
    sociosUnicosSoloCdpEfectivo,
    conteosPorPlan,
    anomalias,
    servicioIdx,
    headers,
  };
}

async function obtenerReporteSociosActivos({ sedes, onSede, onProgress, isCancelled }) {
  const sedesAUsar = Array.isArray(sedes) && sedes.length ? sedes : localesDefault;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  try {
    await login(page);

    const total = sedesAUsar.length;
    let processed = 0;

    for (const sede of sedesAUsar) {
      if (typeof isCancelled === 'function' && isCancelled()) break;

      if (typeof onProgress === 'function') {
        onProgress({
          processed,
          total,
          sede,
          message: `Leyendo ${sede}…`,
          phase: 'procesando',
        });
      }

      await selectSucursal(page, sede);
      await abrirReporteSociosActivos(page);
      await esperarTabla(page, sede);

      let payload = {
        sede,
        filasTotales: 0,
        conteosPorPlan: {},
        anomalias: [],
        error: null,
      };

      try {
        const data = await leerConteosPorPlan(page);
        const {
          filasTotales,
          filasRawDom,
          sociosUnicosPorNombre,
          sociosUnicosSoloCdpEfectivo,
          conteosPorPlan,
          anomalias,
        } = data;
        payload = {
          sede,
          filasTotales,
          filasRawDom,
          sociosUnicosPorNombre,
          sociosUnicosSoloCdpEfectivo,
          conteosPorPlan,
          anomalias,
          error: null,
        };
      } catch (err) {
        payload.error = err && err.message ? err.message : String(err);
        try {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const safe = String(sede).replace(/[\\/:*?"<>|]/g, '_');
          fs.writeFileSync(
            path.join(DEBUG_DIR, `socios_activos_error_${safe}_${ts}.txt`),
            `${payload.error}\n`,
            'utf8'
          );
        } catch (_) {}
      }

      if (typeof onSede === 'function') {
        onSede(payload);
      }

      processed += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          processed,
          total,
          sede,
          message: `Listo ${sede}`,
          phase: 'procesando',
        });
      }
    }
  } finally {
    await browser.close();
  }
}

module.exports = {
  obtenerReporteSociosActivos,
  matchServicioAlCatalogo,
};
