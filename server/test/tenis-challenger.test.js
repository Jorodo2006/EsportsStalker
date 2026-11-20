// Fichas y estadísticas de los jugadores de los Challenger (no están en ESPN): salen de TennisMyLife (tml.js), con su nombre como id.
// Sin red ni base de datos (npm test)
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada';
const tml = require('../services/tennis/tml');
const { countryOf } = require('../services/tennis/flags');

const row = o => ({
  tourney_id: '2026-2817', tourney_name: 'NSW Open', surface: 'Hard', indoor: 'O', tourney_level: 'C', tourney_date: '20261116', match_num: '1', round: 'R32', minutes: '154', best_of: '3',
  winner_name: 'Christian Langmo', winner_rank: '396', winner_rank_points: '127', winner_ioc: 'USA', winner_hand: 'R', winner_ht: '191', winner_age: '30.459',
  loser_name: 'Dane Sweeny', loser_rank: '122', loser_rank_points: '493', loser_ioc: 'AUS', loser_hand: 'R', loser_ht: '170', loser_age: '25.758',
  score: '4-6 7-6(5) 7-5', w_ace: '7', w_df: '4', w_svpt: '103', w_1stIn: '66', w_1stWon: '51', w_2ndWon: '21', w_SvGms: '17', w_bpSaved: '3', w_bpFaced: '5',
  l_ace: '3', l_df: '5', l_svpt: '122', l_1stIn: '92', l_1stWon: '63', l_2ndWon: '14', l_SvGms: '17', l_bpSaved: '6', l_bpFaced: '8', ...o
});

test('ficha de un jugador de Challenger: país, mano, altura y ranking de su último partido, y sus resultados desde su lado', async () => {
  const rows = [
    row({}),
    row({ match_num: '9', round: 'QF', winner_name: 'Li Tu', winner_ioc: 'AUS', winner_rank: '200', loser_name: 'Christian Langmo', loser_ioc: 'USA', loser_rank: '390', loser_rank_points: '130', loser_age: '30.46', loser_hand: 'R', loser_ht: '191', score: '6-3 7-6(4)' }),
    row({ tourney_id: '2026-2700', tourney_name: 'Champaign', tourney_date: '20261109', round: 'F', loser_name: 'Pedro Prueba', score: '6-4 6-4' })
  ];
  const byName = new Map();
  for (const m of rows) for (const n of [m.winner_name, m.loser_name]) { const k = tml.norm(n); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(m); }
  const p = await tml.challengerProfile('Christian Langmo', { rows, byName });
  assert.equal(p.tour, 'challenger');
  assert.equal(p.name, 'Christian Langmo');
  assert.equal(p.country, 'USA');
  assert.match(p.flag, /\/usa\.png$/);
  assert.equal(p.hand, 'Diestro');
  assert.equal(p.height, '1.91 m');
  assert.equal(p.rank, 390, 'el de su partido más reciente (la ronda más avanzada de la última semana)');
  assert.ok(p.age >= 30);
  assert.deepEqual([p.season.won, p.season.lost, p.season.titles], [2, 1, 1], 'ganó la final de Champaign');
  const [qf, r32, final] = p.matches;
  assert.equal(qf.round, 'Cuartos de final');
  assert.equal(qf.win, false);
  assert.equal(qf.score, '3-6 6-7(4)', 'el marcador desde su lado');
  assert.equal(qf.opponent.name, 'Li Tu');
  assert.match(qf.opponent.flag, /\/aus\.png$/);
  assert.equal(r32.score, '4-6 7-6(5) 7-5');
  assert.equal(final.round, 'Final');
  assert.equal(await tml.challengerProfile('Nadie Conocido', { rows, byName }), null);
});

test('marcador al revés y países del COI', () => {
  assert.equal(tml.flipScore('6-4 7-6(5) 2-1 RET'), '4-6 6-7(5) 1-2 RET');
  assert.equal(countryOf('GER'), 'Germany');
  assert.equal(countryOf('TPE'), 'Chinese Taipei');
  assert.equal(countryOf('XYZ'), 'XYZ');
});
