// challenger: motor de valor de los Challenger (server/sharpex-tenis, ESM sin dependencias) expuesto en /api/challenger.
// - Datos y modelo, en el volumen CHALLENGER_DATA. Al arrancar y cada día baja lo que falta del histórico (el archivo de
//   Sackmann una sola vez; TennisMyLife, siempre) y reentrena en un proceso aparte con la memoria limitada: así los
//   segundos de entrenamiento no paran las peticiones. El modelo se vuelve a leer en cuanto cambia el fichero.
// - Historial de picks, en challenger.historial: sólo se añade y cada registro lleva el hash del anterior.
// Escanear y ver el historial lo puede cualquiera con sesión. Escribir en el historial y forzar la actualización, sólo el
// administrador: el historial es uno para todos y de él no se puede borrar nada.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { start, fail } = require('../../shared/service');
const { migrate, query, tx } = require('../../shared/db');
const internal = require('../../shared/internal');

const DATA = process.env.CHALLENGER_DATA || '/data';
const DATOS = path.join(DATA, 'datos');
const MODEL = path.join(DATA, 'modelo.json');
const CLI = path.join(__dirname, '../../sharpex-tenis/bin/sharpex-tenis.js');
const EVERY_HOURS = 24; // TennisMyLife se actualiza cada semana: un día de retraso como mucho
const RETRY_HOURS = 6; // si falla, no se vuelve a intentar cada hora

// El motor es ESM: desde CommonJS se carga con import()
const motor = import('../../sharpex-tenis/src/index.js');

// El gateway comprueba la sesión y pasa el usuario en estas cabeceras; este servicio no se publica directamente
function who(req) {
  const id = req.headers['x-user-id'];
  const admin = req.headers['x-user-admin'] === '1' ? '1' : '0';
  if (!id || !internal.verify(id, admin, req.headers['x-user-sig'])) throw fail('Inicia sesión', 401);
  return { id, isAdmin: admin === '1' };
}
function adminOnly(req, what = 'escribir en el historial de picks') {
  if (!who(req).isAdmin) throw fail(`Sólo el administrador puede ${what}`, 403);
}

// ---------- Datos y modelo ----------

const ageHours = () => { try { return (Date.now() - fs.statSync(MODEL).mtimeMs) / 3600e3; } catch (_) { return Infinity; } };

// Entrena en otro proceso: 256 MB le sobran (sin límite, V8 llega a 550 MB porque no libera hasta que lo necesita)
function train() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--max-old-space-size=256', CLI, 'entrenar', '--datos', DATOS, '--salida', MODEL], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`el entrenamiento terminó con código ${code}: ${out.trim().split('\n').pop()}`))));
  });
}

const status = { running: null, tried: 0, last: null };
function refresh(motivo) {
  if (status.running) return status.running;
  status.tried = Date.now();
  status.running = (async () => {
    const t0 = Date.now();
    try {
      const { download } = await motor;
      const r = await download({ dir: DATOS });
      if (!fs.readdirSync(DATOS).some(f => f.endsWith('.csv'))) throw new Error(`no hay datos (${r.failed.join(', ') || 'nada que bajar'})`);
      await train();
      status.last = { ok: true, at: new Date().toISOString(), motivo, segundos: Math.round((Date.now() - t0) / 1000), descargados: r.downloaded.length, fallidos: r.failed };
      console.log(`[challenger] modelo actualizado (${motivo}) en ${status.last.segundos} s${r.failed.length ? `; sin bajar: ${r.failed.join(', ')}` : ''}`);
    } catch (e) {
      status.last = { ok: false, at: new Date().toISOString(), motivo, error: e.message };
      console.error(`[challenger] no se pudo actualizar el modelo (${motivo}):`, e.message);
    } finally {
      status.running = null;
    }
  })();
  return status.running;
}

// Cada hora mira si el modelo tiene más de un día; tras un fallo espera unas horas antes de volver a probar
function schedule() {
  const tick = () => {
    if (ageHours() >= EVERY_HOURS && Date.now() - status.tried >= RETRY_HOURS * 3600e3) refresh(fs.existsSync(MODEL) ? 'diaria' : 'primera vez');
  };
  tick();
  setInterval(tick, 3600e3).unref();
}

// El modelo se vuelve a leer cuando cambia el fichero (al reentrenarlo), sin reiniciar el servicio
let loaded = null;
async function model() {
  const { EloModel } = await motor;
  let mtime;
  try { mtime = fs.statSync(MODEL).mtimeMs; } catch (_) {
    throw fail(status.running ? 'Preparando el modelo por primera vez (baja unos 60 MB): prueba en un par de minutos' : 'Todavía no hay modelo: mira GET /api/challenger/estado', 503);
  }
  if (loaded?.mtime !== mtime) {
    try { loaded = { mtime, model: EloModel.fromJSON(JSON.parse(fs.readFileSync(MODEL, 'utf8'))) }; } catch (e) {
      throw fail(`El modelo no se puede leer (${e.message})`, 503);
    }
  }
  return loaded.model;
}

// ---------- Historial de picks (PostgreSQL) ----------

const entries = async (db = { query }) => (await db.query('SELECT registro FROM challenger.historial ORDER BY n')).rows.map(r => JSON.parse(r.registro));

// Escribe con la tabla bloqueada: cada registro se engancha al último, y dos escrituras a la vez se cruzarían
async function withLedger(fn) {
  const { chainEntry, GENESIS } = await motor;
  return tx(async c => {
    await c.query('LOCK TABLE challenger.historial IN EXCLUSIVE MODE');
    const list = await entries(c);
    const add = async (type, data) => {
      const e = chainEntry(list.length ? list[list.length - 1].hash : GENESIS, type, data);
      await c.query('INSERT INTO challenger.historial (hash, prev, tipo, pick_id, registro) VALUES ($1, $2, $3, $4, $5)',
        [e.hash, e.prev, type, data.id, JSON.stringify(e)]);
      list.push(e);
      return e;
    };
    return fn(list, add);
  });
}

// El motor avisa de un pick que no existe con un error normal: aquí es un 404
function onPick(fn) {
  try { return fn(); } catch (e) {
    if (/^No existe el pick/.test(e.message)) throw fail(e.message, 404);
    throw fail(e.message);
  }
}

const num = (v, name) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw fail(`"${name}" no es un número`);
  return n;
};
const yes = v => v === true || /^(1|true|s[ií])$/i.test(String(v ?? ''));
const pickId = id => { if (!/^[\w-]{1,64}$/.test(id)) throw fail('Identificador de pick no válido'); return id; };

// Cuerpo: { cuotas, superficie, torneo, casa, minEdge, minCuota, maxCuota, incluirPocosDatos, alias, registrar }, o el JSON
// de cuotas tal cual (envío del marcador de Winamax, { entries } o una lista) con las opciones en la URL (?superficie=Clay)
async function escanear({ req, body, query: q }) {
  who(req);
  const wrapped = !!body && typeof body === 'object' && !Array.isArray(body) && 'cuotas' in body;
  const input = wrapped ? body.cuotas : body;
  const o = wrapped ? body : q;
  if (input === undefined || input === null || input === '') throw fail('Faltan las cuotas');
  const registrar = yes(o.registrar);
  if (registrar) adminOnly(req);

  const { normalizeOddsInput, scan, pickData, picksOf } = await motor;
  let rows;
  try { rows = normalizeOddsInput(input, { surface: o.superficie, tournament: o.torneo, bookmaker: o.casa }); } catch (e) {
    throw fail(`Cuotas no válidas: ${e.message}`);
  }
  const avisos = [];
  // Winamax no dice la superficie, y el motor supone pista dura si no la sabe
  if (!o.superficie && [].concat(input).some(x => x?.book === 'winamax')) {
    avisos.push('El envío de Winamax no dice la superficie: se ha supuesto pista dura. Pásala en "superficie".');
  }
  const m = await model();
  const { opportunities, skipped } = scan(m, rows, {
    minEdge: num(o.minEdge, 'minEdge'),
    minOdds: num(o.minCuota, 'minCuota'),
    maxOdds: num(o.maxCuota, 'maxCuota'),
    allowLowData: yes(o.incluirPocosDatos),
    aliases: o.alias && typeof o.alias === 'object' && !Array.isArray(o.alias) ? o.alias : undefined
  });

  let registrados = 0;
  if (registrar && opportunities.length) {
    registrados = await withLedger(async (list, add) => {
      // Del historial no se puede borrar nada: si se escanea otra vez el mismo partido, no se apunta dos veces el mismo pick
      const open = new Map(picksOf(list).filter(p => !p.result).map(p => [`${p.match}|${p.pick}|${p.bookmaker}`, p.id]));
      let n = 0;
      for (const op of opportunities) {
        const key = `${op.match}|${op.pick}|${op.bookmaker}`;
        if (open.has(key)) { op.id = open.get(key); op.yaRegistrado = true; continue; }
        const { match, tournament, surface, start: when, bookmaker, pick, odds, modelProb, edge, stake } = op;
        op.id = (await add('pick', pickData({ match, tournament, surface, start: when, bookmaker, pick, odds, modelProb, edge, stake }))).data.id;
        open.set(key, op.id);
        n++;
      }
      return n;
    });
  }
  return {
    leidos: rows.length, oportunidades: opportunities, descartados: skipped, registrados, avisos,
    modelo: { jugadores: m.players.size, ultimoPartido: m.lastDate }
  };
}

// ---------- Modelo frente a la casa ----------
// Los Challenger del día (servicio tennis, de LiveScore) con lo que dice el modelo y las cuotas que ha ido guardando el
// lector (servicio odds): la primera que vio de cada casa (apertura) y la última (cierre). Con los resultados, es lo que
// dirá si el modelo gana a la casa. No escribe nada.
const client = require('../../shared/client');
const ML = 'moneyline|0||';
const madridDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });

function pricesOf(rows) {
  const out = {};
  for (const r of rows) {
    if (r.market_key !== ML || !['a', 'b'].includes(r.outcome_id)) continue;
    const bk = (out[r.book] ??= { a: [], b: [] });
    bk[r.outcome_id].push(r);
  }
  const res = {};
  for (const [book, { a, b }] of Object.entries(out)) {
    if (!a.length || !b.length) continue;
    const byTs = (x, y) => x.ts - y.ts;
    a.sort(byTs); b.sort(byTs);
    res[book] = {
      apertura: { a: a[0].price, b: b[0].price, ts: Math.max(a[0].ts, b[0].ts) },
      cierre: { a: a[a.length - 1].price, b: b[b.length - 1].price, ts: Math.max(...[...a, ...b].map(r => r.last_seen || r.ts)) }
    };
  }
  return res;
}

async function comparar({ req, query: q }) {
  who(req);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : madridDay();
  const games = (await client.call('tennis', 'GET', `/api/tennis/games?date=${day}`))
    .filter(g => g.level === 'challenger' && !/^previa/i.test(g.round || '') && g.a?.name && g.b?.name);
  const m = await model();
  const { matcher, surfaceOf, fairProbs, edge } = await motor;
  const find = matcher(m);
  const fair = (p) => fairProbs(p.a, p.b)[0];
  const partidos = await Promise.all(games.map(async g => {
    const sup = surfaceOf(m.venues, g.tournament);
    const a = find(g.a.name), b = find(g.b.name);
    const pred = a && b ? m.predict(a.id, b.id, sup.surface) : null;
    const hist = await client.call('odds', 'POST', '/api/odds/history', { match: { a: { name: g.a.name }, b: { name: g.b.name }, sport: 'tennis', start: g.date } })
      .catch(e => { console.error('[challenger] histórico de cuotas:', e.message); return []; });
    const casas = pricesOf(hist);
    const books = Object.values(casas);
    const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const mercado = books.length ? { apertura: avg(books.map(x => fair(x.apertura))), cierre: avg(books.map(x => fair(x.cierre))) } : null;
    const best = side => Math.max(...books.map(x => x.cierre[side]));
    return {
      id: g.id, fecha: g.date, estado: g.state, torneo: g.tournament, ronda: g.round, a: g.a.name, b: g.b.name,
      superficie: sup.surface, superficieConocida: sup.known,
      modelo: pred
        ? { a: pred.pA, pocosDatos: pred.lowData, partidos: [pred.nA, pred.nB], jugadores: [a.name, b.name] }
        : { error: `No encuentro en el histórico a ${!a ? g.a.name : g.b.name}` },
      casas, mercado,
      // Valor con la mejor cuota de cierre de las casas: lo que habría dado apostar justo antes de empezar
      valorCierre: pred && books.length ? { a: edge(pred.pA, best('a')), b: edge(1 - pred.pA, best('b')) } : null
    };
  }));
  return {
    fecha: day,
    resumen: { partidos: partidos.length, conCuotas: partidos.filter(p => p.mercado).length, conModelo: partidos.filter(p => !p.modelo.error).length },
    modelo: { ultimoPartido: m.lastDate },
    partidos: partidos.sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)))
  };
}

const RESULT = { won: 'won', lost: 'lost', void: 'void', ganada: 'won', perdida: 'lost', nula: 'void' };

const routes = [
  ['POST', '/api/challenger/escanear', escanear],
  ['GET', '/api/challenger/comparar', comparar],

  // Rendimiento, CLV y si el historial sigue íntegro (nadie ha cambiado ni borrado un pick antiguo)
  ['GET', '/api/challenger/historial', async ({ req }) => {
    who(req);
    const { verifyChain, statsOf, picksOf } = await motor;
    const list = await entries();
    return { verify: verifyChain(list), stats: statsOf(list), picks: picksOf(list) };
  }],

  // Cuota de cierre, justo antes de empezar, para el CLV. La del rival es opcional y mejora el cálculo
  ['POST', '/api/challenger/picks/:id/cierre', async ({ req, params, body }) => {
    adminOnly(req);
    const id = pickId(params.id);
    const cuota = num(body?.cuota, 'cuota'), rival = num(body?.rival, 'rival');
    if (!(cuota > 1)) throw fail('Falta la cuota de cierre (mayor que 1)');
    if (rival !== undefined && !(rival > 1)) throw fail('La cuota de cierre del rival tiene que ser mayor que 1');
    const { pickOf, closeData } = await motor;
    return withLedger(async (list, add) => {
      onPick(() => pickOf(list, id));
      await add('close', closeData(id, cuota, rival ?? null));
      return pickOf(list, id);
    });
  }],

  ['POST', '/api/challenger/picks/:id/resultado', async ({ req, params, body }) => {
    adminOnly(req);
    const id = pickId(params.id);
    const result = RESULT[String(body?.resultado ?? '').toLowerCase()];
    if (!result) throw fail('El resultado tiene que ser won, lost o void (o ganada, perdida, nula)');
    const { pickOf, settleData } = await motor;
    return withLedger(async (list, add) => {
      onPick(() => pickOf(list, id));
      await add('settle', settleData(id, result));
      return pickOf(list, id);
    });
  }],

  // Cómo está el modelo y la última actualización de los datos
  ['GET', '/api/challenger/estado', async ({ req }) => {
    who(req);
    let modelo;
    try {
      const m = await model();
      modelo = { jugadores: m.players.size, ultimoPartido: m.lastDate, entrenado: new Date(fs.statSync(MODEL).mtimeMs).toISOString() };
    } catch (e) { modelo = { error: e.message }; }
    return { modelo, actualizando: !!status.running, ultimaActualizacion: status.last };
  }],

  // Bajar los datos y reentrenar ya, sin esperar a la del día. Responde enseguida: tarda de unos segundos a un minuto
  ['POST', '/api/challenger/actualizar', async ({ req }) => {
    adminOnly(req, 'actualizar el modelo');
    refresh('a mano');
    return { actualizando: true };
  }]
];

try { fs.mkdirSync(DATOS, { recursive: true }); } catch (e) { console.error(`No se puede crear ${DATOS}:`, e.message); }

migrate('challenger', path.join(__dirname, 'migrations'))
  .then(() => motor)
  .then(() => start({ name: 'challenger', port: Number(process.env.PORT) || 4008, routes, health: async () => (await query('SELECT 1'), true) }))
  .then(schedule)
  .catch(e => { console.error(e); process.exit(1); });
