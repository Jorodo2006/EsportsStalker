// Flechas de subida y bajada de las cuotas a partir del histórico (movesOf en BasketOdds.tsx)
import { describe, expect, it } from 'vitest';
import { movesOf } from './BasketOdds';

const row = (book: string, price: number, hoursAgo: number, outcome = 'over') =>
  ({ book, market_key: 'player|Puntos|ziaire williams|9.5', outcome_id: outcome, line: 9.5, price, ts: Date.now() - hoursAgo * 3600e3, last_seen: Date.now() });
const K = (book: string, outcome = 'over') => `${book}|player|Puntos|ziaire williams|9.5|${outcome}`;

describe('movesOf', () => {
  it('la última cuota frente a la anterior distinta (el caso de Williams: 2,35 → 2,05)', () => {
    const m = movesOf([row('betway', 2.3, 3), row('betway', 2.35, 2), row('betway', 2.05, 1)]);
    expect(m.get(K('betway'))).toMatchObject({ now: 2.05, before: 2.35 });
  });
  it('sin cambios no hay flecha, y cada casa y selección va por su lado', () => {
    const m = movesOf([row('winamax', 1.96, 3), row('winamax', 1.96, 1), row('betway', 1.8, 2, 'under'), row('betway', 1.9, 1, 'under')]);
    expect(m.has(K('winamax'))).toBe(false);
    expect(m.get(K('betway', 'under'))).toMatchObject({ now: 1.9, before: 1.8 });
  });
  it('un cambio de hace más de un día no cuenta', () => {
    expect(movesOf([row('betway', 2.3, 40), row('betway', 2.1, 30)]).size).toBe(0);
  });
});
