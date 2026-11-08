// Piezas comunes de la app de fútbol: el balón del selector, la hora en España, los colores de cada equipo y la tabla de
// clasificación (la usan la ficha del partido y la pantalla de clasificaciones).
import { cn } from '@/lib/format';
import { teamTheme } from '@/lib/team-colors';
import type { FootballGroup, FootballTeam } from '@/lib/types';
import { TeamLogo, th } from './ui';
import { panel } from './viz';

// Balón (lucide no tiene): círculo con el pentágono del centro y sus costuras
export function FootballIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5z" /><path d="M12 2v5.5M16.3 10.6l5.2-1.7M14.7 15.6l3.2 4.4M9.3 15.6l-3.2 4.4M7.7 10.6 2.5 8.9" />
    </svg>
  );
}

export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

// Colores del equipo (los da ESPN) en el formato de los de baloncesto, para el marcador grande y las barras
export const themeOf = (t: FootballTeam) => (t.color ? teamTheme({ color: t.color, alt: t.alt }) : null);

// Tabla de clasificación. mark: los equipos que se resaltan (los del partido abierto); compact: menos columnas
export function StandingsTable({ groups, mark = [], compact }: { groups: FootballGroup[]; mark?: string[]; compact?: boolean }) {
  const zones = [...new Map(groups.flatMap(g => g.rows).filter(r => r.zone).map(r => [r.zone!.text, r.zone!.color])).entries()];
  const wide = compact ? 'hidden' : 'hidden sm:table-cell';
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map(g => (
        <div key={g.name} className={cn(panel, 'overflow-hidden')}>
          {groups.length > 1 && <div className="border-b border-zinc-800 px-4 py-2.5 text-[13px] font-semibold text-zinc-50">{g.name}</div>}
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr>
              <th className={th + ' w-10 text-right'}>#</th><th className={th}>Equipo</th>
              <th className={th + ' text-right'} title="Partidos jugados">PJ</th>
              <th className={cn(th, wide, 'text-right')}>G</th><th className={cn(th, wide, 'text-right')}>E</th><th className={cn(th, wide, 'text-right')}>P</th>
              <th className={cn(th, wide, 'text-right')} title="Goles a favor y en contra">Goles</th>
              <th className={th + ' text-right'} title="Diferencia de goles">DG</th><th className={th + ' text-right'}>Pts</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {g.rows.map(r => (
                <tr key={r.team.id} className={cn(mark.includes(r.team.id) && 'bg-amber-500/10')}>
                  <td className="relative px-3 py-2 text-right text-[13px] text-zinc-400 tnum">
                    {r.zone && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r" style={{ background: r.zone.color }} title={r.zone.text} />}{r.rank}
                  </td>
                  <td className="px-3 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2"><TeamLogo src={r.team.logo} name={r.team.abbr || r.team.name} size={18} />
                      <span className={cn('truncate', mark.includes(r.team.id) ? 'font-semibold text-zinc-50' : 'text-zinc-200')}>{r.team.name}</span></span>
                  </td>
                  <td className="px-3 py-2 text-right text-[13px] text-zinc-400 tnum">{r.played}</td>
                  <td className={cn('px-3 py-2 text-right text-[13px] text-zinc-400 tnum', wide)}>{r.won}</td>
                  <td className={cn('px-3 py-2 text-right text-[13px] text-zinc-400 tnum', wide)}>{r.drawn}</td>
                  <td className={cn('px-3 py-2 text-right text-[13px] text-zinc-400 tnum', wide)}>{r.lost}</td>
                  <td className={cn('px-3 py-2 text-right text-[13px] text-zinc-400 tnum', wide)}>{r.gf}:{r.ga}</td>
                  <td className="px-3 py-2 text-right text-[13px] text-zinc-400 tnum">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                  <td className="px-3 py-2 text-right text-[13px] font-semibold text-zinc-50 tnum">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {!!zones.length && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-zinc-500">
          {zones.map(([text, color]) => <span key={text} className="flex items-center gap-1.5"><span className="h-2.5 w-[3px] rounded" style={{ background: color }} />{text}</span>)}
        </div>
      )}
    </div>
  );
}
