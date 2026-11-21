// Piezas comunes de las recomendaciones de los cinco deportes, para que todas se lean igual: probabilidad y valor con su
// nombre debajo, la cuota con su casa entera y una ayuda (ⓘ) que explica cada cifra. Antes cada deporte lo pintaba a su
// manera: en baloncesto las cifras iban sueltas («52 %», «+8,3 %», «2.10») y el tenis sí ponía «prob.» y «cuota»
import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { Dialog } from './ui';

export const p0 = (v: number) => `${Math.round(v * 100)} %`;
export const signed = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;

const label = 'block text-[10.5px] leading-3 text-zinc-500';

// Probabilidad y valor, una columna cada una. good: tiene valor de verdad (hasValue), en el color de la marca
export function PickNums({ p, ev, good }: { p: number; ev: number; good: boolean }) {
  return <>
    <span className="w-11 shrink-0 text-right" title="Probabilidad: lo a menudo que debería salir, según el modelo mezclado con la casa">
      <span className="block font-score text-[17px] font-bold leading-5 text-zinc-50 tnum">{p0(p)}</span>
      <span className={label}>prob.</span>
    </span>
    <span className="w-[52px] shrink-0 text-right" title="Valor esperado por cada euro apostado con esta probabilidad y esta cuota. Si es negativo, a la larga gana la casa">
      <span className={cn('block whitespace-nowrap font-score text-[13px] font-semibold leading-5 tnum', good ? 'text-[var(--tv-mark)]' : ev > 0 ? 'text-zinc-200' : 'text-zinc-500')}>{signed(ev)}</span>
      <span className={label}>valor</span>
    </span>
  </>;
}

// La cuota como botón que la añade al cupón, con la casa debajo (entera: «W...» no dice nada)
export function PickOdd({ price, book, fair, onAdd }: { price: number; book?: string | null; fair?: number; onAdd: () => void }) {
  return (
    <button onClick={onAdd} title={`Añadir al cupón${book ? `: ${book}` : ''}${fair ? `. Cuota justa ${odd(fair)}` : ''}`} aria-label={`Añadir al cupón: cuota ${odd(price)}${book ? ` en ${book}` : ''}`}
      className="flex h-10 w-16 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg bg-zinc-800 text-zinc-50 transition hover:bg-zinc-700 hover:text-[var(--tv-mark)]">
      <span className="font-score text-[16px] font-bold leading-none tnum">{odd(price)}</span>
      <span className="mt-0.5 max-w-full truncate px-1 text-[10px] leading-tight text-zinc-400">{book || 'cuota'}</span>
    </button>
  );
}

// La cuota en una fila que entera es un botón (las más fiables del día): la cifra y la casa, sin ser otro botón
export function PickOddText({ price, book }: { price: number; book?: string | null }) {
  return (
    <span className="w-14 shrink-0 text-right">
      <span className="block font-score text-[17px] font-bold leading-5 text-zinc-50 tnum">{odd(price)}</span>
      <span className={cn(label, 'truncate')}>{book || 'cuota'}</span>
    </span>
  );
}

// ⓘ junto al título de las recomendaciones: qué es cada cifra. La ventana va dentro de un span que deshace el estilo del
// título donde se pone (truncate, negrita de 24 px): si no, el texto no se partía y se salía por la derecha. Probabilidad, fiabilidad y valor se confunden mucho
// (AGENTS.md: «No confundas en la interfaz probabilidad, fiabilidad del cálculo y valor»)
export function PickHelp() {
  const [open, setOpen] = useState(false);
  const item = (t: string, d: string) => <div><dt className="text-sm font-semibold text-zinc-100">{t}</dt><dd className="mt-0.5 text-sm leading-relaxed text-zinc-400">{d}</dd></div>;
  return <>
    <button type="button" onClick={() => setOpen(true)} title="Qué significa cada cifra" aria-label="Qué significa cada cifra"
      className="inline-grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md align-middle text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100">
      <Info size={16} />
    </button>
    <span className="whitespace-normal text-left text-base font-normal tracking-normal">
    <Dialog open={open} onClose={() => setOpen(false)} title="Cómo leer una recomendación">
      <dl className="flex flex-col gap-4">
        {item('Prob. (probabilidad)', 'Lo a menudo que debería salir: 60 % es 6 de cada 10 veces. Sale del modelo mezclado con lo que dicen las casas sin su margen, y las casas pesan más.')}
        {item('Valor', 'Lo que ganarías de media por cada euro si la probabilidad es buena: +5 % son 5 céntimos por euro a la larga. Si es negativo, a la larga gana la casa. «Con valor» es de +2 % o más y con un cálculo de fiar.')}
        {item('Cuota y casa', 'La mejor cuota que hay ahora entre Winamax y Betway, y en qué casa está. Púlsala para añadirla al cupón.')}
        {item('Cuota justa', 'La que debería pagar según la probabilidad. Si la casa paga más que la justa, hay valor.')}
        {item('Fiabilidad del cálculo', 'De 0 a 100, cuánto fiarse de la probabilidad: baja con pocos partidos, con bajas recientes o cuando el modelo y la casa no coinciden. No es lo mismo que la probabilidad: algo muy probable puede estar mal calculado.')}
        {item('Más fáciles, equilibradas y complicadas', 'Las mismas recomendaciones por riesgo: las fáciles salen a menudo y pagan poco; las complicadas, al revés.')}
      </dl>
      <p className="mt-5 border-t border-zinc-800 pt-4 text-xs text-zinc-500">Es una estimación, no una garantía. Apuesta sólo lo que puedas permitirte perder.</p>
    </Dialog>
    </span>
  </>;
}

// El título de un panel de recomendaciones con su ⓘ
export const PicksTitle = ({ children = 'Recomendaciones' }: { children?: string }) => <span className="inline-flex items-center gap-1.5">{children}<PickHelp /></span>;
