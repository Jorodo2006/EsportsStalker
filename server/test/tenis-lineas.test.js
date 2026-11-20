// Las líneas del perfil del tenista (pestaña Líneas de su ficha): su partido a partido (tml.gamelogOf), lo que espera el modelo de su
// próximo partido (picks.playerLines) y que las recomendaciones no cambian al compartir el cálculo del partido. Con un circuito y
// unas cuotas falsos (fixtures/tenis-falso.js) y la fecha fija: sin red ni base de datos (npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada';
const tml = require('../services/tennis/tml');
const client = require('../shared/client');
const F = require('./fixtures/tenis-falso');
const { picksFor, playerLines } = require('../services/tennis/picks');

const NOW = Date.UTC(2026, 10, 20, 12);
const data = F.dataset();
const round = v => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x)));

// Con el circuito y las cuotas falsos, y el reloj parado: lo que se calcula depende de la fecha (lo reciente pesa más)
async function fake(fn, { odds = true } = {}) {
  const keep = { now: Date.now, dataset: tml.dataset, edition: tml.tournamentEdition, call: client.call };
  Date.now = () => NOW;
  tml.dataset = async () => data;
  tml.tournamentEdition = async () => ({ surface: 'Hard', indoor: 'O' });
  client.call = async () => (odds ? F.odds(NOW - 3600e3) : { markets: [], sources: {} });
  try { return await fn(); } finally { Date.now = keep.now; tml.dataset = keep.dataset; tml.tournamentEdition = keep.edition; client.call = keep.call; }
}

test('recomendaciones: dan lo mismo que antes de separar el cálculo del partido (matchContext)', async () => {
  const want = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tenis-picks-antes.json'), 'utf8'));
  const got = round(await fake(() => picksFor(F.MATCH)));
  assert.deepEqual(got, want);
});

test('playerLines: escaleras que bajan al subir la línea, y sus recomendaciones son las del partido', async () => {
  const all = await fake(() => picksFor(F.MATCH));
  const r = await fake(() => playerLines(F.MATCH, 'a'));
  assert.equal(r.withOdds, true);
  assert.equal(r.pWin, all.summary.pFinal, 'la misma probabilidad de ganar que las recomendaciones');
  for (const [k, list] of Object.entries(r.ladders)) {
    for (let i = 1; i < list.length; i++) {
      // Más de una línea más alta es menos probable; el hándicap va al revés (con más juegos de ventaja, más fácil)
      if (k === 'spread') assert.ok(list[i].p >= list[i - 1].p - 1e-12, `${k} ${list[i].line}`);
      else assert.ok(list[i].p <= list[i - 1].p + 1e-12, `${k} ${list[i].line}`);
    }
  }
  // Los aces esperados son la suma de la escalera (P(más de 0,5) + P(más de 1,5) + …): lo que pasa de 25 es despreciable
  const sum = r.ladders.aces.reduce((t, x) => t + x.p, 0);
  assert.ok(Math.abs(sum - r.expected.aces) < 0.05, `${sum} frente a ${r.expected.aces}`);
  // Sólo lo suyo (sus juegos por los dos lados, sus aces, ganar, hándicap, un set) y los totales del partido
  const fams = new Set(r.picks.map(p => p.family));
  assert.ok(fams.has('Juegos de Carlos Alpha') && fams.has('Total de juegos') && fams.has('Aces de Carlos Alpha'));
  assert.ok(!fams.has('Juegos de Jannik Beta'));
  assert.ok(r.picks.every(p => p.who === 'a' || p.who == null), 'nada del otro jugador');
  assert.deepEqual(r.picks.filter(p => p.family === 'Juegos de Carlos Alpha').map(p => p.id).sort(), ['team_total|0|a|12.5#over', 'team_total|0|a|12.5#under']);
  // Las mismas cifras que en sus recomendaciones
  for (const p of r.picks) assert.equal(p.p, all.picks.find(x => x.id === p.id).p, p.id);
});

test('playerLines: sin cuotas, lo esperado con el modelo solo y ninguna recomendación', async () => {
  const r = await fake(() => playerLines(F.MATCH, 'b'), { odds: false });
  assert.equal(r.withOdds, false);
  assert.deepEqual(r.picks, []);
  assert.equal(r.oddsAge, null);
  assert.ok(r.pWin > 0.3 && r.pWin < 0.7);
  assert.ok(r.expected.games > 8 && r.expected.games < 14, String(r.expected.games));
  assert.equal(r.ladders.sets.length, 2, 'a tres sets: más de 0,5 y de 1,5');
});

test('gamelogOf: juegos, sets y tie-breaks desde su lado, sin W.O., con la retirada y sin estadísticas si no las hay', () => {
  const row = (o) => ({
    tourney_id: '2026-1', tourney_name: 'Prueba', surface: 'Clay', indoor: 'O', tourney_level: 'A', tourney_date: '20260504', match_num: '1', round: 'R32', minutes: '95',
    winner_name: 'Ana Uno', winner_rank: '12', loser_name: 'Bea Dos', loser_rank: '40', score: '6-4 7-6(5)',
    w_ace: '5', w_df: '2', w_svpt: '60', w_1stIn: '40', w_1stWon: '30', w_2ndWon: '10', w_SvGms: '10', w_bpSaved: '2', w_bpFaced: '3',
    l_ace: '3', l_df: '4', l_svpt: '65', l_1stIn: '41', l_1stWon: '26', l_2ndWon: '11', l_SvGms: '10', l_bpSaved: '4', l_bpFaced: '7', ...o
  });
  const rows = [
    row({}),
    row({ match_num: '2', round: 'QF', winner_name: 'Cris Tres', loser_name: 'Bea Dos', winner_rank: '5', score: '3-6 6-3 2-1 RET', w_svpt: '', l_svpt: '' }),
    row({ match_num: '3', round: 'SF', tourney_date: '20260511', winner_name: 'Bea Dos', loser_name: 'Dani Cuatro', score: 'W/O' }),
    row({ tourney_id: '2026-2', match_num: '4', tourney_date: '20260601', tourney_level: 'G', winner_name: 'Bea Dos', loser_name: 'Eva Cinco', loser_rank: '', score: '6-7(3) 6-4 7-5' })
  ];
  const byName = new Map([['bea dos', rows]]);
  const log = tml.gamelogOf({ byName }, 'bea dos', 'atp');
  assert.equal(log.length, 3, 'el W.O. no se jugó');
  const [gs, ret, lost] = [log[0], log[1], log[2]];
  assert.equal(gs.tournament, 'Prueba'); assert.equal(gs.date, '2026-06-01'); assert.equal(gs.bestOf, 5, 'Grand Slam de la ATP');
  assert.deepEqual([gs.win, gs.gamesWon, gs.gamesLost, gs.setsWon, gs.setsLost, gs.tbWon, gs.tbLost], [true, 19, 16, 2, 1, 0, 1]);
  assert.equal(gs.oppRank, null);
  // Mismo torneo y semana: primero la ronda más avanzada
  assert.equal(ret.round, 'QF'); assert.equal(ret.retired, true);
  // 3-6 6-3 2-1 RET va desde la ganadora: Bea hizo 6 + 3 + 1 juegos y cedió 3 + 6 + 2; el tercer set, a medias, no cuenta como set
  assert.deepEqual([ret.win, ret.gamesWon, ret.gamesLost, ret.setsWon, ret.setsLost], [false, 10, 11, 1, 1]);
  assert.equal(ret.aces, null, 'sin estadísticas de saque');
  assert.equal(ret.oppRank, 5);
  // Perdió 6-4 7-6(5): sus aces, dobles faltas y breaks son los del perdedor
  assert.deepEqual([lost.win, lost.gamesWon, lost.gamesLost, lost.tbLost], [false, 10, 13, 1]);
  assert.deepEqual([lost.aces, lost.df, lost.oppAces, lost.bpFaced, lost.breaks], [3, 4, 5, 7, 1]);
  assert.equal(lost.opp, 'Ana Uno'); assert.equal(lost.oppRank, 12); assert.equal(lost.bestOf, 3);
});
