// Leer tickets de las casas: el texto es el que da el OCR (Tesseract) de capturas reales de Winamax y bet365, con sus errores
// («B05 Celtics», «19 cuarto», «Gananciss», un 8 leído como 6). Las referencias de los tickets son inventadas.
const test = require('node:test');
const assert = require('node:assert');
const { parseTicket, linkTicket, gameOf, periodOf, guessRef } = require('../services/bets/ticket');

const team = (name, abbr) => ({ name, abbr, alt: [] });
const nba = (id, away, home, date) => gameOf('basket', { id, league: 'nba', date, away, home });
const GAMES = [
  nba('nba:1', team('Sacramento Kings', 'SAC'), team('Boston Celtics', 'BOS'), '2026-11-21T20:00Z'),
  nba('nba:2', team('Brooklyn Nets', 'BKN'), team('Orlando Magic', 'ORL'), '2026-11-21T00:30Z'),
  nba('nba:3', team('Chicago Bulls', 'CHI'), team('Washington Wizards', 'WSH'), '2026-11-21T01:00Z'),
  nba('nba:4', team('Denver Nuggets', 'DEN'), team('Houston Rockets', 'HOU'), '2026-11-21T02:00Z'),
  nba('nba:5', team('Charlotte Hornets', 'CHA'), team('Atlanta Hawks', 'ATL'), '2026-11-21T00:00Z'),
  // Otros «Kings» (NBL): con un solo equipo leído no tienen que confundirse con Sacramento
  gameOf('basket', { id: 'nbl:9', league: 'nbl', date: '2026-11-21T21:00Z', away: team('Sydney Kings', 'SYD'), home: team('Brisbane Bullets', 'BRI') })
];
const NOW = +new Date('2026-11-21T22:30:00Z');

const WMX_TOTAL = `Simple [- A
——————————. 48 4:09486 %) ——————
Sacramento Kings 176 - 75 Boston Celtics
Número total de puntos Más de 214,5 [1,74
151 214.5
—l) ;——| [o
Importe 12,00 €
Ganancias potenciales 20,88 €
COMPLETAR
Ref: AAAAAAAA / 1111111111 22:03 - 21 noviembre 2026`;

const WMX_PLAYER = `Simple . Y
22m... UM ÁL —————————
| Brooklyn Nets 111 - M3 Orlando Magic
Total del jugador (asistencias + rebotes) (logros) - Danny Wolf [1,94 |
Más de 5,5
55 7
Importe ————————————————_—_r_r_r_rr......— 6,00€
Gananciss ————————— 15,52€
Ref: BBBBBBBB / 2222222222 0:06 - 21 noviembre 2026`;

const WMX_COMBO = `Combinada (2) % . MO
Perdida 18: 4
_——"———;—Ñ—]|
Chicago Bulls 94 - 98 Washington Wizards
Hándicap de puntos (handicap) Washington Wizards +7.5 1,42
_——"———;—Ñ—]|
| Denver Nuggets 133 - 124 Houston Rockets |

Total del jugador (asistencias + rebotes) (logros) - DeMar

DeRozan 2,10
Más de 4,5

4 45

cual ED
Importe ———————————— 10,00€
Ganancias —— — ————— ——........— 1,00€
Ref: CCCCCCCC / 3333333333 1:59 - 21 noviembre 2026`;

const B365_SINGLE = `10,00€ Simple
) Reutilizar selecciones

9 Domantas Sabonis - 17+ rebotes 7.00

Rebotes

165

——————————————]———2 KT [

ra CA A —

NM B05 Celtics 27 27 54 13 8 75

|. SACKings 25 16 41 35 0 76 [9
Imp:
10,00€ 50,00€ 50,00€ Apuesta cerrada`;

const B365_BUILDER = `GANADOR
10,00€ Crear apuesta
 Reutilizar selecciones

o CREAR APUESTA 7.00

19 cuarto - Hándicap - SAC Kings +4.5 puntos

19 cuarto - Hándicap

De'Andre Hunter - 2+ triples

Triples anotados

—£—]]————————]—— E

Darius Acuff Jr. - 7+ asistencias

ED

LI

Domantas Sabonis - 10+ rebotes

Rebotes

2. -.i..mm mee mee]_moáa.m5sss5s4zTT-—-.—6
49 C 0930 1 2Mt3 4 T
M0 Celtics 27 27 54 13 8 75

|. SACKings 25 16 41 35 0 76 [9
Imp: Ganancias
mon 70,00€ (Y) 70,00€ Ganancias`;

const B365_BUILDER2 = `a
8,27€ Crear apuesta
f) Reutilizar selecciones
9 CREAR APUESTA 2.70
Domantas Sabonis - 10+ rebotes
———————;;—;————————————-ed ——]Ñ——l e 15
Zach LaVine - 3+ asistencias
E
25
Lo) '
49 C 0923 1 2Mt3 4 T
MN B05 Celtics 27 27 54 13 8 75
|. SACKings 25 16 41 35 0 76 [9
Imp: Ganancias
8,27€ 22,32€`;

const scan = text => linkTicket(parseTicket(text), GAMES, NOW);

test('Winamax, total del partido: importe, cuota, fecha y enlazada a su partido', () => {
  const r = scan(WMX_TOTAL);
  assert.strictEqual(r.book, 'Winamax');
  assert.deepStrictEqual(r.legs.map(l => l.linked), [true]);
  const d = r.draft;
  assert.strictEqual(d.stake, 12);
  assert.strictEqual(d.odds, 1.74);
  assert.strictEqual(d.date, '2026-11-21');
  assert.strictEqual(d.event, 'SAC @ BOS');
  assert.strictEqual(d.selection, 'Más de 214.5');
  assert.deepStrictEqual(d.ref, { sport: 'basket', match: 'nba:1', key: 'total|0||214.5', out: 'over', start: '2026-11-21T20:00Z' });
});

test('Winamax, línea de jugador; el importe mal leído se corrige con las ganancias', () => {
  const r = scan(WMX_PLAYER);
  assert.strictEqual(r.draft.stake, 8); // 15,52 / 1,94
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.draft.ref.key, 'player|Reb + Ast|danny wolf|5.5');
  assert.strictEqual(r.draft.ref.match, 'nba:2');
  assert.strictEqual(r.draft.market, 'Reb + Ast · Danny Wolf');
});

test('Winamax, combinada de dos partidos: cada selección con el suyo; una perdida no cambia el importe', () => {
  const r = scan(WMX_COMBO);
  assert.strictEqual(r.kind, 'combo');
  assert.strictEqual(r.draft.stake, 10);
  assert.strictEqual(r.draft.odds, 2.98);
  const [a, b] = r.draft.legs;
  assert.deepStrictEqual([a.ref.match, a.ref.key, a.ref.out, a.odds, a.selection], ['nba:3', 'spread|0||-7.5', 'b', 1.42, 'WSH +7.5']);
  assert.deepStrictEqual([b.ref.match, b.ref.key, b.odds], ['nba:4', 'player|Reb + Ast|demar derozan|4.5', 2.1]);
});

test('bet365, simple de jugador cerrada: «17+ rebotes» es más de 16,5, y el cobro del cierre', () => {
  const r = scan(B365_SINGLE);
  assert.strictEqual(r.book, 'bet365');
  assert.strictEqual(r.draft.stake, 10);
  assert.strictEqual(r.draft.odds, 7);
  assert.strictEqual(r.draft.status, 'cashout');
  assert.strictEqual(r.draft.cashout, 50);
  assert.strictEqual(r.draft.ref.key, 'player|Rebotes|domantas sabonis|16.5');
  assert.strictEqual(r.draft.ref.match, 'nba:1');
});

test('bet365, «Crear apuesta»: cuatro selecciones del mismo partido con una sola cuota', () => {
  const r = scan(B365_BUILDER);
  assert.strictEqual(r.kind, 'builder');
  assert.strictEqual(r.draft.stake, 10);
  const legs = r.draft.legs;
  assert.deepStrictEqual(legs.map(l => l.ref?.key), [
    'spread|11||4.5', 'player|Triples anotados|de\'andre hunter|1.5', 'player|Asistencias|darius acuff jr.|6.5', 'player|Rebotes|domantas sabonis|9.5'
  ]);
  assert.strictEqual(legs[0].ref.out, 'a'); // SAC es el visitante
  assert.strictEqual(legs[0].selection, 'SAC +4.5');
  // Una sola cuota, la de la apuesta; las selecciones van sin la suya (0)
  assert.deepStrictEqual(legs.map(l => l.odds), [0, 0, 0, 0]);
  assert.strictEqual(r.draft.odds, 7);
  assert.match(r.draft.notes, /Crear apuesta de bet365/);
  const r2 = scan(B365_BUILDER2);
  assert.strictEqual(r2.draft.stake, 8.27);
  assert.strictEqual(r2.draft.legs.length, 2);
  assert.strictEqual(r2.warnings.length, 0);
});

test('lo que no se reconoce se queda sin enlazar, sin adivinar', () => {
  const r = linkTicket(parseTicket(WMX_TOTAL), GAMES.filter(g => g.id !== 'nba:1'), NOW);
  assert.deepStrictEqual(r.legs.map(l => l.linked), [false]);
  assert.strictEqual(r.draft.ref, undefined);
  assert.strictEqual(periodOf('19 cuarto - Hándicap'), 11);
  assert.strictEqual(periodOf('2ª mitad - Total'), 2);
});

test('si el OCR se come un equipo, vale el partido del otro, con aviso', () => {
  const text = B365_BUILDER.replace('M0 Celtics', 'BETA');
  const r = scan(text);
  assert.deepStrictEqual(r.legs.map(l => l.linked), [true, true, true, true]);
  assert.strictEqual(r.draft.legs[0].ref.match, 'nba:1');
  assert.match(r.warnings.join(' '), /un solo equipo: SAC @ BOS \(sólo se lee Sacramento Kings\)/);
});

// ---------- Tenis (Winamax) y fútbol (bet365) ----------
const pl = (name, short) => ({ name, short, alt: [] });
const club = (name, short) => ({ name, short, abbr: '', alt: [], alts: [] });
const MORE = [
  gameOf('tennis', { id: 't1', tournament: 'Challenger', date: '2026-11-20T15:00Z', a: pl('Inaki Montes de la Torre', 'I. Montes de la Torre'), b: pl('Harold Mayot', 'H. Mayot') }),
  gameOf('tennis', { id: 't2', tournament: 'Challenger', date: '2026-11-10T12:00Z', a: pl('Lui Maxted', 'L. Maxted'), b: pl('Hynek Barton', 'H. Barton') }),
  gameOf('tennis', { id: 't3', tournament: 'ATP', date: '2026-11-10T13:00Z', a: pl('Holger Rune', 'H. Rune'), b: pl('Zizou Bergs', 'Z. Bergs') }),
  gameOf('tennis', { id: 't4', tournament: 'WTA', date: '2026-10-20T10:00Z', a: pl('Katarzyna Kawa', 'K. Kawa'), b: pl('Daria Snigur', 'D. Snigur') }),
  // ESPN lo llama «Celta Vigo» y el ticket «Celta de Vigo»
  gameOf('football', { id: 'f1', leagueName: 'LaLiga', date: '2026-11-21T20:00Z', home: club('Real Madrid', 'Real Madrid'), away: club('Celta Vigo', 'Celta') }),
  gameOf('football', { id: 'f2', leagueName: 'LaLiga', date: '2026-11-21T17:30Z', home: club('Sevilla', 'Sevilla'), away: club('Real Betis', 'Betis') })
];
const scan2 = text => linkTicket(parseTicket(text), MORE, NOW);

test('Winamax, tenis: «Ganador I. Montes de la Torr» (el nombre cortado por la casa)', () => {
  const r = scan2(`Simple e
201 G ————
Inaki Montes de la Torre LE
Harold Mayot [E
Ganador |. Montes de la Torr [2,05 ]
Importe ————————————_—_—_—_r_r_cnc” ..— 10,76€
Gananciss ————————....— ,00€
Ref: DDDDDDDD / 4444444444 16:21 - 20 noviembre 2026`);
  assert.strictEqual(r.draft.stake, 10.76);
  assert.strictEqual(r.draft.odds, 2.05);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key, r.draft.ref.out], ['t1', 'moneyline|0||', 'a']);
});

test('Winamax, combinada de tenis y fútbol cerrada: lo cobrado, y el partido que no tenemos se queda sin enlazar', () => {
  const r = scan2(`Combinada (3) € % . ME
Cashout Y 4
—Ñ ———;;;——].>  —][———] —].o_——o——————————]; O

101 $
Lui Maxted [E

Hynek Barton 734

Ganador L. Maxted 1,68
101 $
Holger Rune 6 6

Zizou Bergs 3 4

Ganador H. Rune 1,66
NN DO

Cp Mijas-Las Lagunas 1-2 Real Jaén

Resultado Real Jaén 1,78
mal JD
[Ly] oe € == TZ Ss<ES=SSS SCS. UA:
Ganancias ————————........— 15,38€
Ref: EEEEEEEE / 5555555555 15:43 - 10 noviembre 2026`);
  assert.strictEqual(r.draft.status, 'cashout');
  assert.strictEqual(r.draft.cashout, 15.38);
  assert.strictEqual(r.draft.odds, 4.96);
  assert.deepStrictEqual(r.legs.map(l => l.linked), [true, true, false]);
  assert.deepStrictEqual(r.draft.legs.slice(0, 2).map(l => [l.ref.match, l.ref.out]), [['t2', 'a'], ['t3', 'a']]);
  assert.strictEqual(r.draft.legs[2].odds, 1.78);
});

test('Winamax, tenis: hándicap de juegos; «Resultado : 13-12» no es otra selección', () => {
  const r = scan2(`Simple . A
—————— 0/10 $
Katarzyna Kawa LE
Daria Snigur 6 24
Hándicap de juegos K. Kawa +5.5 [1,60 |
Resultado : 13-12
Importe ——————————— o 14,00€
Gananciss ———————————————.....— 22,40€
Ref: FFFFFFFF / 6666666666 12:30 - 20 octubre 2026`);
  assert.strictEqual(r.legs.length, 1);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key, r.draft.ref.out, r.draft.stake], ['t4', 'spread|0||5.5', 'a', 14]);
});

test('bet365, fútbol: paradas del portero, con el mercado que resuelve settle.js', () => {
  const r = scan2(`GANADOR

10,00€ Simple
Y Thibaut Courtois - Más de 2.5 2.75

Paradas del portero - Otras opciones

———————————————ol—l—o—;o;—o—lol]ZZo;—Z—————————
Y Real Madrid 2
5 Celta de vigo 1
Imp: Ganancias
10,00€ 27,50€ (Y) 27,50€ Ganancias`);
  assert.strictEqual(r.draft.odds, 2.75);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key], ['f1', 'wmx|Realiza 3 o más paradas|']);
  assert.strictEqual(r.draft.selection, 'Thibaut Courtois'); // la resolución busca al jugador por la selección
});

test('bet365, «Crear apuesta» de fútbol: ambos marcan, tarjetas, faltas; un aumento de ganancias no cambia el importe', () => {
  const r = scan2(`GANADOR

12,60€ Crear apuesta
% CREAR APUESTA 2.90

Ambos equipos anotarán

Ambos equipos anotarán

Ambos equipos recibirán 2 tarjetas o más

Ambos equipos recibirán 2 o más tarjetas

Más de 5 tarjetas

Total de tarjetas - 3 opciones

Juan Iglesias - 1+ faltas cometidas

Jugador - Faltas concedidas - Otras opciones

Danes rro
E sevilla E
TP Real Betis E
50% DE "AUMENTO DE GANANCIAS"
Imp: Ganancias
12,60€ 48,51€ ind aumento del 11.97€ O) 48,51€ Ganancias`);
  assert.strictEqual(r.draft.stake, 12.6);
  assert.strictEqual(r.warnings.length, 0);
  assert.deepStrictEqual(r.draft.legs.map(l => l.ref?.key ?? null), ['btts|0||', 'cards_both|0||2', 'cards|0||5.5', 'wmx|Comete 1 o más faltas|']);
  assert.strictEqual(r.draft.legs[0].ref.out, 'yes');
  assert.strictEqual(r.draft.legs[0].ref.match, 'f2');
  assert.strictEqual(r.draft.legs[3].selection, 'Juan Iglesias');
});

test('bet365, amonestados (con un sustituto en medio)', () => {
  const r = scan2(`5,00€ Crear apuesta Perdida
% CREAR APUESTA 7.75

Youssouf Fofana será Amonestado

Jugador - Será amonestado A

Lo) [

A Robbie Ure será Amonestado

Y tueasStassin

Jugador - Será amonestado 1

Lo) [
Y sevilla 1
Y Real Betis 1
Imp:
5,00€ 0,00€ Ganancias 0,00€`);
  assert.strictEqual(r.draft.stake, 5);
  assert.deepStrictEqual(r.draft.legs.map(l => [l.ref?.key, l.selection]), [
    ['wmx|El jugador recibe una o más tarjetas|', 'Youssouf Fofana'], ['wmx|El jugador recibe una o más tarjetas|', 'Robbie Ure']
  ]);
});

test('bet365, «Más de 4.5» con el mercado debajo («Total de goles»)', () => {
  const r = scan2(`6,01€ Simple Perdida
S% Más de 4.5 3.00

Total de goles a

———]————————[———— V E 1
Y Real Madrid 2
5 Celta de vigo 1
Imp:
6,01€ 0,00€ Ganancias 0,00€`);
  assert.strictEqual(r.draft.stake, 6.01);
  assert.strictEqual(r.draft.odds, 3);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key, r.draft.ref.out, r.draft.market], ['f1', 'total|0||4.5', 'over', 'Total de goles']);
});

test('bet365, «Ambos equipos recibirán 2 tarjetas o más» con su propio mercado', () => {
  const r = scan2(`5,00€ Simple
Y Ambos equipos recibirán 2 tarjetas o más 2.10

Ambos equipos recibirán 2 o más tarjetas
E sevilla 1
Y Real Betis 1
Imp:
5,00€ 10,50€`);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key, r.draft.ref.out, r.draft.selection], ['f2', 'cards_both|0||2', 'yes', 'Sí']);
});

test('bet365, sólo el equipo y la cuota con «Resultado final» debajo: ganador (y el empate)', () => {
  const games = [...MORE, gameOf('football', { id: 'f3', leagueName: 'LaLiga', date: '2026-11-22T13:00Z', home: club('Barcelona', 'Barcelona'), away: club('Villarreal', 'Villarreal') })];
  const text = `20,00€ Simple
Y Barcelona 2.00

Resultado final
“| Barcelona 3
ff villarreal 2
Imp: Ganancias
20,00€ 40,00€ (Y) 40,00€ Ganancias`;
  const r = linkTicket(parseTicket(text), games, NOW);
  assert.strictEqual(r.draft.stake, 20);
  assert.strictEqual(r.draft.odds, 2);
  assert.deepStrictEqual([r.draft.ref.match, r.draft.ref.key, r.draft.ref.out, r.draft.market], ['f3', 'moneyline|0||', 'a', 'Resultado']);
  const draw = linkTicket(parseTicket(text.replace('Y Barcelona 2.00', 'Y Empate 3.40')), games, NOW);
  assert.deepStrictEqual([draw.draft.ref.key, draw.draft.ref.out, draw.draft.odds], ['moneyline|0||', 'x', 3.4]);
});

// Apuestas guardadas sin partido (apuntadas a mano o desde un sitio que no lo guardaba): la resolución las enlaza por el texto
test('una selección sin partido se enlaza por el texto, y sólo si no hay dudas', () => {
  const games = [...MORE, gameOf('football', { id: 'f4', leagueName: 'LaLiga', date: '2026-11-22T14:15Z', home: club('Racing Santander', 'Racing'), away: club('Real Sociedad', 'Real Sociedad') })];
  const leg = { event: 'Racing Santander - Real Sociedad', market: 'Total de goles', selection: 'Más de 2.5' };
  assert.deepStrictEqual(guessRef(leg, games, '2026-11-22'), { sport: 'football', match: 'f4', key: 'total|0||2.5', out: 'over', start: '2026-11-22T14:15Z', guessed: true });
  assert.deepStrictEqual(guessRef({ event: 'Racing Santander - Real Sociedad', market: 'Resultado', selection: 'Real Sociedad' }, games, '2026-11-22')?.out, 'b');
  assert.strictEqual(guessRef({ ...leg, market: 'Mercado raro', selection: 'Algo' }, games, '2026-11-22'), null); // mercado que no se reconoce
  assert.strictEqual(guessRef({ ...leg, event: 'Racing Santander - Osasuna' }, games, '2026-11-22'), null); // sólo un equipo: no
});
