// Cuotas del marcador de Winamax. El ejemplo (fixtures/winamax-tenis.json) tiene la misma estructura que un envío real
// guardado en odds.imports (mismos campos del partido, de la apuesta "Ganador" y de sus salidas), recortado a tres
// mercados y con los datos de un partido de tenis: deporte 5, ganador del partido, ganador del 1er set y total de juegos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EloModel, normalizeOddsInput, scan } from '../src/index.js';

const raw = readFileSync(new URL('./fixtures/winamax-tenis.json', import.meta.url), 'utf8');
const envio = () => JSON.parse(raw);
const partido = (e) => e.state.matches[e.matchId];

test('Winamax: saca el ganador del partido del envío real del marcador', () => {
  const rows = normalizeOddsInput(raw, { surface: 'Clay', tournament: 'Challenger Montevideo' });
  assert.deepEqual(rows, [{
    p1: 'Pablo Llamas Ruiz', p2: 'Daniel Rincon', o1: 1.62, o2: 2.25,
    surface: 'Clay', tournament: 'Challenger Montevideo', start: '2026-11-14T11:00:00.000Z', bookmaker: 'Winamax',
  }]);
});

test('Winamax: no confunde el ganador del 1er set con el del partido', () => {
  const e = envio();
  delete partido(e).mainBetId; // sin la apuesta principal, y con la del set la primera de la lista
  const [r] = normalizeOddsInput(e);
  assert.equal(r.o1, 1.62);
  assert.equal(r.o2, 2.25);
});

test('Winamax: descarta directo, salidas cerradas y lo que no es tenis', () => {
  const live = envio();
  partido(live).status = 'LIVE';
  assert.deepEqual(normalizeOddsInput(live), []);
  const closed = envio();
  closed.state.outcomes['2298500002'].available = false;
  assert.deepEqual(normalizeOddsInput(closed), []);
  const basket = envio();
  partido(basket).sportId = 2;
  assert.throws(() => normalizeOddsInput(basket), /no es un partido de tenis/);
});

test('Winamax: varios envíos a la vez y emparejados con el modelo', () => {
  const otro = envio();
  otro.matchId = 73812346;
  otro.state.matches = { 73812346: { ...partido(envio()), matchId: 73812346, competitor1Name: 'Daniel Rincon', competitor2Name: 'Pablo Llamas Ruiz' } };
  const rows = normalizeOddsInput(JSON.stringify([envio(), otro]), { surface: 'Hard' });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].p1, 'Daniel Rincon');

  // Rincón ha ganado siempre: la casa lo paga a 2.25 en el primero, así que hay valor en él
  const m = new EloModel({ minMatches: 1 });
  for (let i = 0; i < 20; i++) {
    m.update({ date: '2026-01-01', surface: 'Hard', winnerId: 'r', winnerName: 'Daniel Rincon', loserId: 'l', loserName: 'Pablo Llamas Ruiz' });
  }
  const { opportunities, skipped } = scan(m, rows);
  assert.equal(skipped.length, 0);
  assert.equal(opportunities[0].pick, 'Daniel Rincon');
  assert.equal(opportunities[0].odds, 2.25);
  assert.equal(opportunities[0].bookmaker, 'Winamax');
});
