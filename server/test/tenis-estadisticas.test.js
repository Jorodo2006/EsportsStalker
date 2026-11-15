// Estadísticas de un partido de tenis (matchstats.js): cómo se traducen los campos de la web de la WTA y de TennisMyLife.
// Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada';
const { wtaSide, tmlSide } = require('../services/tennis/matchstats');

// Kostyuk - Noskova, WTA Finals 2026 (6-2 6-4 para Noskova), total del partido tal y como lo da la web de la WTA
const wta = {
  setnum: 0, acesa: 6, acesb: 2, dblflta: 6, dblfltb: 4, ptswon1stserva: 14, ptswon1stservb: 26, ptsplayed1stserva: 20, ptsplayed1stservb: 38,
  ptstotwonserva: 29, ptstotwonservb: 41, totservplayeda: 53, totservplayedb: 65, breakptsconva: 1, breakptsconvb: 4,
  breakptsplayeda: 4, breakptsplayedb: 4, servgamesplayeda: 9, servgamesplayedb: 9, totptswona: 53, totptswonb: 65
};

test('web de la WTA: saque, resto y bolas de break de cada una', () => {
  const a = wtaSide(wta, 'a'), b = wtaSide(wta, 'b');
  assert.equal(a.aces, 6);
  assert.equal(a.firstIn, 20);
  assert.equal(a.secondWon, 29 - 14); // puntos ganados al saque menos los del primero
  assert.equal(a.bpConv, 1);
  assert.equal(a.bpFaced, 4); // las que tuvo la rival
  assert.equal(a.bpSaved, 0); // la rival convirtió las 4
  assert.equal(b.bpSaved, 3); // Kostyuk sólo convirtió 1 de 4
  assert.equal(b.totalPts, 65);
});

test('TennisMyLife: ganador y perdedor, y las bolas de break convertidas salen de las del rival', () => {
  const r = { w_ace: '7', w_df: '2', w_svpt: '60', w_1stIn: '40', w_1stWon: '30', w_2ndWon: '12', w_SvGms: '10', w_bpSaved: '3', w_bpFaced: '4',
    l_ace: '3', l_df: '5', l_svpt: '70', l_1stIn: '42', l_1stWon: '28', l_2ndWon: '11', l_SvGms: '10', l_bpSaved: '2', l_bpFaced: '6' };
  const w = tmlSide(r, true), l = tmlSide(r, false);
  assert.equal(w.aces, 7);
  assert.equal(w.bpConv, 4); // el perdedor afrontó 6 y salvó 2
  assert.equal(w.bpChances, 6);
  assert.equal(l.bpConv, 1);
  assert.equal(l.firstIn, 42);
  assert.equal(w.totalPts, null); // TennisMyLife no lo da
});
