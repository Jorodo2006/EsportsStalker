// Alineaciones del partido de fútbol: el campo con los dos onces y el banquillo.
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/format';
import type { FootballDetail, FootballEvent } from '@/lib/types';
import { FootballIcon, themeOf } from '@/components/football';
import { Empty, TeamLogo, panelCls } from '@/components/ui';
import { Panel } from '@/components/viz';
import { PlayerStatsDialog, type Selected } from './PlayerStats';
import { baseOf, posEs, type LineupPlayer } from './shared';
import { Card } from './MatchHeader';





// ---------- alineaciones ----------
// El campo entero con los dos onces: en horizontal desde lg (local a la izquierda) y en vertical por debajo (local abajo).
// Cada jugador es un círculo del color de su equipo con el dorsal y el apellido debajo: ESPN casi no tiene fotos de
// futbolistas (la mayoría dan 404), y un campo medio con fotos y medio con huecos se ve peor. Encima, lo que hizo en el
// partido (goles, tarjetas y el minuto en que lo cambiaron), sacado del resumen.

// Profundidad de cada posición de ESPN (0 portero, 5 delantero) para repartir el once en las líneas de la formación
const DEPTH: Record<string, number> = {
  G: 0, GK: 0, SW: 1, CB: 1, CD: 1, RB: 1, LB: 1, D: 1, RWB: 1.5, LWB: 1.5, WB: 1.5, DM: 2, CDM: 2,
  CM: 3, M: 3, LM: 3, RM: 3, AM: 4, CAM: 4, RW: 4.5, LW: 4.5, W: 4.5, SS: 4.6, F: 5, CF: 5, ST: 5, S: 5, FW: 5
};
const depthOf = (p: LineupPlayer) => DEPTH[baseOf(p.pos)] ?? 3;
// Lado, mirando hacia la portería rival: los de banda ("LB", "RM", "LW") ±2, por fuera de los de "-L"/"-R" ("CD-L",
// "AM-R") ±1, y el centro 0. Así el lateral derecho queda por fuera del central derecho
const sideOf = (p: LineupPlayer) => {
  const pos = p.pos.toUpperCase(), base = baseOf(pos);
  const wing = base.length > 1 && base in DEPTH ? (base[0] === 'L' ? -2 : base[0] === 'R' ? 2 : 0) : 0;
  return wing || (/-L$/.test(pos) ? -1 : /-R$/.test(pos) ? 1 : 0);
};

// Las líneas del once, de atrás adelante y cada una de izquierda a derecha: el portero y luego tantos como diga la
// formación ("4-2-3-1"), por orden de profundidad; si la formación no cuadra, una línea por cada profundidad
function linesOf(players: LineupPlayer[], formation: string): LineupPlayer[][] {
  const xi = players.filter(p => p.starter);
  const keeper = xi.find(p => depthOf(p) === 0) ?? [...xi].sort((x, y) => (x.place ?? 99) - (y.place ?? 99))[0];
  if (!keeper) return [];
  const rest = xi.filter(p => p !== keeper).sort((x, y) => depthOf(x) - depthOf(y) || (x.place ?? 99) - (y.place ?? 99));
  const counts = formation.split('-').map(Number).filter(n => n > 0);
  let lines: LineupPlayer[][] = [];
  if (counts.length && counts.reduce((s, n) => s + n, 0) === rest.length) {
    let i = 0;
    for (const n of counts) { lines.push(rest.slice(i, i + n)); i += n; }
  } else {
    const byDepth = new Map<number, LineupPlayer[]>();
    for (const p of rest) byDepth.set(depthOf(p), [...(byDepth.get(depthOf(p)) ?? []), p]);
    lines = [...byDepth.values()];
  }
  return [[keeper], ...lines.map(l => [...l].sort((x, y) => sideOf(x) - sideOf(y) || (x.place ?? 99) - (y.place ?? 99)))];
}

// Sitio de cada jugador en su mitad: depth de 0 (su portería) a 0.5 (el medio campo) y x de 0 (su izquierda) a 1
function spotsOf(lines: LineupPlayer[][]) {
  const out: { p: LineupPlayer; depth: number; x: number }[] = [];
  const outfield = lines.length - 1;
  lines.forEach((line, k) => {
    const depth = k === 0 ? 0.05 : outfield === 1 ? 0.3 : 0.17 + ((k - 1) * (0.44 - 0.17)) / (outfield - 1);
    const gap = line.length > 1 ? Math.min(0.24, 0.8 / line.length) : 0;
    line.forEach((p, j) => out.push({ p, depth, x: 0.5 + (j - (line.length - 1) / 2) * gap }));
  });
  return out;
}

// "Randal Kolo Muani" → "Kolo Muani"; "Bremer" se queda igual
const surname = (name: string) => name.trim().split(/\s+/).slice(1).join(' ') || name;

// Lo que hizo cada jugador, por su nombre en el resumen: goles (sin los de en propia), tarjeta más grave y minutos del cambio
function deedsOf(timeline: FootballEvent[]) {
  const out = new Map<string, { goals: number; card: 'yellow' | 'red' | null; off: string | null; on: string | null }>();
  const get = (name: string) => { if (!out.has(name)) out.set(name, { goals: 0, card: null, off: null, on: null }); return out.get(name)!; };
  for (const e of timeline) {
    if (!e.player) continue;
    if (e.kind === 'goal' || e.kind === 'penalty') get(e.player).goals++;
    if (e.kind === 'yellow' && !get(e.player).card) get(e.player).card = 'yellow';
    if (e.kind === 'red') get(e.player).card = 'red';
    if (e.kind === 'sub') { get(e.player).on = e.minute; if (e.other) get(e.other).off = e.minute; }
  }
  return out;
}

// Líneas del campo (medidas reales, 68 x 105 m) en vertical; en horizontal se gira el mismo dibujo. Con las franjas del
// corte del césped (bandas planas, una sí y otra no un poco más claras, sin degradados). bright: franjas y líneas más
// marcadas, para el campo de las alineaciones
export function PitchLines({ horizontal, bright }: { horizontal?: boolean; bright?: boolean }) {
  return (
    <svg viewBox={horizontal ? '0 0 105 68' : '0 0 68 105'} className="absolute inset-0 h-full w-full" aria-hidden>
      <g transform={horizontal ? 'matrix(0 1 -1 0 105 0)' : undefined} fill={bright ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.028)'} stroke="none">
        {Array.from({ length: 7 }, (_, k) => <rect key={k} x="0" y={(k * 2 + 1) * 7} width="68" height="7" />)}
      </g>
      <g transform={horizontal ? 'matrix(0 1 -1 0 105 0)' : undefined} fill="none" stroke={bright ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)'} strokeWidth={bright ? 0.3 : 0.35}>
        <rect x="1" y="1" width="66" height="103" />
        <line x1="1" y1="52.5" x2="67" y2="52.5" />
        <circle cx="34" cy="52.5" r="9.15" />
        <rect x="13.84" y="1" width="40.32" height="16.5" />
        <rect x="13.84" y="87.5" width="40.32" height="16.5" />
        <rect x="24.84" y="1" width="18.32" height="5.5" />
        <rect x="24.84" y="98.5" width="18.32" height="5.5" />
        <path d="M26.69 17.5 A9.15 9.15 0 0 0 41.31 17.5" />
        <path d="M26.69 87.5 A9.15 9.15 0 0 1 41.31 87.5" />
        <g fill="rgba(255,255,255,0.16)" stroke="none">
          <circle cx="34" cy="52.5" r="0.6" /><circle cx="34" cy="12" r="0.5" /><circle cx="34" cy="93" r="0.5" />
        </g>
      </g>
    </svg>
  );
}

export const PITCH = '#16281e'; // verde muy apagado, plano: que el campo se reconozca sin chillar sobre el fondo oscuro
const PITCH_LINEUP = '#1b3a27'; // alineaciones: un verde que se vea como campo, con sus franjas


export function Lineups({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  // Jugador pulsado: se abren sus estadísticas del partido
  const [sel, setSel] = useState<Selected | null>(null);
  if (!d.lineups.length) return <Empty>{m.state === 'pre' ? 'Las alineaciones salen una hora antes del partido, más o menos.' : 'ESPN no tiene las alineaciones de este partido.'}</Empty>;
  const deeds = deedsOf(d.timeline);
  const teams = ([['home', m.home], ['away', m.away]] as const).map(([which, t]) => {
    const l = d.lineups.find(x => x.team === t.id);
    const theme = themeOf(t);
    return {
      which, t, l, spots: l ? spotsOf(linesOf(l.players, l.formation)) : [],
      // Dorsal en blanco sobre el color del equipo (la banda ya está oscurecida para que se lean letras blancas)
      fill: theme?.band ?? (which === 'home' ? '#d4d4d8' : '#3f3f46'), ink: theme ? '#fff' : which === 'home' ? '#18181b' : '#fafafa'
    };
  });

  // Círculo relleno del color del equipo con el dorsal en blanco (la banda ya está oscurecida para que se lea) y borde
  // blanco, que lo despega del césped aunque el equipo sea verde o negro
  const avatar = (team: typeof teams[number], p: LineupPlayer, size: string) => (
    <span className={cn('grid place-items-center rounded-full border-2 border-white font-extrabold tnum', size)} style={{ background: team.fill, color: team.ink }}>
      {p.number || ''}
    </span>
  );

  const node = (team: typeof teams[number], s: typeof team.spots[number], horizontal: boolean) => {
    const home = team.which === 'home';
    // Vertical: local abajo atacando hacia arriba (su izquierda es la izquierda); visitante arriba, al revés.
    // Horizontal: local a la izquierda atacando a la derecha (su izquierda queda arriba); visitante a la derecha, al revés
    const pos = horizontal
      ? { left: `${(home ? s.depth : 1 - s.depth) * 100}%`, top: `${(home ? s.x : 1 - s.x) * 100}%` }
      : { left: `${(home ? s.x : 1 - s.x) * 100}%`, top: `${(home ? 1 - s.depth : s.depth) * 100}%` };
    const did = deeds.get(s.p.name);
    return (
      <button type="button" key={team.which + (s.p.id || s.p.name)} onClick={() => setSel({ p: s.p, t: team.t, fill: team.fill, ink: team.ink })}
        className="group absolute flex w-[72px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-1 lg:w-[104px]" style={pos}
        title={`${s.p.name} · ${posEs(s.p.pos) || s.p.pos}${did?.off ? ` · cambiado en el ${did.off}` : ''}. Clic: sus estadísticas del partido`}>
        <span className="relative transition-transform group-hover:scale-110">
          {avatar(team, s.p, 'h-9 w-9 text-sm lg:h-12 lg:w-12 lg:text-lg')}
          {!!did?.goals && (
            <span className="absolute -left-2 -top-1 flex items-center gap-px rounded-full bg-zinc-50 px-0.5 text-zinc-900 ring-1 ring-black/30">
              <FootballIcon size={11} />{did.goals > 1 && <span className="text-[9px] font-bold leading-none">{did.goals}</span>}
            </span>
          )}
          {did?.card && <span className="absolute -right-1 -top-1"><Card red={did.card === 'red'} /></span>}
          {did?.off && (
            <span className="absolute -bottom-1 -right-3.5 flex items-center rounded bg-zinc-950/90 px-0.5 text-[9px] font-semibold leading-tight text-rose-300 tnum">
              <ArrowDown size={8} />{did.off.replace(/'/g, '')}
            </span>
          )}
        </span>
        <span className="max-w-full truncate px-0.5 text-[11px] font-bold leading-tight text-white lg:text-[13px]" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>{surname(s.p.name)}</span>
      </button>
    );
  };

  const label = (team: typeof teams[number], right?: boolean) => (
    <div className={cn('flex min-w-0 items-center gap-2', right && 'flex-row-reverse text-right')}>
      <TeamLogo src={team.t.logo} name={team.t.abbr} size={20} />
      <span className="truncate text-[13px] font-semibold text-zinc-50">{team.t.name}</span>
      {team.l?.formation && <span className="shrink-0 text-xs text-zinc-400 tnum">{team.l.formation}</span>}
    </div>
  );
  const [home, away] = teams;

  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn(panelCls, 'overflow-hidden p-3 sm:p-4')}>
        <div className="hidden items-center justify-between gap-4 pb-3 lg:flex">{label(home)}{label(away, true)}</div>
        <div className="pb-3 lg:hidden">{label(away)}</div>
        <div className="relative mx-auto hidden aspect-[105/68] w-full overflow-hidden rounded-xl lg:block" style={{ background: PITCH_LINEUP }}>
          <PitchLines horizontal bright />
          {teams.map(t => t.spots.map(s => node(t, s, true)))}
        </div>
        <div className="relative mx-auto aspect-[68/105] w-full max-w-md overflow-hidden rounded-xl lg:hidden" style={{ background: PITCH_LINEUP }}>
          <PitchLines bright />
          {teams.map(t => t.spots.map(s => node(t, s, false)))}
        </div>
        <div className="pt-3 lg:hidden">{label(home)}</div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {teams.map(team => {
          const bench = (team.l?.players ?? []).filter(p => !p.starter)
            .sort((x, y) => Number(y.subIn) - Number(x.subIn) || parseInt(deeds.get(x.name)?.on ?? '999') - parseInt(deeds.get(y.name)?.on ?? '999'));
          if (!bench.length) return null;
          return (
            <Panel key={team.which} title={<span className="flex items-center gap-2"><TeamLogo src={team.t.logo} name={team.t.abbr} size={18} />Suplentes de {team.t.short || team.t.name}</span>}>
              <div className="divide-y divide-zinc-800/60">
                {bench.map(p => {
                  const did = deeds.get(p.name);
                  // Sólo los que entraron tienen estadísticas
                  return (
                    <button type="button" key={p.id || p.name} disabled={!p.subIn} onClick={() => setSel({ p, t: team.t, fill: team.fill, ink: team.ink })}
                      title={p.subIn ? 'Sus estadísticas del partido' : 'No llegó a jugar'}
                      className="flex h-9 w-full items-center gap-3 px-4 text-left text-[13px] enabled:cursor-pointer enabled:hover:bg-zinc-900">
                      {p.subIn
                        ? <span className="shrink-0">{avatar(team, p, 'h-7 w-7 text-[11px]')}</span>
                        : <span className="grid h-7 w-7 shrink-0 place-items-center text-[11px] font-bold text-zinc-500 tnum">{p.number}</span>}
                      <span className={cn('min-w-0 flex-1 truncate', p.subIn ? 'text-zinc-100' : 'text-zinc-500')}>{p.name}</span>
                      {!!did?.goals && <span className="flex shrink-0 items-center gap-0.5 text-zinc-200"><FootballIcon size={12} />{did.goals > 1 && <span className="text-xs">{did.goals}</span>}</span>}
                      {did?.card && <Card red={did.card === 'red'} />}
                      {p.subIn && <span className="flex shrink-0 items-center gap-0.5 text-xs text-emerald-300 tnum" title="Entró desde el banquillo"><ArrowUp size={12} />{did?.on ?? ''}</span>}
                      <span className="w-10 shrink-0 text-right text-xs text-zinc-500" title={p.pos}>{posEs(p.pos)}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          );
        })}
      </div>
      <PlayerStatsDialog key={sel?.p.id || sel?.p.name || 'nadie'} sel={sel} matchId={m.id} shots={d.shots ?? []} live={m.state === 'in'} onClose={() => setSel(null)} />
    </div>
  );
}
