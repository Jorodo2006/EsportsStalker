// Recomendaciones de fútbol: la apuesta más fiable de un partido, las más fáciles y las más complicadas, y las mejores del
// día. Todo se calcula en el servicio (server/services/football/picks.js, modelo de goles + cuotas); aquí sólo se enseña y
// se manda al cupón. Las piezas de cada fila son las de tenis.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { footballPredictions, logPredictions } from '@/lib/predictions';
import { verdictOf } from '@/lib/value';
import type { FootballDayPick, FootballLineRow, FootballMatch, FootballPick } from '@/lib/types';
import { PickRow, ValueChip } from './TennisPicks';
import { ReliabilityMeter } from './ValuePanel';
import { Empty, ErrorBox, Loading, Select, chip, seg, segWrap } from './ui';
import { TvBand, TvFrame, TvHeader, TvStat } from './viz';
import { PickWhy } from './PickWhy';
import { memberOnly } from './MemberOnly';
import { targetOfFootball } from '@/lib/odds-targets';
import { RefreshOdds } from './RefreshOdds';
import { PickNums, PickOdd, PickOddText, PicksTitle, p0 } from './PickParts';
import { NewsHint, useTeamNews } from './MatchNews';
import { keyNews, withNews, type KeyNews } from '@/lib/news';
import type { NewsItem } from '@/lib/types';

// La noticia que puede cambiar una recomendación (la del jugador, si es de jugador) y su fiabilidad con ella (lib/news.ts).
// En la ficha, la del equipo sale una vez, bajo la más fiable; en el resto de filas, sólo las que nombran a su jugador
type Teams = { home: { id: string }; away: { id: string } };
const newsKeys = (m: Teams) => [String(m.home.id), String(m.away.id)];
const playerOf = (p: FootballPick) => (p.id.startsWith('wmx|') ? p.selection : '');
function pickNews(p: FootballPick, m: Teams, list: NewsItem[] | undefined): { p: FootballPick; k: KeyNews | null } {
  const k = list ? keyNews(list, newsKeys(m), playerOf(p)) : null;
  return { p: { ...p, rel: withNews(p.rel, k) }, k };
}

const g1 = (v: number) => v.toFixed(1).replace('.', ',');
const ago = (ms: number) => { const m = Math.round(ms / 60e3); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
// El día del partido en España: con él busca el servicio el partido
export const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

export function useFootballAdd() {
  const { addToSlip } = useApp();
  // Con el partido como lo pide el comparador y la clave del mercado (id = clave#selección), el cupón puede volver a leer la cuota;
  // con su ref, la apuesta sale en «Tus apuestas» y el servidor la resuelve sola (sin ella había que resolverla a mano)
  return (m: Pick<FootballMatch, 'id' | 'league' | 'leagueName' | 'date' | 'home' | 'away'>, p: FootballPick) => {
    const [key, out] = p.id.split('#');
    addToSlip({
      sport: 'football', league: m.leagueName, event: `${m.home.name} - ${m.away.name}`, market: p.market, selection: p.selection, bookmaker: p.book, odds: p.price, status: 'pending',
      ...(key && out ? { ref: { sport: 'football' as const, match: m.id, key, out, start: m.date }, live: { match: targetOfFootball(m).match, key, out } } : {})
    });
  };
}

function FootballPicksPanelInner({ m, onOdds }: { m: FootballMatch; onOdds: () => void }) {
  const addPick = useFootballAdd();
  const pre = m.state === 'pre' && !m.off;
  const q = useQuery({
    queryKey: ['football', 'picks', m.id], queryFn: () => window.api.football.picks(madridDay(m.date), m.id), enabled: pre, refetchInterval: 60_000, retry: false
  });
  // Se registran para medir después si el modelo acierta
  useEffect(() => {
    const r = q.data;
    if (r?.ready) logPredictions(footballPredictions(m, r.all ?? [r.top, ...(r.easy ?? []), ...(r.hard ?? [])]));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p: FootballPick) => addPick(m, p);
  const news = useTeamNews('football', newsKeys(m), pre).data;
  if (!pre) return <Empty>Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.</Empty>;
  if (q.isLoading) return <Loading label="Calculando las recomendaciones…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  if (!r?.ready || !r.match) {
    return r?.reason === 'noodds'
      ? <div className="flex flex-col items-center gap-2"><Empty>Todavía no hay cuotas de este partido, y sin ellas no se puede recomendar nada.</Empty><button onClick={onOdds} className="cursor-pointer text-[13px] text-amber-400 hover:underline">Ir a Cuotas y actualizarlas</button></div>
      : <Empty>{r?.reason === 'nomodel' ? 'El modelo no cubre esta competición.' : 'Las recomendaciones son para antes de empezar: el modelo no sigue el marcador en directo.'}</Empty>;
  }
  const f = r.match;
  const T = r.top ? pickNews(r.top, m, news) : null, top = T?.p;
  const sub = [`${g1(f.goalsHome)} - ${g1(f.goalsAway)} goles esperados`, r.oddsAge != null ? `cuotas ${ago(r.oddsAge)}` : ''].filter(Boolean).join(' · ');
  return (
    <TvFrame>
      <TvHeader title={<PicksTitle />} sub={sub}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:flex sm:flex-wrap sm:gap-y-1">
          <TvStat label={m.home.short || m.home.name} value={p0(f.home)} sub="modelo" />
          <TvStat label="Empate" value={p0(f.draw)} sub="modelo" />
          <TvStat label={m.away.short || m.away.name} value={p0(f.away)} sub="modelo" />
          {f.pMarketHome != null && <TvStat label="Casas" value={p0(f.pMarketHome)} sub="gana el local, sin margen" />}
        </div>
      </TvHeader>

      <TvBand>La más fiable</TvBand>
      {top ? (
        <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="min-w-0">
            <div className="text-[24px] font-bold leading-tight tracking-tight text-zinc-50">{top.title}</div>
            <div className="mt-1.5 text-[13px] text-zinc-300">{top.why}</div>
          </div>
          <div className="text-center" title={`Modelo ${p0(top.pModel)}, casa ${p0(top.pMarket)}`}>
            <div className="font-mono text-[44px] font-bold leading-[46px] text-[var(--tv-mark)] tnum">{p0(top.p)}</div>
            <div className="font-mono text-xs font-medium text-zinc-400">Probabilidad</div>
          </div>
          <div className="min-w-32">
            <div className="mb-1 flex justify-between font-mono text-xs font-medium text-zinc-400"><span>Fiabilidad del cálculo</span><span>{top.rel.label}</span></div>
            <ReliabilityMeter rel={top.rel} />
            <div className="mt-1 flex justify-between gap-3 text-[11px] text-zinc-400"><span>Justa <span className="tnum text-zinc-200">{odd(top.fair)}</span></span><ValueChip pick={top} /></div>
          </div>
          <div className="flex items-center gap-1">
            <RefreshOdds match={targetOfFootball(m).match} focus={top.id.split('#')[0]} />
            <button onClick={() => add(top)} title="Añadir al cupón" className="flex h-[58px] w-[96px] cursor-pointer flex-col items-center justify-center rounded-lg bg-[var(--tv-mark)] text-zinc-950 transition hover:opacity-90">
              <span className="flex items-center gap-1 font-score text-[24px] font-bold leading-none tnum"><Plus size={15} />{odd(top.price)}</span>
              <span className="text-[11px] font-medium">{top.book}</span>
            </button>
          </div>
          <PickWhy p={top.p} ev={top.ev} rel={top.rel.score} by="reliability" className="md:col-span-4" />
          <NewsHint k={T!.k} className="md:col-span-4" />
        </div>
      ) : (
        <p className="px-4 py-3 text-[13px] text-zinc-300">
          Ninguna llega al nivel en este partido{f.pMarketHome != null && Math.abs(f.home - f.pMarketHome) >= 0.1 ? `: el modelo da al ${m.home.name} un ${p0(f.home)} y las casas, un ${p0(f.pMarketHome)}, y con esa diferencia no hay en qué fiarse.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div><TvBand>Más fáciles</TvBand>{r.easy?.length ? r.easy.map(raw => { const x = pickNews(raw, m, news); return <PickRow key={raw.id} pick={x.p} onAdd={add} match={targetOfFootball(m).match} note={<NewsHint k={x.k?.player ? x.k : null} />} />; }) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
        <div><TvBand>Más complicadas</TvBand>{r.hard?.length ? r.hard.map(raw => { const x = pickNews(raw, m, news); return <PickRow key={raw.id} pick={x.p} onAdd={add} match={targetOfFootball(m).match} note={<NewsHint k={x.k?.player ? x.k : null} />} />; }) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}</div>
      </div>

      {!!r.warnings?.length && <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-1.5">{r.warnings.map(w => <div key={w} className="flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={12} />{w}</div>)}</div>}
      <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
        Es una estimación, no una garantía: mezcla un modelo de goles (ataque y defensa de cada equipo) con las casas, y las casas pesan más. Probado con unos 2.800 partidos de 2025 y 2026: en el 1X2 sale bien calibrado; en los goles acierta poco más que la casa. Sin cuotas históricas no se ha podido comprobar si a la larga da dinero.
      </p>
    </TvFrame>
  );
}

// ---------- Pantalla Recomendaciones ----------
// Los partidos de un día con cuotas: la más fiable de cada uno (de la más probable a la menos) y, aparte, la más complicada
// de cada uno (de la de más valor a la de menos). Al pulsar una, se abre su partido; la cuota la manda al cupón
function BoardRow({ d, p: raw, onOpen, onAdd, news }: { d: FootballDayPick; p: FootballPick; onOpen: (id: string) => void; onAdd: (d: FootballDayPick, p: FootballPick) => void; news?: NewsItem[] }) {
  const { p, k } = pickNews(raw, d, news);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition hover:bg-zinc-800/30">
      <button onClick={() => onOpen(d.id)} title={`${p.market}: ${p.selection}. ${p.why}. Pulsa para abrir el partido`} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="line-clamp-2 text-[14px] font-semibold leading-[18px] text-zinc-50">{p.title}</span>
        <span className="block truncate text-[11px] text-zinc-400"><span className="tnum">{esTime(d.date)}</span> · {d.home.short || d.home.name} - {d.away.short || d.away.name} · {d.leagueName}</span>
      </button>
      <PickNums p={p.p} ev={p.ev} good={verdictOf(p.ev, p.rel.score) === 'BET'} />
      <RefreshOdds match={targetOfFootball(d).match} focus={p.id.split('#')[0]} />
      <PickOdd price={p.price} book={p.book} fair={p.fair} onAdd={() => onAdd(d, raw)} />
      {k && <NewsHint k={k} className="basis-full" />}
    </div>
  );
}

// ---------- Escáner de líneas ----------
// Todas las líneas que calcula el modelo de los partidos del día con cuotas, de más a menos valor, con filtro por tipo de mercado,
// cuota mínima y "sólo con valor". El tipo sale de la familia ("1.ª parte · Total de goles" → "Total de goles"; "Goles de X" → "Goles de equipo")
const kindOf = (family: string) => {
  const f = family.replace(/^1\.ª parte · /, '');
  return /^Goles de /.test(f) ? 'Goles de equipo' : f;
};
function LineScanner({ date, onOpen }: { date: string; onOpen: (id: string) => void }) {
  const addPick = useFootballAdd();
  const [kind, setKind] = useState('');
  const [minPrice, setMinPrice] = useState(1.5);
  const [onlyValue, setOnlyValue] = useState(true);
  const [limit, setLimit] = useState(40);
  const q = useQuery({ queryKey: ['football', 'picks-lines', date], queryFn: () => window.api.football.picksLines(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const rows = q.data ?? [];
  const kinds = [...new Set(rows.map(r => kindOf(r.pick.family)))].sort();
  const shown = rows.filter(r => (!kind || kindOf(r.pick.family) === kind) && r.pick.price >= minPrice && (!onlyValue || verdictOf(r.pick.ev, r.pick.rel.score) === 'BET'));
  const news = useTeamNews('football', [...new Set(rows.flatMap(r => newsKeys(r)))]).data;
  const asDay = (r: FootballLineRow): FootballDayPick => ({ id: r.id, league: r.league, leagueName: r.leagueName, date: r.date, home: r.home, away: r.away, top: r.pick, hard: null });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={e => { setKind(e.target.value); setLimit(40); }} aria-label="Tipo de mercado" className="h-8 w-auto">
          <option value="">Todos los mercados</option>
          {kinds.map(k => <option key={k} value={k}>{k}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">Cuota mínima
          <input type="number" step="0.05" min="1" value={minPrice} onChange={e => { setMinPrice(Number(e.target.value) || 1); setLimit(40); }}
            className="h-8 w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100" />
        </label>
        <button role="switch" aria-checked={onlyValue} onClick={() => { setOnlyValue(v => !v); setLimit(40); }} className={chip(onlyValue)}>Sólo con valor</button>
      </div>
      {q.isLoading ? <Loading label="Calculando las líneas…" /> : q.error ? <ErrorBox error={q.error} /> : !rows.length
        ? <Empty>Ese día no hay partidos con cuotas leídas todavía.</Empty>
        : (
          <TvFrame>
            <TvHeader title="Líneas" sub={`${shown.length} de ${rows.length} líneas calculadas`} />
            {shown.length ? shown.slice(0, limit).map(r => <BoardRow key={`${r.id}|${r.pick.id}`} d={asDay(r)} p={r.pick} onOpen={onOpen} onAdd={(d, p) => addPick(d, p)} news={news} />)
              : <p className="px-3 py-3 text-[13px] text-zinc-400">Ninguna con esos filtros.</p>}
            {shown.length > limit && <button onClick={() => setLimit(l => l + 40)} className="w-full cursor-pointer border-t border-zinc-800 py-2 text-xs text-zinc-400 transition hover:text-zinc-100">Ver más ({shown.length - limit})</button>}
            <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
              Son estimaciones: mezclan el modelo de goles con las casas, y las casas pesan más. Se descartan las que se alejan mucho de la casa o tienen poca fiabilidad.
            </p>
          </TvFrame>
        )}
    </div>
  );
}

function FootballPicksPageInner({ days, onOpen }: { days: { value: string; label: string }[]; onOpen: (id: string) => void }) {
  const [date, setDate] = useState(days[0].value);
  const [view, setView] = useState<'best' | 'lines'>('best');
  const addPick = useFootballAdd();
  const q = useQuery({ queryKey: ['football', 'picks-day', date], queryFn: () => window.api.football.picksDay(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false });
  const data = q.data ?? [];
  const tops = data.slice().sort((x, y) => y.top.p - x.top.p);
  const hard = data.filter(d => d.hard).sort((x, y) => y.hard!.ev - x.hard!.ev);
  const add = (d: FootballDayPick, p: FootballPick) => addPick(d, p);
  const news = useTeamNews('football', data.flatMap(newsKeys)).data;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {days.map(d => (
          <button key={d.value} onClick={() => setDate(d.value)} aria-pressed={date === d.value}
            className={cn('h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium transition', date === d.value ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
            {d.label}
          </button>
        ))}
        <span className={cn(segWrap, 'ml-auto')}>
          <button onClick={() => setView('best')} aria-pressed={view === 'best'} className={seg(view === 'best')}>Mejores</button>
          <button onClick={() => setView('lines')} aria-pressed={view === 'lines'} className={seg(view === 'lines')}>Todas las líneas</button>
        </span>
      </div>
      {view === 'lines' ? <LineScanner date={date} onOpen={onOpen} /> : q.isLoading ? <Loading label="Calculando las recomendaciones…" /> : q.error ? <ErrorBox error={q.error} /> : !data.length
        ? <Empty>Ese día no hay partidos con cuotas leídas todavía, y sin ellas no se puede recomendar nada. El lector las trae unas horas antes de cada partido.</Empty>
        : (
          <TvFrame>
            <TvHeader title={<PicksTitle />} sub={`${data.length} ${data.length === 1 ? 'partido' : 'partidos'} con cuotas`}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:flex sm:flex-wrap sm:gap-y-1">
                <TvStat label="Con valor" value={[...tops.map(d => d.top), ...hard.map(d => d.hard!)].filter(p => verdictOf(p.ev, p.rel.score) === 'BET').length} sub="valor 2 % o más" />
              </div>
            </TvHeader>
            <div className="grid grid-cols-1 divide-y divide-zinc-800 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
              <div className="min-w-0">
                <TvBand aside={tops.length}>La más fiable de cada partido</TvBand>
                {tops.map(d => <BoardRow key={d.id} d={d} p={d.top} onOpen={onOpen} onAdd={add} news={news} />)}
              </div>
              <div className="min-w-0">
                <TvBand aside={hard.length || undefined}>Más complicadas</TvBand>
                {hard.length ? hard.map(d => <BoardRow key={d.id} d={d} p={d.hard!} onOpen={onOpen} onAdd={add} news={news} />) : <p className="px-3 py-2 text-[13px] text-zinc-400">Ninguna que merezca la pena.</p>}
              </div>
            </div>
            <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-zinc-400">
              Es una estimación, no una garantía: mezcla un modelo de goles con las casas, y las casas pesan más. En la ficha de cada partido están todas sus recomendaciones.
            </p>
          </TvFrame>
        )}
    </div>
  );
}

// Las del día: la lista de partidos las enseña al lado y, si no hay ninguna, no les guarda la columna (quedaba media pantalla vacía)
export const footballDayQuery = (date: string) => ({
  queryKey: ['football', 'picks-day', date], queryFn: () => window.api.football.picksDay(date), staleTime: 3 * 60e3, refetchInterval: 5 * 60e3, retry: false
});

// Las mejores del día, al lado de la lista de partidos: cinco, el resto al pulsar y el enlace a la pantalla Recomendaciones
function FootballDayPicksInner({ date, onOpen, onAll }: { date: string; onOpen: (id: string) => void; onAll?: () => void }) {
  const [all, setAll] = useState(false);
  const q = useQuery(footballDayQuery(date));
  const data = q.data ?? [];
  if (!data.length) return null;
  const list = all ? data : data.slice(0, 5);
  const row = (d: FootballDayPick) => (
    <button key={d.id} onClick={() => onOpen(d.id)} title={`${d.top.market}: ${d.top.selection}. ${d.top.why}`} className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-left transition last:border-0 hover:bg-zinc-800/40">
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] font-semibold leading-[17px] text-zinc-50">{d.top.title}</span>
        <span className="block truncate text-xs text-zinc-500"><span className="tnum">{esTime(d.date)}</span> · {d.home.short || d.home.name} - {d.away.short || d.away.name} · {d.leagueName}</span>
      </span>
      <PickNums p={d.top.p} ev={d.top.ev} good={verdictOf(d.top.ev, d.top.rel.score) === 'BET'} />
      <PickOddText price={d.top.price} book={d.top.book} />
      <ChevronRight size={14} className="shrink-0 text-zinc-600" />
    </button>
  );
  return (
    <TvFrame>
      <TvBand>Recomendaciones del día</TvBand>
      {list.map(row)}
      {data.length > 5 && (
        <button onClick={() => setAll(v => !v)} className="w-full cursor-pointer border-t border-zinc-800 px-4 py-2 text-left text-[13px] text-amber-400 hover:underline">
          {all ? 'Ver menos' : `Ver las ${data.length}`}
        </button>
      )}
      {onAll && <button onClick={onAll} className="w-full cursor-pointer border-t border-zinc-800 py-2 text-xs text-zinc-400 transition hover:text-zinc-100">Ver todas las recomendaciones</button>}
    </TvFrame>
  );
}

// Sin cuenta, en su lugar sale cómo conseguirlas (las recomendaciones piden cuenta: gateway/public.js)
export const FootballPicksPanel = memberOnly(FootballPicksPanelInner, 'las recomendaciones del modelo');
export const FootballPicksPage = memberOnly(FootballPicksPageInner, 'las recomendaciones del modelo');
export const FootballDayPicks = memberOnly(FootballDayPicksInner, 'las recomendaciones del modelo', true);
