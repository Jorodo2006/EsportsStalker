// Recomendaciones de baloncesto con una sola casa: la cuota y la probabilidad de la casa salen sólo de ella, y lo que no tiene no sale
import { describe, expect, it } from 'vitest';
import { onlyBook } from './basket-picks';
import type { MatchOdds } from './types';

const odds: MatchOdds = {
  books: ['Winamax', 'Betway'],
  sources: {},
  markets: [
    { key: 'total|0||220.5', group: 'Total de puntos', period: 0, line: 220.5, main: true, outcomes: [
      { id: 'over', label: 'Más de 220.5', prices: { Winamax: 1.85, Betway: 1.95 } },
      { id: 'under', label: 'Menos de 220.5', prices: { Winamax: 1.95, Betway: 1.85 } }
    ] },
    { key: 'player|Puntos|nikola jokic|27.5', group: 'Puntos · Nikola Jokic', period: 0, line: 27.5, main: false, outcomes: [
      { id: 'over', label: 'Más de 27.5', prices: { Betway: 1.9 } },
      { id: 'under', label: 'Menos de 27.5', prices: { Betway: 1.9 } }
    ] }
  ]
};

describe('onlyBook', () => {
  it('deja sólo las cuotas de esa casa', () => {
    const w = onlyBook(odds, 'Winamax');
    expect(w.books).toEqual(['Winamax']);
    expect(w.markets.map(m => m.key)).toEqual(['total|0||220.5']); // la línea de Jokic sólo la tiene Betway
    expect(w.markets[0].outcomes.map(o => o.prices)).toEqual([{ Winamax: 1.85 }, { Winamax: 1.95 }]);
  });
  it('con Betway salen las dos líneas, con sus cuotas', () => {
    const b = onlyBook(odds, 'Betway');
    expect(b.markets.map(m => m.key)).toEqual(['total|0||220.5', 'player|Puntos|nikola jokic|27.5']);
    expect(b.markets[0].outcomes[0].prices).toEqual({ Betway: 1.95 });
  });
  it('con las dos, tal cual (el mismo objeto: no se recalcula nada)', () => {
    expect(onlyBook(odds, 'all')).toBe(odds);
  });
});
