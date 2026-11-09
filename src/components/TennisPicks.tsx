// Recomendaciones de tenis, como las del baloncesto: la más fiable y las demás por perfil de riesgo, con filtros por tipo de apuesta,
// partido o set suelto, cuota mínima y valor. Salen en la ficha de cada partido, en la pantalla de recomendaciones (las próximas 24 horas
// o el día que se elija) y, la más fiable de cada partido, en la banda de la lista. El cálculo está en el servicio
// (server/services/tennis/picks.js) y en lib/tennis-picks.ts; aquí se piden los datos y se enseña.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarX, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { TENNIS_GROUPS, TENNIS_SCOPES, arrangeTennis, boardPicks, dayBest, hasValue, type TennisBoardPick, type TennisFilters, type TennisGroup, type TennisOrder, type TennisScope } from '@/lib/tennis-picks';
import type { TennisBoard, TennisBoardMatch, TennisMatch, TennisPick, TennisSurface, Tour } from '@/lib/types';
import { ReliabilityMeter } from './ValuePanel';
import { Toggle, addDays, dayName, isoDay, today } from './sport';
import { Empty, ErrorBox, Loading, Select } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat, TvTabs, panel, surname } from './viz';

const SURFACE: Record<TennisSurface, string> = { Hard: 'Pista dura', Clay: 'Tierra', Grass: 'Hierba' };
const PREFS = 'tennis-picks';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
// Lo más probable paga poco: el mínimo por defecto es el mismo con el que el servicio descarta (1,15)
const MIN_ODDS = [1.15, 1.3, 1.5, 1.7, 2, 2.5];
const DEFAULT_MIN_ODDS = 1.15;
const STALE_MS = 6 * 3600e3;
const PAGE = 5;
const NEXT = 'next';
const p0 = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 1 ? 'recién leídas' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
// La hora, y el día si no es hoy: en las próximas 24 horas entran partidos de mañana
const when = (iso: string) => { const d = dayName(isoDay(new Date(iso))); return d === 'Hoy' ? esTime(iso) : `${d.toLowerCase()}, ${esTime(iso)}`; };
const vs = (a: string, b: string) => `${surname(a)} - ${surname(b)}`;
const vsOf = (m: TennisMatch) => vs(m.a.name, m.b.name);
const tip = (p: TennisPick) => `${p.market}: ${p.selection}. Modelo ${p0(p.pModel)}, casa ${p0(p.pMarket)}. Fiabilidad ${p.rel.score}/100. Cuota justa ${odd(p.fair)}`;
const list = (names: string[], max = 5) => names.slice(0, max).join(', ') + (names.length > max ? ` y ${names.length - max} más` : '');

const restart = (e: unknown) => /No handler registered|is not a function/.test(String(e))
  ? <ErrorBox error="La app tiene que reiniciarse para ver las recomendaciones">Para <code>npm run dev</code> (Ctrl+C) y vuelve a lanzarlo.</ErrorBox>
  : <ErrorBox error={e} />;

const usePickAdd = () => {
  const { addToSlip } = useApp();
  return (p: TennisBoardPick) => {
    const m = p.match.m;
    addToSlip({ sport: 'tennis', status: 'pending', league: m.tournament, event: `${m.a.name} vs ${m.b.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price });
  };
};

// ---------- Datos ----------
const boardQuery = (date: string) => ({ queryKey: ['tennis', 'board', date], queryFn: () => window.api.tennis.picksBoard(date), staleTime: 60_000, refetchInterval: 3 * 60e3, retry: false });

// Circuito de un partido para el filtro: los Challenger aparte de la ATP
type Circuit = Tour | 'challenger';
const CIRCUITS: { value: Circuit; label: string }[] = [{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }, { value: 'challenger', label: 'Challenger' }];
const circuitOf = (m: TennisMatch): Circuit => (m.level === 'challenger' ? 'challenger' : m.tour);
const circuitOfId = (id: string): Circuit => (id.startsWith('ch:') ? 'challenger' : id.startsWith('wta:') ? 'wta' : 'atp');

// Los partidos sin empezar de las próximas 24 horas (por defecto: los de esta noche y los de mañana por la mañana van juntos) o de un día
export function useUpcomingTennis() {
  const days = useMemo(() => [0, 1, 2].map(n => addDays(today(), n)), []);
  const [range, setRange] = useState(NEXT);
  const [tour, setTour] = useState<'all' | Circuit>('all');
  const [matchId, setMatchId] = useState('');
  const wanted = range === NEXT ? days.slice(0, 2) : [range];
  const qs = useQueries({ queries: wanted.map(boardQuery) });
  const stamp = qs.map(q => q.dataUpdatedAt).join();

  const r = useMemo(() => {
    const limit = Date.now() + 24 * 3600e3;
    const inRange = (date: string) => range !== NEXT || +new Date(date) < limit;
    const all = qs.flatMap(q => q.data?.matches ?? []).filter(x => inRange(x.m.date));
    const tours = CIRCUITS.filter(c => all.some(x => circuitOf(x.m) === c.value));
    const byTour = all.filter(x => tour === 'all' || circuitOf(x.m) === tour).sort((a, b) => +new Date(a.m.date) - +new Date(b.m.date));
    const noOdds = matchId ? [] : qs.flatMap(q => q.data?.noOdds ?? []).filter(x => inRange(x.date) && (tour === 'all' || circuitOfId(x.id) === tour));
    return { tours, byTour, matches: byTour.filter(x => !matchId || x.m.id === matchId), noOdds };
  }, [stamp, range, tour, matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...r, days, range, tour, matchId,
    loading: qs.some(q => q.isLoading), error: qs.find(q => q.error)?.error,
    pickRange: (v: string) => { setRange(v); setMatchId(''); },
    pickTour: (t: 'all' | Circuit) => { setTour(t); setMatchId(''); },
    pickMatch: setMatchId
  };
}

function RangeFilters({ u }: { u: ReturnType<typeof useUpcomingTennis> }) {
  return (
    <div className={cn(panel, 'flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5')}>
      <TvTabs value={u.range} onChange={u.pickRange} items={[{ value: NEXT, label: 'Próximas 24 h' }, ...u.days.map(d => ({ value: d, label: dayName(d) }))]} />
      <TvTabs value={u.tour} onChange={u.pickTour} items={[{ value: 'all' as const, label: 'Todos' }, ...u.tours]} />
      <Select aria-label="Partido" className="h-7 w-full text-xs sm:w-72 lg:h-7 lg:text-xs" value={u.matchId} onChange={e => u.pickMatch(e.target.value)}>
        <option value="">Todos los partidos con cuotas ({u.byTour.length})</option>
        {u.byTour.map(x => <option key={x.m.id} value={x.m.id}>{vsOf(x.m)}, {when(x.m.date)}</option>)}
      </Select>
    </div>
  );
}

// ---------- Piezas ----------
function ValueChip({ pick, long }: { pick: TennisPick; long?: boolean }) {
  const good = hasValue(pick);
  return (
    <span title="Valor esperado por cada euro con esta probabilidad y esta cuota. Si es negativo, a la larga gana la casa."
      className={cn('font-score text-[12px] font-semibold tnum', good ? 'text-[var(--tv-mark)]' : pick.ev > 0 ? 'text-zinc-200' : 'text-zinc-500')}>{long && good ? 'Con valor ' : ''}{signed(pick.ev)}</span>
  );
}

// El partido (si hay varios), lo que le falta al modelo y el motivo
function Context({ pick, oneMatch }: { pick: TennisBoardPick; oneMatch: boolean }) {
  return <>
    {!oneMatch && <span className="text-zinc-300">{vsOf(pick.match.m)}, {when(pick.match.m.date)} · </span>}
    {pick.warn && <span className="text-amber-300">{pick.warn} · </span>}
    {pick.why}
  </>;
}

interface RowProps { oneMatch: boolean; onOpen?: (x: TennisBoardMatch) => void; onAdd: (p: TennisBoardPick) => void }

function PickRow({ pick, oneMatch, onOpen, onAdd }: RowProps & { pick: TennisBoardPick }) {
  const text = <>
    <div className="line-clamp-2 text-[14px] font-semibold leading-[18px] text-zinc-50">{pick.title}</div>
    <div className="line-clamp-2 text-[11px] leading-[14px] text-zinc-400"><Context pick={pick} oneMatch={oneMatch} /></div>
  </>;
  return (
    <div className="px-3 py-1.5 transition hover:bg-zinc-800/30">
      <div className="flex items-center gap-2.5">
        {onOpen
          ? <button onClick={() => onOpen(pick.match)} title={`${tip(pick)}. Pulsa para abrir el partido`} className="min-w-0 flex-1 cursor-pointer text-left">{text}</button>
          : <div title={tip(pick)} className="min-w-0 flex-1">{text}</div>}
        <div className="w-[52px] shrink-0 text-right" title="Probabilidad estimada y valor esperado por cada euro">
          <div className="font-score text-[20px] font-bold leading-none text-zinc-50 tnum">{p0(pick.p)}</div>
          <ValueChip pick={pick} />
        </div>
        <button onClick={() => onAdd(pick)} title={`Añadir al cupón: ${pick.book}. Justa: ${odd(pick.fair)}`}
          className="flex h-10 w-[60px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg bg-zinc-800 text-zinc-50 transition hover:bg-zinc-700 hover:text-[var(--tv-mark)]">
          <span className="font-score text-[16px] font-bold leading-none tnum">{odd(pick.price)}</span>
          <span className="text-[9px] leading-tight opacity-75">{pick.book}</span>
        </button>
      </div>
      <div className="mt-1 h-[2px] rounded-full bg-zinc-800"><div className="h-full rounded-full bg-[var(--tv-mark)]" style={{ width: `${pick.p * 100}%` }} /></div>
    </div>
  );
}

function PickList({ title, hint, items, ...props }: RowProps & { title: string; hint: string; items: TennisBoardPick[] }) {
  const [all, setAll] = useState(false);
  return (
    <div className="min-w-0">
      <TvBand aside={items.length || undefined}>{title}</TvBand>
      <p className="px-3 pt-1 text-[11px] text-zinc-500">{hint}</p>
      {!items.length ? <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna con estos filtros.</p> : (all ? items : items.slice(0, PAGE)).map(p => <PickRow key={`${p.match.m.id}:${p.id}`} pick={p} {...props} />)}
      {items.length > PAGE && <button onClick={() => setAll(!all)} className="w-full cursor-pointer py-1.5 text-xs text-zinc-500 hover:text-zinc-200">{all ? `Ver sólo las ${PAGE} primeras` : `Ver las ${items.length}`}</button>}
    </div>
  );
}

function TopPick({ pick, oneMatch, onOpen, onAdd }: RowProps & { pick: TennisBoardPick }) {
  const text = <>
    <div className="text-[24px] font-bold leading-tight tracking-tight text-zinc-50 md:text-[28px]">{pick.title}</div>
    <div className="mt-1.5 text-[13px] text-zinc-300"><Context pick={pick} oneMatch={oneMatch} /></div>
  </>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      {onOpen
        ? <button onClick={() => onOpen(pick.match)} title={`${tip(pick)}. Pulsa para abrir el partido`} className="col-span-2 min-w-0 cursor-pointer text-left md:col-span-1">{text}</button>
        : <div title={tip(pick)} className="col-span-2 min-w-0 md:col-span-1">{text}</div>}
      <div className="text-center" title={`Modelo ${p0(pick.pModel)}, casa ${p0(pick.pMarket)}`}>
        <div className="font-score text-[44px] font-bold leading-[46px] text-[var(--tv-mark)] tnum">{p0(pick.p)}</div>
        <div className="text-xs font-medium text-zinc-400">Probabilidad</div>
      </div>
      <div className="col-span-2 min-w-32 md:col-span-1">
        <div className="mb-1 flex justify-between text-xs font-medium text-zinc-400"><span>Fiabilidad</span><span>{pick.rel.label}</span></div>
        <ReliabilityMeter rel={pick.rel} />
        <div className="mt-1 flex justify-between gap-3 text-[11px] text-zinc-400"><span>Justa <span className="tnum text-zinc-200">{odd(pick.fair)}</span></span><ValueChip pick={pick} long /></div>
      </div>
      <button onClick={() => onAdd(pick)} title="Añadir al cupón" className="col-start-2 row-start-2 flex h-[58px] w-[96px] cursor-pointer flex-col items-center justify-center rounded-lg bg-[var(--tv-mark)] text-zinc-950 transition hover:opacity-90 md:col-start-auto md:row-start-auto">
        <span className="flex items-center gap-1 font-score text-[24px] font-bold leading-none tnum"><Plus size={15} />{odd(pick.price)}</span>
        <span className="text-[11px] font-medium">{pick.book}</span>
      </button>
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <div className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{children}</span></div>;

// La cabecera de un partido solo: quién gana según el modelo, las casas y la mezcla, y los juegos que se esperan
function MatchStats({ x }: { x: TennisBoardMatch }) {
  const s = x.summary, m = x.m, aFav = s.pFinal >= 0.5;
  const fav = aFav ? m.a : m.b, side = (v: number) => (aFav ? v : 1 - v);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <TvStat label={`Gana ${surname(fav.name)}`} value={p0(side(s.pFinal))} sub="estimación final" />
      <TvStat label="Modelo" value={p0(side(s.pModel))} sub="sin mirar cuotas" title={`Elo y estadísticas: ${p0(s.pElo)} y ${p0(s.pStats)} para ${m.a.name}`} />
      {s.pMarket != null && <TvStat label="Casas" value={p0(side(s.pMarket))} sub="sin su margen" />}
      <TvStat label="Juegos" value={s.expectedGames.toFixed(1).replace('.', ',')} sub="esperados" />
    </div>
  );
}

// ---------- Tablero ----------
// matches: un partido (pestaña de su ficha) o varios (pantalla de recomendaciones). onOpen: abrir el partido de una recomendación
export function TennisPicksBoard({ matches, noOdds = [], onOpen }: { matches: TennisBoardMatch[]; noOdds?: TennisBoard['noOdds']; onOpen?: (x: TennisBoardMatch) => void }) {
  const one = matches.length === 1 && !noOdds.length ? matches[0] : null;
  const oneMatch = !!one;
  const prefs = useMemo(loadPrefs, []);
  const [group, setGroup] = useState<TennisGroup | 'all'>(TENNIS_GROUPS.some(g => g.value === prefs.group) ? prefs.group : 'all');
  const [scope, setScope] = useState<TennisScope>(TENNIS_SCOPES.some(s => s.value === prefs.scope) ? prefs.scope : 'all');
  const [order, setOrder] = useState<TennisOrder>(prefs.order === 'value' ? 'value' : 'p');
  const [minOdds, setMinOdds] = useState<number>(MIN_ODDS.includes(prefs.minOdds) ? prefs.minOdds : DEFAULT_MIN_ODDS);
  const [onlyValue, setOnlyValue] = useState<boolean>(prefs.onlyValue === true);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ group, scope, order, minOdds, onlyValue })); } catch { /* sin almacenamiento */ } }, [group, scope, order, minOdds, onlyValue]);

  const add = usePickAdd();
  const all = useMemo(() => matches.flatMap(boardPicks), [matches]);
  const filters: TennisFilters = { group, scope, order, minOdds, onlyValue };
  const A = useMemo(() => arrangeTennis(all, filters, oneMatch), [all, group, scope, order, minOdds, onlyValue, oneMatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const youngest = matches.length ? Math.min(...matches.map(x => x.oddsAge)) : null;
  const sub = one
    ? [one.surface ? SURFACE[one.surface] : 'Superficie sin confirmar', one.indoor ? 'bajo techo' : '', `al mejor de ${one.bestOf}`, `cuotas ${ago(one.oddsAge)}`].filter(Boolean).join(' · ')
    : [`${matches.length} de ${matches.length + noOdds.length} partidos con cuotas`, youngest != null ? `cuotas ${ago(youngest)}` : ''].filter(Boolean).join(' · ');
  const stale = matches.filter(x => x.oddsAge > STALE_MS);
  const notes = one ? one.warnings : [
    ...(noOdds.length ? [`Sin cuotas todavía: ${list(noOdds.map(x => vs(x.a, x.b)))}. El lector las trae solo unas horas antes de cada partido.`] : []),
    ...(stale.length ? [`Cuotas de hace más de 6 h en ${list(stale.map(x => vsOf(x.m)))}: actualízalas antes de apostar.`] : [])
  ];
  // Sin ninguna en este partido, lo normal es que el modelo y las casas no se pongan de acuerdo sobre quién gana
  const gap = one && one.summary.pMarket != null ? Math.abs(one.summary.pModel - one.summary.pMarket) : 0;
  const props = { oneMatch, onOpen, onAdd: add };

  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panel, 'flex flex-col gap-2.5 px-3.5 py-2.5')}>
        <TvTabs value={group} onChange={setGroup} items={TENNIS_GROUPS.map(g => ({ ...g, disabled: g.value !== 'all' && g.value !== group && !all.some(x => x.group === g.value), title: g.value !== 'all' && !all.some(x => x.group === g.value) ? 'Las casas no dan este mercado en estos partidos' : g.title }))} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-zinc-400">
          <TvTabs value={scope} onChange={setScope} items={TENNIS_SCOPES} />
          <label className="flex items-center gap-2" title="Dentro de cada lista: primero lo más probable o primero lo que más valor tiene">Ordenar
            <Select className="h-7 w-40 text-xs lg:h-7 lg:text-xs" value={order} onChange={e => setOrder(e.target.value === 'value' ? 'value' : 'p')}>
              <option value="p">Por probabilidad</option><option value="value">Por valor</option>
            </Select>
          </label>
          <label className="flex items-center gap-2" title="Fuera lo que paga menos: una cuota de 1,10 arriesga mucho para ganar casi nada">Cuota mínima
            <Select className="h-7 w-24 text-xs lg:h-7 lg:text-xs" value={minOdds} onChange={e => setMinOdds(Number(e.target.value))}>{MIN_ODDS.map(m => <option key={m} value={m}>{odd(m).replace('.', ',')}</option>)}</Select>
          </label>
          <span title="Valor esperado de 2 % o más y fiabilidad de 55 o más"><Toggle on={onlyValue} onChange={setOnlyValue} label="Sólo con valor" /></span>
        </div>
      </div>

      <TvFrame>
        <TvHeader title="Recomendaciones" sub={sub}>
          {one ? <MatchStats x={one} /> : (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <TvStat label="Opciones" value={A.count} sub={`de ${matches.reduce((t, x) => t + x.considered, 0)} líneas`} title="Las que pasan los filtros, de todas las líneas de las casas que el modelo sabe calcular" />
              <TvStat label="Con valor" value={A.withValue} sub="valor 2 % o más" title="Valor esperado de 2 % o más y fiabilidad de 55 o más" />
              {A.bestEv != null && <TvStat label="Mejor valor" value={signed(A.bestEv)} sub="por euro" />}
            </div>
          )}
        </TvHeader>

        <TvBand>La más fiable</TvBand>
        {A.top ? <TopPick pick={A.top} {...props} /> : (
          <p className="px-4 py-3 text-[13px] text-zinc-300">
            {!all.length
              ? (one && gap >= 0.1 ? `Ninguna llega al nivel en este partido: el modelo y las casas no coinciden en quién gana (${p0(one.summary.pModel)} y ${p0(one.summary.pMarket!)} para ${surname(one.m.a.name)}), y con esa diferencia no hay en qué fiarse.` : 'Las casas todavía no tienen líneas que el modelo sepa calcular, o ninguna llega al nivel.')
              : 'Ninguna llega al nivel con estos filtros: tiene que ser probable (60 % o más) y de fiar. Abajo tienes las demás; prueba a bajar la cuota mínima o a quitar filtros.'}
          </p>
        )}

        <div className="grid grid-cols-1 divide-y divide-zinc-800 border-t border-zinc-800 2xl:grid-cols-3 2xl:divide-x 2xl:divide-y-0">
          <PickList title="Más fáciles" hint="Probabilidad de 60 % o más" items={A.easy} {...props} />
          <PickList title="Equilibradas" hint="Probabilidad de 45 a 60 %" items={A.mid} {...props} />
          <PickList title="Más complicadas" hint="Probabilidad de menos de 45 %, cuota de 2,20 o más" items={A.hard} {...props} />
        </div>

        {!!notes.length && <div className="flex flex-col gap-1 border-t border-zinc-800 px-3 py-1.5">{notes.map(n => <Note key={n}>{n}</Note>)}</div>}
        <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">
          Es una estimación, no una garantía: mezcla el modelo con las casas y las casas pesan más. Probado con unos 10.000 partidos de la ATP y la WTA y 12.500 Challenger de 2025 y 2026, también en los aces: cuando dice 75 %, se cumple cerca del 75 %. El primer juego al saque, los primeros juegos y el primer break no se pueden comprobar así y cuentan menos en la fiabilidad. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero.
        </p>
      </TvFrame>
    </div>
  );
}

// ---------- Pantallas ----------
// Pestaña Recomendaciones de la ficha de un partido
export function TennisPicksPanel({ m, date, onOdds }: { m: TennisMatch; date: string; onOdds: () => void }) {
  const q = useQuery({ queryKey: ['tennis', 'picks', m.id], queryFn: () => window.api.tennis.picks(date, m.id), enabled: m.state === 'pre', refetchInterval: 60_000, retry: false });
  const r = q.data;
  const matches = useMemo(() => (r?.ready ? [{ ...r, m, day: date }] : []), [r, m, date]);
  if (m.state !== 'pre') return <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return restart(q.error);
  if (!r?.ready) {
    return r?.reason === 'noodds'
      ? <div className="flex flex-col items-center gap-2"><Empty>Todavía no hay cuotas de este partido, y sin ellas no se puede recomendar nada.</Empty><button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button></div>
      : <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  }
  return <TennisPicksBoard matches={matches} />;
}

// Pantalla Recomendaciones: todos los partidos con cuotas de las próximas 24 horas o del día que se elija
export function TennisPicksPage({ onOpen }: { onOpen: (x: TennisBoardMatch) => void }) {
  const u = useUpcomingTennis();
  return (
    <div className="flex flex-col gap-2.5">
      <RangeFilters u={u} />
      {u.loading ? <Loading label="Calculando las recomendaciones…" /> : u.error ? restart(u.error) : !u.matches.length
        ? <Empty icon={<CalendarX size={26} />}>{u.noOdds.length
          ? `Todavía no hay cuotas de estos partidos (${list(u.noOdds.map(x => vs(x.a, x.b)), 3)}), y sin ellas no se puede recomendar nada. El lector las trae solo unas horas antes de cada partido.`
          : 'No quedan partidos de la ATP, la WTA ni Challenger por empezar en ese intervalo. Prueba con otro día.'}</Empty>
        : <TennisPicksBoard matches={u.matches} noOdds={u.noOdds} onOpen={onOpen} />}
    </div>
  );
}

// La más fiable de cada partido del día, en la lista de partidos
export function TennisDayPicks({ date, onOpen, onAll }: { date: string; onOpen: (x: TennisBoardMatch) => void; onAll: () => void }) {
  const q = useQuery({ ...boardQuery(date), enabled: date >= today() });
  const minOdds = useMemo(() => { const m = loadPrefs().minOdds; return MIN_ODDS.includes(m) ? m : DEFAULT_MIN_ODDS; }, []);
  const best = useMemo(() => dayBest(q.data?.matches ?? [], minOdds, 4), [q.data, minOdds]);
  if (!best.length) return null;
  // La apuesta arriba y el partido debajo, en dos líneas: en una sola fila el móvil cortaba las dos hasta no leerse
  return (
    <TvFrame>
      <TvBand>Las más fiables del día</TvBand>
      {best.map(p => (
        <button key={p.match.m.id} onClick={() => onOpen(p.match)} title={tip(p)} className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition hover:bg-zinc-800/40">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-zinc-50">{p.title}</span>
            <span className="block truncate text-xs text-zinc-500"><span className="tnum">{esTime(p.match.m.date)}</span> · {vsOf(p.match.m)}</span>
          </span>
          <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-[var(--tv-mark)] tnum">{p0(p.p)}</span><span className="block text-[11px] text-zinc-500">prob.</span></span>
          <span className="w-11 shrink-0 text-right"><span className="block text-[15px] font-semibold leading-5 text-zinc-50 tnum">{odd(p.price)}</span><span className="block text-[11px] text-zinc-500">cuota</span></span>
          <ChevronRight size={14} className="shrink-0 text-zinc-600" />
        </button>
      ))}
      <button onClick={onAll} className="w-full cursor-pointer py-2 text-xs text-zinc-400 transition hover:text-zinc-100">Ver todas las recomendaciones</button>
    </TvFrame>
  );
}
