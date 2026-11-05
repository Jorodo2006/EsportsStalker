// Buscador de jugadores y equipos con sugerencias mientras escribes: primero las que ya conoce la app
// (equipos del calendario y búsquedas recientes, al momento) y después las de Leaguepedia.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Search, Shield, User } from 'lucide-react';
import { cn } from '@/lib/format';
import type { Schedule } from '@/lib/types';

export type Pick = { kind: 'player' | 'team'; name: string; label: string; sub?: string; exact?: boolean };

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const RECENT_KEY = 'recentSearches';
const loadRecent = (): Pick[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const saveRecent = (p: Pick) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...loadRecent().filter(x => x.kind !== p.kind || x.name !== p.name)].slice(0, 8))); } catch { /* sin almacenamiento */ }
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function SearchBox({ onPick }: { onPick: (p: Pick) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 450);
  const remote = dq.length >= 2;
  const players = useQuery({ queryKey: ['search', dq], queryFn: () => window.api.stats.searchPlayers(dq), enabled: remote, staleTime: 3600e3 });
  const teams = useQuery({ queryKey: ['searchTeams', dq], queryFn: () => window.api.stats.searchTeams(dq), enabled: remote, staleTime: 3600e3 });

  // Cierra la lista al pulsar fuera
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const items = useMemo<Pick[]>(() => {
    const n = norm(q);
    if (!n) return loadRecent();
    // Equipos que la app ya conoce por el calendario (lolesports): sugerencia inmediata
    const known = new Map<string, Pick>();
    for (const [, d] of qc.getQueriesData<Schedule>({ queryKey: ['schedule'] }))
      for (const ev of d?.events ?? []) for (const t of ev.teams)
        if (t.name && (norm(t.name).includes(n) || norm(t.code || '').startsWith(n)))
          known.set(t.name, { kind: 'team', name: `${t.name}|${t.code}`, label: t.name, sub: `${t.code} · ${ev.league}` });
    const recent = loadRecent().filter(r => norm(r.label).includes(n));
    const lpTeams: Pick[] = (teams.data ?? []).map(t => ({ kind: 'team', name: t.page || t.name, label: t.name, sub: [t.short, t.region, t.disbanded ? 'disuelto' : ''].filter(Boolean).join(' · '), exact: true }));
    const lpPlayers: Pick[] = (players.data ?? []).map(p => ({ kind: 'player', name: p.page || p.id, label: p.id, sub: [p.team || (p.retired ? 'retirado' : ''), p.role].filter(Boolean).join(' · '), exact: true }));
    const out: Pick[] = [];
    const seen = new Set<string>();
    // Si Leaguepedia ya trae el equipo (mismas siglas), sobra el nombre de lolesports
    const shorts = new Set((teams.data ?? []).map(t => norm(t.short || '')));
    const knownLeft = [...known.values()].filter(k => !shorts.has(norm(k.name.split('|')[1] || '')));
    for (const x of [...recent, ...knownLeft, ...lpTeams, ...lpPlayers]) {
      const k = x.kind + norm(x.label);
      if (seen.has(k)) continue;
      seen.add(k); out.push(x);
    }
    // Primero lo que empieza igual que lo escrito
    return out.sort((a, b) => +!norm(a.label).startsWith(n) - +!norm(b.label).startsWith(n)).slice(0, 12);
  }, [q, players.data, teams.data, qc]);
  useEffect(() => setHi(0), [q]);

  const loading = remote && (players.isFetching || teams.isFetching);
  function choose(p: Pick) {
    saveRecent(p);
    onPick(p);
    setQ(''); setOpen(false);
  }
  function submit() {
    if (items[hi]) choose(items[hi]);
    else if (q.trim()) choose({ kind: 'team', name: q.trim(), label: q.trim() });
  }

  return (
    <div ref={box} className="relative w-full sm:w-96">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input value={q} placeholder="Buscar jugador o equipo (Faker, T1, Gen.G…)"
        onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-9 w-full rounded-lg border border-zinc-700/70 bg-zinc-900 pl-9 pr-9 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/20" />
      {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-500" />}
      {open && (items.length > 0 || remote) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-zinc-700/70 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
          {!q.trim() && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Recientes</div>}
          {items.map((p, i) => (
            <button key={p.kind + p.name} onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(p); }}
              className={cn('flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left', i === hi ? 'bg-zinc-800/80' : 'hover:bg-zinc-900')}>
              {!q.trim() ? <Clock size={14} className="text-zinc-600" /> : p.kind === 'team' ? <Shield size={14} className="text-sky-400" /> : <User size={14} className="text-amber-400" />}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.label}</span>
              {p.sub && <span className="truncate text-xs text-zinc-500">{p.sub}</span>}
            </button>
          ))}
          {remote && !loading && !items.length && <div className="px-3 py-3 text-sm text-zinc-500">Sin resultados. Pulsa Enter para buscarlo como equipo.</div>}
          {loading && <div className="px-3 py-2 text-xs text-zinc-500">Buscando en Leaguepedia…</div>}
        </div>
      )}
    </div>
  );
}
