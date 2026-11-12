// bets-svc: usuarios, apuestas, combinadas y ajustes de la app (esquema bets de PostgreSQL)
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query, notify } = require('../../shared/db');
const env = require('../../shared/env');
const store = require('./store');
const auth = require('./auth');
const settle = require('./settle');
const predictions = require('./predictions');
const internal = require('../../shared/internal');

// A la interfaz no le llegan los valores del .env (para no mostrarlos ni guardarlos), sólo cuáles hay.
// A quien no es administrador tampoco le llegan las claves comunes
function forUi(s, isAdmin) {
  const fromEnv = Object.keys(env.settings());
  const out = { ...s, ...Object.fromEntries(fromEnv.map(k => [k, ''])), envKeys: fromEnv, envFile: fromEnv.length ? '.env del proyecto (Docker Compose)' : null };
  if (!isAdmin) for (const k of store.SECRET_KEYS) delete out[k];
  return out;
}

// Lo que no se puede guardar desde la interfaz: lo del .env y los campos informativos
function cleanPatch(patch) {
  const clean = { ...(patch || {}) };
  for (const k of ['envKeys', 'envFile', ...Object.keys(env.settings())]) delete clean[k];
  return clean;
}

// El gateway comprueba la sesión y pasa el usuario en estas cabeceras; este servicio no se publica directamente
function who(req) {
  const id = req.headers['x-user-id'];
  const admin = req.headers['x-user-admin'] === '1' ? '1' : '0';
  if (!id || !internal.verify(id, admin, req.headers['x-user-sig'])) throw fail('Inicia sesión', 401);
  return { id, isAdmin: admin === '1' };
}

const routes = [
  // ---------- Cuenta (estas cuatro primeras son las únicas abiertas sin sesión) ----------
  ['GET', '/api/auth/config', () => auth.config()],
  ['GET', '/api/auth/me', ({ req }) => auth.userOf(auth.cookieOf(req))],
  ['POST', '/api/auth/register', ({ body, req, res }) => auth.register(body, req, res)],
  ['POST', '/api/auth/login', ({ body, req, res }) => auth.login(body, req, res)],
  ['POST', '/api/auth/logout', ({ req, res }) => auth.logout(req, res)],
  ['POST', '/api/auth/password', ({ req, body }) => auth.changePassword(who(req).id, req, body)],
  // El gateway pregunta aquí de quién es cada sesión (no se publica)
  ['POST', '/internal/auth/session', ({ body }) => auth.userOf(body?.token)],

  ['GET', '/api/settings', async ({ req }) => { const u = who(req); return forUi(await store.getSettings(u.id), u.isAdmin); }],
  ['PUT', '/api/settings', async ({ req, body }) => {
    const u = who(req), patch = cleanPatch(body);
    const out = forUi(await store.setSettings(u.id, u.isAdmin, patch), u.isAdmin);
    // Si el administrador ha cambiado un ajuste común, los que estén conectados lo recargan al momento (aviso SSE)
    if (u.isAdmin && Object.keys(patch).some(k => !store.USER_KEYS.includes(k))) notify('settings:changed', {});
    return out;
  }],
  // Ajustes comunes efectivos para los demás servicios (no pasa por el gateway)
  ['GET', '/internal/settings', async () => ({ ...(await store.getSettings(null)), ...env.settings() })],

  ['GET', '/api/bets', ({ req }) => store.listBets(who(req).id)],
  ['POST', '/api/bets', ({ req, body }) => store.saveBet(who(req).id, body || {})],
  ['DELETE', '/api/bets/:id', ({ req, params }) => store.deleteBet(who(req).id, params.id)],
  ['POST', '/api/bets/import', ({ req, body }) => store.importBets(who(req).id, body?.list)],
  // Comprobar ya los resultados (sin esperar a la pasada de cada 5 min). Pide sesión, como todo /api; devuelve cuántas cambiaron
  ['POST', '/api/bets/settle', async ({ req }) => { who(req); return { changed: await settle.run() }; }],
  // Recomendaciones del modelo, para medir si acierta. No son de nadie: cualquiera con sesión las manda mientras las ve
  ['POST', '/api/bets/predictions', ({ req, body }) => { who(req); return predictions.record(body?.list); }],
  ['GET', '/api/bets/predictions', ({ req }) => { who(req); return predictions.report(); }]
];

migrate('bets', path.join(__dirname, 'migrations'))
  .then(() => auth.bootstrapAdmin())
  .then(() => start({ name: 'bets', port: Number(process.env.PORT) || 4003, routes, health: async () => (await query('SELECT 1'), true) }))
  .then(() => settle.startSettler())
  .catch(e => { console.error(e); process.exit(1); });
