'use strict';
// Foto de un futbolista, como en el tenis (server/services/tennis/photos.js): ESPN casi no tiene retratos de futbolistas,
// así que para el resto se usa la imagen de su artículo de Wikipedia (Wikimedia Commons, licencias libres). Se busca sólo
// al abrir la ficha de un jugador, de una en una y guardando el resultado: Wikipedia corta (429) si se le piden muchas seguidas.
const { query } = require('../../shared/db');

const UA = 'Statex/0.3 (uso personal)';
const espnUrl = id => `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`;
const GAP = 2000;
// Tras un 429 de Wikipedia no se le pide nada durante un rato: reintentar enseguida sólo alarga el corte
const COOL = 2 * 60e3;
let coolUntil = 0;
const mem = new Map();
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let queue = Promise.resolve();

// { url, from } o { url: '', from: '' } si de verdad no hay. Lanza si la fuente no ha contestado, para no guardar como
// "sin foto" lo que sólo ha sido un corte
// team desempata los nombres repetidos ("Bremer": Gleison, el de la Juventus, y otros dos futbolistas Bremer)
async function fromWikipedia(name, team) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `"${name}" footballer ${team || ''}`.trim(), gsrlimit: '3',
    prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '400', redirects: '1'
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10e3) });
  if (r.status === 429) coolUntil = Date.now() + COOL;
  if (!r.ok) throw new Error(`Wikipedia respondió ${r.status}`);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  // Tiene que ser un futbolista y llevar su apellido (o su nombre, si sólo tiene uno: "Bremer"): mejor sin foto que con la de otro
  const words = norm(name).split(/\s+/).filter(w => w.length >= 3);
  const page = pages.find(p => /football|soccer/i.test(p.description || '') && words.some(w => norm(p.title).includes(w)) && norm(p.title).includes(words[words.length - 1] || ''));
  const url = page?.thumbnail?.source || '';
  return /\.(jpe?g|png)(\/|$|\?)/i.test(url) ? { url, from: 'Wikipedia' } : { url: '', from: '' };
}

async function resolve(id, name, team) {
  if (/^\d+$/.test(id)) {
    const head = await fetch(espnUrl(id), { method: 'HEAD', signal: AbortSignal.timeout(8e3) });
    if (head.ok) return { url: espnUrl(id), from: 'ESPN' };
    if (head.status !== 404 && head.status !== 403) throw new Error(`ESPN respondió ${head.status}`);
  }
  // En cola para que dos fichas abiertas a la vez no lleguen juntas a Wikipedia
  const turn = queue.then(() => {
    if (Date.now() < coolUntil) throw new Error('Wikipedia en pausa tras un 429');
    return fromWikipedia(name, team);
  });
  queue = turn.catch(() => {}).then(() => new Promise(ok => setTimeout(ok, GAP)));
  return turn;
}

const keyOf = (id, name) => `photo:${id || norm(name)}`;

async function photoOf(id, name, team) {
  const key = keyOf(id, name);
  if (mem.has(key)) return mem.get(key);
  const saved = (await query('SELECT value FROM football.cache WHERE key = $1', [key]).catch(() => ({ rows: [] }))).rows[0]?.value;
  if (saved) { mem.set(key, saved); return saved; }
  try {
    const v = await resolve(String(id || ''), name, team);
    mem.set(key, v);
    query(`INSERT INTO football.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(v)])
      .catch(e => console.error('football.cache:', e.message));
    return v;
  } catch (e) {
    console.error('[football] foto:', name, e.message);
    return { url: '', from: '' };
  }
}

// Las fotos de toda una alineación de golpe, sin hacer esperar: devuelve al momento las que ya se conocen ({ id: { url, from } })
// y null en las que faltan, que se buscan por detrás (en la cola de Wikipedia). La interfaz vuelve a preguntar hasta tenerlas
const pending = new Set();
async function photosOf(list) {
  const players = (Array.isArray(list) ? list : []).slice(0, 60)
    .map(p => ({ id: /^\d+$/.test(String(p?.id || '')) ? String(p.id) : '', name: String(p?.name || '').trim().slice(0, 80), team: String(p?.team || '').slice(0, 60) }))
    .filter(p => p.name);
  const keys = players.map(p => keyOf(p.id, p.name));
  const missing = keys.filter(k => !mem.has(k));
  if (missing.length) {
    const { rows } = await query('SELECT key, value FROM football.cache WHERE key = ANY($1)', [missing]).catch(() => ({ rows: [] }));
    for (const r of rows) mem.set(r.key, r.value);
  }
  const out = {};
  players.forEach((p, i) => {
    const k = keys[i];
    if (mem.has(k)) { out[p.id || p.name] = mem.get(k); return; }
    out[p.id || p.name] = null;
    // En pausa por un 429 no se encola nada: ya se buscará cuando vuelvan a pedirlas
    if (Date.now() >= coolUntil && !pending.has(k)) { pending.add(k); photoOf(p.id, p.name, p.team).finally(() => pending.delete(k)); }
  });
  return out;
}

module.exports = { photoOf, photosOf };
