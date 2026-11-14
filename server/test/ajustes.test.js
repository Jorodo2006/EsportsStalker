// Ajustes de la app: comunes y sólo del administrador. Lo de cada usuario es su banca inicial, su filtro de ligas y sus favoritos.
// Sin base de datos: el permiso se comprueba antes de guardar nada
const test = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const store = require('../services/bets/store');

test('de cada usuario sólo quedan la banca inicial, el filtro de ligas y los favoritos', () => {
  assert.deepStrictEqual([...store.USER_KEYS].sort(), ['favoriteLeagues', 'favorites', 'initialBankroll']);
});

test('los favoritos se limpian: deporte conocido, sin repetidos y el escudo sólo con https', () => {
  const out = store.cleanFavorites([
    { sport: 'basket', name: ' Los Angeles Lakers ', logo: 'https://a.espncdn.com/lal.png' },
    { sport: 'basket', name: 'los angeles lakers' },
    { sport: 'tennis', name: 'Aryna Sabalenka', logo: 'javascript:alert(1)' },
    { sport: 'golf', name: 'Tiger Woods' },
    { sport: 'mma', name: '' },
    'basura'
  ]);
  assert.deepStrictEqual(out, [
    { sport: 'basket', name: 'Los Angeles Lakers', logo: 'https://a.espncdn.com/lal.png' },
    { sport: 'tennis', name: 'Aryna Sabalenka' }
  ]);
  assert.throws(() => store.cleanFavorites('Lakers'), /lista/);
  assert.strictEqual(store.cleanFavorites(Array.from({ length: 100 }, (_, i) => ({ sport: 'lol', name: `Equipo ${i}` }))).length, 60);
});

test('quien no es administrador no puede cambiar un ajuste común', async () => {
  for (const patch of [{ currency: '$' }, { featuredBooks: 'Betway' }, { refreshSeconds: 10 }, { signupOpen: false }, { oddsAutoEnabled: false }, { initialBankroll: 50, currency: '$' }]) {
    await assert.rejects(store.setSettings('1', false, patch), e => e.status === 403 && /administrador/.test(e.message), JSON.stringify(patch));
  }
});
