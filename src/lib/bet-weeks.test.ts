import { describe, expect, it } from 'vitest';
import { addDays, addWeeks, betDates, dayLabel, groupByDay, groupByWeek, isDate, latestWeekWithBets, monthGrid, todayStr, weekDays, weekLabel, weekStart } from './bet-weeks';
import type { Bet } from './types';

let n = 0;
const bet = (date: string, over: Partial<Bet> = {}): Bet => ({
  id: String(++n).padStart(4, '0'), date, league: 'NBA', event: 'A @ B', market: 'Total', selection: 'Más de 1,5', bookmaker: 'Winamax',
  odds: 2, stake: 10, status: 'won', cashout: 0, ...over
} as Bet);

describe('weekStart', () => {
  it('devuelve el lunes de la semana', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(weekStart('2024-02-29')).toBe('2024-02-26');
  });
  it('fechas inválidas dan cadena vacía', () => {
    for (const d of ['', '2026-13-45', 'hoy', '2026-02-30']) expect(weekStart(d)).toBe('');
  });
});

describe('isDate / addDays / addWeeks / weekDays', () => {
  it('comprueba que el día existe', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2024-02-29')).toBe(true);
  });
  it('suma días y semanas sin saltos de año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addWeeks('2026-11-16', -1)).toBe('2026-11-09');
    const d = weekDays('2026-11-16');
    expect(d).toHaveLength(7);
    expect(d[0]).toBe('2026-11-16');
    expect(d[6]).toBe('2026-11-22');
  });
});

describe('etiquetas', () => {
  it('weekLabel', () => {
    expect(weekLabel('2026-11-16')).toBe('16 – 22 nov');
    expect(weekLabel('2026-10-26')).toBe('26 oct – 1 nov');
    expect(weekLabel('2026-12-28')).toBe('28 dic 2026 – 3 ene 2027');
  });
  it('dayLabel', () => {
    expect(dayLabel('2026-11-19')).toBe('Jueves 19 de noviembre');
    expect(dayLabel('2026-11-16')).toBe('Lunes 16 de noviembre');
  });
});

describe('groupByDay', () => {
  it('agrupa por día, del más reciente al más antiguo', () => {
    const g = groupByDay([bet('2026-11-17'), bet('2026-11-19'), bet('2026-11-19')]);
    expect(g).toHaveLength(2);
    expect(g[0].date).toBe('2026-11-19');
    expect(g[0].bets).toHaveLength(2);
    expect(g[0].bets[0].id > g[0].bets[1].id).toBe(true);
  });
  it('el beneficio suma betProfit y los pendientes se cuentan aparte', () => {
    const [g] = groupByDay([
      bet('2026-11-19', { status: 'won' }), bet('2026-11-19', { status: 'lost' }), bet('2026-11-19', { status: 'void' }),
      bet('2026-11-19', { status: 'pending', stake: 8 }), bet('2026-11-19', { status: 'pending', stake: 12 })
    ]);
    expect(g.profit).toBe(0);
    expect(g.pending).toBe(2);
    expect(g.pendingStake).toBe(20);
    expect(groupByDay([bet('2026-11-19', { status: 'won' })])[0].profit).toBe(10);
    expect(groupByDay([bet('2026-11-19', { status: 'lost' })])[0].profit).toBe(-10);
  });
});

describe('groupByWeek', () => {
  it('agrupa por semana con sus días', () => {
    const g = groupByWeek([bet('2026-11-16'), bet('2026-11-19'), bet('2026-11-09', { status: 'lost' })]);
    expect(g.map(x => x.start)).toEqual(['2026-11-16', '2026-11-09']);
    expect(g[0].days).toHaveLength(2);
    expect(g[0].count).toBe(2);
    expect(g[1].count).toBe(1);
    expect(g[0].profit).toBe(g[0].days.reduce((s, d) => s + d.profit, 0));
    expect(g[1].profit).toBe(-10);
  });
  it('domingo y lunes caen en semanas distintas', () => {
    const g = groupByWeek([bet('2026-11-22'), bet('2026-11-23')]);
    expect(g.map(x => x.start)).toEqual(['2026-11-23', '2026-11-16']);
  });
  it('las fechas inválidas van al final como «sin fecha»', () => {
    const g = groupByWeek([bet(''), bet('xx'), bet('2026-11-19')]);
    expect(g).toHaveLength(2);
    expect(g[1].start).toBe('');
    expect(g[1].count).toBe(2);
    expect(groupByWeek([])).toEqual([]);
  });
});

describe('monthGrid', () => {
  it('noviembre de 2026 (empieza en domingo y acaba en lunes): 6 filas, lunes primero', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(6);
    expect(g.every(r => r.length === 7)).toBe(true);
    expect(g[0][0]).toBe('2026-10-26');
    expect(g[0][6]).toBe('2026-11-01');
    expect(g[5][0]).toBe('2026-11-30');
    expect(g[5][6]).toBe('2026-12-06');
  });
  it('un mes que empieza en domingo arranca en el lunes anterior', () => {
    expect(monthGrid(2026, 1)[0][0]).toBe('2026-01-26');
  });
});

describe('betDates / latestWeekWithBets / todayStr', () => {
  it('betDates ignora las fechas inválidas', () => {
    expect([...betDates([bet('2026-11-19'), bet(''), bet('xx'), bet('2026-11-19')])]).toEqual(['2026-11-19']);
  });
  it('latestWeekWithBets', () => {
    const l = [bet('2026-11-04'), bet('2026-11-19')];
    expect(latestWeekWithBets(l)).toBe('2026-11-16');
    expect(latestWeekWithBets(l, '2026-11-16')).toBe('2026-11-02');
    expect(latestWeekWithBets([], '2026-11-16')).toBeNull();
    expect(latestWeekWithBets([bet('')])).toBeNull();
  });
  it('todayStr usa la fecha local', () => {
    expect(todayStr(new Date(2026, 10, 19, 12, 0, 0).getTime())).toBe('2026-11-19');
    expect(todayStr(new Date(2026, 10, 19, 23, 59, 0).getTime())).toBe('2026-11-19');
  });
});
