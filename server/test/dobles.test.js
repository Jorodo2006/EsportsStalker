// Los dobles de tenis (server/services/tennis/doubles.js): parejas de ESPN con la forma de un jugador y el super tie-break. Datos
// inventados con la forma de los de verdad (marcador de las ATP Finals de noviembre de 2026). Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { espnDoubles, fixMtb, pairOf } = require('../services/tennis/doubles');

const fmt = { roundEs: r => (r === 'Semifinal' ? 'Semifinales' : r), statusEs: s => s };
const athlete = (name, short, country) => ({ displayName: name, shortName: short, flag: { href: `https://x/${country}.png`, alt: country } });
const side = (id, order, players, lines, winner, seed) => ({
  id, order, type: 'team', winner, curatedRank: seed ? { current: seed } : undefined,
  roster: { displayName: players.map(p => p.displayName).join(' / '), athletes: players }, linescores: lines
});
const board = {
  events: [{
    id: '7', name: 'Nitto ATP Finals', major: false,
    groupings: [
      { grouping: { slug: 'mens-singles' }, competitions: [{ id: '1', competitors: [{ id: '9' }, { id: '8' }] }] },
      {
        grouping: { slug: 'mens-doubles' },
        competitions: [
          {
            id: '187515', date: '2026-11-19T13:00Z', round: { displayName: 'Semifinal' }, status: { type: { state: 'post', detail: 'Final' } },
            competitors: [
              side('11', 1, [athlete('Marcelo Arevalo', 'M. Arevalo', 'El Salvador'), athlete('Mate Pavic', 'M. Pavic', 'Croatia')],
                [{ value: 6, tiebreak: 5 }, { value: 6, winner: true }, { value: 1, tiebreak: 10, winner: true }], true, 1),
              side('12', 2, [athlete('Orlando Luz', 'O. Luz', 'Brazil'), athlete('Rafael Matos', 'R. Matos', 'Brazil')],
                [{ value: 7, tiebreak: 7, winner: true }, { value: 3 }, { value: 0, tiebreak: 4 }], false)
            ]
          },
          // Una pareja aún por saber: no sale
          { id: '187530', date: '2026-11-22T13:00Z', status: { type: { state: 'pre' } }, competitors: [side('13', 1, [], [], false), side('14', 2, [athlete('A B', 'A. B', 'X'), athlete('C D', 'C. D', 'Y')], [], false)] }
        ]
      }
    ]
  }]
};

test('dobles de ESPN: cada pareja con la forma de un jugador, sin los individuales ni las parejas por saber', () => {
  const list = espnDoubles([board], 'atp', fmt);
  assert.equal(list.length, 1);
  const m = list[0];
  assert.equal(m.id, 'dbl:atp:187515');
  assert.equal(m.doubles, true);
  assert.equal(m.round, 'Semifinales');
  assert.equal(m.a.name, 'Marcelo Arevalo / Mate Pavic');
  assert.equal(m.a.short, 'Arevalo / Pavic');
  assert.equal(m.a.seed, 1);
  assert.equal(m.a.winner, true);
  assert.deepEqual(m.a.players.map(p => p.name), ['Marcelo Arevalo', 'Mate Pavic']);
  assert.ok(m.a.alt.includes('Pavic / Arevalo'), 'la pareja también al revés');
  assert.ok(m.a.alt.length <= 4, 'newJob guarda 4 como mucho');
  // ESPN ya da el super tie-break como un set 1-0: se queda igual y se marca
  assert.equal(m.mtb, true);
  assert.deepEqual(m.a.sets, [6, 6, 1]);
  assert.deepEqual(m.a.tiebreaks, [5, null, 10]);
  assert.deepEqual(m.b.sets, [7, 3, 0]);
});

test('super tie-break de LiveScore (10-7 en el tercer set): pasa a 1-0 con los puntos, como ESPN', () => {
  const p = (sets, setWins) => ({ sets, setWins, tiebreaks: sets.map(() => null) });
  const [a, b] = fixMtb(p([4, 7, 10], [false, true, false]), p([6, 6, 7], [true, false, false]));
  assert.deepEqual(a.sets, [4, 7, 1]);
  assert.deepEqual(a.setWins, [false, true, true]);
  assert.deepEqual(a.tiebreaks, [null, null, 10]);
  assert.deepEqual(b.sets, [6, 6, 0]);
  assert.deepEqual(b.tiebreaks, [null, null, 7]);
  // Un tercer set normal (o un super tie-break que va 5-3) no se toca
  const [c] = fixMtb(p([6, 3, 5], [true, false, false]), p([4, 6, 3], [false, true, false]));
  assert.deepEqual(c.sets, [6, 3, 5]);
  // Retirada a mitad del super tie-break (8-6): nadie gana ese set
  const [d, e] = fixMtb(p([6, 3, 8], [true, false, false]), p([4, 6, 6], [false, true, false]));
  assert.deepEqual([d.setWins[2], e.setWins[2], d.sets[2], e.sets[2]], [false, false, 0, 0]);
});

test('pareja de un solo apellido y de apellidos compuestos', () => {
  const x = pairOf('dbl:1', [{ name: 'Benjamin Winter Lopez' }, { name: 'Tiago Pereira' }]);
  assert.equal(x.short, 'Winter Lopez / Pereira');
  assert.equal(x.players[0].short, 'B. Winter Lopez');
});
