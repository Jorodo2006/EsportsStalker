// LoL · Partidos: misma estructura que el baloncesto. Tira de días, filtro por estado, cuotas de ganador opcionales
// y los partidos agrupados por liga. Al abrir uno se ve su ficha completa (marcador, cuotas y partida en vivo).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX, RefreshCw } from 'lucide-react';
import { useApp, useRefreshMs } from '@/lib/app-context';
import { fmtTime } from '@/lib/format';
import type { MatchEvent } from '@/lib/types';
import { CompetitionBlock, DayStrip, MatchRow, StateFilterBar, Toggle, isoDay, today, type MatchState, type StateFilter } from '@/components/sport';
import { Button, Empty, ErrorBox, Loading, Select } from '@/components/ui';
import MatchDetail from './MatchDetail';

const stateOf = (m: MatchEvent): MatchState => (m.state === 'inProgress' ? 'live' : m.state === 'completed' ? 'post' : 'pre');
const dayOf = (m: MatchEvent) => isoDay(new Date(m.startTime));

function loadPref<T>(key: string, def: T): T { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function savePref(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export default function MatchesView() {
  const { settings, saveSettings, openMatch, setOpenMatch } = useApp();
  const refreshMs = useRefreshMs();
  const [page, setPage] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [showOdds, setShowOdds] = useState(() => loadPref('lol-odds', true));
  const [closed, setClosed] = useState<string[]>(() => loadPref('lol-closed', []));
  const league = settings?.favoriteLeagues?.[0] || '';

  const leagues = useQuery({ queryKey: ['leagues'], queryFn: () => window.api.esports.leagues(), staleTime: 6 * 3600e3 });
  const live = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: refreshMs });
  const schedule = useQuery({
    queryKey: ['schedule', league, page],
    queryFn: () => window.api.esports.schedule({ leagueIds: league ? [league] : [], pageToken: page })
  });

  // Calendario cargado + los que están en juego (pueden no estar en la página)
  const events = useMemo(() => {
    const map = new Map<string, MatchEvent>();
    for (const e of [...(schedule.data?.events ?? []), ...(live.data ?? [])]) if (e.teams.length === 2) map.set(e.id, e);
    return [...map.values()].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
  }, [schedule.data, live.data]);
  const counts = useMemo(() => {
    const out: Record<string, { total: number; live: number }> = {};
    for (const e of events) { const d = (out[dayOf(e)] ??= { total: 0, live: 0 }); d.total++; if (e.state === 'inProgress') d.live++; }
    return out;
  }, [events]);
  const ofDay = events.filter(e => dayOf(e) === date);
  const shown = ofDay.filter(e => filter === 'all' || stateOf(e) === filter);
  const byLeague = useMemo(() => {
    const m = new Map<string, MatchEvent[]>();
    for (const e of shown) m.set(e.league, [...(m.get(e.league) ?? []), e]);
    return [...m.entries()];
  }, [shown]);

  const pending = useMemo(() => ofDay.filter(e => e.state !== 'completed').map(e => ({ id: e.id, a: e.teams[0], b: e.teams[1], start: e.startTime })), [ofDay]);
  const board = useQuery({
    queryKey: ['board', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: showOdds && pending.length > 0, refetchInterval: 60_000
  });

  if (openMatch) return <MatchDetail match={openMatch} onClose={() => setOpenMatch(null)} />;

  const stateCounts = { all: ofDay.length, live: ofDay.filter(e => e.state === 'inProgress').length, pre: ofDay.filter(e => e.state === 'unstarted').length, post: ofDay.filter(e => e.state === 'completed').length };
  const loaded = Object.keys(counts).sort();
  const outside = !!loaded.length && (date < loaded[0] || date > loaded[loaded.length - 1]);
  const toggle = (name: string) => { const n = closed.includes(name) ? closed.filter(x => x !== name) : [...closed, name]; setClosed(n); savePref('lol-closed', n); };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <DayStrip value={date} onChange={setDate} counts={counts} />
      <StateFilterBar value={filter} onChange={setFilter} counts={stateCounts}>
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('lol-odds', v); }} label="Cuotas" />
        <Select className="h-8 w-52" value={league} onChange={e => { setPage(null); saveSettings({ favoriteLeagues: e.target.value ? [e.target.value] : [] }); }}>
          <option value="">Todas las ligas</option>
          {leagues.data?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Button variant="ghost" size="icon" title="Actualizar" onClick={() => { live.refetch(); schedule.refetch(); }}>
          <RefreshCw size={15} className={schedule.isFetching ? 'animate-spin' : ''} />
        </Button>
      </StateFilterBar>

      {schedule.isLoading ? <Loading label="Cargando calendario…" /> : schedule.error ? <ErrorBox error={schedule.error} /> : !shown.length ? (
        <Empty icon={<CalendarX size={26} />}>
          {outside ? 'Ese día queda fuera del calendario cargado.' : 'Ese día no hay partidos de LoL con este filtro.'}
          <div className="mt-3 flex gap-2">
            {outside && date < loaded[0] && schedule.data?.older && <Button size="sm" variant="secondary" onClick={() => setPage(schedule.data!.older)}>Cargar días anteriores</Button>}
            {outside && date > loaded[loaded.length - 1] && schedule.data?.newer && <Button size="sm" variant="secondary" onClick={() => setPage(schedule.data!.newer)}>Cargar días siguientes</Button>}
            {page && <Button size="sm" variant="ghost" onClick={() => { setPage(null); setDate(today()); }}>Volver a hoy</Button>}
          </div>
        </Empty>
      ) : byLeague.map(([name, list]) => {
        const meta = leagues.data?.find(l => l.name === name);
        return (
          <CompetitionBlock key={name} name={name} sub={[meta?.region, list[0]?.blockName].filter(Boolean).join(', ')} logo={meta?.image}
            count={list.length} live={list.filter(e => e.state === 'inProgress').length} open={!closed.includes(name)} onToggle={() => toggle(name)}>
            {list.map(m => {
              const [a, b] = m.teams, st = stateOf(m);
              return (
                <MatchRow key={m.id} state={st} onClick={() => setOpenMatch(m)} odds={showOdds ? board.data?.[m.id] : null}
                  time={st === 'pre' ? fmtTime(m.startTime) : st === 'live' ? 'En juego' : 'Final'} tag={m.bestOf ? `Bo${m.bestOf}` : undefined}
                  a={{ name: a.name, short: a.code, logo: a.image, score: st === 'pre' ? null : a.wins ?? 0, win: a.outcome === 'win', lose: a.outcome === 'loss' }}
                  b={{ name: b.name, short: b.code, logo: b.image, score: st === 'pre' ? null : b.wins ?? 0, win: b.outcome === 'win', lose: b.outcome === 'loss' }} />
              );
            })}
          </CompetitionBlock>
        );
      })}
    </div>
  );
}
