// Contexto de un jugador antes de apostar: si viene de lesión o lleva partidos sin jugar, el descanso de los dos equipos
// (B2B, 3 en 4 noches), cómo rinde él en B2B, si le están dando más o menos minutos y las bajas de su equipo.
// El modelo sólo usa lo que se ha medido que importa (B2B y vuelta de baja, en basket-context.ts y CTX_FACTORS); el resto
// es información
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import { BASKET_MARKETS, fmtLine, type BasketMarket } from '@/lib/basket-model';
import type { BasketAbsence, BasketGame, BasketInjury, BasketLogGame, BasketRest } from '@/lib/types';
import { Card } from './ui';

type Tone = 'bad' | 'good' | 'info';
type Fact = { label: string; text: string; tone: Tone; note?: string };

// Fecha del partido en Nueva York (la de la NBA) como número de día, para contar noches entre partidos
const nyDay = (iso: string) => {
  const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v: number | null) => (v == null ? '–' : v.toFixed(1).replace('.', ','));
const plural = (n: number, s: string, p = s + 's') => `${n} ${n === 1 ? s : p}`;

export const useRest = (game: BasketGame | null | undefined) => useQuery({
  queryKey: ['basket', 'rest', game?.id], enabled: !!game && (game.league === 'nba' || game.league === 'wnba'),
  queryFn: () => window.api.basket.rest(game!.id, game!.home.id, game!.away.id), staleTime: 30 * 60e3
});

// "B2B fuera (ayer en SA)", "3.º partido en 4 noches", "1 día de descanso"
export function restText(r: BasketRest, home: boolean) {
  if (r.days == null) return { text: 'Primer partido de la temporada', tone: 'info' as Tone };
  const where = r.prev ? ` (ayer ${r.prev.home ? 'en casa contra' : 'en'} ${r.prev.opp})` : '';
  // Neutro, no malo: medido con dos temporadas, en el segundo de un B2B los jugadores rinden igual o algo más de lo
  // proyectado (scripts/backtest-basket.ts)
  if (r.b2b) return { text: `Segundo partido seguido, B2B${home ? '' : ' y fuera'}${where}`, tone: 'info' as Tone };
  if (r.in4 >= 3) return { text: `${r.in4}.º partido en 4 noches`, tone: 'info' as Tone };
  return { text: r.days >= 3 ? `${r.days} días de descanso` : plural(r.days, 'día de descanso', 'días de descanso'), tone: (r.days >= 2 ? 'good' : 'info') as Tone };
}

// Partidos de su equipo esta temporada, jugados y no jugados, de más reciente a más antiguo
function teamRun(games: BasketLogGame[], missed: BasketAbsence[], season: number, before: number) {
  const played = games.filter(g => g.season === season && g.type !== 'pre' && +new Date(g.date) < before).map(g => ({ t: +new Date(g.date), g, out: null as BasketAbsence | null }));
  const out = missed.filter(m => +new Date(m.date) < before).map(m => ({ t: +new Date(m.date), g: null as BasketLogGame | null, out: m }));
  return [...played, ...out].sort((a, b) => b.t - a.t);
}

export function BasketContext({ games, missed = [], season, game, teamId, playerId, injuries, market, line }: {
  games: BasketLogGame[]; missed?: BasketAbsence[]; season: number; game: BasketGame | null; teamId?: string; playerId: string;
  injuries: BasketInjury[]; market: BasketMarket; line: number | null;
}) {
  const rest = useRest(game);
  const M = BASKET_MARKETS[market];
  const facts: Fact[] = [];

  // Parte médico de ESPN
  const inj = injuries.find(i => i.playerId === playerId);
  if (inj) facts.push({ label: 'Parte médico', text: `${inj.status}${inj.detail ? `: ${inj.detail}` : ''}`, tone: /out|doubt/i.test(inj.status) ? 'bad' : 'info', note: inj.returnDate ? `Vuelta prevista: ${new Date(inj.returnDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : undefined });

  // Lesión: los partidos de su equipo que no jugó, seguidos. Si los últimos son ausencias, sigue fuera; si volvió hace
  // poco, cuántos lleva y con cuántos minutos (al volver suelen ir con restricción)
  // Sólo lo anterior al partido que se mira (sin partido, hasta hoy)
  const run = teamRun(games, missed, season, game ? +new Date(game.date) : Date.now() + 864e5);
  let i = 0;
  while (i < run.length && run[i].out) i++;
  if (i > 0) {
    facts.push({ label: 'Sin jugar', text: `No ha jugado los últimos ${plural(i, 'partido')} de su equipo`, tone: 'bad', note: run[0].out!.reason });
  } else {
    let p = 0;
    while (p < run.length && run[p].g) p++;
    let m = 0;
    while (p + m < run.length && run[p + m].out) m++;
    const why = run[p]?.out?.reason ?? '';
    const injured = /lesi|enferm/i.test(why);
    if (m && p <= 6 && (m >= 2 || injured)) {
      const since = run.slice(0, p).map(x => x.g!.min);
      const prior = games.filter(g => g.season === season && g.type !== 'pre' && +new Date(g.date) < run[p + m - 1].t).map(g => g.min);
      const a = mean(since), b = mean(prior);
      facts.push({
        label: injured ? 'Vuelve de lesión' : 'Vuelve',
        text: `${p === 1 ? 'Su primer partido' : `${p} partidos`} desde que volvió tras perderse ${plural(m, 'partido')}`,
        tone: a != null && b != null && a < b - 3 ? 'bad' : 'info',
        note: `${why}${a != null ? ` · ${f1(a)} min desde la vuelta${b != null ? ` frente a ${f1(b)} antes` : ''}` : ''}`
      });
    }
  }

  // Descanso de los dos equipos
  const r = rest.data;
  if (game && r && teamId) {
    const home = game.home.id === teamId;
    const mine = home ? r.home : r.away, theirs = home ? r.away : r.home;
    const rival = home ? game.away.abbr : game.home.abbr;
    if (mine) {
      const t = restText(mine, home);
      facts.push({
        label: 'Su equipo', text: t.text, tone: t.tone,
        note: mine.b2b ? 'Medido en dos temporadas: en B2B se rinde igual o algo más de lo previsto (quien juega está sano)'
          : mine.nextB2b ? 'Mañana vuelve a jugar: a veces se reparten minutos' : undefined
      });
    }
    if (theirs) {
      const t = restText(theirs, !home);
      facts.push({ label: rival, text: t.text, tone: 'info' });
    }
  }

  // Él en B2B: el partido de justo después de otro, frente a los que tuvo descanso (esta temporada y la anterior)
  const pool = games.filter(g => g.type !== 'pre' && g.season >= season - 1);
  const b2b: BasketLogGame[] = [], rested: BasketLogGame[] = [];
  pool.forEach((g, k) => { const prev = pool[k + 1]; if (prev) (nyDay(g.date) - nyDay(prev.date) === 1 ? b2b : rested).push(g); });
  if (b2b.length >= 3) {
    const avg = (xs: BasketLogGame[]) => mean(xs.map(M.f));
    const hit = (xs: BasketLogGame[]) => (line == null || !xs.length ? null : xs.filter(g => M.f(g) > line).length / xs.length);
    const a = avg(b2b), b = avg(rested), ha = hit(b2b), hb = hit(rested);
    const worse = a != null && b != null && b > 0 && a < b * 0.92, better = a != null && b != null && b > 0 && a > b * 1.08;
    facts.push({
      label: 'Él en B2B', tone: worse ? 'bad' : better ? 'good' : 'info',
      text: `${f1(a)} ${M.short} en B2B (${b2b.length}) frente a ${f1(b)} con descanso (${rested.length})`,
      note: [ha != null && hb != null ? `Más de ${fmtLine(line!)}: ${Math.round(ha * 100)} % en B2B, ${Math.round(hb * 100)} % con descanso` : '', `${f1(mean(b2b.map(g => g.min)))} min en B2B frente a ${f1(mean(rested.map(g => g.min)))}`].filter(Boolean).join(' · ')
    });
  }

  // Minutos: los 5 últimos frente a su media de la temporada (un cambio de rol pesa más que cualquier racha)
  const cur = games.filter(g => g.season === season && g.type !== 'pre');
  if (cur.length >= 8) {
    const l5 = mean(cur.slice(0, 5).map(g => g.min))!, all = mean(cur.map(g => g.min))!;
    if (Math.abs(l5 - all) >= 3) facts.push({ label: 'Minutos', text: `${f1(l5)} min en los 5 últimos frente a ${f1(all)} de media`, tone: l5 > all ? 'good' : 'bad', note: l5 > all ? 'Le están dando más minutos' : 'Le están dando menos minutos' });
  }

  // Bajas de su equipo: más balones y minutos para los demás
  const outs = injuries.filter(x => x.teamId === teamId && x.playerId !== playerId && /out/i.test(x.status));
  if (outs.length) facts.push({ label: 'Bajas de su equipo', text: outs.map(x => x.name).join(', '), tone: 'info', note: 'Más balones y minutos para el resto' });

  if (!facts.length) return null;
  return (
    <Card title="Contexto" action={<span className="text-[11px] text-zinc-500">B2B y vuelta de baja ya cuentan en la proyección</span>}>
      <div className="-my-1 divide-y divide-zinc-800/60">
        {facts.map(f => (
          <div key={f.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 text-[13px] sm:grid-cols-[9rem_minmax(0,1fr)]">
            <span className="text-zinc-500">{f.label}</span>
            <div className="min-w-0">
              <div className={cn('font-medium', f.tone === 'bad' ? 'text-rose-300' : f.tone === 'good' ? 'text-emerald-300' : 'text-zinc-200')}>{f.text}</div>
              {f.note && <div className="text-xs text-zinc-500">{f.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
