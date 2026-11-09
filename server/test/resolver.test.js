// Pruebas del resolvedor de apuestas (server/services/bets/settle.js): cómo se decide cada mercado con un resultado dado.
// Sin base de datos ni red: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { evaluate } = require('../services/bets/settle');
const { normalizeBet } = require('../services/bets/store');

// Baloncesto: CHA 101 (visitante, a) - BKN 112 (local, b); cuartos 25-30, 26-28, 24-30, 26-24
const basket = {
  sport: 'basket', label: 'CHA 101-112 BKN', unit: 'puntos',
  score: p => ({ 0: [101, 112], 1: [51, 58], 2: [50, 54], 11: [25, 30], 12: [26, 28], 13: [24, 30], 14: [26, 24] })[p] ?? null,
  players: [
    { name: 'Naji Marshall', min: 28, pts: 12, reb: 4, ast: 3, stl: 1, blk: 0, tov: 2, fg3: '1-3' },
    { name: 'Darius Acuff Jr.', min: 30, pts: 20, reb: 2, ast: 6, stl: 0, blk: 0, tov: 3, fg3: '4-9' },
    { name: 'Banquillo Sin Minutos', min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fg3: '0-0' }
  ]
};
const ev = (key, out, R = basket) => evaluate({ key, out }, R)?.status ?? null;

test('totales: más, menos y la línea exacta es nula', () => {
  assert.equal(ev('total|0||212.5', 'over'), 'won'); // 213
  assert.equal(ev('total|0||212.5', 'under'), 'lost');
  assert.equal(ev('total|0||213', 'over'), 'void');
  assert.equal(ev('total|1||108.5', 'under'), 'lost'); // 1.ª mitad: 109
  assert.equal(ev('team_total|0|a|100.5', 'over'), 'won');
  assert.equal(ev('team_total|0|b|112.5', 'over'), 'lost');
});

test('ganador y hándicap referido al primero (a)', () => {
  assert.equal(ev('moneyline|0||', 'b'), 'won');
  assert.equal(ev('moneyline|0||', 'a'), 'lost');
  assert.equal(ev('spread|0||11.5', 'a'), 'won'); // 101 + 11,5 > 112
  assert.equal(ev('spread|0||11.5', 'b'), 'lost');
  assert.equal(ev('spread|0||11', 'a'), 'void');
  assert.equal(ev('moneyline|14||', 'a'), 'won'); // 4.º cuarto 26-24
});

test('líneas de jugador: por nombre (con o sin Jr.) y nula si no jugó', () => {
  assert.equal(ev('player|Asistencias|naji marshall|2.5', 'over'), 'won');
  assert.equal(ev('player|Triples anotados|darius acuff|3.5', 'over'), 'won'); // 4 triples; la casa sin "Jr."
  assert.equal(ev('player|Pts + Reb + Ast|darius acuff jr.|28.5', 'under'), 'won'); // 20 + 2 + 6 = 28
  assert.equal(ev('player|Puntos|banquillo sin minutos|4.5', 'over'), 'void');
  assert.equal(ev('player|Puntos|alguien que no está|4.5', 'over'), null); // no se adivina: a mano
});

test('lo que no sabe resolver se queda pendiente', () => {
  assert.equal(ev('wmx|Primera canasta|', '123'), null);
  assert.equal(ev('total|0||212.25', 'over'), null); // línea de cuarto
  assert.equal(ev('total|99||10.5', 'over'), null); // periodo desconocido
});

// Fútbol: local (a) 2 - 1 visitante (b), al descanso 0-1; 9 córners y 5 tarjetas
const football = {
  sport: 'football', label: 'A 2-1 B', unit: 'goles', corners: [6, 3], cards: [2, 3],
  score: p => ({ 0: [2, 1], 1: [0, 1], 2: [2, 0] })[p] ?? null
};
test('fútbol: 1X2, doble oportunidad, empate no válido, ambos marcan, córners', () => {
  assert.equal(ev('moneyline|0||', 'a', football), 'won');
  assert.equal(ev('moneyline|0||', 'x', football), 'lost');
  assert.equal(ev('moneyline|1||', 'b', football), 'won'); // 1.ª mitad
  assert.equal(ev('double|0||', 'x2', football), 'lost');
  assert.equal(ev('double|0||', '1x', football), 'won');
  assert.equal(ev('dnb|0||', 'a', football), 'won');
  assert.equal(ev('btts|0||', 'yes', football), 'won');
  assert.equal(ev('btts|1||', 'yes', football), 'lost');
  assert.equal(ev('corners|0||8.5', 'over', football), 'won');
  assert.equal(ev('cards|0||5.5', 'under', football), 'won');
  const draw = { ...football, score: () => [1, 1] };
  assert.equal(ev('dnb|0||', 'a', draw), 'void');
  assert.equal(ev('moneyline|0||', 'x', draw), 'won');
});

// Tenis: gana b 4-6 7-6 6-3 → juegos 17-15
const tennis = {
  sport: 'tennis', label: 'A 4-6 7-6 6-3 B', unit: 'juegos', winner: 'a',
  score: p => (p === 0 ? [17, 15] : p === 21 ? [4, 6] : p === 22 ? [7, 6] : p === 23 ? [6, 3] : p === 24 ? 'unplayed' : null)
};
test('tenis: ganador por quien gana (no por juegos), sets, juegos y set no jugado', () => {
  assert.equal(ev('moneyline|0||', 'a', tennis), 'won');
  assert.equal(ev('moneyline|21||', 'a', tennis), 'lost');
  assert.equal(ev('total|0||31.5', 'over', tennis), 'won');
  assert.equal(ev('spread|0||-2.5', 'a', tennis), 'lost'); // 17 - 2,5 < 15
  assert.equal(ev('moneyline|24||', 'a', tennis), 'void');
});

test('ref: se guarda si es válida y se descarta si no (la apuesta se guarda igual)', () => {
  const ok = normalizeBet({ odds: 1.9, stake: 1, selection: 'Más de 212.5', sport: 'basket', ref: { sport: 'basket', match: 'nba:401', key: 'total|0||212.5', out: 'over', start: '2026-11-05T00:00:00Z' } });
  assert.equal(ok.ref.key, 'total|0||212.5');
  const bad = normalizeBet({ odds: 1.9, stake: 1, selection: 'x', ref: { sport: 'basket', match: 'nba 401; drop', key: 'k', out: 'over' } });
  assert.equal(bad.ref, undefined);
  const combo = normalizeBet({ stake: 1, legs: [
    { selection: 'a', odds: 2, status: 'won', ref: { sport: 'basket', match: 'nba:1', key: 'moneyline|0||', out: 'a' } },
    { selection: 'b', odds: 2, status: 'void' }
  ] });
  assert.equal(combo.status, 'won');
  assert.equal(combo.odds, 2); // la nula cuenta 1
  assert.equal(combo.legs[0].ref.out, 'a');
});
