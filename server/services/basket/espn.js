// API pública de ESPN (sin clave) para la NBA, la WNBA y la NBL australiana: partidos, plantillas, bajas, buscador y partidos
// de cada jugador. Adaptado de courtside-edge. La NBA es la que tiene todo; la WNBA y la NBL usan las mismas rutas, salvo
// el registro de cada jugador y la clasificación de la NBL, que ESPN da vacíos y aquí se montan con los partidos.
const { getJSON, remember, fetchJSON, bulk } = require('./cache');
const { assemble, advanced } = require('./points');

const LEAGUES = { nba: 'nba', wnba: 'wnba', nbl: 'nbl' };
// Ligas cuyo registro de jugador se monta con los boxscores de su equipo (ESPN lo da vacío)
const BOX_LOGS = new Set(['nbl']);
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
  const list = (Array.isArray(j.athletes?.[0]?.items) ? j.athletes.flatMap(g => g.items) : j.athletes || []).map(a => ({
    id: String(a.id), name: a.displayName, pos: a.position?.abbreviation || '', jersey: a.jersey || '',
    headshot: a.headshot?.href || headshot(lg, a.id), injury: a.injuries?.[0]?.status || null
  }));
  if (!BOX_LOGS.has(lg)) return list;
  const fix = await squadFix(lg, team, list);
  return [...fix.keep, ...fix.extra.map(p => ({ ...p, pos: '', jersey: '', headshot: headshot(lg, p.id), injury: null }))];
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
// team: el equipo del jugador, que hace falta en la NBL (su registro sale de los partidos de su equipo)
async function gamelog(lg, id, team) {
  const y = seasonYear();
  if (BOX_LOGS.has(lg)) {
    const t = team || await teamOfPlayer(lg, id);
    return { currentSeason: y, games: t ? (await boxLogs(lg, t)).get(String(id)) || [] : [] };
  }
  const logs = await Promise.all([[y, 15 * 60e3], [y - 1, 24 * 3600e3]].map(([s, ttl]) =>
    remember(`log:${lg}:${id}:${s}`, ttl, async () => parseGamelog(await bulk(() => fetchJSON(`${WEB}/sports/basketball/${LEAGUES[lg]}/athletes/${id}/gamelog?season=${s}`)), s)).catch(() => [])));
  return { currentSeason: y, games: logs.flat().sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

// Toda la plantilla con sus partidos, para el escáner de líneas. El modelo mira 70 partidos sin contar la pretemporada: con
// ese margen ve los mismos que el analizador y las dos pantallas dan la misma probabilidad.
async function teamLogs(lg, team) {
  const players = await roster(lg, team);
  if (BOX_LOGS.has(lg)) {
    const byPlayer = await boxLogs(lg, team);
    return { currentSeason: seasonYear(), players: players.map(p => ({ ...p, games: (byPlayer.get(p.id) || []).slice(0, 90) })) };
  }
  const logs = await Promise.all(players.map(p => gamelog(lg, p.id)));
  return { currentSeason: seasonYear(), players: players.map((p, i) => ({ ...p, games: logs[i].games.slice(0, 90) })) };
}

// ---------- Registros montados con los boxscores (NBL) ----------
// Los jugadores de los dos equipos de un partido terminado, ya con las columnas del registro. No cambia: se guarda para siempre,
// y un mismo partido sirve para los dos equipos
const boxRows = (lg, ev) => remember(`keep:box2:${lg}:${ev}`, 0, async () => {
  const j = await bulk(() => fetchJSON(`${site(lg)}/summary?event=${ev}`));
  const head = j.header?.competitions?.[0] || {};
  const comps = head.competitors || [];
  const toNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const st = j.header?.season?.type;
  return {
    date: head.date || null, season: j.header?.season?.year ?? null, type: st === 3 ? 'post' : st === 1 ? 'pre' : 'reg',
    teams: (j.boxscore?.players || []).map(t => {
      const s = t.statistics?.[0] || {};
      const names = s.names || s.labels || [];
      const val = (arr, k) => (arr || [])[names.indexOf(k)];
      const me = comps.find(c => String(c.team?.id) === String(t.team?.id)) || {}, opp = comps.find(c => c !== me) || {};
      return {
        teamId: String(t.team?.id || ''), team: t.team?.abbreviation || '', home: me.homeAway === 'home', opp: opp.team?.abbreviation || '?',
        result: me.winner ? 'W' : opp.winner ? 'L' : '', score: `${toNum(me.score)}-${toNum(opp.score)}`,
        players: (s.athletes || []).filter(a => a.stats?.length && !a.didNotPlay).map(a => ({
          id: String(a.athlete?.id || ''), name: a.athlete?.displayName || '', min: toNum(val(a.stats, 'MIN')), pts: toNum(val(a.stats, 'PTS')), reb: toNum(val(a.stats, 'REB')),
          ast: toNum(val(a.stats, 'AST')), stl: toNum(val(a.stats, 'STL')), blk: toNum(val(a.stats, 'BLK')), tov: toNum(val(a.stats, 'TO')),
          fg3m: toNum(String(val(a.stats, '3PT') || '0').split('-')[0])
        }))
      };
    })
  };
}, { keep: true });

// Partidos de cada jugador de un equipo, esta temporada y la anterior con el playoff, del más reciente al más antiguo.
// Sólo los que jugó con este equipo: los de un fichado en su equipo anterior no salen. ESPN sólo tiene jugadores en los
// boxscores de la NBL desde febrero de 2026: de la temporada 25-26 salen el final y el playoff
// Boxscores de los partidos terminados del equipo, del más reciente al más antiguo
async function teamBoxes(lg, teamId) {
  const y = seasonYear();
  const lists = await Promise.all([[y, ''], [y, '&seasontype=3'], [y - 1, ''], [y - 1, '&seasontype=3']].map(([s, t]) =>
    getJSON(`${site(lg)}/teams/${teamId}/schedule?season=${s}${t}`, s === y ? 30 * 60e3 : 24 * 3600e3).catch(() => ({ events: [] }))));
  const seen = new Set();
  const done = lists.flatMap(j => j.events || []).filter(e => e.competitions?.[0]?.status?.type?.completed && !seen.has(e.id) && seen.add(e.id));
  const boxes = await Promise.all(done.map(e => boxRows(lg, e.id).then(b => ({ id: String(e.id), ...b })).catch(() => null)));
  return boxes.filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function boxLogs(lg, teamId) {
  const boxes = await teamBoxes(lg, teamId);
  const out = new Map();
  for (const b of boxes) {
    const t = b?.teams.find(x => x.teamId === String(teamId));
    if (!t) continue;
    for (const p of t.players) {
      if (!p.min) continue; // no jugó
      if (!out.has(p.id)) out.set(p.id, []);
      out.get(p.id).push({
        id: b.id, date: b.date, season: b.season, type: b.type, home: t.home, opp: t.opp, team: t.team, teamId: t.teamId,
        result: t.result, score: t.score, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov, fg3m: p.fg3m
      });
    }
  }
  for (const list of out.values()) list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return out;
}

// La plantilla de ESPN de la NBL no es de fiar: le faltan fichajes que ya juegan (Rakocevic en Adelaide, Ingles en Melbourne),
// mantiene a los que se fueron (Galloway sale en Sydney y juega en Cairns), repite a alguno con dos fichas y lleva decenas de
// nombres que nunca han jugado (50 en Melbourne). Lo fiable son los boxscores: la plantilla es quien ha jugado con el equipo
// esta temporada (sin la pretemporada), con el dorsal y la posición de ESPN si los tiene. keep: los de ESPN que están en ella;
// extra: los que faltan. Antes del primer partido de la temporada se queda la de ESPN, sin repetidos
async function squadFix(lg, team, list) {
  const boxes = await teamBoxes(lg, team).catch(() => []);
  const y = seasonYear();
  const names = new Map();
  for (const b of boxes) {
    if (b.season !== y || b.type === 'pre') continue;
    for (const p of b.teams.find(x => x.teamId === String(team))?.players || []) if (p.min && !names.has(p.id)) names.set(p.id, p.name);
  }
  if (names.size) {
    const keep = list.filter((p, i) => names.has(p.id) && list.findIndex(x => x.id === p.id) === i);
    const have = new Set(keep.map(p => p.id));
    return { keep, extra: [...names].filter(([id]) => !have.has(id)).map(([id, name]) => ({ id, name })) };
  }
  // Sin partidos aún: de dos con el mismo nombre, el que tiene dorsal
  const key = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
  const best = new Map();
  for (const p of list) { const k = key(p.name), prev = best.get(k); if (!prev || (!prev.jersey && p.jersey)) best.set(k, p); }
  return { keep: list.filter(p => best.get(key(p.name)) === p), extra: [] };
}

// El equipo de un jugador, si la pantalla no lo dice (p. ej. desde el buscador)
const teamOfPlayer = (lg, id) => remember(`team-of:${lg}:${id}`, 24 * 3600e3, async () => {
  const j = await fetchJSON(`${WEB}/sports/basketball/${LEAGUES[lg]}/athletes/${id}`);
  return j.athlete?.team?.id ? String(j.athlete.team.id) : null;
}).catch(() => null);

// Medias de cada jugador y líderes del equipo con los registros montados (la NBL no tiene líderes en ESPN). Liga regular de
// esta temporada o, si aún no hay partidos, de la anterior
const BOX_LEADERS = [['Puntos', 'pts'], ['Rebotes', 'reb'], ['Asistencias', 'ast'], ['Triples', 'fg3m'], ['Robos', 'stl'], ['Tapones', 'blk'], ['Minutos', 'min']];
function boxLeaders(roster, logs) {
  const y = seasonYear();
  const season = roster.some(p => (logs.get(p.id) || []).some(g => g.type === 'reg' && g.season === y)) ? y : y - 1;
  const avg = {};
  for (const p of roster) {
    const gs = (logs.get(p.id) || []).filter(g => g.type === 'reg' && g.season === season);
    if (!gs.length) continue;
    avg[p.id] = Object.fromEntries(BOX_LEADERS.map(([, k]) => [k, Math.round(gs.reduce((t, g) => t + g[k], 0) / gs.length * 10) / 10]));
  }
  const leaders = BOX_LEADERS.flatMap(([label, k]) => {
    const top = roster.filter(p => avg[p.id]).sort((a, b) => avg[b.id][k] - avg[a.id][k]).slice(0, 3).filter(p => avg[p.id][k] > 0);
    return top.length ? [{ label, players: top.map(p => ({ id: p.id, name: p.name, value: String(avg[p.id][k]).replace('.', ',') })) }] : [];
  });
  return { avg, leaders };
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
      // Los de la plantilla que no jugaron, con el motivo (decisión técnica, lesión…)
      out: (s.athletes || []).filter(a => !a.stats?.length || a.didNotPlay).map(a => ({ id: String(a.athlete?.id || ''), name: a.athlete?.displayName || '', reason: reasonEs(a.reason) })),
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

// ---------- Partidos que no jugó ----------
// El registro de ESPN se salta los partidos en que el jugador no salió: sin esto, "no jugó" y "jugó e hizo 0" no se
// distinguen. Se miran los últimos partidos terminados de su equipo que no están en su registro, y en el boxscore de cada
// uno sale si estaba en la plantilla sin jugar (y por qué). Si no sale en el boxscore no estaba en el equipo (fichado
// después, cedido…) y no cuenta. Las bajas de un partido terminado no cambian: se guardan para siempre, sólo la lista
const REASON = [
  [/coach/i, 'Decisión técnica'], [/not with team/i, 'No está con el equipo'], [/g league|two-way/i, 'En la G League'],
  [/suspen/i, 'Sanción'], [/rest/i, 'Descanso'], [/personal/i, 'Motivos personales'], [/illness/i, 'Enfermedad']
];
const reasonEs = r => {
  const s = String(r || '').trim();
  if (!s) return 'No jugó';
  const hit = REASON.find(([re]) => re.test(s));
  return hit ? hit[1] : `Lesión: ${s.charAt(0) + s.slice(1).toLowerCase()}`;
};

const dnpOf = (lg, ev) => remember(`keep:dnp:${lg}:${ev}`, 0, async () => {
  const j = await bulk(() => fetchJSON(`${site(lg)}/summary?event=${ev}`));
  const out = {};
  for (const t of j.boxscore?.players || []) for (const a of t.statistics?.[0]?.athletes || []) {
    if (a.didNotPlay || !a.stats?.length) out[String(a.athlete?.id || '')] = reasonEs(a.reason);
  }
  return out;
}, { keep: true });

async function absences(lg, playerId, teamId, last = 25) {
  if (!teamId) return [];
  const y = seasonYear();
  const [sched, log] = await Promise.all([
    getJSON(`${site(lg)}/teams/${teamId}/schedule?season=${y}`, 30 * 60e3),
    gamelog(lg, playerId, teamId)
  ]);
  const played = new Set(log.games.map(g => String(g.id)));
  const done = (sched.events || []).filter(e => e.competitions?.[0]?.status?.type?.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, last);
  const missing = done.filter(e => !played.has(String(e.id)));
  const rows = await Promise.all(missing.map(async e => {
    const why = (await dnpOf(lg, e.id).catch(() => ({})))[String(playerId)];
    if (!why) return null; // no estaba en el equipo
    const cs = e.competitions[0].competitors || [];
    const me = cs.find(c => String(c.team?.id) === String(teamId)) || {}, rival = cs.find(c => c !== me) || {};
    return { id: String(e.id), date: e.date, home: me.homeAway === 'home', opp: rival.team?.abbreviation || '?', reason: why };
  }));
  return rows.filter(Boolean);
}

module.exports.absences = absences;

// ---------- Descanso de los equipos ----------
// Días entre partidos en hora de Nueva York (las fechas de la NBA son las de allí: un partido a las 01:30 UTC es de la
// noche anterior). B2B = jugó el día antes; "3 en 4" = tercer partido en cuatro noches. El cansancio se nota más
// en el segundo de un B2B jugado fuera, por el viaje
const nyDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayNum = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

async function teamSchedule(lg, teamId) {
  const y = seasonYear();
  const lists = await Promise.all(['', '&seasontype=3'].map(s =>
    getJSON(`${site(lg)}/teams/${teamId}/schedule?season=${y}${s}`, 30 * 60e3).catch(() => ({ events: [] }))));
  const seen = new Set();
  return lists.flatMap(j => j.events || []).filter(e => !seen.has(e.id) && seen.add(e.id)).map(e => {
    const cs = e.competitions?.[0]?.competitors || [];
    const me = cs.find(c => String(c.team?.id) === String(teamId)) || {}, rival = cs.find(c => c !== me) || {};
    return { id: String(e.id), date: e.date, day: nyDay(e.date), home: me.homeAway === 'home', opp: rival.team?.abbreviation || '?' };
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function rest(lg, teamId, eventId) {
  const games = await teamSchedule(lg, teamId);
  const i = games.findIndex(g => g.id === String(eventId));
  if (i < 0) return null;
  const g = games[i], prev = games[i - 1] || null, next = games[i + 1] || null, d = dayNum(g.day);
  const days = prev ? d - dayNum(prev.day) - 1 : null; // noches libres entre medias
  return {
    teamId: String(teamId), days, b2b: days === 0,
    in4: games.filter(x => d - dayNum(x.day) >= 0 && d - dayNum(x.day) <= 3).length, // partidos en las 4 últimas noches, éste incluido
    prev: prev && { date: prev.date, opp: prev.opp, home: prev.home },
    nextB2b: !!next && dayNum(next.day) - d === 1 // mañana vuelve a jugar: a veces se dosifican minutos
  };
}

module.exports.rest = rest;
module.exports.teamSchedule = teamSchedule;

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

// Cómo fue el partido: el marcador tras cada canasta (de las jugadas de ESPN), en minutos jugados, más los cambios de líder,
// los empates, la mayor ventaja de cada uno y su mayor parcial (puntos seguidos sin que anote el otro).
// a = visitante, b = local, como en la app. Los cuartos duran 12 minutos en la NBA y 10 en la WNBA y la NBL; las prórrogas, 5
async function flow(lg, eventId) {
  const j = await getJSON(`${site(lg)}/summary?event=${eventId}`, 30e3);
  const plays = j.plays || [];
  if (!plays.length) return { available: false };
  const len = lg === 'nba' ? 12 : 10;
  const startOf = per => (per <= 4 ? (per - 1) * len : 4 * len + (per - 5) * 5);
  const lenOf = per => (per <= 4 ? len : 5);
  // "11:24" o "45.3" (segundos del último minuto)
  const left = s => { const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s || ''); return m ? Number(m[1]) + Number(m[2]) / 60 : (Number(s) || 0) / 60; };
  const points = [{ t: 0, a: 0, b: 0, per: 1 }];
  let last = { a: 0, b: 0 }, maxPer = 1;
  for (const p of plays) {
    const per = p.period?.number || 1;
    maxPer = Math.max(maxPer, per);
    const a = Number(p.awayScore), b = Number(p.homeScore);
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a === last.a && b === last.b)) continue;
    const t = Math.round((startOf(per) + lenOf(per) - left(p.clock?.displayValue)) * 100) / 100;
    points.push({ t, a, b, per });
    last = { a, b };
  }
  // Cambios de líder, empates, mayor ventaja y mayor parcial de cada uno
  let leadChanges = 0, ties = 0, leader = null;
  const maxLead = { a: 0, b: 0 };
  const best = { a: { pts: 0, per: 1 }, b: { pts: 0, per: 1 } };
  let run = { side: null, pts: 0, per: 1 };
  for (let i = 1; i < points.length; i++) {
    const x = points[i], prev = points[i - 1];
    const d = x.a - x.b;
    if (d > 0) maxLead.a = Math.max(maxLead.a, d); else if (d < 0) maxLead.b = Math.max(maxLead.b, -d);
    const now = d > 0 ? 'a' : d < 0 ? 'b' : null;
    if (now === null && prev.a !== prev.b) ties++;
    if (now && leader && now !== leader) leadChanges++;
    if (now) leader = now;
    const scorer = x.a > prev.a ? 'a' : 'b', got = scorer === 'a' ? x.a - prev.a : x.b - prev.b;
    run = run.side === scorer ? { ...run, pts: run.pts + got } : { side: scorer, pts: got, per: x.per };
    if (run.pts > best[scorer].pts) best[scorer] = { pts: run.pts, per: run.per };
  }
  return { available: true, periodLen: len, periods: maxPer, points, leadChanges, ties, maxLead, runs: best };
}

module.exports.flow = flow;

// ---------- Clasificación y ficha de equipo ----------
const CONF = { 'Eastern Conference': 'Conferencia Este', 'Western Conference': 'Conferencia Oeste' };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// "L5" → "P5", "W3" → "G3" (ganados y perdidos seguidos)
const streakEs = s => String(s || '').replace(/^W/i, 'G').replace(/^L/i, 'P');

async function standings(lg) {
  const j = await getJSON(`https://site.web.api.espn.com/apis/v2/sports/basketball/${LEAGUES[lg]}/standings`, 15 * 60e3);
  const kids = j.children?.length ? j.children : [j];
  // Si ESPN no la da, se calcula con los resultados de la temporada
  if (!kids.some(ch => ch.standings?.entries?.length)) return tableFromGames(lg);
  const groups = kids.map(ch => {
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
  // La NBL viene sin casa, fuera ni últimos 10: se rellenan con los resultados
  if (groups.some(g => g.teams.some(t => !t.home))) {
    const calc = Object.fromEntries((await tableFromGames(lg).catch(() => [])).flatMap(g => g.teams).map(t => [t.id, t]));
    for (const t of groups.flatMap(g => g.teams)) {
      const c = calc[t.id];
      if (c) { t.home ||= c.home; t.road ||= c.road; t.last ||= c.last; }
    }
  }
  return groups;
}

// Clasificación con los partidos de liga regular de esta temporada (los mismos días que la proyección de puntos): victorias,
// porcentaje, en casa y fuera, últimos 10, racha, puntos a favor y en contra por partido y partidos por detrás del primero
async function tableFromGames(lg) {
  const y = seasonYear(), today = dayKey(Date.now());
  const days = (await calendar(lg, y).catch(() => [])).filter(d => d <= today);
  const games = (await Promise.all(days.map(d => day(lg, d).catch(() => [])))).flat()
    .filter(g => g.season === y && g.type === 'reg').sort((a, b) => new Date(a.date) - new Date(b.date));
  const rows = new Map();
  for (const g of games) {
    for (const [me, them, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
      if (!rows.has(me.id)) rows.set(me.id, { id: me.id, abbr: me.abbr, name: me.name, logo: me.logo, w: 0, l: 0, pf: 0, pa: 0, hw: 0, hl: 0, rw: 0, rl: 0, seq: [] });
      const r = rows.get(me.id), win = me.pts > them.pts;
      r[win ? 'w' : 'l']++; r.pf += me.pts; r.pa += them.pts; r.seq.push(win);
      if (home) r[win ? 'hw' : 'hl']++; else r[win ? 'rw' : 'rl']++;
    }
  }
  const list = [...rows.values()].map(r => {
    const n = r.w + r.l, last = r.seq.slice(-10), tail = r.seq[r.seq.length - 1];
    let streak = 0; for (let i = r.seq.length - 1; i >= 0 && r.seq[i] === tail; i--) streak++;
    return {
      id: r.id, abbr: r.abbr, name: r.name, logo: r.logo, seed: null, w: r.w, l: r.l, pct: n ? r.w / n : 0,
      home: `${r.hw}-${r.hl}`, road: `${r.rw}-${r.rl}`, last: `${last.filter(Boolean).length}-${last.filter(x => !x).length}`,
      streak: n ? `${tail ? 'G' : 'P'}${streak}` : '', pf: n ? Math.round(r.pf / n * 10) / 10 : null, pa: n ? Math.round(r.pa / n * 10) / 10 : null,
      diff: n ? Math.round((r.pf - r.pa) / n * 10) / 10 : null, gb: '', form: []
    };
  }).sort((a, b) => b.pct - a.pct || (b.diff ?? 0) - (a.diff ?? 0));
  const lead = list[0];
  return [{ name: '', teams: list.map((t, i) => {
    const gb = lead ? ((lead.w - t.w) + (t.l - lead.l)) / 2 : 0;
    return { ...t, gb: i === 0 || gb <= 0 ? '-' : String(gb).replace('.', ','), pos: i + 1 };
  }) }];
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
  const [info, rosterJ, sched, stats, table, inj, lead, logs] = await Promise.all([
    getJSON(`${site(lg)}/teams/${id}`, 30 * 60e3),
    getJSON(`${site(lg)}/teams/${id}/roster`, 30 * 60e3).catch(() => ({})),
    getJSON(`${site(lg)}/teams/${id}/schedule`, 15 * 60e3).catch(() => ({})),
    // Temporada regular: fuera de ella ESPN daría sólo los pocos partidos del playoff
    getJSON(`${site(lg)}/teams/${id}/statistics?seasontype=2`, 30 * 60e3).catch(() => null),
    standings(lg).catch(() => []),
    injuries(lg).catch(() => []),
    leadersOf(lg, id),
    BOX_LOGS.has(lg) ? boxLogs(lg, id).catch(() => null) : null
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
  let roster = list.map(a => {
    const out = inj.find(i => i.playerId === String(a.id));
    return {
      id: String(a.id), name: a.displayName, pos: a.position?.abbreviation || '', jersey: a.jersey || '', headshot: a.headshot?.href || headshot(lg, a.id),
      age: a.age ?? null, height: a.height ? `${(a.height * 0.0254).toFixed(2)} m` : '', weight: a.weight ? `${Math.round(a.weight * 0.4536)} kg` : '',
      from: a.college?.name || a.birthPlace?.country || '', years: a.experience?.years ?? null, salary: a.contract?.salary || null,
      injury: out?.status || a.injuries?.[0]?.status || null, injuryDetail: out?.detail || '', injuryReturn: out?.returnDate || null, avg: avg[String(a.id)] || null
    };
  });
  if (BOX_LOGS.has(lg)) {
    const fix = await squadFix(lg, id, roster);
    roster = [...fix.keep, ...fix.extra.map(p => ({
      ...p, pos: '', jersey: '', headshot: headshot(lg, p.id), age: null, height: '', weight: '', from: '', years: null, salary: null,
      injury: null, injuryDetail: '', injuryReturn: null, avg: null
    }))];
  }
  const fromBox = logs && !lead.length ? boxLeaders(roster, logs) : null;
  if (fromBox) for (const p of roster) p.avg = fromBox.avg[p.id] || null;
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
    leaders: fromBox ? fromBox.leaders : LEADERS.flatMap(([cat, label]) => {
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
const CALENDAR_DAY = { nba: '0115', wnba: '0715', nbl: '0115' };
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
