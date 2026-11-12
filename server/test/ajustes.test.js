// Ajustes de la app: comunes y sólo del administrador. Lo de cada usuario es su banca inicial y su filtro de ligas.
// Sin base de datos: el permiso se comprueba antes de guardar nada
const test = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const store = require('../services/bets/store');

test('de cada usuario sólo quedan la banca inicial y el filtro de ligas', () => {
  assert.deepStrictEqual([...store.USER_KEYS].sort(), ['favoriteLeagues', 'initialBankroll']);
});

test('quien no es administrador no puede cambiar un ajuste común', async () => {
  for (const patch of [{ currency: '$' }, { featuredBooks: 'Betway' }, { refreshSeconds: 10 }, { signupOpen: false }, { oddsAutoEnabled: false }, { initialBankroll: 50, currency: '$' }]) {
    await assert.rejects(store.setSettings('1', false, patch), e => e.status === 403 && /administrador/.test(e.message), JSON.stringify(patch));
  }
});
