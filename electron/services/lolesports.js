// API no oficial (pero pública) que usa la web lolesports.com.
// Calendario, resultados, partidos en directo y estadísticas en vivo de cada partida.
const { getJson, qs } = require('./http');

const API = 'https://esports-api.lolesports.com/persisted/gw';
const FEED = 'https://feed.lolesports.com/livestats/v1';

function api(path, params, key, ttl) {
  return getJson(`${API}/${path}?${qs({ hl: 'es-ES', ...params })}`, { headers: { 'x-api-key': key }, ttl });
}

async function getLeagues(key) {
  const j = await api('getLeagues', {}, key, 6 * 3600e3);
  return (j?.data?.leagues || [])
    .map(l => ({ id: l.id, slug: l.slug, name: l.name, region: l.region, image: l.image, priority: l.displayPriority?.position ?? 999 }))
    .sort((a, b) => a.priority - b.priority);
}

function normEvent(e) {
  const m = e.match || {};
  return {
    id: m.id || e.id,
    startTime: e.startTime,
    state: e.state, // unstarted | inProgress | completed
    blockName: e.blockName || '',
    league: e.league?.name || '',
    leagueSlug: e.league?.slug || '',
    bestOf: m.strategy?.count || null,
    teams: (m.teams || []).map(t => ({
      name: t.name,
      code: t.code,
      image: t.image,
      wins: t.result?.gameWins ?? null,
      outcome: t.result?.outcome ?? null,
      record: t.record ? `${t.record.wins}-${t.record.losses}` : ''
    }))
  };
}

async function getSchedule(key, { leagueIds = [], pageToken } = {}) {
  const j = await api('getSchedule', { leagueId: leagueIds.join(','), pageToken }, key, 60e3);
  const s = j?.data?.schedule || {};
  return {
    events: (s.events || []).filter(e => e.type === 'match' && e.match).map(normEvent),
    older: s.pages?.older || null,
    newer: s.pages?.newer || null
  };
}

async function getLive(key) {
  const j = await api('getLive', {}, key, 15e3);
  return (j?.data?.schedule?.events || []).filter(e => e.type === 'match' && e.match).map(normEvent);
}

async function getEventDetails(key, matchId) {
  const j = await api('getEventDetails', { id: matchId }, key, 15e3);
  const ev = j?.data?.event;
  if (!ev) return null;
  return {
    id: ev.id,
    league: ev.league?.name || '',
    teams: (ev.match?.teams || []).map(t => ({ id: t.id, name: t.name, code: t.code, image: t.image, wins: t.result?.gameWins ?? 0 })),
    games: (ev.match?.games || []).map(g => ({ id: g.id, number: g.number, state: g.state, vods: g.vods?.length || 0 }))
  };
}

// El feed sólo devuelve datos en ventanas de 10 s, y va con ~1 minuto de retraso respecto al directo.
function startingTime() {
  const t = Math.floor((Date.now() - 60e3) / 10e3) * 10e3;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

async function getLiveWindow(gameId) {
  const win = await getJson(`${FEED}/window/${gameId}?${qs({ startingTime: startingTime() })}`, { ttl: 5e3 })
    // Si la partida ya terminó, la ventana "actual" no existe: pedimos la última disponible
    .catch(() => null) || await getJson(`${FEED}/window/${gameId}`, { ttl: 30e3 }).catch(() => null);
  if (!win || !win.frames?.length) return null;

  const meta = win.gameMetadata || {};
  const frame = win.frames[win.frames.length - 1];
  const side = (teamFrame, teamMeta) => {
    const parts = teamMeta?.participantMetadata || [];
    return {
      teamId: teamMeta?.esportsTeamId || null,
      gold: teamFrame.totalGold, kills: teamFrame.totalKills, towers: teamFrame.towers,
      inhibitors: teamFrame.inhibitors, barons: teamFrame.barons, dragons: teamFrame.dragons || [],
      players: (teamFrame.participants || []).map(p => {
        const pm = parts.find(x => x.participantId === p.participantId) || {};
        return {
          name: pm.summonerName || `#${p.participantId}`, champion: pm.championId || '', role: pm.role || '',
          level: p.level, kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.creepScore,
          gold: p.totalGold, hp: p.currentHealth, maxHp: p.maxHealth
        };
      })
    };
  };
  return {
    patch: meta.patchVersion || '',
    state: frame.gameState, // in_game | paused | finished
    timestamp: frame.rfc460Timestamp,
    firstTimestamp: win.frames[0].rfc460Timestamp,
    blue: side(frame.blueTeam, meta.blueTeamMetadata),
    red: side(frame.redTeam, meta.redTeamMetadata)
  };
}

module.exports = { getLeagues, getSchedule, getLive, getEventDetails, getLiveWindow };
