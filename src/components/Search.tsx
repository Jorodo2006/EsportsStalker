// Buscador de los cinco deportes: equipos, jugadores y competiciones. Busca el servidor (GET /api/search, que pregunta a cada
// servicio); aquí se escribe, se elige con el ratón o con las flechas y se abre el partido (cambiando de deporte y de día si
// hace falta) o la lista de la competición. Se abre con Ctrl+K (o "/") desde cualquier sitio.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { sectionId, useApp, type AppId } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { SearchCompetition, SearchMatch } from '@/lib/types';
import { Dialog, ErrorBox } from './ui';

const SPORT: Record<AppId, { label: string; color: string }> = {
  lol: { label: 'LoL', color: '#3aa894' }, basket: { label: 'Baloncesto', color: '#dc7d41' },
  tennis: { label: 'Tenis', color: '#67ad53' }, football: { label: 'Fútbol', color: '#5f84cc' }, mma: { label: 'MMA', color: '#bf5a5a' }
};
const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
// "Hoy 21:00", "Mañana 18:30", "vie 13, 20:45"
function when(iso: string) {
  const d = madridDay(iso), today = madridDay(new Date().toISOString());
  const diff = Math.round((+new Date(d) - +new Date(today)) / 864e5);
  const time = new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const day = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer' : new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'Europe/Madrid' });
  return `${day} ${time}`;
}

// Ctrl+K o "/" (fuera de un campo de texto) abren el buscador
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName || '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
}

// El bloque de la competición puede tardar en salir (la lista carga): se busca durante unos segundos. En tenis el id lleva
// el circuito delante ("comp-atp-paris"), por eso vale también el que acaba igual
function scrollToSection(name: string) {
  const id = sectionId(name), tail = '-' + id.slice(5);
  let tries = 0;
  const look = () => {
    const el = document.getElementById(id) ?? [...document.querySelectorAll<HTMLElement>('[id^="comp-"]')].find(x => x.id.endsWith(tail));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (++tries < 25) setTimeout(look, 200);
  };
  setTimeout(look, 100);
}

type Row = { kind: 'match'; m: SearchMatch } | { kind: 'comp'; c: SearchCompetition };

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { switchApp, go, setFocusId, setFocusDay, setOpenMatch } = useApp();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Intro antes de que lleguen los resultados: se abre el primero en cuanto lleguen
  const wantFirst = useRef(false);
  // Espera a que se deje de escribir un momento: cada búsqueda pregunta a los cuatro servicios
  useEffect(() => { wantFirst.current = false; const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  useEffect(() => { if (open) { setSel(0); setTimeout(() => input.current?.select(), 0); } }, [open]);
  const res = useQuery({ queryKey: ['search', q], queryFn: () => window.api.search(q), enabled: open && q.length >= 2, staleTime: 60e3, placeholderData: p => p });
  const rows = useMemo<Row[]>(() => [
    ...(res.data?.matches ?? []).map(m => ({ kind: 'match' as const, m })),
    ...(res.data?.competitions ?? []).map(c => ({ kind: 'comp' as const, c }))
  ], [res.data]);
  useEffect(() => setSel(0), [res.data]);

  const choose = (r: Row) => {
    onClose();
    if (r.kind === 'match') {
      const m = r.m;
      switchApp(m.sport);
      if (m.sport === 'lol' && m.event) setOpenMatch(m.event);
      else { setFocusDay(madridDay(m.date)); setFocusId(m.id); }
      go('matches');
      return;
    }
    const c = r.c;
    switchApp(c.sport);
    setOpenMatch(null);
    if (c.next) setFocusDay(madridDay(c.next));
    go('matches');
    scrollToSection(c.name);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[sel] && q === text.trim() && !res.isFetching) choose(rows[sel]);
      else if (text.trim().length >= 2) wantFirst.current = true;
    }
  };
  useEffect(() => {
    if (wantFirst.current && q === text.trim() && !res.isFetching && rows.length) { wantFirst.current = false; choose(rows[0]); }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.getElementById(`busca-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const tag = (s: AppId) => <span className="flex w-[74px] shrink-0 items-center gap-1.5 text-xs text-zinc-400"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT[s].color }} />{SPORT[s].label}</span>;
  const rowCls = (i: number) => cn('flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition', i === sel ? 'bg-zinc-800' : 'hover:bg-zinc-800/50');
  const nMatches = res.data?.matches.length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} title={
      <label className="flex w-full items-center gap-2.5">
        <Search size={17} className="shrink-0 text-zinc-500" />
        <input ref={input} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} autoFocus aria-label="Buscar"
          placeholder="Equipo, jugador o competición" className="h-9 w-full min-w-0 bg-transparent text-base font-normal text-zinc-50 outline-none placeholder:text-zinc-500" />
      </label>
    }>
      {q.length < 2 ? (
        <p className="text-sm text-zinc-400">Busca en los cuatro deportes: "Barcelona", "Sabalenka", "Lakers", "T1", "Liga F"… Salen los partidos de ayer a dentro de una semana.</p>
      ) : res.error ? <ErrorBox error={res.error} />
        : res.isLoading ? <p className="text-sm text-zinc-400">Buscando…</p>
        : !rows.length ? <p className="text-sm text-zinc-400">Nada con "{q}" entre ayer y la semana que viene.</p>
        : (
          <div className={cn('-mx-2 flex max-h-[60dvh] flex-col overflow-y-auto', res.isFetching && 'opacity-70')}>
            {nMatches > 0 && <div className="px-2.5 pb-1 text-xs font-medium text-zinc-500">Partidos</div>}
            {res.data!.matches.map((m, i) => (
              <button key={`${m.sport}:${m.id}`} id={`busca-${i}`} onClick={() => choose({ kind: 'match', m })} onMouseMove={() => setSel(i)} className={rowCls(i)}>
                {tag(m.sport)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-50">{m.home} <span className="text-zinc-500">-</span> {m.away}</span>
                  <span className="block truncate text-xs text-zinc-500">{[m.league, m.stage].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={cn('shrink-0 text-right text-xs tnum', m.state === 'in' ? 'text-rose-300' : 'text-zinc-400')}>
                  {m.state === 'in' ? <>En juego{m.score ? ` · ${m.score}` : ''}</> : m.state === 'post' ? <>Final{m.score ? ` · ${m.score}` : ''}</> : when(m.date)}
                </span>
              </button>
            ))}
            {!!res.data!.competitions.length && <div className={cn('px-2.5 pb-1 text-xs font-medium text-zinc-500', nMatches > 0 && 'mt-3')}>Competiciones</div>}
            {res.data!.competitions.map((c, j) => {
              const i = nMatches + j;
              return (
                <button key={`${c.sport}:${c.id}`} id={`busca-${i}`} onClick={() => choose({ kind: 'comp', c })} onMouseMove={() => setSel(i)} className={rowCls(i)}>
                  {tag(c.sport)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-50">{c.name}</span>
                    {c.sub && <span className="block truncate text-xs text-zinc-500">{c.sub}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400 tnum">{c.next ? `Próximo: ${when(c.next)}` : 'Sin partidos esta semana'}</span>
                </button>
              );
            })}
          </div>
        )}
      <p className="mt-3 hidden text-[11px] text-zinc-500 lg:block">↑ ↓ para moverte · Intro para abrir · Esc para cerrar</p>
    </Dialog>
  );
}
