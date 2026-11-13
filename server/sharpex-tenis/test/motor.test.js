import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCsv, toCsv, PlayerIndex, parseName, EloModel, expected, fairProbs, edge, kelly, clv, overround,
  evaluate, scan, normalizeOddsInput, Ledger, generate, fromSackmann, normalizeSurface, mergeSources,
  GENESIS, chainEntry, pickData, closeData, settleData, verifyChain, pickOf, statsOf, venueKey, venueSurfaces, surfaceOf, matcher,
} from '../src/index.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('CSV ida y vuelta con comas y comillas', () => {
  const rows = [{ a: 'x, y', b: 'dice "hola"', c: '3' }];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('nombres: formatos de casas de apuestas', () => {
  assert.deepEqual(parseName('Nadal R.').surname, ['nadal']);
  assert.equal(parseName('Nadal R.').initial, 'r');
  assert.equal(parseName('R. Nadal').initial, 'r');
  assert.deepEqual(parseName('Nadal, Rafael').surname, ['nadal']);
  assert.deepEqual(parseName('Juan Martin del Potro').surname, ['del', 'potro']);
  const idx = new PlayerIndex([
    { id: 1, name: 'Rafael Nadal' },
    { id: 2, name: 'Juan Martin del Potro' },
    { id: 3, name: 'Pablo Carreño Busta' },
    { id: 4, name: 'Marco Garcia' },
    { id: 5, name: 'Max Garcia' },
  ]);
  assert.equal(idx.find('Nadal R.').id, 1);
  assert.equal(idx.find('rafael nadal').confidence, 'exact');
  assert.equal(idx.find('Del Potro J.').id, 2);
  assert.equal(idx.find('Carreno Busta P.').id, 3);
  assert.equal(idx.find('Busta P.').id, 3); // apellido compuesto, solo la última parte
  assert.equal(idx.find('Garcia M.'), null, 'ambiguo: mejor no emparejar');
  assert.equal(idx.find('Marco Garcia').id, 4);
  assert.equal(idx.find('Desconocido X.'), null);
});

test('superficies en español e inglés', () => {
  assert.equal(normalizeSurface('Tierra batida'), 'Clay');
  assert.equal(normalizeSurface('Hard'), 'Hard');
  assert.equal(normalizeSurface('césped'), 'Grass');
});

test('cuotas: margen, probabilidades justas, valor y Kelly', () => {
  close(overround(1.9, 1.9), 2 / 1.9 - 1);
  const [a, b] = fairProbs(1.9, 1.9);
  close(a, 0.5); close(b, 0.5);
  const [f1, f2] = fairProbs(1.5, 2.6);
  close(f1 + f2, 1, 1e-9);
  assert.ok(f1 > 1 / 2.6 && f1 < 1 / 1.5);
  const [m1] = fairProbs(1.5, 2.6, 'multiplicative');
  assert.ok(f1 > m1, 'el método potencia carga más margen en el no favorito');
  close(edge(0.55, 2.0), 0.1);
  assert.equal(kelly(0.4, 2.0), 0, 'sin valor, sin stake');
  close(kelly(0.55, 2.0, { fraction: 1, cap: 1 }), 0.1);
  close(kelly(0.55, 2.0), 0.025);
  close(kelly(0.9, 2.0), 0.03, 1e-9); // tope
  close(clv(2.2, 2.0).clvOdds, 0.1);
});

test('Elo: el ganador sube, el perdedor baja, y predice simétrico', () => {
  const m = new EloModel();
  m.update({ date: '2025-01-01', surface: 'Clay', winnerId: 'a', winnerName: 'A', loserId: 'b', loserName: 'B' });
  const pa = m.predict('a', 'b', 'Clay').pA;
  const pb = m.predict('b', 'a', 'Clay').pA;
  assert.ok(pa > 0.5);
  close(pa + pb, 1);
  close(expected(1600, 1400), 1 / (1 + 10 ** (-200 / 400)));
  const r = EloModel.fromJSON(JSON.parse(JSON.stringify(m)));
  close(r.predict('a', 'b', 'Clay').pA, pa);
});

test('Elo aprende de datos simulados y queda bien calibrado', () => {
  const { matches } = generate({ years: 3, seed: 11 });
  // En el mundo simulado la superficie pesa lo que diga synthetic.js, no lo que pesa en los Challengers reales
  // (de ahí salen surfaceWeight y confidence por defecto): aquí se prueba que el Elo aprende, con lo que se escribió
  const { metrics } = evaluate(matches, { testFrom: '2025-01-01', modelOptions: { surfaceWeight: 0.5, confidence: 1 } });
  assert.ok(metrics.n > 1000);
  assert.ok(metrics.accuracy > 0.65, `acierto ${metrics.accuracy}`);
  for (const c of metrics.calibration.filter((x) => x.n > 150)) {
    assert.ok(Math.abs(c.predicted - c.actual) < 0.07, `tramo ${c.range}: dice ${c.predicted} real ${c.actual}`);
  }
});

test('Sackmann: filtra Challengers y descarta walkovers', () => {
  const base = { tourney_name: 'Biella', surface: 'Clay', tourney_date: '20250310', match_num: '1', round: 'R32', winner_id: '1', winner_name: 'A B', loser_id: '2', loser_name: 'C D' };
  assert.equal(fromSackmann({ ...base, tourney_level: 'A', score: '6-1 6-1' }), null);
  assert.equal(fromSackmann({ ...base, tourney_level: 'C', score: '6-1 6-1' }).date, '2025-03-10');
  assert.equal(fromSackmann({ ...base, tourney_level: 'C', score: 'W/O' }).completed, false);
  assert.equal(fromSackmann({ ...base, tourney_level: 'C', score: '6-1 2-0 RET' }).completed, true);
});

test('TennisMyLife: empareja jugadores con Sackmann y no cuenta dos veces el mismo partido', () => {
  const base = { tourney_level: 'C', surface: 'Clay', round: 'R32', score: '6-4 6-4', match_num: '1' };
  const sk = [{
    ...base, tourney_id: '2026-1', tourney_name: 'Biella', tourney_date: '20260105',
    winner_id: '1', winner_name: 'Ana Uno', winner_ioc: 'ESP', loser_id: '2', loser_name: 'San Hui Shin', loser_ioc: 'KOR',
  }];
  const tml = [
    // El mismo partido, con otra fecha y el nombre escrito distinto
    { ...base, tourney_id: '2026-1', tourney_name: 'Biella', tourney_date: '20260104',
      winner_id: 'A1', winner_name: 'Ana Uno', winner_ioc: 'ESP', loser_id: 'B2', loser_name: 'Sanhui Shin', loser_ioc: 'KOR' },
    // Uno de junio, en un ATP 250 (nivel propio de TennisMyLife), contra alguien que Sackmann no tiene
    { ...base, tourney_level: '250', tourney_id: '2026-9', tourney_name: 'Halle', tourney_date: '20260615',
      winner_id: 'B2', winner_name: 'Sanhui Shin', winner_ioc: 'KOR', loser_id: 'C3', loser_name: 'Nuevo Tres', loser_ioc: 'FRA' },
  ];
  const all = [
    ...sk.map((r) => fromSackmann(r, { levels: null })),
    ...tml.map((r) => fromSackmann(r, { levels: null, source: 'tml' })),
  ];
  const { matches, linked, unlinked } = mergeSources(all);
  assert.equal(matches.length, 2, 'el partido repetido cuenta una vez');
  const june = matches.find((m) => m.tourney === 'Halle');
  assert.equal(june.level, 'A');
  assert.equal(june.winnerId, 'sk:2', 'Shin es el mismo aunque se escriba distinto');
  assert.equal(june.loserId, 'tml:C3', 'el que no está en Sackmann entra como nuevo');
  assert.equal(linked, 2);
  assert.equal(unlinked, 1);
});

test('superficie por la ciudad del torneo, con los nombres de cada fuente', () => {
  assert.equal(venueKey('Lima, Peru'), 'lima');
  assert.equal(venueKey('Brisbane 3'), 'brisbane');
  assert.equal(venueKey('Lima 2 CH'), 'lima');
  assert.equal(venueKey('São Paulo Challenger 2025'), 'sao paulo');
  const m = (tourney, surface, date) => ({ level: 'C', tourney, surface, date });
  const venues = venueSurfaces([
    m('Lima 2 CH', 'Clay', '2025-10-27'),
    m('Kia Open Cali', 'Clay', '2026-06-01'),
    m('Orleans', 'Clay', '2018-09-24'), m('Orleans', 'Hard', '2025-09-22'), // cambió de superficie: vale la última
    { level: 'A', tourney: 'Brisbane', surface: 'Grass', date: '2026-01-01' }, // sólo cuentan los Challenger
  ]);
  assert.deepEqual(surfaceOf(venues, 'Lima, Peru'), { surface: 'Clay', known: true });
  assert.deepEqual(surfaceOf(venues, 'Cali, Colombia'), { surface: 'Clay', known: true }, 'la ciudad dentro del nombre del patrocinador');
  assert.deepEqual(surfaceOf(venues, 'Orleans, France'), { surface: 'Hard', known: true });
  assert.deepEqual(surfaceOf(venues, 'Brisbane 3'), { surface: 'Hard', known: false });
  assert.deepEqual(surfaceOf(venues, 'Calimera, Italy'), { surface: 'Hard', known: false }, 'Cali no está dentro de Calimera');
  // El modelo guarda la tabla y la recupera
  const model = new EloModel();
  model.venues = venues;
  assert.deepEqual(EloModel.fromJSON(JSON.parse(JSON.stringify(model))).venues, venues);
  // matcher: el mismo emparejador que el escáner
  model.update({ date: '2026-05-01', surface: 'Clay', winnerId: 'v', winnerName: 'Juan Pablo Varillas', loserId: 'o', loserName: 'Genaro Alberto Olivieri' });
  const find = matcher(model);
  assert.equal(find('Varillas J.').id, 'v');
  assert.equal(find('Juan Pablo Varillas').id, 'v');
  assert.equal(find('Nadie N.'), null);
});

test('escáner: encuentra valor cuando la casa se equivoca y descarta lo dudoso', () => {
  const m = new EloModel({ minMatches: 1 });
  for (let i = 0; i < 20; i++) {
    m.update({ date: '2025-01-01', surface: 'Hard', winnerId: 'f', winnerName: 'Fuerte Uno', loserId: 'd', loserName: 'Debil Dos' });
  }
  const rows = normalizeOddsInput({
    type: 'TENNIS_EDGE_ODDS', market: 'winner', surface: 'Hard',
    entries: [
      { p1: 'Uno F.', p2: 'Dos D.', o1: 2.5, o2: 1.55 }, // la casa da como no favorito al fuerte: valor
      { p1: 'Uno F.', p2: 'Nadie N.', o1: 1.5, o2: 2.6 }, // jugador desconocido
    ],
  });
  const { opportunities, skipped } = scan(m, rows);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].pick, 'Fuerte Uno');
  assert.ok(opportunities[0].edge > 0.03);
  assert.equal(skipped.length, 1);
  assert.throws(() => normalizeOddsInput({ market: 'aces', entries: [] }), /no soportado/);
  const csv = normalizeOddsInput('p1,p2,o1,o2,surface\nUno F.,Dos D.,"2,5",1.55,Hard');
  assert.equal(csv[0].o1, 2.5);
});

test('escáner: un retirado no vuelve ambiguo el nombre de uno que juega', () => {
  const m = new EloModel({ minMatches: 1 });
  const play = (date, w, wn, l, ln) => m.update({ date, surface: 'Hard', winnerId: w, winnerName: wn, loserId: l, loserName: ln });
  play('2015-05-01', 'viejo', 'Mario Garcia', 'otro', 'Otro Antiguo');
  for (let i = 0; i < 5; i++) play('2026-05-01', 'nuevo', 'Marco Garcia', 'rival', 'Rival Actual');
  const rows = normalizeOddsInput({ entries: [{ p1: 'Garcia M.', p2: 'Actual R.', o1: 1.5, o2: 2.6, surface: 'Hard' }] });
  assert.equal(scan(m, rows).skipped.length, 0);
  assert.match(scan(m, rows, { activeDays: 0 }).skipped[0].reason, /ambiguo: Garcia M\./);
  // Un alias encuentra también a los que no han jugado últimamente
  const old = normalizeOddsInput({ entries: [{ p1: 'Garcia Mario', p2: 'Actual R.', o1: 1.5, o2: 2.6, surface: 'Hard' }] });
  assert.equal(scan(m, old).skipped.length, 1);
  assert.equal(scan(m, old, { aliases: { 'Garcia Mario': 'Mario Garcia' } }).skipped.length, 0);
});

test('historial guardado fuera (como en PostgreSQL): la cadena aguanta ida y vuelta por JSON y delata retoques', () => {
  // El servicio guarda cada registro como texto y lo vuelve a leer: el hash tiene que seguir cuadrando
  const rows = [];
  const add = (type, data) => {
    const prev = rows.length ? JSON.parse(rows[rows.length - 1]).hash : GENESIS;
    rows.push(JSON.stringify(chainEntry(prev, type, data)));
  };
  add('pick', pickData({ id: 'p1', match: 'A vs B', pick: 'A', odds: 2.1, modelProb: 0.55, edge: 0.155, stake: 0.0137 }));
  add('close', closeData('p1', 1.9, 2.0));
  add('settle', settleData('p1', 'won'));
  const back = rows.map((r) => JSON.parse(r));
  assert.equal(verifyChain(back).ok, true);
  assert.equal(pickOf(back, 'p1').result, 'won');
  assert.ok(pickOf(back, 'p1').clv.clvOdds > 0);
  assert.equal(statsOf(back).picks, 1);
  assert.throws(() => pickOf(back, 'otro'), /No existe el pick/);
  assert.throws(() => settleData('p1', 'gano'), /won, lost o void/);
  // Retocar la cuota de un pick viejo rompe la cadena
  const touched = back.map((e, i) => (i === 0 ? { ...e, data: { ...e.data, odds: 2.5 } } : e));
  assert.equal(verifyChain(touched).ok, false);
  assert.equal(verifyChain(touched).brokenAt, 0);
  // Y quitar uno del medio, también
  assert.equal(verifyChain([back[0], back[2]]).ok, false);
});

test('historial: CLV, estadísticas y detección de retoques', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sx-'));
  const path = join(dir, 'picks.jsonl');
  const led = new Ledger(path);
  const p1 = led.addPick({ match: 'A vs B', pick: 'A', odds: 2.2, modelProb: 0.5, edge: 0.1, stake: 0.02 }).data.id;
  const p2 = led.addPick({ match: 'C vs D', pick: 'C', odds: 1.8, modelProb: 0.6, edge: 0.08, stake: 0.01 }).data.id;
  led.close(p1, 2.0, 1.9);
  led.settle(p1, 'won');
  led.settle(p2, 'lost');
  const s = led.stats();
  close(s.profit, 0.02 * 1.2 - 0.01);
  close(s.roi, (0.024 - 0.01) / 0.03);
  close(s.avgClvOdds, 0.1);
  assert.equal(led.verify().ok, true);
  assert.throws(() => led.settle('nope', 'won'));
  // Alguien "mejora" la cuota de un pick antiguo…
  const lines = readFileSync(path, 'utf8').split('\n');
  lines[0] = lines[0].replace('"odds":2.2', '"odds":3.5');
  writeFileSync(path, lines.join('\n'));
  const v = new Ledger(path).verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
});
