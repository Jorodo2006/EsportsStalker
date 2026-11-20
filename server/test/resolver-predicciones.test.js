// El resolvedor de recomendaciones (predictions.settle): las que no se pueden resolver todavía no deben tapar a las demás. Antes
// cogía siempre las 800 pendientes más antiguas y, si no tenían resultado, eran las mismas en cada pasada durante 4 días.
// Sin base de datos: se sustituye shared/db por una que apunta las consultas. npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const calls = [];
let pending = [];
const dbPath = path.join(__dirname, '../shared/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' '), params });
    return { rows: /^\s*SELECT id, sport/.test(sql) ? pending : [] };
  }
} };
const { settle } = require('../services/bets/predictions');

const H = 3600e3;
const row = (id, hoursAgo, match) => ({ id, sport: 'basket', match, key: 'total|0||220.5', out: 'over', start: new Date(Date.now() - hoursAgo * H), event: 'A @ B' });

test('pide primero las nunca intentadas y deja descansar 30 min las que ya se intentaron', async () => {
  calls.length = 0; pending = [];
  await settle(async () => null, () => null, () => '2026-11-19');
  assert.match(calls[0].sql, /tried_at IS NULL OR tried_at < now\(\) - interval '30 minutes'/);
  assert.match(calls[0].sql, /ORDER BY tried_at NULLS FIRST, start/);
});

test('resuelve las que tienen resultado, apunta el intento de las demás y da por perdidas las de más de 4 días', async () => {
  calls.length = 0;
  pending = [row(1, 5, 'g1'), row(2, 5, 'g2'), row(3, 5 * 24, 'g3')];
  // g1 tiene resultado; g2 todavía no; g3 lleva 5 días sin él
  const resultOf = async ref => (ref.match === 'g1' ? { total: 230 } : null);
  const evaluate = (ref, R) => (R ? { status: 'won', text: 'Total 230' } : null);
  const n = await settle(resultOf, evaluate, () => '2026-11-19');
  assert.equal(n, 1);
  const won = calls.find(c => /SET status = \$2/.test(c.sql));
  assert.deepEqual(won.params, [1, 'won', 'Total 230']);
  const lost = calls.find(c => /SET status = 'unknown'/.test(c.sql));
  assert.deepEqual(lost.params, [3]);
  const tried = calls.find(c => /SET tried_at = now\(\)/.test(c.sql));
  assert.deepEqual(tried.params, [[2]]);
});
