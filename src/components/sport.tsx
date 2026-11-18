// Piezas comunes de las tres apps (LoL, baloncesto y tenis) para ver partidos: título, tira de días, filtro por estado,
// bloque de competición con sus tarjetas, la sección En directo y el marcador grande del partido abierto.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarX, ChevronDown, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { Button, Empty, TeamLogo, chip, oddBtn, panelCls } from './ui';
import { useApp } from '@/lib/app-context';
import { SPORT_NAME, gamesWord, useLive } from '@/lib/live';
import type { Sport } from '@/lib/types';
import { sized, fallbackTo } from '@/lib/img';
import { FavStar } from './Favorites';

export type MatchState = 'pre' | 'live' | 'post';

// Punto rojo de "en juego"
export const LiveDot = ({ className }: { className?: string }) => <span aria-hidden className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400', className)} />;

// ---------- días ----------
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const today = () => isoDay(new Date());
// "Hoy", "Ayer", "Mañana" o "sáb 7"
export const dayName = (iso: string) => {
  const now = today();
  if (iso === now) return 'Hoy';
  if (iso === addDays(now, -1)) return 'Ayer';
  if (iso === addDays(now, 1)) return 'Mañana';
  const d = new Date(iso + 'T12:00:00');
  return `${d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} ${d.getDate()}`;
};

// ---------- lista vacía ----------
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// «Hoy», «Mañana» o «El sáb 21», para empezar una frase
const dayPhrase = (iso: string) => { const n = dayName(iso); return n === 'Hoy' || n === 'Ayer' || n === 'Mañana' ? n : `El ${n}`; };
export const noGamesText = (app: Sport, date: string) => `${dayPhrase(date)} no hay ${gamesWord(app)} de ${SPORT_NAME[app]}.`;

// El próximo día con partidos de un deporte después del elegido (dos semanas como mucho). Sólo se pide con la lista vacía
export function useNextDay(app: Exclude<Sport, 'lol'>, date: string, enabled: boolean) {
  const from = addDays(date, 1);
  const q = useQuery({ queryKey: [app, 'days', 'next', from], queryFn: () => window.api[app].days(from, 14), staleTime: 10 * 60e3, enabled });
  const hit = q.data && Object.entries(q.data).sort(([a], [b]) => (a < b ? -1 : 1)).find(([, c]) => c.total > 0);
  return hit ? { day: hit[0], count: hit[1].total } : null;
}

// Lista vacía de un deporte: qué pasa, dicho para el usuario, y por dónde seguir: el próximo día con partidos (next) y los
// otros deportes con partidos en juego ahora mismo. Antes sólo decía «Prueba otro día» o hablaba del «calendario cargado»
export function NoGames({ app, text, next, onDay, children }: {
  app: Sport; text: ReactNode; next?: { day: string; count: number } | null; onDay: (d: string) => void; children?: ReactNode;
}) {
  const { openList } = useApp();
  const { counts } = useLive();
  const others = (Object.keys(counts) as Sport[]).filter(x => x !== app && counts[x] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, 2);
  return (
    <Empty icon={<CalendarX size={22} />}>
      <p className="max-w-md text-zinc-300">{text}</p>
      {(!!next || !!others.length || !!children) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {next && <Button size="sm" onClick={() => onDay(next.day)}><span>Próximos: {cap(dayName(next.day))} · {next.count} {gamesWord(app, next.count)}</span></Button>}
          {others.map(x => (
            <Button key={x} size="sm" variant="secondary" onClick={() => openList(x)}>
              <span>{cap(SPORT_NAME[x])}</span><span className="text-rose-300 tnum">{counts[x]} en juego</span>
            </Button>
          ))}
          {children}
        </div>
      )}
    </Empty>
  );
}

// ---------- Partidos / Recomendaciones ----------
// El selector de arriba de baloncesto, tenis y fútbol. Antes eran dos botones pequeños con aspecto de filtro y la gente no
// veía que había recomendaciones (lo que más valor da de la app): ahora es un selector grande, con icono, y Recomendaciones va
// teñida del color del deporte. Mientras alguien no la haya abierto nunca en este navegador, da un pequeño salto al cargar
// (tres veces y se para: AGENTS.md no quiere cosas que laten sin fin; nada si el sistema pide menos movimiento)
const PICKS_SEEN = 'picks-seen';
export function ModeSwitch<T extends 'games' | 'picks'>({ value, onChange }: { value: T; onChange: (v: T) => void }) {
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(PICKS_SEEN) === '1'; } catch { return true; } });
  const go = (v: T) => {
    if (v === 'picks' && !seen) { setSeen(true); try { localStorage.setItem(PICKS_SEEN, '1'); } catch { /* sin almacenamiento */ } }
    onChange(v);
  };
  const base = 'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:px-6';
  const picks = value === 'picks';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="tablist" aria-label="Sección" className="grid w-full grid-cols-2 gap-1 rounded-xl bg-zinc-900 p-1 ring-1 ring-inset ring-zinc-800 sm:inline-grid sm:w-auto">
        <button type="button" role="tab" aria-selected={!picks} onClick={() => go('games' as T)}
          className={cn(base, !picks ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100')}>
          <CalendarDays size={16} />Partidos
        </button>
        <button type="button" role="tab" aria-selected={picks} onClick={() => go('picks' as T)}
          className={cn(base, picks ? 'bg-zinc-700 text-zinc-50' : 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/45 hover:bg-amber-500/25', !picks && !seen && 'attn')}>
          <Lightbulb size={16} className={picks ? 'text-amber-400' : ''} />Recomendaciones
        </button>
      </div>
      {!picks && <span className="hidden text-[13px] text-zinc-400 sm:inline">Las apuestas en las que el modelo ve valor, con su probabilidad</span>}
    </div>
  );
}

// Título de la lista de partidos con el día elegido en largo
export function MatchesTitle({ date, title = 'Partidos' }: { date: string; title?: string }) {
  const long = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-zinc-400 first-letter:uppercase">{long}</p>
    </div>
  );
}

// Al abrir una ficha se empieza arriba (si no, hereda el desplazamiento de la lista) y al volver se recupera donde se estaba.
// El contador evita restaurar cuando React desmonta y vuelve a montar la ficha (modo estricto, cambios de pestaña internos)
let sheetsOpen = 0;
let listY = 0;
export function SheetScroll() {
  useLayoutEffect(() => {
    const main = document.querySelector('main');
    sheetsOpen++;
    if (main && main.scrollTop > 0) listY = main.scrollTop;
    main?.scrollTo({ top: 0 });
    return () => {
      sheetsOpen--;
      requestAnimationFrame(() => { if (!sheetsOpen) { main?.scrollTo({ top: listY }); listY = 0; } });
    };
  }, []);
  return null;
}

// Tira de días: la semana alrededor del día elegido, con cuántos partidos hay y si alguno está en juego.
// El día elegido va sobre gris. En el móvil se desliza de lado
export function DayStrip({ value, onChange, counts, span = 7 }: {
  value: string; onChange: (d: string) => void; counts?: Record<string, { total: number; live: number }>; span?: number;
}) {
  const half = Math.floor(span / 2);
  const days = Array.from({ length: span }, (_, i) => addDays(value, i - half));
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [value]);
  const arrow = 'grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900 hover:text-zinc-100';
  return (
    <div className="flex items-center gap-2">
      <button className={arrow} onClick={() => onChange(addDays(value, -span))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
      <div className="fade-x flex min-w-0 flex-1 gap-1 overflow-x-auto no-scrollbar">
        {days.map(d => {
          const c = counts?.[d];
          const sel = d === value;
          return (
            <button key={d} ref={sel ? selRef : undefined} onClick={() => onChange(d)} aria-pressed={sel}
              className={cn('relative flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3.5 text-sm font-medium transition',
                sel ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
              <span className="first-letter:uppercase">{dayName(d)}</span>
              {!!c?.total && <span className={cn('text-xs tnum', sel ? 'text-zinc-400' : 'text-zinc-600')}>{c.total}</span>}
              {!!c?.live && <LiveDot className="absolute right-1.5 top-1.5" />}
            </button>
          );
        })}
      </div>
      <button className={arrow} onClick={() => onChange(addDays(value, span))} aria-label="Semana siguiente"><ChevronRight size={16} /></button>
    </div>
  );
}

// ---------- filtros ----------
export type StateFilter = 'all' | MatchState;

// above: lo que va encima de los filtros (la tira de días). En el móvil se quedan fijos arriba al desplazarse (la barra de
// la cabecera, que se esconde, publica su alto en --head) y los controles de debajo (cuotas, liga…) van en su fila, sin fijar;
// desde `lg` todo queda como siempre, en el flujo y con los controles a la derecha de los filtros
export function StateFilterBar({ value, onChange, counts, above, children }: {
  value: StateFilter; onChange: (v: StateFilter) => void; counts: Record<StateFilter, number>; above?: ReactNode; children?: ReactNode;
}) {
  const items: [StateFilter, string][] = [['all', 'Todos'], ['live', 'En juego'], ['pre', 'Próximos'], ['post', 'Terminados']];
  // En el móvil los filtros se deslizan de lado en vez de partirse en dos líneas
  return (
    <>
      <div className="sticky top-[var(--head,0px)] z-20 -mx-3 flex flex-col gap-3 bg-zinc-950 px-3 pb-2 pt-2 transition-[top] duration-200 lg:static lg:mx-0 lg:gap-5 lg:bg-transparent lg:p-0">
        {above}
        <div className="flex flex-wrap items-center gap-2">
          <div className="fade-r -mx-3 flex min-w-0 max-w-[calc(100%+1.5rem)] gap-1.5 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:max-w-none sm:px-0">
            {items.map(([v, label]) => (
              <button key={v} onClick={() => onChange(v)} disabled={v !== 'all' && !counts[v]} aria-pressed={value === v} className={chip(value === v)}>
                {v === 'live' && (counts.live ? <LiveDot /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />)}
                {label}
                <span className={cn('tnum', v === 'live' && counts.live ? 'text-rose-300' : value === v ? 'text-amber-300' : 'text-zinc-500')}>{counts[v]}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto hidden flex-wrap items-center gap-2 lg:flex">{children}</div>
        </div>
      </div>
      {!!children && <div className="flex w-full items-center gap-2 lg:hidden">{children}</div>}
    </>
  );
}

// Interruptor (por ejemplo, "Cuotas"): pista redonda con su bola, para que no se confunda con un botón
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs font-medium text-zinc-300 transition hover:text-zinc-50">
      <span className={cn('relative h-5 w-9 rounded-full transition', on ? 'bg-amber-500' : 'bg-zinc-700')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full transition-all', on ? 'left-[18px] bg-zinc-950' : 'left-0.5 bg-zinc-300')} />
      </span>
      {label}
    </button>
  );
}

// ---------- competición y tarjeta de partido ----------
// Una competición: cabecera (se pliega al pulsarla) y sus partidos en una cuadrícula de tarjetas.
// id: el ancla para el menú lateral
export function CompetitionBlock({ id, name, sub, logo, count, live, open, onToggle, children }: {
  id?: string; name: string; sub?: string; logo?: string; count: number; live?: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <button onClick={onToggle} aria-expanded={open} className="mb-2.5 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-left transition hover:bg-zinc-900/60">
        {logo ? <img src={sized(logo, 20)} onError={fallbackTo(logo)} alt="" loading="lazy" decoding="async" className="h-5 w-5 object-contain" /> : <span className="grid h-5 w-5 place-items-center rounded bg-zinc-800 text-[9px] font-semibold text-zinc-400">{name.slice(0, 2).toUpperCase()}</span>}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate text-[15px] font-semibold text-zinc-50">{name}</span>
          {sub && <span className="label-data truncate text-zinc-500">{sub}</span>}
        </div>
        {!!live && <span className="text-xs font-medium text-rose-300">{live} en juego</span>}
        <span className="text-xs text-zinc-500 tnum">{count}</span>
        <ChevronDown size={16} className={cn('text-zinc-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">{children}</div>}
    </section>
  );
}

// Los partidos en juego, destacados arriba en tarjetas grandes
export function LiveSection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section id="comp-en-directo" className="scroll-mt-4">
      <div className="mb-3 flex items-center gap-2.5 px-1 py-1">
        <LiveDot className="h-2 w-2" />
        <span className="text-[15px] font-semibold text-zinc-50">En directo</span>
        <span className="text-xs text-zinc-500">{count} {count === 1 ? 'partido' : 'partidos'}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

// games y points: los juegos del set y los puntos del juego en curso (tenis en juego); serving: saca él; color: el del equipo, de fondo en el marcador grande; plate: su escudo necesita una placa clara para verse
// alt: el nombre corto ("Knicks", "Atlético"), que sale cuando el entero no cabe en la tarjeta
export interface RowTeam { name: string; short?: string; alt?: string; logo?: string; score?: string | number | null; win?: boolean; lose?: boolean; games?: number | null; points?: string | null; serving?: boolean; color?: string; plate?: boolean }

// El nombre entero si cabe y, si no, el corto: «Knicks» se lee mejor que «New York Kn…». Mide el entero con una copia
// invisible del mismo tamaño de letra cada vez que cambia el ancho de la tarjeta
function FitName({ name, alt, className }: { name: string; alt?: string; className: string }) {
  const box = useRef<HTMLSpanElement>(null), probe = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  const useAlt = !!alt && alt !== name;
  useLayoutEffect(() => {
    const b = box.current, p = probe.current;
    if (!b || !p || !useAlt) return;
    const check = () => setFits(p.offsetWidth <= b.clientWidth + 0.5);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(b);
    return () => ro.disconnect();
  }, [name, useAlt]);
  return (
    <span ref={box} className={cn('relative min-w-0 flex-1 truncate', className)} title={name}>
      {fits || !useAlt ? name : alt}
      {useAlt && <span ref={probe} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap">{name}</span>}
    </span>
  );
}

// Rótulo de la ficha de cuota: el código del equipo (G2, LAL) o, si el "corto" no es un código (en tenis es el país),
// el apellido del jugador
const oddsTag = (t: RowTeam) => (t.short && t.short.length <= 4 ? t.short : t.name.replace(/\s*\(\d+\)$/, '').split(' ').pop() || t.name);

// Tarjeta de partido: estado y hora arriba, los dos equipos con su marcador y, si se piden, las cuotas de ganador en dos
// fichas (la del favorito teñida del acento); en fútbol, tres, con el empate (x) en medio.
// featured: más grande, para "En directo", con la competición en la cabecera.
// En tenis en juego, tras los sets van los juegos del set y los puntos del juego.
// items-stretch: un <button> flex alinea al principio por defecto y la cabecera crecía con el texto en vez de recortarlo
// noOdds: lo que se dice en lugar de las cuotas cuando todavía no hay ("Cuotas desde el dom 15, 18:00"), de cardNote en
// lib/odds-window.ts; así el usuario sabe que no es un fallo
// onOdd: cada cuota es un botón que la añade al cupón, en el móvil y en el ordenador; el resto de la tarjeta abre el partido.
// Antes, desde `lg`, la cuota abría el partido: la misma ficha hacía dos cosas según la pantalla. La resaltada es la del
// favorito (la más baja), y lo explica OddsLegend encima de la lista
export function MatchCard({ state, time, status, a, b, odds, noOdds, active, onClick, onOdd, tag, competition, featured }: {
  state: MatchState; time: string; status?: string; a: RowTeam; b: RowTeam; odds?: { a: number; b: number; x?: number } | null; noOdds?: string | null;
  active?: boolean; onClick: () => void; onOdd?: (side: 'a' | 'x' | 'b') => void; tag?: string; competition?: string; featured?: boolean;
}) {
  const pick = onOdd;
  const games = state === 'live' && (a.games != null || b.games != null), points = state === 'live' && (a.points != null || b.points != null);
  const team = (t: RowTeam) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <TeamLogo src={t.logo} name={t.short || t.name} size={featured ? 36 : 26} />
      <FitName name={t.name} alt={t.alt} className={cn(featured ? 'text-base' : 'text-sm', t.win ? 'font-semibold text-zinc-50' : t.lose ? 'text-zinc-500' : 'font-medium text-zinc-100')} />
      {t.serving && <span title="Saca" aria-label="Saca" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
      {state !== 'pre' && <span className={cn('font-score font-semibold tnum', featured ? 'text-2xl' : 'text-lg', t.lose ? 'text-zinc-500' : games ? 'text-zinc-50' : t.win || state === 'live' ? 'text-amber-400' : 'text-zinc-50')} title={games ? 'Sets' : undefined}>{t.score ?? ''}</span>}
      {games && <span className={cn('w-5 text-right font-score tnum text-zinc-400', featured ? 'text-xl' : 'text-base')} title="Juegos de este set">{t.games ?? ''}</span>}
      {points && <span className={cn('w-7 text-right font-score font-semibold tnum text-amber-400', featured ? 'text-xl' : 'text-base')} title="Puntos del juego">{t.points ?? ''}</span>}
    </div>
  );
  // Se resalta el favorito (la cuota más baja), como antes
  const best = odds ? Math.min(odds.a || 99, odds.b || 99, odds.x || 99) : 0;
  // Con empate son tres por fila y van como en las casas, 1 X 2: la abreviatura ("BKH") se cortaba en una letra en las
  // tarjetas estrechas
  const three = !!odds && odds.x != null;
  const who = (side: 'a' | 'x' | 'b') => (side === 'x' ? 'Empate' : side === 'a' ? a.name : b.name);
  const oddChip = (o: number, tag: string, side: 'a' | 'x' | 'b') => {
    const cls = cn(oddBtn(!!o && o === best), 'flex h-10 min-w-0 items-center justify-between text-sm', three ? 'gap-1 px-2' : 'gap-1.5 px-2.5', !o && 'bg-zinc-900 text-zinc-600');
    const inner = <><span className={cn('min-w-0 truncate font-medium opacity-70', three ? 'text-[10.5px]' : 'text-xs')}>{tag}</span><span>{o ? odd(o) : '–'}</span></>;
    return pick && o
      ? <button type="button" onClick={() => pick(side)} aria-label={`Añadir al cupón: ${who(side)} a ${odd(o)}`} title={`${who(side)}: añadir al cupón${o === best ? ' · la del favorito' : ''}`} className={cn(cls, 'active:scale-[.97]')}>{inner}</button>
      : <span className={cls}>{inner}</span>;
  };
  const info = [competition, status].filter(Boolean).join(' · ');
  // Las cuotas van fuera del botón que abre el partido (un botón dentro de otro no vale); donde no son botones, abren el partido
  const open = pick ? undefined : onClick;
  return (
    <div className={cn('flex h-full w-full flex-col gap-3 rounded-2xl border bg-surface text-left transition hover:bg-zinc-900',
      featured ? 'p-4' : 'p-3.5', active ? 'border-amber-500/60' : 'border-zinc-800 hover:border-zinc-700')}>
      <button onClick={onClick} aria-current={active} className="flex cursor-pointer flex-col items-stretch gap-3 text-left">
        <div className="flex min-w-0 items-center gap-2">
          {state === 'live'
            ? <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-rose-300"><LiveDot />{time}</span>
            : state === 'pre'
              ? <span className="shrink-0 text-[13px] font-semibold text-zinc-100 tnum">{time}</span>
              : <span className="shrink-0 text-xs text-zinc-500">{time}</span>}
          {info && <span className="min-w-0 truncate text-xs text-zinc-500">{info}</span>}
          {tag && <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{tag}</span>}
        </div>
        <div className={cn('flex flex-col', featured ? 'gap-3' : 'gap-2')}>{team(a)}{team(b)}</div>
      </button>
      {odds && (odds.x
        ? <div onClick={open} className={cn('mt-auto grid grid-cols-3 gap-2 pt-1', open && 'cursor-pointer')}>{oddChip(odds.a, '1', 'a')}{oddChip(odds.x, 'X', 'x')}{oddChip(odds.b, '2', 'b')}</div>
        : <div onClick={open} className={cn('mt-auto grid grid-cols-2 gap-2 pt-1', open && 'cursor-pointer')}>{oddChip(odds.a, oddsTag(a), 'a')}{oddChip(odds.b, oddsTag(b), 'b')}</div>)}
      {!odds && noOdds && state === 'pre' && <div onClick={onClick} className="mt-auto flex h-10 cursor-pointer items-center justify-center rounded-md border border-zinc-800 px-3 text-xs text-zinc-500">{noOdds}</div>}
    </div>
  );
}

// Leyenda de las cuotas de las tarjetas y las filas de tenis: qué pasa al pulsarlas y qué es la resaltada
export function OddsLegend() {
  return (
    <p className="-mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-zinc-500">
      <span>Pulsa una cuota para añadirla al cupón.</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-amber-500/10 ring-1 ring-inset ring-amber-500/35" />La del favorito (la más baja).</span>
    </p>
  );
}

// ---------- marcador grande ----------
// El marcador del partido abierto: la competición y el estado arriba, los dos equipos a los lados y el resultado en
// grande en el centro, con el acento en quien va por delante. Lo importante de la ficha son los datos que hay debajo
// Colores de los equipos en el marcador grande: cada mitad, plana, teñida del suyo
const tint = (x?: string, y?: string) => (x || y ? {
  background: `linear-gradient(90deg, ${x ? `color-mix(in oklab, ${x} 22%, transparent)` : 'transparent'} 0 50%, ${y ? `color-mix(in oklab, ${y} 22%, transparent)` : 'transparent'} 50% 100%)`
} : undefined);

export function Scoreboard({ competition, detail, a, b, state, center, centerSub, children }: {
  competition: string; detail?: string; a: RowTeam; b: RowTeam; state: MatchState; center?: ReactNode; centerSub?: string; children?: ReactNode;
}) {
  const sa = Number(a.score), sb = Number(b.score);
  const lead = state !== 'pre' && isFinite(sa) && isFinite(sb) && sa !== sb ? (sa > sb ? 'a' : 'b') : null;
  const side = (t: RowTeam, which: 'a' | 'b') => (
    <div className={cn('relative flex w-full min-w-0 flex-col items-center gap-1.5 text-center sm:w-auto sm:flex-row sm:gap-3', which === 'a' ? 'sm:flex-row sm:justify-self-start sm:text-left' : 'sm:flex-row-reverse sm:justify-self-end sm:text-right')}>
      <span className={cn('shrink-0', t.plate && 'rounded-lg bg-white/90 p-1')}><TeamLogo src={t.logo} name={t.short || t.name} size={44} /></span>
      <div className="min-w-0 max-w-full">
        <div className={cn('flex min-w-0 items-center justify-center gap-0.5', which === 'a' ? 'sm:justify-start' : 'sm:flex-row-reverse sm:justify-start')}>
          <span className="line-clamp-2 text-sm font-semibold tracking-tight sm:text-xl" title={t.name}>{t.name}</span>
          <FavStar name={t.name} logo={t.logo} className="absolute -right-1 -top-1.5 sm:static" />
        </div>
        {t.short && t.short !== t.name && <div className="hidden text-xs text-zinc-500 sm:block">{t.short}</div>}
      </div>
    </div>
  );
  const num = (t: RowTeam, which: 'a' | 'b') => (
    <span className={cn('text-3xl font-bold leading-none tracking-tight tnum sm:text-5xl', lead === which ? 'text-amber-400' : lead ? 'text-zinc-500' : 'text-zinc-50')}>{t.score ?? 0}</span>
  );
  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 sm:px-5">
        <span className="text-sm font-semibold text-zinc-100">{competition}</span>
        {detail && <span className="text-xs text-zinc-500">· {detail}</span>}
        {centerSub && (
          <span className={cn('ml-auto flex items-center gap-1.5 text-xs font-medium first-letter:uppercase',
            state === 'live' ? 'text-rose-300' : 'text-zinc-400')}>
            {state === 'live' && <LiveDot />}{centerSub}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-5 sm:gap-6 sm:px-5" style={tint(a.color, b.color)}>
        {side(a, 'a')}
        <div className="flex flex-col items-center gap-1.5">
          {state === 'pre'
            ? <span className="font-score text-3xl font-semibold leading-none tnum text-zinc-100">{center}</span>
            : <div className="flex items-center gap-3 sm:gap-4">{num(a, 'a')}<span className="text-2xl font-light text-zinc-600">–</span>{num(b, 'b')}</div>}
        </div>
        {side(b, 'b')}
      </div>
      {children}
    </div>
  );
}

// En el móvil la fila de pestañas se desliza: la elegida se trae a la vista (función fija para no repetirlo en cada pintado)
const onPick = (el: HTMLButtonElement | null) => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });

// Pestañas bajo el marcador: subrayadas, y si no caben se parten en dos líneas en vez de esconderse de lado.
// A la derecha, las acciones
export function SheetTabs<T extends string>({ value, onChange, items, right }: { value: T; onChange: (v: T) => void; items: [T, string][]; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-x-2 border-t border-zinc-800 px-3 pt-1 sm:flex-wrap sm:items-end sm:gap-y-2 sm:px-4">
      <div className="fade-r flex min-w-0 max-w-full flex-1 gap-x-4 sm:flex-none overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-visible" role="tablist">
        {items.map(([v, label]) => (
          <button key={v} type="button" role="tab" onClick={() => onChange(v)} aria-selected={value === v} ref={value === v ? onPick : undefined}
            className={cn('cursor-pointer sm:-mb-px whitespace-nowrap border-b-2 py-2.5 text-[13px] font-medium transition',
              value === v ? 'border-amber-500 text-zinc-50' : 'border-transparent text-zinc-400 hover:text-zinc-100')}>{label}</button>
        ))}
      </div>
      {right && <div className="ml-auto flex shrink-0 gap-2 pb-1 sm:flex-wrap sm:pb-2">{right}</div>}
    </div>
  );
}
