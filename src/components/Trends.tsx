// H2H y "cuántas veces se cumple" (baloncesto y fútbol): para cada mercado con la línea que dan ahora las casas, cuántas
// veces se ha cumplido en los cara a cara y en los últimos 10 de cada uno, frente a la probabilidad sin margen de la cuota.
// Cada partido se mira como "lo que hizo A y lo que hizo B": en los cara a cara son los dos equipos; en los últimos de A,
// B es su rival de ese día (así "gana B" es "A perdió"); en los de B, A es su rival ("puntos de A" es "lo que encajó B").
import type { ReactNode } from 'react';
import { cn, pct } from '@/lib/format';
import type { MatchOdds } from '@/lib/types';
import { TeamLogo } from './ui';
import { Panel } from './viz';

// a y b: lo de A y lo de B; a1 y b1: en la 1.ª mitad (si se sabe)
export interface TrendGame { id: string; date: string; a: number; b: number; a1?: number; b1?: number; vs: string }
// test: si se cumplió (null si no se puede saber en ese partido); prob: la de la casa sin margen
export interface TrendMarket { id: string; label: string; test: (g: TrendGame) => boolean | null; prob: number | null }

// ---------- líneas y probabilidades de las casas ----------
const bestOf = (prices: Record<string, number>) => Math.max(0, ...Object.values(prices));
// Probabilidad sin margen de cada selección de un mercado, con la mejor cuota de cada una
export function noVig(odds: MatchOdds | undefined, key: string): Record<string, number> | null {
  const m = odds?.markets.find(x => x.key === key);
  if (!m) return null;
  const ps = m.outcomes.map(o => [o.id, bestOf(o.prices)] as const).filter(([, p]) => p > 1);
  if (ps.length !== m.outcomes.length || ps.length < 2) return null;
  const inv = ps.map(([, p]) => 1 / p), sum = inv.reduce((s, x) => s + x, 0);
  return Object.fromEntries(ps.map(([id], i) => [id, inv[i] / sum]));
}
// La línea más igualada de un tipo ("total|0||", "spread|0||", "team_total|0|a|"): la que suelen dar las casas como principal
export function mainLine(odds: MatchOdds | undefined, prefix: string): { line: number; key: string } | null {
  let best: { line: number; key: string; gap: number } | null = null;
  for (const m of odds?.markets ?? []) {
    if (!m.key.startsWith(prefix) || m.line == null) continue;
    const p = noVig(odds, m.key);
    if (!p) continue;
    const vals = Object.values(p);
    const gap = Math.abs(vals[0] - vals[1]);
    if (!best || gap < best.gap) best = { line: m.line, key: m.key, gap };
  }
  return best && { line: best.line, key: best.key };
}

const fmtL = (l: number) => String(l).replace('.', ',');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// Una línea x,5 cercana a lo habitual, para cuando las casas aún no tienen el mercado
const halfLine = (xs: number[]) => Math.floor(median(xs)) + 0.5;

// ---------- mercados de cada deporte ----------
export function basketMarkets(odds: MatchOdds | undefined, A: string, B: string, sample: TrendGame[]): TrendMarket[] {
  const ml = noVig(odds, 'moneyline|0||');
  const out: TrendMarket[] = [
    { id: 'wa', label: `Gana ${A}`, test: g => g.a > g.b, prob: ml?.a ?? null },
    { id: 'wb', label: `Gana ${B}`, test: g => g.b > g.a, prob: ml?.b ?? null }
  ];
  const tot = mainLine(odds, 'total|0||'), L = tot?.line ?? halfLine(sample.map(g => g.a + g.b));
  out.push({ id: 'tot', label: `Más de ${fmtL(L)} puntos`, test: g => g.a + g.b > L, prob: tot ? noVig(odds, tot.key)?.over ?? null : null });
  const sp = mainLine(odds, 'spread|0||');
  if (sp) out.push({ id: 'sp', label: `${A} ${sp.line > 0 ? '+' : ''}${fmtL(sp.line)}`, test: g => (g.a + sp.line === g.b ? null : g.a + sp.line > g.b), prob: noVig(odds, sp.key)?.a ?? null });
  for (const [side, name] of [['a', A], ['b', B]] as const) {
    const tt = mainLine(odds, `team_total|0|${side}|`);
    const l = tt?.line ?? halfLine(sample.map(g => (side === 'a' ? g.a : g.b)));
    out.push({ id: `tt${side}`, label: `${name}: más de ${fmtL(l)} puntos`, test: g => (side === 'a' ? g.a : g.b) > l, prob: tt ? noVig(odds, tt.key)?.over ?? null : null });
  }
  const h1 = mainLine(odds, 'total|1||');
  const withHalf = sample.filter(g => g.a1 != null);
  if (h1 || withHalf.length) {
    const l = h1?.line ?? halfLine(withHalf.map(g => g.a1! + g.b1!));
    out.push({ id: 'h1', label: `1.ª mitad: más de ${fmtL(l)}`, test: g => (g.a1 == null || g.b1 == null ? null : g.a1 + g.b1 > l), prob: h1 ? noVig(odds, h1.key)?.over ?? null : null });
  }
  return out;
}

export function footballMarkets(odds: MatchOdds | undefined, A: string, B: string): TrendMarket[] {
  const ml = noVig(odds, 'moneyline|0||'), btts = noVig(odds, 'btts|0||');
  const over = (l: number) => noVig(odds, `total|0||${l}`)?.over ?? null;
  const tt = (side: 'a' | 'b') => noVig(odds, `team_total|0|${side}|0.5`)?.over ?? null;
  return [
    { id: 'wa', label: `Gana ${A}`, test: g => g.a > g.b, prob: ml?.a ?? null },
    { id: 'x', label: 'Empate', test: g => g.a === g.b, prob: ml?.x ?? null },
    { id: 'wb', label: `Gana ${B}`, test: g => g.b > g.a, prob: ml?.b ?? null },
    { id: 'o15', label: 'Más de 1,5 goles', test: g => g.a + g.b > 1.5, prob: over(1.5) },
    { id: 'o25', label: 'Más de 2,5 goles', test: g => g.a + g.b > 2.5, prob: over(2.5) },
    { id: 'o35', label: 'Más de 3,5 goles', test: g => g.a + g.b > 3.5, prob: over(3.5) },
    { id: 'btts', label: 'Ambos marcan', test: g => g.a > 0 && g.b > 0, prob: btts?.yes ?? null },
    { id: 'sa', label: `Marca ${A}`, test: g => g.a > 0, prob: tt('a') },
    { id: 'sb', label: `Marca ${B}`, test: g => g.b > 0, prob: tt('b') }
  ];
}

// ---------- la tabla ----------
function Cell({ list, m }: { list: TrendGame[]; m: TrendMarket }) {
  const res = list.map(m.test).filter((v): v is boolean => v != null);
  if (!res.length) return <td className="px-3 py-2 text-right text-xs text-zinc-600">–</td>;
  const hit = res.filter(Boolean).length, rate = hit / res.length;
  // Frente a la casa: 10 puntos por encima, en verde; por debajo, en rojo. Con menos de 5 partidos, en gris: dice poco
  const few = res.length < 5;
  const diff = m.prob == null ? 0 : rate - m.prob;
  const tone = few ? 'text-zinc-400' : diff >= 0.1 ? 'text-emerald-300' : diff <= -0.1 ? 'text-rose-300' : 'text-zinc-100';
  const bar = few ? 'bg-zinc-600' : diff >= 0.1 ? 'bg-emerald-500' : diff <= -0.1 ? 'bg-rose-500' : 'bg-zinc-400';
  return (
    <td className="px-3 py-2 text-right" title={`${hit} de ${res.length}${few ? ' (pocos partidos: dice poco)' : ''}`}>
      <div className={cn('text-[13px] font-semibold tnum', tone)}>{hit}/{res.length} <span className="text-xs font-normal opacity-80">{pct(rate)}</span></div>
      <div className="ml-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-zinc-800"><div className={cn('h-full rounded-full', bar)} style={{ width: `${rate * 100}%` }} /></div>
    </td>
  );
}

export function TrendsTable({ A, B, logoA, logoB, h2h, lastA, lastB, markets, note, list }: {
  A: string; B: string; logoA?: string; logoB?: string; h2h: TrendGame[]; lastA: TrendGame[]; lastB: TrendGame[]; markets: TrendMarket[];
  note?: ReactNode; list: (g: TrendGame) => ReactNode;
}) {
  const head = (label: ReactNode, sub: string) => (
    <th className="px-3 py-2 text-right align-bottom text-xs font-medium text-zinc-400">
      <div className="flex items-center justify-end gap-1.5 text-zinc-200">{label}</div>
      <div className="font-normal text-zinc-500">{sub}</div>
    </th>
  );
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Cuántas veces se cumple">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-zinc-800 bg-zinc-900/60"><tr>
              <th className="px-3 py-2 text-left align-bottom text-xs font-medium text-zinc-400">Mercado</th>
              {head('Casa', 'sin margen')}
              {head('Cara a cara', `${h2h.length} partidos`)}
              {head(<>{logoA && <TeamLogo src={logoA} name={A} size={14} />}{A}</>, `últimos ${lastA.length}`)}
              {head(<>{logoB && <TeamLogo src={logoB} name={B} size={14} />}{B}</>, `últimos ${lastB.length}`)}
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {markets.map(m => (
                <tr key={m.id} className="hover:bg-zinc-900/40">
                  <td className="px-3 py-2 text-[13px] font-medium text-zinc-100">{m.label}</td>
                  <td className="px-3 py-2 text-right text-[13px] text-zinc-300 tnum">{m.prob == null ? <span className="text-zinc-600">–</span> : pct(m.prob)}</td>
                  <Cell list={h2h} m={m} />
                  <Cell list={lastA} m={m} />
                  <Cell list={lastB} m={m} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          En los últimos de {A} y de {B}, el otro lado es su rival de cada día (por ejemplo, «Gana {B}» en los de {A} es que {A} perdió).
          En verde, 10 puntos o más por encima de lo que dice la casa; en rojo, por debajo. Con menos de 5 partidos, en gris: dice poco. {note}
        </p>
      </Panel>
      <Panel title="Cara a cara" aside={h2h.length ? `${h2h.filter(g => g.a > g.b).length}-${h2h.filter(g => g.a === g.b).length ? `${h2h.filter(g => g.a === g.b).length}-` : ''}${h2h.filter(g => g.b > g.a).length} para ${A}` : undefined}>
        {!h2h.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">No se han enfrentado en los partidos que tenemos.</p>
          : <div className="divide-y divide-zinc-800/60">{h2h.map(g => <div key={g.id} className="flex h-9 items-center gap-3 px-4 text-[13px]">{list(g)}</div>)}</div>}
      </Panel>
    </div>
  );
}
