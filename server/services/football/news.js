// Noticias de fútbol (lo común en shared/news.js). Fuentes (sus robots.txt permiten leer estos RSS; Marca y AS no se usan: sus
// RSS llevan semanas o años sin actualizarse):
// - ESPN: las noticias de cada liga, que ya traen el equipo (teamId) y los jugadores
// - Mundo Deportivo, BBC Sport y The Guardian: RSS de fútbol; el equipo se busca por su nombre en el titular y la entradilla
// Para saber de qué jugador habla, la plantilla de ESPN de cada equipo (una vez cada 12 h). Las noticias nuevas que dicen que
// alguien no juega, duda, está lesionado, sancionado o vuelve se mandan a bets para avisar al momento (alerts.fromNews)
const { newsStore, teamsIn: teamsInAny } = require('../../shared/news');
const client = require('../../shared/client');

const RSS = [
  { name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/futbol.xml' },
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/football/rss' }
];
// Palabras que comparten muchos clubes: solas no dicen de qué equipo es
const COMMON = new Set(['real', 'club', 'city', 'united', 'sporting', 'athletic', 'atletico', 'deportivo', 'union', 'inter', 'fc', 'cf', 'sc', 'ac']);
// Cómo llama la prensa a algunos equipos que ESPN nombra de otra manera (por el nombre de ESPN, sin acentos)
const NICK = {
  barcelona: ['barca'], 'atletico madrid': ['atleti', 'atletico de madrid'], internazionale: ['inter de milan'], espanyol: ['perico', 'pericos'],
  'bayern munich': ['bayern de munich', 'bayern munchen'], 'paris saint germain': ['paris sg'], 'athletic club': ['athletic de bilbao', 'athletic bilbao'],
  'celta vigo': ['celta', 'celta de vigo'], 'deportivo alaves': ['alaves'], 'wolverhampton wanderers': ['wolves'], 'borussia dortmund': ['dortmund'],
  'manchester united': ['man united'], 'tottenham hotspur': ['tottenham']
};
// Una noticia del fútbol femenino lo dice («femenino», «women», «Liga F», «WSL»); si no, es del masculino
const MATCH = { common: COMMON, nick: NICK, women: true };
const teamsIn = (text, teams) => teamsInAny(text, teams, MATCH);
const ROSTER_MS = 12 * 3600e3;

// leagues: las de ESPN (su id, como esp.1); upcoming: los equipos de los partidos de ayer a dentro de unos días, con su liga y
// su próximo partido ({ id, name, short, alts, women, league, match: { id, date } })
function footballNews({ leagues, upcoming }) {
  const espnOf = Object.fromEntries(leagues.map(l => [l.id, l.espn]));
  let known = new Map(); // id del equipo → el de upcoming (liga, nombre y partido)
  const teams = async () => { const list = await upcoming(); known = new Map(list.map(t => [String(t.id), t])); return list; };
  const rosters = new Map();
  async function rosterOf(id) {
    const hit = rosters.get(id);
    if (hit && Date.now() - hit.t < ROSTER_MS) return hit.v;
    const t = known.get(id);
    if (!t || !espnOf[t.league]) return [];
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnOf[t.league]}/teams/${id}/roster`, { signal: AbortSignal.timeout(15e3) });
    const j = r.ok ? await r.json() : {};
    const v = (j.athletes || []).map(a => ({ name: a.displayName || a.fullName, team: id })).filter(p => p.name);
    rosters.set(id, { t: Date.now(), v });
    return v;
  }
  return newsStore({
    schema: 'football', rss: RSS, upcoming: teams, match: MATCH,
    espn: leagues.map(lg => ({ url: `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.espn}/news?limit=50` })),
    playersOf: async keys => (await Promise.all(keys.map(k => rosterOf(String(k)).catch(() => [])))).flat(),
    onNew: rows => client.call('bets', 'POST', '/internal/alerts/news', {
      sport: 'football',
      items: rows.map(r => ({
        title: r.title, url: r.url, source: r.source, published: r.published, seen_at: r.seen_at,
        outs: r.outs.map(o => ({ ...o, teamName: known.get(o.team)?.name || '', match: known.get(o.team)?.match || null }))
      }))
    })
  });
}

module.exports = { footballNews, teamsIn };
