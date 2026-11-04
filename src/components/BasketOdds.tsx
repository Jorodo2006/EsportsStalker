// Cuotas de un partido de baloncesto o de tenis (Winamax y Betway, leídas por el lector de Docker): estado de cada casa,
// botón para leerlas ya, y los mercados por periodo con la mejor cuota marcada. En hándicaps y totales se enseñan
// primero las líneas más igualadas, que son las que se suelen apostar.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, fmtTime, odd, pct } from '@/lib/format';
import type { AutoJob, BasketGame, MarketLine, MatchOdds, Sport, TeamRef } from '@/lib/types';
import { BookHead, BookIcon, bookKey } from './BookIcon';
import { LEAGUE_NAME } from './BasketAnalyzer';
import { Button, Empty, ErrorBox, Loading } from './ui';

// El partido tal y como lo guardan el lector y el comparador: visitante (a) contra local (b)
export const matchOfGame = (g: BasketGame) => ({
  a: { name: g.away.name, code: g.away.abbr, alt: g.away.alt },
  b: { name: g.home.name, code: g.home.abbr, alt: g.home.alt },
  start: g.date, sport: 'basket' as const, league: g.league
});

// Lo que necesita el comparador de cualquier deporte: el partido para el lector y cómo apuntarlo en el cupón
export interface OddsTarget {
  id: string; done: boolean; sport: Sport; event: string; league: string;
  match: { a: TeamRef; b: TeamRef; start?: string; sport: Sport; league?: string };
}
export const targetOfGame = (g: BasketGame): OddsTarget => ({
  id: g.id, done: g.state === 'post', sport: 'basket', event: `${g.away.abbr} @ ${g.home.abbr}`, league: LEAGUE_NAME[g.league], match: matchOfGame(g)
});

export function useMatchOdds(t: OddsTarget) {
  return useQuery({
    queryKey: ['odds', t.sport, t.id], queryFn: () => window.api.odds.match(t.match),
    refetchInterval: 60_000, enabled: !t.done
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
  const { addToSlip, toast } = useApp();
  const qc = useQueryClient();
  const { data, isLoading, error, dataUpdatedAt, isFetching } = useMatchOdds(target);
  const [job, setJob] = useState<AutoJob | null>(null);
  const [section, setSection] = useState('Partido');
  const m = target.match;
  useEffect(() => window.api.onOddsAuto(j => setJob(cur => {
    if (j.match.a.name !== m.a.name || j.match.b.name !== m.b.name) return cur;
    if (j.done) qc.invalidateQueries({ queryKey: ['odds', target.sport, target.id] });
    return j;
  })), [m.a.name, m.b.name, target.id, target.sport, qc]);
  const running = !!job && !job.done;
  const books = data?.books.length ? data.books : ['Winamax', 'Betway'];
  const pick = (market: string, sel: string, bk: string, price: number) =>
    addToSlip({ sport: target.sport, league: target.league, event: target.event, market, selection: sel, bookmaker: bk, odds: price, status: 'pending' });

  const groups = useMemo(() => {
    const out = new Map<string, MarketLine[]>();
    for (const l of (data?.markets ?? []).filter(SECTIONS.find(s => s[0] === section)![1])) out.set(l.group, [...(out.get(l.group) ?? []), l]);
    return [...out.entries()];
  }, [data, section]);
  const counts = Object.fromEntries(SECTIONS.map(([n, f]) => [n, (data?.markets ?? []).filter(f).length]));

  async function start() {
    try { setJob(await window.api.odds.auto(m)); } catch (e) { toast((e as Error).message); }
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
              className={cn('inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium',
                step?.estado === 'error' ? 'border-rose-500/30 text-rose-300' : st?.ok ? 'border-zinc-800 bg-zinc-900 text-zinc-200' : 'border-dashed border-zinc-800 text-zinc-500')}>
              {busy ? <Loader2 size={12} className="animate-spin text-amber-400" /> : <BookIcon name={name} size={16} className={cn(!st?.ok && 'opacity-40 grayscale')} />}
              {name}{busy && step?.msg && <span className="max-w-40 truncate font-normal text-zinc-500">{step.msg}</span>}
            </span>
          );
        })}
        <span className="ml-auto text-xs text-zinc-500">{dataUpdatedAt && data?.markets.length ? `Actualizado ${fmtTime(dataUpdatedAt)}` : ''}{isFetching && ' …'}</span>
        <Button size="sm" disabled={running} onClick={start}><RefreshCw size={14} className={cn(running && 'animate-spin')} />{running ? 'Leyendo…' : 'Actualizar cuotas'}</Button>
      </div>

      {isLoading ? <Loading label="Cargando cuotas…" /> : error ? <ErrorBox error={error} /> : !data?.markets.length ? (
        <Empty>Todavía no hay cuotas de este partido. Pulsa Actualizar cuotas: el lector las trae de Winamax y Betway en un minuto, sin abrir Chrome.</Empty>
      ) : <>
        <div className="flex flex-wrap gap-1">
          {SECTIONS.filter(([n]) => counts[n]).map(([n]) => (
            <button key={n} onClick={() => setSection(n)}
              className={cn('cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition', section === n ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
              {n} <span className="text-xs tnum opacity-60">{counts[n]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {groups.map(([group, lines]) => <OddsCard key={group} group={group} lines={lines} books={books} onPick={pick} />)}
        </div>
      </>}
    </div>
  );
}

// Una tarjeta de mercado: filas de selecciones y una columna por casa. Clic: al cupón
function OddsCard({ group, lines, books, onPick }: {
  group: string; lines: MarketLine[]; books: string[]; onPick: (market: string, sel: string, bk: string, price: number) => void;
}) {
  const [all, setAll] = useState(false);
  // Líneas más igualadas primero (la principal de la casa suele ser la de menos diferencia entre lados)
  const gap = (l: MarketLine) => {
    const ps = l.outcomes.map(o => Math.max(0, ...Object.values(o.prices)));
    return ps.length === 2 && ps[0] && ps[1] ? Math.abs(ps[0] - ps[1]) : 9;
  };
  const many = ['spread', 'total', 'team_total'].includes(typeOf(lines[0])) && lines.length > 3;
  const sorted = many ? lines.slice().sort((x, y) => gap(x) - gap(y)) : lines;
  const shown = all || !many ? (many ? sorted.slice().sort((x, y) => (x.line ?? 0) - (y.line ?? 0)) : sorted) : sorted.slice(0, 3).sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold" title={group}>{group}</h4>
        <span className="w-11 text-right text-[11px] text-zinc-600" title="Probabilidad sin margen, con las mejores cuotas">Prob.</span>
        {books.map(bk => <BookHead key={bk} name={bk} className="w-[72px]" />)}
      </div>
      <div className="divide-y divide-zinc-800/50">
        {shown.map(l => {
          const bests = l.outcomes.map(o => Math.max(0, ...books.map(b => o.prices[b] || 0)));
          const inv = bests.map(p => (p ? 1 / p : 0)), sum = inv.reduce((s, x) => s + x, 0);
          return l.outcomes.map((o, i) => (
            <div key={l.key + o.id} className="flex items-center gap-2 px-4 py-1">
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={o.label}>{o.label}</span>
              <span className="w-11 text-right text-xs tnum text-zinc-500">{sum && inv[i] ? pct(inv[i] / sum) : ''}</span>
              {books.map(bk => {
                const p = o.prices[bk];
                return (
                  <button key={bk} disabled={!p} onClick={() => p && onPick(group, o.label, bk, p)}
                    title={p ? `${bk}: ${o.label}. Clic para añadirla al cupón (otra vez para quitarla)` : undefined}
                    className={cn('h-7 w-[72px] rounded-md text-sm font-semibold tnum transition disabled:cursor-default',
                      !p ? 'text-zinc-700' : p === bests[i] && l.outcomes.some(x => Object.keys(x.prices).length > 1) ? 'cursor-pointer bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'cursor-pointer bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700')}>
                    {p ? odd(p) : '–'}
                  </button>
                );
              })}
            </div>
          ));
        })}
      </div>
      {many && <button onClick={() => setAll(!all)} className="w-full cursor-pointer border-t border-zinc-800/60 py-1.5 text-xs text-zinc-500 hover:text-zinc-200">{all ? 'Ver sólo las líneas más igualadas' : `Ver las ${lines.length} líneas`}</button>}
    </div>
  );
}

// Líneas de un jugador que tienen las casas, para rellenar el analizador: { "Puntos": [{ line, over, under, book }] }
export function playerLines(odds: MatchOdds | undefined, name: string) {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const n = norm(name), last = norm(name.split(' ').slice(-1)[0] || '');
  const out: Record<string, { line: number; over?: number; under?: number; overBook?: string; underBook?: string }[]> = {};
  for (const m of odds?.markets ?? []) {
    if (!m.key.startsWith('player|') || m.line == null) continue;
    const [, stat, who] = m.key.split('|');
    const w = norm(who);
    if (w !== n && !(last.length >= 4 && w.endsWith(last) && w[0] === n[0])) continue;
    const best = (id: string) => {
      const p = m.outcomes.find(o => o.id === id)?.prices ?? {};
      const [book, price] = Object.entries(p).sort((x, y) => y[1] - x[1])[0] ?? [];
      return { price, book };
    };
    const o = best('over'), u = best('under');
    (out[stat] ??= []).push({ line: m.line, over: o.price, under: u.price, overBook: o.book, underBook: u.book });
  }
  return out;
}
