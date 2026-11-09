// API pública de ESPN (sin clave) para las ligas de EE. UU.: partidos, plantillas, bajas, buscador y partidos de
// cada jugador. Adaptado de courtside-edge. La NBA es la que tiene todo; la WNBA usa las mismas rutas.
const { getJSON, remember, fetchJSON, bulk } = require('./cache');
const { assemble, advanced } = require('./points');

const LEAGUES = { nba: 'nba', wnba: 'wnba' };
const site = lg => `https://site.api.espn.com/apis/site/v2/sports/basketball/${LEAGUES[lg]}`;
const WEB = 'https://site.web.api.espn.com/apis/common/v3';

// Temporada de ESPN = año en que termina (2026-27 → 2027)
const seasonYear = (d = new Date()) => (d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear());
const idFromHref = s => (String(s || '').match(/\/(\d+)(?:\.png|\/|$)/) || [])[1] || null;
const headshot = (lg, id) => `https://a.espncdn.com/i/headshots/${lg}/players/full/${id}.png`;

function parseGamelog(json, season) {
  const names = json.names || [];
  const col = n => names.indexOf(n);
  const events = json.events || {};
  const out = [];
  const seen = new Set();
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  for (const st of json.seasonTypes || []) {
    const dn = (st.displayName || '').toLowerCase();
    let type = 'reg';
    if (dn.includes('preseason')) type = 'pre';
    else if (dn.includes('post') || dn.includes('playoff') || dn.includes('play-in')) type = 'post';
    else if (dn.includes('all-star')) continue;
    for (const cat of st.categories || []) {
      if (cat.type && cat.type !== 'event') continue;
      for (const e of cat.events || []) {
        if (!e || !e.eventId || seen.has(e.eventId) || !Array.isArray(e.stats)) continue;
        seen.add(e.eventId);
        const meta = events[e.eventId] || {};
        if (meta.team && meta.team.isAllStar) continue;
        const get = n => (col(n) >= 0 ? e.stats[col(n)] : undefined);
        const min = num(get('minutes'));
        if (!min) continue; // no jugó
        out.push({
          id: e.eventId, date: meta.gameDate || null, season, type,
          home: meta.atVs ? meta.atVs !== '@' : null,
          opp: meta.opponent?.abbreviation || '?', team: meta.team?.abbreviation || null, teamId: meta.team?.id || null,
          result: meta.gameResult || '', score: meta.score || '',
          min, pts: num(get('points')), reb: num(get('totalRebounds')), ast: num(get('assists')),
          stl: num(get('steals')), blk: num(get('blocks')), tov: num(get('turnovers')),
          fg3m: num(String(get('threePointFieldGoalsMade-threePointFieldGoalsAttempted') || '0').split('-')[0])
        });
      }
    }
  }
  return out;
}

// Partidos de unos días de EE. UU. (AAAAMMDD). ESPN no acepta rangos en la NBA: un día por petición
async function games(lg, days) {
  const lists = await Promise.all(days.map(d => getJSON(`${site(lg)}/scoreboard?dates=${d}`, 60e3)));
  return lists.flatMap(j => j.events || []).map(ev => {
    const comp = ev.competitions?.[0] || {};
    const side = ha => {
      const c = (comp.competitors || []).find(x => x.homeAway === ha) || {};
      return {
        id: String(c.team?.id || ''), abbr: c.team?.abbreviation || '', name: c.team?.displayName || '', logo: c.team?.logo || '',
        score: c.score ?? null, record: c.records?.[0]?.summary || '', alt: [c.team?.shortDisplayName].filter(Boolean)
      };
    };
    const st = ev.status?.type?.state;
    return {
      id: `${lg}:${ev.id}`, league: lg, date: ev.date, state: st === 'in' ? 'in' : st === 'post' ? 'post' : 'pre',
      status: ev.status?.type?.shortDetail || '', clock: st === 'in' ? ev.status?.type?.shortDetail || '' : '',
      home: side('home'), away: side('away')
    };
  });
}

async function roster(lg, team) {
  const j = await getJSON(`${site(lg)}/teams/${team}/roster`, 30 * 60e3);
  const list = Array.isArray(j.athletes?.[0]?.items) ? j.athletes.flatMap(g => g.items) : j.athletes || [];
  return list.map(a => ({
    id: String(a.id), name: a.displayName, pos: a.position?.abbreviation || '', jersey: a.jersey || '',
    headshot: a.headshot?.href || headshot(lg, a.id), injury: a.injuries?.[0]?.status || null
  }));
}

async function injuries(lg) {
  const j = await getJSON(`${site(lg)}/injuries`, 10 * 60e3);
  const out = [];
  for (const t of j.injuries || []) {
    for (const inj of t.injuries || []) {
      const a = inj.athlete || {};
      out.push({
        playerId: idFromHref(a.headshot?.href) || idFromHref(a.links?.[0]?.href), name: a.displayName,
        teamId: String(a.team?.id || t.id || ''), team: a.team?.abbreviation || '', status: inj.status || '',
        detail: [inj.details?.type, inj.details?.detail].filter(Boolean).join(' · '), returnDate: inj.details?.returnDate || null
      });
    }
  }
  return out;
}

async function search(lg, q) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const j = await getJSON(`${WEB}/search?query=${encodeURIComponent(term)}&limit=25&type=player`, 10 * 60e3);
  return (j.items || [])
    .filter(i => i.league === lg && i.isActive !== false)
    .map(i => ({ id: String(i.id), league: lg, name: i.displayName, team: i.teamRelationships?.[0]?.displayName || '', pos: i.position?.abbreviation || '', headshot: headshot(lg, i.id) }));
}

// Esta temporada y la anterior (al principio de temporada hay pocos partidos). La anterior ya no cambia.
async function gamelog(lg, id) {
  const y = seasonYear();
  const logs = await Promise.all([[y, 15 * 60e3], [y - 1, 24 * 3600e3]].map(([s, ttl]) =>
    remember(`log:${lg}:${id}:${s}`, ttl, async () => parseGamelog(await bulk(() => fetchJSON(`${WEB}/sports/basketball/${LEAGUES[lg]}/athletes/${id}/gamelog?season=${s}`)), s)).catch(() => [])));
  return { currentSeason: y, games: logs.flat().sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

// Toda la plantilla con sus partidos, para el escáner de líneas. El modelo mira 70 partidos sin contar la pretemporada: con
// ese margen ve los mismos que el analizador y las dos pantallas dan la misma probabilidad.
async function teamLogs(lg, team) {
  const players = await roster(lg, team);
  const logs = await Promise.all(players.map(p => gamelog(lg, p.id)));
  return { currentSeason: seasonYear(), players: players.map((p, i) => ({ ...p, games: logs[i].games.slice(0, 90) })) };
}

module.exports = { LEAGUES, games, roster, injuries, search, gamelog, teamLogs };

// Estadísticas de un partido: jugadores de cada equipo, totales y puntos por cuarto
async function boxscore(lg, eventId) {
  const j = await getJSON(`${site(lg)}/summary?event=${eventId}`, 30e3);
  const comps = j.header?.competitions?.[0]?.competitors || [];
  const toNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const teams = (j.boxscore?.players || []).map(t => {
    const s = t.statistics?.[0] || {};
    const names = s.names || s.labels || [];
    const val = (arr, k) => (arr || [])[names.indexOf(k)];
    const row = arr => ({
      min: toNum(val(arr, 'MIN')), pts: toNum(val(arr, 'PTS')), reb: toNum(val(arr, 'REB')), ast: toNum(val(arr, 'AST')),
      stl: toNum(val(arr, 'STL')), blk: toNum(val(arr, 'BLK')), tov: toNum(val(arr, 'TO')),
      fg: val(arr, 'FG') || '', fg3: val(arr, '3PT') || '', ft: val(arr, 'FT') || '', pm: val(arr, '+/-') || '',
      oreb: toNum(val(arr, 'OREB')), dreb: toNum(val(arr, 'DREB')), pf: toNum(val(arr, 'PF'))
    });
    const c = comps.find(x => x.team?.id === t.team?.id) || {};
    return {
      id: String(t.team?.id || ''), name: t.team?.displayName || '', abbr: t.team?.abbreviation || '', logo: t.team?.logo || '',
      side: c.homeAway === 'home' ? 'home' : 'away', periods: (c.linescores || []).map(l => toNum(l.displayValue ?? l.value)),
      players: (s.athletes || []).filter(a => a.stats?.length).map(a => ({ id: String(a.athlete?.id || ''), name: a.athlete?.displayName || '', starter: !!a.starter, ...row(a.stats) })),
      totals: row(s.totals)
    };
  });
  // Enfrentamientos de esta temporada (H2H)
  const series = (j.seasonseries?.[0]?.events || []).map(e => ({
    date: e.date, status: e.statusType?.shortDetail || '',
    score: (e.competitors || []).map(x => ({ abbr: x.team?.abbreviation || '', score: x.score ?? '', winner: !!x.winner }))
  }));
  return { teams, series };
}

module.exports.boxscore = boxscore;

// El partido de un jugador por cuartos y sus tiros, de las jugadas de ESPN (la misma ficha que el boxscore, ya en caché).
// En cada jugada el primer participante es quien la hace y el segundo quien asiste, roba o tapona ("X blocks Y's layup",
// "X lost ball turnover (Y steals)"). Los tiros traen coordenadas en pies desde el aro (x de 0 a 50 a lo ancho, con el
// aro en 25; y hacia el medio campo); los tiros libres traen basura y no van al mapa
async function playerGame(lg, eventId, playerId) {
  const j = await getJSON(`${site(lg)}/summary?event=${eventId}`, 30e3);
  const plays = j.plays || [];
  if (!plays.length) return { available: false, periods: [], byPeriod: {}, shots: [] };
  const pid = String(playerId);
  const blank = () => ({ pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 });
  const by = {};
  const at = per => (by[per] ??= blank());
  const shots = [];
  const periods = new Set();
  for (const p of plays) {
    const per = p.period?.number || 0;
    if (per) periods.add(per);
    const ids = (p.participants || []).map(x => String(x.athlete?.id || ''));
    const type = p.type?.text || '', text = p.text || '';
    const me = ids[0] === pid, second = ids[1] === pid;
    if (!me && !second) continue;
    if (p.shootingPlay) {
      const ft = /free throw/i.test(type);
      if (me && ft) { const s = at(per); s.fta++; if (p.scoringPlay) { s.ftm++; s.pts += p.scoreValue || 1; } }
      else if (me) {
        const s = at(per), three = p.pointsAttempted === 3;
        s.fga++; if (three) s.tpa++;
        if (p.scoringPlay) { s.fgm++; if (three) s.tpm++; s.pts += p.scoreValue || (three ? 3 : 2); }
        const c = p.coordinate;
        if (c && Math.abs(c.x) <= 60 && Math.abs(c.y) <= 100) {
          shots.push({ period: per, clock: p.clock?.displayValue || '', x: c.x - 25, y: c.y, made: !!p.scoringPlay, value: three ? 3 : 2, text });
        }
      }
      if (second && !ft && p.scoringPlay) at(per).ast++;
      if (second && !p.scoringPlay && /block/i.test(text)) at(per).blk++;
      continue;
    }
    if (me && /offensive rebound/i.test(type)) at(per).oreb++;
    else if (me && /defensive rebound/i.test(type)) at(per).dreb++;
    else if (/turnover/i.test(type)) { if (me) at(per).tov++; if (second && /steal/i.test(text)) at(per).stl++; }
    else if (me && /foul/i.test(type) && !/technical/i.test(type)) at(per).pf++;
  }
  // 0: todo el partido
  const total = blank();
  for (const s of Object.values(by)) for (const k of Object.keys(total)) total[k] += s[k];
  by[0] = total;
  return { available: true, periods: [...periods].sort((a, b) => a - b), byPeriod: by, shots };
}

module.exports.playerGame = playerGame;

// ---------- Clasificación y ficha de equipo ----------
const CONF = { 'Eastern Conference': 'Conferencia Este', 'Western Conference': 'Conferencia Oeste' };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// "L5" → "P5", "W3" → "G3" (ganados y perdidos seguidos)
const streakEs = s => String(s || '').replace(/^W/i, 'G').replace(/^L/i, 'P');

async function standings(lg) {
  const j = await getJSON(`https://site.web.api.espn.com/apis/v2/sports/basketball/${LEAGUES[lg]}/standings`, 15 * 60e3);
  const kids = j.children?.length ? j.children : [j];
  return kids.map(ch => {
    const teams = (ch.standings?.entries || []).map(e => {
      const st = n => (e.stats || []).find(x => x.name === n);
      const dv = n => st(n)?.displayValue ?? '';
      const t = e.team || {};
      return {
        id: String(t.id || ''), abbr: t.abbreviation || '', name: t.displayName || '', logo: t.logos?.[0]?.href || '',
        seed: st('playoffSeed')?.value ?? null, w: num(dv('wins')) ?? 0, l: num(dv('losses')) ?? 0, pct: num(dv('winPercent')) ?? 0,
        home: dv('Home'), road: dv('Road'), last: dv('Last Ten Games'), streak: streakEs(dv('streak')),
        pf: num(dv('avgPointsFor')), pa: num(dv('avgPointsAgainst')), diff: num(dv('differential')), gb: dv('gamesBehind'), form: []
      };
    }).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || b.pct - a.pct).map((t, i) => ({ ...t, pos: i + 1 }));
    return { name: CONF[ch.name] || ch.name || '', teams };
  });
}

const TEAM_STATS = [
  ['avgPoints', 'Puntos', 'Tiro'], ['avgFieldGoalsMade', 'Tiros anotados', 'Tiro'], ['avgFieldGoalsAttempted', 'Tiros intentados', 'Tiro'], ['fieldGoalPct', 'Tiros de campo %', 'Tiro'],
  ['twoPointFieldGoalPct', 'Tiros de 2 %', 'Tiro'], ['avgThreePointFieldGoalsMade', 'Triples anotados', 'Tiro'], ['avgThreePointFieldGoalsAttempted', 'Triples intentados', 'Tiro'], ['threePointPct', 'Triples %', 'Tiro'],
  ['avgFreeThrowsMade', 'Tiros libres anotados', 'Tiro'], ['avgFreeThrowsAttempted', 'Tiros libres intentados', 'Tiro'], ['freeThrowPct', 'Tiros libres %', 'Tiro'],
  ['avgRebounds', 'Rebotes', 'Rebote y balón'], ['avgOffensiveRebounds', 'Rebotes ofensivos', 'Rebote y balón'], ['avgDefensiveRebounds', 'Rebotes defensivos', 'Rebote y balón'],
  ['avgAssists', 'Asistencias', 'Rebote y balón'], ['avgTurnovers', 'Pérdidas', 'Rebote y balón'], ['assistTurnoverRatio', 'Asistencias por pérdida', 'Rebote y balón'],
  ['avgSteals', 'Robos', 'Defensa'], ['avgBlocks', 'Tapones', 'Defensa'], ['avgFouls', 'Faltas', 'Defensa']
];
const LEADERS = [['pointsPerGame', 'Puntos', 'pts'], ['reboundsPerGame', 'Rebotes', 'reb'], ['assistsPerGame', 'Asistencias', 'ast'],
  ['3PointMadePerGame', 'Triples', null], ['stealsPerGame', 'Robos', null], ['blocksPerGame', 'Tapones', null], ['minutesPerGame', 'Minutos', 'min']];

// ESPN da la temporada en curso; fuera de temporada (WNBA en invierno) sirve la anterior
async function leadersOf(lg, team) {
  const y = seasonYear();
  for (const s of [y, y - 1]) {
    const j = await getJSON(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/${LEAGUES[lg]}/seasons/${s}/types/2/teams/${team}/leaders`, 30 * 60e3).catch(() => null);
    if (j?.categories?.length) return j.categories;
  }
  return [];
}

async function team(lg, id) {
  const [info, rosterJ, sched, stats, table, inj, lead] = await Promise.all([
    getJSON(`${site(lg)}/teams/${id}`, 30 * 60e3),
    getJSON(`${site(lg)}/teams/${id}/roster`, 30 * 60e3).catch(() => ({})),
    getJSON(`${site(lg)}/teams/${id}/schedule`, 15 * 60e3).catch(() => ({})),
    // Temporada regular: fuera de ella ESPN daría sólo los pocos partidos del playoff
    getJSON(`${site(lg)}/teams/${id}/statistics?seasontype=2`, 30 * 60e3).catch(() => null),
    standings(lg).catch(() => []),
    injuries(lg).catch(() => []),
    leadersOf(lg, id)
  ]);
  const t = info.team || {};
  const allStats = (stats?.results?.stats?.categories || []).flatMap(c => c.stats || []);
  const raw = k => { const v = Number(allStats.find(x => x.name === k)?.value); return Number.isFinite(v) ? v : NaN; };
  const group = table.find(g => g.teams.some(x => x.id === String(id)));
  const row = group?.teams.find(x => x.id === String(id));
  const list = Array.isArray(rosterJ.athletes?.[0]?.items) ? rosterJ.athletes.flatMap(g => g.items) : rosterJ.athletes || [];
  const idOf = l => String(l.athlete?.$ref || '').match(/athletes\/(\d+)/)?.[1] || '';
  // Los líderes traen a casi toda la plantilla: de ahí salen los promedios de cada jugador
  const avg = {};
  for (const [cat, , key] of LEADERS) {
    if (!key) continue;
    for (const l of lead.find(c => c.name === cat)?.leaders || []) (avg[idOf(l)] ||= {})[key] = l.value;
  }
  const roster = list.map(a => {
    const out = inj.find(i => i.playerId === String(a.id));
    return {
      id: String(a.id), name: a.displayName, pos: a.position?.abbreviation || '', jersey: a.jersey || '', headshot: a.headshot?.href || headshot(lg, a.id),
      age: a.age ?? null, height: a.height ? `${(a.height * 0.0254).toFixed(2)} m` : '', weight: a.weight ? `${Math.round(a.weight * 0.4536)} kg` : '',
      from: a.college?.name || a.birthPlace?.country || '', years: a.experience?.years ?? null, salary: a.contract?.salary || null,
      injury: out?.status || a.injuries?.[0]?.status || null, injuryDetail: out?.detail || '', injuryReturn: out?.returnDate || null, avg: avg[String(a.id)] || null
    };
  });
  const names = Object.fromEntries(roster.map(p => [p.id, p.name]));
  const side = (c, me) => ({ me, abbr: c?.team?.abbreviation || '', name: c?.team?.displayName || '', logo: c?.team?.logos?.[0]?.href || c?.team?.logo || '', score: c?.score?.displayValue ?? c?.score ?? null, winner: !!c?.winner });
  const games = (sched.events || []).map(e => {
    const c = e.competitions?.[0] || {};
    const me = (c.competitors || []).find(x => String(x.team?.id) === String(id)), opp = (c.competitors || []).find(x => x !== me);
    return { id: `${lg}:${e.id}`, date: e.date, state: c.status?.type?.state || 'pre', home: me?.homeAway === 'home', us: side(me, true), them: side(opp, false) };
  });
  const venue = t.franchise?.venue || {};
  return {
    id: String(id), league: lg, name: t.displayName || '', abbr: t.abbreviation || '', logo: t.logos?.[0]?.href || '', color: t.color ? `#${t.color}` : '',
    coach: (rosterJ.coach || []).map(c => `${c.firstName} ${c.lastName}`)[0] || '', venue: venue.fullName || '', capacity: venue.capacity || null,
    city: [venue.address?.city, venue.address?.state].filter(Boolean).join(', '), country: '', president: '', website: '',
    division: / Division$/i.test(t.standingSummary || '') ? String(t.standingSummary).replace(/^(\d+)(?:st|nd|rd|th) in (.+?) Division$/i, '$1.º de la división $2') : '',
    group: group?.name || '', standing: row || null,
    stats: [
      ...TEAM_STATS.flatMap(([k, label, grp]) => { const x = allStats.find(v => v.name === k); return x ? [{ label, value: x.displayValue, group: grp }] : []; }),
      ...advanced({ pts: raw('avgPoints'), pa: row?.pa ?? NaN, fgm: raw('avgFieldGoalsMade'), fga: raw('avgFieldGoalsAttempted'), fg3m: raw('avgThreePointFieldGoalsMade'), fg3a: raw('avgThreePointFieldGoalsAttempted'), fta: raw('avgFreeThrowsAttempted'), orb: raw('avgOffensiveRebounds'), tov: raw('avgTurnovers') })
    ],
    leaders: LEADERS.flatMap(([cat, label]) => {
      const ls = (lead.find(c => c.name === cat)?.leaders || []).filter(l => names[idOf(l)]).slice(0, 3);
      return ls.length ? [{ label, players: ls.map(l => ({ id: idOf(l), name: names[idOf(l)], value: l.displayValue })) }] : [];
    }),
    results: games.filter(g => g.state === 'post').sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10),
    upcoming: games.filter(g => g.state !== 'post').sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5),
    roster
  };
}

// ESPN da los colores de todos los equipos de una vez
async function colors(lg) {
  const j = await getJSON(`${site(lg)}/teams`, 7 * 24 * 3600e3);
  const hash = v => (/^[0-9a-f]{6}$/i.test(v || '') ? `#${v}` : null);
  return Object.fromEntries((j.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team).filter(t => hash(t?.color)).map(t => [String(t.id), { color: hash(t.color), alt: hash(t.alternateColor) }]));
}

module.exports.standings = standings;
module.exports.team = team;
module.exports.colors = colors;

// ---------- Partidos de toda la liga con sus parciales ----------
// ESPN no acepta rangos de fechas: un marcador por día. Cada uno trae todos los partidos de esa jornada, así que sale mucho más
// barato que pedir partido a partido, y los días ya jugados no cambian: se piden una vez y se guarda sólo el resumen.
// Un día cualquiera de la temporada sirve para pedir su calendario entero (sólo los días con partidos)
const CALENDAR_DAY = { nba: '0115', wnba: '0715' };
const dayKey = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

const calendar = (lg, year) => remember(`cal:${lg}:${year}`, 24 * 3600e3, async () => {
  const j = await bulk(() => fetchJSON(`${site(lg)}/scoreboard?dates=${year}${CALENDAR_DAY[lg]}`));
  return (j.leagues?.[0]?.calendar || []).map(d => String(d).slice(0, 10).replace(/-/g, ''));
});

function dayGames(j) {
  const side = c => ({
    id: String(c.team?.id || ''), abbr: c.team?.abbreviation || '', name: c.team?.displayName || '', logo: c.team?.logo || '',
    pts: Number(c.score) || 0, q: (c.linescores || []).map(l => Number(l.value) || 0)
  });
  return (j.events || []).flatMap(ev => {
    const comp = ev.competitions?.[0];
    const list = comp?.competitors || [];
    const home = list.find(c => c.homeAway === 'home'), away = list.find(c => c.homeAway === 'away');
    const type = ev.season?.type;
    // Fuera la pretemporada (1) y el All-Star: no dicen nada de cómo anota un equipo
    if (!home || !away || type === 1 || !ev.status?.type?.completed || comp.type?.abbreviation === 'ALLSTAR') return [];
    return [{ id: `${ev.id}`, date: ev.date, season: ev.season?.year, type: type === 2 ? 'reg' : 'post', home: side(home), away: side(away) }];
  });
}

// Los dos últimos días pueden tener partidos a medias o corregirse; a partir de ahí ya no cambian
function day(lg, d) {
  const load = async () => dayGames(await bulk(() => fetchJSON(`${site(lg)}/scoreboard?dates=${d}`)));
  return d < dayKey(Date.now() - 2 * 864e5) ? remember(`keep:day:${lg}:${d}`, 0, load, { keep: true }) : remember(`day:${lg}:${d}`, 5 * 60e3, load);
}

async function leagueGames(lg) {
  const y = seasonYear(), today = dayKey(Date.now());
  const days = (await Promise.all([y, y - 1].map(s => calendar(lg, s).catch(() => [])))).flat();
  const lists = await Promise.all([...new Set(days)].filter(d => d <= today).map(d => day(lg, d).catch(() => [])));
  return assemble(lists.flat(), y);
}

module.exports.leagueGames = leagueGames;
