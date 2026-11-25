// Noticias de un deporte (fútbol: football/news.js; baloncesto: basket/news.js): se leen cada pocos minutos de fuentes
// gratuitas y se unen a los equipos de los próximos partidos, para verlas en la ficha y junto a las recomendaciones antes de
// apostar (bajas, dudas, vueltas, sanciones, rotaciones, alineaciones, entrenadores). Cada servicio las guarda en su esquema
// (<esquema>.news). ESPN ya trae el equipo (teamId) y los jugadores; en los RSS el equipo se busca por su nombre.
// Antes de añadir una fuente, mira su robots.txt. Lo puro (leer el RSS, etiquetar, buscar equipos) se prueba sin red
// (server/test/noticias.test.js).
const crypto = require('crypto');
const { query } = require('./db');

const UA = 'Sharpex/1.0';
const RSS_EVERY = 5 * 60e3, ESPN_EVERY = 10 * 60e3, KEEP_DAYS = 14;

// ---------- puro ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTITIES[e.toLowerCase()] ?? m);
// Texto de una etiqueta del RSS: sin CDATA, sin HTML y con las entidades traducidas
const clean = s => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tagOf = (block, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return m ? clean(m[1]) : ''; };

// Las noticias de un RSS 2.0
function rssItems(xml) {
  return [...String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([b]) => ({
    title: tagOf(b, 'title'), url: tagOf(b, 'link') || tagOf(b, 'guid'), summary: tagOf(b, 'description').slice(0, 400),
    published: tagOf(b, 'pubDate') || tagOf(b, 'dc:date'),
    cats: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map(m => clean(m[1]))
  })).filter(i => i.title && /^https?:\/\//.test(i.url));
}

// Qué dice la noticia que puede mover un partido, en español y en inglés. Por palabras: ante la duda, sin etiqueta
const TAGS = [
  ['baja', /\b(bajas?|lesi[oó]n|lesionad[oa]s?|se pierde|se perder[aá]|descartad[oa]s?|rotura|operad[oa]|ruled out|out for|out indefinitely|season-ending|injur(?:y|ed|ies)|sidelined|will miss|to miss|surgery)\b/i],
  ['duda', /\b(duda|dudas|en el aire|molestias|tocad[oa]|doubts?|doubtful|questionable|day-to-day|game-time decision|fitness test|late fitness|touch and go)\b/i],
  ['vuelve', /\b(vuelve|regresa|recuperad[oa]|alta m[eé]dica|returns?|back in training|fit again|available again|cleared to play)\b/i],
  ['sancion', /\b(sancionad[oa]s?|sanci[oó]n|suspendid[oa]|suspended|suspension|banned|expulsad[oa]|acumulaci[oó]n de amarillas)\b/i],
  ['rotacion', /\b(rotaci[oó]n|rotaciones|reservas|descanso|rotate|rotation|rested|load management)\b/i],
  ['alineacion', /\b(alineaci[oó]n|convocatoria|convocados|once inicial|quinteto inicial|line-?up|starting xi|starting lineup|team news)\b/i],
  ['entrenador', /\b(destituid[oa]|cesad[oa]|nuevo entrenador|sacked|fired|new (?:manager|head coach|boss)|interim (?:manager|coach|head coach))\b/i]
];
const tagsOf = text => TAGS.filter(([, re]) => re.test(text)).map(([t]) => t);
// Las que pueden cambiar quién juega
const KEY_TAGS = ['baja', 'duda', 'sancion', 'vuelve', 'rotacion', 'alineacion'];

// Sin acentos ni mayúsculas, sólo letras, cifras y espacios
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Cómo se busca un equipo en un texto. opts.common: palabras que solas no dicen de qué equipo es; opts.nick: apodos de la prensa
// por el nombre del equipo sin acentos; opts.lastWord: también la última palabra del nombre («Lakers»)
function namesOf(team, opts = {}) {
  const own = [team.name, team.short, ...(team.alts || []), ...(Array.isArray(team.alt) ? team.alt : [])].map(plain);
  const last = opts.lastWord ? [plain(team.name).split(' ').at(-1)] : [];
  const common = opts.common || new Set();
  return [...new Set([...own, ...last, ...((opts.nick || {})[plain(team.name)] || [])].filter(n => n && n.length >= 4 && !common.has(n)))];
}
// Los equipos (key) que nombra un texto, de los de los próximos partidos. Por frases enteras; un nombre que queda dentro del de
// otro equipo no cuenta («Milan» en «Inter de Milán»). Con opts.women, una noticia del femenino tiene que decirlo
function teamsIn(text, teams, opts = {}) {
  const t = ` ${plain(text)} `;
  const women = /\b(femenin[oa]|women|womens|liga f|wsl)\b/.test(t);
  const spans = [];
  const pool = teams.filter(team => !opts.women || !!team.women === women);
  // Un nombre que llevan dos equipos («Kings»: Sacramento y Sydney) no dice cuál es
  const holders = new Map();
  for (const team of pool) for (const n of namesOf(team, opts)) holders.set(n, (holders.get(n) || 0) + 1);
  for (const team of pool) {
    for (const n of namesOf(team, opts).filter(x => holders.get(x) === 1)) {
      for (let i = t.indexOf(` ${n} `); i >= 0; i = t.indexOf(` ${n} `, i + 1)) spans.push({ id: String(team.key ?? team.id), a: i, b: i + n.length + 1 });
    }
  }
  const inside = s => spans.some(o => o.id !== s.id && o.a <= s.a && o.b >= s.b && o.b - o.a > s.b - s.a);
  return [...new Set(spans.filter(s => !inside(s)).map(s => s.id))];
}

// Una noticia de una fuente → la fila que se guarda
function rowOf(source, item, teams, players = []) {
  const d = new Date(item.published);
  const now = Date.now();
  // Una fecha que no se entiende o del futuro (husos mal puestos) cuenta como ahora
  const published = isNaN(+d) || +d > now + 10 * 60e3 ? new Date(now) : d;
  return {
    id: crypto.createHash('sha1').update(`${source}|${item.url}`).digest('hex').slice(0, 24), source, url: item.url,
    title: item.title.slice(0, 300), summary: item.summary || '', published, teams, players, tags: tagsOf(`${item.title} ${item.summary}`)
  };
}

// Las noticias de ESPN (JSON de /news): el equipo y los jugadores vienen en las categorías. Los vídeos (Media) no dicen nada
// antes del partido. keyOf: el id de ESPN → la clave del equipo en el servicio
function espnRows(json, keyOf = id => String(id)) {
  return (json?.articles || []).filter(a => a.type !== 'Media' && a.headline).map(a => {
    const cats = a.categories || [];
    const teams = [...new Set(cats.filter(c => c.type === 'team' && c.teamId).map(c => keyOf(c.teamId)))];
    const players = [...new Set(cats.filter(c => c.type === 'athlete' && c.description).map(c => c.description))];
    return rowOf('ESPN', { title: clean(a.headline), url: a.links?.web?.href || '', summary: clean(a.description || '').slice(0, 400), published: a.published }, teams, players);
  }).filter(r => r.teams.length && /^https?:\/\//.test(r.url));
}

// ---------- con red y base de datos ----------
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

// schema: el esquema del servicio; rss: [{ name, url }]; espn: [{ url, keyOf }]; upcoming: () => los equipos de los próximos
// partidos ({ key?, id, name, short, alts, women? }); match: opciones de teamsIn
function newsStore({ schema, rss = [], espn = [], upcoming, match = {} }) {
  const table = `${schema}.news`;
  async function save(rows) {
    for (const r of rows) {
      // Si ya estaba, sólo se añaden los equipos (puede que al verla aún no estuviera su partido en la lista): seen_at no cambia
      await query(`INSERT INTO ${table} (id, source, url, title, summary, published, teams, players, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET teams = (SELECT array_agg(DISTINCT x) FROM unnest(${table}.teams || EXCLUDED.teams) x), tags = EXCLUDED.tags`,
      [r.id, r.source, r.url, r.title, r.summary, r.published, r.teams, r.players, r.tags]);
    }
  }
  async function readRss() {
    const teams = await upcoming();
    for (const s of rss) {
      try {
        // Sólo las de algún equipo con partido: las demás no sirven para apostar
        const rows = rssItems(await fetchText(s.url)).map(i => rowOf(s.name, i, teamsIn(`${i.title} ${i.summary} ${i.cats.join(' ')}`, teams, match))).filter(r => r.teams.length);
        await save(rows);
      } catch (e) { console.error(`[${schema}] noticias`, s.name, e.message); }
    }
  }
  async function readEspn() {
    for (const s of espn) {
      try { await save(espnRows(JSON.parse(await fetchText(s.url)), s.keyOf)); }
      catch (e) { console.error(`[${schema}] noticias ESPN`, s.url, e.message); }
    }
  }
  // Las de unos equipos, de los últimos días, lo más nuevo primero
  async function newsFor(keys, days = 5) {
    const ids = keys.map(String).filter(Boolean).slice(0, 40);
    if (!ids.length) return [];
    const { rows } = await query(`SELECT id, source, url, title, summary, published, seen_at, teams, players, tags FROM ${table}
      WHERE teams && $1 AND published > now() - make_interval(days => $2) ORDER BY published DESC LIMIT 200`, [ids, days]);
    return rows.map(r => ({ ...r, teams: r.teams.filter(t => ids.includes(t)) }));
  }
  function start() {
    const loop = (fn, every, delay) => { setTimeout(() => { fn().catch(() => {}); setInterval(() => fn().catch(() => {}), every); }, delay); };
    if (rss.length) loop(readRss, RSS_EVERY, 15e3);
    if (espn.length) loop(readEspn, ESPN_EVERY, 25e3);
    loop(() => query(`DELETE FROM ${table} WHERE published < now() - make_interval(days => $1)`, [KEEP_DAYS]), 6 * 3600e3, 60e3);
  }
  return { start, newsFor };
}

// Lo que se enseña junto a una recomendación: las noticias que pueden cambiar quién juega (KEY_TAGS) de las últimas 48 h
// de esos equipos; si nombran al jugador de la recomendación, primero. → { n, top, player } o null
function keyNews(list, keys, player = '', now = Date.now()) {
  const p = plain(player), last = p.split(' ').filter(w => w.length >= 4).at(-1);
  const names = n => plain(`${n.title} ${n.summary} ${(n.players || []).join(' ')}`);
  const hits = list.filter(n => n.teams.some(t => keys.includes(t)) && n.tags.some(t => KEY_TAGS.includes(t)) && now - +new Date(n.published) < 48 * 3600e3);
  if (!hits.length) return null;
  const mentions = n => !!p && (` ${names(n)} `.includes(` ${p} `) || (!!last && ` ${names(n)} `.includes(` ${last} `)));
  const own = hits.filter(mentions);
  const top = own[0] || hits[0];
  return { n: hits.length, player: own.length > 0, top: { title: top.title, source: top.source, url: top.url, published: top.published, tags: top.tags.filter(t => KEY_TAGS.includes(t)) } };
}

module.exports = { newsStore, rssItems, tagsOf, teamsIn, namesOf, rowOf, espnRows, keyNews, KEY_TAGS, plain };
