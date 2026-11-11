// Pruebas del buscador (server/shared/search.js): cómo se compara lo escrito con los nombres. Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { hits, queryOf } = require('../shared/search');

const q = s => queryOf(s);

test('cada palabra al principio de alguna palabra del nombre, sin tildes ni mayúsculas', () => {
  assert.equal(hits(q('barc'), ['FC Barcelona']), true);
  assert.equal(hits(q('real mad'), ['Real Madrid']), true);
  assert.equal(hits(q('atletico'), ['Atlético Madrid']), true);
  assert.equal(hits(q('SABALENKA'), ['Aryna Sabalenka']), true);
  assert.equal(hits(q('drid'), ['Real Madrid']), false);
  assert.equal(hits(q('real betis'), ['Real Madrid']), false);
});

test('vale cualquiera de los nombres (abreviatura, otros nombres)', () => {
  assert.equal(hits(q('lal'), ['Los Angeles Lakers', 'LAL']), true);
  assert.equal(hits(q('holanda'), ['Países Bajos', 'Holanda']), true);
  assert.equal(hits(q('t1'), ['T1', 'T1']), true);
});

test('consultas demasiado cortas o vacías no buscan', () => {
  assert.equal(queryOf('a'), null);
  assert.equal(queryOf('   '), null);
  assert.equal(queryOf(undefined), null);
  assert.equal(queryOf('  Liga F '), 'liga f');
});
