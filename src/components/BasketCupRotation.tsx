// Partidos de la NBA Cup: cómo reparte los minutos cada entrenador en la Cup frente a la liga (src/lib/basket-cup.ts), esta
// temporada, jugador a jugador. La temporada pasada no: los registros del equipo sólo traen a los de la plantilla de hoy, y sin los
// que se fueron sus minutos no cuadran. Es para leer: no cambia la probabilidad
import { cn } from '@/lib/format';
import { cupRotation, type CupTeam } from '@/lib/basket-cup';
import type { BasketGame, BasketTeamLogs } from '@/lib/types';
import { TvBand } from './viz';

const d1 = (v: number) => v.toFixed(1).replace('.', ',');
const signed1 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}`;
const toneOf = (v: number) => (v >= 1 ? 'text-emerald-400' : v <= -1 ? 'text-rose-300' : 'text-zinc-300');

// La costumbre del equipo en una temporada, en una línea
function Habit({ t, label }: { t: CupTeam | null; label: string }) {
  if (!t?.cupGames) return null;
  return (
    <p className="text-xs text-zinc-400">
      {label} ({t.cupGames} {t.cupGames === 1 ? 'partido' : 'partidos'} de Cup):{' '}
      {t.top2 != null && <>sus 2 de más minutos <span className={cn('font-semibold tabular-nums', toneOf(t.top2))}>{signed1(t.top2)} min</span></>}
      {t.bench != null && <> · banquillo <span className={cn('font-semibold tabular-nums', toneOf(t.bench))}>{signed1(t.bench)} min</span></>}
      {t.rotCup != null && <> · {d1(t.rotCup)} jugadores con 10+ min (en la liga, {d1(t.rotLeague)})</>}
    </p>
  );
}

export function BasketCupRotation({ game, logsOf }: { game: BasketGame; logsOf: (g: BasketGame, side: 'away' | 'home') => BasketTeamLogs | undefined }) {
  if (!game.cup) return null;
  const sides = (['away', 'home'] as const).map(side => {
    const data = logsOf(game, side);
    return { side, team: game[side], now: cupRotation(data, game[side].id, game.date) };
  });
  if (!sides.some(s => s.now)) return null;
  return (
    <div className="border-t border-white/10">
      <TvBand>NBA Cup: cómo rota cada equipo</TvBand>
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        {sides.map(s => (
          <div key={s.side} className="flex min-w-0 flex-col gap-2 px-3 py-3">
            <div className="text-[13px] font-semibold text-zinc-100">{s.team.name}</div>
            <Habit t={s.now} label="Esta temporada" />
            {s.now?.cupGames ? (
              <div className="flex flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] gap-2 pb-1 text-[11px] text-zinc-500">
                  <span>jugador</span><span className="text-right">liga</span><span className="text-right">Cup</span><span className="text-right">cambio</span>
                </div>
                {s.now.players.map(p => {
                  const dlt = p.cup == null ? null : p.cup - p.league;
                  return (
                    <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] items-center gap-2 border-t border-zinc-800/60 py-1 text-[13px] tabular-nums">
                      <span className="truncate text-zinc-200">{p.name}</span>
                      <span className="text-right text-zinc-400">{d1(p.league)}</span>
                      <span className="text-right text-zinc-100" title={p.nCup ? `${p.nCup} partidos de Cup` : 'No ha jugado en la Cup'}>{p.cup == null ? '–' : d1(p.cup)}</span>
                      <span className={cn('text-right font-semibold', dlt == null ? 'text-zinc-500' : toneOf(dlt))}>{dlt == null ? 'no jugó' : signed1(dlt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-zinc-500">Aún no ha jugado partidos de Cup esta temporada.</p>}
          </div>
        ))}
      </div>
      <p className="px-3 pb-2.5 text-[11px] text-zinc-500">
        Minutos de media en los partidos que jugó (los que se perdió no cuentan: eso son lesiones, no decisiones del entrenador). En toda la NBA (dos temporadas), en la fase de grupos las estrellas juegan algo
        más pero no producen más, y el banquillo produce menos; en la eliminatoria se acorta la rotación. Con tan pocos partidos de Cup no
        se ha podido demostrar que meterlo en la probabilidad la mejore: Sharpex no lo usa en sus cifras.
      </p>
    </div>
  );
}
