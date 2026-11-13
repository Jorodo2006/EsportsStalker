// tennis-svc: tenis ATP y WTA (individuales) de la API pública de ESPN: partidos de los torneos en juego con su
// marcador por sets, días en hora de España y rankings. Caché en memoria y en tennis.cache (por si ESPN no responde).
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const { cachedJSON, warmEvery } = require('../../shared/cached');
const tml = require('./tml');
const { photoOf } = require('./photos');
const { picksFor } = require('./picks');
const { withPoints } = require('./points');
const ls = require('./livescore');
const { hits, queryOf } = require('../../shared/search');

const TOURS = { atp: 'ATP', wta: 'WTA' };
const site = t => `https://site.api.espn.com/apis/site/v2/sports/tennis/${t}`;
const core = t => `https://sports.core.api.espn.com/v2/sports/tennis/leagues/${t}`;
const HISTORY_TOURNAMENTS = 12; // cada torneo del historial cuesta dos peticiones a ESPN

// ---------- caché ----------
// En memoria y en tennis.cache, sirviendo lo caducado hace poco mientras se renueva (shared/cached.js). En la tabla, como mucho
// cada minuto: es sólo una copia por si ESPN no responde, no hace falta guardarla cada 20 s
const getJSON = cachedJSON({ table: 'tennis.cache', saveEvery: 60e3 });

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
    id: String(r.athlete?.id || ''), name: r.athlete?.displayName || '', short: r.athlete?.shortname || '', flag: r.athlete?.flag?.href || (typeof r.athlete?.flag === 'string' ? r.athlete.flag : ''), country: r.athlete?.flagAltText || r.athlete?.flag?.alt || r.athlete?.citizenshipCountry || ''
  }));
  return list;
}

// Partidos individuales de los torneos que salen en el marcador de ESPN (trae el torneo entero). 20 s: los puntos del juego sólo se
// enseñan si los juegos cuadran con los de ESPN, y con más caché desaparecerían un buen rato al acabar cada juego
async function matches(tour, days, ttl = 20e3) {
  const [rk, ...boards] = await Promise.all([ranks(tour).catch(() => []), ...days.map(d => getJSON(`${site(tour)}/scoreboard?dates=${d}`, ttl))]);
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
            // ESPN da 5 sets a todos los partidos de la ATP: sólo son a cinco los Grand Slam masculinos
            bestOf: tour === 'atp' && e.major ? 5 : 3, note: c.notes?.[0]?.text || '', a, b
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
  const all = lists.flat();
  const list = all.filter(m => { const t = new Date(m.date).getTime(); return t >= a && t < b; }).sort((x, y) => new Date(x.date) - new Date(y.date));
  return checkRivals(list, all, days);
}

// ESPN a veces pone a la rival equivocada en un cruce (en las WTA Finals de 2026 dio a Shnaider, la reserva, en lugar de
// Muchova, mientras LiveScore y las casas seguían con Muchova). Con eso el partido se queda sin cuotas ni recomendaciones,
// porque las casas no lo tienen. Si LiveScore tiene el partido a la misma hora con uno de los dos y otro rival, se pone el de
// LiveScore, con su ficha de ESPN. Sólo si ESPN la tiene en ese torneo (sale en otro partido): si no, lo normal es que sea el
// mismo jugador escrito de otra forma ("Shnaider" y "Shnayder") y no se toca. Se avisa en `fixed`
const keyOf = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).pop();
const told = new Set(); // cada corrección se apunta en el registro una vez, no en cada consulta
async function checkRivals(list, all, days) {
  if (!list.some(m => m.state !== 'post')) return list;
  const ev = await ls.mainTour(days).catch(e => { console.error('[tennis] LiveScore (cruces):', e.message); return []; });
  if (!ev.length) return list;
  const fresh = p => ({ ...p, sets: [], setWins: [], tiebreaks: [], winner: false });
  return list.map(m => {
    if (m.state === 'post') return m;
    const t = new Date(m.date).getTime(), ka = keyOf(m.a.name), kb = keyOf(m.b.name);
    for (const e of ev) {
      if (Math.abs(e.at - t) > 30 * 60e3) continue;
      const ea = keyOf(e.a), eb = keyOf(e.b);
      const keep = [ka, kb].filter(k => k === ea || k === eb);
      if (keep.length !== 1) continue;
      const side = keep[0] === ka ? 'b' : 'a', wrong = m[side];
      if (/^(tbd|por determinar)$/i.test(wrong.name)) continue;
      const k = keyOf(keep[0] === ea ? e.b : e.a);
      const known = all.find(x => x.tournamentId === m.tournamentId && (keyOf(x.a.name) === k || keyOf(x.b.name) === k));
      if (!known) continue;
      const right = fresh(keyOf(known.a.name) === k ? known.a : known.b);
      const note = `${m.id}: ESPN da a ${wrong.name} y LiveScore a ${right.name}; se usa LiveScore`;
      if (!told.has(note)) { told.add(note); console.log(`[tennis] ${note}`); }
      return { ...m, [side]: right, fixed: `ESPN daba a ${wrong.name}; LiveScore y las casas, a ${right.name}` };
    }
    return m;
  });
}

// Los Challenger sólo entran en las pantallas de partidos: el modelo, las recomendaciones y las fichas de jugador no tienen sus datos
// (su motor va aparte, servicio challenger)
async function withChallengers(list, from, to) {
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const days = []; for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) days.push(ymd(d));
  const extra = await ls.challengers(days).catch(e => { console.error('[tennis] Challenger:', e.message); return []; });
  return [...list, ...extra.filter(m => { const t = new Date(m.date).getTime(); return t >= a && t < b; })].sort((x, y) => new Date(x.date) - new Date(y.date));
}

// ---------- Ficha de un jugador ----------
// Las referencias de la API core vienen con http://
const secure = u => String(u || '').replace(/^http:/, 'https:');
const statsOf = j => Object.fromEntries((j?.splits?.categories || []).flatMap(c => c.stats || []).map(s => [s.name, s.value]));
const record = st => (st.singlesWon == null ? null : { won: st.singlesWon, lost: st.singlesLost ?? 0, titles: st.singlesTitles ?? 0, doublesTitles: st.doublesTitles ?? 0, prize: st.prize ?? 0 });

// "6-3 7-6(5)": entre paréntesis, los puntos del que pierde el desempate
const scoreFor = (me, rival) => me.sets.map((v, i) => {
  const a = me.tiebreaks[i], b = rival.tiebreaks[i];
  return `${v}-${rival.sets[i] ?? ''}${a != null && b != null ? `(${Math.min(a, b)})` : ''}`;
}).join(' ');

// ESPN sólo da referencias a cada partido, y pedirlas una a una serían decenas de peticiones:
// se pide el cuadro de cada torneo (con caché) y se buscan ahí sus partidos
async function history(tour, id) {
  const log = await getJSON(`${core(tour)}/athletes/${id}/eventlog?limit=50`, 3600e3);
  const wanted = new Map(); // referencia del torneo → ids de sus partidos
  for (const it of log?.events?.items || []) {
    const ref = secure(it.event?.$ref), comp = String(it.competition?.$ref || '').match(/competitions\/(\d+)/)?.[1];
    if (!it.played || !ref || !comp) continue;
    if (!wanted.has(ref) && wanted.size >= HISTORY_TOURNAMENTS) continue;
    if (!wanted.has(ref)) wanted.set(ref, new Set());
    wanted.get(ref).add(`${tour}:${comp}`);
  }
  const lists = await Promise.allSettled([...wanted].map(async ([ref, comps]) => {
    const ev = await getJSON(ref, 12 * 3600e3);
    // Un torneo terminado ya no cambia; el que está en juego, sí
    const over = new Date(ev.endDate || 0).getTime() < Date.now();
    return (await matches(tour, [ymd(String(ev.date).slice(0, 10))], over ? 6 * 3600e3 : 5 * 60e3)).filter(m => comps.has(m.id));
  }));
  return lists.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).flatMap(m => {
    const me = m.a.id === id ? m.a : m.b.id === id ? m.b : null, rival = me === m.a ? m.b : m.a;
    if (!me || m.state !== 'post' || !rival.name) return []; // dobles, byes y partidos sin jugar no están en el cuadro individual
    return [{
      id: m.id, date: m.date, tournament: m.tournament, major: m.major, round: m.round, city: m.city, win: me.winner, score: scoreFor(me, rival),
      note: /^final$/i.test(m.status) ? '' : m.status, sets: me.sets.length, games: me.sets.reduce((t, v, i) => t + v + (rival.sets[i] || 0), 0),
      opponent: { id: rival.id, name: rival.name, flag: rival.flag, rank: rival.rank }
    }];
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function profile(tour, id) {
  const year = new Date().getFullYear();
  const [a, career, season, last, list, rk] = await Promise.all([
    getJSON(`${core(tour)}/athletes/${id}?lang=es&region=es`, 6 * 3600e3),
    getJSON(`${core(tour)}/athletes/${id}/statistics`, 6 * 3600e3).catch(() => null),
    getJSON(`${core(tour)}/seasons/${year}/types/2/athletes/${id}/statistics`, 3600e3).catch(() => null),
    // En enero la temporada acaba de empezar: la anterior sigue dando contexto
    getJSON(`${core(tour)}/seasons/${year - 1}/types/2/athletes/${id}/statistics`, 24 * 3600e3).catch(() => null),
    history(tour, id).catch(e => { console.error('[tennis] historial:', e.message); return []; }),
    ranks(tour).catch(() => [])
  ]);
  const r = rk.find(x => x.id === id);
  const photo = await photoOf(id, a.displayName || '');
  return {
    id, tour, name: a.displayName || '', photo: photo.url, photoFrom: photo.from,
    flag: r?.flag || '', country: r?.country || '', rank: r?.rank ?? null, previous: r?.previous ?? null, points: r?.points ?? null,
    age: a.age ?? null, birthDate: a.dateOfBirth || null, birthPlace: a.birthPlace?.summary || '', height: a.displayHeight || '', weight: a.displayWeight || '',
    hand: ({ RIGHT: 'Diestro', LEFT: 'Zurdo' })[a.hand?.type] || '', years: a.experience?.years ?? null, debut: a.debutYear ?? null, active: a.active !== false,
    year, season: record(statsOf(season)), lastSeason: record(statsOf(last)), career: record(statsOf(career)), matches: list
  };
}

// Recomendaciones de todos los partidos sin empezar de un día de la ATP y la WTA. Sin la previa: casi nadie la apuesta y el lector no la mira.
// Mirar todo el día cuesta: se guarda un minuto, y las pantallas que lo piden a la vez esperan al mismo cálculo
const boards = new Map();
function boardOf(date) {
  const hit = boards.get(date);
  if (hit && Date.now() - hit.t < 60e3) return hit.v;
  const v = (async () => {
    // Sin los cruces que aún no tienen rival ("TBD"): no pueden tener cuotas
    const known = p => p.name && !/^(tbd|por determinar)$/i.test(p.name);
    const list = (await between(date, date)).filter(m => m.state === 'pre' && !/^previa/i.test(m.round) && known(m.a) && known(m.b));
    const matches = [], noOdds = [];
    for (const m of list) {
      const r = await picksFor(m).catch(e => { console.error('[tennis] recomendaciones:', m.id, e.message); return null; });
      if (r?.ready) matches.push({ m, day: date, ...r });
      else if (r?.reason === 'noodds') noOdds.push({ id: m.id, date: m.date, a: m.a.name, b: m.b.name });
    }
    return { matches, noOdds };
  })();
  boards.set(date, { t: Date.now(), v });
  v.catch(() => boards.delete(date));
  return v;
}

// Buscador: partidos de ayer a dentro de una semana (sin los Challenger, que salen aparte) y torneos de esos días
async function search(raw) {
  const q = queryOf(raw);
  if (!q) return { matches: [], competitions: [] };
  const t = madridDay(Date.now());
  const list = await between(addDays(t, -1), addDays(t, 7));
  const who = p => [p.name, p.short, ...(p.alt || [])];
  const score = m => m.a.sets.map((x, i) => `${x}-${m.b.sets[i] ?? 0}`).join(' ') || null;
  const matches = list.filter(m => hits(q, [...who(m.a), ...who(m.b)]) || hits(q, [m.tournament, m.city])).map(m => ({
    sport: 'tennis', id: m.id, home: m.a.name, away: m.b.name, league: m.tournament, stage: m.round, date: m.date, state: m.state,
    status: m.status, score: m.state === 'pre' ? null : score(m), team: hits(q, [...who(m.a), ...who(m.b)])
  }));
  const tours = new Map();
  for (const m of list) if (!tours.has(m.tournament) && hits(q, [m.tournament, m.city])) tours.set(m.tournament, m);
  const competitions = [...tours.values()].map(m => ({
    sport: 'tennis', id: m.tournamentId || m.tournament, name: m.tournament, sub: [TOURS[m.tour], m.city].filter(Boolean).join(' · '),
    next: list.filter(x => x.tournament === m.tournament && x.state !== 'post')[0]?.date || null
  }));
  return { matches, competitions };
}

const routes = [
  ['GET', '/api/tennis/search', ({ query: q }) => search(q.q)],
  // Saque, resto, juegos y superficie (TennisMyLife). El id es el de ESPN: su nombre sirve para buscarlo en esos datos
  ['GET', '/api/tennis/stats/:tour/:id', async ({ params }) => {
    if (!TOURS[params.tour] || !/^\d+$/.test(params.id)) throw fail('Jugador desconocido');
    const a = await getJSON(`${core(params.tour)}/athletes/${params.id}?lang=es&region=es`, 6 * 3600e3);
    return tml.playerStats(params.tour, a.displayName);
  }],
  ['GET', '/api/tennis/surface/:tour', ({ params, query: q }) => {
    if (!TOURS[params.tour]) throw fail('Circuito desconocido');
    return tml.tournamentSurface(params.tour, q.name, q.city);
  }],
  ['GET', '/api/tennis/profile/:tour/:id', ({ params }) => {
    if (!TOURS[params.tour] || !/^\d+$/.test(params.id)) throw fail('Jugador desconocido');
    return profile(params.tour, params.id);
  }],
  // Recomendaciones de un partido; las de todos los partidos de un día que tienen cuotas leídas (board), y la más fiable y la
  // más complicada de cada uno, de la más probable a la menos (day: la portada Hoy)
  ['GET', '/api/tennis/picks', async ({ query: q }) => {
    const m = (await between(valid(q.date), valid(q.date))).find(x => x.id === q.id);
    if (!m) throw fail('Partido no encontrado');
    return picksFor(m);
  }],
  ['GET', '/api/tennis/picks/board', ({ query: q }) => boardOf(valid(q.date))],
  ['GET', '/api/tennis/picks/day', async ({ query: q }) => (await boardOf(valid(q.date))).matches.filter(x => x.top)
    .map(({ m, top, hard }) => ({ id: m.id, tour: m.tour, tournament: m.tournament, round: m.round, date: m.date, a: m.a, b: m.b, top, hard: hard[0] ?? null }))
    .sort((x, y) => y.top.p - x.top.p)],
  ['GET', '/api/tennis/games', async ({ query: q }) => withPoints(await withChallengers(await between(valid(q.date), valid(q.date)), q.date, q.date))],
  ['GET', '/api/tennis/days', async ({ query: q }) => {
    const from = valid(q.from), n = Math.min(21, Math.max(1, Number(q.n) || 7));
    const list = await withChallengers(await between(from, addDays(from, n - 1)), from, addDays(from, n - 1));
    const out = {};
    for (let i = 0; i < n; i++) out[addDays(from, i)] = { total: 0, live: 0 };
    for (const m of list) { const d = out[madridDay(new Date(m.date).getTime())]; if (d) { d.total++; if (m.state === 'in') d.live++; } }
    return out;
  }],
  ['GET', '/api/tennis/live', async () => { const t = madridDay(Date.now()); return withPoints((await withChallengers(await between(addDays(t, -1), t), addDays(t, -1), t)).filter(m => m.state === 'in')); }],
  ['GET', '/api/tennis/rankings/:tour', ({ params }) => { if (!TOURS[params.tour]) throw fail('Circuito desconocido'); return ranks(params.tour); }],
  // Partidos de un jugador en los torneos en juego (su camino en el torneo y lo último que ha jugado)
  ['GET', '/api/tennis/player/:tour/:id', async ({ params }) => {
    if (!TOURS[params.tour]) throw fail('Circuito desconocido');
    const t = madridDay(Date.now());
    const list = await between(addDays(t, -10), addDays(t, 3));
    return list.filter(m => m.tour === params.tour && (m.a.id === params.id || m.b.id === params.id)).reverse();
  }]
];

// Partidos de ayer a mañana (con los Challenger) y los puntos de los que están en juego, siempre preparados (shared/cached.js)
warmEvery('tennis', 4 * 60e3, async () => {
  const t = madridDay(Date.now());
  const list = await withChallengers(await between(addDays(t, -1), addDays(t, 1)), addDays(t, -1), addDays(t, 1));
  await withPoints(list.filter(m => m.state === 'in'));
});

migrate('tennis', path.join(__dirname, 'migrations'))
  .then(() => query(`DELETE FROM tennis.cache WHERE t < now() - interval '7 days'`))
  .then(() => start({ name: 'tennis', port: Number(process.env.PORT) || 4005, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
