// Equipos de baloncesto: clasificación de cada liga, ficha de un equipo y los dos de un partido frente a frente.
// NBA y WNBA salen de ESPN; Euroliga y EuroCup, de la API de la Euroliga (por eso algunos datos sólo están en unas ligas).
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { cn, pct } from '@/lib/format';
import type { BasketGame, BasketLeagueId, BasketTeamGame, BasketTeamInfo, BasketTeamPlayer } from '@/lib/types';
import { LEAGUE_NAME, badInjury } from './BasketAnalyzer';
import { TeamPoints, dec, restart, signed } from './BasketPoints';
import { Badge, Empty, Loading, TeamLogo, th } from './ui';
import { FormChips, KpiStrip, Panel, TvBand, TvFrame, TvHeader, TvPortrait, TvRow, panel, tdc } from './viz';

const esDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
const esWhen = (iso: string) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const POS: Record<string, string> = { PG: 'Base', SG: 'Escolta', SF: 'Alero', PF: 'Ala-pívot', C: 'Pívot', G: 'Exterior', F: 'Alero', Guard: 'Exterior', Forward: 'Alero', Center: 'Pívot' };
const INJURY: Record<string, string> = { Out: 'Baja', 'Day-To-Day': 'Duda', Questionable: 'Duda', Doubtful: 'Muy dudoso', Probable: 'Probable', Suspension: 'Sanción' };
const money = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M$` : `${Math.round(v / 1e3)} mil $`);
const toNum = (s: string | undefined) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

const streakCls = (s: string) => (s.startsWith('G') ? 'text-emerald-400' : s.startsWith('P') ? 'text-rose-400' : 'text-zinc-400');

export function BasketStandings({ league, onTeam }: { league: BasketLeagueId; onTeam: (id: string) => void }) {
  const q = useQuery({ queryKey: ['basket', 'standings', league], queryFn: () => window.api.basket.standings(league), staleTime: 15 * 60e3, retry: false });
  if (q.isLoading) return <Loading label="Cargando la clasificación…" />;
  if (q.error) return restart(q.error);
  const groups = (q.data ?? []).filter(g => g.teams.length);
  if (!groups.length) return <Empty>Sin clasificación ahora mismo.</Empty>;
  return (
    <div className={cn('grid grid-cols-1 items-start gap-2.5', groups.length > 1 && '2xl:grid-cols-2')}>
      {groups.map(g => (
        <Panel key={g.name} title={groups.length > 1 ? g.name : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px]">
              <thead className="bg-zinc-900/60"><tr>
                <th className={th + ' w-8 text-right'}>#</th><th className={th}>Equipo</th><th className={th + ' text-right'}>G-P</th><th className={th + ' w-24'}>%</th>
                <th className={th + ' text-right'}>Casa</th><th className={th + ' text-right'}>Fuera</th><th className={th + ' text-right'}>Últ. 10</th><th className={th + ' text-right'}>Racha</th>
                <th className={th + ' text-right'} title="Puntos anotados por partido">Anot.</th><th className={th + ' text-right'} title="Puntos encajados por partido">Enc.</th>
                <th className={th + ' text-right'} title="Diferencia de puntos por partido">Dif.</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/50">
                {g.teams.map(t => (
                  <tr key={t.id} onClick={() => onTeam(t.id)} className="cursor-pointer hover:bg-zinc-800/30">
                    <td className={tdc + ' text-right text-zinc-500 tnum'}>{t.pos}</td>
                    <td className={tdc}><span className="flex items-center gap-2 whitespace-nowrap"><TeamLogo src={t.logo} name={t.abbr} size={18} /><span className="font-medium">{t.name}</span></span></td>
                    <td className={tdc + ' whitespace-nowrap text-right font-medium tnum'}>{t.w}-{t.l}</td>
                    <td className={tdc} title={pct(t.pct)}><span className="flex items-center gap-2"><span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${t.pct * 100}%` }} /></span><span className="w-7 text-right text-[11px] text-zinc-500 tnum">{Math.round(t.pct * 100)}</span></span></td>
                    <td className={tdc + ' text-right text-zinc-400 tnum'}>{t.home}</td><td className={tdc + ' text-right text-zinc-400 tnum'}>{t.road}</td><td className={tdc + ' text-right text-zinc-400 tnum'}>{t.last}</td>
                    <td className={cn(tdc, 'text-right font-medium tnum', streakCls(t.streak))}>{t.streak || '–'}</td>
                    <td className={tdc + ' text-right tnum'}>{dec(t.pf)}</td><td className={tdc + ' text-right tnum'}>{dec(t.pa)}</td>
                    <td className={cn(tdc, 'text-right tnum', (t.diff ?? 0) > 0 ? 'text-emerald-400' : (t.diff ?? 0) < 0 ? 'text-rose-400' : 'text-zinc-400')}>{signed(t.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

const useTeam = (league: BasketLeagueId, id: string) => useQuery({
  queryKey: ['basket', 'team', league, id], queryFn: () => window.api.basket.team(league, id), staleTime: 15 * 60e3, retry: false
});

export function BasketTeamSheet({ league, teamId, onBack, onPlayer, backLabel = 'Clasificación' }: {
  league: BasketLeagueId; teamId: string; onBack: () => void;
  onPlayer: (p: { id: string; name: string; headshot?: string }, teamId: string) => void; backLabel?: string;
}) {
  const { data: t, error, isLoading } = useTeam(league, teamId);
  const back = <button onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={15} />{backLabel}</button>;
  if (isLoading) return <div className="flex flex-col gap-3">{back}<Loading label="Cargando el equipo…" /></div>;
  if (error || !t) return <div className="flex flex-col gap-3">{back}{restart(error ?? 'Sin datos de este equipo')}</div>;
  const s = t.standing;
  const meta = [LEAGUE_NAME[league], t.group, t.division, t.coach && `Entrenador: ${t.coach}`, t.venue && `${t.venue}${t.capacity ? ` (${t.capacity.toLocaleString('es-ES')})` : ''}`, [t.city, t.country].filter(Boolean).join(', ')].filter(Boolean);
  const out = t.roster.filter(p => p.injury);
  const form = t.results.slice(0, 10);
  const statKpis = t.stats.filter(x => ['Posesiones', 'Rating ofensivo', 'Rating defensivo', 'Tiros de campo %', 'Triples %', 'Tiros libres %', 'Rebotes', 'Asistencias'].includes(x.label));
  return (
    <div className="flex flex-col gap-2.5">
      {back}
      <TvFrame>
        <TvHeader media={<TeamLogo src={t.logo} name={t.abbr} size={44} />} title={t.name} sub={<span title={meta.join(' · ')}>{meta.join(' · ')}</span>}>
          {!!form.length && <div className="shrink-0" title="Últimos partidos, del más reciente al más antiguo"><FormChips list={form.map(g => ({ win: g.us.winner, title: `${g.home ? 'vs' : '@'} ${g.them.name}: ${g.us.score}-${g.them.score}` }))} /></div>}
        </TvHeader>
        {s && <KpiStrip items={[
          { label: 'Balance', value: `${s.w}-${s.l}`, sub: pct(s.pct) }, { label: 'Puesto', value: `${s.pos}.º`, sub: t.group || LEAGUE_NAME[league] },
          { label: 'En casa', value: s.home || '–' }, { label: 'Fuera', value: s.road || '–' }, { label: 'Últimos 10', value: s.last || '–' },
          { label: 'Racha', value: <span className={streakCls(s.streak)}>{s.streak || '–'}</span> },
          { label: 'Anotados', value: dec(s.pf), sub: 'por partido' }, { label: 'Encajados', value: dec(s.pa), sub: 'por partido' }, { label: 'Diferencia', value: signed(s.diff), sub: 'por partido' }
        ]} />}
      </TvFrame>

      {!!statKpis.length && (
        <div className={cn(panel, 'grid grid-cols-4 gap-x-4 gap-y-1 px-3.5 py-2 md:grid-cols-8')}>
          {statKpis.map(x => <div key={x.label} className="min-w-0"><div className="truncate font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">{x.label.replace('Tiros de campo %', 'T. campo %').replace('Tiros libres %', 'T. libres %')}</div><div className="font-score text-[18px] font-bold leading-tight text-white tnum">{x.value.replace('.', ',')}</div></div>)}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-3">
        {!!t.leaders.length && (
          <Panel title="Líderes">
            <div className="py-1">
              {t.leaders.map(l => (
                <div key={l.label} className="flex h-7 items-center gap-2 px-3.5 text-[13px]" title={l.players.map(p => `${p.name} ${p.value}`).join(', ')}>
                  <span className="w-20 shrink-0 text-xs text-zinc-500">{l.label}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.players[0]?.name}</span>
                  <span className="font-semibold tnum">{l.players[0]?.value.replace('.', ',')}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <GameList title="Últimos resultados" list={t.results} empty="Aún no ha jugado." />
        <GameList title="Próximos" list={t.upcoming} empty="Sin partidos programados." />
      </div>

      <TeamPoints league={league} teamId={t.id} />
      <TeamStats team={t} />

      {!!out.length && (
        <Panel title={`Bajas y dudas (${out.length})`}>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-3.5 py-2 text-[13px]">
            {out.map(p => (
              <span key={p.id} className="flex items-center gap-2" title={[p.injuryDetail, p.injuryReturn && `Vuelta prevista: ${esDate(p.injuryReturn)}`].filter(Boolean).join(' · ')}>
                <Badge tone={badInjury(p.injury!) ? 'danger' : 'warning'}>{INJURY[p.injury!] ?? p.injury}</Badge>{p.name}
                {p.injuryReturn && <span className="text-[11px] text-zinc-500">vuelve {esDate(p.injuryReturn)}</span>}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Roster team={t} onPlayer={p => onPlayer(p, t.id)} />
    </div>
  );
}

// Todas las estadísticas del equipo, por grupos. Las avanzadas salen de los promedios de tiro y son estimaciones.
function TeamStats({ team }: { team: BasketTeamInfo }) {
  const groups = [...new Set(team.stats.map(s => s.group).filter(Boolean))] as string[];
  if (!groups.length) return null;
  return (
    <Panel title="Estadísticas por partido">
      <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0 2xl:grid-cols-4">
        {groups.map(g => (
          <div key={g} className="py-1.5">
            <div className="px-3.5 pb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">{g}</div>
            {team.stats.filter(s => s.group === g).map(s => (
              <div key={s.label} className="flex h-6 items-center justify-between gap-3 px-3.5 text-[13px]">
                <span className="truncate text-zinc-300" title={s.label}>{s.label}</span>
                <span className="font-semibold tnum">{s.value.replace('.', ',')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function GameList({ title, list, empty }: { title: string; list: BasketTeamGame[]; empty: string }) {
  return (
    <Panel title={title}>
      {!list.length ? <div className="px-3.5 py-3 text-[13px] text-zinc-500">{empty}</div> : (
        <div className="py-1">
          {list.slice(0, 7).map(g => (
            <div key={g.id} className="flex h-7 items-center gap-2 px-3.5 text-[13px]">
              {g.state === 'post' && <FormChips list={[{ win: g.us.winner }]} />}
              <span className="w-4 shrink-0 text-center text-[11px] text-zinc-500" title={g.home ? 'En casa' : 'Fuera'}>{g.home ? 'vs' : '@'}</span>
              <TeamLogo src={g.them.logo} name={g.them.abbr} size={16} />
              <span className="min-w-0 flex-1 truncate">{g.them.name}</span>
              {g.state === 'post'
                ? <><span className="font-medium tnum">{g.us.score}-{g.them.score}</span><span className="w-9 text-right text-[11px] text-zinc-500 tnum">{esDate(g.date)}</span></>
                : <span className="whitespace-nowrap text-[11px] text-zinc-400">{esWhen(g.date)}</span>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Roster({ team, onPlayer }: { team: BasketTeamInfo; onPlayer: (p: BasketTeamPlayer) => void }) {
  const list = [...team.roster].sort((a, b) => (b.avg?.pts ?? -1) - (a.avg?.pts ?? -1));
  const hasAvg = list.some(p => p.avg), hasMoney = list.some(p => p.salary);
  const top = Math.max(1, ...list.map(p => p.avg?.pts ?? 0));
  return (
    <Panel title="Plantilla" aside="Pulsa un jugador para ver el valor de sus líneas">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="bg-zinc-900/60"><tr>
            <th className={th + ' w-8 text-right'}>N.º</th><th className={th}>Jugador</th><th className={th}>Pos.</th><th className={th + ' text-right'}>Edad</th><th className={th + ' text-right'}>Altura</th><th className={th + ' text-right'}>Peso</th><th className={th}>Procede de</th>
            {hasAvg && <><th className={th + ' w-28'}>Puntos</th><th className={th + ' text-right'}>REB</th><th className={th + ' text-right'}>AST</th><th className={th + ' text-right'}>MIN</th></>}
            {hasMoney && <th className={th + ' text-right'}>Salario</th>}
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/50">
            {list.map(p => (
              <tr key={p.id} onClick={() => onPlayer(p)} className="cursor-pointer hover:bg-zinc-800/30">
                <td className={tdc + ' text-right text-zinc-500 tnum'}>{p.jersey}</td>
                <td className={tdc}>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {p.headshot ? <img src={p.headshot} alt="" className="h-6 w-6 shrink-0 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="h-6 w-6 shrink-0 rounded-full bg-zinc-800" />}
                    <span className="font-medium">{p.name}</span>
                    {p.injury && <Badge tone={badInjury(p.injury) ? 'danger' : 'warning'}>{INJURY[p.injury] ?? p.injury}</Badge>}
                  </span>
                </td>
                <td className={tdc + ' whitespace-nowrap text-zinc-400'}>{POS[p.pos] ?? p.pos}</td>
                <td className={tdc + ' text-right text-zinc-400 tnum'}>{p.age ?? '–'}</td>
                <td className={tdc + ' whitespace-nowrap text-right text-zinc-400 tnum'}>{p.height || '–'}</td>
                <td className={tdc + ' whitespace-nowrap text-right text-zinc-400 tnum'}>{p.weight || '–'}</td>
                <td className={tdc + ' max-w-32 truncate text-zinc-500'} title={p.from}>{p.from || '–'}</td>
                {hasAvg && <>
                  <td className={tdc}><span className="flex items-center gap-2"><span className="w-7 font-semibold tnum">{dec(p.avg?.pts)}</span><span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${((p.avg?.pts ?? 0) / top) * 100}%` }} /></span></span></td>
                  <td className={tdc + ' text-right tnum'}>{dec(p.avg?.reb)}</td>
                  <td className={tdc + ' text-right tnum'}>{dec(p.avg?.ast)}</td>
                  <td className={tdc + ' text-right text-zinc-400 tnum'}>{dec(p.avg?.min)}</td>
                </>}
                {hasMoney && <td className={tdc + ' whitespace-nowrap text-right text-zinc-400 tnum'}>{p.salary ? money(p.salary) : '–'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// Los dos equipos de un partido, uno frente al otro
export function TeamsCompare({ game, onTeam }: { game: BasketGame; onTeam: (id: string) => void }) {
  const a = useTeam(game.league, game.away.id), b = useTeam(game.league, game.home.id);
  if (a.isLoading || b.isLoading) return <Loading label="Cargando los equipos…" />;
  if (a.error || b.error || !a.data || !b.data) return restart(a.error ?? b.error ?? 'Sin datos de estos equipos');
  const x = a.data, y = b.data;
  const stat = (t: BasketTeamInfo, l: string) => t.stats.find(s => s.label === l)?.value;
  const stand = (t: BasketTeamInfo, k: 'pct' | 'pf' | 'pa' | 'diff') => t.standing?.[k] ?? null;
  // Cada fila con la diferencia que lleva la línea al tope: en una liga, 15 puntos o 8 rebotes por partido es muchísimo
  const total = (t: BasketTeamInfo) => (t.standing?.pf != null && t.standing.pa != null ? t.standing.pf + t.standing.pa : null);
  const bars: { label: string; a: number | null; b: number | null; aText: string; bText: string; better?: 'low'; spread: number }[] = [
    { label: 'Victorias', a: stand(x, 'pct'), b: stand(y, 'pct'), aText: x.standing ? pct(x.standing.pct) : '–', bText: y.standing ? pct(y.standing.pct) : '–', spread: 0.4 },
    { label: 'Puntos anotados', a: stand(x, 'pf'), b: stand(y, 'pf'), aText: dec(stand(x, 'pf')), bText: dec(stand(y, 'pf')), spread: 15 },
    { label: 'Puntos encajados', a: stand(x, 'pa'), b: stand(y, 'pa'), aText: dec(stand(x, 'pa')), bText: dec(stand(y, 'pa')), better: 'low', spread: 15 },
    { label: 'Total de sus partidos', a: total(x), b: total(y), aText: dec(total(x)), bText: dec(total(y)), spread: 20 },
    ...([['Posesiones', 6], ['Rating ofensivo', 10], ['Rating defensivo', 10, 'low'], ['Rebotes', 8], ['Rebotes ofensivos', 5], ['Asistencias', 8], ['Pérdidas', 5, 'low'], ['Tiros de campo %', 8], ['Triples anotados', 5], ['Triples %', 8], ['Tiros libres %', 12]] as [string, number, 'low'?][]).map(([l, spread, better]) => ({
      label: l, a: toNum(stat(x, l)), b: toNum(stat(y, l)), aText: stat(x, l)?.replace('.', ',') ?? '–', bText: stat(y, l)?.replace('.', ',') ?? '–', better, spread
    }))
  ];
  const text = (t: BasketTeamInfo, k: 'home' | 'road' | 'last' | 'streak') => t.standing?.[k] || '–';
  const name = (t: BasketTeamInfo) => (
    <button onClick={() => onTeam(t.id)} title="Ver la ficha del equipo" className="grid h-[22px] w-full cursor-pointer grid-cols-[1.25rem_minmax(0,11rem)_3rem] items-center gap-2 font-score hover:opacity-80">
      <TeamLogo src={t.logo} name={t.abbr} size={18} />
      <span className="truncate text-left text-[17px] font-bold uppercase tracking-wide">{t.name}</span>
      <span className="text-right text-[17px] font-bold tnum">{t.standing ? `${t.standing.w}-${t.standing.l}` : ''}</span>
    </button>
  );
  const out = (t: BasketTeamInfo) => t.roster.filter(p => p.injury);
  const hero = (t: BasketTeamInfo) => (t.standing ? `${t.standing.pos}.º` : '–');
  const px = x.standing?.pct ?? null, py = y.standing?.pct ?? null;
  return (
    <div className="flex flex-col gap-2.5">
      <TvFrame>
        <TvHeader title="Frente a frente" sub={LEAGUE_NAME[game.league]}><div className="flex min-w-64 flex-col">{name(x)}{name(y)}</div></TvHeader>
        <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)_200px] lg:grid-cols-[230px_minmax(0,1fr)_230px]">
          <TvPortrait name={x.name} photo={x.logo} logo side="left" heroLabel="Puesto" hero={hero(x)} lead={px != null && py != null && px > py} />
          <div className="min-w-0 pb-2">
            <TvBand>Temporada</TvBand>
            <div className="pb-1.5">{bars.slice(0, 4).map(r => <TvRow key={r.label} {...r} />)}</div>
            <TvBand>Por partido</TvBand>
            <div className="pb-1.5">{bars.slice(4).map(r => <TvRow key={r.label} {...r} />)}</div>
            <TvBand>Forma</TvBand>
            {([['En casa', 'home'], ['Fuera', 'road'], ['Últimos 10', 'last'], ['Racha', 'streak']] as const).map(([l, k]) => <TvRow key={k} label={l} a={null} b={null} aText={text(x, k)} bText={text(y, k)} />)}
          </div>
          <TvPortrait name={y.name} photo={y.logo} logo side="right" heroLabel="Puesto" hero={hero(y)} lead={px != null && py != null && py > px} />
        </div>
      </TvFrame>
      {!!(out(x).length + out(y).length) && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {[x, y].map(t => (
            <Panel key={t.id} title={`Bajas y dudas: ${t.abbr}`}>
              {!out(t).length ? <p className="px-3.5 py-2 text-[13px] text-zinc-500">Ninguna conocida.</p> : (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-3.5 py-2 text-[13px]">
                  {out(t).map(p => <span key={p.id} className="flex items-center gap-1.5"><Badge tone={badInjury(p.injury!) ? 'danger' : 'warning'}>{INJURY[p.injury!] ?? p.injury}</Badge>{p.name}</span>)}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
