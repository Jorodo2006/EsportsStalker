// Los Challenger de LiveScore (server/services/tennis/livescore.js) con fetch simulado: sin red ni base de datos (npm test)
const test = require('node:test');
const assert = require('node:assert/strict');

const ls = require('../services/tennis/livescore');

// Un día con un Challenger: un individual y un dobles (el dobles no entra)
const player = (id, name) => ({ ID: id, Nm: name, CoNm: 'Spain' });
const day = {
  Stages: [{
    Cnm: 'ATP Challenger', Snm: 'Metz, France', Sid: 1, Ccd: 'atp-challenger', Scd: 'metz',
    Events: [
      { Eid: '10', Esd: 20261120100000, Eps: 'NS', ErnInf: '6001', T1: [player(1, 'Pedro Martinez')], T2: [player(2, 'Pablo Llamas')] },
      { Eid: '11', Esd: 20261120120000, Eps: 'NS', ErnInf: '6001', T1: [player(3, 'A Uno'), player(4, 'B Dos')], T2: [player(5, 'C Tres'), player(6, 'D Cuatro')] },
      // Un dobles acabado en el super tie-break (Metz, 19-11-2026: 4-6 7-6 10-7)
      {
        Eid: '12', Esd: 20261130090000, Eps: 'FT', ErnInf: '6001', Ewt: 1, T1: [player(7, 'Romain Arneodo'), player(8, 'Marcus Willis')],
        T2: [player(9, 'Milos Karol'), player(10, 'Joshua Paris')], Tr1S1: '4', Tr2S1: '6', Tr1S2: '7', Tr2S2: '6', Tr1S2T: '7', Tr2S2T: '3', Tr1S3: '10', Tr2S3: '7'
      }
    ]
  }]
};

test('un corte en la primera lectura del día no deja el día sin Challenger: la siguiente consulta vuelve a pedirlo', async t => {
  const calls = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    if (String(url).includes('/date/tennis/') && fail) throw new Error('The operation was aborted due to timeout');
    return { ok: true, json: async () => (String(url).includes('/date/tennis/') ? day : {}) };
  });

  t.mock.method(console, 'error', () => {}); // el aviso del corte, que aquí es a propósito
  // 20261130: un día que ninguna otra prueba ha pedido, para no encontrarlo en la caché del módulo
  assert.deepEqual(await ls.challengers(['20261130']), []);
  assert.equal(calls.filter(u => u.includes('/date/tennis/20261130')).length, 1);

  fail = false;
  const games = await ls.challengers(['20261130']);
  assert.equal(calls.filter(u => u.includes('/date/tennis/20261130')).length, 2, 'tiene que volver a pedir el día');
  assert.equal(games.length, 1, 'sólo el individual: los dobles no entran');
  assert.equal(games[0].a.name, 'Pedro Martinez');
  assert.equal(games[0].level, 'challenger');

  // Los dobles del mismo día salen de la misma petición, ya en caché
  const pairs = await ls.challengerDoubles(['20261130']);
  assert.equal(calls.filter(u => u.includes('/date/tennis/20261130')).length, 2, 'sin pedir el día otra vez');
  assert.deepEqual(pairs.map(m => m.id), ['dbl:ch:11', 'dbl:ch:12']);
  const done = pairs[1];
  assert.equal(done.doubles, true);
  assert.equal(done.level, 'challenger');
  assert.equal(done.a.name, 'Romain Arneodo / Marcus Willis');
  assert.equal(done.b.short, 'Karol / Paris');
  assert.equal(done.mtb, true);
  assert.deepEqual(done.a.sets, [4, 7, 1]);
  assert.deepEqual(done.a.tiebreaks, [null, 7, 10]);
  assert.deepEqual(done.a.setWins, [false, true, true]);
  assert.equal(done.a.winner, true);
});

test('banderas: el país de cada jugador sale de la fase entera (código ISO) y se pasa al código de ESPN, también en los dobles', async t => {
  // Sin país en el día, como LiveScore de verdad; la fase lo trae con CoId (ISO de tres letras; Gran Bretaña llega como NON)
  const bare = (id, name) => ({ ID: id, Nm: name });
  const st = { Cnm: 'ATP Challenger', Snm: 'Helsinki, Finland', Sid: 2, Ccd: 'atp-challenger', Scd: 'helsinki' };
  const ev = [
    { Eid: '20', Esd: 20261201100000, Eps: 'NS', ErnInf: '6001', T1: [bare(21, 'Otto Virtanen')], T2: [bare(22, 'Jan Choinski')] },
    { Eid: '21', Esd: 20261201120000, Eps: 'NS', ErnInf: '6001', T1: [bare(23, 'Nikola Mektic'), bare(24, 'Tim Puetz')], T2: [bare(25, 'Robin Haase'), bare(26, 'Nicolas Barrientos')] }
  ];
  const country = { 21: ['Finland', 'FIN'], 22: ['Great Britain', 'NON'], 23: ['Croatia', 'HRV'], 24: ['Germany', 'DEU'], 25: ['Netherlands', 'NLD'], 26: ['Colombia', 'COL'] };
  const full = ev.map(e => ({ ...e, T1: e.T1.map(p => ({ ...p, CoNm: country[p.ID][0], CoId: country[p.ID][1] })), T2: e.T2.map(p => ({ ...p, CoNm: country[p.ID][0], CoId: country[p.ID][1] })) }));
  t.mock.method(globalThis, 'fetch', async url => {
    const u = String(url);
    return { ok: true, json: async () => (u.includes('/date/tennis/') ? { Stages: [{ ...st, Events: ev }] } : u.includes('/stage/tennis/atp-challenger/helsinki/') ? { Stages: [{ ...st, Events: full }] } : {}) };
  });
  const flag = c => `https://a.espncdn.com/i/teamlogos/countries/500/${c}.png`;
  const [m] = await ls.challengers(['20261201']);
  assert.equal(m.a.flag, flag('fin'));
  assert.equal(m.a.country, 'Finland');
  assert.equal(m.b.flag, flag('gbr'), 'Gran Bretaña, por el nombre');
  const [d] = await ls.challengerDoubles(['20261201']);
  assert.deepEqual(d.a.players.map(p => p.flag), [flag('cro'), flag('ger')]);
  assert.deepEqual(d.b.players.map(p => p.flag), [flag('ned'), flag('col')]);
  assert.equal(d.a.country, 'Croatia / Germany');
});

test('flagOf: ISO y COI al código de ESPN, y nada si no hay con qué', () => {
  const { flagOf } = require('../services/tennis/flags');
  const code = u => (u.match(/\/(\w+)\.png$/) || [])[1] || '';
  assert.equal(code(flagOf('ESP')), 'esp');
  assert.equal(code(flagOf('SRB')), 'ser', 'ESPN no sigue al COI en Serbia');
  assert.equal(code(flagOf('ROU')), 'rom');
  assert.equal(code(flagOf('GER')), 'ger', 'el del COI, de los PDF de ProTennisLive, pasa tal cual');
  assert.equal(code(flagOf('CHE')), 'sui');
  assert.equal(code(flagOf('ENG', 'England')), 'gbr');
  assert.equal(flagOf('NON', ''), '');
  assert.equal(flagOf('', ''), '');
  assert.equal(flagOf('España'), '');
});
