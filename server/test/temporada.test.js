// (en los resúmenes de prueba, el Delantero juega siempre en el 1 y el Central en el 2, sean locales o no)
// Estadísticas de la temporada del fútbol (football/season.js): qué se guarda de cada partido y cómo se suma
const test = require('node:test');
const assert = require('node:assert/strict');
const { compactMatch, aggregate } = require('../services/football/season');

const stat = (name, v) => ({ name, displayValue: String(v) });
const st = (name, v) => ({ name, value: v });
const summary = (h, a, hc, ac) => ({
  boxscore: { teams: [
    { team: { id: h, displayName: `Equipo ${h}`, logo: 'https://x/h.png' }, statistics: [stat('wonCorners', hc), stat('totalShots', 10), stat('shotsOnTarget', 4), stat('yellowCards', 2), stat('redCards', 0), stat('foulsCommitted', 12)] },
    { team: { id: a, displayName: `Equipo ${a}`, logo: 'https://x/a.png' }, statistics: [stat('wonCorners', ac), stat('totalShots', 6), stat('shotsOnTarget', 1), stat('yellowCards', 3), stat('redCards', 1), stat('foulsCommitted', 9)] }
  ] },
  rosters: [
    { team: { id: '1' }, roster: [
      { athlete: { id: '7', displayName: 'Delantero' }, starter: true, stats: [st('appearances', 1), st('totalShots', 4), st('shotsOnTarget', 2), st('totalGoals', 1), st('goalAssists', 0), st('foulsCommitted', 1), st('foulsSuffered', 3), st('yellowCards', 0), st('redCards', 0)] },
      { athlete: { id: '8', displayName: 'Suplente sin jugar' }, starter: false, stats: [st('appearances', 0)] }
    ] },
    { team: { id: '2' }, roster: [
      { athlete: { id: '9', displayName: 'Central' }, starter: true, stats: [st('appearances', 1), st('foulsCommitted', 4), st('yellowCards', 1), st('redCards', 1)] }
    ] }
  ]
});

test('de cada partido: los dos equipos y sólo los jugadores que jugaron', () => {
  const m = compactMatch(summary('1', '2', 7, 3));
  assert.equal(m.t.length, 2);
  assert.deepEqual(m.t[0].slice(0, 4), ['1', 'Equipo 1', 'https://x/h.png', 7]);
  assert.deepEqual(m.p.map(x => x[1]), ['Delantero', 'Central']);
});

test('la temporada: córneres a favor y en contra, tarjetas y tiros de cada jugador', () => {
  const r = aggregate([compactMatch(summary('1', '2', 7, 3)), compactMatch(summary('2', '1', 5, 2))]);
  const t1 = r.teams.find(t => t.id === '1');
  assert.equal(t1.games, 2);
  assert.equal(t1.cornersFor, 7 + 2);
  assert.equal(t1.cornersAgainst, 3 + 5);
  assert.equal(t1.yellowAgainst, 3 + 2);
  const del = r.players.find(p => p.name === 'Delantero');
  assert.equal(del.games, 2);
  assert.equal(del.shots, 8);
  assert.equal(del.starts, 2);
  const cen = r.players.find(p => p.name === 'Central');
  assert.equal(cen.yellow, 2);
  assert.equal(cen.red, 2);
});

test('un partido sin los dos equipos no cuenta', () => {
  assert.deepEqual(aggregate([{ t: [['1', 'A', '', 1, 1, 1, 0, 0, 1]], p: [] }]), { teams: [], players: [] });
});
