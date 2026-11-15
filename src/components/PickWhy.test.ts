// El texto que explica por qué sale arriba una apuesta
import { describe, expect, it } from 'vitest';
import { pickWhyText } from './PickWhy';

describe('pickWhyText', () => {
  it('la de baloncesto se explica por el valor (el caso de Watson: 55 % a 1,98)', () => {
    const t = pickWhyText(0.55, 0.55 * 1.98 - 1, 55, 'value');
    expect(t).toContain('Elegida por el valor');
    expect(t).toContain('acierta el 55 %');
    expect(t).toContain('se esperan +9 €');
    expect(t).toContain('La fiabilidad (55/100)');
  });
  it('la más fiable que paga poco lo dice', () => {
    const t = pickWhyText(0.63, 0.63 * 1.56 - 1, 72, 'reliability');
    expect(t).toContain('la más fiable del cálculo (72/100)');
    expect(t).toContain('se pierden 2 €');
    expect(t).toContain('es la más segura, no la que más da');
  });
});
