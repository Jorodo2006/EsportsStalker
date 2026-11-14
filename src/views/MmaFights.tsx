// MMA · Combates: como las demás apps. Tira de días (hora de España), filtro por estado y organización (UFC, PFL, WOW), combates
// agrupados por evento con el principal arriba y, al pulsar uno, su ficha: comparativa de los luchadores con lo que dice el
// modelo, recomendaciones y las cuotas de Winamax y Betway.
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarX, Plus } from 'lucide-react';
import { sectionId, useApp, useFocus, useSections } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { MmaFight, MmaFighter, MmaOrg } from '@/lib/types';
import { SportOdds } from '@/components/BasketOdds';
import { MmaDayPicks, MmaPicksPanel, PredBlock, usePicks } from '@/components/MmaPicks';
import { MmaFighterSheet } from '@/components/MmaFighterSheet';
import { MmaSpotlight } from '@/components/MmaSpotlight';
import { fightTime, METHOD_ES, resultShort, surname, targetOfFight, winnerText } from '@/components/mma';
import { CompetitionBlock, DayStrip, LiveSection, MatchCard, MatchesTitle, Scoreboard, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { Badge, Button, Empty, ErrorBox, Loading } from '@/components/ui';
import { Panel, TvFrame, TvHeader, panel } from '@/components/viz';
import { FavoritesStrip } from '@/components/Favorites';

const stateOf = (f: MmaFight): MatchState => (f.state === 'in' ? 'live' : f.state);
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const ORGS: { id: MmaOrg; label: string }[] = [{ id: 'ufc', label: 'UFC' }, { id: 'pfl', label: 'PFL' }, { id: 'wow', label: 'WOW' }];

function loadPref<T>(key: string, def: T): T { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function savePref(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export default function MmaFights() {
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>(() => loadPref('mma-closed', []));
  const [showOdds, setShowOdds] = useState(() => loadPref('mma-odds', true));
  const [orgs, setOrgs] = useState<Record<MmaOrg, boolean>>(() => ({ ufc: true, pfl: true, wow: true, ...loadPref<Partial<Record<MmaOrg, boolean>>>('mma-orgs', {}) }));
  const ok = !!window.api.mma;

  const days = useQuery({ queryKey: ['mma', 'days', date], queryFn: () => window.api.mma.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['mma', 'games', date], queryFn: () => window.api.mma.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 15_000 : 120_000)
  });
  const all = (games.data ?? []).filter(f => orgs[f.org]);
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  const liveNow = shown.filter(g => g.state === 'in');
  // Por evento: el principal arriba (cardPos 1), y los eventos por hora de su primer combate
  const byEvent = useMemo(() => {
    const m = new Map<string, MmaFight[]>();
    for (const g of shown) if (g.state !== 'in') m.set(g.eventId || g.event, [...(m.get(g.eventId || g.event) ?? []), g]);
    return [...m.entries()].map(([k, list]) => [k, list.slice().sort((x, y) => x.cardPos - y.cardPos)] as const)
      .sort((x, y) => x[1].map(f => f.date).sort()[0].localeCompare(y[1].map(f => f.date).sort()[0]));
  }, [shown]);
  const pending = useMemo(() => all.filter(g => g.state !== 'post' && !g.cancelled).map(g => ({ id: g.id, ...targetOfFight(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'mma', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = (games.data ?? []).find(g => g.id === openId) ?? null;
  useSections(open ? [] : [
    ...(liveNow.length ? [{ id: 'comp-en-directo', label: 'En directo', count: liveNow.length, live: liveNow.length }] : []),
    ...byEvent.map(([k, list]) => ({ id: sectionId(k), label: list[0].event, count: list.length, live: 0 }))
  ]);
  const has = useCallback((id: string) => (games.data ?? []).some(g => g.id === id), [games.data]);
  useFocus(setOpenId, has, setDate);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para MMA hay que parar <code>npm run dev</code> y volver a lanzarlo.</ErrorBox>;
  if (open) return <FightDetail key={open.id} f={open} onClose={() => setOpenId(null)} />;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); savePref('mma-closed', n); };
  const setOrg = (id: MmaOrg, v: boolean) => { const n = { ...orgs, [id]: v }; setOrgs(n); savePref('mma-orgs', n); };
  const card = (g: MmaFight, featured?: boolean) => {
    const st = stateOf(g), r = g.result;
    const side = (f: MmaFighter, w: 'a' | 'b') => ({ name: f.name, logo: f.flag, win: !!r && r.winner === w, lose: st === 'post' && !!r && r.winner != null && r.winner !== w });
    return (
      <MatchCard key={g.id} state={st} onClick={() => setOpenId(g.id)} odds={showOdds && !g.cancelled ? board.data?.[g.id] : null} featured={featured}
        competition={featured ? g.event : undefined} tag={g.cardPos === 1 ? 'Principal' : g.cardPos === 2 ? 'Co-principal' : undefined}
        time={g.cancelled ? 'Cancelado' : st === 'pre' ? fightTime(g) : st === 'live' ? 'En juego' : 'Final'}
        status={st === 'post' ? [resultShort(g), g.weightClass].filter(Boolean).join(' · ') : st === 'live' ? g.status : [g.weightClass, g.rounds >= 5 ? '5 asaltos' : ''].filter(Boolean).join(' · ')}
        a={side(g.a, 'a')} b={side(g.b, 'b')} />
    );
  };
  return (
    <div className="flex flex-col gap-5">
      <MatchesTitle date={date} />
      <FavoritesStrip />
      <DayStrip value={date} onChange={setDate} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        {ORGS.map(o => <Toggle key={o.id} on={orgs[o.id]} onChange={v => setOrg(o.id, v)} label={o.label} />)}
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); savePref('mma-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      <MmaDayPicks date={date} onOpen={setOpenId} />
      {games.isLoading ? <Loading label="Cargando combates…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? <Empty icon={<CalendarX size={22} />}>Ese día no hay combates de UFC, PFL ni WOW con este filtro.</Empty>
          : <>
            {!!liveNow.length && <LiveSection count={liveNow.length}>{liveNow.map(g => card(g, true))}</LiveSection>}
            {byEvent.map(([k, list]) => (
              <CompetitionBlock key={k} id={sectionId(k)} name={list[0].event} sub={[list[0].orgName, list[0].city].filter(Boolean).join(', ')}
                count={list.length} open={!closed.includes(k)} onToggle={() => toggle(k)}>
                {list.map(g => card(g))}
              </CompetitionBlock>
            ))}
          </>}
    </div>
  );
}

type Tab = 'tape' | 'picks' | 'odds';

function FightDetail({ f, onClose }: { f: MmaFight; onClose: () => void }) {
  const { openBet } = useApp();
  const st = stateOf(f);
  const [tab, setTab] = useState<Tab>(st === 'pre' ? 'picks' : 'tape');
  const [sheet, setSheet] = useState<string | null>(null);
  const t = targetOfFight(f);
  if (sheet) return <MmaFighterSheet key={sheet} id={sheet} backLabel="Combate" onBack={() => setSheet(null)} onFighter={setSheet} />;
  const done = st === 'post' || !!f.cancelled;
  const side = (x: MmaFighter) => ({ name: x.name, short: x.record, logo: x.photo || x.flag });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={16} />Volver a combates</button>
      <Scoreboard competition={f.event} detail={[f.orgName, f.weightClass, `${f.rounds} asaltos`, f.city].filter(Boolean).join(' · ')} state="pre"
        a={side(f.a)} b={side(f.b)}
        center={f.cancelled ? 'Cancelado' : st === 'pre' ? fightTime(f) : st === 'live' ? 'En juego' : f.result?.method ? METHOD_ES[f.result.method] : 'Final'}
        centerSub={st === 'pre' && !f.cancelled ? new Date(f.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : st === 'live' ? f.status : [winnerText(f), resultShort(f)].filter(Boolean).join(' · ')}>
        <SheetTabs value={tab} onChange={setTab} items={[
          ['tape', 'Comparativa'], ...(st === 'pre' && !f.cancelled ? [['picks', 'Recomendaciones']] as [Tab, string][] : []), ...(done ? [] : [['odds', 'Cuotas']] as [Tab, string][])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'mma', league: f.orgName, event: t.event })}><Plus size={14} />Apuesta</Button>} />
      </Scoreboard>
      {tab === 'tape' ? <Tape f={f} onFighter={setSheet} /> : tab === 'odds' ? <SportOdds target={t} /> : <MmaPicksPanel m={f} onOdds={() => setTab('odds')} />}
    </div>
  );
}

// Lo que dice el modelo (si no ha empezado), los datos de cada luchador cara a cara y sus últimos combates
function Tape({ f, onFighter }: { f: MmaFight; onFighter: (id: string) => void }) {
  const pre = f.state === 'pre' && !f.cancelled;
  const picks = usePicks(f);
  const qa = useQuery({ queryKey: ['mma', 'fighter', f.a.id], queryFn: () => window.api.mma.fighter(f.a.id), staleTime: 30 * 60e3, retry: false });
  const qb = useQuery({ queryKey: ['mma', 'fighter', f.b.id], queryFn: () => window.api.mma.fighter(f.b.id), staleTime: 30 * 60e3, retry: false });
  const ea = qa.data?.rating?.elo ?? null, eb = qb.data?.rating?.elo ?? null;
  return (
    <div className="flex flex-col gap-2.5">
      {pre && picks.data?.pred && <TvFrame><TvHeader title="Lo que dice el modelo" sub={`fiabilidad ${picks.data.pred.reliability}`}><PredBlock m={f} pred={picks.data.pred} /></TvHeader></TvFrame>}
      <MmaSpotlight f={f} eloA={ea} eloB={eb} cardA={qa.data} cardB={qb.data} onFighter={onFighter} />
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {([[f.a, qa], [f.b, qb]] as const).map(([x, q]) => (
          <div key={x.id} className={cn(panel, 'overflow-hidden')}>
            <div className="flex items-center gap-2.5 border-b border-zinc-800 bg-zinc-900 px-3.5 py-2 text-zinc-50">
              <button onClick={() => onFighter(x.id)} title="Ver su ficha" className="min-w-0 flex-1 cursor-pointer truncate text-left text-[15px] font-semibold hover:text-amber-400">{x.name}</button>
              <span className="font-mono text-[13px] font-bold text-zinc-400">{x.record}</span>
            </div>
            {q.isLoading ? <div className="px-4"><Loading /></div> : !q.data?.history.length ? <div className="px-3.5 py-2.5 text-[13px] text-zinc-500">Sin combates en el historial.</div> : (
              <div className="divide-y divide-zinc-800/60">
                {q.data.history.slice(0, 5).map(h => (
                  <div key={h.id} className="flex items-center gap-2.5 px-3.5 py-1.5 text-[13px]">
                    <Badge tone={h.result === 'G' ? 'success' : h.result === 'P' ? 'danger' : 'neutral'}>{h.result === 'N' ? 'NC' : h.result}</Badge>
                    <div className="min-w-0 flex-1"><div className="truncate">vs {surname(h.opponent.name)}</div><div className="truncate text-xs text-zinc-500">{h.event}</div></div>
                    <span className="shrink-0 text-xs text-zinc-400">{[METHOD_ES[h.method], h.round ? `R${h.round}` : ''].filter(Boolean).join(' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Panel title="Sobre estos datos">
        <p className="px-4 py-2.5 text-[13px] text-zinc-400">El Elo y el historial salen de los combates de UFC, PFL y WOW desde 2016. ESPN no da el método de cada victoria ni la edad, la altura o el peso; WOW sí.</p>
      </Panel>
    </div>
  );
}
