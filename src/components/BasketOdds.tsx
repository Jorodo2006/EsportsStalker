// Cuotas de un partido de baloncesto, tenis o fútbol (Winamax y Betway, leídas por el lector de Docker): estado de cada casa,
// botón para leerlas ya, y los mercados por periodo con la mejor cuota marcada. En hándicaps y totales se enseñan
// primero las líneas más igualadas, que son las que se suelen apostar.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, decEs, fmtTime, odd, pct } from '@/lib/format';
import type { AutoJob, BasketGame, MarketLine, PriceHistoryRow, Sport, TeamRef } from '@/lib/types';
import { BookHead, BookIcon, bookKey } from './BookIcon';
import { LEAGUE_NAME } from './BasketAnalyzer';
import { Button, Empty, ErrorBox, Loading, chip, oddBtn, panelCls } from './ui';
import { ODDS_FALLBACK, oddsMeta } from '@/lib/odds-live';
import { oddsExplanation } from '@/lib/odds-window';
import { askLogin, useMember } from './AuthGate';
import { jobFailed, jobStage, waitJob } from '@/lib/odds-read';

// El partido tal y como lo guardan el lector y el comparador: visitante (a) contra local (b)
export const matchOfGame = (g: BasketGame) => ({
  a: { name: g.away.name, code: g.away.abbr, alt: g.away.alt },
  b: { name: g.home.name, code: g.home.abbr, alt: g.home.alt },
  start: g.date, sport: 'basket' as const, league: g.league
});

// Lo que necesita el comparador de cualquier deporte: el partido para el lector y cómo apuntarlo en el cupón
export interface OddsTarget {
  id: string; done: boolean; sport: Sport; event: string; league: string;
  match: { a: TeamRef; b: TeamRef; start?: string; sport: Sport; league?: string; event?: string };
}
export const targetOfGame = (g: BasketGame): OddsTarget => ({
  id: g.id, done: g.state === 'post', sport: 'basket', event: `${g.away.abbr} @ ${g.home.abbr}`, league: LEAGUE_NAME[g.league], match: matchOfGame(g)
});

export function useMatchOdds(t: OddsTarget) {
  return useQuery({
    queryKey: ['odds', t.sport, t.id], queryFn: () => window.api.odds.match(t.match),
    meta: oddsMeta(t.match), refetchInterval: ODDS_FALLBACK, enabled: !t.done
  });
}
export const useBasketOdds = (g: BasketGame) => useMatchOdds(targetOfGame(g));

const SECTIONS: [string, (m: MarketLine) => boolean][] = [
  ['Partido', m => m.period === 0],
  ['Jugadores', m => m.period === 98],
  ['Mitades', m => m.period === 1 || m.period === 2],
  ['Cuartos', m => m.period >= 11 && m.period <= 14],
  ['Sets', m => m.period >= 21 && m.period <= 25],
  ['Otros', m => m.period === 50 || m.period === 99]
];
const typeOf = (m: MarketLine) => m.key.split('|')[0];

export const BasketOdds = ({ game }: { game: BasketGame }) => <SportOdds target={targetOfGame(game)} />;

export function SportOdds({ target }: { target: OddsTarget }) {
  const { addToSlip, toast, settings } = useApp();
  const qc = useQueryClient();
  const { data, isLoading, error, dataUpdatedAt, isFetching } = useMatchOdds(target);
  const member = useMember();
  const [job, setJob] = useState<AutoJob | null>(null);
  const [section, setSection] = useState('Partido');
  const m = target.match;
  // Cuando acaba cualquier lectura de este partido (también las automáticas), sus cuotas se vuelven a pedir. La nuestra se sigue
  // aparte, por su número (start)
  useEffect(() => window.api.onOddsAuto(j => {
    if (j.done && j.match.a.name === m.a.name && j.match.b.name === m.b.name) qc.invalidateQueries({ queryKey: ['odds', target.sport, target.id] });
  }), [m.a.name, m.b.name, target.id, target.sport, qc]);
  const running = !!job && !job.done;
  const books = data?.books.length ? data.books : ['Winamax', 'Betway'];
  // Con su ref (partido, clave del mercado y selección): el servidor la resolverá sola cuando acabe el partido
  const pick = (market: string, sel: string, bk: string, price: number, key: string, out: string) =>
    addToSlip({
      sport: target.sport, league: target.league, event: target.event, market, selection: sel, bookmaker: bk, odds: price, status: 'pending',
      ref: { sport: target.sport, match: target.id, key, out, ...(target.match.start ? { start: target.match.start } : {}) },
      live: { match: target.match, key, out }
    });

  const groups = useMemo(() => {
    const out = new Map<string, MarketLine[]>();
    for (const l of (data?.markets ?? []).filter(SECTIONS.find(s => s[0] === section)![1])) out.set(l.group, [...(out.get(l.group) ?? []), l]);
    return [...out.entries()];
  }, [data, section]);
  const counts = Object.fromEntries(SECTIONS.map(([n, f]) => [n, (data?.markets ?? []).filter(f).length]));
  // Cómo se han movido las cuotas: se vuelve a pedir cuando llegan cuotas nuevas (dataUpdatedAt)
  const hist = useQuery({
    queryKey: ['odds', 'history', target.sport, target.id, dataUpdatedAt], enabled: !!data?.markets.length,
    queryFn: () => window.api.odds.history(m), staleTime: 5 * 60e3, placeholderData: p => p
  });
  const moves = useMemo(() => movesOf(hist.data), [hist.data]);

  // La lectura se sigue por su número con waitJob: escucha el aviso en vivo y, por si se pierde, pregunta cada pocos segundos. Antes
  // sólo se fiaba del aviso y lo reconocía por los equipos: si el aviso se perdía (se corta la conexión de avisos) el botón se quedaba
  // en «Leyendo…» para siempre, y una lectura automática del mismo partido se confundía con la nuestra
  async function start() {
    if (!member) { askLogin({ why: 'Leer las cuotas al momento lo hace el lector de Sharpex, y es para usuarios registrados. Sin cuenta ves las de la última lectura automática.' }); return; }
    try {
      const first = await window.api.odds.auto(m);
      setJob(first);
      const end = await waitJob(first, setJob);
      qc.invalidateQueries({ queryKey: ['odds', target.sport, target.id] });
      if (!end) { setJob(null); toast('La lectura está tardando: sigue en marcha y las cuotas saldrán solas cuando acabe'); }
      else if (jobFailed(end)) toast('No se han podido leer las cuotas: pasa el ratón por cada casa para ver por qué');
    } catch (e) { toast((e as Error).message); setJob(null); }
  }

  if (target.done) return <Empty>El partido ha terminado: ya no hay cuotas.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {books.map(name => {
          const st = data?.sources[name], step = job?.steps[bookKey(name)];
          const busy = running && step && ['esperando', 'buscando', 'leyendo'].includes(step.estado);
          return (
            <span key={name} title={step?.msg || st?.msg || 'Sin cuotas todavía'}
              className={cn('inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium',
                step?.estado === 'error' ? 'border-rose-500/40 text-rose-300' : st?.ok ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-dashed border-zinc-700 text-zinc-500')}>
              {busy ? <Loader2 size={12} className="animate-spin text-amber-400" /> : <BookIcon name={name} size={16} className={cn(!st?.ok && 'opacity-40 grayscale')} />}
              {name}{busy && step?.msg && <span className="max-w-40 truncate font-normal text-zinc-500">{step.msg}</span>}
            </span>
          );
        })}
        <span className="ml-auto font-mono text-[11px] text-zinc-500">{dataUpdatedAt && data?.markets.length ? `Actualizado ${fmtTime(dataUpdatedAt)}` : ''}{isFetching && ' …'}</span>
        <Button size="sm" disabled={running} onClick={start} title={running ? jobStage(job) : 'Leer ahora las cuotas de las casas (tarda alrededor de un minuto)'}><RefreshCw size={14} className={cn(running && 'animate-spin')} />{running ? (job?.picked ? 'Leyendo…' : 'En cola…') : 'Actualizar cuotas'}</Button>
      </div>

      {isLoading ? <Loading label="Cargando cuotas…" /> : error ? <ErrorBox error={error} /> : !data?.markets.length ? (
        <Empty>
          <span className="block font-medium text-zinc-200">Todavía no hay cuotas de este partido</span>
          {oddsExplanation(target.match.start, { sport: target.sport, challenger: target.id.startsWith('ch:') }, settings, data?.sources).map(t => <span key={t} className="mt-1.5 block">{t}</span>)}
        </Empty>
      ) : <>
        <div className="flex flex-wrap gap-1">
          {SECTIONS.filter(([n]) => counts[n]).map(([n]) => (
            <button key={n} onClick={() => setSection(n)}
              className={chip(section === n)}>
              {n} <span className={cn('font-mono tnum', section === n ? 'text-amber-200' : 'text-zinc-500')}>{counts[n]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {groups.map(([group, lines]) => <OddsCard key={group} group={group} lines={lines} books={books} moves={moves} onPick={pick} />)}
        </div>
      </>}
    </div>
  );
}

// Una tarjeta de mercado: filas de selecciones y una columna por casa. Clic: al cupón
function OddsCard({ group, lines, books, moves, onPick }: {
  group: string; lines: MarketLine[]; books: string[]; moves: Map<string, Move>; onPick: (market: string, sel: string, bk: string, price: number, key: string, out: string) => void;
}) {
  const [all, setAll] = useState(false);
  // Líneas más igualadas primero (la principal de la casa suele ser la de menos diferencia entre lados)
  const gap = (l: MarketLine) => {
    const ps = l.outcomes.map(o => Math.max(0, ...Object.values(o.prices)));
    return ps.length === 2 && ps[0] && ps[1] ? Math.abs(ps[0] - ps[1]) : 9;
  };
  const many = ['spread', 'total', 'team_total', 'corners', 'cards'].includes(typeOf(lines[0])) && lines.length > 3;
  const sorted = many ? lines.slice().sort((x, y) => gap(x) - gap(y)) : lines;
  const shown = all || !many ? (many ? sorted.slice().sort((x, y) => (x.line ?? 0) - (y.line ?? 0)) : sorted) : sorted.slice(0, 3).sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex items-center gap-2 border-b border-zinc-800/70 px-4 py-2.5">
        <h4 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-zinc-50 lg:truncate" title={decEs(group)}>{decEs(group)}</h4>
        <span className="label-data w-11 text-right text-zinc-500" title="Probabilidad sin margen, con las mejores cuotas">Prob.</span>
        {books.map(bk => <BookHead key={bk} name={bk} className="w-[72px]" />)}
      </div>
      <div className="divide-y divide-zinc-800">
        {shown.map(l => {
          const bests = l.outcomes.map(o => Math.max(0, ...books.map(b => o.prices[b] || 0)));
          const inv = bests.map(p => (p ? 1 / p : 0)), sum = inv.reduce((s, x) => s + x, 0);
          return l.outcomes.map((o, i) => (
            <div key={l.key + o.id} className="flex items-center gap-2 px-3 py-1 hover:bg-zinc-900/70">
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-200 lg:truncate" title={decEs(o.label)}>{decEs(o.label)}</span>
              <span className="w-11 text-right font-mono text-[11px] tnum text-zinc-400">{sum && inv[i] ? pct(inv[i] / sum) : ''}</span>
              {books.map(bk => {
                const p = o.prices[bk];
                // La flecha sólo si la cuota que se ve es la última del histórico (si no, el movimiento es de otra)
                const mv = moves.get(`${bookKey(bk)}|${l.key}|${o.id}`);
                const move = p && mv && Math.abs(mv.now - p) < 0.005 ? mv : null;
                return (
                  <button key={bk} disabled={!p} onClick={() => p && onPick(group, o.label, bk, p, l.key, o.id)}
                    title={p ? `${bk}: ${o.label}.${move ? ` Antes ${odd(move.before)}, cambió ${ago(move.at)}.` : ''} Clic para añadirla al cupón (otra vez para quitarla)` : undefined}
                    className={cn(oddBtn(!!p && p === bests[i] && l.outcomes.some(x => Object.keys(x.prices).length > 1)), 'relative h-8 w-[72px] text-[13px]', !p && 'bg-transparent text-zinc-700 hover:bg-transparent')}>
                    {p ? odd(p) : '–'}
                    {move && <span aria-label={move.now > move.before ? 'ha subido' : 'ha bajado'} className={cn('absolute right-1 top-0.5 text-[8px] leading-none', move.now > move.before ? 'text-emerald-400' : 'text-rose-400')}>{move.now > move.before ? '▲' : '▼'}</span>}
                  </button>
                );
              })}
            </div>
          ));
        })}
      </div>
      {many && <button onClick={() => setAll(!all)} className="w-full cursor-pointer border-t border-zinc-800 py-2 font-mono text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">{all ? 'Ver sólo las líneas más igualadas' : `Ver las ${lines.length} líneas`}</button>}
    </div>
  );
}

// ---------- movimiento de las cuotas ----------
// La última cuota de cada casa, selección y línea, frente a la anterior distinta del histórico. Sólo los cambios de las
// últimas 24 h: uno de hace tres días no dice nada de hacia dónde va el mercado ahora
export type Move = { now: number; before: number; at: number };
export function movesOf(rows: PriceHistoryRow[] | undefined) {
  const out = new Map<string, Move>(), last = new Map<string, PriceHistoryRow>();
  for (const r of rows ?? []) {
    const k = `${r.book}|${r.market_key}|${r.outcome_id}`;
    const prev = last.get(k);
    if (prev && Math.abs(prev.price - r.price) >= 0.005) out.set(k, { now: r.price, before: prev.price, at: r.ts });
    else if (prev && out.has(k)) out.set(k, { ...out.get(k)!, now: r.price });
    last.set(k, r);
  }
  for (const [k, v] of out) if (Date.now() - v.at > 24 * 3600e3) out.delete(k);
  return out;
}
export function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 60 ? `hace ${Math.max(1, m)} min` : m < 24 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}
