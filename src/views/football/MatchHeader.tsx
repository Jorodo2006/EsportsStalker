// Cabecera de la ficha del partido de fútbol: marcador, goleadores y rojas, estadio y público.
import { type ReactNode } from 'react';
import { cn } from '@/lib/format';
import type { FootballEvent, FootballMatch, FootballTeam } from '@/lib/types';
import { LiveDot } from '@/components/sport';
import { FootballIcon, esTime, themeOf } from '@/components/football';
import { TeamLogo, panelCls } from '@/components/ui';
import { FavStar } from '@/components/Favorites';
import { stateOf } from './shared';


export const isGoal = (e: FootballEvent) => e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'owngoal';
export const goalNote = (e: FootballEvent) => (e.kind === 'penalty' ? ' (p.)' : e.kind === 'owngoal' ? ' (p.p.)' : '');

// "Fermín López" → "F. López"; los nombres de una palabra ("Gavi", "Pedri") se quedan igual
export const shortName = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length < 2 ? name : `${p[0][0]}. ${p.slice(1).join(' ')}`;
};

// Parte del partido de un minuto de ESPN ("45'+2'", "90'+5'", "105'"): 1 y 2 las partes, 3 la prórroga
const phaseOf = (minute: string) => {
  const base = parseInt(minute, 10);
  if (!isFinite(base)) return 0;
  return base <= 45 ? 1 : base <= 90 ? 2 : 3; // "90'+5'" es base 90: segunda parte
};

// Marcador tras cada gol (en propia puerta, ESPN lo apunta al equipo que se beneficia) y por partes
export function scoreLine(m: FootballMatch, events: FootballEvent[]) {
  let h = 0, a = 0, phase = 1;
  const after: ([number, number] | null)[] = [];
  const phases: number[] = [];
  const atEnd: Record<number, [number, number]> = {};
  for (const e of events) {
    phase = Math.max(phase, phaseOf(e.minute) || phase); // ESPN las da en orden: una parte nunca vuelve atrás
    if (isGoal(e)) { if (e.team === m.home.id) h++; else if (e.team === m.away.id) a++; }
    after.push(isGoal(e) ? [h, a] : null);
    phases.push(phase);
    atEnd[phase] = [h, a];
  }
  // Al descanso: lo que había al acabar la primera parte (o 0-0 si no pasó nada)
  const half = atEnd[1] ?? [0, 0];
  return { after, phases, half };
}

// ---------- cabecera del partido ----------
// Fondo neutro (sin teñir con los colores de los equipos, que se mezclan cuando los dos son rojos), escudos grandes
// encima del nombre, el marcador en el centro con el estado y el resultado al descanso, y los goleadores bajo su equipo
export function MatchHeader({ m, events, attendance, children }: { m: FootballMatch; events: FootballEvent[]; attendance: number | null; children: ReactNode }) {
  const st = stateOf(m);
  const hs = m.home.score ?? 0, as = m.away.score ?? 0;
  const lead = st === 'pre' || m.off || hs === as ? null : hs > as ? 'home' : 'away';
  const { phases, half } = scoreLine(m, events);
  const pastHalf = st === 'post' || phases.some(p => p >= 2) || /descanso|2.ª|segunda/i.test(m.status);
  const where = [m.venue && `${m.venue}${m.city ? `, ${m.city}` : ''}`, attendance ? `${attendance.toLocaleString('es-ES')} espectadores` : ''].filter(Boolean).join(' · ');

  const side = (t: FootballTeam, which: 'home' | 'away') => {
    // Goles por jugador ("F. López 45', 66'") y rojas
    const mine = events.filter(e => e.team === t.id && (isGoal(e) || e.kind === 'red'));
    const byPlayer = new Map<string, FootballEvent[]>();
    for (const e of mine) byPlayer.set(`${e.kind === 'red' ? 'r' : 'g'}|${e.player}`, [...(byPlayer.get(`${e.kind === 'red' ? 'r' : 'g'}|${e.player}`) ?? []), e]);
    const plate = themeOf(t)?.plate;
    return (
      <div className="flex min-w-0 flex-col items-center gap-2 text-center">
        <span className={cn('grid shrink-0 place-items-center', plate && 'rounded-xl bg-white/90 p-1.5')}>
          <TeamLogo src={t.logo} name={t.abbr} size={56} />
        </span>
        <div className="flex max-w-full items-center gap-0.5">
          <span className={cn('truncate text-sm font-semibold sm:text-lg', lead && lead !== which ? 'text-zinc-300' : 'text-zinc-50')} title={t.name}>{t.name}</span>
          <FavStar name={t.name} logo={t.logo} sport="football" />
        </div>
        {!!byPlayer.size && (
          <ul className="flex max-w-full flex-col gap-0.5 text-xs text-zinc-400">
            {[...byPlayer.values()].map(list => (
              <li key={list[0].kind + list[0].player} className="flex min-w-0 items-center justify-center gap-1.5">
                {list[0].kind === 'red' ? <Card red /> : <FootballIcon size={11} />}
                <span className="truncate">{shortName(list[0].player || '¿?')}{list.map(goalNote).find(Boolean) ?? ''} <span className="tnum text-zinc-500">{list.map(e => e.minute).join(', ')}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className={cn(panelCls, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-800 px-4 py-2.5 sm:px-5">
        <span className="text-[13px] font-semibold text-zinc-100">{m.leagueName}</span>
        {m.stage && <span className="text-xs text-zinc-500">{m.stage}</span>}
        {where && <span className="ml-auto min-w-0 truncate text-xs text-zinc-500" title={where}>{where}</span>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3 py-6 sm:gap-8 sm:px-8">
        {side(m.home, 'home')}
        <div className="flex flex-col items-center gap-2 pt-3">
          {st === 'pre' || m.off
            ? <span className="text-3xl font-semibold leading-none tnum text-zinc-100 sm:text-4xl">{m.off ? '–' : esTime(m.date)}</span>
            : (
              <div className="flex items-center gap-2 text-4xl font-semibold leading-none tracking-tight tnum sm:gap-3 sm:text-6xl">
                <span className={lead === 'away' ? 'text-zinc-400' : 'text-zinc-50'}>{hs}</span>
                <span className="text-2xl font-light text-zinc-600 sm:text-4xl">-</span>
                <span className={lead === 'home' ? 'text-zinc-400' : 'text-zinc-50'}>{as}</span>
              </div>
            )}
          {st === 'live'
            ? <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-300 tnum"><LiveDot />{m.status}</span>
            : st === 'post'
              ? <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">{m.off ? m.status : 'Final'}</span>
              : <span className="text-xs text-zinc-400 first-letter:uppercase">{new Date(m.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
          {st !== 'pre' && !m.off && pastHalf && <span className="text-[11px] text-zinc-500 tnum">Descanso {half[0]}-{half[1]}</span>}
        </div>
        {side(m.away, 'away')}
      </div>
      {children}
    </div>
  );
}

// Tarjeta amarilla o roja
export const Card = ({ red }: { red?: boolean }) => <span aria-hidden className={cn('inline-block h-3 w-2 shrink-0 rounded-[2px]', red ? 'bg-rose-500' : 'bg-yellow-400')} />;

export const EVENT_TEXT: Record<FootballEvent['kind'], string> = {
  goal: 'Gol', penalty: 'Gol de penalti', owngoal: 'Gol en propia puerta', missed: 'Penalti fallado', yellow: 'Amarilla', red: 'Roja', sub: 'Cambio'
};
