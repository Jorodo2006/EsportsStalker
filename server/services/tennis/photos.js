'use strict';
// Foto de un tenista. ESPN tiene retratos recortados pero sólo de unos cuantos; para el resto se usa la imagen de su
// artículo de Wikipedia (Wikimedia Commons, licencias libres). Se busca sólo al abrir una ficha, de una en una y guardando
// el resultado: Wikipedia corta enseguida (429) si se le piden muchas seguidas.
const { query } = require('../../shared/db');

const UA = 'EsportsStalker/0.3 (uso personal)';
const espnUrl = id => `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png`;
const GAP = 1200;
const mem = new Map();
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let queue = Promise.resolve();

// Devuelve { url, from } o { url: '', from: '' } si de verdad no hay. Lanza si la fuente no ha contestado, para no
// guardar como "sin foto" lo que sólo ha sido un corte.
async function fromWikipedia(name) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `"${name}" tennis player`, gsrlimit: '3',
    prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '600', redirects: '1'
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10e3) });
  if (!r.ok) throw new Error(`Wikipedia respondió ${r.status}`);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  const surname = norm(name.split(' ').pop());
  // Tiene que ser un tenista y llevar su apellido: mejor sin foto que con la de otra persona
  const page = pages.find(p => /tennis/i.test(p.description || '') && norm(p.title).includes(surname));
  const url = page?.thumbnail?.source || '';
  return /\.(jpe?g|png)(\/|$|\?)/i.test(url) ? { url, from: 'Wikipedia' } : { url: '', from: '' };
}

async function resolve(id, name) {
  const head = await fetch(espnUrl(id), { method: 'HEAD', signal: AbortSignal.timeout(8e3) });
  if (head.ok) return { url: espnUrl(id), from: 'ESPN' };
  if (head.status !== 404 && head.status !== 403) throw new Error(`ESPN respondió ${head.status}`);
  // En cola para que dos fichas abiertas a la vez no lleguen juntas a Wikipedia
  const turn = queue.then(() => fromWikipedia(name));
  queue = turn.catch(() => {}).then(() => new Promise(ok => setTimeout(ok, GAP)));
  return turn;
}

async function photoOf(id, name) {
  if (mem.has(id)) return mem.get(id);
  const key = `photo:${id}`;
  const saved = (await query('SELECT value FROM tennis.cache WHERE key = $1', [key]).catch(() => ({ rows: [] }))).rows[0]?.value;
  if (saved) { mem.set(id, saved); return saved; }
  try {
    const v = await resolve(id, name);
    mem.set(id, v);
    query(`INSERT INTO tennis.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(v)])
      .catch(e => console.error('tennis.cache:', e.message));
    return v;
  } catch (e) {
    console.error('[tennis] foto:', name, e.message);
    return { url: '', from: '' };
  }
}

module.exports = { photoOf };
