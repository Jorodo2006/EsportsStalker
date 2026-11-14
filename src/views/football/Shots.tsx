// Mapas de tiros del partido de fútbol: el de un jugador (medio campo) y el del partido.
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';
import type { FootballMatch, FootballShot, FootballTeam } from '@/lib/types';
import { TeamLogo, seg, segWrap } from '@/components/ui';
import { Panel } from '@/components/viz';
import { PITCH, PitchLines } from './Lineups';




// ---------- mapas de tiros ----------
const SHOT_ES: Record<FootballShot['kind'], string> = { goal: 'Gol', saved: 'Parado', off: 'Fuera', blocked: 'Bloqueado' };
// Metros hasta el centro de la portería (el campo, 105 x 68)
const shotDist = (s: FootballShot) => Math.round(Math.hypot((100 - s.x) * 1.05, (s.y - 50) * 0.68));
const shotText = (s: FootballShot, who?: boolean) =>
  `${s.minute} · ${SHOT_ES[s.kind]}${s.penalty ? ' (penalti)' : s.header ? ', de cabeza' : ''} · a ${shotDist(s)} m${who ? ` · ${s.player}` : ''}`;
const shotTally = (list: FootballShot[]) => {
  const goals = list.filter(s => s.kind === 'goal').length, on = list.filter(s => s.kind === 'goal' || s.kind === 'saved').length;
  return `${list.length} tiro${list.length === 1 ? '' : 's'} · ${on} a puerta · ${goals} gol${goals === 1 ? '' : 'es'}`;
};

// La marca de un tiro: círculo con el pie, cuadrado de cabeza. Gol, relleno del color del equipo; parado, blanco; fuera, sólo el
// borde; bloqueado, gris y pequeño. La línea va hasta donde llegó
function ShotMark({ s, from, to, color, r, delay, on, onHover }: {
  s: FootballShot; from: [number, number]; to: [number, number] | null; color: string; r: number; delay: number; on: boolean; onHover: (v: boolean) => void;
}) {
  const [cx, cy] = from;
  const R = s.kind === 'blocked' ? r * 0.7 : s.kind === 'goal' ? r * 1.25 : r;
  const fill = s.kind === 'goal' ? color : s.kind === 'saved' ? '#fafafa' : s.kind === 'blocked' ? '#71717a' : 'rgba(0,0,0,0.25)';
  const stroke = s.kind === 'goal' ? '#fafafa' : s.kind === 'saved' ? color : s.kind === 'blocked' ? 'none' : '#e4e4e7';
  const sw = r * 0.28;
  const lineColor = s.kind === 'goal' ? color : s.kind === 'blocked' ? '#71717a' : '#e4e4e7';
  return (
    <g onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className="cursor-pointer" opacity={on ? 1 : 0.9}>
      <title>{shotText(s, true)}</title>
      {to && (
        <line x1={cx} y1={cy} x2={to[0]} y2={to[1]} pathLength={1} className="shot-line" style={{ animationDelay: `${delay}s`, stroke: lineColor }}
          strokeWidth={on ? r * 0.32 : r * 0.18} strokeOpacity={on ? 0.95 : s.kind === 'goal' ? 0.7 : 0.35} strokeLinecap="round" />
      )}
      <g className="shot-mark" style={{ animationDelay: `${delay + 0.25}s` }}>
        {on && <circle cx={cx} cy={cy} r={R * 2} fill="none" stroke="#fafafa" strokeOpacity={0.5} strokeWidth={sw * 0.7} />}
        {s.header
          ? <rect x={cx - R} y={cy - R} width={R * 2} height={R * 2} rx={R * 0.3} style={{ fill, stroke }} strokeWidth={sw} />
          : <circle cx={cx} cy={cy} r={R} style={{ fill, stroke }} strokeWidth={sw} />}
        <circle cx={cx} cy={cy} r={R * 2.2} fill="transparent" />
      </g>
    </g>
  );
}

function ShotLegend({ color }: { color: string }) {
  const item = (svg: ReactNode, label: string) => <span className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>{svg}</svg>{label}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
      {item(<circle cx="6" cy="6" r="4.5" style={{ fill: color }} stroke="#fafafa" strokeWidth="1.2" />, 'Gol')}
      {item(<circle cx="6" cy="6" r="4" fill="#fafafa" style={{ stroke: color }} strokeWidth="1.2" />, 'Parado')}
      {item(<circle cx="6" cy="6" r="4" fill="none" stroke="#e4e4e7" strokeWidth="1.2" />, 'Fuera')}
      {item(<circle cx="6" cy="6" r="3" fill="#71717a" />, 'Bloqueado')}
      {item(<rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="#e4e4e7" strokeWidth="1.2" />, 'De cabeza')}
    </div>
  );
}

// Los goles en el acento de la app (el mismo para los dos equipos: en el mapa del partido ya los separa el lado del campo,
// y con el color de la camiseta un gol blanco se confundía con un tiro parado)
const GOAL_COLOR = 'var(--color-amber-400)';
const DEEP = 42; // metros desde la portería que enseña el mapa de un jugador: casi todos los tiros salen de ahí

// Los últimos 42 metros en vertical, con la portería arriba: los tiros de un jugador. La derecha del que tira es la derecha de la pantalla
export function HalfPitchShots({ shots }: { shots: FootballShot[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const at = (x: number, y: number): [number, number] => [(100 - y) * 0.68, Math.min(DEEP - 1, (100 - x) * 1.05)];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative overflow-hidden rounded-xl" style={{ background: PITCH }}>
        <svg viewBox={`-3 -5 74 ${DEEP + 6}`} className="block w-full">
          <g fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.35">
            <path d={`M0 ${DEEP + 1} V0 H68 V${DEEP + 1}`} />
            <rect x="13.84" y="0" width="40.32" height="16.5" /><rect x="24.84" y="0" width="18.32" height="5.5" />
            <path d="M26.69 16.5 A9.15 9.15 0 0 0 41.31 16.5" />
            <rect x="30.34" y="-2.4" width="7.32" height="2.4" stroke="rgba(255,255,255,0.45)" />
          </g>
          <circle cx="34" cy="11" r="0.45" fill="rgba(255,255,255,0.25)" />
          {shots.map((s, i) => (
            <ShotMark key={i} s={s} from={at(s.x, s.y)} to={s.x2 != null && s.y2 != null ? at(s.x2, s.y2) : null} color={GOAL_COLOR} r={1.45}
              delay={0.15 + i * 0.15} on={hover === i} onHover={v => setHover(v ? i : null)} />
          ))}
        </svg>
      </div>
      <div className="min-h-5 text-[13px] text-zinc-300 tnum">{hover != null ? shotText(shots[hover]) : <span className="text-zinc-500">{shotTally(shots)}. Pasa por encima de un tiro para verlo.</span>}</div>
      <ShotLegend color={GOAL_COLOR} />
    </div>
  );
}

// El campo entero con los tiros de los dos, cada uno en el lado de su nombre: el local ataca hacia la izquierda y el
// visitante hacia la derecha
export function MatchShotMap({ m, shots }: { m: FootballMatch; shots: FootballShot[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [only, setOnly] = useState<'all' | 'home' | 'away'>('all');
  const isHome = (s: FootballShot) => s.team === m.home.id;
  // Mirando a la izquierda, su derecha queda arriba; mirando a la derecha, abajo
  const at = (s: FootballShot, x: number, y: number): [number, number] => (isHome(s) ? [(100 - x) * 1.05, y * 0.68] : [x * 1.05, (100 - y) * 0.68]);
  const list = shots.map((s, i) => ({ s, i })).filter(({ s }) => only === 'all' || (only === 'home') === isHome(s));
  const side = (t: FootballTeam, mine: FootballShot[], right?: boolean) => (
    <div className={cn('flex min-w-0 items-center gap-2', right && 'flex-row-reverse text-right')}>
      <TeamLogo src={t.logo} name={t.abbr} size={20} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-zinc-50">{t.name}</div>
        <div className="truncate text-xs text-zinc-400 tnum">{shotTally(mine)}</div>
      </div>
    </div>
  );
  return (
    <Panel title={
      <span className="flex items-center justify-between gap-2">
        Mapa de tiros
        <span className={segWrap}>
          {([['all', 'Todos'], ['home', m.home.abbr || m.home.name], ['away', m.away.abbr || m.away.name]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setOnly(v)} className={seg(only === v)}>{label}</button>
          ))}
        </span>
      </span>
    }>
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-4">{side(m.home, shots.filter(isHome))}{side(m.away, shots.filter(s => !isHome(s)), true)}</div>
        <div className="relative aspect-[105/68] w-full overflow-hidden rounded-xl" style={{ background: PITCH }}>
          <PitchLines horizontal />
          <svg viewBox="0 0 105 68" className="absolute inset-0 h-full w-full">
            {list.map(({ s, i }, k) => (
              <ShotMark key={`${only}-${i}`} s={s} from={at(s, s.x, s.y)} to={s.x2 != null && s.y2 != null ? at(s, s.x2, s.y2) : null}
                color={GOAL_COLOR} r={1.05} delay={k * 0.05} on={hover === i} onHover={v => setHover(v ? i : null)} />
            ))}
          </svg>
        </div>
        <div className="min-h-5 text-[13px] text-zinc-300 tnum">{hover != null ? shotText(shots[hover], true) : <span className="text-zinc-500">Pasa por encima de un tiro para ver quién lo hizo, cuándo y desde dónde.</span>}</div>
        <ShotLegend color={GOAL_COLOR} />
      </div>
    </Panel>
  );
}
