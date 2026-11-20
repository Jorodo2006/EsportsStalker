// Notificaciones con la app cerrada (Web Push). Cada navegador o móvil que lo permite deja una suscripción (bets.push_subs) y el
// servidor le manda el aviso cifrado a su servicio de push (Google, Mozilla o Apple), que lo entrega aunque Sharpex esté cerrado.
// Las claves VAPID firman los envíos: del .env si están (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY) o, si no, generadas una vez y
// guardadas en bets.vapid. VAPID_SUBJECT (o PUBLIC_URL) es el contacto que ven los servicios de push.
const webpush = require('web-push');
const { query } = require('../../shared/db');
const { fail } = require('../../shared/service');

let keys = null;
async function vapid() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else {
    let row = (await query('SELECT public_key, private_key FROM bets.vapid WHERE id = 1')).rows[0];
    if (!row) {
      const k = webpush.generateVAPIDKeys();
      await query('INSERT INTO bets.vapid (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [k.publicKey, k.privateKey]);
      row = (await query('SELECT public_key, private_key FROM bets.vapid WHERE id = 1')).rows[0];
    }
    keys = { publicKey: row.public_key, privateKey: row.private_key };
  }
  const site = process.env.PUBLIC_URL || '';
  const subject = process.env.VAPID_SUBJECT || (/^https:\/\//.test(site) ? site : 'mailto:avisos@sharpex.invalid');
  // Apple rechaza la firma entera (403 BadJwtToken) con un contacto que no existe: comprobado el 20-11-2026 contra web.push.apple.com,
  // «mailto:avisos@sharpex.invalid» da 403 y una dirección https de verdad, no. Google y Mozilla no lo miran, así que el fallo sólo se
  // ve en los iPhone
  if (subject.endsWith('.invalid')) console.warn('push: sin VAPID_SUBJECT ni PUBLIC_URL con https, Apple rechaza todos los avisos a los iPhone (403 BadJwtToken)');
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return keys;
}

// Sólo la pública: la necesita el navegador para suscribirse
const publicKey = async () => (await vapid()).publicKey;

// Lo que manda el navegador al suscribirse: { endpoint, keys: { p256dh, auth } }. El servidor hará peticiones a ese endpoint, así que
// sólo se admiten los servicios de push de los navegadores (Chrome/Edge/Android, Firefox, Safari/iOS, Windows): nadie puede hacer que
// mande peticiones a otra parte (un servicio de la red interna, por ejemplo)
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)$/;
function cleanSub(s) {
  const endpoint = String(s?.endpoint || '');
  const p256dh = String(s?.keys?.p256dh || ''), auth = String(s?.keys?.auth || '');
  let host = '';
  try { const u = new URL(endpoint); host = u.protocol === 'https:' && !u.port ? u.hostname : ''; } catch { /* no es una dirección */ }
  if (!PUSH_HOSTS.test(host) || endpoint.length > 800 || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{10,100}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function subscribe(userId, sub) {
  const s = cleanSub(sub);
  if (!s) throw fail('Suscripción no válida');
  // Un navegador es de quien está en él ahora: si otro usuario entra en el mismo, la suscripción pasa a ser suya
  await query(`INSERT INTO bets.push_subs (endpoint, user_id, keys) VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys, created_at = now()`, [s.endpoint, userId, JSON.stringify(s.keys)]);
  return { ok: true };
}

async function unsubscribe(userId, endpoint) {
  await query('DELETE FROM bets.push_subs WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
  return { ok: true };
}

const count = async userId => (await query('SELECT count(*)::int AS n FROM bets.push_subs WHERE user_id = $1', [userId])).rows[0].n;

// Por qué no se entregó: el código y el motivo que da el servicio de push. Apple lo da en JSON ({"reason":"BadDeviceToken"}), Google
// y Mozilla en texto. Antes sólo quedaba "push: 403 Received unexpected response code" en el registro, sin saber de qué móvil ni por qué
function failureOf(e) {
  let reason = '';
  try { reason = JSON.parse(e.body || '{}').reason || ''; } catch { reason = String(e.body || '').trim().slice(0, 160); }
  return { status: e.statusCode || 0, reason: reason || String(e.message || '').slice(0, 160) };
}
const hostOf = endpoint => { try { return new URL(endpoint).hostname; } catch { return ''; } };
// Caducada: el servicio dice que ese dispositivo ya no existe (desinstaló la app, quitó el permiso, iOS la renovó)
const GONE = new Set([404, 410]);

async function deliver(r, payload) {
  try {
    await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, JSON.stringify(payload), { TTL: 3 * 3600, urgency: 'high' });
    return { ok: true };
  } catch (e) {
    const f = failureOf(e);
    if (GONE.has(f.status)) await query('DELETE FROM bets.push_subs WHERE endpoint = $1', [r.endpoint]);
    else console.warn(`push (${hostOf(r.endpoint)}): ${f.status} ${f.reason}`);
    return { ok: false, ...f, gone: GONE.has(f.status) };
  }
}

// A todos los navegadores del usuario. Los que el servicio da por caducados (404, 410) se borran
async function send(userId, payload) {
  const { rows } = await query('SELECT endpoint, keys FROM bets.push_subs WHERE user_id = $1', [userId]);
  if (!rows.length) return 0;
  await vapid();
  let n = 0;
  for (const r of rows) if ((await deliver(r, payload)).ok) n++;
  return n;
}

// La prueba de Tu cuenta: un aviso sólo a este dispositivo, si es del usuario, y lo que ha dicho su servicio de push. Espera unos
// segundos antes de mandarlo para dar tiempo a salir de la app o bloquear el móvil: con la app abierta delante, el móvil puede
// no sacarlo como banner y parecería que no ha llegado
const lastTest = new Map();
const TEST_WAIT = 5000;
async function test(userId, endpoint, wait = TEST_WAIT) {
  const k = String(userId);
  if (Date.now() - (lastTest.get(k) || 0) < 10e3) throw fail('Espera unos segundos antes de probar otra vez');
  lastTest.set(k, Date.now());
  const r = (await query('SELECT endpoint, keys FROM bets.push_subs WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')])).rows[0];
  if (!r) return { ok: false, missing: true };
  await vapid();
  if (wait) await new Promise(res => setTimeout(res, wait));
  return deliver(r, { title: 'Prueba de Sharpex', body: 'Si ves esto, los avisos llegan a este dispositivo.', tag: 'prueba', url: '/cuenta' });
}

module.exports = { publicKey, subscribe, unsubscribe, send, test, count, cleanSub, failureOf };
