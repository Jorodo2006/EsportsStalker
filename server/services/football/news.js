// Noticias de fútbol (lo común en shared/news.js). Fuentes (sus robots.txt permiten leer estos RSS; Marca y AS no se usan: sus
// RSS llevan semanas o años sin actualizarse):
// - ESPN: las noticias de cada liga, que ya traen el equipo (teamId) y los jugadores
// - Mundo Deportivo, BBC Sport y The Guardian: RSS de fútbol; el equipo se busca por su nombre en el titular y la entradilla
const { newsStore, teamsIn: teamsInAny } = require('../../shared/news');

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

// leagues: las de ESPN (su id, como esp.1); upcoming: los equipos de los partidos de ayer a dentro de unos días
function footballNews({ leagues, upcoming }) {
  return newsStore({
    schema: 'football', rss: RSS, upcoming, match: MATCH,
    espn: leagues.map(lg => ({ url: `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.espn}/news?limit=50` }))
  });
}

module.exports = { footballNews, teamsIn };
