// Fútbol · Partidos: igual que en baloncesto y tenis. Tira de días (hora de España), filtro por estado, los partidos en juego
// arriba y el resto por competición; al pulsar uno, su ficha: marcador grande con los goleadores, resumen (goles, tarjetas y
// cambios), estadísticas, alineaciones, forma, cara a cara y clasificación.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, CalendarX, Plus } from 'lucide-react';
import { sectionId, useApp, useFocus, useSections } from '@/lib/app-context';
import { cn } from '@/lib/format';
import type { FootballDetail, FootballEvent, FootballLeagueId, FootballMatch, FootballPastGame, FootballTeam } from '@/lib/types';
import { CompetitionBlock, DayStrip, LiveSection, MatchCard, MatchesTitle, Scoreboard, SheetTabs, StateFilterBar, today, type MatchState, type StateFilter } from '@/components/sport';
import { FootballIcon, StandingsTable, esTime, themeOf } from '@/components/football';
import { Button, Empty, ErrorBox, Loading, TeamLogo } from '@/components/ui';
import { Panel, TvRow } from '@/components/viz';

const stateOf = (g: FootballMatch): MatchState => (g.state === 'in' ? 'live' : g.state);
const addWeekStart = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 3); return x.toISOString().slice(0, 10); };
const surnameOf = (name: string) => name.split(' ').slice(1).join(' ') || name;

function loadList(key: string): string[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function saveList(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

export default function FootballMatches() {
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [closed, setClosed] = useState(() => loadList('football-closed'));
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
      <MatchCard key={g.id} state={st} onClick={() => setOpenId(g.id)} featured={featured}
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
      <StateFilterBar value={filter} onChange={setFilter} counts={counts} />
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
type Tab = 'summary' | 'stats' | 'lineups' | 'form' | 'table';

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
  const th = themeOf(m.home), ta = themeOf(m.away);
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      {back}
      <Scoreboard competition={m.leagueName} detail={m.stage || undefined} state={st}
        a={{ name: m.home.name, short: m.home.abbr, logo: m.home.logo, score: m.home.score, color: th?.glow, plate: th?.plate }}
        b={{ name: m.away.name, short: m.away.abbr, logo: m.away.logo, score: m.away.score, color: ta?.glow, plate: ta?.plate }}
        center={esTime(m.date)}
        centerSub={st === 'pre' ? new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : m.status}>
        <Scorers m={m} events={d?.timeline ?? m.incidents} />
        <SheetTabs value={current} onChange={setTab} items={[
          ['summary', 'Resumen'], ['stats', 'Estadísticas'], ['lineups', 'Alineaciones'], ['form', 'Forma'],
          ...(m.league !== 'copa' ? [['table', 'Clasificación']] as [Tab, string][] : [])
        ]} right={<Button size="sm" onClick={() => openBet({ sport: 'football', league: m.leagueName, event: `${m.home.name} - ${m.away.name}` })}><Plus size={14} />Apuesta</Button>} />
      </Scoreboard>
      {!d ? (q.error ? <ErrorBox error={q.error} /> : <Loading label="Cargando la ficha…" />)
        : current === 'summary' ? <Timeline d={d} />
          : current === 'stats' ? <Stats d={d} />
            : current === 'lineups' ? <Lineups d={d} />
              : current === 'form' ? <Form d={d} />
                : <Table m={m} />}
      {!!m.venue && <p className="px-1 text-xs text-zinc-500">{m.venue}{m.city ? `, ${m.city}` : ''}{d?.attendance ? ` · ${d.attendance.toLocaleString('es-ES')} espectadores` : ''}</p>}
    </div>
  );
}

const isGoal = (e: FootballEvent) => e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'owngoal';
const goalNote = (e: FootballEvent) => (e.kind === 'penalty' ? ' (p.)' : e.kind === 'owngoal' ? ' (p.p.)' : '');

// Goleadores bajo el marcador, cada uno en su lado
function Scorers({ m, events }: { m: FootballMatch; events: FootballEvent[] }) {
  const side = (t: FootballTeam, right?: boolean) => {
    const list = events.filter(e => (isGoal(e) || e.kind === 'red') && e.team === t.id);
    return (
      <div className={cn('flex min-w-0 flex-col gap-0.5 text-xs text-zinc-400', right && 'items-end text-right')}>
        {list.map((e, i) => (
          <span key={i} className="flex max-w-full items-center gap-1.5">
            {e.kind === 'red' ? <Card red /> : <FootballIcon size={11} />}
            <span className="truncate">{surnameOf(e.player)}{goalNote(e)} {e.minute}</span>
          </span>
        ))}
      </div>
    );
  };
  if (!events.some(e => isGoal(e) || e.kind === 'red')) return null;
  return <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:px-5">{side(m.home)}{side(m.away, true)}</div>;
}

// Tarjeta amarilla o roja
const Card = ({ red }: { red?: boolean }) => <span aria-hidden className={cn('inline-block h-3 w-2 shrink-0 rounded-[2px]', red ? 'bg-rose-500' : 'bg-yellow-400')} />;

const EVENT_TEXT: Record<FootballEvent['kind'], string> = {
  goal: 'Gol', penalty: 'Gol de penalti', owngoal: 'Gol en propia puerta', missed: 'Penalti fallado', yellow: 'Amarilla', red: 'Roja', sub: 'Cambio'
};

function EventIcon({ e }: { e: FootballEvent }) {
  if (e.kind === 'yellow' || e.kind === 'red') return <Card red={e.kind === 'red'} />;
  if (e.kind === 'sub') return <ArrowLeftRight size={13} className="shrink-0 text-zinc-500" />;
  return <span className={cn('shrink-0', e.kind === 'missed' ? 'text-zinc-500' : 'text-amber-400')}><FootballIcon size={13} /></span>;
}

// Goles, tarjetas y cambios: los del local a la izquierda, los del visitante a la derecha y el minuto en el centro
function Timeline({ d }: { d: FootballDetail }) {
  const { match: m, timeline } = d;
  if (!timeline.length) return <Empty>{m.state === 'pre' ? 'El partido aún no ha empezado.' : 'Todavía no hay goles, tarjetas ni cambios.'}</Empty>;
  const cell = (e: FootballEvent, right?: boolean): ReactNode => (
    <div className={cn('flex min-w-0 items-center gap-2', right ? 'justify-start' : 'flex-row-reverse justify-start text-right')} title={EVENT_TEXT[e.kind]}>
      <EventIcon e={e} />
      <div className="min-w-0">
        <div className={cn('truncate text-[13px]', isGoal(e) ? 'font-semibold text-zinc-50' : 'text-zinc-200')}>{e.player || EVENT_TEXT[e.kind]}{goalNote(e)}</div>
        {e.other && <div className="truncate text-xs text-zinc-500">{e.kind === 'sub' ? `Sale ${e.other}` : `Asistencia de ${e.other}`}</div>}
      </div>
    </div>
  );
  return (
    <Panel title="Resumen">
      <div className="divide-y divide-zinc-800/60">
        {timeline.map((e, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-2">
            {e.team === m.home.id ? cell(e) : <span />}
            <span className="text-center text-xs font-medium text-zinc-400 tnum">{e.minute}</span>
            {e.team === m.away.id ? cell(e, true) : <span />}
          </div>
        ))}
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

// Once inicial por su sitio en la formación (1 es el portero) y el banquillo, con quién entró y quién salió
function Lineups({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  if (!d.lineups.length) return <Empty>{m.state === 'pre' ? 'Las alineaciones salen una hora antes del partido, más o menos.' : 'ESPN no tiene las alineaciones de este partido.'}</Empty>;
  const team = (t: FootballTeam) => d.lineups.find(l => l.team === t.id);
  return (
    <div className="grid grid-cols-1 gap-2.5 2xl:grid-cols-2">
      {[m.home, m.away].map(t => {
        const l = team(t);
        if (!l) return null;
        const xi = l.players.filter(p => p.starter).sort((x, y) => (x.place ?? 99) - (y.place ?? 99));
        const bench = l.players.filter(p => !p.starter).sort((x, y) => Number(y.subIn) - Number(x.subIn));
        const row = (p: typeof xi[number]) => (
          <div key={p.id || p.name} className="flex h-8 items-center gap-3 px-4 text-[13px]">
            <span className="w-6 text-right text-xs text-zinc-500 tnum">{p.number}</span>
            <span className={cn('min-w-0 flex-1 truncate', p.starter || p.subIn ? 'text-zinc-100' : 'text-zinc-500')}>{p.name}</span>
            {p.subOut && <span className="text-xs text-rose-300" title="Sustituido">Sale</span>}
            {p.subIn && <span className="text-xs text-emerald-300" title="Entró desde el banquillo">Entra</span>}
            <span className="w-10 text-right text-xs text-zinc-500" title={p.pos}>{posEs(p.pos)}</span>
          </div>
        );
        return (
          <Panel key={t.id} title={<span className="flex items-center gap-2"><TeamLogo src={t.logo} name={t.abbr} size={18} />{t.name}</span>} aside={l.formation}>
            <div className="divide-y divide-zinc-800/60">{xi.map(row)}</div>
            {!!bench.length && <>
              <div className="border-y border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-500">Suplentes</div>
              <div className="divide-y divide-zinc-800/60">{bench.map(row)}</div>
            </>}
          </Panel>
        );
      })}
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

function Table({ m }: { m: FootballMatch }) {
  const q = useQuery({ queryKey: ['football', 'standings', m.league], queryFn: () => window.api.football.standings(m.league), staleTime: 15 * 60e3 });
  if (q.isLoading) return <Loading label="Cargando la clasificación…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length) return <Empty>Esta competición no tiene clasificación.</Empty>;
  return <StandingsTable groups={q.data} mark={[m.home.id, m.away.id]} />;
}
