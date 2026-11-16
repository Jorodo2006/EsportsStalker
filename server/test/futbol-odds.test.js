const test = require('node:test');
const assert = require('node:assert');
const { Book, intoBook } = require('../services/odds/odds');

// Estado de Winamax recortado, con los títulos y plantillas que manda su socket (partido Alemania - Países Bajos)
const bets = [
  ['asian_handicap', 'Hándicap asiático (handicap)', 'hcp=-2.5', [['Alemania -2.5', 'yes', 5.5], ['Países Bajos +2.5', 'no', 1.12]]],
  ['asian_handicap', '1ª mitad - Hándicap asiático (handicap)', 'hcp=-0.5', [['Alemania -0.5', 'yes', 2.25], ['Países Bajos +0.5', 'no', 1.58]]],
  ['asian_handicap', 'Hándicap asiático córner', 'hcp=-2.5', [['Alemania -2.5', 'yes', 2.35], ['Países Bajos +2.5', 'no', 1.47]]],
  ['asian_handicap', 'Hándicap asiático córner', 'hcp=-0.5', [['Alemania -0.5', 'yes', 1.54], ['Países Bajos +0.5', 'no', 2.2]]],
  ['OverUnder', 'Número total córneres', 'total=9.5', [['Más de 9.5', 'over', 1.9], ['Menos de 9.5', 'under', 1.8]]]
];
const state = { matches: { 1: { bets: [] } }, bets: {}, outcomes: {}, odds: {} };
bets.forEach(([template, betTitle, specialBetValue, outs], i) => {
  const id = 100 + i;
  state.matches[1].bets.push(id);
  state.bets[id] = { template, betTitle, specialBetValue, outcomes: outs.map((_, j) => id * 10 + j) };
  outs.forEach(([label, code, price], j) => { state.outcomes[id * 10 + j] = { label, code }; state.odds[id * 10 + j] = price; });
});

const match = { a: { name: 'Alemania', code: '' }, b: { name: 'Países Bajos', code: '' }, sport: 'football' };
const book = new Book(match.a, match.b, 'football');
intoBook(book, match, { book: 'winamax', home: 'Alemania', away: 'Países Bajos', matchId: 1, state });
const price = (key, id) => book.markets.get(key)?.outcomes.find(o => o.id === id)?.prices.Winamax;

test('Winamax fútbol: el hándicap asiático de goles lleva sus cuotas, no las del de córners', () => {
  assert.strictEqual(price('spread|0||-2.5', 'a'), 5.5);
  assert.strictEqual(price('spread|0||-2.5', 'b'), 1.12);
  assert.strictEqual(price('spread|1||-0.5', 'a'), 2.25);
  assert.ok(!book.markets.has('spread|0||-0.5'), 'el hándicap de córners no entra en el de goles');
  const corner = [...book.markets.values()].filter(m => /córner/i.test(m.group) && m.key.startsWith('wmx|'));
  assert.strictEqual(corner.length, 2);
});

test('Winamax fútbol: "Número total córneres" va a la fila común de córners', () => {
  assert.strictEqual(price('corners|0||9.5', 'over'), 1.9);
  assert.strictEqual(price('corners|0||9.5', 'under'), 1.8);
});
