// Por qué sale arriba una apuesta, en una línea. Se confundía la probabilidad (lo a menudo que acierta) con la fiabilidad
// (cuánto fiarse del cálculo) y con el valor (si la cuota paga más de lo que debería): «¿por qué recomienda la de 55 % y no
// la de 63 %?». En baloncesto la de arriba se elige por el valor; en tenis, fútbol y MMA es la más fiable, que puede pagar poco
import { cn } from '@/lib/format';

const p0 = (v: number) => `${Math.round(v * 100)} %`;

export function pickWhyText(p: number, ev: number, rel: number, by: 'value' | 'reliability') {
  const per100 = Math.round(ev * 100);
  const money = per100 > 0 ? `se esperan +${per100} €` : per100 < 0 ? `se pierden ${-per100} €` : 'ni se gana ni se pierde';
  const head = by === 'value' ? 'Elegida por el valor, no por ser la más probable' : `Elegida por ser la más fiable del cálculo (${rel}/100)`;
  const tail = by === 'value'
    ? ` La fiabilidad (${rel}/100) es cuánto fiarse del cálculo.`
    : per100 < 0 ? ' La casa paga poco: es la más segura, no la que más da.' : '';
  return `${head}: acierta el ${p0(p)} de las veces y, a esta cuota, a la larga ${money} de cada 100 € apostados.${tail}`;
}

export function PickWhy({ p, ev, rel, by, className }: { p: number; ev: number; rel: number; by: 'value' | 'reliability'; className?: string }) {
  return <p className={cn('text-[12px] leading-snug text-zinc-400', className)}>{pickWhyText(p, ev, rel, by)}</p>;
}

// Debajo del título de «Más fáciles»: aciertan más, pero pagan poco
export const EASY_HINT = 'aciertan más a menudo, pero con valor negativo la casa paga poco y a la larga se pierde';
