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

test('quién no juega: el jugador de la plantilla y lo que dice la frase en la que sale', () => {
  const { playerStatuses } = require('../shared/news');
  const barca = ['Robert Lewandowski', 'Jules Koundé', 'Joan Garcia', 'Lamine Yamal', 'Ronald Araújo', 'Eric García'].map(name => ({ name, team: '83' }));
  const st = (t, ps = barca) => playerStatuses(t, ps).map(x => `${x.name}:${x.status}`).sort();
  assert.deepStrictEqual(st('Lewandowski, baja ante el Athletic por una lesión muscular'), ['Robert Lewandowski:out']);
  assert.deepStrictEqual(st('Pendientes de Joan Garcia. El guardameta acabó con dolor en la rodilla y será duda para el sábado'), []); // la duda va en otra frase sin su nombre
  assert.deepStrictEqual(st('Joan Garcia, duda para el sábado por molestias en la rodilla'), ['Joan Garcia:doubt']);
  assert.deepStrictEqual(st('Hansi Flick on Barcelona with no Lamine Yamal: Lamine Yamal will miss the game'), ['Lamine Yamal:out']);
  assert.deepStrictEqual(st('Araújo, sancionado; Koundé vuelve a la convocatoria'), ['Jules Koundé:back', 'Ronald Araújo:suspended']);
  // «García» lo llevan dos: por el apellido solo no se sabe cuál
  assert.deepStrictEqual(st('García, baja para el sábado'), []);
  // «a la baja» o «no es baja» no son una baja
  assert.deepStrictEqual(st('Las cuotas de Lewandowski goleador, a la baja'), []);
  assert.deepStrictEqual(st('Koundé no es baja: el club descarta la lesión'), []);
  const nba = [{ name: 'Jalen Duren', team: 'nba:8' }, { name: 'Kyle Landale', team: 'nba:1' }, { name: 'Donte DiVincenzo', team: 'nba:16' }];
  // Ir a recuperarse para volver: sigue lesionado (no dice que juegue)
  assert.deepStrictEqual(st('Jalen Duren to begin rehab assignment in next step to return from injury', nba), ['Jalen Duren:injured']);
  // Titulares reales que se leían mal: «rule … out», «won't need surgery», un recurso ganado, «return» sin decir a qué
  const more = [...nba, { name: 'Victor Wembanyama', team: 'nba:24' }, { name: 'Kawhi Leonard', team: 'nba:12' }];
  assert.deepStrictEqual(st('Spurs rule Victor Wembanyama out for Saturday against Portland', more), ['Victor Wembanyama:out']);
  assert.deepStrictEqual(st("Kawhi Leonard's return from knee swelling still at least week away", more), []);
  const fut = [{ name: 'David Raya', team: '359' }, { name: 'Leny Yoro', team: '360' }, { name: 'Ethan Nwaneri', team: '359' }];
  assert.deepStrictEqual(st("David Raya won't need surgery - Arsenal boss Mikel Arteta", fut), []);
  assert.deepStrictEqual(st('Man United win appeal over Leny Yoro red card suspension', fut), []);
  assert.deepStrictEqual(st('Nwaneri at risk of becoming Arsenal forgotten teenager on return with', fut), []);
  assert.deepStrictEqual(st('Koundé vuelve a la convocatoria'), ['Jules Koundé:back']);
  assert.deepStrictEqual(st("Landale (hip) won't play Sunday against Boston", nba), ['Kyle Landale:out']);
  assert.deepStrictEqual(st("Sources: Wolves' Donte DiVincenzo eyes New Year's for season debut after knee injury", nba), ['Donte DiVincenzo:injured']);
});

test('el jugador de la noticia es el de la línea de la casa', () => {
  const { samePlayer } = require('../services/football/picks');
  assert.ok(samePlayer('Robert Lewandowski', 'R. Lewandowski'));
  assert.ok(samePlayer('Robert Lewandowski', 'Lewandowski'));
  assert.ok(!samePlayer('Eric García', 'Joan García'));
  assert.ok(!samePlayer('Lamine Yamal', 'Robert Lewandowski'));
});

test('aviso de noticia: a quien tiene una apuesta con ese jugador o lo sigue', () => {
  const { newsTargets, newsText } = require('../services/bets/alerts');
  const o = { name: 'Robert Lewandowski', team: '83', status: 'out', teamName: 'Barcelona' };
  const bets = [
    { user_id: 1, sport: 'football', event: 'Barcelona - Athletic Club', market: 'Goleador', selection: 'R. Lewandowski' },
    { user_id: 2, sport: 'football', event: 'Barcelona - Athletic Club', market: 'Resultado', selection: 'Barcelona' },
    { user_id: 3, sport: 'basket', event: 'LAL @ BOS', market: 'Puntos · Lewandowski', selection: 'Más de 9.5' }
  ];
  const favorites = [{ user_id: 4, sport: 'football', name: 'Barcelona' }, { user_id: 5, sport: 'football', name: 'Robert Lewandowski' }];
  const t = newsTargets('football', o, { bets, favorites });
  assert.deepStrictEqual(t.map(x => [x.userId, x.why]), [['1', 'bet'], ['4', 'fav'], ['5', 'fav']]);
  // Una duda no avisa a quien sigue al equipo, sólo al jugador
  assert.deepStrictEqual(newsTargets('football', { ...o, status: 'doubt' }, { bets: [], favorites }).map(x => x.userId), ['5']);
  assert.match(newsText(o, { title: 'Lewandowski, baja ante el Athletic', source: 'Mundo Deportivo' }, t[0]).title, /^Robert Lewandowski: no juega \(Barcelona\)$/);
});

test('lo que dice la frase es del jugador que está cerca, y si otra frase lo niega no cuenta', () => {
  const { playerStatuses } = require('../shared/news');
  const st = (t, ps) => playerStatuses(t, ps).map(x => `${x.name}:${x.status}`).sort();
  const mil = ['Tyler Herro', 'Myles Turner', 'Giannis Antetokounmpo'].map(name => ({ name, team: 'nba:15' }));
  assert.deepStrictEqual(st('Herro scores 32 points and Turner adds 27 as the Bucks beat the Raptors to snap a losing streak with Giannis Antetokounmpo ruled out', mil), ['Giannis Antetokounmpo:out']);
  const sp = ['Victor Wembanyama', "De'Aaron Fox"].map(name => ({ name, team: 'nba:24' }));
  assert.deepStrictEqual(st("Spurs rule Victor Wembanyama, De'Aaron Fox out for Friday's game against the Kings", sp), ["De'Aaron Fox:out", 'Victor Wembanyama:out']);
  // Lo del partido ya jugado no es una baja para el siguiente
  assert.deepStrictEqual(st("Spurs rule Victor Wembanyama, De'Aaron Fox out 90 minutes before win over Kings", sp), []);
  assert.deepStrictEqual(st('Curry se perdió el partido del martes', [{ name: 'Stephen Curry', team: 'nba:9' }]), []);
  assert.deepStrictEqual(st('Man United win appeal over Leny Yoro red card. The defender had been handed a three-game suspension.', [{ name: 'Leny Yoro', team: '360' }]), []);
  assert.deepStrictEqual(st('Tyler Herro scored 32 points, Myles Turner fouled out with a season-high 27', mil), []);
  assert.deepStrictEqual(st('Oviedo fan handed suspended prison sentence for racist abuse toward Mbappé', [{ name: 'Kylian Mbappé', team: '86' }]), []);
});
