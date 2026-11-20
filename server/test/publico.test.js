// Lo que se ve sin cuenta (gateway/public.js): qué rutas se abren, que no se cuele nada de un usuario ni las recomendaciones,
// el límite por IP, los ajustes sin credenciales y la configuración de AdSense. Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublic, isAdminPath, anonymousAllowed, publicSettings, publicConfig, adsTxt, LIMIT } = require('../services/gateway/public');

test('se abren las lecturas de los deportes y de las cuotas', () => {
  for (const p of ['/api/esports/schedule', '/api/stats/players', '/api/basket/games', '/api/tennis/match-stats', '/api/tennis/doubles', '/api/tennis/gamelog/atp/3782', '/api/tennis/profile/challenger/Christian%20Langmo', '/api/football/standings/laliga', '/api/mma/fighter', '/api/search', '/api/settings/public', '/api/public/config']) {
    assert.equal(isPublic('GET', p), true, p);
  }
  for (const p of ['/api/odds/match', '/api/odds/board', '/api/odds/history', '/api/football/photos']) assert.equal(isPublic('POST', p), true, p);
  assert.equal(isPublic('POST', '/api/auth/login'), true);
});

test('lo de cada usuario, las recomendaciones y leer cuotas a mano piden cuenta', () => {
  const closed = [
    ['GET', '/api/bets'], ['POST', '/api/bets'], ['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/friends'],
    ['GET', '/api/shared'], ['GET', '/api/friends/3/chat'], ['POST', '/api/odds/jobs'], ['GET', '/api/odds/jobs/abc123'], ['POST', '/api/odds/paste'],
    ['GET', '/api/tennis/picks'], ['GET', '/api/tennis/picks/board'], ['GET', '/api/tennis/picks/day'], ['GET', '/api/tennis/picks/player/atp/3782'], ['GET', '/api/football/picks'],
    ['GET', '/api/football/picks/day'], ['GET', '/api/football/picks/lines'], ['GET', '/api/mma/picks'], ['GET', '/api/mma/picks/lines'], ['GET', '/api/challenger/estado'], ['GET', '/api/challenger/recomendaciones'], ['POST', '/api/challenger/escanear'],
    ['GET', '/api/odds/auto/status'], ['GET', '/api/bets/predictions'], ['POST', '/api/auth/password'],
    // Panel de administración: nunca abierto (el gateway además exige ser administrador)
    ['GET', '/api/admin/users'], ['PATCH', '/api/admin/users/3'], ['POST', '/api/admin/users/3/password'], ['DELETE', '/api/admin/users/3'],
    ['GET', '/api/admin/log'], ['GET', '/api/admin/auth-events'], ['GET', '/api/admin/predictions'],
    // Avisos de cuotas: los de cada usuario y su suscripción a las notificaciones
    ['GET', '/api/alerts'], ['POST', '/api/alerts/read'], ['GET', '/api/alerts/prefs'], ['PUT', '/api/alerts/prefs'], ['PUT', '/api/alerts/watch'],
    ['POST', '/api/alerts/push'], ['POST', '/api/alerts/push/remove'],
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

test('isAdminPath: sólo el prefijo /api/admin', () => {
  for (const p of ['/api/admin', '/api/admin/', '/api/admin/users', '/api/admin/log', '/api/admin/users/3/password', '/api/admin/predictions']) assert.equal(isAdminPath(p), true, p);
  for (const p of ['/api/administrador', '/api/bets', '/api/settings', '/api/auth/me', '/admin']) assert.equal(isAdminPath(p), false, p);
});
