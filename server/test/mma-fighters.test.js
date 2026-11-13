const test = require('node:test');
const assert = require('node:assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada';
const { mentions } = require('../shared/fighters');
const { fightMatches } = require('../services/bets/settle');

test('mentions: el mismo luchador escrito de otra forma', () => {
  assert.ok(mentions('Ciryl Gane', 'C. Gane gana por KO/TKO/DSQ'));
  assert.ok(mentions('Ciryl Gane', 'Ciryl Gane KO, TKO o descalificación'));
  assert.ok(mentions('Uroš Medić', 'Uros Medic'));
  assert.ok(mentions('Charles Radtke', 'Charlie Radke'));
  assert.ok(mentions('Chris Duncan', 'Christopher Duncan'));
  assert.ok(mentions('Alatengheili', 'Alateng Heili'));
});

test('mentions: no cruza luchadores con el mismo apellido o apellidos casi iguales', () => {
  assert.ok(!mentions('José Silva', 'Bruno Silva'));
  assert.ok(!mentions('Daniel Rodriguez', 'David Rodrigues'));
  assert.ok(!mentions('Josh Hokit', 'Ciryl Gane gana por KO'));
  assert.ok(!mentions('Ilia Topuria', 'Max Holloway'));
  assert.ok(!mentions('', 'Ciryl Gane'));
});

test('fightMatches: el combate de la apuesta es el que se va a resolver (en cualquier orden)', () => {
  const f = { a: { name: 'Ciryl Gane' }, b: { name: 'Josh Hokit' } };
  assert.strictEqual(fightMatches('Ciryl Gane vs Josh Hokit', f), true);
  assert.strictEqual(fightMatches('Josh Hokit vs Ciryl Gane', f), true);
  assert.strictEqual(fightMatches('Ciryl Gane - Josh Hokit', f), true);
  assert.strictEqual(fightMatches('Ciryl Gane vs Alexander Volkov', f), false);
  assert.strictEqual(fightMatches('Brian Hooi vs Umakhan Ibragimov', f), false);
  assert.strictEqual(fightMatches('', f), false);
  assert.strictEqual(fightMatches(undefined, f), false);
  const silva = { a: { name: 'José Silva' }, b: { name: 'Alex Perez' } };
  assert.strictEqual(fightMatches('Bruno Silva vs Alex Perez', silva), false);
});
