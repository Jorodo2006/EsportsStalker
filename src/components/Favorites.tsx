// Favoritos: equipos, jugadores y luchadores que sigue cada usuario. Se marcan con la estrella de la ficha del partido
// (Scoreboard y la cabecera del fútbol) y salen arriba de Partidos con su partido en juego o el próximo. Se guardan en el
// servidor (ajuste de usuario `favorites`, server/services/bets/store.js), así que son los mismos en el móvil y en el ordenador.
// Se identifican por deporte y nombre, y sus partidos se buscan con el buscador de la cabecera (/api/search): una sola
// forma de encontrarlos para los cinco deportes.
import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { Favorite, SearchMatch, Settings, Sport } from '@/lib/types';
import { useOpenMatch } from './Search';
import { Card, TeamLogo } from './ui';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const same = (a: Favorite, sport: Sport, name: string) => a.sport === sport && norm(a.name) === norm(name);

export function useFavorites() {
  const { settings } = useApp();
  const qc = useQueryClient();
  const list = settings?.favorites ?? [];
  // Se guarda aparte de saveSettings: ese recarga todas las cuotas, y marcar una estrella no lo necesita. Se pinta al
  // momento y, si el servidor falla, se vuelve a lo que había
  const save = async (next: Favorite[]) => {
    const before = qc.getQueryData<Settings>(['settings']);
    if (before) qc.setQueryData<Settings>(['settings'], { ...before, favorites: next });
    try { qc.setQueryData(['settings'], await window.api.settings.set({ favorites: next })); }
    catch { if (before) qc.setQueryData(['settings'], before); }
  };
  return {
    list,
    isFav: (sport: Sport, name: string) => list.some(f => same(f, sport, name)),
    toggle: (f: Favorite) => save(list.some(x => same(x, f.sport, f.name)) ? list.filter(x => !same(x, f.sport, f.name)) : [...list, f]),
    remove: (f: Favorite) => save(list.filter(x => !same(x, f.sport, f.name)))
  };
}

// Estrella para seguir o dejar de seguir. Por defecto, del deporte que se está viendo
export function FavStar({ name, logo, sport, className }: { name: string; logo?: string; sport?: Sport; className?: string }) {
  const { app } = useApp();
  const { isFav, toggle } = useFavorites();
  const s = sport ?? app;
  if (!name || /^(tbd|por determinar)$/i.test(name)) return null;
  const on = isFav(s, name);
  return (
    <button type="button" onClick={e => { e.stopPropagation(); toggle({ sport: s, name, ...(logo && /^https:/.test(logo) ? { logo } : {}) }); }}
      aria-pressed={on} title={on ? `Dejar de seguir a ${name}` : `Seguir a ${name}`} aria-label={on ? `Dejar de seguir a ${name}` : `Seguir a ${name}`}
      className={cn('inline-grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md transition hover:bg-zinc-800', on ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200', className)}>
      <Star size={15} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

// El partido que interesa de un favorito: el que está en juego, si no el próximo y, si no hay, el último
function pick(matches: SearchMatch[], f: Favorite) {
  const mine = matches.filter(m => m.sport === f.sport && (norm(m.home) === norm(f.name) || norm(m.away) === norm(f.name)));
  const now = Date.now();
  return mine.find(m => m.state === 'in')
    ?? mine.filter(m => m.state === 'pre' && +new Date(m.date) >= now - 3 * 3600e3).sort((a, b) => +new Date(a.date) - +new Date(b.date))[0]
    ?? mine.filter(m => m.state === 'post').sort((a, b) => +new Date(b.date) - +new Date(a.date))[0]
    ?? null;
}

function when(m: SearchMatch) {
  if (m.state === 'in') return <span className="text-rose-300">En juego{m.score ? ` · ${m.score}` : ''}</span>;
  if (m.state === 'post') return <span className="text-zinc-500">Final{m.score ? ` · ${m.score}` : ''}</span>;
  const d = new Date(m.date);
  const day = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }), today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  return <span className="text-zinc-300">{day === today ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'Europe/Madrid' })} {time}</span>;
}

// Arriba de Partidos: los favoritos del deporte que se está viendo, con su partido. Sin favoritos de ese deporte no sale
export function FavoritesStrip() {
  const { app } = useApp();
  const { list } = useFavorites();
  const open = useOpenMatch();
  const favs = useMemo(() => list.filter(f => f.sport === app).slice(0, 12), [list, app]);
  // La misma clave que el buscador de la cabecera: si ya se buscó, no se vuelve a pedir
  const qs = useQueries({ queries: favs.map(f => ({ queryKey: ['search', f.name.trim()], queryFn: () => window.api.search(f.name.trim()), staleTime: 60e3, refetchInterval: 5 * 60e3 })) });
  if (!favs.length) return null;
  const rows = favs.map((f, i) => ({ f, m: qs[i]?.data ? pick(qs[i].data!.matches, f) : null, loading: qs[i]?.isLoading }));
  // Primero los que tienen partido en juego, luego los que tienen uno pronto
  const rank = (r: (typeof rows)[number]) => (r.m?.state === 'in' ? 0 : r.m?.state === 'pre' ? 1 + +new Date(r.m.date) / 1e15 : r.m ? 3 : 4);
  rows.sort((a, b) => rank(a) - rank(b));
  return (
    <Card title="Tus favoritos" action={<span className="text-[11px] text-zinc-500">la estrella de la ficha los añade o los quita</span>} className="mb-5">
      <div className="-mx-5 -my-3 divide-y divide-zinc-800/60">
        {rows.map(({ f, m, loading }) => {
          const rival = m ? (norm(m.home) === norm(f.name) ? m.away : m.home) : null;
          return (
            <div key={f.name} className="flex items-center gap-3 px-5 py-2">
              <TeamLogo src={f.logo} name={f.name} size={24} />
              <button type="button" disabled={!m} onClick={() => m && open(m)}
                className={cn('flex min-w-0 flex-1 items-center gap-3 text-left', m ? 'cursor-pointer' : 'cursor-default')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-50">{f.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {loading ? 'Buscando su partido…' : m ? `contra ${rival}${m.league ? ` · ${m.league}` : ''}` : 'Sin partidos esta semana'}
                  </span>
                </span>
                {m && <span className="shrink-0 text-right text-xs tnum">{when(m)}</span>}
              </button>
              <FavStar name={f.name} logo={f.logo} sport={f.sport} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
