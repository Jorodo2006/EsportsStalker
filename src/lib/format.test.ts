import { describe, expect, it } from 'vitest';
import { decEs, decimal, k, odd } from './format';

// Coma decimal en todo lo que se enseña: cuotas, líneas y cifras (antes «2.10» convivía con «4,5 puntos»)
describe('formato decimal', () => {
  it('las cuotas y las cifras van con coma', () => {
    expect(odd(2.1)).toBe('2,10');
    expect(odd(null)).toBe('–');
    expect(decimal(3.456)).toBe('3,5');
    expect(decimal(1.5, 2)).toBe('1,50');
    expect(k(12340)).toBe('12,3k');
  });
  it('decEs cambia el punto decimal de los textos del servidor y nada más', () => {
    expect(decEs('MEM -9.5')).toBe('MEM -9,5');
    expect(decEs('Más de 220.5 puntos')).toBe('Más de 220,5 puntos');
    expect(decEs('Gen.G')).toBe('Gen.G');
    expect(decEs('1.ª parte · Total')).toBe('1.ª parte · Total');
    expect(decEs(undefined)).toBe('');
  });
});
