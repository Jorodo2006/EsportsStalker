// Noticias de baloncesto (lo común en shared/news.js). Fuentes (gratuitas; sus robots.txt permiten leerlas):
// - ESPN: las noticias de la NBA y la WNBA, que ya traen el equipo (teamId) y los jugadores
// - Mundo Deportivo (baloncesto y NBA), The Guardian (NBA) y Gigantes del Basket: RSS; el equipo se busca por su nombre
// La web de la Euroliga responde 429 a quien no es un navegador: no se usa (nada de disfrazarse).
// Los equipos se guardan con su liga delante («nba:19», «euroleague:RMB»): los ids de la NBA y la WNBA de ESPN se repiten
const { newsStore, teamsIn: teamsInAny } = require('../../shared/news');

const RSS = [
  { name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/baloncesto.xml' },
  { name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/baloncesto/nba.xml' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/sport/nba/rss' },
  { name: 'Gigantes del Basket', url: 'https://www.gigantes.com/feed/' }
];
// Palabras que solas no dicen de qué equipo es («Valencia Basket», «Unicaja Málaga»)
const COMMON = new Set(['basket', 'basketball', 'club', 'real', 'city', 'baloncesto']);
const NICK = { 'real madrid': ['madrid de baloncesto'], 'fc barcelona': ['barca'], 'golden state warriors': ['warriors'], 'philadelphia 76ers': ['sixers'] };
const MATCH = { common: COMMON, nick: NICK };
const teamsIn = (text, teams) => teamsInAny(text, teams, MATCH);
const keyOf = (league, id) => `${league}:${id}`;

function basketNews({ upcoming }) {
  return newsStore({
    schema: 'basket', rss: RSS, upcoming, match: MATCH,
    espn: ['nba', 'wnba'].map(lg => ({ url: `https://site.api.espn.com/apis/site/v2/sports/basketball/${lg}/news?limit=50`, keyOf: id => keyOf(lg, id) }))
  });
}

module.exports = { basketNews, teamsIn, keyOf };
