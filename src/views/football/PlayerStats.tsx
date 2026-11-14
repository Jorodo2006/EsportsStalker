// Ficha de un jugador en el partido de fútbol: sus estadísticas y sus tiros.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import type { FootballShot, FootballTeam } from '@/lib/types';
import { themeOf } from '@/components/football';
import { Dialog, Empty, Loading, TeamLogo } from '@/components/ui';
import { Panel } from '@/components/viz';
import { sized } from '@/lib/img';
import { baseOf, posEs, type LineupPlayer } from './shared';
import { HalfPitchShots } from './Shots';



// ---------- estadísticas de un jugador en el partido ----------
// Las da la API core de ESPN con sus nombres en inglés. Cada fila es un dato, o "acertados de intentados" con su porcentaje
type StatRow = { label: string; key: string; of?: string; dec?: number; signed?: boolean; plus?: string };
const STAT_GROUPS: { title: string; keeper?: boolean; rows: StatRow[] }[] = [
  {
    title: 'Ataque', rows: [
      { label: 'Goles', key: 'totalGoals' }, { label: 'Asistencias', key: 'goalAssists' },
      { label: 'Goles esperados (xG)', key: 'expectedGoals', dec: 2 }, { label: 'Tiros', key: 'totalShots' },
      { label: 'Tiros a puerta', key: 'shotsOnTarget' }, { label: 'Tiros fuera', key: 'shotsOffTarget' }, { label: 'Tiros al palo', key: 'shotsOnPost' },
      { label: 'Ocasiones claras falladas', key: 'bigChanceMissed' }, { label: 'Toques en el área rival', key: 'touchesInOppBox' },
      { label: 'Fueras de juego', key: 'offsides' }
    ]
  },
  {
    title: 'Regate y duelos', rows: [
      { label: 'Regates completados', key: 'wonContest', of: 'totalContest' }, { label: 'Conducciones progresivas', key: 'progressiveCarries' },
      { label: 'Duelos ganados', key: 'duelsWon', of: 'duels' }, { label: 'Duelos en el suelo ganados', key: 'groundDuelsWon', of: 'groundDuels' },
      { label: 'Duelos aéreos ganados', key: 'aerialsWon', of: 'aerialsWon', plus: 'aerialsLost' }, { label: 'Toques', key: 'touches' },
      { label: 'Pérdidas', key: 'turnover' }, { label: 'Faltas recibidas', key: 'foulsSuffered' }
    ]
  },
  {
    title: 'Defensa', rows: [
      { label: 'Entradas ganadas', key: 'effectiveTackles', of: 'totalTackles' }, { label: 'Intercepciones', key: 'interceptions' },
      { label: 'Tiros bloqueados', key: 'blockedShots' }, { label: 'Despejes', key: 'totalClearance' }, { label: 'Recuperaciones', key: 'ballRecovery' },
      { label: 'Balones ganados en campo rival', key: 'possWonAtt3rd' }, { label: 'Faltas cometidas', key: 'foulsCommitted' },
      { label: 'Amarillas', key: 'yellowCards' }, { label: 'Rojas', key: 'redCards' }, { label: 'Goles en propia puerta', key: 'ownGoals' }
    ]
  },
  {
    title: 'Pase', rows: [
      { label: 'Pases completados', key: 'accuratePasses', of: 'totalPasses' },
      { label: 'Pases en el último tercio', key: 'successfulFinalThirdPasses', of: 'totalFinalThirdPasses' },
      { label: 'Pases de tiro', key: 'shotAssists' }, { label: 'Ocasiones claras creadas', key: 'bigChanceCreated' },
      { label: 'Asistencias esperadas (xA)', key: 'expectedAssists', dec: 2 }, { label: 'Centros', key: 'accurateCrosses', of: 'totalCrosses' },
      { label: 'Balones largos', key: 'accurateLongBalls', of: 'totalLongBalls' }
    ]
  },
  {
    title: 'Portería', keeper: true, rows: [
      { label: 'Paradas', key: 'saves' }, { label: 'Tiros a puerta recibidos', key: 'shotsOnGoalAgainst' }, { label: 'Goles encajados', key: 'goalsConceded' },
      { label: 'Goles evitados', key: 'goalsPrevented', dec: 2, signed: true }, { label: 'Salidas fuera del área', key: 'accurateKeeperSweeper', of: 'totalKeeperSweeper' },
      { label: 'Centros atrapados', key: 'crossesCaught' }, { label: 'Despejes de puños', key: 'punches' },
      { label: 'Penaltis parados', key: 'penaltyKicksSaved', of: 'penaltyKicksFaced' }
    ]
  }
];
const fmtStat = (v: number, dec = 0, signed = false) => `${signed && v > 0 ? '+' : ''}${v.toFixed(dec).replace('.', ',')}`;

// Una fila de estadística. En las de "acertados de intentados", una barra con el porcentaje en el color del equipo
function StatLine({ row, s, color }: { row: StatRow; s: Record<string, number>; color: string }) {
  const v = s[row.key] ?? 0;
  const total = row.of ? (s[row.of] ?? 0) + (row.plus ? s[row.plus] ?? 0 : 0) : null;
  const zero = total != null ? total === 0 : v === 0;
  const share = total ? v / total : 0;
  return (
    <div className="flex h-8 items-center gap-3 px-4 text-[13px]">
      <span className={cn('min-w-0 flex-1 truncate', zero ? 'text-zinc-500' : 'text-zinc-300')}>{row.label}</span>
      {total != null && total > 0 && (
        <span className="flex items-center gap-2">
          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800 sm:block"><span className="bar-grow block h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} /></span>
          <span className="w-9 text-right text-xs text-zinc-400 tnum">{Math.round(share * 100)} %</span>
        </span>
      )}
      <span className={cn('min-w-10 text-right font-semibold tnum', zero ? 'text-zinc-600' : 'text-zinc-50')}>
        {total != null ? `${fmtStat(v)}/${fmtStat(total)}` : fmtStat(v, row.dec, row.signed)}
      </span>
    </div>
  );
}


// ---------- ficha del jugador en el partido ----------
// Cabecera teñida (plana) del color del equipo, con la foto y el dorsal grande de fondo; debajo, las cifras principales,
// su mapa de tiros y las estadísticas por grupos
export type Selected = { p: LineupPlayer; t: FootballTeam; fill: string; ink: string };

// live: el partido está en juego; entonces sus cifras se vuelven a pedir cada 30 s con la ficha abierta (los tiros ya llegan
// con la ficha del partido, que se refresca cada 20 s)
export function PlayerStatsDialog({ sel, matchId, shots, live, onClose }: { sel: Selected | null; matchId: string; shots: FootballShot[]; live: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['football', 'playerStats', matchId, sel?.t.id, sel?.p.id], enabled: !!sel?.p.id,
    queryFn: () => window.api.football.playerStats(matchId, sel!.t.id, sel!.p.id), staleTime: live ? 20e3 : 60e3, retry: false,
    refetchInterval: live ? 30_000 : false
  });
  const photo = useQuery({
    queryKey: ['football', 'photo', sel?.p.id || sel?.p.name], enabled: !!sel,
    queryFn: () => window.api.football.photo(sel!.p.id, sel!.p.name, sel!.t.name), staleTime: Infinity, retry: false
  });
  const [broken, setBroken] = useState(false);
  if (!sel) return null;
  const { p, t } = sel;
  const s = q.data ?? {};
  const keeper = baseOf(p.pos) === 'G' || baseOf(p.pos) === 'GK';
  const color = themeOf(t)?.mark ?? '#e4e4e7';
  const mine = shots.filter(x => x.player === p.name && x.team === t.id);
  const pic = !broken && photo.data?.url ? photo.data.url : null;
  // Lo principal arriba: para el portero, sus paradas; para el resto, goles, tiros y xG
  const kpis: [string, string, string?][] = [
    ['Minutos', s.minutes != null ? `${Math.round(s.minutes)}'` : '–'],
    ...(keeper
      ? [['Paradas', fmtStat(s.saves ?? 0)], ['Encajados', fmtStat(s.goalsConceded ?? 0)], ['Goles evitados', fmtStat(s.goalsPrevented ?? 0, 2, true)]] as [string, string][]
      : [['Goles', fmtStat(s.totalGoals ?? 0), (s.goalAssists ?? 0) ? `y ${fmtStat(s.goalAssists ?? 0)} asist.` : undefined],
        ['Tiros', fmtStat(s.totalShots ?? 0), `${fmtStat(s.shotsOnTarget ?? 0)} a puerta`], ['xG', fmtStat(s.expectedGoals ?? 0, 2), 'goles esperados']] as [string, string, string?][])
  ];
  const groups = STAT_GROUPS.filter(g => !g.keeper || keeper).sort((x, y) => Number(!!y.keeper) - Number(!!x.keeper));
  return (
    <Dialog open onClose={onClose} wide title={<span className="text-sm font-medium text-zinc-400">Su partido</span>}>
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center gap-4 overflow-hidden rounded-xl p-4 sm:gap-5 sm:p-5" style={{ background: `color-mix(in oklab, ${sel.fill} 38%, #18181b)` }}>
          <span aria-hidden className="pointer-events-none absolute -right-2 -top-6 hidden select-none text-[150px] font-black leading-none text-white/[0.07] tnum sm:block">{p.number}</span>
          {pic ? (
            <span className="relative shrink-0">
              <img loading="lazy" decoding="async" src={sized(pic, 96)} alt={p.name} onError={() => setBroken(true)} className="h-20 w-20 rounded-xl bg-zinc-900 object-cover object-top ring-1 ring-white/15 sm:h-24 sm:w-24" />
              {photo.data?.from === 'Wikipedia' && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] text-zinc-300">Wikipedia</span>}
            </span>
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl text-3xl font-bold ring-1 ring-white/15 tnum sm:h-24 sm:w-24" style={{ background: sel.fill, color: sel.ink }}>{p.number}</span>
          )}
          <div className="relative min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-zinc-300">
              <span className="grid shrink-0 place-items-center rounded bg-white/90 p-px"><TeamLogo src={t.logo} name={t.abbr} size={16} /></span>
              <span className="truncate">{t.name}</span>
            </div>
            <div className="truncate text-xl font-semibold text-zinc-50 sm:text-2xl">{p.name}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {posEs(p.pos) && <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">{posEs(p.pos)}</span>}
              <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">Dorsal {p.number}</span>
              <span className="rounded-md bg-black/30 px-2 py-0.5 text-zinc-200">{p.starter ? 'Titular' : 'Suplente'}</span>
            </div>
          </div>
        </div>

        {q.isLoading ? <Loading label="Cargando sus estadísticas…" /> : q.error ? <Empty>{(q.error as Error).message}</Empty> : <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {kpis.map(([label, v, sub]) => (
              <div key={label} className="rounded-lg bg-zinc-900 px-3 py-2.5">
                <div className="text-xs text-zinc-400">{label}</div>
                <div className="text-2xl font-semibold text-zinc-50 tnum">{v}</div>
                {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {!!mine.length && (
              <Panel title="Sus tiros">
                <div className="p-3 sm:p-4"><HalfPitchShots shots={mine} /></div>
              </Panel>
            )}
            {groups.map(g => (
              <Panel key={g.title} title={g.title}>
                <div className="divide-y divide-zinc-800/60">{g.rows.map(r => <StatLine key={r.key + r.label} row={r} s={s} color={color} />)}</div>
              </Panel>
            ))}
          </div>
          <p className="text-xs text-zinc-500">Datos de ESPN. Los goles esperados (xG) miden la calidad de sus tiros: cuántos goles marcaría de media un jugador cualquiera con esas ocasiones.</p>
        </>}
      </div>
    </Dialog>
  );
}
