// Fútbol · Partidos: igual que en baloncesto y tenis. Tira de días (hora de España), filtro por estado, los partidos en juego
// arriba y el resto por competición, con la cuota 1X2 en cada tarjeta; al pulsar uno, su ficha: marcador grande con los
// goleadores, resumen (goles, tarjetas y cambios), cuotas de Winamax y Betway, estadísticas, alineaciones, forma, cara a cara
// y clasificación.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarX, Plus } from 'lucide-react';
import { sectionId, useApp, useFocus, useSections } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { FootballDetail, FootballEvent, FootballLeagueId, FootballMatch, FootballPastGame, FootballShot, FootballTeam } from '@/lib/types';
import { SportOdds, useMatchOdds, type OddsTarget } from '@/components/BasketOdds';
import { TrendsTable, footballMarkets, footballTrendData } from '@/components/Trends';
import { CompetitionBlock, DayStrip, LiveDot, LiveSection, MatchCard, MatchesTitle, SheetTabs, StateFilterBar, Toggle, today, type MatchState, type StateFilter } from '@/components/sport';
import { FootballIcon, StandingsTable, esTime, themeOf } from '@/components/football';
import { Button, Dialog, Empty, ErrorBox, Loading, TeamLogo, panelCls, seg, segWrap } from '@/components/ui';
import { Panel, TvRow } from '@/components/viz';

const stateOf = (g: FootballMatch): MatchState => (g.state === 'in' ? 'live' : g.state);
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };

function loadList(key: string): string[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function saveList(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
function loadFlag(key: string, def: boolean): boolean { try { const v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch { return def; } }
function saveFlag(key: string, v: boolean) { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }

// El partido para el lector, el comparador y el cupón: local (a) contra visitante (b), con los mismos nombres que usa el
// programador de lecturas (server/services/odds/scheduler.js), que son la clave del partido. Sin la abreviatura entre los
// otros nombres ("VAL" está dentro de "Valladolid"); los filiales ("Real Sociedad II") en las casas son "Real Sociedad B"
const teamRef = (t: FootballTeam) => ({
  name: t.name, code: '',
  alt: [...new Set([...(/\sII$/.test(t.name) ? [t.name.replace(/\sII$/, ' B')] : []), ...(t.alts ?? []).filter(x => x && x !== t.name && x !== t.abbr)])]
});
export const targetOfFootball = (m: FootballMatch): OddsTarget => ({
  id: m.id, done: m.state === 'post', sport: 'football', event: `${m.home.name} - ${m.away.name}`, league: m.leagueName,
  match: { a: teamRef(m.home), b: teamRef(m.away), start: m.date, sport: 'football', league: m.league }
});

export default function FootballMatches() {
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [closed, setClosed] = useState(() => loadList('football-closed'));
  const [showOdds, setShowOdds] = useState(() => loadFlag('football-odds', true));
  const ok = !!window.api.football;

  const leagues = useQuery({ queryKey: ['football', 'leagues'], queryFn: () => window.api.football.leagues(), staleTime: 24 * 3600e3, enabled: ok });
  const days = useQuery({ queryKey: ['football', 'days', date], queryFn: () => window.api.football.days(addWeekStart(date), 7), staleTime: 5 * 60e3, enabled: ok });
  const games = useQuery({
    queryKey: ['football', 'games', date], queryFn: () => window.api.football.games(date), enabled: ok,
    refetchInterval: q => (q.state.data?.some(g => g.state === 'in') ? 20_000 : 120_000)
  });

  const all = games.data ?? [];
  const counts = useMemo(() => ({
    all: all.length, live: all.filter(g => g.state === 'in').length, pre: all.filter(g => g.state === 'pre').length, post: all.filter(g => g.state === 'post').length
  }), [all]);
  const shown = all.filter(g => filter === 'all' || stateOf(g) === filter);
  // Los que están en juego van arriba, destacados; el resto por competición, en el orden del servicio
  const liveNow = shown.filter(g => g.state === 'in');
  const order = (leagues.data ?? []).map(l => l.id);
  const byLeague = useMemo(() => {
    const m = new Map<FootballLeagueId, FootballMatch[]>();
    for (const g of shown) if (g.state !== 'in') m.set(g.league, [...(m.get(g.league) ?? []), g]);
    return [...m.entries()].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
  }, [shown, order.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cuota 1X2 de las tarjetas: la mejor de las casas ya leídas
  const pending = useMemo(() => all.filter(g => g.state !== 'post' && !g.off).map(g => ({ id: g.id, ...targetOfFootball(g).match, start: g.date })), [all]);
  const board = useQuery({
    queryKey: ['board', 'football', pending.map(e => e.id).join()], queryFn: () => window.api.odds.board(pending),
    enabled: ok && showOdds && pending.length > 0, refetchInterval: 60_000
  });
  const open = openId ? all.find(g => g.id === openId) ?? null : null;
  useSections(openId ? [] : [
    ...(liveNow.length ? [{ id: 'comp-en-directo', label: 'En directo', count: liveNow.length, live: liveNow.length }] : []),
    ...byLeague.map(([, list]) => ({ id: sectionId(list[0].leagueName), label: list[0].leagueName, count: list.length, live: 0 }))
  ]);
  const has = useCallback((id: string) => /^(laliga|champions|premier|seriea|bundesliga|ligue1|europa|conference|segunda|copa):\d+$/.test(id), []);
  useFocus(setOpenId, has);

  if (!ok) return <ErrorBox error="Falta reiniciar la app">Para el fútbol hay que volver a lanzar <code>npm run backend</code> y recargar la página.</ErrorBox>;
  // La ficha se carga por su id: también abre los partidos que llegan desde la columna de directo aunque sean de otro día
  if (openId) return <MatchDetail key={openId} id={openId} preview={open} onClose={() => setOpenId(null)} />;

  const toggle = (k: string) => { const n = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(n); saveList('football-closed', n); };
  const card = (g: FootballMatch, featured?: boolean) => {
    const st = stateOf(g), done = st === 'post' && !g.off;
    const hs = g.home.score ?? 0, as = g.away.score ?? 0;
    return (
      <MatchCard key={g.id} state={st} onClick={() => setOpenId(g.id)} featured={featured} odds={showOdds ? board.data?.[g.id] : null}
        competition={featured ? g.leagueName : undefined}
        time={st === 'pre' ? esTime(g.date) : st === 'live' ? 'En juego' : g.off ? g.status : 'Final'}
        status={st === 'live' ? g.status : g.stage || undefined}
        a={{ name: g.home.name, short: g.home.abbr, logo: g.home.logo, score: g.off ? null : g.home.score, win: done && hs > as, lose: done && hs < as }}
        b={{ name: g.away.name, short: g.away.abbr, logo: g.away.logo, score: g.off ? null : g.away.score, win: done && as > hs, lose: done && as < hs }} />
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <MatchesTitle date={date} />
      <DayStrip value={date} onChange={d => { setDate(d); setOpenId(null); }} counts={days.data} />
      <StateFilterBar value={filter} onChange={setFilter} counts={counts}>
        <Toggle on={showOdds} onChange={v => { setShowOdds(v); saveFlag('football-odds', v); }} label="Cuotas" />
      </StateFilterBar>
      {games.isLoading ? <Loading label="Cargando partidos…" /> : games.error ? <ErrorBox error={games.error} />
        : !shown.length ? <Empty icon={<CalendarX size={22} />}>Ese día no hay partidos de las ligas que sigue la app. Prueba otro día de la tira.</Empty>
          : <>
            {!!liveNow.length && <LiveSection count={liveNow.length}>{liveNow.map(g => card(g, true))}</LiveSection>}
            {byLeague.map(([id, list]) => {
              const meta = leagues.data?.find(l => l.id === id);
              return (
                <CompetitionBlock key={id} id={sectionId(list[0].leagueName)} name={list[0].leagueName} sub={meta?.country} logo={meta?.logo}
                  count={list.length} open={!closed.includes(id)} onToggle={() => toggle(id)}>
                  {list.map(g => card(g))}
                </CompetitionBlock>
              );
            })}
          </>}
    </div>
  );
}

// ---------- ficha del partido ----------
type Tab = 'summary' | 'odds' | 'stats' | 'lineups' | 'form' | 'h2h' | 'table';

function MatchDetail({ id, preview, onClose }: { id: string; preview: FootballMatch | null; onClose: () => void }) {
  const { openBet } = useApp();
  const q = useQuery({
    queryKey: ['football', 'match', id], queryFn: () => window.api.football.match(id),
    refetchInterval: r => (r.state.data?.match.state === 'in' ? 20_000 : false)
  });
  const m = q.data?.match ?? preview;
  const [tab, setTab] = useState<Tab | null>(null);
  const back = (
    <button onClick={onClose} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100">
      <ArrowLeft size={16} />Volver a partidos
    </button>
  );
  if (!m) return <div className="flex flex-col gap-3">{back}{q.error ? <ErrorBox error={q.error} /> : <Loading label="Cargando el partido…" />}</div>;
  const st = stateOf(m);
  // Antes de empezar no hay resumen ni estadísticas: se abre la forma de los dos
  const current: Tab = tab ?? (st === 'pre' ? 'form' : 'summary');
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      {back}
      <MatchHeader m={m} events={d?.timeline ?? m.incidents} attendance={d?.attendance ?? null}>
        <SheetTabs value={current} onChange={setTab} items={[
          ['summary', 'Resumen'], ...(st === 'post' || m.off ? [] : [['odds', 'Cuotas']] as [Tab, string][]),
          ['stats', 'Estadísticas'], ['lineups', 'Alineaciones'], ['form', 'Forma'], ['h2h', 'H2H'],
          ...(m.league !== 'copa' ? [['table', 'Clasificación']] as [Tab, string][] : [])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'football', league: m.leagueName, event: targetOfFootball(m).event })}><Plus size={14} />Apuesta</Button>} />
      </MatchHeader>
      {current === 'odds' ? <SportOdds target={targetOfFootball(m)} />
        : !d ? (q.error ? <ErrorBox error={q.error} /> : <Loading label="Cargando la ficha…" />)
        : current === 'summary' ? <Timeline d={d} />
          : current === 'stats' ? <div className="flex flex-col gap-3">{!!d.shots?.length && <MatchShotMap m={m} shots={d.shots} />}<Stats d={d} /></div>
            : current === 'lineups' ? <Lineups d={d} />
              : current === 'form' ? <Form d={d} />
                : current === 'h2h' ? <FootballTrends d={d} />
                : <Table m={m} />}
    </div>
  );
}

const isGoal = (e: FootballEvent) => e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'owngoal';
const goalNote = (e: FootballEvent) => (e.kind === 'penalty' ? ' (p.)' : e.kind === 'owngoal' ? ' (p.p.)' : '');

// "Fermín López" → "F. López"; los nombres de una palabra ("Gavi", "Pedri") se quedan igual
const shortName = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length < 2 ? name : `${p[0][0]}. ${p.slice(1).join(' ')}`;
};

// Parte del partido de un minuto de ESPN ("45'+2'", "90'+5'", "105'"): 1 y 2 las partes, 3 la prórroga
const phaseOf = (minute: string) => {
  const base = parseInt(minute, 10);
  if (!isFinite(base)) return 0;
  return base <= 45 ? 1 : base <= 90 ? 2 : 3; // "90'+5'" es base 90: segunda parte
};

// Marcador tras cada gol (en propia puerta, ESPN lo apunta al equipo que se beneficia) y por partes
function scoreLine(m: FootballMatch, events: FootballEvent[]) {
  let h = 0, a = 0, phase = 1;
  const after: ([number, number] | null)[] = [];
  const phases: number[] = [];
  const atEnd: Record<number, [number, number]> = {};
  for (const e of events) {
    phase = Math.max(phase, phaseOf(e.minute) || phase); // ESPN las da en orden: una parte nunca vuelve atrás
    if (isGoal(e)) { if (e.team === m.home.id) h++; else if (e.team === m.away.id) a++; }
    after.push(isGoal(e) ? [h, a] : null);
    phases.push(phase);
    atEnd[phase] = [h, a];
  }
  // Al descanso: lo que había al acabar la primera parte (o 0-0 si no pasó nada)
  const half = atEnd[1] ?? [0, 0];
  return { after, phases, half };
}

// ---------- cabecera del partido ----------
// Fondo neutro (sin teñir con los colores de los equipos, que se mezclan cuando los dos son rojos), escudos grandes
// encima del nombre, el marcador en el centro con el estado y el resultado al descanso, y los goleadores bajo su equipo
function MatchHeader({ m, events, attendance, children }: { m: FootballMatch; events: FootballEvent[]; attendance: number | null; children: ReactNode }) {
  const st = stateOf(m);
  const hs = m.home.score ?? 0, as = m.away.score ?? 0;
  const lead = st === 'pre' || m.off || hs === as ? null : hs > as ? 'home' : 'away';
  const { phases, half } = scoreLine(m, events);
  const pastHalf = st === 'post' || phases.some(p => p >= 2) || /descanso|2.ª|segunda/i.test(m.status);
  const where = [m.venue && `${m.venue}${m.city ? `, ${m.city}` : ''}`, attendance ? `${attendance.toLocaleString('es-ES')} espectadores` : ''].filter(Boolean).join(' · ');

  const side = (t: FootballTeam, which: 'home' | 'away') => {
    // Goles por jugador ("F. López 45', 66'") y rojas
    const mine = events.filter(e => e.team === t.id && (isGoal(e) || e.kind === 'red'));
    const byPlayer = new Map<string, FootballEvent[]>();
    for (const e of mine) byPlayer.set(`${e.kind === 'red' ? 'r' : 'g'}|${e.player}`, [...(byPlayer.get(`${e.kind === 'red' ? 'r' : 'g'}|${e.player}`) ?? []), e]);
    const plate = themeOf(t)?.plate;
    return (
      <div className="flex min-w-0 flex-col items-center gap-2 text-center">
        <span className={cn('grid shrink-0 place-items-center', plate && 'rounded-xl bg-white/90 p-1.5')}>
          <TeamLogo src={t.logo} name={t.abbr} size={56} />
        </span>
        <div className={cn('max-w-full truncate text-sm font-semibold sm:text-lg', lead && lead !== which ? 'text-zinc-300' : 'text-zinc-50')} title={t.name}>{t.name}</div>
        {!!byPlayer.size && (
          <ul className="flex max-w-full flex-col gap-0.5 text-xs text-zinc-400">
            {[...byPlayer.values()].map(list => (
              <li key={list[0].kind + list[0].player} className="flex min-w-0 items-center justify-center gap-1.5">
                {list[0].kind === 'red' ? <Card red /> : <FootballIcon size={11} />}
                <span className="truncate">{shortName(list[0].player || '¿?')}{list.map(goalNote).find(Boolean) ?? ''} <span className="tnum text-zinc-500">{list.map(e => e.minute).join(', ')}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-800 px-4 py-2.5 sm:px-5">
        <span className="text-[13px] font-semibold text-zinc-100">{m.leagueName}</span>
        {m.stage && <span className="text-xs text-zinc-500">{m.stage}</span>}
        {where && <span className="ml-auto min-w-0 truncate text-xs text-zinc-500" title={where}>{where}</span>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3 py-6 sm:gap-8 sm:px-8">
        {side(m.home, 'home')}
        <div className="flex flex-col items-center gap-2 pt-3">
          {st === 'pre' || m.off
            ? <span className="text-3xl font-semibold leading-none tnum text-zinc-100 sm:text-4xl">{m.off ? '–' : esTime(m.date)}</span>
            : (
              <div className="flex items-center gap-2 text-4xl font-semibold leading-none tracking-tight tnum sm:gap-3 sm:text-6xl">
                <span className={lead === 'away' ? 'text-zinc-400' : 'text-zinc-50'}>{hs}</span>
                <span className="text-2xl font-light text-zinc-600 sm:text-4xl">-</span>
                <span className={lead === 'home' ? 'text-zinc-400' : 'text-zinc-50'}>{as}</span>
              </div>
            )}
          {st === 'live'
            ? <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-300 tnum"><LiveDot />{m.status}</span>
            : st === 'post'
              ? <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">{m.off ? m.status : 'Final'}</span>
              : <span className="text-xs text-zinc-400 first-letter:uppercase">{new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
          {st !== 'pre' && !m.off && pastHalf && <span className="text-[11px] text-zinc-500 tnum">Descanso {half[0]}-{half[1]}</span>}
        </div>
        {side(m.away, 'away')}
      </div>
      {children}
    </div>
  );
}

// Tarjeta amarilla o roja
const Card = ({ red }: { red?: boolean }) => <span aria-hidden className={cn('inline-block h-3 w-2 shrink-0 rounded-[2px]', red ? 'bg-rose-500' : 'bg-yellow-400')} />;

const EVENT_TEXT: Record<FootballEvent['kind'], string> = {
  goal: 'Gol', penalty: 'Gol de penalti', owngoal: 'Gol en propia puerta', missed: 'Penalti fallado', yellow: 'Amarilla', red: 'Roja', sub: 'Cambio'
};

// ---------- resumen ----------
// Goles, tarjetas y cambios en orden, con el minuto en un eje central: los del local a la izquierda y los del visitante a
// la derecha. Los goles destacan con el marcador de ese momento; los cambios son una línea fina (entra / sale).
// Separadores en el descanso, al final del tiempo reglamentario si hay prórroga y al final
const PHASE_END: Record<number, string> = { 1: 'Descanso', 2: 'Final del tiempo reglamentario', 3: 'Final de la prórroga' };

function Timeline({ d }: { d: FootballDetail }) {
  const [only, setOnly] = useState(false);
  const { match: m, timeline } = d;
  if (!timeline.length) return <Empty>{m.state === 'pre' ? 'El partido aún no ha empezado.' : 'Todavía no hay goles, tarjetas ni cambios.'}</Empty>;
  const st = stateOf(m);
  const { after, phases } = scoreLine(m, timeline);
  const rows: ReactNode[] = [];

  const divider = (key: string, label: string, score: [number, number]) => (
    <div key={key} className="flex items-center gap-3 px-4 py-2">
      <span className="h-px flex-1 bg-zinc-800" />
      <span className="relative z-10 bg-surface px-2 text-xs font-medium text-zinc-400">{label} <span className="ml-1 font-semibold text-zinc-200 tnum">{score[0]}-{score[1]}</span></span>
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );

  const cell = (e: FootballEvent, right: boolean) => {
    const goal = isGoal(e);
    const box = cn('flex min-w-0 items-start gap-2', right ? '' : 'flex-row-reverse text-right');
    if (e.kind === 'sub') {
      return (
        <div className={cn('flex min-w-0 flex-col gap-0.5 text-[13px]', right ? 'items-start' : 'items-end text-right')} title="Cambio">
          <span className={cn('flex min-w-0 max-w-full items-center gap-1.5 text-zinc-200', !right && 'flex-row-reverse')}><ArrowUp size={12} className="shrink-0 text-emerald-400" /><span className="truncate">{e.player}</span></span>
          {e.other && <span className={cn('flex min-w-0 max-w-full items-center gap-1.5 text-xs text-zinc-500', !right && 'flex-row-reverse')}><ArrowDown size={12} className="shrink-0 text-zinc-500" /><span className="truncate">{e.other}</span></span>}
        </div>
      );
    }
    return (
      <div className={box} title={EVENT_TEXT[e.kind]}>
        <span className="mt-0.5 shrink-0">
          {e.kind === 'yellow' || e.kind === 'red' ? <Card red={e.kind === 'red'} />
            : <span className={e.kind === 'missed' ? 'text-zinc-500' : 'text-zinc-100'}><FootballIcon size={14} /></span>}
        </span>
        <div className="min-w-0">
          <div className={cn('flex min-w-0 items-center gap-2', !right && 'flex-row-reverse')}>
            <span className={cn('truncate', goal ? 'text-sm font-semibold text-zinc-50' : 'text-[13px] text-zinc-200')} title={e.player}>
              {e.player ? <><span className="sm:hidden">{shortName(e.player)}</span><span className="hidden sm:inline">{e.player}</span></> : EVENT_TEXT[e.kind]}{goalNote(e)}
            </span>
          </div>
          {(e.kind === 'missed' || (goal && e.other)) && <div className="truncate text-xs text-zinc-500">{e.kind === 'missed' ? 'Penalti fallado' : `Asistencia de ${e.other}`}</div>}
        </div>
      </div>
    );
  };

  let score: [number, number] = [0, 0];
  timeline.forEach((e, i) => {
    if (after[i]) score = after[i]!;
    const show = !only || e.kind !== 'sub';
    if (show) {
      const goal = isGoal(e);
      const home = e.team === m.home.id;
      rows.push(
        <div key={i} className={cn('grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-center gap-2 px-3 sm:px-4', goal ? 'bg-zinc-900 py-2.5' : 'py-1.5')}>
          {home ? cell(e, false) : <span />}
          {goal && after[i]
            ? (
              <span className="relative z-10 mx-auto flex flex-col items-center gap-0.5 rounded-md bg-zinc-900 px-1 tnum">
                <span className="text-[11px] font-medium text-zinc-400">{e.minute}</span>
                <span className="rounded bg-zinc-700 px-1.5 text-xs font-semibold text-zinc-50">{after[i]![0]}-{after[i]![1]}</span>
              </span>
            )
            : <span className="relative z-10 mx-auto rounded-md bg-surface px-1.5 text-center text-xs font-medium text-zinc-400 tnum">{e.minute}</span>}
          {!home ? cell(e, true) : <span />}
        </div>
      );
    }
    // Separador al cambiar de parte (o al final, si ya acabó)
    const next = phases[i + 1];
    const ends = next != null ? next > phases[i] : st === 'post' || (phases[i] === 1 && /descanso/i.test(m.status));
    if (ends && (next != null || phases[i] < 3 || st === 'post')) {
      const label = next == null && st === 'post' ? 'Final' : PHASE_END[phases[i]] ?? 'Final';
      rows.push(divider(`d${i}`, label, score));
    }
  });

  return (
    <Panel title={
      <span className="flex items-center justify-between gap-2">
        Resumen
        <span className={segWrap}>
          <button onClick={() => setOnly(false)} className={seg(!only)}>Todo</button>
          <button onClick={() => setOnly(true)} className={seg(only)}>Goles y tarjetas</button>
        </span>
      </span>
    }>
      <div className="relative py-1">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800" />
        {rows}
      </div>
    </Panel>
  );
}

// Estadísticas del partido, una barra por dato hacia quien va por delante
const STATS: { key: string; label: string; fmt?: (v: number) => string; better?: 'low'; spread: number }[] = [
  { key: 'possessionPct', label: 'Posesión', fmt: v => `${Math.round(v)} %`, spread: 30 },
  { key: 'totalShots', label: 'Tiros', spread: 10 },
  { key: 'shotsOnTarget', label: 'Tiros a puerta', spread: 5 },
  { key: 'wonCorners', label: 'Córners', spread: 6 },
  { key: 'saves', label: 'Paradas', spread: 4 },
  { key: 'totalPasses', label: 'Pases', spread: 250 },
  { key: 'passPct', label: 'Acierto en el pase', fmt: v => `${Math.round(v * 100)} %`, spread: 0.15 },
  { key: 'totalCrosses', label: 'Centros', spread: 10 },
  { key: 'offsides', label: 'Fueras de juego', better: 'low', spread: 4 },
  { key: 'foulsCommitted', label: 'Faltas', better: 'low', spread: 8 },
  { key: 'yellowCards', label: 'Amarillas', better: 'low', spread: 3 },
  { key: 'redCards', label: 'Rojas', better: 'low', spread: 1 },
  { key: 'interceptions', label: 'Intercepciones', spread: 8 },
  { key: 'totalTackles', label: 'Entradas', spread: 10 }
];

function Stats({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const a = d.stats[m.home.id], b = d.stats[m.away.id];
  if (!a || !b || !Object.keys(a).length) return <Empty>{m.state === 'pre' ? 'Las estadísticas salen cuando empieza el partido.' : 'ESPN no tiene estadísticas de este partido.'}</Empty>;
  const marks = { aMark: themeOf(m.home)?.mark, bMark: themeOf(m.away)?.mark };
  return (
    <Panel title={<span className="flex items-center justify-between gap-3"><span className="truncate">{m.home.name}</span><span className="truncate text-right">{m.away.name}</span></span>}>
      <div className="pb-1.5">
        {STATS.filter(s => a[s.key] != null && b[s.key] != null).map(s => (
          <TvRow key={s.key} label={s.label} a={a[s.key]!} b={b[s.key]!} aText={s.fmt ? s.fmt(a[s.key]!) : String(a[s.key])} bText={s.fmt ? s.fmt(b[s.key]!) : String(b[s.key])}
            better={s.better} spread={s.spread} {...marks} />
        ))}
      </div>
    </Panel>
  );
}

// Posiciones de ESPN (en inglés, con el lado detrás: "CD-R") a las abreviaturas de aquí; el banquillo no lleva
const POS: Record<string, string> = {
  G: 'POR', GK: 'POR', RB: 'LD', LB: 'LI', CB: 'DFC', CD: 'DFC', RWB: 'CAD', LWB: 'CAI', DM: 'MCD', CDM: 'MCD', CM: 'MC', AM: 'MCO', CAM: 'MCO',
  RM: 'MD', LM: 'MI', RW: 'ED', LW: 'EI', F: 'DC', CF: 'DC', ST: 'DC', RCF: 'DC', LCF: 'DC', SS: 'SD'
};
const posEs = (p: string) => (p === 'SUB' ? '' : POS[p.split('-')[0]] ?? p);

// ---------- alineaciones ----------
// El campo entero con los dos onces: en horizontal desde lg (local a la izquierda) y en vertical por debajo (local abajo).
// Cada jugador es un círculo del color de su equipo con el dorsal y el apellido debajo: ESPN casi no tiene fotos de
// futbolistas (la mayoría dan 404), y un campo medio con fotos y medio con huecos se ve peor. Encima, lo que hizo en el
// partido (goles, tarjetas y el minuto en que lo cambiaron), sacado del resumen.
type LineupPlayer = FootballDetail['lineups'][number]['players'][number];

// Profundidad de cada posición de ESPN (0 portero, 5 delantero) para repartir el once en las líneas de la formación
const DEPTH: Record<string, number> = {
  G: 0, GK: 0, SW: 1, CB: 1, CD: 1, RB: 1, LB: 1, D: 1, RWB: 1.5, LWB: 1.5, WB: 1.5, DM: 2, CDM: 2,
  CM: 3, M: 3, LM: 3, RM: 3, AM: 4, CAM: 4, RW: 4.5, LW: 4.5, W: 4.5, SS: 4.6, F: 5, CF: 5, ST: 5, S: 5, FW: 5
};
const baseOf = (pos: string) => pos.toUpperCase().split('-')[0];
const depthOf = (p: LineupPlayer) => DEPTH[baseOf(p.pos)] ?? 3;
// Lado, mirando hacia la portería rival: los de banda ("LB", "RM", "LW") ±2, por fuera de los de "-L"/"-R" ("CD-L",
// "AM-R") ±1, y el centro 0. Así el lateral derecho queda por fuera del central derecho
const sideOf = (p: LineupPlayer) => {
  const pos = p.pos.toUpperCase(), base = baseOf(pos);
  const wing = base.length > 1 && base in DEPTH ? (base[0] === 'L' ? -2 : base[0] === 'R' ? 2 : 0) : 0;
  return wing || (/-L$/.test(pos) ? -1 : /-R$/.test(pos) ? 1 : 0);
};

// Las líneas del once, de atrás adelante y cada una de izquierda a derecha: el portero y luego tantos como diga la
// formación ("4-2-3-1"), por orden de profundidad; si la formación no cuadra, una línea por cada profundidad
function linesOf(players: LineupPlayer[], formation: string): LineupPlayer[][] {
  const xi = players.filter(p => p.starter);
  const keeper = xi.find(p => depthOf(p) === 0) ?? [...xi].sort((x, y) => (x.place ?? 99) - (y.place ?? 99))[0];
  if (!keeper) return [];
  const rest = xi.filter(p => p !== keeper).sort((x, y) => depthOf(x) - depthOf(y) || (x.place ?? 99) - (y.place ?? 99));
  const counts = formation.split('-').map(Number).filter(n => n > 0);
  let lines: LineupPlayer[][] = [];
  if (counts.length && counts.reduce((s, n) => s + n, 0) === rest.length) {
    let i = 0;
    for (const n of counts) { lines.push(rest.slice(i, i + n)); i += n; }
  } else {
    const byDepth = new Map<number, LineupPlayer[]>();
    for (const p of rest) byDepth.set(depthOf(p), [...(byDepth.get(depthOf(p)) ?? []), p]);
    lines = [...byDepth.values()];
  }
  return [[keeper], ...lines.map(l => [...l].sort((x, y) => sideOf(x) - sideOf(y) || (x.place ?? 99) - (y.place ?? 99)))];
}

// Sitio de cada jugador en su mitad: depth de 0 (su portería) a 0.5 (el medio campo) y x de 0 (su izquierda) a 1
function spotsOf(lines: LineupPlayer[][]) {
  const out: { p: LineupPlayer; depth: number; x: number }[] = [];
  const outfield = lines.length - 1;
  lines.forEach((line, k) => {
    const depth = k === 0 ? 0.05 : outfield === 1 ? 0.3 : 0.17 + ((k - 1) * (0.44 - 0.17)) / (outfield - 1);
    const gap = line.length > 1 ? Math.min(0.24, 0.8 / line.length) : 0;
    line.forEach((p, j) => out.push({ p, depth, x: 0.5 + (j - (line.length - 1) / 2) * gap }));
  });
  return out;
}

// "Randal Kolo Muani" → "Kolo Muani"; "Bremer" se queda igual
const surname = (name: string) => name.trim().split(/\s+/).slice(1).join(' ') || name;

// Lo que hizo cada jugador, por su nombre en el resumen: goles (sin los de en propia), tarjeta más grave y minutos del cambio
function deedsOf(timeline: FootballEvent[]) {
  const out = new Map<string, { goals: number; card: 'yellow' | 'red' | null; off: string | null; on: string | null }>();
  const get = (name: string) => { if (!out.has(name)) out.set(name, { goals: 0, card: null, off: null, on: null }); return out.get(name)!; };
  for (const e of timeline) {
    if (!e.player) continue;
    if (e.kind === 'goal' || e.kind === 'penalty') get(e.player).goals++;
    if (e.kind === 'yellow' && !get(e.player).card) get(e.player).card = 'yellow';
    if (e.kind === 'red') get(e.player).card = 'red';
    if (e.kind === 'sub') { get(e.player).on = e.minute; if (e.other) get(e.other).off = e.minute; }
  }
  return out;
}

// Líneas del campo (medidas reales, 68 x 105 m) en vertical; en horizontal se gira el mismo dibujo. Con las franjas del
// corte del césped (bandas planas, una sí y otra no un poco más claras, sin degradados). bright: franjas y líneas más
// marcadas, para el campo de las alineaciones
function PitchLines({ horizontal, bright }: { horizontal?: boolean; bright?: boolean }) {
  return (
    <svg viewBox={horizontal ? '0 0 105 68' : '0 0 68 105'} className="absolute inset-0 h-full w-full" aria-hidden>
      <g transform={horizontal ? 'matrix(0 1 -1 0 105 0)' : undefined} fill={bright ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.028)'} stroke="none">
        {Array.from({ length: 7 }, (_, k) => <rect key={k} x="0" y={(k * 2 + 1) * 7} width="68" height="7" />)}
      </g>
      <g transform={horizontal ? 'matrix(0 1 -1 0 105 0)' : undefined} fill="none" stroke={bright ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)'} strokeWidth={bright ? 0.3 : 0.35}>
        <rect x="1" y="1" width="66" height="103" />
        <line x1="1" y1="52.5" x2="67" y2="52.5" />
        <circle cx="34" cy="52.5" r="9.15" />
        <rect x="13.84" y="1" width="40.32" height="16.5" />
        <rect x="13.84" y="87.5" width="40.32" height="16.5" />
        <rect x="24.84" y="1" width="18.32" height="5.5" />
        <rect x="24.84" y="98.5" width="18.32" height="5.5" />
        <path d="M26.69 17.5 A9.15 9.15 0 0 0 41.31 17.5" />
        <path d="M26.69 87.5 A9.15 9.15 0 0 1 41.31 87.5" />
        <g fill="rgba(255,255,255,0.16)" stroke="none">
          <circle cx="34" cy="52.5" r="0.6" /><circle cx="34" cy="12" r="0.5" /><circle cx="34" cy="93" r="0.5" />
        </g>
      </g>
    </svg>
  );
}

const PITCH = '#16281e'; // verde muy apagado, plano: que el campo se reconozca sin chillar sobre el fondo oscuro
const PITCH_LINEUP = '#1b3a27'; // alineaciones: un verde que se vea como campo, con sus franjas

// ---------- estadísticas de un jugador en el partido ----------
// Las da la API core de ESPN con sus nombres en inglés. Cada fila es un dato, o "acertados de intentados" con su porcentaje
type StatRow = { label: string; key: string; of?: string; dec?: number; signed?: boolean; plus?: string };
const STAT_GROUPS: { title: string; keeper?: boolean; rows: StatRow[] }[] = [
  {
    title: 'Ataque', rows: [
      { label: 'Goles', key: 'totalGoals' }, { label: 'Asistencias', key: 'goalAssists' },
      { label: 'Goles esperados (xG)', key: 'expectedGoals', dec: 2 }, { label: 'Tiros', key: 'totalShots' },
      { label: 'Tiros a puerta', key: 'shotsOnTarget' }, { label: 'Tiros fuera', key: 'shotsOffTarget' }, { label: 'Tiros al palo', key: 'shotsOnPost' },
      { label: 'Ocasiones claras falladas', key: 'bigChanceMissed' }, { label: 'Toques en el área rival', key: 'touchesInOppBox' },
      { label: 'Fueras de juego', key: 'offsides' }
    ]
  },
  {
    title: 'Regate y duelos', rows: [
      { label: 'Regates completados', key: 'wonContest', of: 'totalContest' }, { label: 'Conducciones progresivas', key: 'progressiveCarries' },
      { label: 'Duelos ganados', key: 'duelsWon', of: 'duels' }, { label: 'Duelos en el suelo ganados', key: 'groundDuelsWon', of: 'groundDuels' },
      { label: 'Duelos aéreos ganados', key: 'aerialsWon', of: 'aerialsWon', plus: 'aerialsLost' }, { label: 'Toques', key: 'touches' },
      { label: 'Pérdidas', key: 'turnover' }, { label: 'Faltas recibidas', key: 'foulsSuffered' }
    ]
  },
  {
    title: 'Defensa', rows: [
      { label: 'Entradas ganadas', key: 'effectiveTackles', of: 'totalTackles' }, { label: 'Intercepciones', key: 'interceptions' },
      { label: 'Tiros bloqueados', key: 'blockedShots' }, { label: 'Despejes', key: 'totalClearance' }, { label: 'Recuperaciones', key: 'ballRecovery' },
      { label: 'Balones ganados en campo rival', key: 'possWonAtt3rd' }, { label: 'Faltas cometidas', key: 'foulsCommitted' },
      { label: 'Amarillas', key: 'yellowCards' }, { label: 'Rojas', key: 'redCards' }, { label: 'Goles en propia puerta', key: 'ownGoals' }
    ]
  },
  {
    title: 'Pase', rows: [
      { label: 'Pases completados', key: 'accuratePasses', of: 'totalPasses' },
      { label: 'Pases en el último tercio', key: 'successfulFinalThirdPasses', of: 'totalFinalThirdPasses' },
      { label: 'Pases de tiro', key: 'shotAssists' }, { label: 'Ocasiones claras creadas', key: 'bigChanceCreated' },
      { label: 'Asistencias esperadas (xA)', key: 'expectedAssists', dec: 2 }, { label: 'Centros', key: 'accurateCrosses', of: 'totalCrosses' },
      { label: 'Balones largos', key: 'accurateLongBalls', of: 'totalLongBalls' }
    ]
  },
  {
    title: 'Portería', keeper: true, rows: [
      { label: 'Paradas', key: 'saves' }, { label: 'Tiros a puerta recibidos', key: 'shotsOnGoalAgainst' }, { label: 'Goles encajados', key: 'goalsConceded' },
      { label: 'Goles evitados', key: 'goalsPrevented', dec: 2, signed: true }, { label: 'Salidas fuera del área', key: 'accurateKeeperSweeper', of: 'totalKeeperSweeper' },
      { label: 'Centros atrapados', key: 'crossesCaught' }, { label: 'Despejes de puños', key: 'punches' },
      { label: 'Penaltis parados', key: 'penaltyKicksSaved', of: 'penaltyKicksFaced' }
    ]
  }
];
const fmtStat = (v: number, dec = 0, signed = false) => `${signed && v > 0 ? '+' : ''}${v.toFixed(dec).replace('.', ',')}`;

// Una fila de estadística. En las de "acertados de intentados", una barra con el porcentaje en el color del equipo
function StatLine({ row, s, color }: { row: StatRow; s: Record<string, number>; color: string }) {
  const v = s[row.key] ?? 0;
  const total = row.of ? (s[row.of] ?? 0) + (row.plus ? s[row.plus] ?? 0 : 0) : null;
  const zero = total != null ? total === 0 : v === 0;
  const share = total ? v / total : 0;
  return (
    <div className="flex h-8 items-center gap-3 px-4 text-[13px]">
      <span className={cn('min-w-0 flex-1 truncate', zero ? 'text-zinc-500' : 'text-zinc-300')}>{row.label}</span>
      {total != null && total > 0 && (
        <span className="flex items-center gap-2">
          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800 sm:block"><span className="bar-grow block h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} /></span>
          <span className="w-9 text-right text-xs text-zinc-400 tnum">{Math.round(share * 100)} %</span>
        </span>
      )}
      <span className={cn('min-w-10 text-right font-semibold tnum', zero ? 'text-zinc-600' : 'text-zinc-50')}>
        {total != null ? `${fmtStat(v)}/${fmtStat(total)}` : fmtStat(v, row.dec, row.signed)}
      </span>
    </div>
  );
}

// ---------- mapas de tiros ----------
const SHOT_ES: Record<FootballShot['kind'], string> = { goal: 'Gol', saved: 'Parado', off: 'Fuera', blocked: 'Bloqueado' };
// Metros hasta el centro de la portería (el campo, 105 x 68)
const shotDist = (s: FootballShot) => Math.round(Math.hypot((100 - s.x) * 1.05, (s.y - 50) * 0.68));
const shotText = (s: FootballShot, who?: boolean) =>
  `${s.minute} · ${SHOT_ES[s.kind]}${s.penalty ? ' (penalti)' : s.header ? ', de cabeza' : ''} · a ${shotDist(s)} m${who ? ` · ${s.player}` : ''}`;
const shotTally = (list: FootballShot[]) => {
  const goals = list.filter(s => s.kind === 'goal').length, on = list.filter(s => s.kind === 'goal' || s.kind === 'saved').length;
  return `${list.length} tiro${list.length === 1 ? '' : 's'} · ${on} a puerta · ${goals} gol${goals === 1 ? '' : 'es'}`;
};

// La marca de un tiro: círculo con el pie, cuadrado de cabeza. Gol, relleno del color del equipo; parado, blanco; fuera, sólo el
// borde; bloqueado, gris y pequeño. La línea va hasta donde llegó
function ShotMark({ s, from, to, color, r, delay, on, onHover }: {
  s: FootballShot; from: [number, number]; to: [number, number] | null; color: string; r: number; delay: number; on: boolean; onHover: (v: boolean) => void;
}) {
  const [cx, cy] = from;
  const R = s.kind === 'blocked' ? r * 0.7 : s.kind === 'goal' ? r * 1.25 : r;
  const fill = s.kind === 'goal' ? color : s.kind === 'saved' ? '#fafafa' : s.kind === 'blocked' ? '#71717a' : 'rgba(0,0,0,0.25)';
  const stroke = s.kind === 'goal' ? '#fafafa' : s.kind === 'saved' ? color : s.kind === 'blocked' ? 'none' : '#e4e4e7';
  const sw = r * 0.28;
  const lineColor = s.kind === 'goal' ? color : s.kind === 'blocked' ? '#71717a' : '#e4e4e7';
  return (
    <g onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className="cursor-pointer" opacity={on ? 1 : 0.9}>
      <title>{shotText(s, true)}</title>
      {to && (
        <line x1={cx} y1={cy} x2={to[0]} y2={to[1]} pathLength={1} className="shot-line" style={{ animationDelay: `${delay}s`, stroke: lineColor }}
          strokeWidth={on ? r * 0.32 : r * 0.18} strokeOpacity={on ? 0.95 : s.kind === 'goal' ? 0.7 : 0.35} strokeLinecap="round" />
      )}
      <g className="shot-mark" style={{ animationDelay: `${delay + 0.25}s` }}>
        {on && <circle cx={cx} cy={cy} r={R * 2} fill="none" stroke="#fafafa" strokeOpacity={0.5} strokeWidth={sw * 0.7} />}
        {s.header
          ? <rect x={cx - R} y={cy - R} width={R * 2} height={R * 2} rx={R * 0.3} style={{ fill, stroke }} strokeWidth={sw} />
          : <circle cx={cx} cy={cy} r={R} style={{ fill, stroke }} strokeWidth={sw} />}
        <circle cx={cx} cy={cy} r={R * 2.2} fill="transparent" />
      </g>
    </g>
  );
}

function ShotLegend({ color }: { color: string }) {
  const item = (svg: ReactNode, label: string) => <span className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>{svg}</svg>{label}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
      {item(<circle cx="6" cy="6" r="4.5" style={{ fill: color }} stroke="#fafafa" strokeWidth="1.2" />, 'Gol')}
      {item(<circle cx="6" cy="6" r="4" fill="#fafafa" style={{ stroke: color }} strokeWidth="1.2" />, 'Parado')}
      {item(<circle cx="6" cy="6" r="4" fill="none" stroke="#e4e4e7" strokeWidth="1.2" />, 'Fuera')}
      {item(<circle cx="6" cy="6" r="3" fill="#71717a" />, 'Bloqueado')}
      {item(<rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="#e4e4e7" strokeWidth="1.2" />, 'De cabeza')}
    </div>
  );
}

// Los goles en el acento de la app (el mismo para los dos equipos: en el mapa del partido ya los separa el lado del campo,
// y con el color de la camiseta un gol blanco se confundía con un tiro parado)
const GOAL_COLOR = 'var(--color-amber-400)';
const DEEP = 42; // metros desde la portería que enseña el mapa de un jugador: casi todos los tiros salen de ahí

// Los últimos 42 metros en vertical, con la portería arriba: los tiros de un jugador. La derecha del que tira es la derecha de la pantalla
function HalfPitchShots({ shots }: { shots: FootballShot[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const at = (x: number, y: number): [number, number] => [(100 - y) * 0.68, Math.min(DEEP - 1, (100 - x) * 1.05)];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative overflow-hidden rounded-xl" style={{ background: PITCH }}>
        <svg viewBox={`-3 -5 74 ${DEEP + 6}`} className="block w-full">
          <g fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.35">
            <path d={`M0 ${DEEP + 1} V0 H68 V${DEEP + 1}`} />
            <rect x="13.84" y="0" width="40.32" height="16.5" /><rect x="24.84" y="0" width="18.32" height="5.5" />
            <path d="M26.69 16.5 A9.15 9.15 0 0 0 41.31 16.5" />
            <rect x="30.34" y="-2.4" width="7.32" height="2.4" stroke="rgba(255,255,255,0.45)" />
          </g>
          <circle cx="34" cy="11" r="0.45" fill="rgba(255,255,255,0.25)" />
          {shots.map((s, i) => (
            <ShotMark key={i} s={s} from={at(s.x, s.y)} to={s.x2 != null && s.y2 != null ? at(s.x2, s.y2) : null} color={GOAL_COLOR} r={1.45}
              delay={0.15 + i * 0.15} on={hover === i} onHover={v => setHover(v ? i : null)} />
          ))}
        </svg>
      </div>
      <div className="min-h-5 text-[13px] text-zinc-300 tnum">{hover != null ? shotText(shots[hover]) : <span className="text-zinc-500">{shotTally(shots)}. Pasa por encima de un tiro para verlo.</span>}</div>
      <ShotLegend color={GOAL_COLOR} />
    </div>
  );
}

// El campo entero con los tiros de los dos, cada uno en el lado de su nombre: el local ataca hacia la izquierda y el
// visitante hacia la derecha
function MatchShotMap({ m, shots }: { m: FootballMatch; shots: FootballShot[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [only, setOnly] = useState<'all' | 'home' | 'away'>('all');
  const isHome = (s: FootballShot) => s.team === m.home.id;
  // Mirando a la izquierda, su derecha queda arriba; mirando a la derecha, abajo
  const at = (s: FootballShot, x: number, y: number): [number, number] => (isHome(s) ? [(100 - x) * 1.05, y * 0.68] : [x * 1.05, (100 - y) * 0.68]);
  const list = shots.map((s, i) => ({ s, i })).filter(({ s }) => only === 'all' || (only === 'home') === isHome(s));
  const side = (t: FootballTeam, mine: FootballShot[], right?: boolean) => (
    <div className={cn('flex min-w-0 items-center gap-2', right && 'flex-row-reverse text-right')}>
      <TeamLogo src={t.logo} name={t.abbr} size={20} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-zinc-50">{t.name}</div>
        <div className="truncate text-xs text-zinc-400 tnum">{shotTally(mine)}</div>
      </div>
    </div>
  );
  return (
    <Panel title={
      <span className="flex items-center justify-between gap-2">
        Mapa de tiros
        <span className={segWrap}>
          {([['all', 'Todos'], ['home', m.home.abbr || m.home.name], ['away', m.away.abbr || m.away.name]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setOnly(v)} className={seg(only === v)}>{label}</button>
          ))}
        </span>
      </span>
    }>
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-4">{side(m.home, shots.filter(isHome))}{side(m.away, shots.filter(s => !isHome(s)), true)}</div>
        <div className="relative aspect-[105/68] w-full overflow-hidden rounded-xl" style={{ background: PITCH }}>
          <PitchLines horizontal />
          <svg viewBox="0 0 105 68" className="absolute inset-0 h-full w-full">
            {list.map(({ s, i }, k) => (
              <ShotMark key={`${only}-${i}`} s={s} from={at(s, s.x, s.y)} to={s.x2 != null && s.y2 != null ? at(s, s.x2, s.y2) : null}
                color={GOAL_COLOR} r={1.05} delay={k * 0.05} on={hover === i} onHover={v => setHover(v ? i : null)} />
            ))}
          </svg>
        </div>
        <div className="min-h-5 text-[13px] text-zinc-300 tnum">{hover != null ? shotText(shots[hover], true) : <span className="text-zinc-500">Pasa por encima de un tiro para ver quién lo hizo, cuándo y desde dónde.</span>}</div>
        <ShotLegend color={GOAL_COLOR} />
      </div>
    </Panel>
  );
}

// ---------- ficha del jugador en el partido ----------
// Cabecera teñida (plana) del color del equipo, con la foto y el dorsal grande de fondo; debajo, las cifras principales,
// su mapa de tiros y las estadísticas por grupos
type Selected = { p: LineupPlayer; t: FootballTeam; fill: string; ink: string };

// live: el partido está en juego; entonces sus cifras se vuelven a pedir cada 30 s con la ficha abierta (los tiros ya llegan
// con la ficha del partido, que se refresca cada 20 s)
function PlayerStatsDialog({ sel, matchId, shots, live, onClose }: { sel: Selected | null; matchId: string; shots: FootballShot[]; live: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['football', 'playerStats', matchId, sel?.t.id, sel?.p.id], enabled: !!sel?.p.id,
    queryFn: () => window.api.football.playerStats(matchId, sel!.t.id, sel!.p.id), staleTime: live ? 20e3 : 60e3, retry: false,
    refetchInterval: live ? 30_000 : false
  });
  const photo = useQuery({
    queryKey: ['football', 'photo', sel?.p.id || sel?.p.name], enabled: !!sel,
    queryFn: () => window.api.football.photo(sel!.p.id, sel!.p.name, sel!.t.name), staleTime: Infinity, retry: false
  });
  const [broken, setBroken] = useState(false);
  if (!sel) return null;
  const { p, t } = sel;
  const s = q.data ?? {};
  const keeper = baseOf(p.pos) === 'G' || baseOf(p.pos) === 'GK';
  const color = themeOf(t)?.mark ?? '#e4e4e7';
  const mine = shots.filter(x => x.player === p.name && x.team === t.id);
  const pic = !broken && photo.data?.url ? photo.data.url : null;
  // Lo principal arriba: para el portero, sus paradas; para el resto, goles, tiros y xG
  const kpis: [string, string, string?][] = [
    ['Minutos', s.minutes != null ? `${Math.round(s.minutes)}'` : '–'],
    ...(keeper
      ? [['Paradas', fmtStat(s.saves ?? 0)], ['Encajados', fmtStat(s.goalsConceded ?? 0)], ['Goles evitados', fmtStat(s.goalsPrevented ?? 0, 2, true)]] as [string, string][]
      : [['Goles', fmtStat(s.totalGoals ?? 0), (s.goalAssists ?? 0) ? `y ${fmtStat(s.goalAssists ?? 0)} asist.` : undefined],
        ['Tiros', fmtStat(s.totalShots ?? 0), `${fmtStat(s.shotsOnTarget ?? 0)} a puerta`], ['xG', fmtStat(s.expectedGoals ?? 0, 2), 'goles esperados']] as [string, string, string?][])
  ];
  const groups = STAT_GROUPS.filter(g => !g.keeper || keeper).sort((x, y) => Number(!!y.keeper) - Number(!!x.keeper));
  return (
    <Dialog open onClose={onClose} wide title={<span className="text-sm font-medium text-zinc-400">Su partido</span>}>
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center gap-4 overflow-hidden rounded-xl p-4 sm:gap-5 sm:p-5" style={{ background: `color-mix(in oklab, ${sel.fill} 38%, #18181b)` }}>
          <span aria-hidden className="pointer-events-none absolute -right-2 -top-6 hidden select-none text-[150px] font-black leading-none text-white/[0.07] tnum sm:block">{p.number}</span>
          {pic ? (
            <span className="relative shrink-0">
              <img src={pic} alt={p.name} onError={() => setBroken(true)} className="h-20 w-20 rounded-xl bg-zinc-900 object-cover object-top ring-1 ring-white/15 sm:h-24 sm:w-24" />
              {photo.data?.from === 'Wikipedia' && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] text-zinc-300">Wikipedia</span>}
            </span>
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl text-3xl font-bold ring-1 ring-white/15 tnum sm:h-24 sm:w-24" style={{ background: sel.fill, color: sel.ink }}>{p.number}</span>
          )}
          <div className="relative min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-zinc-300">
              <span className="grid shrink-0 place-items-center rounded bg-white/90 p-px"><TeamLogo src={t.logo} name={t.abbr} size={16} /></span>
              <span className="truncate">{t.name}</span>
            </div>
            <div className="truncate text-xl font-semibold text-zinc-50 sm:text-2xl">{p.name}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {posEs(p.pos) && <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">{posEs(p.pos)}</span>}
              <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">Dorsal {p.number}</span>
              <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">{p.starter ? 'Titular' : 'Suplente'}</span>
            </div>
          </div>
        </div>

        {q.isLoading ? <Loading label="Cargando sus estadísticas…" /> : q.error ? <Empty>{(q.error as Error).message}</Empty> : <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {kpis.map(([label, v, sub]) => (
              <div key={label} className="rounded-lg bg-zinc-900 px-3 py-2.5">
                <div className="text-xs text-zinc-400">{label}</div>
                <div className="text-2xl font-semibold text-zinc-50 tnum">{v}</div>
                {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {!!mine.length && (
              <Panel title="Sus tiros">
                <div className="p-3 sm:p-4"><HalfPitchShots shots={mine} /></div>
              </Panel>
            )}
            {groups.map(g => (
              <Panel key={g.title} title={g.title}>
                <div className="divide-y divide-zinc-800/60">{g.rows.map(r => <StatLine key={r.key + r.label} row={r} s={s} color={color} />)}</div>
              </Panel>
            ))}
          </div>
          <p className="text-xs text-zinc-500">Datos de ESPN. Los goles esperados (xG) miden la calidad de sus tiros: cuántos goles marcaría de media un jugador cualquiera con esas ocasiones.</p>
        </>}
      </div>
    </Dialog>
  );
}

function Lineups({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  // Jugador pulsado: se abren sus estadísticas del partido
  const [sel, setSel] = useState<Selected | null>(null);
  if (!d.lineups.length) return <Empty>{m.state === 'pre' ? 'Las alineaciones salen una hora antes del partido, más o menos.' : 'ESPN no tiene las alineaciones de este partido.'}</Empty>;
  const deeds = deedsOf(d.timeline);
  const teams = ([['home', m.home], ['away', m.away]] as const).map(([which, t]) => {
    const l = d.lineups.find(x => x.team === t.id);
    const theme = themeOf(t);
    return {
      which, t, l, spots: l ? spotsOf(linesOf(l.players, l.formation)) : [],
      // Dorsal en blanco sobre el color del equipo (la banda ya está oscurecida para que se lean letras blancas)
      fill: theme?.band ?? (which === 'home' ? '#d4d4d8' : '#3f3f46'), ink: theme ? '#fff' : which === 'home' ? '#18181b' : '#fafafa'
    };
  });

  // Círculo relleno del color del equipo con el dorsal en blanco (la banda ya está oscurecida para que se lea) y borde
  // blanco, que lo despega del césped aunque el equipo sea verde o negro
  const avatar = (team: typeof teams[number], p: LineupPlayer, size: string) => (
    <span className={cn('grid place-items-center rounded-full border-2 border-white font-extrabold tnum', size)} style={{ background: team.fill, color: team.ink }}>
      {p.number || ''}
    </span>
  );

  const node = (team: typeof teams[number], s: typeof team.spots[number], horizontal: boolean) => {
    const home = team.which === 'home';
    // Vertical: local abajo atacando hacia arriba (su izquierda es la izquierda); visitante arriba, al revés.
    // Horizontal: local a la izquierda atacando a la derecha (su izquierda queda arriba); visitante a la derecha, al revés
    const pos = horizontal
      ? { left: `${(home ? s.depth : 1 - s.depth) * 100}%`, top: `${(home ? s.x : 1 - s.x) * 100}%` }
      : { left: `${(home ? s.x : 1 - s.x) * 100}%`, top: `${(home ? 1 - s.depth : s.depth) * 100}%` };
    const did = deeds.get(s.p.name);
    return (
      <button type="button" key={team.which + (s.p.id || s.p.name)} onClick={() => setSel({ p: s.p, t: team.t, fill: team.fill, ink: team.ink })}
        className="group absolute flex w-[72px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-1 lg:w-[104px]" style={pos}
        title={`${s.p.name} · ${posEs(s.p.pos) || s.p.pos}${did?.off ? ` · cambiado en el ${did.off}` : ''}. Clic: sus estadísticas del partido`}>
        <span className="relative transition-transform group-hover:scale-110">
          {avatar(team, s.p, 'h-9 w-9 text-sm lg:h-12 lg:w-12 lg:text-lg')}
          {!!did?.goals && (
            <span className="absolute -left-2 -top-1 flex items-center gap-px rounded-full bg-zinc-50 px-0.5 text-zinc-900 ring-1 ring-black/30">
              <FootballIcon size={11} />{did.goals > 1 && <span className="text-[9px] font-bold leading-none">{did.goals}</span>}
            </span>
          )}
          {did?.card && <span className="absolute -right-1 -top-1"><Card red={did.card === 'red'} /></span>}
          {did?.off && (
            <span className="absolute -bottom-1 -right-3.5 flex items-center rounded bg-zinc-950/90 px-0.5 text-[9px] font-semibold leading-tight text-rose-300 tnum">
              <ArrowDown size={8} />{did.off.replace(/'/g, '')}
            </span>
          )}
        </span>
        <span className="max-w-full truncate px-0.5 text-[11px] font-bold leading-tight text-white lg:text-[13px]" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>{surname(s.p.name)}</span>
      </button>
    );
  };

  const label = (team: typeof teams[number], right?: boolean) => (
    <div className={cn('flex min-w-0 items-center gap-2', right && 'flex-row-reverse text-right')}>
      <TeamLogo src={team.t.logo} name={team.t.abbr} size={20} />
      <span className="truncate text-[13px] font-semibold text-zinc-50">{team.t.name}</span>
      {team.l?.formation && <span className="shrink-0 text-xs text-zinc-400 tnum">{team.l.formation}</span>}
    </div>
  );
  const [home, away] = teams;

  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panelCls, 'overflow-hidden p-3 sm:p-4')}>
        <div className="hidden items-center justify-between gap-4 pb-3 lg:flex">{label(home)}{label(away, true)}</div>
        <div className="pb-3 lg:hidden">{label(away)}</div>
        <div className="relative mx-auto hidden aspect-[105/68] w-full overflow-hidden rounded-xl lg:block" style={{ background: PITCH_LINEUP }}>
          <PitchLines horizontal bright />
          {teams.map(t => t.spots.map(s => node(t, s, true)))}
        </div>
        <div className="relative mx-auto aspect-[68/105] w-full max-w-md overflow-hidden rounded-xl lg:hidden" style={{ background: PITCH_LINEUP }}>
          <PitchLines bright />
          {teams.map(t => t.spots.map(s => node(t, s, false)))}
        </div>
        <div className="pt-3 lg:hidden">{label(home)}</div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {teams.map(team => {
          const bench = (team.l?.players ?? []).filter(p => !p.starter)
            .sort((x, y) => Number(y.subIn) - Number(x.subIn) || parseInt(deeds.get(x.name)?.on ?? '999') - parseInt(deeds.get(y.name)?.on ?? '999'));
          if (!bench.length) return null;
          return (
            <Panel key={team.which} title={<span className="flex items-center gap-2"><TeamLogo src={team.t.logo} name={team.t.abbr} size={18} />Suplentes de {team.t.short || team.t.name}</span>}>
              <div className="divide-y divide-zinc-800/60">
                {bench.map(p => {
                  const did = deeds.get(p.name);
                  // Sólo los que entraron tienen estadísticas
                  return (
                    <button type="button" key={p.id || p.name} disabled={!p.subIn} onClick={() => setSel({ p, t: team.t, fill: team.fill, ink: team.ink })}
                      title={p.subIn ? 'Sus estadísticas del partido' : 'No llegó a jugar'}
                      className="flex h-9 w-full items-center gap-3 px-4 text-left text-[13px] enabled:cursor-pointer enabled:hover:bg-zinc-900">
                      {p.subIn
                        ? <span className="shrink-0">{avatar(team, p, 'h-7 w-7 text-[11px]')}</span>
                        : <span className="grid h-7 w-7 shrink-0 place-items-center text-[11px] font-bold text-zinc-500 tnum">{p.number}</span>}
                      <span className={cn('min-w-0 flex-1 truncate', p.subIn ? 'text-zinc-100' : 'text-zinc-500')}>{p.name}</span>
                      {!!did?.goals && <span className="flex shrink-0 items-center gap-0.5 text-zinc-200"><FootballIcon size={12} />{did.goals > 1 && <span className="text-xs">{did.goals}</span>}</span>}
                      {did?.card && <Card red={did.card === 'red'} />}
                      {p.subIn && <span className="flex shrink-0 items-center gap-0.5 text-xs text-emerald-300 tnum" title="Entró desde el banquillo"><ArrowUp size={12} />{did?.on ?? ''}</span>}
                      <span className="w-10 shrink-0 text-right text-xs text-zinc-500" title={p.pos}>{posEs(p.pos)}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          );
        })}
      </div>
      <PlayerStatsDialog key={sel?.p.id || sel?.p.name || 'nadie'} sel={sel} matchId={m.id} shots={d.shots ?? []} live={m.state === 'in'} onClose={() => setSel(null)} />
    </div>
  );
}

const RESULT_TONE: Record<string, string> = { G: 'bg-emerald-500/20 text-emerald-300', E: 'bg-zinc-700 text-zinc-200', P: 'bg-rose-500/20 text-rose-300' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });

function PastRow({ g }: { g: FootballPastGame }) {
  return (
    <div className="flex h-9 items-center gap-3 px-4 text-[13px]">
      <span className="w-16 shrink-0 text-xs text-zinc-500 tnum">{shortDate(g.date)}</span>
      <span className="w-4 shrink-0 text-center text-xs text-zinc-500" title={g.home ? 'En casa' : 'Fuera'}>{g.home ? 'C' : 'F'}</span>
      <TeamLogo src={g.opponent.logo} name={g.opponent.name} size={18} />
      <span className="min-w-0 flex-1 truncate text-zinc-200" title={g.league}>{g.opponent.name}</span>
      <span className="text-zinc-300 tnum">{g.score}</span>
      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-semibold', RESULT_TONE[g.result] || 'bg-zinc-800 text-zinc-400')}>{g.result || '–'}</span>
    </div>
  );
}

// Últimos partidos de cada uno (de cualquier competición) y los enfrentamientos entre ellos
function Form({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const tally = (list: FootballPastGame[]) => ['G', 'E', 'P'].map(r => list.filter(g => g.result === r).length).join('-');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-1 gap-2.5 2xl:grid-cols-2">
        {[m.home, m.away].map(t => {
          const list = d.form[t.id] ?? [];
          return (
            <Panel key={t.id} title={<span className="flex items-center gap-2"><TeamLogo src={t.logo} name={t.abbr} size={18} />{t.name}</span>}
              aside={list.length ? `${tally(list)} en sus últimos ${list.length}` : undefined}>
              {!list.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">ESPN no da sus últimos partidos.</p>
                : <div className="divide-y divide-zinc-800/60">{list.map(g => <PastRow key={g.id || g.date} g={g} />)}</div>}
            </Panel>
          );
        })}
      </div>
      {!!d.h2h.length && (
        <Panel title="Enfrentamientos entre ellos" aside={`Resultados de ${d.h2h[0].team === m.away.id ? m.away.name : m.home.name}`}>
          <div className="divide-y divide-zinc-800/60">{d.h2h.map(g => <PastRow key={g.id || g.date} g={g} />)}</div>
        </Panel>
      )}
    </div>
  );
}

// H2H y "cuántas veces se cumple": los cara a cara de la ficha de ESPN y los últimos 10 de cada uno (todas las competiciones),
// contra las líneas que dan ahora las casas. A = local, B = visitante, como en la ficha
function FootballTrends({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const qa = useQuery({ queryKey: ['football', 'teamGames', m.home.id], queryFn: () => window.api.football.teamGames(m.home.id), staleTime: 30 * 60e3, retry: false });
  const qb = useQuery({ queryKey: ['football', 'teamGames', m.away.id], queryFn: () => window.api.football.teamGames(m.away.id), staleTime: 30 * 60e3, retry: false });
  const odds = useMatchOdds(targetOfFootball(m));
  if (qa.isLoading || qb.isLoading) return <Loading label="Cargando los últimos partidos de los dos…" />;
  const { h2h, lastA, lastB } = footballTrendData(m, qa.data, qb.data, d.h2h);
  const date = (s: string) => new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return (
    <TrendsTable A={m.home.name} B={m.away.name} logoA={m.home.logo} logoB={m.away.logo} h2h={h2h} lastA={lastA} lastB={lastB}
      markets={footballMarkets(odds.data, m.home.name, m.away.name)}
      note={!odds.data?.markets.length ? 'Sin cuotas de este partido: la columna de la casa sale vacía.' : undefined}
      list={g => <>
        <span className="w-16 shrink-0 text-xs text-zinc-500 tnum">{date(g.date)}</span>
        <span className="min-w-0 flex-1 truncate font-medium tnum">
          <span className={g.a > g.b ? 'text-zinc-50' : 'text-zinc-400'}>{m.home.name} {g.a}</span> - <span className={g.b > g.a ? 'text-zinc-50' : 'text-zinc-400'}>{g.b} {m.away.name}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{g.vs}</span>
      </>} />
  );
}

function Table({ m }: { m: FootballMatch }) {
  const q = useQuery({ queryKey: ['football', 'standings', m.league], queryFn: () => window.api.football.standings(m.league), staleTime: 15 * 60e3 });
  if (q.isLoading) return <Loading label="Cargando la clasificación…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length) return <Empty>Esta competición no tiene clasificación.</Empty>;
  return <StandingsTable groups={q.data} mark={[m.home.id, m.away.id]} />;
}
