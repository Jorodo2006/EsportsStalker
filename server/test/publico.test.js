// Lo que se ve sin cuenta (gateway/public.js): qué rutas se abren, que no se cuele nada de un usuario ni las recomendaciones,
// el límite por IP, los ajustes sin credenciales y la configuración de AdSense. Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublic, anonymousAllowed, publicSettings, publicConfig, adsTxt, LIMIT } = require('../services/gateway/public');

test('se abren las lecturas de los deportes y de las cuotas', () => {
  for (const p of ['/api/esports/schedule', '/api/stats/players', '/api/basket/games', '/api/tennis/match-stats', '/api/football/standings/laliga', '/api/mma/fighter', '/api/search', '/api/settings/public', '/api/public/config']) {
    assert.equal(isPublic('GET', p), true, p);
  }
  for (const p of ['/api/odds/match', '/api/odds/board', '/api/odds/history', '/api/football/photos']) assert.equal(isPublic('POST', p), true, p);
  assert.equal(isPublic('POST', '/api/auth/login'), true);
});

test('lo de cada usuario, las recomendaciones y leer cuotas a mano piden cuenta', () => {
  const closed = [
    ['GET', '/api/bets'], ['POST', '/api/bets'], ['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/friends'],
    ['GET', '/api/shared'], ['GET', '/api/friends/3/chat'], ['POST', '/api/odds/jobs'], ['POST', '/api/odds/paste'],
    ['GET', '/api/tennis/picks'], ['GET', '/api/tennis/picks/board'], ['GET', '/api/tennis/picks/day'], ['GET', '/api/football/picks'],
    ['GET', '/api/football/picks/day'], ['GET', '/api/football/picks/lines'], ['GET', '/api/mma/picks'], ['GET', '/api/mma/picks/lines'], ['GET', '/api/challenger/estado'], ['POST', '/api/challenger/escanear'],
    ['GET', '/api/odds/auto/status'], ['GET', '/api/bets/predictions'], ['POST', '/api/auth/password'],
    // Escribir en un deporte con otro método no se abre aunque la ruta sea de lectura
    ['POST', '/api/basket/games'], ['DELETE', '/api/tennis/games']
  ];
  for (const [m, p] of closed) assert.equal(isPublic(m, p), false, `${m} ${p}`);
});

test('el límite sin cuenta es por IP y se reinicia cada minuto', () => {
  const t0 = 1e12;
  for (let i = 0; i < LIMIT; i++) assert.equal(anonymousAllowed('1.1.1.1', t0), true);
  assert.equal(anonymousAllowed('1.1.1.1', t0), false);
  assert.equal(anonymousAllowed('2.2.2.2', t0), true); // otra IP no se ve afectada
  assert.equal(anonymousAllowed('1.1.1.1', t0 + 61e3), true);
});

test('los ajustes públicos no llevan credenciales ni lo de nadie', () => {
  const s = publicSettings({ currency: '€', featuredBooks: 'Winamax,Betway', leaguepediaPassword: 'x', lolesportsKey: 'k', initialBankroll: 500, favorites: [{ sport: 'nba', name: 'X' }] });
  assert.equal(s.currency, '€');
  assert.equal('leaguepediaPassword' in s, false);
  assert.equal('lolesportsKey' in s, false);
  assert.equal(s.initialBankroll, 0);
  assert.deepEqual(s.favorites, []);
});

test('AdSense: sin cuenta no hay anuncios; con ella, el ads.txt y los huecos válidos', () => {
  assert.equal(publicConfig({}).ads, null);
  assert.match(adsTxt({}), /^#/);
  const env = { ADSENSE_CLIENT: 'pub-1234567890123456', ADSENSE_SLOT_RECT: '1234567890', ADSENSE_SLOT_HALF: 'nada<script>' };
  const c = publicConfig(env);
  assert.equal(c.ads.client, 'ca-pub-1234567890123456');
  assert.equal(c.ads.slots.rect, '1234567890');
  assert.equal(c.ads.slots.half, null);
  assert.equal(adsTxt(env), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  assert.equal(publicConfig({ ADSENSE_CLIENT: 'ca-pub-12; evil' }).ads, null);
});
