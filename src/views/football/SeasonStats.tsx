// Estadísticas de la temporada de una competición (Clasificación → Jugadores / Equipos): tiros, goles, faltas y tarjetas de cada
// jugador, y córneres, tiros y tarjetas de cada equipo. Los datos, de server/services/football/season.js; el orden y las medias, de
// src/lib/football-season.ts
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn, decimal } from '@/lib/format';
import { leagueAverages, PLAYER_LINE_STATS, PLAYER_SORTS, playerLines, playerRows, TEAM_LINE_STATS, TEAM_SORTS, teamLines, teamRows, type PlayerLineStat, type PlayerSort, type Side, type TeamLineStat, type TeamSort } from '@/lib/football-season';
import type { FootballLeagueId, FootballSeasonStats } from '@/lib/types';
import { Empty, ErrorBox, Input, Loading, panelCls, Tabs, TeamLogo } from '@/components/ui';
import { TvTabs } from '@/components/viz';

const d2 = (v: number) => decimal(v, 2);
const PAGE = 40;
const MIN_GAMES = [1, 3, 5] as const;

export function SeasonStats({ league, kind }: { league: FootballLeagueId; kind: 'players' | 'teams' }) {
  // Medias (lo de siempre) o Líneas: en cuántos partidos supera (o no llega a) una línea de las casas. Se recuerda
  const [view, setViewState] = useState<'avg' | 'lines'>(() => { try { return localStorage.getItem('football-season-view') === 'lines' ? 'lines' : 'avg'; } catch { return 'avg'; } });
  const setView = (v: 'avg' | 'lines') => { setViewState(v); try { localStorage.setItem('football-season-view', v); } catch { /* sin almacenamiento */ } };
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
      <Tabs value={view} onChange={setView} items={[{ value: 'avg', label: 'Medias' }, { value: 'lines', label: 'Líneas: más / menos de' }]} />
      {kind === 'players' ? (view === 'lines' ? <PlayerLinesView s={s} /> : <Players s={s} />) : view === 'lines' ? <TeamLinesView s={s} /> : <Teams s={s} />}
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

// ---------- Líneas ----------
const pctOf = (r: number) => `${Math.round(r * 100)} %`;
const lineLabel = (side: Side, v: number) => `${side === 'over' ? 'Más' : 'Menos'} de ${decimal(v, 1)}`;

// Los últimos 5 partidos: el valor de cada uno, en verde si cumplió la línea
function LastFive({ last }: { last: { v: number; ok: boolean }[] }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Últimos partidos: ${last.map(x => x.v).join(', ')}`}>
      {last.map((x, i) => (
        <span key={i} className={cn('grid h-6 w-6 place-items-center rounded text-[11px] font-semibold tnum', x.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>{x.v}</span>
      ))}
    </span>
  );
}

function LineControls<T extends string>({ stats, stat, setStat, side, setSide, lines, line, setLine }: {
  stats: { value: T; label: string }[]; stat: T; setStat: (v: T) => void; side: Side; setSide: (v: Side) => void; lines: number[]; line: number; setLine: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <TvTabs value={stat} onChange={setStat} items={stats.map(x => ({ value: x.value, label: x.label }))} />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={side} onChange={setSide} items={[{ value: 'over', label: 'Más de' }, { value: 'under', label: 'Menos de' }]} />
        <Tabs value={String(line)} onChange={v => setLine(Number(v))} items={lines.map(l => ({ value: String(l), label: decimal(l, 1) }))} />
      </div>
    </div>
  );
}

// Una fila: en cuántos partidos cumplió la línea, su porcentaje, la media y los últimos 5
function LineRow({ i, logo, name, sub, hits, n, rate, avg, last }: { i: number; logo: string; name: string; sub: string; hits: number; n: number; rate: number; avg: number; last: { v: number; ok: boolean }[] }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 md:grid-cols-[28px_minmax(0,1fr)_120px_64px_160px]">
      <span className="text-xs text-zinc-500 tnum">{i + 1}</span>
      <div className="flex min-w-0 items-center gap-2">
        <TeamLogo src={logo} name={name} size={20} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-zinc-100">{name}</div>
          {sub && <div className="truncate text-xs text-zinc-500">{sub}</div>}
        </div>
      </div>
      <div className="text-right">
        <div className={cn('text-[13px] font-semibold tnum', rate >= 0.7 ? 'text-emerald-400' : rate <= 0.3 ? 'text-rose-400' : 'text-zinc-50')}>{pctOf(rate)}</div>
        <div className="text-[11px] text-zinc-500 tnum">{hits} de {n}</div>
      </div>
      <div className="hidden text-right text-[13px] text-zinc-300 tnum md:block">{d2(avg)}</div>
      <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto md:text-right"><LastFive last={last} /></div>
    </li>
  );
}

function LineHead({ what }: { what: string }) {
  return (
    <div className="hidden grid-cols-[28px_minmax(0,1fr)_120px_64px_160px] gap-x-3 border-b border-zinc-800/70 px-4 py-2 text-[11px] text-zinc-500 md:grid">
      <span /><span>{what}</span><span className="text-right">Partidos que la cumple</span><span className="text-right">Media</span><span className="text-right">Últimos 5</span>
    </div>
  );
}

const LINE_NOTE = 'Es lo que pasó, no una probabilidad: con pocos partidos, un 100 % puede ser casualidad. Compáralo con la cuota de la casa (una cuota de 2,00 pide acertar la mitad).';

function PlayerLinesView({ s }: { s: FootballSeasonStats }) {
  const [stat, setStat] = useState<PlayerLineStat>('shots');
  const [side, setSide] = useState<Side>('over');
  const [line, setLine] = useState(0.5);
  const [min, setMin] = useState('5');
  const [text, setText] = useState('');
  const [n, setN] = useState(PAGE);
  const cfg = PLAYER_LINE_STATS.find(x => x.value === stat)!;
  const ln = cfg.lines.includes(line) ? line : cfg.lines[0];
  const rows = playerLines(s, stat, ln, side, Number(min), text);
  return (
    <>
      <LineControls stats={PLAYER_LINE_STATS} stat={stat} setStat={v => { setStat(v); setN(PAGE); }} side={side} setSide={setSide} lines={cfg.lines} line={ln} setLine={setLine} />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={min} onChange={setMin} items={MIN_GAMES.map(m => ({ value: String(m), label: m === 1 ? 'Todos' : `${m}+ partidos` }))} />
        <Input className="w-full sm:w-56" placeholder="Buscar jugador o equipo" value={text} onChange={e => { setText(e.target.value); setN(PAGE); }} />
      </div>
      <p className="text-xs text-zinc-500">{lineLabel(side, ln)} {cfg.label.toLowerCase()} en cada partido que jugó. {LINE_NOTE}</p>
      <section className={cn(panelCls, 'overflow-hidden')}>
        <LineHead what="Jugador" />
        {!rows.length ? <div className="p-4"><Empty>Nadie cumple el filtro.</Empty></div> : (
          <ul className="divide-y divide-zinc-800/60">
            {rows.slice(0, n).map((p, i) => <LineRow key={`${p.id}|${p.team}`} i={i} logo={p.logo} name={p.name} sub={p.teamName} hits={p.hits} n={p.n} rate={p.rate} avg={p.avg} last={p.last} />)}
          </ul>
        )}
        {rows.length > n && <div className="border-t border-zinc-800/70 px-4 py-2.5"><button type="button" className="text-xs font-medium text-zinc-400 hover:text-zinc-200" onClick={() => setN(n + PAGE * 2)}>Ver más ({rows.length - n})</button></div>}
      </section>
    </>
  );
}

function TeamLinesView({ s }: { s: FootballSeasonStats }) {
  const [stat, setStat] = useState<TeamLineStat>('corners');
  const [side, setSide] = useState<Side>('over');
  const [line, setLine] = useState(9.5);
  const cfg = TEAM_LINE_STATS.find(x => x.value === stat)!;
  const ln = cfg.lines.includes(line) ? line : cfg.lines[Math.floor(cfg.lines.length / 2)];
  const rows = teamLines(s, stat, ln, side);
  return (
    <>
      <LineControls stats={TEAM_LINE_STATS} stat={stat} setStat={setStat} side={side} setSide={setSide} lines={cfg.lines} line={ln} setLine={setLine} />
      <p className="text-xs text-zinc-500">{lineLabel(side, ln)} {cfg.label.toLowerCase()} en cada partido del equipo. {LINE_NOTE}</p>
      <section className={cn(panelCls, 'overflow-hidden')}>
        <LineHead what="Equipo" />
        <ul className="divide-y divide-zinc-800/60">
          {rows.map((t, i) => <LineRow key={t.id} i={i} logo={t.logo} name={t.name} sub="" hits={t.hits} n={t.n} rate={t.rate} avg={t.avg} last={t.last} />)}
        </ul>
      </section>
    </>
  );
}
