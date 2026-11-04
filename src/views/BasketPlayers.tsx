// Baloncesto · Jugadores y equipos: buscador de NBA, Euroliga y EuroCup con el analizador de líneas del jugador elegido,
// y la clasificación de cada liga con la ficha de cada equipo
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, User } from 'lucide-react';
import { BasketAnalyzer, LEAGUE_NAME, type Picked } from '@/components/BasketAnalyzer';
import { BasketStandings, BasketTeamSheet } from '@/components/BasketTeamSheet';
import type { BasketLeagueId } from '@/lib/types';
import { Empty, Input, PageHeader, Tabs } from '@/components/ui';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function BasketPlayers() {
  const [player, setPlayer] = useState<Picked | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'players' | 'teams'>('players');
  const [league, setLeague] = useState<BasketLeagueId>('nba');
  const [team, setTeam] = useState<string | null>(null);
  const dq = useDebounced(q.trim(), 400);
  const ok = !!window.api.basket;
  const injuries = useQuery({ queryKey: ['basket', 'injuries'], queryFn: () => window.api.basket.injuries(), staleTime: 10 * 60e3, enabled: ok });
  const r = useQuery({ queryKey: ['basket', 'search', dq], queryFn: () => window.api.basket.search(dq), enabled: ok && dq.length >= 2, staleTime: 10 * 60e3 });

  const switcher = <Tabs value={mode} onChange={setMode} items={[{ value: 'players', label: 'Jugadores' }, { value: 'teams', label: 'Equipos' }]} />;
  if (mode === 'teams') {
    if (team) return <BasketTeamSheet key={`${league}:${team}`} league={league} teamId={team} onBack={() => setTeam(null)}
      onPlayer={(p, teamId) => { setPlayer({ id: p.id, name: p.name, league, headshot: p.headshot, teamId }); setMode('players'); setTeam(null); }} />;
    return (
      <>
        <PageHeader title="Equipos" subtitle="Clasificación por liga">
          {switcher}
          <Tabs value={league} onChange={setLeague} items={(['nba', 'euroleague', 'eurocup', 'wnba'] as BasketLeagueId[]).map(l => ({ value: l, label: LEAGUE_NAME[l] }))} />
        </PageHeader>
        <BasketStandings league={league} onTeam={setTeam} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Jugadores" subtitle="Busca un jugador de la NBA, la Euroliga o la EuroCup y mira si su línea tiene valor">
        {switcher}
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input autoFocus className="w-80 pl-9" placeholder="Nombre del jugador" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </PageHeader>
      {dq.length >= 2 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {r.isFetching && <span className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" />Buscando…</span>}
          {!r.isFetching && !r.data?.length && <span className="text-sm text-zinc-500">Nadie con ese nombre en las plantillas de esta temporada</span>}
          {r.data?.map(p => (
            <button key={`${p.league}:${p.id}`} onClick={() => { setPlayer({ id: p.id, name: p.name, league: p.league, headshot: p.headshot, teamId: p.teamId }); setQ(''); }}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 py-1.5 pl-1.5 pr-3 text-left transition hover:border-zinc-700">
              {p.headshot ? <img src={p.headshot} alt="" className="h-8 w-8 rounded-full bg-zinc-800 object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="h-8 w-8 rounded-full bg-zinc-800" />}
              <div className="leading-tight"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-zinc-500">{LEAGUE_NAME[p.league]}, {p.team}</div></div>
            </button>
          ))}
        </div>
      )}
      {player
        ? <BasketAnalyzer key={`${player.league}:${player.id}`} player={player} injuries={injuries.data ?? []} />
        : <Empty icon={<User size={26} />}>Escribe al menos dos letras del nombre. También puedes abrir un partido en Partidos y elegir al jugador en su plantilla.</Empty>}
    </>
  );
}
