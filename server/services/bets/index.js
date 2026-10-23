// bets-svc: apuestas, combinadas y ajustes de la app (esquema bets de PostgreSQL)
const path = require('path');
const { start } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const env = require('../../shared/env');
const store = require('./store');

// A la interfaz no le llegan los valores del .env (para no mostrarlos ni guardarlos), sólo cuáles hay
function forUi(s) {
  const fromEnv = Object.keys(env.settings());
  return { ...s, ...Object.fromEntries(fromEnv.map(k => [k, ''])), envKeys: fromEnv, envFile: fromEnv.length ? '.env del proyecto (Docker Compose)' : null };
}

// Lo que no se puede guardar desde la interfaz: lo del .env y los campos informativos
function cleanPatch(patch) {
  const clean = { ...(patch || {}) };
  for (const k of ['envKeys', 'envFile', ...Object.keys(env.settings())]) delete clean[k];
  return clean;
}

const routes = [
  ['GET', '/api/settings', async () => forUi(await store.getSettings())],
  ['PUT', '/api/settings', async ({ body }) => forUi(await store.setSettings(cleanPatch(body)))],
  // Ajustes efectivos para los demás servicios (no pasa por el gateway)
  ['GET', '/internal/settings', async () => ({ ...(await store.getSettings()), ...env.settings() })],

  ['GET', '/api/bets', () => store.listBets()],
  ['POST', '/api/bets', ({ body }) => store.saveBet(body || {})],
  ['DELETE', '/api/bets/:id', ({ params }) => store.deleteBet(params.id)],
  ['POST', '/api/bets/import', ({ body }) => store.importBets(body?.list)],

  // Primer arranque con backend: Electron manda lo que había en data.json
  ['POST', '/api/legacy/import', async ({ body }) => {
    let settings = false;
    if (body?.settings && !(await store.hasSettings())) {
      await store.setSettings(cleanPatch(body.settings));
      settings = true;
    }
    const bets = Array.isArray(body?.bets) ? await store.importBets(body.bets) : 0;
    return { bets, settings };
  }]
];

migrate('bets', path.join(__dirname, 'migrations'))
  .then(() => start({ name: 'bets', port: Number(process.env.PORT) || 4003, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
