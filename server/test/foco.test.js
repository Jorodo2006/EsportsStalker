const test = require('node:test');
const assert = require('node:assert');
const { focusGroups } = require('../lector/foco');

// Las pestañas de Betway de un partido de la NBA y de uno de fútbol, como salen en las lecturas
const NBA = ['main-markets', '1st-half', '1st-quarter', 'players', 'points', 'points-assists', 'points-assists-rebounds', 'points-over-under', 'points-rebounds', 'SGP'];
const FUT = ['main-markets', 'goals', 'corners', 'half', 'anytime', 'first', 'last', 'players', 'shots', 'on-target'];

test('sin foco, todas', () => {
  assert.deepStrictEqual(focusGroups(NBA, undefined, 'basket'), NBA);
  assert.deepStrictEqual(focusGroups([''], 'moneyline|0||', 'tennis'), ['']); // tenis: una sola página
});

test('mercado del partido: sólo la principal', () => {
  assert.deepStrictEqual(focusGroups(NBA, 'moneyline|0||', 'basket'), ['main-markets']);
  assert.deepStrictEqual(focusGroups(NBA, 'spread|0||-5.5', 'basket'), ['main-markets']);
});

test('periodos: la principal y la del periodo (para poder descartar copias)', () => {
  assert.deepStrictEqual(focusGroups(NBA, 'total|1||110.5', 'basket'), ['main-markets', '1st-half']);
  assert.deepStrictEqual(focusGroups(NBA, 'spread|11||-1.5', 'basket'), ['main-markets', '1st-quarter']);
  // Sin pestaña de ese periodo, se lee todo
  assert.deepStrictEqual(focusGroups(['main-markets', 'players'], 'total|1||110.5', 'basket'), ['main-markets', 'players']);
});

test('líneas de jugador: la de su estadística y la de jugadores', () => {
  assert.deepStrictEqual(focusGroups(NBA, 'player|Puntos|shai gilgeous-alexander|31.5', 'basket'), ['points', 'points-over-under', 'players']);
  assert.deepStrictEqual(focusGroups(NBA, 'player|Pts + Reb|jake laravia|20.5', 'basket'), ['points-rebounds', 'players']);
  assert.deepStrictEqual(focusGroups(NBA, 'player|Rebotes|jake laravia|5.5', 'basket'), ['players']);
});

test('fútbol: córners y goles con la principal; lo que no se sabe, todo', () => {
  assert.deepStrictEqual(focusGroups(FUT, 'corners|0||9.5', 'football'), ['main-markets', 'corners']);
  assert.deepStrictEqual(focusGroups(FUT, 'total|0||2.5', 'football'), ['main-markets', 'goals']);
  assert.deepStrictEqual(focusGroups(FUT, 'wmx|Goleador|', 'football'), FUT);
});
