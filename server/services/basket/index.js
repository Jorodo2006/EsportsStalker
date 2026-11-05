// basket-svc: baloncesto de varias ligas en un mismo formato. NBA y WNBA salen de ESPN, y la Euroliga y la EuroCup
// de la API de la Euroliga. Los días van en hora de España, así que un NBA a la 01:30 cuenta en el día siguiente.
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const cache = require('./cache');
const espn = require('./espn');
const el = require('./euroleague');

const LEAGUES = [
  { id: 'nba', name: 'NBA', country: 'EE. UU.', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', src: espn },
  { id: 'euroleague', name: 'Euroliga', country: 'Europa', logo: '', src: el },
  { id: 'eurocup', name: 'EuroCup', country: 'Europa', logo: '', src: el },
  { id: 'wnba', name: 'WNBA', country: 'EE. UU.', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/wnba.png', src: espn }
];
const league = id => { const l = LEAGUES.find(x => x.id === id); if (!l) throw fail('Liga desconocida'); return l; };

// ---------- días en hora de España ----------
function tzOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
}
const dayStart = ymd => { const [y, m, d] = ymd.split('-').map(Number); const g = Date.UTC(y, m - 1, d); return g - tzOffset(g); };
const madridDay = t => new Date(t + tzOffset(t)).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.UTC(...ymd.split('-').map((v, i) => +v - (i === 1 ? 1 : 0))) + n * 864e5).toISOString().slice(0, 10);
const ymd = s => String(s).replace(/-/g, '');
const usDays = (from, to) => { const out = []; for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) out.push(ymd(d)); return out; };
const valid = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw fail('Fecha no válida (AAAA-MM-DD)'); return d; };

// Todos los partidos entre dos días de España (ambos incluidos), de todas las ligas
async function between(from, to) {
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const parts = await Promise.all(LEAGUES.map(async l => {
    try {
      // En EE. UU. aún es el día anterior cuando en España ya es de madrugada
      const list = l.src === espn ? await espn.games(l.id, usDays(from, to)) : await el.games(l.id, a, b);
      return list.filter(g => { const t = new Date(g.date).getTime(); return t >= a && t < b; });
    } catch (e) {
      console.error(`[basket] ${l.id}:`, e.message);
      return [];
    }
  }));
  return parts.flat().sort((x, y) => new Date(x.date) - new Date(y.date));
}

const meta = () => LEAGUES.map(({ src: _, ...l }) => l);

const routes = [
  ['GET', '/api/basket/leagues', () => meta()],
  ['GET', '/api/basket/games', async ({ query: q }) => between(valid(q.date), valid(q.date))],
  // Cuántos partidos hay cada día (para la tira de días)
  ['GET', '/api/basket/days', async ({ query: q }) => {
    const from = valid(q.from), n = Math.min(21, Math.max(1, Number(q.n) || 7));
    const list = await between(from, addDays(from, n - 1));
    const out = {};
    for (let i = 0; i < n; i++) out[addDays(from, i)] = { total: 0, live: 0 };
    for (const g of list) { const d = out[madridDay(new Date(g.date).getTime())]; if (d) { d.total++; if (g.state === 'in') d.live++; } }
    return out;
  }],
  ['GET', '/api/basket/live', async () => {
    const today = madridDay(Date.now());
    return (await between(addDays(today, -1), today)).filter(g => g.state === 'in');
  }],
  ['GET', '/api/basket/standings/:league', ({ params }) => league(params.league).src.standings(params.league)],
  // Color principal y secundario de cada equipo: { idEquipo: { color, alt } }
  ['GET', '/api/basket/colors/:league', ({ params }) => league(params.league).src.colors(params.league)],
  ['GET', '/api/basket/team/:league/:team', ({ params }) => league(params.league).src.team(params.league, params.team)],
  ['GET', '/api/basket/roster/:league/:team', ({ params }) => league(params.league).src.roster(params.league, params.team)],
  // Partidos terminados de toda la liga con sus parciales: de aquí salen los puntos de los equipos y la proyección del total
  ['GET', '/api/basket/league-games/:league', ({ params }) => league(params.league).src.leagueGames(params.league)],
  // Plantilla con los partidos de cada jugador, para el escáner de líneas
  ['GET', '/api/basket/team-logs/:league/:team', ({ params }) => league(params.league).src.teamLogs(params.league, params.team)],
  ['GET', '/api/basket/injuries', () => espn.injuries('nba')],
  // id = "nba:401909912" o "euroleague:E2026_10" (el id del partido en la lista)
  ['GET', '/api/basket/boxscore/:id', ({ params }) => {
    const [lg, ...rest] = String(params.id).split(':');
    const l = league(lg);
    return l.src.boxscore(l.id, rest.join(':'));
  }],
  ['GET', '/api/basket/search', async ({ query: q }) => {
    const lists = await Promise.all(LEAGUES.filter(l => l.id !== 'wnba').map(l => l.src.search(l.id, q.q).catch(() => [])));
    return lists.flat().slice(0, 30);
  }],
  ['GET', '/api/basket/gamelog/:league/:id', ({ params, query: q }) => {
    const l = league(params.league);
    if (l.src === el && !q.team) throw fail('Falta el equipo del jugador');
    return l.src === el ? el.gamelog(l.id, params.id, q.team) : espn.gamelog(l.id, params.id);
  }]
];

migrate('basket', path.join(__dirname, 'migrations'))
  .then(() => cache.init())
  .then(() => start({ name: 'basket', port: Number(process.env.PORT) || 4004, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
