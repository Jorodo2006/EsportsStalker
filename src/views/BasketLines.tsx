// Baloncesto · Líneas: el escáner con los partidos que aún no han empezado. Por defecto las próximas 24 horas y no el día natural:
// en hora de España los partidos de la NBA de esta noche ya cuentan como de mañana.
import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarX } from 'lucide-react';
import { BasketAnalyzer, LEAGUE_NAME, esTime, type Picked } from '@/components/BasketAnalyzer';
import { BasketLineScanner } from '@/components/BasketLineScanner';
import { useBasketOdds } from '@/components/BasketOdds';
import { addDays, today } from '@/components/sport';
import { Empty, ErrorBox, Loading, Select } from '@/components/ui';
import { TvTabs, panel } from '@/components/viz';
import { cn } from '@/lib/format';
import type { BasketGame, BasketInjury, BasketLeagueId } from '@/lib/types';

const NEXT = 'next';
const ORDER: BasketLeagueId[] = ['nba', 'euroleague', 'eurocup', 'wnba'];
const dayName = (iso: string, i: number) => (i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long' }));

export default function BasketLines() {
  const days = useMemo(() => [0, 1, 2].map(n => addDays(today(), n)), []);
  const lists = useQueries({
    queries: days.map(d => ({ queryKey: ['basket', 'games', d], queryFn: () => window.api.basket.games(d), staleTime: 60_000, refetchInterval: 120_000 }))
  });
  const injuries = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), staleTime: 10 * 60e3 });
  const [range, setRange] = useState(NEXT);
  const [league, setLeague] = useState<'all' | BasketLeagueId>('all');
  const [gameId, setGameId] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);

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

  const loading = lists.some(q => q.isLoading), error = lists.find(q => q.error)?.error;
  const pickRange = (id: string) => { setRange(id); setGameId(''); };
  return (
    <>
      {picked && <PickedPlayer player={picked} injuries={injuries.data ?? []} onBack={() => setPicked(null)} />}
      <div className={cn('flex flex-col gap-2.5', picked && 'hidden')}>
        <div className={cn(panel, 'flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5')}>
          <TvTabs value={range} onChange={pickRange} items={[{ value: NEXT, label: 'Próximas 24 h' }, ...days.map((d, i) => ({ value: d, label: dayName(d, i) }))]} />
          <TvTabs value={league} onChange={l => { setLeague(l); setGameId(''); }} items={[{ value: 'all' as const, label: 'Todas' }, ...leagues.map(l => ({ value: l, label: LEAGUE_NAME[l] }))]} />
          <Select aria-label="Partido" className="h-7 w-64 text-xs" value={gameId} onChange={e => setGameId(e.target.value)}>
            <option value="">Todos los partidos ({byLeague.length})</option>
            {byLeague.map(g => <option key={g.id} value={g.id}>{g.away.abbr} @ {g.home.abbr}, {esTime(g.date)}</option>)}
          </Select>
        </div>
        {loading ? <Loading label="Cargando partidos…" /> : error ? <ErrorBox error={error} /> : !games.length
          ? <Empty icon={<CalendarX size={26} />}>No quedan partidos por empezar en ese intervalo. Prueba con otro día.</Empty>
          : <BasketLineScanner games={games} injuries={injuries.data ?? []} onPick={setPicked} />}
      </div>
    </>
  );
}

function PickedPlayer({ player, injuries, onBack }: { player: Picked; injuries: BasketInjury[]; onBack: () => void }) {
  const odds = useBasketOdds(player.game!);
  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={15} />Volver a la lista</button>
      <BasketAnalyzer key={`${player.league}:${player.id}:${player.market}:${player.line}`} player={player} games={[player.game!]} injuries={injuries} odds={odds.data} />
    </div>
  );
}
