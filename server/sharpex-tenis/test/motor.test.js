import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCsv, toCsv, PlayerIndex, parseName, EloModel, expected, fairProbs, edge, kelly, clv, overround,
  evaluate, fitWeights, ServeReturn, matchWin, holdProb, scan, normalizeOddsInput, Ledger, generate, fromSackmann, normalizeSurface, mergeSources,
  GENESIS, chainEntry, pickData, closeData, settleData, verifyChain, pickOf, statsOf, venueKey, venueSurfaces, surfaceOf, matcher,
  activity, recordTour, dayNum, homeOf, countryOf, PICKS, VALUE_VISIBLE, blendWithMarket, marketOf, picksOfMatch,
  retirementRisk, RETIRE, RETIRE_RULE, evWithRetirement,
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
  // (de ahí salen surfaceWeight y los pesos por defecto): aquí se prueba que el Elo aprende, con lo que se escribió
  const { metrics } = evaluate(matches, { testFrom: '2025-01-01', modelOptions: { surfaceWeight: 0.5, wElo: 1, wStats: 0, tailSlope: 1 } });
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

// ---------- Saque y resto (src/stats.js) ----------
test('punto a punto: juego, partido y simetría', () => {
  close(holdProb(0.5), 0.5);
  assert.ok(holdProb(0.65) > 0.82 && holdProb(0.65) < 0.84, `hold con 65 % de puntos: ${holdProb(0.65)}`);
  close(matchWin(0.64, 0.64), 0.5);
  close(matchWin(0.66, 0.62) + matchWin(0.62, 0.66), 1);
  assert.ok(matchWin(0.66, 0.62) > 0.5);
  // A cinco sets el mejor gana más a menudo
  assert.ok(matchWin(0.66, 0.62, 5) > matchWin(0.66, 0.62, 3));
});

test('saque y resto: aprende quién saca mejor, con el rival en cuenta, y sin estadísticas se queda en la media', () => {
  const sr = new ServeReturn({}, {});
  const a = {}, b = {}, c = {};
  // A gana el 72 % de sus puntos al saque y B el 60 %, partido tras partido; C nunca trae estadísticas (como un ITF)
  for (let i = 0; i < 40; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i * 7)).toISOString().slice(0, 10);
    sr.update(a, b, 'Hard', date, [80, 58, 80, 48]);
  }
  const day = Date.parse('2025-10-15') / 86400000;
  assert.ok(sr.rates(a, 'Hard', day).sv > sr.rates(b, 'Hard', day).sv);
  assert.ok(sr.predict(a, b, 'Hard', day).p > 0.7);
  close(sr.predict(a, b, 'Hard', day).p + sr.predict(b, a, 'Hard', day).p, 1, 1e-9);
  const rc = sr.rates(c, 'Hard', day);
  close(rc.sv, 0); close(rc.ret, 0);
  sr.update(a, c, 'Hard', '2025-10-20', null); // sin estadísticas no cambia nada
  assert.equal(c.sr, undefined);
});

test('Sackmann: guarda los puntos al saque si los trae, y nada si no (los ITF)', () => {
  const base = { tourney_level: 'C', tourney_name: 'Biella', surface: 'Clay', tourney_date: '20250310', match_num: '1', round: 'R32',
    winner_id: '1', winner_name: 'A B', loser_id: '2', loser_name: 'C D', score: '6-4 6-4' };
  const st = { w_svpt: '60', w_1stWon: '30', w_2ndWon: '12', l_svpt: '58', l_1stWon: '25', l_2ndWon: '9' };
  assert.deepEqual(fromSackmann({ ...base, ...st }).serve, [60, 42, 58, 34]);
  assert.equal(fromSackmann(base).serve, null);
  assert.equal(fromSackmann({ ...base, ...st, w_1stWon: '70' }).serve, null); // más ganados que jugados: error de la fuente
});

test('modelo con saque y resto: el JSON guardado predice lo mismo, y uno de antes predice como antes', () => {
  const m = new EloModel({ wElo: 0.8, wStats: 0.5, tailSlope: 0.7 });
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i * 7)).toISOString().slice(0, 10);
    m.update({ date, surface: 'Hard', winnerId: i % 4 ? 'a' : 'b', winnerName: 'A', loserId: i % 4 ? 'b' : 'a', loserName: 'B', serve: i % 4 ? [70, 50, 70, 40] : [70, 45, 70, 44] });
  }
  const p = m.predict('a', 'b', 'Hard', '2025-08-01');
  assert.ok(p.pStats > 0.5 && p.pA > 0.5);
  const r = EloModel.fromJSON(JSON.parse(JSON.stringify(m)));
  close(r.predict('a', 'b', 'Hard', '2025-08-01').pA, p.pA, 1e-4);
  // Un model.json de antes de las estadísticas: options con confidence y sin wElo
  const old = JSON.parse(JSON.stringify(m));
  old.options = { ...old.options, confidence: 0.91 };
  delete old.options.wElo; delete old.options.wStats; delete old.options.tailSlope; delete old.statsTotals;
  const o = EloModel.fromJSON(old).predict('a', 'b', 'Hard', '2025-08-01');
  close(o.pA, 1 / (1 + ((1 - o.pElo) / o.pElo) ** 0.91));
});

test('ajuste de pesos: con datos simulados da pesos finitos, y sin estadísticas deja su peso a cero', () => {
  const { matches } = generate({ years: 3, seed: 5 });
  const f = fitWeights(matches, { tuneFrom: '2024-01-01', tuneTo: '2025-01-01', stats: false });
  assert.ok(f.n > 500 && Number.isFinite(f.wElo) && f.wElo > 0);
  assert.equal(f.wStats, 0);
  assert.ok(f.tailSlope >= 0.2 && f.tailSlope <= 1.5);
});


// ---------- Actividad y factor local (fase 2, src/form.js) ----------
test('actividad: torneos de las 5 semanas anteriores sin el actual y con tope, y partidos de la semana anterior', () => {
  const ref = dayNum('2026-02-16');
  const p = {};
  recordTour(p, 'T0', dayNum('2026-01-05')); // 6 semanas antes: fuera de la ventana
  recordTour(p, 'T1', dayNum('2026-01-19')); recordTour(p, 'T1', dayNum('2026-01-19'));
  recordTour(p, 'T2', dayNum('2026-01-26'));
  recordTour(p, 'T3', dayNum('2026-02-02'));
  for (let i = 0; i < 4; i++) recordTour(p, 'T4', dayNum('2026-02-09'));
  recordTour(p, 'AHORA', ref); // el torneo del partido: no cuenta
  assert.deepEqual(p.tours.map((t) => t[0]), ['T0', 'T1', 'T2', 'T3', 'T4', 'AHORA']);
  assert.deepEqual(activity(p, ref, 'AHORA'), { weeks5: 4, lastWeek: 4 });
  assert.deepEqual(activity(p, ref), { weeks5: 4, lastWeek: 4 }, 'en directo no se sabe la clave: el de esta semana tampoco cuenta');
  // Cinco torneos en la ventana: tope de 4. Seis partidos la semana anterior: tope de 5
  const q = {};
  for (const [k, d] of [['A', '2026-01-12'], ['B', '2026-01-19'], ['C', '2026-01-26'], ['D', '2026-02-02']]) recordTour(q, k, dayNum(d));
  for (let i = 0; i < 6; i++) recordTour(q, 'E', dayNum('2026-02-09'));
  assert.deepEqual(activity(q, ref), { weeks5: 4, lastWeek: 5 });
  // Sólo jugó hace tres semanas: un torneo y nada la semana anterior
  const r = {};
  recordTour(r, 'X', dayNum('2026-01-26'));
  assert.deepEqual(activity(r, ref), { weeks5: 1, lastWeek: 0 });
  assert.deepEqual(activity({}, ref), { weeks5: 0, lastWeek: 0 });
  // Se guardan los 6 últimos
  for (let i = 0; i < 10; i++) recordTour(r, `Y${i}`, dayNum('2026-03-02') + i * 7);
  assert.equal(r.tours.length, 6);
});

test('país del torneo: por sus invitados, por el nombre de LiveScore, y si no se sabe, nada', () => {
  const m = (tourney, date, winnerEntry, winnerIoc, loserEntry, loserIoc) => ({ level: 'C', tourney, surface: 'Clay', date, winnerEntry, winnerIoc, loserEntry, loserIoc });
  const venues = venueSurfaces([
    m('Biella', '2024-03-04', 'WC', 'ITA', '', 'ESP'),
    m('Biella', '2025-03-03', 'WC', 'ITA', 'WC', 'ITA'),
    m('Biella', '2025-03-03', '', 'ESP', 'WC', 'FRA'), // tres invitados italianos de cuatro
    m('Lima 2 CH', '2025-10-27', 'WC', 'PER', '', 'ARG'), // un invitado no basta
    m('Brest', '2025-10-20', 'WC', 'FRA', 'WC', 'FRA'),
  ]);
  assert.equal(venues.biella.ioc, 'ITA');
  assert.equal(venues.biella.surface, 'Clay');
  assert.equal(venues.lima.ioc, undefined);
  assert.equal(countryOf(venues, 'Biella'), 'ITA');
  assert.equal(countryOf(venues, 'Lima, Peru'), 'PER', 'sin invitados suficientes, el país del nombre de LiveScore');
  assert.equal(countryOf(venues, 'BREST OPEN GROUPE VERT'), 'FRA', 'la ciudad dentro del nombre del torneo');
  assert.equal(countryOf(venues, 'Knoxville, USA'), 'USA');
  assert.equal(countryOf(venues, 'Brisbane 3'), null);
  assert.equal(homeOf('ITA', 'ITA'), 1);
  assert.equal(homeOf('ESP', 'ITA'), 0);
  assert.equal(homeOf('ESP', null), null);
  // Sackmann: guarda cómo entró cada uno al cuadro
  const row = { tourney_level: 'C', tourney_name: 'Biella', surface: 'Clay', tourney_date: '20250303', match_num: '1', round: 'R32',
    winner_id: '1', winner_name: 'A B', winner_entry: 'wc', winner_ioc: 'ITA', loser_id: '2', loser_name: 'C D', loser_entry: '', score: '6-4 6-4' };
  const s = fromSackmann(row);
  assert.equal(s.winnerEntry, 'WC');
  assert.equal(s.loserEntry, '');
});

test('modelo con actividad y factor local: cuentan con su peso, son simétricos, y un JSON de antes predice igual', () => {
  const m = new EloModel({ minMatches: 1, bWeeks: 0.1, bLastWeek: 0.05, bHome: 0.2 });
  m.venues = { biella: { surface: 'Clay', date: '2025-03-03', ioc: 'ITA' } };
  // A (italiano) y B (español) se van ganando uno a otro, una semana cada torneo
  for (let i = 0; i < 10; i++) {
    const date = new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10);
    const aWins = i % 2 === 0;
    m.update({ date, surface: 'Clay', tourney: `T${i}`, tourneyId: `t${i}`,
      winnerId: aWins ? 'a' : 'b', winnerName: aWins ? 'A' : 'B', winnerIoc: aWins ? 'ITA' : 'ESP',
      loserId: aWins ? 'b' : 'a', loserName: aWins ? 'B' : 'A', loserIoc: aWins ? 'ESP' : 'ITA' });
  }
  const day = '2026-03-18'; // la semana siguiente al último torneo
  const home = m.predict('a', 'b', 'Clay', day, { tournament: 'Biella' });
  const base = m.predict('a', 'b', 'Clay', day);
  assert.deepEqual(home.factors.home, [1, 0]);
  assert.equal(home.factors.venue, 'ITA');
  assert.equal(home.factors.stale, false);
  assert.deepEqual(home.factors.weeks5, [4, 4]);
  assert.equal(base.factors, null, 'sin torneo no cuentan');
  assert.ok(home.pA > base.pA, 'jugar en casa suma');
  close(home.pA + m.predict('b', 'a', 'Clay', day, { tournament: 'Biella' }).pA, 1, 1e-9);
  // Si el modelo no llega a la semana anterior no se sabe qué jugaron: la actividad no cuenta
  const late = m.predict('a', 'b', 'Clay', '2026-05-20', { tournament: 'Biella' });
  assert.equal(late.factors.stale, true);
  assert.deepEqual(late.factors.weeks5, [0, 0]);
  // El JSON guardado predice lo mismo y sólo guarda los torneos recientes
  const r = EloModel.fromJSON(JSON.parse(JSON.stringify(m)));
  close(r.predict('a', 'b', 'Clay', day, { tournament: 'Biella' }).pA, home.pA, 1e-4);
  assert.ok(r.players.get('a').tours.length <= 6);
  // Uno de la fase 1, sin estos pesos: predice como sin las variables
  const old = JSON.parse(JSON.stringify(m));
  for (const k of ['bWeeks', 'bLastWeek', 'bHome']) delete old.options[k];
  close(EloModel.fromJSON(old).predict('a', 'b', 'Clay', day, { tournament: 'Biella' }).pA, base.pA, 1e-4);
});

test('ajuste con variables: da sus pesos, las que no se piden se quedan a cero y una desconocida es un error', () => {
  const { matches } = generate({ years: 3, seed: 5 });
  const f = fitWeights(matches, { tuneFrom: '2024-01-01', tuneTo: '2025-01-01', stats: false, features: ['weeks5', 'lastWeek'] });
  assert.ok(Number.isFinite(f.bWeeks) && Number.isFinite(f.bLastWeek));
  assert.equal(f.bHome, 0);
  const g = fitWeights(matches, { tuneFrom: '2024-01-01', tuneTo: '2025-01-01', stats: false });
  assert.equal(g.bWeeks, 0);
  assert.equal(g.bLastWeek, 0);
  assert.throws(() => fitWeights(matches, { tuneFrom: '2024-01-01', tuneTo: '2025-01-01', features: ['nada'] }), /Variable desconocida/);
});


// ---------- Recomendaciones de los Challenger (fase 3, src/picks.js) ----------
test('recomendaciones de los Challenger: mezcla con la casa y mercado de varias casas', () => {
  close(blendWithMarket(0.6, 0.5, 0), 0.5, 1e-9);
  close(blendWithMarket(0.6, 0.5, 1), 0.6, 1e-9);
  const p = blendWithMarket(0.6, 0.5, PICKS.w);
  assert.ok(p > 0.5 && p < 0.53, `con el peso de la fase 0 manda la casa: ${p}`);
  const mk = marketOf({ Winamax: { a: 1.3, b: 3.5, ts: 1000 }, Betway: { a: 1.35, b: 3.2, ts: 2000 }, Mal: { a: 0, b: 2 } }, 5000);
  assert.equal(mk.books, 2, 'sin las dos cuotas una casa no cuenta');
  assert.deepEqual(mk.best, { a: { price: 1.35, book: 'Betway' }, b: { price: 3.5, book: 'Winamax' } });
  assert.equal(mk.ageMs, 3000);
  close(mk.pA, (fairProbs(1.3, 3.5)[0] + fairProbs(1.35, 3.2)[0]) / 2, 1e-12);
  assert.equal(marketOf({}), null);
});

test('recomendaciones de los Challenger: alta probabilidad, valor oculto, avisos y descartes', () => {
  const pred = (pA, extra = {}) => ({ pA, nA: 80, nB: 70, lowData: false, factors: { home: [0, 0], stale: false }, ...extra });
  const market = (pA, a, b, books = 2) => ({ pA, best: { a: { price: a, book: 'Winamax' }, b: { price: b, book: 'Betway' } }, books, ageMs: 60e3 });
  // Muy probable, de acuerdo con la casa y sin regalar el margen: alta probabilidad en cuota baja
  const r = picksOfMatch({ pred: pred(0.8), market: market(0.79, 1.25, 4.2) });
  const alta = r.picks.filter((x) => x.tipo === 'probabilidad');
  assert.equal(alta.length, 1);
  assert.equal(alta[0].side, 'a');
  assert.equal(alta[0].tramo, 'baja');
  assert.ok(alta[0].ev < 0 && alta[0].ev >= PICKS.altaMinEv, 'sin ventaja sobre la casa');
  assert.equal(r.rel.score, 100);
  // El modelo ve más que la casa: valor en cuota media, que se calcula pero no se enseña (fase 0)
  const v = picksOfMatch({ pred: pred(0.62), market: market(0.52, 1.95, 1.9) });
  const valor = v.picks.filter((x) => x.tipo === 'valor');
  assert.equal(valor.length, 1);
  assert.equal(valor[0].tramo, 'media');
  assert.ok(valor[0].ev >= 0.04);
  assert.equal(valor[0].visible, VALUE_VISIBLE);
  assert.equal(v.picks.some((x) => x.tipo === 'probabilidad'), false, 'con 10 puntos de diferencia no hay alta probabilidad');
  // Descartes
  assert.equal(picksOfMatch({ pred: pred(0.8), market: market(0.5, 1.9, 1.9) }).excluded, 'discrepancia');
  assert.equal(picksOfMatch({ pred: pred(0.8, { lowData: true }), market: market(0.79, 1.25, 4.2) }).excluded, 'pocos_datos');
  assert.equal(picksOfMatch({ pred: pred(0.8), market: null }).excluded, 'sin_cuotas');
  // Avisos: juega en casa, actividad sin la semana anterior y pocos partidos
  const w = picksOfMatch({ pred: pred(0.8, { nB: 20, factors: { home: [0, 1], stale: true } }), market: market(0.79, 1.25, 4.2) });
  assert.deepEqual(w.avisos, ['local', 'datos_viejos', 'pocos_datos']);
  assert.ok(w.rel.score < r.rel.score);
  // Una sola casa y la superficie sin confirmar: menos fiable
  assert.ok(picksOfMatch({ pred: pred(0.8), market: market(0.79, 1.25, 4.2, 1), surfaceKnown: false }).rel.score < r.rel.score);
});


// ---------- Riesgo de retirada y avisos físicos (fase 4) ----------
test('riesgo de retirada: base, retirada en los últimos 90 días y ranking protegido; el modelo guarda la última', () => {
  const ref = dayNum('2026-11-16');
  close(retirementRisk({}, ref).r, RETIRE.base, 1e-12);
  const hurt = { lastRet: '2026-10-01' };
  assert.equal(retirementRisk(hurt, ref).recent, true);
  close(retirementRisk(hurt, ref).r, RETIRE.base * RETIRE.recent, 1e-12);
  assert.equal(retirementRisk({ lastRet: '2026-05-01' }, ref).recent, false, 'hace más de 90 días');
  close(retirementRisk({}, ref, 'pr').r, RETIRE.base * RETIRE.pr, 1e-12);
  close(retirementRisk(hurt, ref, 'PR').r, RETIRE.base * RETIRE.recent * RETIRE.pr, 1e-12);
  // En el modelo: quien se retira (el perdedor de un partido con RET) se apunta su fecha, y cuenta en el siguiente
  const m = new EloModel({ minMatches: 1 });
  m.venues = {};
  m.update({ date: '2026-11-02', surface: 'Hard', tourney: 'T1', winnerId: 'a', winnerName: 'A', loserId: 'b', loserName: 'B', retired: true });
  m.update({ date: '2026-11-09', surface: 'Hard', tourney: 'T2', winnerId: 'b', winnerName: 'B', loserId: 'c', loserName: 'C' });
  assert.equal(m.players.get('b').lastRet, '2026-11-02');
  assert.equal(m.players.get('a').lastRet, undefined);
  const f = m.predict('a', 'b', 'Hard', '2026-11-18', { tournament: 'Lima', entryA: 'PR' }).factors;
  assert.deepEqual(f.recentRet, [false, true]);
  assert.deepEqual(f.pr, [true, false]);
  close(f.retire[0], RETIRE.base * RETIRE.pr, 1e-12);
  close(f.retire[1], RETIRE.base * RETIRE.recent, 1e-12);
  assert.equal(EloModel.fromJSON(JSON.parse(JSON.stringify(m))).players.get('b').lastRet, '2026-11-02');
});

test('avisos físicos: de quién son, sin alta probabilidad, y el valor con la regla de la casa para las retiradas', () => {
  const factors = (extra = {}) => ({ home: [0, 0], stale: false, retire: [RETIRE.base, RETIRE.base], recentRet: [false, false], pr: [false, false], ...extra });
  const pred = (f) => ({ pA: 0.8, nA: 80, nB: 70, lowData: false, factors: f });
  const market = { pA: 0.79, best: { a: { price: 1.25, book: 'winamax' }, b: { price: 4.2, book: 'betway' } }, books: 2, ageMs: 60e3 };
  const ok = picksOfMatch({ pred: pred(factors()), market });
  assert.equal(ok.picks.filter((x) => x.tipo === 'probabilidad').length, 1);
  close(ok.retirada.total, 2 * RETIRE.base, 1e-12);
  // Si la casa anula, con una retirada se recupera lo apostado: el valor esperado se queda en (1 − r) del de sin retiradas
  const p = ok.picks[0];
  close(p.ev, evWithRetirement(p.p, 1.25, ok.retirada.total, 'anula'), 1e-12);
  close(p.ev, (1 - ok.retirada.total) * (p.p * 1.25 - 1), 1e-12);
  close(evWithRetirement(0.8, 1.3, 0.05, 'paga'), 0.8 * 1.3 - 1, 1e-12);
  assert.equal(RETIRE_RULE.winamax, 'anula');
  // B se retiró hace poco y A entra con ranking protegido: avisos con su jugador, más riesgo y ninguna alta probabilidad
  const hurt = picksOfMatch({ pred: pred(factors({ recentRet: [false, true], pr: [true, false], retire: [RETIRE.base * RETIRE.pr, RETIRE.base * RETIRE.recent] })), market });
  assert.deepEqual(hurt.avisos, ['retirada_reciente', 'ranking_protegido']);
  assert.deepEqual(hurt.who, { retirada_reciente: ['b'], ranking_protegido: ['a'] });
  assert.ok(hurt.retirada.total > ok.retirada.total);
  assert.equal(hurt.picks.some((x) => x.tipo === 'probabilidad'), false);
});
