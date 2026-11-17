const test = require('node:test');
const assert = require('node:assert');
const { movesOf } = require('../services/odds/moves');
const { targetsOf, moveText, mentionsTeam, cleanWatch, cleanPrefs, isValue } = require('../services/bets/alerts');
const { cleanSub } = require('../services/bets/push');

const prev = new Map([
  ['moneyline|0||\u0000a', { price: 2.1 }],
  ['moneyline|0||\u0000b', { price: 1.8 }],
  ['player|Puntos|jake laravia|14.5\u0000over', { price: 1.9 }],
  ['wmx|Algo raro|\u0000x', { price: 3 }],
  ['moneyline|0||\u0000x', { price: 12 }]
]);

test('movimientos: sólo los fuertes de mercados que se siguen, sin cuotas muy altas', () => {
  const m = movesOf(prev, [
    { market_key: 'moneyline|0||', outcome_id: 'a', price: 1.85, market: 'Ganador', outcome: 'UTAH' }, // −12 %
    { market_key: 'moneyline|0||', outcome_id: 'b', price: 1.85, market: 'Ganador', outcome: 'LAC' }, // +3 %: no
    { market_key: 'player|Puntos|jake laravia|14.5', outcome_id: 'over', price: 2.2, market: 'Puntos', outcome: 'Más' }, // +16 %
    { market_key: 'wmx|Algo raro|', outcome_id: 'x', price: 2, market: 'Raro', outcome: 'x' }, // mercado propio: no
    { market_key: 'moneyline|0||', outcome_id: 'x', price: 9, market: 'Ganador', outcome: 'Empate' }, // de 12: no
    { market_key: 'total|0||212.5', outcome_id: 'over', price: 1.5, market: 'Total', outcome: 'Más' } // sin lectura anterior: no
  ]);
  assert.deepStrictEqual(m.map(x => [x.market_key, x.outcome_id]), [['moneyline|0||', 'a'], ['player|Puntos|jake laravia|14.5', 'over']]);
  assert.ok(m[0].change < -0.1 && m[1].change > 0.1);
});

const match = { a: { name: 'Utah Jazz', code: 'UTAH' }, b: { name: 'LA Clippers', code: 'LAC' }, start: '2026-11-18T03:30:00Z', sport: 'basket' };
const drop = { market_key: 'moneyline|0||', outcome_id: 'a', market: 'Ganador', outcome: 'UTAH', from: 2.1, to: 1.85, change: -0.119 };

test('el partido de una apuesta se reconoce por nombre, abreviatura o apellido', () => {
  assert.ok(mentionsTeam('UTAH @ LAC', match.a) && mentionsTeam('UTAH @ LAC', match.b));
  assert.ok(mentionsTeam('Carlos Alcaraz vs Jannik Sinner', { name: 'Jannik Sinner', code: '' }));
  assert.ok(mentionsTeam('Alcaraz vs Sinner', { name: 'Jannik Sinner', code: '' }));
  assert.ok(!mentionsTeam('BOS @ NY', match.a));
});

test('a quién le importa: su apuesta, su cupón y sus favoritos; una vez por persona', () => {
  const t = targetsOf(match, [drop], {
    bets: [
      { user_id: 1, event: 'UTAH @ LAC', ref: { sport: 'basket', match: 'g1', key: 'moneyline|0||', out: 'a', start: '2026-11-18T03:30:00Z' } },
      { user_id: 2, event: 'BOS @ NY', ref: { sport: 'basket', match: 'g2', key: 'moneyline|0||', out: 'a', start: '2026-11-18T03:30:00Z' } }, // otro partido
      { user_id: 3, event: 'UTAH @ LAC', ref: { sport: 'basket', match: 'g1', key: 'moneyline|0||', out: 'b', start: '2026-11-18T03:30:00Z' } } // la otra selección
    ],
    watch: [{ user_id: 1, sport: 'basket', a: 'Utah Jazz', b: 'LA Clippers', key: 'moneyline|0||', out: 'a' }, { user_id: 4, sport: 'basket', a: 'Utah Jazz', b: 'LA Clippers', key: 'moneyline|0||', out: 'a', id: 'g1' }],
    favorites: [{ user_id: 5, sport: 'basket', name: 'LA Clippers' }, { user_id: 6, sport: 'football', name: 'LA Clippers' }]
  });
  assert.deepStrictEqual(t.map(x => [x.userId, x.why]), [['1', 'bet'], ['4', 'watch'], ['5', 'fav']]);
  assert.strictEqual(t[0].open.id, 'g1');
});

test('el texto dice cuánto ha cambiado y por qué te avisa', () => {
  const x = moveText(match, 'Winamax', { move: drop, why: 'bet' });
  assert.strictEqual(x.kind, 'drop');
  assert.match(x.title, /Cae UTAH: 2,10 → 1,85/);
  assert.match(x.body, /Winamax, −12 %\. Tienes una apuesta\./);
  const up = moveText(match, 'Betway', { move: { ...drop, from: 1.85, to: 2.1, change: 0.135 }, why: 'bet' });
  assert.match(up.body, /el mercado va en contra/);
});

test('cupón, preferencias y valor', () => {
  const w = cleanWatch([{ sport: 'basket', a: 'Utah Jazz', b: 'LA Clippers', key: 'moneyline|0||', out: 'a', id: 'g1', date: '2026-11-18T03:30:00Z' }, { sport: 'golf', a: 'x', b: 'y', key: 'k', out: 'a' }, { a: '', b: 'y' }]);
  assert.strictEqual(w.length, 1);
  assert.deepStrictEqual(cleanPrefs({ drop: false }), { drop: false, rise: true, value: true });
  assert.ok(isValue({ ev: 0.05, rel: { score: 60 }, price: 2 }, 'tennis'));
  assert.ok(!isValue({ ev: 0.05, rel: 60, price: 2 }, 'basket')); // en baloncesto, sólo las fuertes
  assert.ok(isValue({ ev: 0.09, rel: 70, price: 2 }, 'basket'));
});

test('suscripciones: sólo servicios de push de los navegadores', () => {
  const keys = { p256dh: 'B'.repeat(80), auth: 'a'.repeat(22) };
  assert.ok(cleanSub({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys }));
  assert.ok(cleanSub({ endpoint: 'https://web.push.apple.com/QWERTY123456', keys }));
  assert.strictEqual(cleanSub({ endpoint: 'https://bets:4003/internal/settings', keys }), null);
  assert.strictEqual(cleanSub({ endpoint: 'http://fcm.googleapis.com/fcm/send/abc', keys }), null);
  assert.strictEqual(cleanSub({ endpoint: 'https://fcm.googleapis.com.evil.com/x123456789', keys }), null);
});
