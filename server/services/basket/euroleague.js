// API pública de la Euroliga (api-live.euroleague.net, la que usa su web): Euroliga (E) y EuroCup (U).
// Calendario y resultados de la temporada, plantillas y box score de cada partido. La serie de partidos de un
// jugador se monta con los box scores de su equipo (los terminados se guardan y no se vuelven a pedir).
const { getJSON } = require('./cache');

const API = 'https://api-live.euroleague.net';
const COMPS = { euroleague: 'E', eurocup: 'U' };
// La temporada empieza en julio: 2026-27 es E2026
const seasonStart = (d = new Date()) => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
const code = (lg, year) => `${COMPS[lg]}${year}`;
const LIVE_MS = 3 * 3600e3; // un partido sin terminar empezado hace menos de 3 h está en juego

async function season(lg, year = seasonStart()) {
  const s = code(lg, year);
  const j = await getJSON(`${API}/v2/competitions/${COMPS[lg]}/seasons/${s}/games`, 2 * 60e3);
  return j.data || [];
}

const sideOf = (t, showScore) => ({
  id: t.club?.code || '', abbr: t.club?.tvCode || t.club?.code || '', name: (t.club?.editorialName || t.club?.abbreviatedName || t.club?.name || '').trim(),
  // Nombres completos y cortos: las casas usan "Real Madrid" o "FC Barcelona", no "Real" ni "Barca"
  alt: [...new Set([t.club?.name, t.club?.abbreviatedName].filter(Boolean).map(s => s.trim()))],
  logo: t.club?.images?.crest || '', score: showScore ? String(t.score ?? 0) : null, record: ''
});

// "Round 6" → "Jornada 6"; las eliminatorias se dejan como vienen
const roundEs = s => String(s || '').replace(/^Round (\d+)$/i, 'Jornada $1');

function toGame(lg, g) {
  const t = new Date(g.utcDate).getTime();
  const live = !g.played && t <= Date.now() && Date.now() - t < LIVE_MS;
  const state = g.played ? 'post' : live ? 'in' : 'pre';
  return {
    id: `${lg}:${g.season?.code || ''}_${g.gameCode}`, league: lg, date: g.utcDate, state,
    status: g.played ? 'Final' : live ? 'En juego' : roundEs(g.roundAlias) || `Jornada ${g.round}`, clock: '',
    round: roundEs(g.roundName), home: sideOf(g.local, state !== 'pre'), away: sideOf(g.road, state !== 'pre')
  };
}

// Partidos entre dos instantes
async function games(lg, from, to) {
  return (await season(lg)).filter(g => { const t = new Date(g.utcDate).getTime(); return t >= from && t < to; }).map(g => toGame(lg, g));
}

async function roster(lg, team) {
  const j = await getJSON(`${API}/v2/competitions/${COMPS[lg]}/seasons/${code(lg, seasonStart())}/clubs/${encodeURIComponent(team)}/people`, 30 * 60e3);
  return (Array.isArray(j) ? j : j.data || [])
    .filter(p => p.typeName === 'Player' && p.active !== false)
    .map(p => ({
      id: p.person.code, name: niceName(p.person.name), pos: p.positionName || '', jersey: p.dorsal || '',
      headshot: p.images?.headshot || '', injury: null
    }));
}

// "SIFTAR, JAKOB" → "Jakob Siftar"
function niceName(s) {
  const [last, first] = String(s || '').split(',').map(x => x.trim());
  const cap = x => x.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, c => c.toUpperCase());
  return first ? `${cap(first)} ${cap(last)}` : cap(last);
}

// Buscador: por nombre en las plantillas de todos los equipos de la competición
async function search(lg, q) {
  const term = norm(q);
  if (term.length < 2) return [];
  const clubs = [...new Set((await season(lg)).flatMap(g => [g.local?.club?.code, g.road?.club?.code]).filter(Boolean))];
  const out = [];
  await pool(clubs, 6, async c => {
    const club = (await season(lg)).map(g => [g.local, g.road]).flat().find(t => t?.club?.code === c)?.club;
    for (const p of await roster(lg, c).catch(() => [])) {
      if (norm(p.name).includes(term)) out.push({ id: p.id, league: lg, team: club?.editorialName || c, teamId: c, name: p.name, pos: p.pos, headshot: p.headshot });
    }
  });
  return out.slice(0, 25);
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Hasta n tareas a la vez (para no lanzar 40 peticiones de golpe a la API)
async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// Partidos del jugador con su equipo: esta temporada y la anterior
async function gamelog(lg, player, team) {
  const y = seasonStart();
  const out = [];
  for (const year of [y, y - 1]) {
    const list = (await season(lg, year).catch(() => [])).filter(g => g.played && (g.local?.club?.code === team || g.road?.club?.code === team));
    await pool(list, 6, async g => {
      const box = await getJSON(`${API}/v3/competitions/${COMPS[lg]}/seasons/${code(lg, year)}/games/${g.gameCode}/stats`, 0, { keep: true }).catch(() => null);
      if (!box) return;
      const home = g.local?.club?.code === team;
      const me = (home ? box.local : box.road)?.players?.find(p => p.player?.person?.code === player);
      const s = me?.stats;
      if (!s || !s.timePlayed) return; // no jugó
      const mine = home ? g.local : g.road, opp = home ? g.road : g.local;
      out.push({
        id: `${year}_${g.gameCode}`, date: g.utcDate, season: year, type: g.phaseType?.code === 'RS' ? 'reg' : 'post', home,
        opp: opp.club?.tvCode || opp.club?.code || '?', team: mine.club?.tvCode || team, teamId: team,
        result: mine.score > opp.score ? 'W' : 'L', score: `${mine.score}-${opp.score}`,
        min: Math.round(s.timePlayed / 6) / 10, pts: s.points || 0, reb: s.totalRebounds || 0, ast: s.assistances || 0,
        stl: s.steals || 0, blk: s.blocksFavour || 0, tov: s.turnovers || 0, fg3m: s.fieldGoalsMade3 || 0
      });
    });
  }
  return { currentSeason: y, games: out.sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

module.exports = { COMPS, games, roster, search, gamelog };

// Estadísticas de un partido ("E2026_10"): jugadores, totales sumados y puntos por cuarto
async function boxscore(lg, gid) {
  const [seasonCode, gameCode] = String(gid).split('_');
  const year = Number(seasonCode.slice(1));
  const g = (await season(lg, year)).find(x => String(x.gameCode) === gameCode);
  if (!g) throw new Error('Partido desconocido');
  const box = g.played || new Date(g.utcDate).getTime() <= Date.now()
    ? await getJSON(`${API}/v3/competitions/${COMPS[lg]}/seasons/${seasonCode}/games/${gameCode}/stats`, g.played ? 0 : 30e3, { keep: g.played }).catch(() => null)
    : null;
  const shoot = (m, a) => `${m || 0}-${a || 0}`;
  const row = s => ({
    min: Math.round((s.timePlayed || 0) / 6) / 10, pts: s.points || 0, reb: s.totalRebounds || 0, ast: s.assistances || 0,
    stl: s.steals || 0, blk: s.blocksFavour || 0, tov: s.turnovers || 0,
    fg: shoot((s.fieldGoalsMade2 || 0) + (s.fieldGoalsMade3 || 0), (s.fieldGoalsAttempted2 || 0) + (s.fieldGoalsAttempted3 || 0)),
    fg3: shoot(s.fieldGoalsMade3, s.fieldGoalsAttempted3), ft: shoot(s.freeThrowsMade, s.freeThrowsAttempted), pm: s.plusMinus != null ? String(s.plusMinus) : ''
  });
  const sum = list => {
    const t = { timePlayed: 0, points: 0, totalRebounds: 0, assistances: 0, steals: 0, blocksFavour: 0, turnovers: 0, fieldGoalsMade2: 0, fieldGoalsAttempted2: 0, fieldGoalsMade3: 0, fieldGoalsAttempted3: 0, freeThrowsMade: 0, freeThrowsAttempted: 0 };
    for (const p of list) for (const k of Object.keys(t)) t[k] += p.stats?.[k] || 0;
    return { ...row(t), min: 0, pm: '' };
  };
  const team = (side, t, b) => {
    const players = (b?.players || []).filter(p => p.stats?.timePlayed);
    const pt = t.partials || {};
    return {
      id: t.club?.code || '', name: (t.club?.editorialName || t.club?.name || '').trim(), abbr: t.club?.tvCode || t.club?.code || '',
      logo: t.club?.images?.crest || '', side,
      periods: [pt.partials1, pt.partials2, pt.partials3, pt.partials4, ...Object.values(pt.extraPeriods || {})].filter(v => v != null).map(Number),
      players: players.map(p => ({ id: p.player?.person?.code || '', name: niceName(p.player?.person?.name), starter: !!p.stats.startFive, ...row(p.stats) })),
      totals: sum(players)
    };
  };
  // Enfrentamientos de la temporada entre los dos equipos
  const codes = [g.local?.club?.code, g.road?.club?.code];
  const series = (await season(lg, year)).filter(x => x.played && codes.includes(x.local?.club?.code) && codes.includes(x.road?.club?.code)).map(x => ({
    date: x.utcDate, status: 'Final',
    score: [x.road, x.local].map(t => ({ abbr: t.club?.tvCode || t.club?.code || '', score: String(t.score), winner: t.score > (t === x.road ? x.local : x.road).score }))
  }));
  return { teams: [team('away', g.road, box?.road), team('home', g.local, box?.local)], series };
}

module.exports.boxscore = boxscore;
