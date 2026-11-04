// tennis-svc: tenis ATP y WTA (individuales) de la API pública de ESPN: partidos de los torneos en juego con su
// marcador por sets, días en hora de España y rankings. Caché en memoria y en tennis.cache (por si ESPN no responde).
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');

const TOURS = { atp: 'ATP', wta: 'WTA' };
const site = t => `https://site.api.espn.com/apis/site/v2/sports/tennis/${t}`;

// ---------- caché ----------
const mem = new Map();
async function getJSON(url, ttlMs) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const v = await res.json();
    mem.set(url, { t: Date.now(), v });
    query(`INSERT INTO tennis.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`,
      [url, JSON.stringify(v)]).catch(e => console.error('tennis.cache:', e.message));
    return v;
  } catch (e) {
    const old = hit?.v ?? (await query('SELECT value FROM tennis.cache WHERE key = $1', [url]).catch(() => ({ rows: [] }))).rows[0]?.value;
    if (old) return old;
    throw new Error(`No se pudo leer ESPN (${e.message})`);
  }
}

// ---------- días en hora de España (igual que en basket) ----------
function tzOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
}
const dayStart = ymd => { const [y, m, d] = ymd.split('-').map(Number); const g = Date.UTC(y, m - 1, d); return g - tzOffset(g); };
const madridDay = t => new Date(t + tzOffset(t)).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.UTC(...ymd.split('-').map((v, i) => +v - (i === 1 ? 1 : 0))) + n * 864e5).toISOString().slice(0, 10);
const ymd = s => s.replace(/-/g, '');
const valid = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw fail('Fecha no válida (AAAA-MM-DD)'); return d; };

// "Round 1" → "1.ª ronda", "Quarterfinals" → "Cuartos de final"…
function roundEs(r) {
  const s = String(r || '');
  const m = s.match(/^(Qualifying )?(\d)(?:st|nd|rd|th)? Round$|^(Qualifying )?Round (\d)$/i);
  if (m) return `${m[1] || m[3] ? 'Previa, ' : ''}${m[2] || m[4]}.ª ronda`;
  return ({ 'round of 16': 'Octavos de final', quarterfinals: 'Cuartos de final', quarterfinal: 'Cuartos de final', semifinals: 'Semifinales', semifinal: 'Semifinales', final: 'Final' })[s.toLowerCase()] || s;
}

// "2nd Set" → "2.º set", "Final" → "Final"
const statusEs = s => String(s || '').replace(/^(\d)(?:st|nd|rd|th) Set$/i, '$1.º set').replace(/^Final$/i, 'Final').replace(/^Retired$/i, 'Retirada').replace(/^Walkover$/i, 'W.O.');

const player = (x, rankById) => {
  const a = x.athlete || {};
  const id = String(x.id || '');
  const last = String(a.displayName || '').split(' ').slice(1).join(' ') || a.displayName || '';
  return {
    id, name: a.displayName || '', short: a.shortName || '', flag: a.flag?.href || '', country: a.flag?.alt || '',
    seed: x.curatedRank?.current ?? null, rank: rankById[id]?.rank ?? null,
    sets: (x.linescores || []).map(l => Number(l.value)), setWins: (x.linescores || []).map(l => !!l.winner),
    tiebreaks: (x.linescores || []).map(l => (l.tiebreak != null ? Number(l.tiebreak) : null)),
    winner: !!x.winner,
    // Cómo lo llaman las casas: "Sinner J.", "J. Sinner", "Sinner"
    alt: [...new Set([last, a.shortName, last && a.displayName ? `${last} ${a.displayName[0]}` : null].filter(Boolean))]
  };
};

async function ranks(tour) {
  const j = await getJSON(`${site(tour)}/rankings`, 6 * 3600e3);
  const list = (j.rankings?.[0]?.ranks || []).map(r => ({
    rank: r.current, previous: r.previous, points: r.points, trend: r.trend || '',
    id: String(r.athlete?.id || ''), name: r.athlete?.displayName || '', short: r.athlete?.shortname || '', flag: r.athlete?.flag?.href || '', country: r.athlete?.flag?.alt || ''
  }));
  return list;
}

// Partidos individuales de los torneos que salen en el marcador de ESPN (trae el torneo entero)
async function matches(tour, days) {
  const [rk, ...boards] = await Promise.all([ranks(tour).catch(() => []), ...days.map(d => getJSON(`${site(tour)}/scoreboard?dates=${d}`, 60e3))]);
  const rankById = Object.fromEntries(rk.map(r => [r.id, r]));
  const seen = new Set(), out = [];
  for (const j of boards) {
    for (const e of j.events || []) {
      for (const g of e.groupings || []) {
        if (!/singles/i.test(g.grouping?.slug || g.grouping?.displayName || '')) continue;
        for (const c of g.competitions || []) {
          if (seen.has(c.id) || (c.competitors || []).length !== 2) continue;
          seen.add(c.id);
          const st = c.status?.type?.state;
          const [a, b] = c.competitors.slice().sort((x, y) => (x.order || 0) - (y.order || 0)).map(x => player(x, rankById));
          out.push({
            id: `${tour}:${c.id}`, tour, tournament: e.name || '', tournamentId: e.id, major: !!e.major, date: c.date,
            state: st === 'in' ? 'in' : st === 'post' ? 'post' : 'pre', status: st === 'pre' ? '' : statusEs(c.status?.type?.detail),
            round: roundEs(c.round?.displayName), court: c.venue?.court || '', city: c.venue?.fullName || '',
            bestOf: c.format?.regulation?.periods || 3, note: c.notes?.[0]?.text || '', a, b
          });
        }
      }
    }
  }
  return out;
}

async function between(from, to) {
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const days = []; for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) days.push(ymd(d));
  const lists = await Promise.all(Object.keys(TOURS).map(t => matches(t, days).catch(e => { console.error(`[tennis] ${t}:`, e.message); return []; })));
  return lists.flat().filter(m => { const t = new Date(m.date).getTime(); return t >= a && t < b; })
    .sort((x, y) => new Date(x.date) - new Date(y.date));
}

const routes = [
  ['GET', '/api/tennis/games', ({ query: q }) => between(valid(q.date), valid(q.date))],
  ['GET', '/api/tennis/days', async ({ query: q }) => {
    const from = valid(q.from), n = Math.min(21, Math.max(1, Number(q.n) || 7));
    const list = await between(from, addDays(from, n - 1));
    const out = {};
    for (let i = 0; i < n; i++) out[addDays(from, i)] = { total: 0, live: 0 };
    for (const m of list) { const d = out[madridDay(new Date(m.date).getTime())]; if (d) { d.total++; if (m.state === 'in') d.live++; } }
    return out;
  }],
  ['GET', '/api/tennis/live', async () => { const t = madridDay(Date.now()); return (await between(addDays(t, -1), t)).filter(m => m.state === 'in'); }],
  ['GET', '/api/tennis/rankings/:tour', ({ params }) => { if (!TOURS[params.tour]) throw fail('Circuito desconocido'); return ranks(params.tour); }],
  // Partidos de un jugador en los torneos en juego (su camino en el torneo y lo último que ha jugado)
  ['GET', '/api/tennis/player/:tour/:id', async ({ params }) => {
    if (!TOURS[params.tour]) throw fail('Circuito desconocido');
    const t = madridDay(Date.now());
    const list = await between(addDays(t, -10), addDays(t, 3));
    return list.filter(m => m.tour === params.tour && (m.a.id === params.id || m.b.id === params.id)).reverse();
  }]
];

migrate('tennis', path.join(__dirname, 'migrations'))
  .then(() => query(`DELETE FROM tennis.cache WHERE t < now() - interval '7 days'`))
  .then(() => start({ name: 'tennis', port: Number(process.env.PORT) || 4005, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
