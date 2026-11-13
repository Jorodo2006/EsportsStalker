const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const wow = require('../services/mma/wow');

const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parseEvent lee los combates profesionales de un evento pasado (sin los amateur)', () => {
  const f = wow.parseEvent(fx('wow-31.html'), 'wow-31-madrid');
  assert.strictEqual(f.length, 7);
  const first = f[0];
  assert.strictEqual(first.a.name, 'Brian Hooi');
  assert.strictEqual(first.b.name, 'Umakhan Ibragimov');
  assert.strictEqual(first.a.record, '23-12-0');
  assert.strictEqual(first.b.record, '10-2-0');
  assert.strictEqual(first.weightClass, 'Lightweight');
  assert.strictEqual(first.org, 'wow');
  assert.strictEqual(first.event, 'WOW 31 Madrid');
  assert.strictEqual(first.state, 'post');
  assert.deepStrictEqual(first.result, { winner: 'b', method: 'ko', round: 1, time: '3:12', draw: false, noContest: false });
  assert.ok(!f.some(x => x.a.name === 'Merche García'), 'los amateur no entran');
});

test('el ganador es el lado que lleva la etiqueta GANADOR (rojo = a)', () => {
  const f = wow.parseEvent(fx('wow-31.html'), 'wow-31-madrid');
  const mokaev = f.find(x => x.a.name === 'Muhammad Mokaev');
  assert.strictEqual(mokaev.result.winner, 'a');
  assert.strictEqual(mokaev.result.method, 'ko');
  assert.strictEqual(mokaev.result.time, '0:42');
  assert.strictEqual(f.find(x => x.a.name === 'Antonio Fofirca').result.method, 'sub');
});

test('un tiempo entero es en punto y una decisión es dec', () => {
  const f = wow.parseEvent(fx('wow-31.html'), 'wow-31-madrid');
  const dec = f.find(x => x.result.method === 'dec');
  assert.strictEqual(dec.result.time, '5:00');
  assert.strictEqual(dec.result.round, 3);
});

test('el combate principal es el primero de la lista y las entidades HTML se decodifican', () => {
  const f = wow.parseEvent(fx('wow-31.html'), 'wow-31-madrid');
  assert.strictEqual(f[0].cardPos, 1);
  assert.strictEqual(f[6].cardPos, 7);
  const apodo = f.find(x => /Izquierdo/.test(x.a.name));
  assert.ok(!/&quot;|&amp;/.test(apodo.a.name));
  assert.ok(apodo.a.alt.includes('Izquierdo'));
});

test('la fecha, el nombre y la ciudad salen de la cabecera del evento', () => {
  const m = wow.parseMeta(fx('wow-35-vacio.html'), 'wow-35-madrid');
  assert.strictEqual(m.name, 'WOW 35 Madrid');
  assert.strictEqual(m.city, 'Madrid');
  assert.strictEqual(m.date.slice(0, 10), '2026-12-12');
});

test('un evento futuro sin cartelera devuelve lista vacía, sin error', () => {
  assert.deepStrictEqual(wow.parseEvent(fx('wow-35-vacio.html'), 'wow-35-madrid'), []);
});

test('un HTML que no es el esperado devuelve lista vacía y metadatos nulos', () => {
  assert.deepStrictEqual(wow.parseEvent('<html><body>mantenimiento</body></html>', 'wow-99'), []);
  assert.deepStrictEqual(wow.parseEvent('', 'wow-99'), []);
  assert.strictEqual(wow.parseMeta('<html></html>', 'wow-99'), null);
});

test('slugs de eventos del sitemap, ordenados de más nuevo a más viejo', () => {
  const xml = '<urlset><url><loc>https://www.wowmma.com/wow-events/wow-9</loc></url><url><loc>https://www.wowmma.com/wow-events/wow-31-madrid</loc></url><url><loc>https://www.wowmma.com/wow-events/wow-30-lisboa</loc></url><url><loc>https://www.wowmma.com/mma-campeones</loc></url></urlset>';
  assert.deepStrictEqual(wow.slugsOf(xml), ['wow-31-madrid', 'wow-30-lisboa', 'wow-9']);
});

test('event(slug) descarga una sola página de evento y la lee', async () => {
  const html = fx('wow-31.html');
  const urls = [];
  const f = await wow.event('wow-31-madrid', async (u) => { urls.push(u); return html; });
  assert.strictEqual(f.length, 7);
  assert.deepStrictEqual(urls, ['https://www.wowmma.com/wow-events/wow-31-madrid']);
  await assert.rejects(() => wow.event('../etc?x=1', async () => html), /Evento WOW no válido/);
});

test('el id de un combate de WOW no depende de su posición en la página, sino de los dos luchadores', () => {
  const f = wow.parseEvent(fx('wow-31.html'), 'wow-31-madrid');
  assert.strictEqual(f[0].id, 'wow:wow-31-madrid:brian-hooi-vs-umakhan-ibragimov');
  assert.ok(f.every(x => /^[\w:.-]{1,80}$/.test(x.id)), 'valen para el formato de ref de las apuestas');
  assert.strictEqual(new Set(f.map(x => x.id)).size, f.length);
  // si WOW añade un combate arriba, los demás conservan su id
  const html = fx('wow-31.html').replace('class="wow-result-fight-element', 'class="wow-result-fight-element" data-x="nuevo"></div><div role="listitem" class="wow-result-fight-element');
  const g = wow.parseEvent(html, 'wow-31-madrid');
  assert.ok(g.some(x => x.id === 'wow:wow-31-madrid:muhammad-mokaev-vs-jorge-calvo'));
});

test('sin fecha en la cabecera (la web cambió) no se devuelven combates con fecha vacía', () => {
  const html = fx('wow-31.html').replace(/<div class="wow-event-short font-bold">[^<]*<\/div>/, '<div class="wow-event-short font-bold">sin fecha</div>');
  assert.deepStrictEqual(wow.parseEvent(html, 'wow-31-madrid'), []);
  const es = fx('wow-31.html').replace('June 6, 2026', '6 de junio de 2026');
  assert.deepStrictEqual(wow.parseEvent(es, 'wow-31-madrid'), []);
});

test('recentWithin: si WOW tarda más que el tope, devuelve vacío sin esperar', async () => {
  const slow = () => new Promise(r => setTimeout(() => r('<urlset></urlset>'), 400));
  const t0 = Date.now();
  assert.deepStrictEqual(await wow.recentWithin(60, 8, slow), []);
  assert.ok(Date.now() - t0 < 300, 'no esperó a WOW');
  const fast = async () => '<urlset></urlset>';
  assert.deepStrictEqual(await wow.recentWithin(500, 8, fast), []);
});
