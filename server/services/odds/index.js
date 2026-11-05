// odds-svc: recibe y normaliza las cuotas leídas en Chrome, lleva los trabajos de la extensión y programa
// las lecturas automáticas (esquema odds de PostgreSQL). No usa ninguna API de cuotas.
const path = require('path');
const { start, fail, send } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const bridge = require('./bridge');
const odds = require('./odds');
const scheduler = require('./scheduler');
const { AUTO_PAGE } = require('./auto-page');

const matchOf = body => {
  const m = body?.match;
  if (!m?.a?.name || !m?.b?.name) throw fail('Falta el partido');
  return m;
};

// Guarda lo leído y, sin hacer esperar al lector, calcula la cuota de ganador y el histórico
async function receive(payload) {
  const r = await bridge.add(payload);
  if (r.match) odds.afterImport(r.match, r.entry).catch(e => console.error('Tras importar:', e.message));
  return r.res;
}

const routes = [
  // ---------- Para la app (vía gateway) ----------
  // quiet: sólo leer. Las recomendaciones miran muchos partidos y no deben pasar por "el último abierto" del lector
  ['POST', '/api/odds/match', async ({ body }) => { const m = matchOf(body); if (!body.quiet) await bridge.noteMatch(m); return odds.getMatchOdds(m); }],
  ['POST', '/api/odds/board', ({ body }) => odds.getBoardFor(body?.events)],
  // Botón "Actualizar cuotas": trabajo inmediato (la app abre /auto?job=ID en Chrome)
  ['POST', '/api/odds/jobs', async ({ body }) => { const m = matchOf(body); await bridge.noteMatch(m); return bridge.newJob(m, 'manual'); }],
  // Pegar del marcador: lo que el marcador copió al portapapeles cuando Chrome no le dejó enviarlo
  ['POST', '/api/odds/paste', async ({ body }) => { if (body?.match) await bridge.noteMatch(body.match); return receive(body?.data); }],
  ['POST', '/api/odds/history', ({ body }) => bridge.priceHistory(matchOf(body))],
  ['GET', '/api/odds/auto/status', () => scheduler.status()],
  // Primer arranque con backend: direcciones aprendidas que había en casas-urls.json
  ['POST', '/api/odds/legacy-urls', ({ body }) => bridge.importUrls(body?.urls)],

  // ---------- Para el marcador y la extensión de Chrome ----------
  ['GET', '/ping', () => ({ ok: true })],
  ['GET', '/auto', ({ res }) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(AUTO_PAGE); }],
  ['GET', '/auto/status', async ({ query: q, res }) => { const job = await bridge.getJob(q.id); return job || send(res, 404, { ok: false }); }],
  ['GET', '/auto/job', async ({ query: q, res }) => { const job = await bridge.pickJob(q.id); return job || send(res, 404, { ok: false }); }],
  // La extensión pregunta cada poco (chrome.alarms); 204 si no hay nada que hacer
  ['GET', '/jobs/next', async ({ res }) => { const job = await bridge.nextJob(); if (job) return job; res.writeHead(204); res.end(); }],
  ['POST', '/odds', ({ body }) => receive(body)],
  ['POST', '/bet365', ({ body }) => receive(body)],
  ['POST', '/snapshot', ({ body }) => (bridge.saveSnapshot(body), { ok: true })],
  ['POST', '/auto/progress', ({ body }) => bridge.jobProgress(body || {})]
];

migrate('odds', path.join(__dirname, 'migrations'))
  .then(() => {
    start({ name: 'odds', port: Number(process.env.PORT) || 4002, routes, health: async () => (await query('SELECT 1'), true) });
    scheduler.start();
  })
  .catch(e => { console.error(e); process.exit(1); });
