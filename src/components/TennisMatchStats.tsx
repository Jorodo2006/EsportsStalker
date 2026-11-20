// Estadísticas del partido de tenis, bajo el marcador: saque, resto y bolas de break de los dos, del partido entero y de cada set
// si la fuente lo da. En la WTA salen de su web oficial al momento (también en directo); en la ATP, de TennisMyLife, uno o
// varios días después (server/services/tennis/matchstats.js). ESPN no las tiene.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import type { TennisMatch, TennisStatSide } from '@/lib/types';
import { Loading, Tabs, panelCls } from './ui';

const pc = (a: number | null, b: number | null) => (a != null && b ? Math.round((a / b) * 100) : null);
// Cada fila: el número que se enseña, el porcentaje (si lo hay) y si más es mejor
type Row = { label: string; val: (s: TennisStatSide) => { shown: string; n: number | null } | null; higher?: boolean };
const frac = (a: number | null, b: number | null) => (a == null || b == null ? null : { shown: `${a}/${b}${b ? ` (${pc(a, b)} %)` : ''}`, n: b ? a / b : null });
const ROWS: Row[] = [
  { label: 'Aces', val: s => (s.aces == null ? null : { shown: String(s.aces), n: s.aces }) },
  { label: 'Dobles faltas', val: s => (s.df == null ? null : { shown: String(s.df), n: s.df }), higher: false },
  { label: '1.er saque dentro', val: s => frac(s.firstIn, s.servePts) },
  { label: 'Puntos ganados con el 1.º', val: s => frac(s.firstWon, s.firstIn) },
  { label: 'Puntos ganados con el 2.º', val: s => frac(s.secondWon, s.servePts != null && s.firstIn != null ? s.servePts - s.firstIn : null) },
  { label: 'Bolas de break salvadas', val: s => frac(s.bpSaved, s.bpFaced) },
  { label: 'Bolas de break convertidas', val: s => frac(s.bpConv, s.bpChances) },
  { label: 'Juegos al saque', val: s => (s.serveGames == null ? null : { shown: String(s.serveGames), n: null }) },
  { label: 'Puntos ganados', val: s => (s.totalPts == null ? null : { shown: String(s.totalPts), n: s.totalPts }) }
];

function Line({ row, a, b }: { row: Row; a: TennisStatSide; b: TennisStatSide }) {
  const x = row.val(a), y = row.val(b);
  if (!x && !y) return null;
  const nx = x?.n ?? null, ny = y?.n ?? null;
  const better = nx == null || ny == null || nx === ny ? null : (nx > ny) === (row.higher !== false) ? 'a' : 'b';
  // Barra: la parte de cada uno (con porcentajes, sobre 100; con números, sobre la suma)
  const pa = nx == null || ny == null ? 0.5 : x!.shown.includes('%') ? (nx + ny ? nx / (nx + ny) : 0.5) : nx + ny ? nx / (nx + ny) : 0.5;
  return (
    <div className="px-4 py-2">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className={cn('font-score tnum', better === 'a' ? 'font-semibold text-zinc-50' : 'text-zinc-300')}>{x?.shown ?? '–'}</span>
        <span className="text-center text-xs text-zinc-400">{row.label}</span>
        <span className={cn('text-right font-score tnum', better === 'b' ? 'font-semibold text-zinc-50' : 'text-zinc-300')}>{y?.shown ?? '–'}</span>
      </div>
      <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-zinc-800">
        <div className={cn('h-full', better === 'a' ? 'bg-amber-500' : 'bg-zinc-500')} style={{ width: `${pa * 100}%` }} />
        <div className={cn('h-full flex-1', better === 'b' ? 'bg-amber-500/70' : 'bg-zinc-700')} />
      </div>
    </div>
  );
}

export function TennisMatchStats({ m, onForm }: { m: TennisMatch; onForm?: () => void }) {
  const live = m.state === 'in';
  const q = useQuery({
    queryKey: ['tennis', 'match-stats', m.id, m.state], enabled: m.state !== 'pre',
    queryFn: () => window.api.tennis.matchStats({ tour: m.level ? 'challenger' : m.tour, date: m.date.slice(0, 10), state: m.state, a: m.a.name, b: m.b.name }),
    staleTime: live ? 30e3 : 10 * 60e3, refetchInterval: live ? 60e3 : false
  });
  const [part, setPart] = useState('total');
  if (m.state === 'pre') return null;
  if (q.isLoading) return <Loading label="Cargando las estadísticas del partido…" />;
  const d = q.data;
  if (!d?.total) {
    return (
      <div className={cn(panelCls, 'px-4 py-3 text-[13px] text-zinc-400')}>
        Las estadísticas de este partido estarán disponibles próximamente.
        {onForm && <> Mientras, <button type="button" onClick={onForm} className="cursor-pointer text-amber-400 underline">mira la forma de los dos</button> (saque y resto de la temporada y en esta superficie).</>}
      </div>
    );
  }
  const sets = d.sets ?? [];
  const cur = part === 'total' ? d.total : sets.find(s => String(s.n) === part) ?? d.total;
  const time = part !== 'total' ? sets.find(s => String(s.n) === part)?.time : null;
  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-zinc-100">Estadísticas del partido{d.live && <span className="ml-2 text-xs font-normal text-rose-300">en directo</span>}</span>
        {sets.length > 1 && <Tabs value={part} onChange={setPart} items={[{ value: 'total', label: 'Partido' }, ...sets.map(s => ({ value: String(s.n), label: `Set ${s.n}` }))]} />}
      </div>
      <div className="flex justify-between gap-3 px-4 pt-2 text-xs font-medium text-zinc-500">
        <span className="truncate">{m.a.name}</span><span className="truncate text-right">{m.b.name}</span>
      </div>
      <div className="divide-y divide-zinc-800/50">{ROWS.map(r => <Line key={r.label} row={r} a={cur.a} b={cur.b} />)}</div>
      <p className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        Fuente: {d.source}{time ? ` · este set duró ${time.replace(/^00:/, '').replace(/^0/, '')}` : d.minutes ? ` · ${d.minutes} min de partido` : ''}.
      </p>
    </div>
  );
}
