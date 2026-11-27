// Estadísticas de la temporada de una competición (Clasificación → Jugadores / Equipos): tiros, goles, faltas y tarjetas de cada
// jugador, y córneres, tiros y tarjetas de cada equipo. Los datos, de server/services/football/season.js; el orden y las medias, de
// src/lib/football-season.ts
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn, decimal } from '@/lib/format';
import { leagueAverages, PLAYER_SORTS, playerRows, TEAM_SORTS, teamRows, type PlayerSort, type TeamSort } from '@/lib/football-season';
import type { FootballLeagueId, FootballSeasonStats } from '@/lib/types';
import { Empty, ErrorBox, Input, Loading, panelCls, Tabs, TeamLogo } from '@/components/ui';
import { TvTabs } from '@/components/viz';

const d2 = (v: number) => decimal(v, 2);
const PAGE = 40;
const MIN_GAMES = [1, 3, 5] as const;

export function SeasonStats({ league, kind }: { league: FootballLeagueId; kind: 'players' | 'teams' }) {
  const q = useQuery({ queryKey: ['football', 'season', league], queryFn: () => window.api.football.seasonStats(league), staleTime: 10 * 60e3 });
  if (q.isLoading) return <Loading label="Sumando los partidos de la temporada…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;
  if (!s.games) return <Empty>Todavía no hay partidos jugados con estadísticas en esta competición.</Empty>;
  const avg = leagueAverages(s);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        {s.season ? `${s.season} · ` : ''}{s.games} partidos{s.missing ? ` (faltan ${s.missing} por cargar: se completan solos en unos minutos)` : ''} ·
        media por partido: {d2(avg.corners)} córneres, {d2(avg.yellow)} amarillas y {d2(avg.shots)} tiros
      </p>
      {kind === 'players' ? <Players s={s} /> : <Teams s={s} />}
    </div>
  );
}

function Players({ s }: { s: FootballSeasonStats }) {
  const [sort, setSort] = useState<PlayerSort>('shots');
  const [min, setMin] = useState<string>('3');
  const [text, setText] = useState('');
  const [n, setN] = useState(PAGE);
  const rows = playerRows(s, sort, Number(min), text);
  const head = (key: PlayerSort | null, label: string) => <span className={cn('text-right', key === sort && 'text-zinc-200')}>{label}</span>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <TvTabs value={sort} onChange={v => { setSort(v); setN(PAGE); }} items={PLAYER_SORTS.map(x => ({ value: x.value, label: x.label }))} />
        <Tabs value={min} onChange={setMin} items={MIN_GAMES.map(m => ({ value: String(m), label: m === 1 ? 'Todos' : `${m}+ partidos` }))} />
        <Input className="w-full sm:w-56" placeholder="Buscar jugador o equipo" value={text} onChange={e => { setText(e.target.value); setN(PAGE); }} />
      </div>
      <p className="text-xs text-zinc-500">Tiros, a puerta y faltas, por partido jugado. Los córneres no los da ESPN por jugador: están en Equipos.</p>
      <section className={cn(panelCls, 'overflow-hidden')}>
        <div className="hidden grid-cols-[28px_minmax(0,1fr)_44px_64px_64px_48px_64px_64px] gap-3 border-b border-zinc-800/70 px-4 py-2 text-[11px] text-zinc-500 md:grid">
          <span /><span>Jugador</span><span className="text-right">PJ</span>{head('shots', 'Tiros')}{head('onTarget', 'A puerta')}{head('goals', 'Goles')}
          {head('fouls', 'Faltas')}{head('cards', 'Am. / rojas')}
        </div>
        {!rows.length ? <div className="p-4"><Empty>Nadie cumple el filtro.</Empty></div> : (
          <ul className="divide-y divide-zinc-800/60">
            {rows.slice(0, n).map((p, i) => (
              <li key={`${p.id}|${p.team}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[28px_minmax(0,1fr)_44px_64px_64px_48px_64px_64px]">
                <span className="text-xs text-zinc-500 tnum">{i + 1}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <TeamLogo src={p.logo} name={p.teamName} size={20} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-zinc-100">{p.name}</div>
                    <div className="truncate text-xs text-zinc-500"><span className="md:hidden">{p.games} PJ · </span>{p.teamName}</div>
                  </div>
                </div>
                <div className="text-right md:hidden">
                  <div className="text-[13px] font-semibold text-zinc-50 tnum">{sort === 'goals' ? p.goals : sort === 'cards' ? `${p.yellow} / ${p.red}` : d2(p.value)}</div>
                  <div className="text-[11px] text-zinc-500">{sort === 'cards' ? 'amarillas / rojas' : sort === 'goals' ? `en ${p.games} partidos` : 'por partido'}</div>
                </div>
                <span className="hidden text-right text-[13px] text-zinc-400 tnum md:block">{p.games}</span>
                <Cell on={sort === 'shots'} main={d2(p.shots / p.games)} sub={String(p.shots)} />
                <Cell on={sort === 'onTarget'} main={d2(p.shotsOnTarget / p.games)} sub={String(p.shotsOnTarget)} />
                <Cell on={sort === 'goals'} main={String(p.goals)} sub={p.assists ? `${p.assists} as.` : ''} />
                <Cell on={sort === 'fouls'} main={d2(p.fouls / p.games)} sub={String(p.fouls)} />
                <Cell on={sort === 'cards'} main={`${p.yellow} / ${p.red}`} sub="" />
              </li>
            ))}
          </ul>
        )}
        {rows.length > n && <div className="border-t border-zinc-800/70 px-4 py-2.5"><button type="button" className="text-xs font-medium text-zinc-400 hover:text-zinc-200" onClick={() => setN(n + PAGE * 2)}>Ver más ({rows.length - n})</button></div>}
      </section>
    </>
  );
}

// Una celda de la tabla en el ordenador: la media (o el total) y debajo, en pequeño, el total de la temporada
function Cell({ on, main, sub }: { on: boolean; main: string; sub: string }) {
  return (
    <div className="hidden text-right md:block">
      <div className={cn('text-[13px] tnum', on ? 'font-semibold text-zinc-50' : 'text-zinc-300')}>{main}</div>
      {sub && <div className="text-[11px] text-zinc-500 tnum">{sub}</div>}
    </div>
  );
}

function Teams({ s }: { s: FootballSeasonStats }) {
  const [sort, setSort] = useState<TeamSort>('corners');
  const rows = teamRows(s, sort);
  const pg = (v: number, g: number) => d2(g ? v / g : 0);
  const head = (key: TeamSort | null, label: string) => <span className={cn('text-right', key === sort && 'text-zinc-200')}>{label}</span>;
  return (
    <>
      <TvTabs value={sort} onChange={setSort} items={TEAM_SORTS.map(x => ({ value: x.value, label: x.label }))} />
      <p className="text-xs text-zinc-500">Todo por partido. «Del partido» suma lo suyo y lo del rival, que es lo que se apuesta en un total.</p>
      <section className={cn(panelCls, 'overflow-hidden')}>
        <div className="hidden grid-cols-[28px_minmax(0,1fr)_36px_64px_64px_64px_56px_64px_44px] gap-3 border-b border-zinc-800/70 px-4 py-2 text-[11px] text-zinc-500 md:grid">
          <span /><span>Equipo</span><span className="text-right">PJ</span>{head('corners', 'Córneres')}{head('cornersFor', 'A favor')}{head('cornersAgainst', 'En contra')}
          {head('shots', 'Tiros')}{head('cards', 'Tarjetas')}<span className="text-right">Rojas</span>
        </div>
        <ul className="divide-y divide-zinc-800/60">
          {rows.map((t, i) => (
            <li key={t.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[28px_minmax(0,1fr)_36px_64px_64px_64px_56px_64px_44px]">
              <span className="text-xs text-zinc-500 tnum">{i + 1}</span>
              <div className="flex min-w-0 items-center gap-2">
                <TeamLogo src={t.logo} name={t.name} size={22} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-zinc-100">{t.name}</div>
                  <div className="text-xs text-zinc-500 md:hidden">
                    {t.games} PJ · córneres {pg(t.cornersFor, t.games)} a favor, {pg(t.cornersAgainst, t.games)} en contra · amarillas {pg(t.yellow, t.games)}
                  </div>
                </div>
              </div>
              <div className="text-right md:hidden">
                <div className="text-[13px] font-semibold text-zinc-50 tnum">{d2(t.value)}</div>
                <div className="text-[11px] text-zinc-500">por partido</div>
              </div>
              <span className="hidden text-right text-[13px] text-zinc-400 tnum md:block">{t.games}</span>
              <Cell on={sort === 'corners'} main={pg(t.cornersFor + t.cornersAgainst, t.games)} sub="" />
              <Cell on={sort === 'cornersFor'} main={pg(t.cornersFor, t.games)} sub="" />
              <Cell on={sort === 'cornersAgainst'} main={pg(t.cornersAgainst, t.games)} sub="" />
              <Cell on={sort === 'shots'} main={pg(t.shots, t.games)} sub={`${pg(t.shotsOnTarget, t.games)} a p.`} />
              <Cell on={sort === 'cards'} main={pg(t.yellow + t.yellowAgainst, t.games)} sub={`${pg(t.yellow, t.games)} suyas`} />
              <Cell on={false} main={String(t.red)} sub="" />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
