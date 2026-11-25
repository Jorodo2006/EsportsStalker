// Noticias (server/shared/news.js, con lo propio de fútbol y baloncesto en su news.js): leer el RSS, etiquetar y unir cada
// noticia a sus equipos, sin red
const test = require('node:test');
const assert = require('node:assert');
const { rssItems, tagsOf, rowOf, espnRows, keyNews } = require('../shared/news');
const { teamsIn } = require('../services/football/news');
const { teamsIn: basketTeamsIn, keyOf } = require('../services/basket/news');

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fútbol</title>
<item><title><![CDATA[Lewandowski, baja ante el Athletic por una lesión muscular]]></title>
<link>https://www.mundodeportivo.com/futbol/fc-barcelona/20261124/1.html</link>
<description><![CDATA[<p>El delantero del Barça se pierde el partido del sábado &amp; será duda para la Champions</p>]]></description>
<pubDate>24 Nov 2026 23:23:01 +0100</pubDate><category>FC Barcelona</category></item>
<item><title>Sin enlace</title></item>
</channel></rss>`;

test('lee las noticias de un RSS: título, enlace, entradilla sin HTML, fecha y categorías', () => {
  const items = rssItems(RSS);
  assert.strictEqual(items.length, 1); // la que no tiene enlace no vale
  assert.strictEqual(items[0].title, 'Lewandowski, baja ante el Athletic por una lesión muscular');
  assert.strictEqual(items[0].summary, 'El delantero del Barça se pierde el partido del sábado & será duda para la Champions');
  assert.deepStrictEqual(items[0].cats, ['FC Barcelona']);
  assert.strictEqual(+new Date(items[0].published), +new Date('2026-11-24T22:23:01Z'));
});

test('etiqueta lo que puede mover un partido, en español y en inglés', () => {
  assert.deepStrictEqual(tagsOf('Lewandowski, baja por una lesión muscular; duda para la Champions'), ['baja', 'duda']);
  assert.deepStrictEqual(tagsOf('Saka ruled out for three weeks with hamstring injury'), ['baja']);
  assert.deepStrictEqual(tagsOf('Rodri back in training ahead of derby'), ['vuelve']);
  assert.deepStrictEqual(tagsOf('Vinícius, sancionado dos partidos'), ['sancion']);
  assert.deepStrictEqual(tagsOf('Ange Postecoglou sacked; interim manager named'), ['entrenador']);
  assert.deepStrictEqual(tagsOf('Arsenal set-piece goals are down this season'), []);
});

test('une la noticia a los equipos que nombra, y separa el fútbol femenino', () => {
  const teams = [
    { id: 83, name: 'Barcelona', short: 'Barcelona', alts: ['Barcelona', 'BAR'] },
    { id: 93, name: 'Athletic Club', short: 'Athletic', alts: ['Athletic Club', 'ATH'] },
    { id: 1, name: 'Real Madrid', short: 'Real Madrid', alts: [] },
    { id: 900, name: 'Barcelona', short: 'Barcelona', alts: [], women: true }
  ];
  assert.deepStrictEqual(teamsIn('Lewandowski, baja ante el Athletic Club. FC Barcelona', teams), ['83', '93']);
  assert.deepStrictEqual(teamsIn('El Barcelona femenino golea en Liga F', teams), ['900']);
  // «Real» solo no es el Real Madrid; «Athletic» solo tampoco (palabras que comparten muchos clubes)
  assert.deepStrictEqual(teamsIn('El Real Betis gana; el Athletic empata', teams), []);
  // Apodos de la prensa, y un nombre dentro del de otro equipo no cuenta
  const more = [...teams, { id: 110, name: 'Internazionale', short: 'Inter Milan', alts: [] }, { id: 103, name: 'AC Milan', short: 'Milan', alts: [] }];
  assert.deepStrictEqual(teamsIn('El Barça visita al Athletic de Bilbao', more), ['83', '93']);
  assert.deepStrictEqual(teamsIn('Gol del Inter de Milán', more), ['110']);
  assert.deepStrictEqual(teamsIn('Derbi: Milan e Inter de Milán', more), ['110', '103']);
});

test('una fecha que no se entiende o del futuro cuenta como ahora', () => {
  const r = rowOf('BBC Sport', { title: 'X', url: 'https://a.b/c', summary: '', published: 'mañana' }, ['1']);
  assert.ok(Math.abs(+r.published - Date.now()) < 5000);
  const later = rowOf('BBC Sport', { title: 'X', url: 'https://a.b/c', summary: '', published: new Date(Date.now() + 864e5).toISOString() }, ['1']);
  assert.ok(+later.published <= Date.now());
  assert.strictEqual(r.id, later.id); // el mismo enlace de la misma fuente es la misma noticia
});

test('baloncesto: equipo por su apodo y con la liga delante; un apodo de dos equipos no dice cuál es', () => {
  const teams = [
    { key: keyOf('nba', 13), id: 13, name: 'Los Angeles Lakers', alts: ['Lakers'] },
    { key: keyOf('nba', 23), id: 23, name: 'Sacramento Kings', alts: ['Kings'] },
    { key: keyOf('nbl', 5), id: 5, name: 'Sydney Kings', alts: ['Kings'] },
    { key: keyOf('euroleague', 'MAD'), id: 'MAD', name: 'Real Madrid', alts: ['Real Madrid'] },
    { key: keyOf('euroleague', 'VBC'), id: 'VBC', name: 'Valencia Basket', alts: ['Valencia Basket', 'Valencia'] }
  ];
  assert.deepStrictEqual(basketTeamsIn('LeBron, duda para el partido de los Lakers', teams), ['nba:13']);
  assert.deepStrictEqual(basketTeamsIn('Los Kings pierden otra vez', teams), []);
  assert.deepStrictEqual(basketTeamsIn('Sacramento Kings: Sabonis, baja', teams), ['nba:23']);
  assert.deepStrictEqual(basketTeamsIn('El Real Madrid gana en Valencia', teams), ['euroleague:MAD', 'euroleague:VBC']);
  assert.deepStrictEqual(basketTeamsIn('Copa del Rey de basket', teams), []);
});

test('ESPN: el equipo y los jugadores de las categorías; los vídeos no', () => {
  const json = { articles: [
    { type: 'HeadlineNews', headline: 'Jalen Duren to begin rehab assignment in next step to return from injury', description: '', published: '2026-11-24T10:00:00Z',
      links: { web: { href: 'https://www.espn.com/nba/story/_/id/1' } },
      categories: [{ type: 'team', teamId: 8, description: 'Detroit Pistons' }, { type: 'athlete', athleteId: 4433621, description: 'Jalen Duren' }] },
    { type: 'Media', headline: 'Highlights', links: { web: { href: 'https://www.espn.com/video/2' } }, categories: [{ type: 'team', teamId: 8 }] }
  ] };
  const rows = espnRows(json, id => keyOf('nba', id));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].teams, rows[0].players, rows[0].tags], [['nba:8'], ['Jalen Duren'], ['baja', 'vuelve']]);
});

test('junto a una recomendación: las de bajas y dudas de sus equipos de las últimas 48 h, primero las del jugador', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  const n = (title, teams, tags, h, players = []) => ({ title, summary: '', source: 'ESPN', url: 'https://x/' + title.length, published: new Date(now - h * 3600e3).toISOString(), teams, tags, players });
  const list = [
    n('Pistons: Cade Cunningham, duda', ['nba:8'], ['duda'], 2),
    n('Jalen Duren vuelve a entrenar', ['nba:8'], ['vuelve'], 5, ['Jalen Duren']),
    n('Old injury news', ['nba:8'], ['baja'], 60),
    n('Pistons sign partnership', ['nba:8'], [], 1)
  ];
  const r = keyNews(list, ['nba:8'], 'Jalen Duren', now);
  assert.deepStrictEqual([r.n, r.player, r.top.title, r.top.tags], [2, true, 'Jalen Duren vuelve a entrenar', ['vuelve']]);
  assert.strictEqual(keyNews(list, ['nba:8'], '', now).top.title, 'Pistons: Cade Cunningham, duda');
  assert.strictEqual(keyNews(list, ['nba:99'], '', now), null);
});
