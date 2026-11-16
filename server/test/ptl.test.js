// La previa de los Challenger de ProTennisLive: lectura del cuadro (qs.pdf) y del orden de juego (op.pdf) a partir de los trozos de
// texto con su posición, resultados, zonas horarias y qué torneos probar. Trozos inventados con la forma de los PDF de verdad
// (se comprobó con los de Sídney y Champaign de noviembre de 2026). Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { parseScore, parseDraw, parseOrder } = require('../services/tennis/ptlpdf');
const { zoneOf, atLocal, candidates } = require('../services/tennis/protennislive');

const it = (text, x, y, size = 8) => ({ text, x, y, size });
const head = [it('NSW Open', 269, 815), it('Sydney, Australia', 261, 804), it('16 November — 22 November 2026', 175, 794), it('USD 107 000', 175, 794),
  it('Hard', 175, 794), it('Challenger 75', 175, 794)];

test('resultados: sets desde el que gana, desempates, retiradas y W.O.', () => {
  assert.deepEqual(parseScore(['61 62']), { sets: [[6, 1], [6, 2]], tb: [null, null], ret: false, wo: false });
  assert.deepEqual(parseScore(['62 67', '6', '62']).sets, [[6, 2], [6, 7], [6, 2]]);
  assert.deepEqual(parseScore(['62 67', '6', '62']).tb, [null, 6, null]);
  assert.deepEqual(parseScore(['76', '4', '06 63']), { sets: [[7, 6], [0, 6], [6, 3]], tb: [4, null, null], ret: false, wo: false });
  // Un desempate de dos cifras no es un set
  assert.deepEqual(parseScore(['76', '10', '63']).tb, [10, null]);
  assert.equal(parseScore(['63 21 ret.']).ret, true);
  assert.equal(parseScore(['W/O']).wo, true);
});

test('cuadro de la previa: cruces, ganadores por su altura y resultados', () => {
  const items = [...head, it('Qualifying Singles', 504, 780),
    // posición, siembra, entrada, nombre, país
    it('1', 21, 750), it('1', 45, 750), it('MORIYA, Hiroki', 56, 750), it('JPN', 136, 750),
    it('2', 21, 737), it('RYAN ZIEGANN, Sam', 56, 737), it('AUS', 136, 737),
    it('3', 21, 723), it('WC', 34, 723), it('IBRAIMI, Ymerali', 56, 723), it('AUS', 136, 723),
    it('4', 21, 710), it('12', 45, 710), it('FANCUTT, Thomas', 56, 710), it('AUS', 136, 710),
    it('Qualifying Round 1', 55, 400), it('Qualifying Round 2', 197, 400), it('Qualifier', 357, 400),
    // El de la 1.ª ronda, algo por encima de su primer jugador; el de la 2.ª, a media altura
    it('H. Moriya', 163, 752.3), it('1', 200, 752.3), it('61 62', 210, 752.3),
    it('H. Moriya', 304, 738.7), it('1', 340, 738.7), it('75 62', 350, 738.7),
    it('T. Fancutt', 163, 724.4), it('12', 200, 724.4), it('63', 210, 724.4), it('76', 222, 724.4), it('5', 230, 726)];
  const d = parseDraw(items);
  assert.equal(d.city, 'Sydney, Australia');
  assert.equal(d.start, '2026-11-16');
  assert.equal(d.rounds, 2);
  assert.deepEqual(d.draw.map(p => [p.pos, p.name, p.seed, p.entry, p.country]), [
    [1, 'Hiroki Moriya', 1, null, 'JPN'], [2, 'Sam Ryan Ziegann', null, null, 'AUS'], [3, 'Ymerali Ibraimi', null, 'WC', 'AUS'], [4, 'Thomas Fancutt', 12, null, 'AUS']
  ]);
  const [r11, r12, r21] = d.matches;
  assert.equal(r11.winner, 'a');
  assert.deepEqual(r11.score.sets, [[6, 1], [6, 2]]); // sin la siembra (1) delante
  assert.equal(r12.winner, 'b');
  assert.deepEqual(r12.score.sets, [[6, 3], [7, 6]]);
  assert.deepEqual(r12.score.tb, [null, 5]);
  assert.equal(r21.a.name, 'Hiroki Moriya');
  assert.equal(r21.b.name, 'Thomas Fancutt');
  assert.equal(r21.winner, 'a');
});

test('cuadro sin ganadores todavía: los cruces de la 2.ª ronda quedan por decidir', () => {
  const items = [...head, it('1', 21, 750), it('MORIYA, Hiroki', 56, 750), it('JPN', 136, 750), it('2', 21, 737), it('ZHU, Evan', 56, 737), it('USA', 136, 737),
    it('Qualifying Round 1', 55, 400), it('Qualifier', 357, 400)];
  const d = parseDraw(items);
  assert.equal(d.rounds, 1);
  assert.equal(d.matches.length, 1);
  assert.equal(d.matches[0].winner, null);
});

test('orden de juego: pista por columna, hora por turno y «a continuación»', () => {
  const items = [...head, it('ORDER OF PLAY - SUNDAY, NOVEMBER 15, 2026', 154, 777),
    it('COURT', 89, 745), it('1', 121, 745), it('KRA', 226, 745),
    it('Starts At 10:00', 83, 730), it('Followed By', 87, 591), it('Not Before 13:00', 210, 730),
    it('[1] Hiroki MORIYA (JPN)', 48, 673), it('vs', 103, 662), it('[12] Thomas FANCUTT (AUS)', 48, 651),
    it('Carl Emil OVERBECK (DEN)', 48, 534), it('vs', 103, 523), it('Lucky Loser', 48, 512),
    it('[WC] Li TU (AUS)', 176, 673), it('vs', 230, 662), it('Mustafa Ege SIK (AUS)', 176, 651)];
  const o = parseOrder(items);
  assert.equal(o.day, '2026-11-15');
  const [m1, m2, m3] = o.matches;
  assert.deepEqual([m1.court, m1.order, m1.time, m1.approx, m1.a.name, m1.a.tag, m1.b.last], ['COURT 1', 1, '10:00', false, 'Hiroki Moriya', '1', 'Fancutt']);
  assert.deepEqual([m2.court, m2.order, m2.time, m2.approx, m2.a.first, m2.a.last, m2.b.placeholder], ['COURT 1', 2, '11:30', 'a continuación', 'Carl Emil', 'Overbeck', 'Lucky Loser']);
  assert.deepEqual([m3.court, m3.time, m3.approx, m3.a.name, m3.b.name], ['KRA', '13:00', 'no antes de', 'Li Tu', 'Mustafa Ege Sik']);
});

test('zona horaria del torneo y hora local → UTC', () => {
  assert.equal(zoneOf('Sydney, Australia').tz, 'Australia/Sydney');
  assert.equal(zoneOf('Champaign, IL, U.S.A.').tz, 'America/Chicago');
  assert.equal(zoneOf('Gran Canaria, Spain').tz, 'Atlantic/Canary');
  assert.equal(zoneOf('Helsinki, Finland').sure, true);
  assert.equal(zoneOf('Springfield, USA').sure, false); // ciudad de EE. UU. que no está: hora aproximada
  assert.equal(new Date(atLocal('2026-11-15', '10:00', 'Australia/Sydney')).toISOString(), '2026-11-14T23:00:00.000Z');
  assert.equal(new Date(atLocal('2026-11-15', '10:00', 'America/Chicago')).toISOString(), '2026-11-15T16:00:00.000Z');
  assert.equal(new Date(atLocal('2026-07-12', '10:00', 'Europe/Madrid')).toISOString(), '2026-07-12T08:00:00.000Z');
});

test('qué torneos probar: la misma semana de los años anteriores, con una de margen, y las ciudades de LiveScore', () => {
  const monday = Date.parse('2026-11-16T00:00:00Z');
  const list = [
    { id: 2817, name: 'Sydney CH', date: '2025-11-17' }, // misma semana
    { id: 637, name: 'Champaign CH', date: '2025-11-10' }, // una semana antes
    { id: 7397, name: 'Kobe CH', date: '2024-11-25' }, // hace dos años, una después
    { id: 999, name: 'Lejos CH', date: '2025-06-02' },
    { id: 8310, name: 'Helsinki CH', date: '2025-04-07' } // otra época, pero LiveScore lo tiene esta semana
  ];
  const ids = candidates(list, monday, new Set(['helsinki'])).map(c => c.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [637, 2817, 7397, 8310]);
});
