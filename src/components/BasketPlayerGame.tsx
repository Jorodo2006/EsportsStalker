// El partido de un jugador de baloncesto, al pulsarlo en la tabla del partido (como en fútbol): su foto, un filtro por cuartos,
// la media pista con sus tiros (metidos y fallados) y sus estadísticas. "Todos" usa el boxscore, que es el oficial; cada cuarto
// sale de las jugadas de ESPN (server/services/basket/espn.js, playerGame). La Euroliga no da jugada a jugada: sólo el total.
// Un botón lleva al valor de sus líneas (lo que antes abría pulsar al jugador).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/format';
import type { BasketGame, BasketShot, BoxTeam } from '@/lib/types';
import { Button, Dialog, Empty, Loading, TeamLogo, seg, segWrap } from './ui';
import { Panel } from './viz';
import { espnLeague } from '@/lib/basket-leagues';

type BoxPlayer = BoxTeam['players'][number];

const COURT = '#6f5d3e'; // parqué apagado, plano: que se lea como pista sin chillar sobre el fondo oscuro
const LINE = 'rgba(255,255,255,0.55)';
const RIM_Y = 5.25; // el aro, a 5,25 pies de la línea de fondo
const periodLabel = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? 'Pr' : `Pr${p - 4}`);

// Media pista (50 x 47 pies) con el aro arriba. x: pies a lo ancho desde el aro (0 en el centro); y: pies desde el aro
function Court({ shots }: { shots: BasketShot[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const at = (s: BasketShot): [number, number] => [25 + s.x, RIM_Y + s.y];
  const h = shots[hover ?? -1];
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl" style={{ background: COURT }}>
        <svg viewBox="-1 -1 52 40" className="block w-full">
          <g fill="none" stroke={LINE} strokeWidth="0.25">
            <path d="M0 0 H50 M0 0 V39 M50 0 V39" />
            <rect x="17" y="0" width="16" height="19" />
            <circle cx="25" cy="19" r="6" />
            <path d="M3 0 V14.2 A23.75 23.75 0 0 0 47 14.2 V0" />
            <path d="M21 5.25 A4 4 0 0 0 29 5.25" />
            <line x1="22" y1="4" x2="28" y2="4" strokeWidth="0.4" />
            <circle cx="25" cy={RIM_Y} r="0.75" stroke="#f97316" strokeWidth="0.3" />
          </g>
          {shots.map((s, i) => {
            const [cx, cy] = at(s);
            const on = hover === i;
            return (
              <g key={i} className="shot-mark cursor-pointer" style={{ animationDelay: `${0.05 + i * 0.03}s` }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <title>{`${periodLabel(s.period)} ${s.clock} · ${s.made ? 'Dentro' : 'Fallado'} · de ${s.value}`}</title>
                {s.made
                  ? <circle cx={cx} cy={cy} r={on ? 1.15 : 0.85} fill="#34d399" stroke="#052e1c" strokeWidth="0.2" />
                  : <path d={`M${cx - 0.7} ${cy - 0.7} L${cx + 0.7} ${cy + 0.7} M${cx + 0.7} ${cy - 0.7} L${cx - 0.7} ${cy + 0.7}`} stroke="#fb7185" strokeWidth={on ? 0.45 : 0.32} strokeLinecap="round" />}
                <circle cx={cx} cy={cy} r={1.6} fill="transparent" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="min-h-5 text-[13px] text-zinc-300">
        {h ? `${periodLabel(h.period)} ${h.clock} · ${h.made ? 'Dentro' : 'Fallado'}, de ${h.value} · ${h.text}`
          : <span className="text-zinc-500">{shots.length ? `${shots.filter(s => s.made).length} dentro de ${shots.length} tiros de campo. Pasa por encima de uno para verlo.` : 'Sin tiros de campo en este tramo.'}</span>}
      </div>
      <div className="flex gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#34d399" /></svg>Dentro</span>
        <span className="flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="#fb7185" strokeWidth="1.6" strokeLinecap="round" /></svg>Fallado</span>
      </div>
    </div>
  );
}

const pctOf = (m: number, a: number) => (a ? ` (${Math.round((m / a) * 100)} %)` : '');
const split = (s: string) => { const [m, a] = String(s || '0-0').split('-').map(Number); return [m || 0, a || 0] as const; };

export function BasketPlayerGameDialog({ game, team, player, onClose, onLines }: {
  game: BasketGame; team: BoxTeam; player: BoxPlayer; onClose: () => void; onLines: () => void;
}) {
  const [period, setPeriod] = useState(0);
  const espn = espnLeague(game.league);
  const q = useQuery({
    queryKey: ['basket', 'playerGame', game.id, player.id], enabled: espn && !!player.id,
    queryFn: () => window.api.basket.playerGame(game.id, player.id), staleTime: 20e3,
    refetchInterval: game.state === 'in' ? 30_000 : false
  });
  const [noPhoto, setNoPhoto] = useState(false);
  const photo = espn && player.id && !noPhoto ? `https://a.espncdn.com/i/headshots/${game.league}/players/full/${player.id}.png` : null;
  const pg = q.data?.available ? q.data : null;

  // Todos: el boxscore (oficial). Un cuarto: lo que sale de las jugadas
  const all = period === 0;
  const s = pg?.byPeriod[period];
  const [fgm, fga] = all ? split(player.fg) : [s?.fgm ?? 0, s?.fga ?? 0];
  const [tpm, tpa] = all ? split(player.fg3) : [s?.tpm ?? 0, s?.tpa ?? 0];
  const [ftm, fta] = all ? split(player.ft) : [s?.ftm ?? 0, s?.fta ?? 0];
  const n = (k: 'pts' | 'ast' | 'stl' | 'blk' | 'tov') => (all ? player[k] : s?.[k] ?? 0);
  const oreb = all ? player.oreb ?? pg?.byPeriod[0]?.oreb ?? 0 : s?.oreb ?? 0;
  const dreb = all ? player.dreb ?? pg?.byPeriod[0]?.dreb ?? 0 : s?.dreb ?? 0;
  const pf = all ? player.pf ?? pg?.byPeriod[0]?.pf ?? 0 : s?.pf ?? 0;
  const groups: [string, [string, string][]][] = [
    ['Anotación', [
      ['Minutos jugados', all ? `${Math.round(player.min)}'` : '–'], ['Puntos', String(n('pts'))],
      ['Tiros libres', `${ftm}/${fta}${pctOf(ftm, fta)}`], ['Canastas de 2', `${fgm - tpm}/${fga - tpa}${pctOf(fgm - tpm, fga - tpa)}`],
      ['Canastas de 3', `${tpm}/${tpa}${pctOf(tpm, tpa)}`], ['Tiros de campo', `${fgm}/${fga}${pctOf(fgm, fga)}`]
    ]],
    ['Rebotes', [['Rebotes', String(all ? player.reb : oreb + dreb)], ['Defensivos', String(dreb)], ['Ofensivos', String(oreb)]]],
    ['El resto', [
      ['Asistencias', String(n('ast'))], ['Pérdidas', String(n('tov'))], ['Robos', String(n('stl'))], ['Tapones', String(n('blk'))],
      ['Faltas personales', String(pf)], ['+/-', all ? player.pm || '0' : '–']
    ]]
  ];
  const shots = (pg?.shots ?? []).filter(x => period === 0 || x.period === period);

  return (
    <Dialog open onClose={onClose} wide title={<span className="text-sm font-medium text-zinc-400">Su partido</span>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-zinc-900 p-4">
          {photo
            ? <img src={photo} alt={player.name} onError={() => setNoPhoto(true)} className="h-16 w-[88px] shrink-0 rounded-lg bg-zinc-800 object-cover object-top sm:h-20 sm:w-[110px]" />
            : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-zinc-800 sm:h-20 sm:w-20"><TeamLogo src={team.logo} name={team.abbr} size={44} /></span>}
          <div className="min-w-0 flex-1 basis-40">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400"><TeamLogo src={team.logo} name={team.abbr} size={16} /><span className="truncate">{team.name}</span>{player.starter && <span className="shrink-0">· Titular</span>}</div>
            <div className="truncate text-xl font-semibold text-zinc-50 sm:text-2xl" title={player.name}>{player.name}</div>
            <div className="mt-1 text-sm text-zinc-300 tnum">{player.pts} pts · {player.reb} reb · {player.ast} ast</div>
          </div>
          <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={onLines} title="El analizador de sus líneas: puntos, rebotes, asistencias…"><TrendingUp size={14} />Sus líneas</Button>
        </div>

        {pg && pg.periods.length > 1 && (
          <div>
            <div className={segWrap}>
              <button onClick={() => setPeriod(0)} className={seg(period === 0)}>Todos</button>
              {pg.periods.map(p => <button key={p} onClick={() => setPeriod(p)} className={seg(period === p)}>{periodLabel(p)}</button>)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {espn && (
            <Panel title="Sus tiros">
              <div className="p-3 sm:p-4">
                {q.isLoading ? <Loading label="Cargando sus tiros…" /> : pg ? <Court key={period} shots={shots} /> : <Empty>ESPN no tiene las jugadas de este partido.</Empty>}
              </div>
            </Panel>
          )}
          <div className={cn('flex flex-col gap-3', !espn && 'lg:col-span-2')}>
            {groups.map(([title, rows]) => (
              <Panel key={title} title={title}>
                <div className="divide-y divide-zinc-800/60">
                  {rows.map(([label, v]) => (
                    <div key={label} className="flex h-8 items-center justify-between gap-3 px-4 text-[13px]">
                      <span className={cn(v === '0' || v.startsWith('0/0') ? 'text-zinc-500' : 'text-zinc-300')}>{label}</span>
                      <span className={cn('font-semibold tnum', v === '0' || v.startsWith('0/0') ? 'text-zinc-600' : 'text-zinc-50')}>{v}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
            {!all && <p className="text-xs text-zinc-500">Por cuartos sale de las jugadas: puede faltar alguna falta que ESPN apunta sólo como pérdida.</p>}
            {!espn && <p className="text-xs text-zinc-500">La Euroliga no da jugada a jugada: sin mapa de tiros ni cuartos.</p>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
