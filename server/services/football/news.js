// Noticias de fútbol: se leen cada pocos minutos de fuentes gratuitas y se unen a los equipos de los próximos partidos, para
// verlas en la ficha del partido antes de apostar (bajas, dudas, vueltas, sanciones, rotaciones, alineaciones, entrenadores).
// Fuentes (sus robots.txt permiten leer estos RSS; Marca y AS no se usan: sus RSS llevan semanas o años sin actualizarse):
// - ESPN: las noticias de cada liga, que ya traen el equipo (teamId) y los jugadores
// - Mundo Deportivo, BBC Sport y The Guardian: RSS de fútbol; el equipo se busca por su nombre en el titular y la entradilla
// Lo puro (leer el RSS, etiquetar, buscar equipos) va aparte de lo que pide y guarda, para probarlo sin red (news.test.js).
const crypto = require('crypto');
const { query } = require('../../shared/db');

const UA = 'Sharpex/1.0';
const RSS = [
  { id: 'md', name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/futbol.xml' },
  { id: 'bbc', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/football/rss' }
];
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
  ['baja', /\b(bajas?|lesi[oó]n|lesionad[oa]s?|se pierde|se perder[aá]|descartad[oa]s?|rotura|ruled out|out for|injur(?:y|ed|ies)|sidelined|will miss|to miss)\b/i],
  ['duda', /\b(duda|dudas|en el aire|molestias|tocad[oa]|doubts?|doubtful|fitness test|late fitness|touch and go)\b/i],
  ['vuelve', /\b(vuelve|regresa|recuperad[oa]|alta m[eé]dica|returns?|back in training|fit again|available again)\b/i],
  ['sancion', /\b(sancionad[oa]s?|sanci[oó]n|suspendid[oa]|suspended|suspension|banned|expulsad[oa]|acumulaci[oó]n de amarillas)\b/i],
  ['rotacion', /\b(rotaci[oó]n|rotaciones|reservas|rotate|rotation|rested)\b/i],
  ['alineacion', /\b(alineaci[oó]n|convocatoria|convocados|once inicial|line-?up|starting xi|team news)\b/i],
  ['entrenador', /\b(destituid[oa]|cesad[oa]|nuevo entrenador|sacked|new (?:manager|head coach|boss)|interim (?:manager|coach))\b/i]
];
const tagsOf = text => TAGS.filter(([, re]) => re.test(text)).map(([t]) => t);

// Sin acentos ni mayúsculas, sólo letras, cifras y espacios
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Palabras que comparten muchos clubes: solas no dicen de qué equipo es
const COMMON = new Set(['real', 'club', 'city', 'united', 'sporting', 'athletic', 'atletico', 'deportivo', 'union', 'inter', 'fc', 'cf', 'sc', 'ac']);
// Cómo llama la prensa a algunos equipos que ESPN nombra de otra manera (por el nombre de ESPN, sin acentos)
const NICK = {
  barcelona: ['barca'], 'atletico madrid': ['atleti', 'atletico de madrid'], internazionale: ['inter de milan'], espanyol: ['perico', 'pericos'],
  'bayern munich': ['bayern de munich', 'bayern munchen'], 'paris saint germain': ['paris sg'], 'athletic club': ['athletic de bilbao', 'athletic bilbao'],
  'celta vigo': ['celta', 'celta de vigo'], 'deportivo alaves': ['alaves'], 'wolverhampton wanderers': ['wolves'], 'borussia dortmund': ['dortmund'],
  'manchester united': ['man united'], 'tottenham hotspur': ['tottenham']
};
// Los nombres con los que puede salir un equipo en un titular: el entero, el corto, los otros y sus apodos, de 4 letras o más
function namesOf(team) {
  const own = [team.name, team.short, ...(team.alts || [])].map(plain);
  return [...new Set([...own, ...(NICK[plain(team.name)] || [])].filter(n => n.length >= 4 && !COMMON.has(n)))];
}
// Los equipos (ids) que nombra un texto, de los de los próximos partidos. Por frases enteras; un nombre que queda dentro del de
// otro equipo no cuenta («Milan» en «Inter de Milán»)
// Una noticia del fútbol femenino lo dice («femenino», «women», «Liga F», «WSL»); si no, es del masculino
function teamsIn(text, teams) {
  const t = ` ${plain(text)} `;
  const women = /\b(femenin[oa]|women|womens|liga f|wsl)\b/.test(t);
  const spans = [];
  for (const team of teams) {
    if (!!team.women !== women) continue;
    for (const n of namesOf(team)) {
      for (let i = t.indexOf(` ${n} `); i >= 0; i = t.indexOf(` ${n} `, i + 1)) spans.push({ id: String(team.id), a: i, b: i + n.length + 1 });
    }
  }
  const inside = s => spans.some(o => o.id !== s.id && o.a <= s.a && o.b >= s.b && o.b - o.a > s.b - s.a);
  return [...new Set(spans.filter(s => !inside(s)).map(s => s.id))];
}

// Una noticia de una fuente → la fila que se guarda
function rowOf(source, item, teams, players = []) {
  const text = `${item.title} ${item.summary} ${(item.cats || []).join(' ')}`;
  const d = new Date(item.published);
  const now = Date.now();
  // Una fecha que no se entiende o del futuro (husos mal puestos) cuenta como ahora
  const published = isNaN(+d) || +d > now + 10 * 60e3 ? new Date(now) : d;
  return {
    id: crypto.createHash('sha1').update(`${source}|${item.url}`).digest('hex').slice(0, 24), source, url: item.url,
    title: item.title.slice(0, 300), summary: item.summary || '', published, teams, players, tags: tagsOf(`${item.title} ${item.summary}`), text
  };
}

// ---------- con red y base de datos ----------
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function save(rows) {
  for (const r of rows) {
    // Si ya estaba, sólo se añaden los equipos (puede que al verla aún no estuviera su partido en la lista): seen_at no cambia
    await query(`INSERT INTO football.news (id, source, url, title, summary, published, teams, players, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET teams = (SELECT array_agg(DISTINCT x) FROM unnest(football.news.teams || EXCLUDED.teams) x), tags = EXCLUDED.tags`,
    [r.id, r.source, r.url, r.title, r.summary, r.published, r.teams, r.players, r.tags]);
  }
}

// upcoming: () => los equipos de los partidos de ayer a dentro de unos días ({ id, name, short, alts })
async function readRss(upcoming) {
  const teams = await upcoming();
  for (const s of RSS) {
    try {
      const items = rssItems(await fetchText(s.url));
      // Sólo las de algún equipo con partido: las demás no sirven para apostar
      const rows = items.map(i => rowOf(s.name, i, teamsIn(`${i.title} ${i.summary} ${i.cats.join(' ')}`, teams))).filter(r => r.teams.length);
      await save(rows);
    } catch (e) { console.error('[football] noticias', s.name, e.message); }
  }
}

// ESPN: cada liga trae sus noticias con el equipo y los jugadores. Los vídeos de resúmenes (Media) no dicen nada antes del partido
async function readEspn(leagues) {
  for (const lg of leagues) {
    try {
      const d = JSON.parse(await fetchText(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.espn}/news?limit=50`));
      const rows = (d.articles || []).filter(a => a.type !== 'Media' && a.headline).map(a => {
        const cats = a.categories || [];
        const teams = [...new Set(cats.filter(c => c.type === 'team' && c.teamId).map(c => String(c.teamId)))];
        const players = [...new Set(cats.filter(c => c.type === 'athlete' && c.description).map(c => c.description))];
        return rowOf('ESPN', { title: clean(a.headline), url: a.links?.web?.href || '', summary: clean(a.description || '').slice(0, 400), published: a.published, cats: [] }, teams, players);
      }).filter(r => r.teams.length && /^https?:\/\//.test(r.url));
      await save(rows);
    } catch (e) { console.error('[football] noticias ESPN', lg.id, e.message); }
  }
}

// Las de los equipos de un partido, de los últimos días, lo más nuevo primero
async function newsFor(teamIds, days = 5) {
  const ids = teamIds.map(String).filter(Boolean).slice(0, 2);
  if (!ids.length) return [];
  const { rows } = await query(`SELECT id, source, url, title, summary, published, seen_at, teams, players, tags FROM football.news
    WHERE teams && $1 AND published > now() - make_interval(days => $2) ORDER BY published DESC LIMIT 60`, [ids, days]);
  return rows.map(r => ({ ...r, teams: r.teams.filter(t => ids.includes(t)) }));
}

function startNews({ upcoming, leagues }) {
  const loop = (fn, every, delay) => { setTimeout(() => { fn().catch(() => {}); setInterval(() => fn().catch(() => {}), every); }, delay); };
  loop(() => readRss(upcoming), RSS_EVERY, 15e3);
  loop(() => readEspn(leagues), ESPN_EVERY, 25e3);
  loop(() => query(`DELETE FROM football.news WHERE published < now() - make_interval(days => $1)`, [KEEP_DAYS]), 6 * 3600e3, 60e3);
}

module.exports = { startNews, newsFor, rssItems, tagsOf, teamsIn, rowOf, namesOf };
