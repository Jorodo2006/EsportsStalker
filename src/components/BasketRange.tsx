// Partidos que aún no han empezado, para el escáner de líneas y las recomendaciones. Por defecto las próximas 24 horas y no el día
// natural: en hora de España los partidos de la NBA de esta noche ya cuentan como de mañana.
import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import type { BasketGame, BasketLeagueId } from '@/lib/types';
import { LEAGUE_NAME, esTime } from './BasketAnalyzer';
import { addDays, today } from './sport';
import { Select } from './ui';
import { TvTabs, panel } from './viz';

const NEXT = 'next';
const ORDER: BasketLeagueId[] = ['nba', 'euroleague', 'eurocup', 'wnba'];
const dayName = (iso: string, i: number) => (i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long' }));

export function useUpcomingGames() {
  const days = useMemo(() => [0, 1, 2].map(n => addDays(today(), n)), []);
  const lists = useQueries({
    queries: days.map(d => ({ queryKey: ['basket', 'games', d], queryFn: () => window.api.basket.games(d), staleTime: 60_000, refetchInterval: 120_000 }))
  });
  const injuries = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), staleTime: 10 * 60e3 });
  const [range, setRange] = useState(NEXT);
  const [league, setLeague] = useState<'all' | BasketLeagueId>('all');
  const [gameId, setGameId] = useState('');

  // Sólo los que no han empezado: una proyección de antes del partido no vale para uno en juego
  const pre = useMemo(() => {
    const seen = new Map<string, BasketGame>();
    for (const q of lists) for (const g of q.data ?? []) if (g.state === 'pre') seen.set(g.id, g);
    return [...seen.values()].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [lists.map(q => q.dataUpdatedAt).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const inRange = useMemo(() => {
    if (range !== NEXT) return (lists[days.indexOf(range)]?.data ?? []).filter(g => g.state === 'pre');
    const limit = Date.now() + 24 * 3600e3;
    return pre.filter(g => +new Date(g.date) < limit);
  }, [pre, range, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const leagues = ORDER.filter(l => inRange.some(g => g.league === l));
  const byLeague = inRange.filter(g => league === 'all' || g.league === league);
  const games = useMemo(() => byLeague.filter(g => !gameId || g.id === gameId), [byLeague.map(g => g.id).join(), gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    games, byLeague, leagues, days, range, league, gameId, injuries: injuries.data ?? [],
    loading: lists.some(q => q.isLoading), error: lists.find(q => q.error)?.error,
    pickRange: (id: string) => { setRange(id); setGameId(''); },
    pickLeague: (l: 'all' | BasketLeagueId) => { setLeague(l); setGameId(''); },
    pickGame: setGameId
  };
}

export function RangeFilters({ u }: { u: ReturnType<typeof useUpcomingGames> }) {
  return (
    <div className={cn(panel, 'flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5')}>
      <TvTabs value={u.range} onChange={u.pickRange} items={[{ value: NEXT, label: 'Próximas 24 h' }, ...u.days.map((d, i) => ({ value: d, label: dayName(d, i) }))]} />
      <TvTabs value={u.league} onChange={u.pickLeague} items={[{ value: 'all' as const, label: 'Todas' }, ...u.leagues.map(l => ({ value: l, label: LEAGUE_NAME[l] }))]} />
      <Select aria-label="Partido" className="h-7 w-full text-xs sm:w-64 lg:h-7 lg:text-xs" value={u.gameId} onChange={e => u.pickGame(e.target.value)}>
        <option value="">Todos los partidos ({u.byLeague.length})</option>
        {u.byLeague.map(g => <option key={g.id} value={g.id}>{g.away.abbr} @ {g.home.abbr}, {esTime(g.date)}</option>)}
      </Select>
    </div>
  );
}
