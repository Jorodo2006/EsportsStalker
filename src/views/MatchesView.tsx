import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX, ChevronLeft, ChevronRight, RefreshCw, Radio } from 'lucide-react';
import { useApp, useRefreshMs } from '@/lib/app-context';
import { cn, fmtDay, fmtTime, groupBy, odd } from '@/lib/format';
import type { MatchEvent, MatchTeam } from '@/lib/types';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, Select, TeamLogo } from '@/components/ui';
import MatchDetail from './MatchDetail';

export default function MatchesView() {
  const { settings, saveSettings, openMatch, setOpenMatch } = useApp();
  const refreshMs = useRefreshMs();
  const [page, setPage] = useState<string | null>(null);
  const league = settings?.favoriteLeagues?.[0] || '';

  const leagues = useQuery({ queryKey: ['leagues'], queryFn: () => window.api.esports.leagues(), staleTime: 6 * 3600e3 });
  const live = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: refreshMs });
  const schedule = useQuery({
    queryKey: ['schedule', league, page],
    queryFn: () => window.api.esports.schedule({ leagueIds: league ? [league] : [], pageToken: page })
  });

  // Sin paginar, centramos la vista en hoy: últimos resultados + próximos partidos
  const events = useMemo(() => {
    const list = schedule.data?.events ?? [];
    if (page) return list;
    const cut = Date.now() - 6 * 3600e3;
    return [...list.filter(e => +new Date(e.startTime) < cut).slice(-12), ...list.filter(e => +new Date(e.startTime) >= cut)];
  }, [schedule.data, page]);

  // Cuota de ganador (Pinnacle) en las tarjetas de partidos aún no terminados
  const pending = useMemo(() => [...(live.data ?? []), ...events].filter(e => e.state !== 'completed' && e.teams.length === 2)
    .map(e => ({ id: e.id, a: e.teams[0], b: e.teams[1], start: e.startTime })), [live.data, events]);
  const board = useQuery({
    queryKey: ['board', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: pending.length > 0, refetchInterval: 60_000
  });

  const nextRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!page) nextRef.current?.scrollIntoView({ block: 'center' }); }, [events, page]);
  const firstUpcoming = events.find(e => e.state === 'unstarted')?.id;
  const setOpen = setOpenMatch;

  if (openMatch) return <MatchDetail match={openMatch} onClose={() => setOpenMatch(null)} />;

  return (
    <>
      <PageHeader title="Partidos" subtitle="En directo, calendario y resultados de todas las ligas">
        <Select className="w-64" value={league} onChange={e => { setPage(null); saveSettings({ favoriteLeagues: e.target.value ? [e.target.value] : [] }); }}>
          <option value="">Todas las ligas</option>
          {leagues.data?.map(l => <option key={l.id} value={l.id}>{l.name} · {l.region}</option>)}
        </Select>
        <Button variant="secondary" size="icon" disabled={!schedule.data?.older} onClick={() => setPage(schedule.data!.older)} title="Anteriores"><ChevronLeft size={16} /></Button>
        <Button variant="secondary" size="icon" disabled={!schedule.data?.newer} onClick={() => setPage(schedule.data!.newer)} title="Siguientes"><ChevronRight size={16} /></Button>
        {page && <Button variant="ghost" onClick={() => setPage(null)}>Hoy</Button>}
        <Button variant="secondary" onClick={() => { live.refetch(); schedule.refetch(); }}>
          <RefreshCw size={15} className={schedule.isFetching ? 'animate-spin' : ''} />Actualizar
        </Button>
      </PageHeader>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500"><Radio size={14} className="text-rose-400" />En directo</h2>
        {live.isLoading ? <Loading /> : live.error ? <ErrorBox error={live.error} /> : !live.data?.length
          ? <Empty>No hay partidos en directo ahora mismo</Empty>
          : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">{live.data.map(m => <MatchCard key={m.id} m={m} odds={board.data?.[m.id]} onClick={() => setOpen(m)} />)}</div>}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Calendario y resultados</h2>
        {schedule.isLoading ? <Loading label="Cargando calendario…" /> : schedule.error ? <ErrorBox error={schedule.error} /> : !events.length
          ? <Empty icon={<CalendarX size={28} />}>No hay partidos en este rango</Empty>
          : [...groupBy(events, e => fmtDay(e.startTime))].map(([day, list]) => (
            <div key={day} className="mb-6">
              <div className="mb-2 text-sm font-semibold text-zinc-300 first-letter:uppercase">{day}</div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {list.map(m => (
                  <div key={m.id} ref={m.id === firstUpcoming ? nextRef : undefined}>
                    <MatchCard m={m} odds={board.data?.[m.id]} onClick={() => setOpen(m)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
      </section>

    </>
  );
}

function MatchCard({ m, odds, onClick }: { m: MatchEvent; odds?: { a: number; b: number }; onClick: () => void }) {
  const [a, b] = m.teams;
  if (!a || !b) return null;
  const live = m.state === 'inProgress', done = m.state === 'completed';
  return (
    <button onClick={onClick}
      className={cn('group w-full cursor-pointer rounded-xl border bg-zinc-900/60 p-4 text-left transition hover:border-amber-500/50 hover:bg-zinc-900',
        live ? 'border-rose-500/40 shadow-lg shadow-rose-500/5' : 'border-zinc-800')}>
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span className="truncate">{m.league}{m.blockName && ` · ${m.blockName}`}</span>
        <span className="flex items-center gap-2">
          {live && <Badge tone="live">Directo</Badge>}
          {m.bestOf && <span className="font-medium text-zinc-400">Bo{m.bestOf}</span>}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Team t={a} done={done} />
        <div className={cn('text-center text-xl font-bold tabular-nums', live && 'text-rose-300')}>
          {live || done ? <>{a.wins ?? 0}<span className="mx-1.5 text-zinc-600">:</span>{b.wins ?? 0}</> : <span className="text-base text-zinc-300">{fmtTime(m.startTime)}</span>}
        </div>
        <Team t={b} done={done} right />
      </div>
      {odds && (
        <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2.5 text-xs">
          <span className={cn('rounded-md px-2 py-0.5 font-bold tabular-nums', odds.a <= odds.b ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-800 text-zinc-300')}>{odd(odds.a)}</span>
          <span className="text-zinc-500 group-hover:text-zinc-300">Ver todas las cuotas →</span>
          <span className={cn('rounded-md px-2 py-0.5 font-bold tabular-nums', odds.b < odds.a ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-800 text-zinc-300')}>{odd(odds.b)}</span>
        </div>
      )}
    </button>
  );
}

function Team({ t, done, right }: { t: MatchTeam; done: boolean; right?: boolean }) {
  const win = done && t.outcome === 'win', lose = done && t.outcome === 'loss';
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', right && 'flex-row-reverse text-right')}>
      <TeamLogo src={t.image} name={t.code || t.name} />
      <div className="min-w-0">
        <div className={cn('truncate font-semibold', win && 'text-amber-400', lose && 'text-zinc-500')} title={t.name}>{t.code || t.name}</div>
        {t.record && <div className="text-[11px] text-zinc-500">{t.record}</div>}
      </div>
    </div>
  );
}
