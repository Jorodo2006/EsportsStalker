// Valor común a los deportes (value.ts): quitar el margen, mezclar con la casa y el veredicto. Lo que se rompa aquí cambia
// lo que la app dice que hay que apostar en todas las pantallas
import { describe, expect, it } from 'vitest';
import { blendWithMarket, devig, devigBooks, lineProbs, sideValue, verdict, verdictOf } from './value';

describe('devig', () => {
  it('con las dos cuotas quita el margen exacto', () => {
    const d = devig(1.86, 1.76);
    expect(d.exact).toBe(true);
    expect(d.over! + d.under!).toBeCloseTo(1, 10);
    expect(d.margin).toBeCloseTo(1 / 1.86 + 1 / 1.76 - 1, 10);
  });
  it('con una sola cuota estima el margen y no inventa el otro lado', () => {
    const d = devig(2.3, null);
    expect(d.exact).toBe(false);
    expect(d.under).toBeNull();
    expect(d.over!).toBeLessThan(1 / 2.3);
  });
});

describe('devigBooks', () => {
  // El caso de Reaves (noviembre de 2026): el más de Betway y el menos de Winamax juntos daban un margen del 0,3 %
  const books = [{ over: 1.86, under: 1.76 }, { over: 2.3 }];

  it('quita el margen a cada casa por separado', () => {
    const mixed = devig(2.3, 1.76), byBook = devigBooks(books);
    expect(mixed.margin!).toBeLessThan(0.01);
    expect(byBook.margin!).toBeGreaterThan(0.1);
    expect(byBook.under!).toBeLessThan(mixed.under!);
    expect(byBook.over! + byBook.under!).toBeCloseTo(1, 10);
  });
  it('no depende del orden ni de qué cuota se esté mirando', () => {
    expect(devigBooks([...books].reverse()).under).toBeCloseTo(devigBooks(books).under!, 12);
  });
  it('las casas que sólo dan un lado pesan la mitad', () => {
    const one = devigBooks([{ over: 1.86, under: 1.76 }]).over!, other = devig(2.3, null).over!;
    expect(devigBooks(books).over).toBeCloseTo((one + 0.5 * other) / 1.5, 12);
  });
  it('sin cuotas no da probabilidad', () => {
    expect(devigBooks([{}]).over).toBeNull();
  });
});

describe('blendWithMarket', () => {
  it('con peso 0 es la casa y la mezcla queda entre los dos', () => {
    expect(blendWithMarket(0.7, 0.5, 0)).toBeCloseTo(0.5, 10);
    const p = blendWithMarket(0.7, 0.5, 0.3);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.7);
  });
  it('hacia los extremos el modelo pesa menos', () => {
    const near = blendWithMarket(0.2, 0.1, 0.3) - 0.1, mid = blendWithMarket(0.6, 0.5, 0.3) - 0.5;
    expect(near / 0.1).toBeLessThan(mid / 0.1);
  });
});

describe('veredicto', () => {
  it('un solo criterio: Apostar, Valor ligero o No apostar', () => {
    expect(verdictOf(0.02, 55)).toBe('BET');
    expect(verdictOf(0.019, 80)).toBe('LEAN');
    expect(verdictOf(0.05, 50)).toBe('LEAN');
    expect(verdictOf(0.05, 44)).toBe('PASS');
    expect(verdictOf(0.009, 90)).toBe('PASS');
  });
  it('si el modelo se aleja demasiado de la casa no se apuesta, aunque el valor salga alto', () => {
    const s = sideValue('under', 0.69, 0, 1.96, 0.31, 'Winamax', 1); // el modelo 69 %, la casa 31 %
    expect(s.ev).toBeGreaterThan(0.3);
    expect(verdict([s], 80, 37.5, 'under').code).toBe('PASS');
  });
  it('sin cuotas dice la tendencia', () => {
    expect(verdict([], 70, 9.5, 'over').code).toBe('NOODDS');
  });
});

describe('lineProbs', () => {
  it('más, menos y nula suman 1, con y sin nula', () => {
    for (const [mu, sd, line] of [[4, 2.2, 3.5], [4, 2.2, 4], [24, 6, 24.5], [24, 6, 25]]) {
      const p = lineProbs(mu, sd, line);
      expect(p.over + p.under + p.push).toBeCloseTo(1, 6);
      if (line % 1) expect(p.push).toBe(0);
    }
  });
});
