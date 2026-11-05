// Campo "Partido" del formulario de apuesta: al abrirlo enseña todos los partidos del día de la apuesta
// (todas las ligas) y al escribir busca cualquier partido del calendario por equipo, siglas o liga.
// Se puede seguir escribiendo texto libre (partidos que no salen en lolesports).
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarSearch, History, Loader2 } from 'lucide-react';
import { cn, fmtDay, fmtTime } from '@/lib/format';
import type { MatchEvent, Schedule } from '@/lib/types';
import { Badge, TeamLogo, inputCls } from './ui';

export const matchName = (e: MatchEvent) => `${e.teams[0].code || e.teams[0].name} vs ${e.teams[1].code || e.teams[1].name}`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Día local (AAAA-MM-DD) en que se juega el partido, para compararlo con la fecha de la apuesta
const localDay = (d: string) => new Date(d).toLocaleDateString('sv-SE');

type Item = { kind: 'match'; ev: MatchEvent } | { kind: 'text'; name: string };

export function MatchPicker({ value, onChange, onPick, day, past = [], placeholder, required }: {
  value: string; onChange: (v: string) => void; onPick: (ev: MatchEvent) => void;
  day?: string; past?: string[]; placeholder?: string; required?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [, setTick] = useState(0); // fuerza a releer la caché tras cargar más fechas
  const box = useRef<HTMLDivElement>(null);
  // Misma clave que la vista de Partidos con "Todas las ligas": comparten la caché
  const base = useQuery({ queryKey: ['schedule', '', null], queryFn: () => window.api.esports.schedule({ leagueIds: [], pageToken: null }), staleTime: 5 * 60e3 });
  const [edges, setEdges] = useState<{ older: string | null; newer: string | null } | null>(null);
  const older = edges ? edges.older : base.data?.older ?? null, newer = edges ? edges.newer : base.data?.newer ?? null;

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Todos los partidos que la app ya tiene en caché (cualquier liga o página del calendario)
  const all = (() => {
    const m = new Map<string, MatchEvent>();
    for (const [, d] of qc.getQueriesData<Schedule>({ queryKey: ['schedule'] }))
      for (const ev of d?.events ?? []) if (ev.teams.length === 2) m.set(ev.id, ev);
    return [...m.values()];
  })();

  const q = value.trim();
  const items: Item[] = (() => {
    const dayEvents = all.filter(e => !day || localDay(e.startTime) === day).sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    if (!q) return dayEvents.map(ev => ({ kind: 'match', ev }));
    // Cada palabra (sin "vs") tiene que estar en algún equipo o en la liga
    const words = q.split(/\s+/).map(norm).filter(w => w && w !== 'vs');
    const hit = (e: MatchEvent) => words.every(w => e.teams.some(t => norm(t.name).includes(w) || norm(t.code || '').startsWith(w)) || norm(e.league).includes(w));
    const now = Date.now();
    const found = all.filter(hit).sort((a, b) => {
      const da = +(localDay(a.startTime) !== day), db = +(localDay(b.startTime) !== day);
      return da - db || Math.abs(+new Date(a.startTime) - now) - Math.abs(+new Date(b.startTime) - now);
    }).slice(0, 30);
    const names = new Set(found.map(matchName));
    const n = norm(q);
    const prev = past.filter(p => norm(p).includes(n) && !names.has(p) && p !== q).slice(0, 5);
    return [...found.map(ev => ({ kind: 'match' as const, ev })), ...prev.map(name => ({ kind: 'text' as const, name }))];
  })();
  useEffect(() => setHi(0), [q]);

  function choose(it: Item) {
    if (it.kind === 'match') onPick(it.ev); else onChange(it.name);
    setOpen(false);
  }

  // Trae una página más hacia atrás y otra hacia delante del calendario de todas las ligas
  async function loadMore() {
    setLoadingMore(true);
    try {
      const [o, n] = await Promise.all([older, newer].map(t => t
        ? qc.fetchQuery({ queryKey: ['schedule', '', t], queryFn: () => window.api.esports.schedule({ leagueIds: [], pageToken: t }), staleTime: 5 * 60e3 })
        : Promise.resolve(null)));
      setEdges({ older: o ? o.older : older, newer: n ? n.newer : newer });
      setTick(t => t + 1);
    } catch { /* sin conexión con el calendario: se queda lo que hay */ }
    finally { setLoadingMore(false); }
  }

  const header = !q ? (day ? `Partidos del ${fmtDay(day + 'T12:00:00')}` : 'Partidos') : 'Resultados';
  return (
    <div ref={box} className="relative">
      <input value={value} placeholder={placeholder ?? 'G2 vs FNC'} required={required} className={inputCls}
        onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!open && e.key === 'ArrowDown') { setOpen(true); return; }
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); choose(items[hi]); }
          else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          else if (e.key === 'Tab') setOpen(false);
        }} />
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 max-h-80 w-[26rem] overflow-y-auto rounded-xl border border-zinc-700/70 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 first-letter:uppercase">{header}</div>
          {base.isLoading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" />Cargando calendario…</div>}
          {items.map((it, i) => it.kind === 'match' ? (
            <button key={it.ev.id} type="button" onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(it); }}
              className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left', i === hi ? 'bg-zinc-800/80' : 'hover:bg-zinc-900')}>
              <TeamLogo src={it.ev.teams[0].image} name={it.ev.teams[0].code || it.ev.teams[0].name} size={20} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{matchName(it.ev)}</span>
              {it.ev.state === 'inProgress' && <Badge tone="live">Directo</Badge>}
              <span className="shrink-0 truncate text-xs text-zinc-500">
                {it.ev.league} · {localDay(it.ev.startTime) === day ? fmtTime(it.ev.startTime) : new Date(it.ev.startTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </span>
            </button>
          ) : (
            <button key={'t' + it.name} type="button" onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(it); }}
              className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left', i === hi ? 'bg-zinc-800/80' : 'hover:bg-zinc-900')}>
              <History size={14} className="text-zinc-600" />
              <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
              <span className="text-xs text-zinc-600">apuesta anterior</span>
            </button>
          ))}
          {!base.isLoading && !items.length && (
            <div className="px-3 py-2 text-sm text-zinc-500">{q ? 'Ningún partido cargado coincide. Puedes dejarlo escrito así.' : 'No hay partidos cargados para ese día.'}</div>
          )}
          {(older || newer) && (
            <button type="button" disabled={loadingMore} onMouseDown={e => { e.preventDefault(); loadMore(); }}
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg border-t border-zinc-800/80 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-default disabled:opacity-60">
              {loadingMore ? <Loader2 size={13} className="animate-spin" /> : <CalendarSearch size={13} />}Buscar en más fechas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
