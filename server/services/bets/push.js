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

// A todos los navegadores del usuario. Los que el servicio da por caducados (404, 410) se borran
async function send(userId, payload) {
  const { rows } = await query('SELECT endpoint, keys FROM bets.push_subs WHERE user_id = $1', [userId]);
  if (!rows.length) return 0;
  await vapid();
  let n = 0;
  for (const r of rows) {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, JSON.stringify(payload), { TTL: 3 * 3600, urgency: 'high' });
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await query('DELETE FROM bets.push_subs WHERE endpoint = $1', [r.endpoint]);
      else console.warn('push:', e.statusCode || '', e.message);
    }
  }
  return n;
}

module.exports = { publicKey, subscribe, unsubscribe, send, count, cleanSub };
