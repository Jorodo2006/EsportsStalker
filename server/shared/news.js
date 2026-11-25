// Noticias de un deporte (fútbol: football/news.js; baloncesto: basket/news.js): se leen cada pocos minutos de fuentes
// gratuitas y se unen a los equipos de los próximos partidos, para verlas en la ficha y junto a las recomendaciones antes de
// apostar (bajas, dudas, vueltas, sanciones, rotaciones, alineaciones, entrenadores). Cada servicio las guarda en su esquema
// (<esquema>.news). ESPN ya trae el equipo (teamId) y los jugadores; en los RSS el equipo se busca por su nombre.
// Antes de añadir una fuente, mira su robots.txt. Lo puro (leer el RSS, etiquetar, buscar equipos) se prueba sin red
// (server/test/noticias.test.js).
const crypto = require('crypto');
const { query } = require('./db');

const UA = 'Sharpex/1.0';
// Para enterarse antes que nadie, cada 2 min (RSS) y 3 min (ESPN), con peticiones condicionales (ETag / Last-Modified): si el
// RSS no ha cambiado, la fuente responde 304 sin mandarlo. No lo bajes más: son webs de prensa, no APIs
const RSS_EVERY = 2 * 60e3, ESPN_EVERY = 3 * 60e3, KEEP_DAYS = 14;

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

// ---------- quién no juega ----------
// Lo que dice una frase de un jugador, por orden: la sanción, que no juega, que vuelve, la duda y que está lesionado sin decir si
// juega. Sobre el texto sin acentos (plain). «Baja» sola no vale («a la baja», «baja el ritmo»): tiene que ser «es baja», «baja
// para/ante/contra/por…» o «de baja». «Vuelve» y «returns» solos tampoco («vuelve a ser campeón», «on return with»): tiene que
// decir a qué vuelve. Un «return from injury» o una operación dicen que está lesionado, no que vuelva ni cuándo
const STATUS = [
  ['suspended', /\b(sancionado|sancionada|cumple sancion|suspendido|suspended|suspension|banned|acumulacion de amarillas)\b/],
  ['out', /\b(es baja|sera baja|de baja|baja (?:para|ante|contra|por|en|del|de nuevo|segura|confirmada|varias|hasta|otra)|se pierde|se perdera|no jugara|no estara|no viaja|no entra en la convocatoria|fuera de la convocatoria|descartado|descartada|se rompe|rotura|lesion grave|adios a la temporada|ruled out|rul(?:e|es|ed) [a-z ]{0,40}\bout|out (?:for|against|vs|tonight|with|indefinitely)|will miss|to miss|misses|won t play|will not play|is out|sidelined|on (?:the )?sidelines|season ending|inactive)\b/],
  ['back', /\b(vuelve a (?:entrenar|los entrenamientos|la convocatoria|la lista|estar disponible|jugar|tener minutos)|vuelve tras|regresa a la convocatoria|reaparece|recuperado para|recibe el alta|alta medica|returns? to (?:training|practice|action|the lineup|lineup|full training)|back in (?:training|full training|the squad|the lineup)|cleared to (?:play|return)|available (?:again|to play|for)|fit again|will play|set to play|expected to play|is available|upgraded to available)\b/],
  ['doubt', /\b(duda|en duda|en el aire|molestias|tocado|tocada|questionable|doubtful|day to day|game time decision|fitness test|touch and go)\b/],
  ['injured', /\b(lesion|lesionado|lesionada|lesiones|injury|injured|hurt|operado|operada|surgery|rehab)\b/]
];
// «No es baja», «descarta la lesión», «no necesita operación», un recurso ganado contra la roja, eliminado por faltas en el
// partido: lo contrario
const DENIED = /\b(no es baja|no sera baja|no se pierde|descarta (?:la |una )?lesion|sin lesion|no necesita (?:operacion|pasar por el quirofano)|not injured|no injury|not ruled out|won t need surgery|will not need surgery|win appeal|wins appeal|won appeal|overturned|anulada|retirada la sancion|fouled out|eliminado por faltas)\b/;
// Una frase sobre el partido ya jugado («out 90 minutes before win over», «sat out», «se perdió»): las crónicas siempre dicen quién
// no jugó, y eso no es una baja para el siguiente
const PAST = /\b(before (?:a |the |their )?(?:win|loss|victory|defeat)|(?:in|during) (?:a |the |their )?(?:win|loss|victory|defeat|rout)\b|sat out|did not play|didn t play|was out|were out|missed (?:the|last|saturday|sunday|monday|tuesday|wednesday|thursday|friday|tonight)|se perdio|no jugo|no estuvo|fue baja)\b/;
// Dónde empieza (en palabras) lo que dice la frase: la primera regla de STATUS que encaja. null si no dice nada
function statusIn(words) {
  const c = ` ${words.join(' ')} `;
  if (PAST.test(c)) return null;
  for (const [st, re] of STATUS) {
    const m = re.exec(c);
    if (m) return { st, at: c.slice(0, m.index).trim().split(' ').filter(Boolean).length };
  }
  return null;
}
// Palabras como mucho entre el jugador y lo que se dice de él: menos en lo que más pesa (no juega, sancionado), que una baja
// mal puesta quita sus líneas y avisa
const NEAR = { out: 6, suspended: 6, back: 8, doubt: 10, injured: 10 };

// Los jugadores de los que habla una noticia y cómo están. players: los de los equipos de la noticia ({ name, team }). Cada
// jugador, por su nombre entero o por el apellido si sólo lo lleva él entre esos. Lo que dice tiene que estar en la misma frase (o
// trozo entre guiones y dos puntos) y cerca de él (NEAR): «Herro anota 32 y Turner 27; X, out» no es de Herro. Si una
// frase lo niega para él («no es baja», «gana el recurso»), en esa noticia no se dice nada de él. → [{ name, team, status }]
function playerStatuses(text, players) {
  const cands = players.map(p => ({ ...p, full: plain(p.name).split(' '), last: plain(p.name).split(' ').filter(w => w.length >= 4).at(-1) || '' }))
    .filter(p => p.full.join(' ').length >= 5);
  const lastCount = new Map();
  for (const p of cands) if (p.last) lastCount.set(p.last, (lastCount.get(p.last) || 0) + 1);
  // Dónde sale un jugador en una frase (en palabras): [inicio, fin]
  const spansOf = (w, p) => {
    const out = [];
    for (let i = 0; i < w.length; i++) {
      if (p.full.every((x, j) => w[i + j] === x)) out.push([i, i + p.full.length - 1]);
      else if (p.last && lastCount.get(p.last) === 1 && w[i] === p.last) out.push([i, i]);
    }
    return out;
  };
  const clauses = String(text || '').split(/(?<=[.;!?])\s+|\s+[-–—|]\s+|:\s+|\n+/).map(c => plain(c).split(' ').filter(Boolean)).filter(w => w.length);
  const out = new Map(), denied = new Set();
  const rank = st => STATUS.findIndex(([x]) => x === st);
  for (const w of clauses) {
    const no = DENIED.test(` ${w.join(' ')} `);
    const said = no ? null : statusIn(w);
    for (const p of cands) {
      const spans = spansOf(w, p);
      if (!spans.length) continue;
      const k = `${p.team}|${p.full.join(' ')}`;
      if (no) { denied.add(k); continue; }
      if (!said || !spans.some(([i, j]) => Math.min(Math.abs(said.at - j), Math.abs(said.at - i)) <= NEAR[said.st])) continue;
      // La frase más fuerte de la noticia gana (la primera de STATUS)
      if (!out.has(k) || rank(said.st) < rank(out.get(k).status)) out.set(k, { name: p.name, team: String(p.team), status: said.st });
    }
  }
  return [...out].filter(([k]) => !denied.has(k)).map(([, v]) => v);
}

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
function rowOf(source, item, teams, players = [], outs = []) {
  const d = new Date(item.published);
  const now = Date.now();
  // Una fecha que no se entiende o del futuro (husos mal puestos) cuenta como ahora
  const published = isNaN(+d) || +d > now + 10 * 60e3 ? new Date(now) : d;
  return {
    id: crypto.createHash('sha1').update(`${source}|${item.url}`).digest('hex').slice(0, 24), source, url: item.url,
    title: item.title.slice(0, 300), summary: item.summary || '', published, teams, players, outs, tags: tagsOf(`${item.title} ${item.summary}`)
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
// null si no ha cambiado desde la última vez (304)
const validators = new Map();
async function fetchText(url) {
  const v = validators.get(url) || {};
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json;q=0.9, */*;q=0.5', ...(v.etag ? { 'If-None-Match': v.etag } : {}), ...(v.modified ? { 'If-Modified-Since': v.modified } : {}) },
    signal: AbortSignal.timeout(20e3)
  });
  if (r.status === 304) return null;
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  validators.set(url, { etag: r.headers.get('etag') || '', modified: r.headers.get('last-modified') || '' });
  return r.text();
}

// schema: el esquema del servicio; rss: [{ name, url }]; espn: [{ url, keyOf }]; upcoming: () => los equipos de los próximos
// partidos ({ key?, id, name, short, alts, women? }); match: opciones de teamsIn; playersOf: (claves de equipo) => sus jugadores
// ({ name, team }), para saber de quién habla; onNew: las noticias nuevas que dicen que alguien no juega, duda, está lesionado,
// sancionado o vuelve (para avisar al momento)
function newsStore({ schema, rss = [], espn = [], upcoming, match = {}, playersOf = async () => [], onNew = async () => {} }) {
  const table = `${schema}.news`;
  // Los jugadores de los que habla y cómo están (los de ESPN ya vienen nombrados; también se buscan en la plantilla)
  async function withOuts(rows) {
    for (const r of rows) {
      const roster = await playersOf(r.teams).catch(() => []);
      const named = r.players.filter(n => !roster.some(p => plain(p.name) === plain(n))).map(name => ({ name, team: r.teams[0] }));
      r.outs = playerStatuses(`${r.title}. ${r.summary}`, [...roster, ...named]);
    }
    return rows;
  }
  async function save(rows) {
    const fresh = [];
    for (const r of await withOuts(rows)) {
      // Si ya estaba, sólo se añaden los equipos (puede que al verla aún no estuviera su partido en la lista): seen_at no cambia
      const { rows: [x] } = await query(`INSERT INTO ${table} (id, source, url, title, summary, published, teams, players, tags, outs)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT (id) DO UPDATE SET teams = (SELECT array_agg(DISTINCT x) FROM unnest(${table}.teams || EXCLUDED.teams) x), tags = EXCLUDED.tags,
          outs = EXCLUDED.outs
        RETURNING (xmax = 0) AS inserted, seen_at`,
      [r.id, r.source, r.url, r.title, r.summary, r.published, r.teams, r.players, r.tags, JSON.stringify(r.outs)]);
      // Sólo las que se ven por primera vez y son de hace menos de 12 h (al arrancar no se avisa de lo de ayer)
      if (x?.inserted && r.outs.length && Date.now() - +r.published < 12 * 3600e3) fresh.push({ ...r, seen_at: x.seen_at });
    }
    if (fresh.length) await onNew(fresh).catch(e => console.error(`[${schema}] avisos de noticias:`, e.message));
  }
  async function readRss() {
    const teams = await upcoming();
    for (const s of rss) {
      try {
        const xml = await fetchText(s.url);
        if (xml == null) continue;
        // Sólo las de algún equipo con partido: las demás no sirven para apostar
        const rows = rssItems(xml).map(i => rowOf(s.name, i, teamsIn(`${i.title} ${i.summary} ${i.cats.join(' ')}`, teams, match))).filter(r => r.teams.length);
        await save(rows);
      } catch (e) { console.error(`[${schema}] noticias`, s.name, e.message); }
    }
  }
  async function readEspn() {
    for (const s of espn) {
      try {
        const txt = await fetchText(s.url);
        if (txt != null) await save(espnRows(JSON.parse(txt), s.keyOf));
      } catch (e) { console.error(`[${schema}] noticias ESPN`, s.url, e.message); }
    }
  }
  // Las de unos equipos, de los últimos días, lo más nuevo primero
  async function newsFor(keys, days = 5) {
    const ids = keys.map(String).filter(Boolean).slice(0, 40);
    if (!ids.length) return [];
    const { rows } = await query(`SELECT id, source, url, title, summary, published, seen_at, teams, players, tags, outs FROM ${table}
      WHERE teams && $1 AND published > now() - make_interval(days => $2) ORDER BY published DESC LIMIT 200`, [ids, days]);
    return rows.map(r => ({ ...r, teams: r.teams.filter(t => ids.includes(t)) }));
  }
  // Cómo está cada jugador de esos equipos según la noticia más reciente que habla de él (de las últimas `hours` horas)
  async function statusOfPlayers(keys, hours = 48) {
    const { rows } = await query(`SELECT source, url, title, published, seen_at, outs FROM ${table}
      WHERE teams && $1 AND jsonb_array_length(outs) > 0 AND published > now() - make_interval(hours => $2) ORDER BY published DESC`, [keys.map(String), hours]);
    const out = new Map();
    for (const r of rows) for (const o of r.outs) {
      if (!keys.map(String).includes(o.team)) continue;
      const k = `${o.team}|${plain(o.name)}`;
      if (!out.has(k)) out.set(k, { ...o, news: { title: r.title, source: r.source, url: r.url, published: r.published, seen_at: r.seen_at } });
    }
    return [...out.values()];
  }
  function start() {
    const loop = (fn, every, delay) => { setTimeout(() => { fn().catch(() => {}); setInterval(() => fn().catch(() => {}), every); }, delay); };
    if (rss.length) loop(readRss, RSS_EVERY, 15e3);
    if (espn.length) loop(readEspn, ESPN_EVERY, 25e3);
    loop(() => query(`DELETE FROM ${table} WHERE published < now() - make_interval(days => $1)`, [KEEP_DAYS]), 6 * 3600e3, 60e3);
  }
  return { start, newsFor, statusOfPlayers };
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

module.exports = { newsStore, rssItems, tagsOf, teamsIn, namesOf, rowOf, espnRows, keyNews, playerStatuses, KEY_TAGS, plain };
