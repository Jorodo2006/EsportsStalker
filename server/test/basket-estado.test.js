const test = require('node:test');
const assert = require('node:assert');
const { statusEs } = require('../services/basket/espn');

// ESPN da el estado del partido en inglés ("5:32 - 2nd", "Halftime"); la web lo enseña tal cual, así que sale en castellano
test('statusEs traduce el estado del partido de ESPN', () => {
  assert.strictEqual(statusEs('5:32 - 2nd'), '2.º cuarto · 5:32');
  assert.strictEqual(statusEs('2nd'), '2.º cuarto');
  assert.strictEqual(statusEs('Halftime'), 'Descanso');
  assert.strictEqual(statusEs('End of 1st'), 'Fin del 1.er cuarto');
  assert.strictEqual(statusEs('End of 1st Half'), 'Fin de la 1.ª parte');
  assert.strictEqual(statusEs('2:15 - OT'), 'Prórroga · 2:15');
  assert.strictEqual(statusEs('1:00 - 2OT'), '2.ª prórroga · 1:00');
  assert.strictEqual(statusEs('Final'), 'Final');
  assert.strictEqual(statusEs('Final/OT'), 'Final (prórroga)');
  assert.strictEqual(statusEs('Final/2OT'), 'Final (2 prórrogas)');
  assert.strictEqual(statusEs('Postponed'), 'Aplazado');
});

test('statusEs quita la hora de ESPN de los que no han empezado y deja lo que no conoce', () => {
  assert.strictEqual(statusEs('11/18 - 7:30 PM EST'), '');
  assert.strictEqual(statusEs(''), '');
  assert.strictEqual(statusEs(undefined), '');
  assert.strictEqual(statusEs('Jornada 8'), 'Jornada 8');
});
