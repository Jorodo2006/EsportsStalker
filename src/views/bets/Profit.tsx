import { useCurrency, useUnit } from '@/lib/app-context';
import { cn, money, units } from '@/lib/format';

// El beneficio en dinero y, entre paréntesis, en unidades, como lo cuentan los tipsters que no quieren enseñar cuánto apuestan.
// La unidad es la de Tu cuenta o el 1 % de la banca inicial (useUnit); sin ninguna de las dos, sólo el dinero. Lo usan Mis apuestas
// (BetsView), el historial y sus filas (History, BetRow)
export function useProfit() {
  const cur = useCurrency(), unit = useUnit();
  return (v: number) => ({ money: money(v, cur, true), units: unit > 0 ? units(v / unit) : '' });
}
export const profitString = (p: { money: string; units: string }) => (p.units ? `${p.money} (${p.units})` : p.money);

// stacked: las unidades en su línea, debajo (donde no cabe todo en una)
export function ProfitText({ value, unitsClass, stacked }: { value: number; unitsClass?: string; stacked?: boolean }) {
  const p = useProfit()(value);
  return <><span className="whitespace-nowrap">{p.money}</span>{p.units && <> <span className={cn('whitespace-nowrap text-[0.85em] font-normal opacity-75', stacked && 'block text-[11px]', unitsClass)}>({p.units})</span></>}</>;
}
