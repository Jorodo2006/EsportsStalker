// «Sin X»: cuando un habitual no juega (parte de ESPN o una noticia), qué han hecho sus compañeros esta temporada sin él, al lado
// de la línea de las casas y de lo que dice Sharpex de esa línea (src/lib/basket-without.ts). Es un dato para leer: la probabilidad
// sigue siendo la del modelo, que no sube por esto (no se ha medido que las bajas de compañeros mejoren la proyección)
import { useState } from 'react';
import { ChevronDown, Newspaper, Plus } from 'lucide-react';
import { cn, odd } from '@/lib/format';
import { BASKET_MARKETS, playerOut } from '@/lib/basket-model';
import { hasValue, pickVerdict, type BasketPick } from '@/lib/basket-picks';
import { VERDICT_LABEL } from '@/lib/value';
import { keyAbsentee, withoutSplits, type WithoutRow } from '@/lib/basket-without';
import { ageOf } from '@/lib/slip-live';
import type { BasketGame, BasketInjury, BasketSide, BasketTeamLogs, MatchOdds } from '@/lib/types';
import { Badge } from './ui';
import { OpenHint, PickAvatar, p0, signed } from './PickParts';

const OPEN_KEY = 'basket-without-open';
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

interface Absent { game: BasketGame; team: BasketSide; teamName: string; name: string; injury: BasketInjury | null; rows: (WithoutRow & { headshot?: string })[] }
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
        if (rows.length) out.push({ game: g, team, teamName: team.name, name: p.name, injury: inj, rows: rows.map(r => ({ ...r, headshot: data.players.find(q => q.id === r.playerId)?.headshot })) });
      }
    }
  }
  return out;
}

export function BasketWithout({ absents, picks, lines, oddsOf, onAdd, onOpen, oneGame }: {
  absents: Absent[]; picks: BasketPick[]; lines: BasketPick[]; oddsOf: (g: BasketGame) => MatchOdds | undefined;
  onAdd: (p: BasketPick) => void; onOpen: (p: BasketPick) => void; oneGame: boolean;
}) {
  // En la pantalla de recomendaciones va plegado (con varios partidos ocupaba más que las recomendaciones); en la ficha de un partido,
  // abierto. Lo que se elija en la pantalla se recuerda
  const [open, setOpen] = useState(() => { if (oneGame) return true; try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  if (!absents.length) return null;
  const toggle = () => { const v = !open; setOpen(v); if (!oneGame) { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } } };
  const mates = absents.reduce((n, a) => n + Math.min(SHOWN, a.rows.length), 0);
  return (
    <div className="border-t border-white/10">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[.04]">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-zinc-100">Bajas: quién gana minutos <span className="font-normal tnum text-zinc-500">{absents.length}</span></span>
          <span className="block truncate text-xs text-zinc-400">{absents.map(a => a.name.split(' ').at(-1)).join(', ')} no {absents.length === 1 ? 'juega' : 'juegan'} · {mates} {mates === 1 ? 'compañero' : 'compañeros'} con sus medias sin {absents.length === 1 ? 'él' : 'ellos'}</span>
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-zinc-500 transition', open && 'rotate-180')} />
      </button>
      {open && <>
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
                // El análisis de Sharpex de la línea principal de la casa: primero el lado hacia el que cambia sin él (si sube, el «más»;
                // si baja, el «menos») y, si ese no se calcula, el otro. En la NBA, con una baja reciente el «menos» no se recomienda
                // (noFreshUnder) y sale el «más» de esa línea. Primero las recomendaciones (llevan la noticia en la fiabilidad), luego el
                // resto de líneas calculadas: así toda cuota de la casa se puede llevar al cupón y abrir su análisis
                const want = up ? 'over' : 'under', other = up ? 'under' : 'over';
                const is = (x: BasketPick, s: string) => !!line && x.who?.id === r.playerId && x.marketKey === r.market && x.side === s && x.line === line.line;
                const pick = line ? picks.find(x => is(x, want)) ?? lines.find(x => is(x, want)) ?? picks.find(x => is(x, other)) ?? lines.find(x => is(x, other)) : undefined;
                const verdict = pick ? pickVerdict(pick) : null;
                const face = <PickAvatar photo={r.headshot} name={r.name} badge={a.team.logo} />;
                const who = (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-score text-[15px] font-semibold leading-[18px] text-zinc-50 transition group-hover:text-amber-300">{r.name}</span>
                    <span className="block text-[11px] text-zinc-500">{label} · <span className="text-zinc-300">{r.nWithout} partidos sin él</span></span>
                    {pick && <OpenHint text="Pulsa para ver su análisis" />}
                  </span>
                );
                return (
                  <div key={`${r.playerId}|${r.market}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-zinc-800/60 py-2.5 first:border-0 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_auto]">
                    {pick ? <button type="button" onClick={() => onOpen(pick)} title="Ver su análisis" className="group flex min-w-0 cursor-pointer items-center gap-2.5 text-left">{face}{who}</button>
                      : <div className="flex min-w-0 items-center gap-2.5">{face}{who}</div>}
                    <div className="col-span-2 pl-[50px] text-[13px] tabular-nums text-zinc-400 sm:col-span-1 sm:pl-0" title={`Minutos: ${dec1(r.minWith)} con él, ${dec1(r.minWithout)} sin él (${r.nWith} y ${r.nWithout} partidos)`}>
                      {dec1(r.withAvg)} con él → <span className={cn('text-[15px] font-bold', up ? 'text-emerald-400' : 'text-rose-300')}>{dec1(r.withoutAvg)}</span> sin él
                    </div>
                    <div className="col-span-2 min-w-0 pl-[50px] text-xs text-zinc-400 sm:col-span-1 sm:pl-0">
                      {pick ? <>
                        <span className="block">Sharpex: <span className="text-zinc-200">{pick.side === 'over' ? 'más' : 'menos'} de {decLine(pick.line)}</span> · <span className="font-semibold text-zinc-100">{p0(pick.p)}</span> · <span className={cn('font-semibold', hasValue(pick) ? 'text-emerald-400' : pick.ev > 0 ? 'text-zinc-200' : 'text-rose-300')}>{signed(pick.ev)}</span>{verdict && <> · <span className={verdict === 'BET' ? 'text-emerald-400' : 'text-zinc-300'}>{VERDICT_LABEL[verdict]}</span></>}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500" title={pick.why}>{pick.why}</span>
                      </> : line ? <>Línea de la casa: más de <span className="text-zinc-200">{decLine(line.line)}</span></> : 'Las casas aún no tienen su línea'}
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
      </>}
    </div>
  );
}
