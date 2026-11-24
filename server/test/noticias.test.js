// Noticias de fútbol (server/services/football/news.js): leer el RSS, etiquetar y unir cada noticia a sus equipos, sin red
const test = require('node:test');
const assert = require('node:assert');
const { rssItems, tagsOf, teamsIn, rowOf } = require('../services/football/news');

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
