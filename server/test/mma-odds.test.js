const test = require('node:test');
const assert = require('node:assert');
const { Book, intoBook } = require('../services/odds/odds');
const { teamScore, orient } = require('../services/odds/equipos');
const wm = require('./fixtures/odds-winamax-mma.json');
const bw = require('./fixtures/odds-betway-mma.json');

const gane = { name: 'Ciryl Gane', code: '', alt: ['Gane', 'Gane C'] };
const hokit = { name: 'Josh Hokit', code: '', alt: ['Hokit', 'Hokit J'] };
const match = { a: gane, b: hokit, sport: 'mma' };
const swapped = { a: hokit, b: gane, sport: 'mma' };

const build = (m, imps) => { const b = new Book(m.a, m.b, 'mma'); for (const i of imps) intoBook(b, m, i); return b; };
const price = (b, key, id, book) => b.markets.get(key)?.outcomes.find(o => o.id === id)?.prices[book];

test('Winamax: ganador, total de asaltos, llega al final y ganador+método van a claves estables', () => {
  const b = build(match, [wm]);
  assert.strictEqual(price(b, 'moneyline|0||', 'a', 'Winamax'), 1.47);
  assert.strictEqual(price(b, 'moneyline|0||', 'b', 'Winamax'), 2.65);
  assert.strictEqual(price(b, 'total_rounds|0||2.5', 'over', 'Winamax'), 1.6);
  assert.strictEqual(price(b, 'total_rounds|0||2.5', 'under', 'Winamax'), 2.3);
  assert.ok(b.markets.has('total_rounds|0||1.5') && b.markets.has('total_rounds|0||3.5'));
  assert.strictEqual(b.markets.get('total_rounds|0||2.5').line, 2.5);
  assert.strictEqual(price(b, 'distance|0||', 'yes', 'Winamax'), 2.75);
  assert.strictEqual(price(b, 'distance|0||', 'no', 'Winamax'), 1.4);
  assert.strictEqual(price(b, 'method|0|ko|', 'a', 'Winamax'), 2.25);
  assert.strictEqual(price(b, 'method|0|ko|', 'b', 'Winamax'), 5.5);
  assert.strictEqual(price(b, 'method|0|sub|', 'a', 'Winamax'), 10);
  assert.strictEqual(price(b, 'method|0|sub|', 'b', 'Winamax'), 9);
  assert.strictEqual(price(b, 'method|0|dec|', 'a', 'Winamax'), 4);
});

test('Betway: ganador, total de asaltos por línea, método por luchador y decisión', () => {
  const b = build(match, [bw]);
  assert.strictEqual(price(b, 'moneyline|0||', 'a', 'Betway'), 1.53);
  assert.strictEqual(price(b, 'moneyline|0||', 'b', 'Betway'), 2.5);
  for (const l of ['1.5', '2.5', '3.5', '4.5']) assert.ok(b.markets.has(`total_rounds|0||${l}`), l);
  assert.strictEqual(price(b, 'total_rounds|0||2.5', 'over', 'Betway'), 1.83);
  assert.strictEqual(price(b, 'total_rounds|0||2.5', 'under', 'Betway'), 1.9);
  assert.strictEqual(price(b, 'method|0|ko|', 'a', 'Betway'), 2.2);
  assert.strictEqual(price(b, 'method|0|ko|', 'b', 'Betway'), 5.5);
  assert.strictEqual(price(b, 'method|0|sub|', 'a', 'Betway'), 10);
  assert.strictEqual(price(b, 'method|0|sub|', 'b', 'Betway'), 9);
  assert.strictEqual(price(b, 'method|0|dec|', 'a', 'Betway'), 4);
  assert.strictEqual(price(b, 'method|0|dec|', 'b', 'Betway'), 7);
  assert.strictEqual(price(b, 'distance|0||', 'yes', 'Betway'), 3);
  assert.strictEqual(price(b, 'distance|0||', 'no', 'Betway'), 1.36);
});

test('las dos casas comparten fila y los mercados que no se entienden salen como propios', () => {
  const b = build(match, [wm, bw]);
  const ml = b.markets.get('moneyline|0||');
  assert.deepStrictEqual(ml.outcomes.find(o => o.id === 'a').prices, { Winamax: 1.47, Betway: 1.53 });
  const groups = [...b.markets.values()].map(m => m.group);
  assert.ok(groups.includes('Ganador'));
  assert.ok(groups.some(g => /Apuestas en los asaltos/.test(g)), 'un mercado de Betway sin equivalente se conserva');
  assert.ok(!b.markets.has('moneyline|0||x'));
});

test('con los luchadores al revés (b contra a) los precios se orientan igual', () => {
  const b = build(swapped, [wm, bw]);
  assert.strictEqual(price(b, 'moneyline|0||', 'a', 'Winamax'), 2.65); // a = Hokit
  assert.strictEqual(price(b, 'moneyline|0||', 'b', 'Winamax'), 1.47);
  assert.strictEqual(price(b, 'moneyline|0||', 'a', 'Betway'), 2.5);
  assert.strictEqual(price(b, 'method|0|ko|', 'a', 'Winamax'), 5.5);
  assert.strictEqual(price(b, 'method|0|ko|', 'a', 'Betway'), 5.5);
});

test('un combate cambiado (sustituto) no mezcla cuotas de otro rival', () => {
  const other = { ...match, b: { name: 'Alexander Volkov', code: '', alt: ['Volkov'] } };
  const b = build(other, [wm, bw]);
  assert.strictEqual(b.markets.size, 0);
});

test('nombres con tilde, apodo o errata de una casa siguen emparejando al luchador', () => {
  assert.ok(teamScore({ name: 'Uroš Medić', alt: ['Medić'] }, 'Uros Medic') >= 0.8);
  assert.ok(teamScore({ name: 'Charles Radtke', alt: ['Radtke'] }, 'Charlie Radke') >= 0.75);
  assert.ok(teamScore({ name: 'Chris Duncan', alt: ['Duncan'] }, 'Christopher Duncan') >= 0.8);
  assert.ok(teamScore({ name: 'Alatengheili', alt: [] }, 'Alateng Heili') >= 0.8);
  assert.ok(orient({ name: 'Stephen Thompson', alt: ['Thompson'] }, { name: 'Charles Radtke', alt: ['Radtke'] }, 'Stephen Thompson', 'Charlie Radke'));
});

test('el parecido de apellidos no cruza luchadores distintos', () => {
  assert.ok(teamScore({ name: 'Jon Garcia', alt: ['Garcia'] }, 'Mike Gracia') < 0.75, 'otra inicial');
  assert.strictEqual(orient({ name: 'Ilia Topuria' }, { name: 'Max Holloway' }, 'Alexander Volkanovski', 'Max Holloway'), null);
  const o = orient({ name: 'Ilia Topuria', alt: ['Topuria'] }, { name: 'Max Holloway', alt: ['Holloway'] }, 'Max Holloway', 'Ilia Topuria');
  assert.strictEqual(o.swapped, true);
});

test('Winamax: un combate con el mismo apellido pero otro luchador no se mezcla', () => {
  const m = { a: { name: 'José Silva', code: '', alt: ['Silva'] }, b: { name: 'Ciryl Gane', code: '', alt: ['Gane'] }, sport: 'mma' };
  const otro = { ...wm, home: 'Bruno Silva', away: 'Ciryl Gane' };
  const b = new Book(m.a, m.b, 'mma');
  assert.strictEqual(intoBook(b, m, otro), 0);
  assert.strictEqual(b.markets.size, 0);
});
