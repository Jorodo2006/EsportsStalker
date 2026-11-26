// «Sin X»: cuando un habitual no juega (parte de ESPN o una noticia), qué han hecho sus compañeros esta temporada sin él, al lado
// de la línea de las casas y de lo que dice Sharpex de esa línea (src/lib/basket-without.ts). Es un dato para leer: la probabilidad
// sigue siendo la del modelo, que no sube por esto (no se ha medido que las bajas de compañeros mejoren la proyección)
import { Newspaper, Plus } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { BASKET_MARKETS, playerOut } from '@/lib/basket-model';
import { hasValue, type BasketPick } from '@/lib/basket-picks';
import { keyAbsentee, withoutSplits, type WithoutRow } from '@/lib/basket-without';
import { ageOf } from '@/lib/slip-live';
import type { BasketGame, BasketInjury, BasketTeamLogs, MatchOdds } from '@/lib/types';
import { Badge } from './ui';
import { TvBand } from './viz';
import { p0, signed } from './PickParts';

const dec1 = (v: number) => v.toFixed(1).replace('.', ',');
const decLine = (v: number) => String(v).replace('.', ',');

// La línea de la casa de ese jugador y estadística: la más igualada (la principal) y su mejor cuota al «más»
function bookLine(odds: MatchOdds | undefined, name: string, label: string) {
  const prefix = `player|${label}|${name.toLowerCase()}|`;
  let best: { line: number; price: number; book: string; gap: number } | null = null;
  for (const m of odds?.markets ?? []) {
    if (!m.key.startsWith(prefix) || m.line == null) continue;
    const over = m.outcomes.find(o => o.id === 'over'), under = m.outcomes.find(o => o.id === 'under');
    const top = Object.entries(over?.prices ?? {}).sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    const u = Math.max(0, ...Object.values(under?.prices ?? {}));
    const gap = u ? Math.abs(top[1] - u) : 9;
    if (!best || gap < best.gap) best = { line: m.line, price: top[1], book: top[0], gap };
  }
  return best;
}

interface Absent { game: BasketGame; teamName: string; name: string; injury: BasketInjury | null; rows: WithoutRow[] }
const SHOWN = 4;

// Las bajas importantes de los partidos (antes de empezar) con sus compañeros que cambian
export function absencesOf(games: BasketGame[], injuries: BasketInjury[], logsOf: (g: BasketGame, side: 'away' | 'home') => BasketTeamLogs | undefined): Absent[] {
  const out: Absent[] = [];
  for (const g of games) {
    if (g.state !== 'pre') continue;
    for (const side of ['away', 'home'] as const) {
      const data = logsOf(g, side);
      if (!data) continue;
      const team = g[side];
      for (const p of data.players) {
        // El parte de ESPN (con las de las noticias) en la NBA; en el resto, el estado de la plantilla
        const inj = g.league === 'nba' ? injuries.find(i => i.playerId === p.id && i.teamId === team.id) ?? null : null;
        if (!playerOut(inj?.status ?? (g.league === 'nba' ? null : p.injury), 0)) continue;
        const key = keyAbsentee(data, p.id, g.date);
        if (!key) continue;
        // Los que tampoco juegan hoy no cuentan como compañeros que ganan minutos
        const alsoOut = (id: string) => { const x = data.players.find(q => q.id === id); const i = g.league === 'nba' ? injuries.find(j => j.playerId === id) : null; return playerOut(i?.status ?? (g.league === 'nba' ? null : x?.injury), 0); };
        const rows = withoutSplits(data, p.id, g.date, alsoOut).slice(0, 12);
        if (rows.length) out.push({ game: g, teamName: team.name, name: p.name, injury: inj, rows });
      }
    }
  }
  return out;
}

export function BasketWithout({ absents, picks, oddsOf, onAdd, oneGame }: {
  absents: Absent[]; picks: BasketPick[]; oddsOf: (g: BasketGame) => MatchOdds | undefined; onAdd: (p: BasketPick) => void; oneGame: boolean;
}) {
  if (!absents.length) return null;
  return (
    <div className="border-t border-white/10">
      <TvBand aside={absents.length > 1 ? absents.length : undefined}>Bajas: quién gana minutos</TvBand>
      {absents.map(a => {
        const news = a.injury?.news;
        return (
          <div key={`${a.game.id}|${a.name}`} className="border-b border-white/10 px-3 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone="danger">{a.name}: no juega</Badge>
              <span className="text-[13px] font-semibold text-zinc-100">Sin {a.name.split(' ').at(-1)}{oneGame ? '' : ` · ${a.game.away.abbr} @ ${a.game.home.abbr}`}</span>
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                {news ? <><Newspaper size={12} />{news.source}, {ageOf(+new Date(news.published))}</> : 'parte de ESPN'}
              </span>
            </div>
            <div className="mt-2 flex flex-col">
              {[...a.rows].sort((x, y) => +!!bookLine(oddsOf(a.game), y.name, BASKET_MARKETS[y.market].label) - +!!bookLine(oddsOf(a.game), x.name, BASKET_MARKETS[x.market].label)).slice(0, SHOWN).map(r => {
                const label = BASKET_MARKETS[r.market].label;
                const line = bookLine(oddsOf(a.game), r.name, label);
                const up = r.withoutAvg > r.withAvg;
                // Lo que dice Sharpex del lado hacia el que cambia sin él (si sube, el «más»; si baja, el «menos»), en la línea principal
                const side = up ? 'over' : 'under';
                // Sólo la de la línea principal: otra («más de 12,5» a 6,00) no dice nada de este cambio. En la NBA, con una baja reciente
                // el «menos» no se recomienda (noFreshUnder): entonces sale sólo la línea de la casa
                const pick = line ? picks.find(p => p.who?.id === r.playerId && p.marketKey === r.market && p.side === side && p.line === line.line) : undefined;
                return (
                  <div key={`${r.playerId}|${r.market}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-zinc-800/60 py-2 first:border-0 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto]">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-zinc-50">{r.name}</div>
                      <div className="text-[11px] text-zinc-500">{label} · <span className="text-zinc-300">{r.nWithout} partidos sin él</span></div>
                    </div>
                    <div className="text-[13px] tabular-nums text-zinc-400" title={`Minutos: ${dec1(r.minWith)} con él, ${dec1(r.minWithout)} sin él (${r.nWith} y ${r.nWithout} partidos)`}>
                      {dec1(r.withAvg)} con él → <span className={cn('text-[15px] font-bold', up ? 'text-emerald-400' : 'text-rose-300')}>{dec1(r.withoutAvg)}</span> sin él
                    </div>
                    <div className="col-span-2 text-xs text-zinc-400 sm:col-span-1">
                      {pick ? <>Sharpex: <span className="text-zinc-200">{pick.side === 'over' ? 'más' : 'menos'} de {decLine(pick.line)}</span> · <span className="font-semibold text-zinc-100">{p0(pick.p)}</span> · <span className={cn('font-semibold', hasValue(pick) ? 'text-emerald-400' : pick.ev > 0 ? 'text-zinc-200' : 'text-rose-300')}>{signed(pick.ev)}</span></>
                        : line ? <>Línea de la casa: más de <span className="text-zinc-200">{decLine(line.line)}</span></> : 'Las casas aún no tienen su línea'}
                    </div>
                    {pick ? (
                      <button type="button" onClick={() => onAdd(pick)} title="Añadir al cupón" aria-label={`Añadir ${pick.title} al cupón`}
                        className={cn('row-start-1 col-start-2 flex h-11 min-w-[72px] cursor-pointer flex-col items-center justify-center rounded-md px-2 sm:row-auto sm:col-auto', hasValue(pick) ? 'bg-[var(--tv-mark)] text-zinc-950' : 'bg-zinc-800 text-zinc-50 hover:bg-zinc-700')}>
                        <span className="flex items-center gap-0.5 text-[15px] font-bold tabular-nums"><Plus size={12} />{odd(pick.price)}</span>
                        <span className="text-[10px] font-medium">{pick.book}</span>
                      </button>
                    ) : line ? (
                      <span className="row-start-1 col-start-2 text-right text-xs text-zinc-400 sm:row-auto sm:col-auto"><span className="text-[15px] font-bold text-zinc-100">{odd(line.price)}</span><br />{line.book}</span>
                    ) : <span className="hidden sm:block" />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="px-3 pb-2.5 text-[11px] text-zinc-500">
        Medias de esta temporada en los partidos que jugó sin él. Con pocos partidos sin él, el cambio puede ser en parte suerte: la probabilidad de
        Sharpex sigue siendo la del modelo con la casa, que no sube por esto.
      </p>
    </div>
  );
}
