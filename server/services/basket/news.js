// Noticias de baloncesto (lo común en shared/news.js). Fuentes (gratuitas; sus robots.txt permiten leerlas):
// - ESPN: las noticias de la NBA y la WNBA, que ya traen el equipo (teamId) y los jugadores
// - Mundo Deportivo (baloncesto y NBA), The Guardian (NBA) y Gigantes del Basket: RSS; el equipo se busca por su nombre
// La web de la Euroliga responde 429 a quien no es un navegador: no se usa (nada de disfrazarse).
// Los equipos se guardan con su liga delante («nba:19», «euroleague:RMB»): los ids de la NBA y la WNBA de ESPN se repiten.
// Para saber de qué jugador habla, la plantilla de cada equipo (roster de espn.js / euroleague.js, con su caché). Las noticias
// nuevas que dicen que alguien no juega, duda, está lesionado, sancionado o vuelve se mandan a bets para avisar al momento
const { newsStore, teamsIn: teamsInAny } = require('../../shared/news');
const client = require('../../shared/client');

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

// upcoming: los equipos de los partidos de ayer a dentro de unos días ({ key, id, name, alts, match }); rosterOf: (liga, id) =>
// su plantilla ({ id, name })
function basketNews({ upcoming, rosterOf }) {
  let known = new Map();
  const teams = async () => { const list = await upcoming(); known = new Map(list.map(t => [t.key, t])); return list; };
  const playersOf = async keys => (await Promise.all(keys.map(async k => {
    const [lg, id] = String(k).split(':');
    return (await rosterOf(lg, id).catch(() => [])).map(p => ({ name: p.name, team: k }));
  }))).flat();
  return newsStore({
    schema: 'basket', rss: RSS, upcoming: teams, match: MATCH, playersOf,
    espn: ['nba', 'wnba'].map(lg => ({ url: `https://site.api.espn.com/apis/site/v2/sports/basketball/${lg}/news?limit=50`, keyOf: id => keyOf(lg, id) })),
    onNew: rows => client.call('bets', 'POST', '/internal/alerts/news', {
      sport: 'basket',
      items: rows.map(r => ({
        title: r.title, url: r.url, source: r.source, published: r.published, seen_at: r.seen_at,
        outs: r.outs.map(o => ({ ...o, teamName: known.get(o.team)?.name || '', match: known.get(o.team)?.match || null }))
      }))
    })
  });
}

module.exports = { basketNews, teamsIn, keyOf };
