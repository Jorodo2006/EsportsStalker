// API pública de ESPN (sin clave) para las ligas de EE. UU.: partidos, plantillas, bajas, buscador y partidos de
// cada jugador. Adaptado de courtside-edge. La NBA es la que tiene todo; la WNBA usa las mismas rutas.
const { getJSON } = require('./cache');

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

// Esta temporada y la anterior (al principio de temporada hay pocos partidos)
async function gamelog(lg, id) {
  const y = seasonYear();
  const logs = await Promise.all([y, y - 1].map(s =>
    getJSON(`${WEB}/sports/basketball/${LEAGUES[lg]}/athletes/${id}/gamelog?season=${s}`, 10 * 60e3).then(j => parseGamelog(j, s)).catch(() => [])));
  return { currentSeason: y, games: logs.flat().sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

module.exports = { LEAGUES, games, roster, injuries, search, gamelog };

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
      fg: val(arr, 'FG') || '', fg3: val(arr, '3PT') || '', ft: val(arr, 'FT') || '', pm: val(arr, '+/-') || ''
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
