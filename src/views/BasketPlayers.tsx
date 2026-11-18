// Baloncesto · Jugadores, equipos y líneas: buscador de NBA, Euroliga y EuroCup con el analizador de líneas del jugador elegido,
// la clasificación y los puntos de cada liga con la ficha de cada equipo, y el escáner que ordena a los jugadores para una línea
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, User } from 'lucide-react';
import { BasketAnalyzer, LEAGUE_NAME, esTime, type Picked } from '@/components/BasketAnalyzer';
import { useUpcomingGames } from '@/components/BasketRange';
import { Roster } from './BasketMatches';
import { LeaguePoints } from '@/components/BasketPoints';
import { BasketStandings, BasketTeamSheet } from '@/components/BasketTeamSheet';
import BasketLines from './BasketLines';
import type { BasketGame, BasketLeagueId } from '@/lib/types';
import { Empty, Input, PageHeader, Tabs, chip } from '@/components/ui';
import { sized } from '@/lib/img';
import { useBackLayer } from '@/lib/history';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function BasketPlayers() {
  const [player, setPlayer] = useState<Picked | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'players' | 'teams' | 'lines'>('players');
  const [teamView, setTeamView] = useState<'standings' | 'points'>('standings');
  const [league, setLeague] = useState<BasketLeagueId>('nba');
  const [team, setTeam] = useState<string | null>(null);
  // La ficha del equipo se cierra también con atrás del navegador
  useBackLayer(mode === 'teams' && !!team, () => setTeam(null));
  const dq = useDebounced(q.trim(), 400);
  const ok = !!window.api.basket;
  const injuries = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), staleTime: 10 * 60e3, enabled: ok });
  const r = useQuery({ queryKey: ['basket', 'search', dq], queryFn: () => window.api.basket.search(dq), enabled: ok && dq.length >= 2, staleTime: 10 * 60e3 });

  const switcher = <Tabs value={mode} onChange={setMode} items={[{ value: 'players', label: 'Jugadores' }, { value: 'teams', label: 'Equipos' }, { value: 'lines', label: 'Líneas' }]} />;
  if (mode === 'lines') return (
    <>
      <PageHeader title="Líneas" subtitle="Pon una línea y mira qué jugadores tienen más probabilidad de superarla">{switcher}</PageHeader>
      <BasketLines />
    </>
  );
  if (mode === 'teams') {
    if (team) return <BasketTeamSheet key={`${league}:${team}`} league={league} teamId={team} onBack={() => setTeam(null)}
      onPlayer={(p, teamId) => { setPlayer({ id: p.id, name: p.name, league, headshot: p.headshot, teamId }); setMode('players'); setTeam(null); }} />;
    return (
      <>
        <PageHeader title="Equipos" subtitle={teamView === 'points' ? 'Puntos anotados, encajados y totales de cada equipo' : 'Clasificación por liga'}>
          {switcher}
          <Tabs value={teamView} onChange={setTeamView} items={[{ value: 'standings', label: 'Clasificación' }, { value: 'points', label: 'Puntos' }]} />
          <Tabs value={league} onChange={setLeague} items={(['nba', 'euroleague', 'eurocup', 'nbl', 'wnba'] as BasketLeagueId[]).map(l => ({ value: l, label: LEAGUE_NAME[l] }))} />
        </PageHeader>
        {teamView === 'points' ? <LeaguePoints key={league} league={league} onTeam={setTeam} /> : <BasketStandings league={league} onTeam={setTeam} />}
      </>
    );
  }
  return (
    <>
      <PageHeader title="Jugadores" subtitle="Busca un jugador de la NBA, la Euroliga o la EuroCup y mira si su línea tiene valor">
        {switcher}
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input autoFocus className="w-full pl-9 sm:w-80" placeholder="Nombre del jugador" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </PageHeader>
      {dq.length >= 2 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {r.isFetching && <span className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" />Buscando…</span>}
          {!r.isFetching && !r.data?.length && <span className="text-sm text-zinc-500">Nadie con ese nombre en las plantillas de esta temporada</span>}
          {r.data?.map(p => (
            <button key={`${p.league}:${p.id}`} onClick={() => { setPlayer({ id: p.id, name: p.name, league: p.league, headshot: p.headshot, teamId: p.teamId }); setQ(''); }}
              className="flex cursor-pointer items-center gap-2.5 rounded-md bg-zinc-800 py-1.5 pl-1.5 pr-4 text-left transition hover:bg-zinc-700">
              {p.headshot ? <img loading="lazy" decoding="async" src={sized(p.headshot, 32)} alt="" className="h-8 w-8 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="h-8 w-8 rounded-full bg-zinc-800" />}
              <div className="leading-tight"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-zinc-500">{LEAGUE_NAME[p.league]}, {p.team}</div></div>
            </button>
          ))}
        </div>
      )}
      {player
        ? <BasketAnalyzer key={`${player.league}:${player.id}`} player={player} games={player.game ? [player.game] : undefined} injuries={injuries.data ?? []} />
        : <TodayPlayers onPick={setPlayer} />}
    </>
  );
}

// Sin jugador elegido, los partidos de las próximas 24 horas con sus plantillas, para elegir uno sin saberse el nombre. Antes
// la pantalla se quedaba en blanco hasta escribir dos letras
function TodayPlayers({ onPick }: { onPick: (p: Picked) => void }) {
  const u = useUpcomingGames();
  const [sel, setSel] = useState<string | null>(null);
  const game = u.games.find(g => g.id === sel) ?? u.games[0] ?? null;
  if (!game) return <Empty icon={<User size={26} />}>Escribe al menos dos letras del nombre del jugador.</Empty>;
  const pick = (g: BasketGame) => (p: { id: string; name: string; headshot?: string }, teamId: string) =>
    onPick({ id: p.id, name: p.name, league: g.league, headshot: p.headshot, teamId, game: g });
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm text-zinc-400">O elige un partido de las próximas 24 horas y uno de sus jugadores:</p>
      <div className="fade-r -mx-3 flex gap-1.5 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
        {u.games.map(g => (
          <button key={g.id} type="button" onClick={() => setSel(g.id)} aria-pressed={g.id === game.id} className={chip(g.id === game.id)}>
            {g.away.abbr} @ {g.home.abbr}<span className="text-zinc-500 tnum">{esTime(g.date)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Roster game={game} side="away" injuries={u.injuries} onPick={pick(game)} />
        <Roster game={game} side="home" injuries={u.injuries} onPick={pick(game)} />
      </div>
    </div>
  );
}
