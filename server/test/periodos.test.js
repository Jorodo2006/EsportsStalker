// Baloncesto: las líneas del partido entero no pueden pasar por las de una mitad o un cuarto. Betway devuelve la página del partido
// cuando se le pide una pestaña que el partido no tiene (NBL), y salía "1.er cuarto: menos de 188,5 puntos", que se daba por ganada
// con 56 puntos. isPeriodCopy descarta la copia aunque venga de otra lectura (lecturas ligeras); dropImpossiblePeriods quita lo que
// se cuele. Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { Book, isPeriodCopy } = require('../services/odds/odds');

const URL = 'https://betway.es/es/sports/evt/123';
// La escalera de totales del partido (como la de Betway) y algún hándicap
const ladder = (from, n, shift = 0) => Array.from({ length: n }, (_, i) => ({ title: 'Total de puntos', line: from + shift + i }));
const page = (id, job, group, markets) => ({ id, job, book: 'betway', page: `${URL}?marketGroup=${group}`, markets });
const main = (id, job, shift = 0) => page(id, job, 'main-markets', [{ title: 'Ganador', line: null }, { title: 'Hándicap', line: -3.5 }, { title: 'Hándicap', line: -2.5 }, ...ladder(185.5, 12, shift)]);

test('la copia del partido en la pestaña de la 1.ª mitad se descarta aunque sea de otra lectura', () => {
  const copy = { ...main(2, 'ligera-1'), id: 2, page: `${URL}?marketGroup=1st-half` };
  assert.equal(isPeriodCopy(copy, [main(1, 'ligera-1'), copy]), true); // misma lectura (como antes)
  assert.equal(isPeriodCopy(copy, [main(1, 'completa-0'), copy]), true); // otra lectura: antes se colaba
});

test('también si entre una lectura y otra se ha movido alguna línea', () => {
  const copy = page(2, 'vieja', '1st-quarter', main(0, 'x', 0).markets);
  assert.equal(isPeriodCopy(copy, [main(1, 'nueva', 1), copy]), true); // escalera corrida un punto: 11 de 13 líneas iguales
});

test('una mitad de verdad no se descarta aunque comparta algún hándicap con el partido', () => {
  const half = page(2, 'j', '1st-half', [{ title: 'Ganador', line: null }, { title: 'Hándicap', line: -2.5 }, { title: 'Total de puntos', line: 98.5 },
    { title: 'Total de puntos', line: 99.5 }, { title: 'Total de puntos del equipo', line: 48.5 }]);
  assert.equal(isPeriodCopy(half, [main(1, 'j'), half]), false);
  // Ni la página principal ni las de Winamax son copias de nada
  assert.equal(isPeriodCopy(main(1, 'j'), [main(1, 'j')]), false);
  assert.equal(isPeriodCopy({ ...main(3, 'j'), book: 'winamax', page: `${URL}?marketGroup=1st-half` }, [main(1, 'j')]), false);
});

const book = (sport = 'basket') => {
  const b = new Book({ name: 'Illawarra Hawks', code: 'HWK' }, { name: 'Perth Wildcats', code: 'PER' }, sport);
  const ou = (bk, p) => ({ over: p, under: p });
  for (const l of [186.5, 188.5, 190.5]) b.addStd('total', 0, l, 'Betway', ou('Betway', 1.9), l === 188.5);
  return b;
};
const keys = b => b.result({}).markets.map(m => m.key);

test('quita las líneas de periodo imposibles: un cuarto de 188,5 cuando el partido es de 188,5', () => {
  const b = book();
  b.addStd('total', 1, 98.5, 'Betway', { over: 1.9, under: 1.9 }); // 1.ª mitad de verdad
  b.addStd('total', 1, 188.5, 'Betway', { over: 1.3, under: 3.2 }); // copia del partido
  b.addStd('total', 11, 49.5, 'Betway', { over: 1.9, under: 1.9 }); // 1.er cuarto de verdad
  b.addStd('total', 11, 188.5, 'Betway', { over: 1.3, under: 3.2 }); // copia
  b.addStd('team_total', 1, 48.5, 'Betway', { over: 1.9, under: 1.9 }, false, 'a');
  b.addStd('team_total', 1, 95.5, 'Betway', { over: 1.56, under: 2 }, false, 'a'); // copia del total del equipo
  b.addStd('team_total', 11, 24.5, 'Betway', { over: 1.9, under: 1.9 }, false, 'b');
  b.addStd('spread', 1, -3.5, 'Betway', { a: 1.9, b: 1.9 }); // el hándicap no se juzga por la línea
  const k = keys(b);
  for (const ok of ['total|1||98.5', 'total|11||49.5', 'team_total|1|a|48.5', 'team_total|11|b|24.5', 'spread|1||-3.5', 'total|0||188.5']) assert.ok(k.includes(ok), ok);
  for (const bad of ['total|1||188.5', 'total|11||188.5', 'team_total|1|a|95.5']) assert.ok(!k.includes(bad), bad);
});

test('sin total del partido no se quita nada, y en otros deportes tampoco', () => {
  const b = new Book({ name: 'A' }, { name: 'B' }, 'basket');
  b.addStd('total', 1, 188.5, 'Betway', { over: 1.3, under: 3.2 });
  assert.deepEqual(keys(b), ['total|1||188.5']);
  const f = book('football');
  f.addStd('total', 1, 188.5, 'Betway', { over: 1.3, under: 3.2 });
  assert.ok(keys(f).includes('total|1||188.5'));
});
