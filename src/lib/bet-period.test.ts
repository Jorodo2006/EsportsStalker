import { describe, expect, it } from 'vitest';
import { inPeriod, periodBounds, periodGroups, periodLabel } from './bet-period';

// Filtro por fechas del historial de Mis apuestas
describe('periodos del historial', () => {
  const today = '2026-11-18';
  it('los últimos 7 y 30 días cuentan hoy y cruzan de mes', () => {
    expect(periodBounds('d7', today)).toEqual(['2026-11-12', '2026-11-18']);
    expect(periodBounds('d30', today)).toEqual(['2026-10-20', '2026-11-18']);
    expect(periodBounds('d7', '2026-03-02')).toEqual(['2026-02-24', '2026-03-02']);
  });
  it('un mes y un año cogen sus días y nada más', () => {
    const feb = periodBounds('m:2026-02', today);
    expect(inPeriod('2026-02-01', feb)).toBe(true);
    expect(inPeriod('2026-02-28', feb)).toBe(true);
    expect(inPeriod('2026-03-01', feb)).toBe(false);
    expect(inPeriod('2026-01-31', feb)).toBe(false);
    const y = periodBounds('y:2025', today);
    expect(inPeriod('2025-12-31', y)).toBe(true);
    expect(inPeriod('2026-01-01', y)).toBe(false);
  });
  it('entre dos fechas: con una sola no tiene límite por el otro lado, y al revés también vale', () => {
    expect(periodBounds('range', today, '2026-11-03', '2026-11-10')).toEqual(['2026-11-03', '2026-11-10']);
    expect(periodBounds('range', today, '2026-11-10', '2026-11-03')).toEqual(['2026-11-03', '2026-11-10']);
    expect(inPeriod('2030-01-01', periodBounds('range', today, '2026-11-03'))).toBe(true);
    expect(periodBounds('range', today)).toBeNull();
  });
  it('sin periodo, o con una clave que no es, pasa todo', () => {
    expect(periodBounds('', today)).toBeNull();
    expect(periodBounds('m:noviembre', today)).toBeNull();
    expect(inPeriod('2020-05-05', null)).toBe(true);
  });
  it('el selector ofrece sólo los años y meses con apuestas, lo más nuevo primero', () => {
    expect(periodGroups(['2026-10-02', '2025-12-24', '2026-11-18', '2026-10-30', 'basura'])).toEqual([
      { year: '2026', months: [{ key: 'm:2026-11', label: 'Noviembre 2026' }, { key: 'm:2026-10', label: 'Octubre 2026' }] },
      { year: '2025', months: [{ key: 'm:2025-12', label: 'Diciembre 2025' }] }
    ]);
  });
  it('cada periodo tiene su nombre para el resumen', () => {
    expect(periodLabel('m:2026-11')).toBe('Noviembre 2026');
    expect(periodLabel('y:2026')).toBe('Todo 2026');
    expect(periodLabel('d7')).toBe('Últimos 7 días');
    expect(periodLabel('range', '2026-11-03')).toBe('Desde el 03/11/26');
    expect(periodLabel('')).toBe('');
  });
});
