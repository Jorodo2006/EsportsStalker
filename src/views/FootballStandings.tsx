// Fútbol · Clasificaciones: la tabla de cada liga y la fase de liga de las competiciones europeas (la Copa no tiene)
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FootballLeagueId } from '@/lib/types';
import { StandingsTable } from '@/components/football';
import { ErrorBox, Loading, PageHeader, Tabs } from '@/components/ui';
import { SeasonStats } from '@/views/football/SeasonStats';
import { TvTabs } from '@/components/viz';

const LEAGUES: { value: FootballLeagueId; label: string }[] = [
  { value: 'laliga', label: 'LaLiga' }, { value: 'premier', label: 'Premier' }, { value: 'seriea', label: 'Serie A' },
  { value: 'bundesliga', label: 'Bundesliga' }, { value: 'ligue1', label: 'Ligue 1' }, { value: 'segunda', label: 'Segunda' }, { value: 'aleague', label: 'A-League' }, { value: 'nations', label: 'Nations League' },
  { value: 'champions', label: 'Champions' }, { value: 'europa', label: 'Europa League' }, { value: 'conference', label: 'Conference' },
  { value: 'ligaf', label: 'Liga F' }, { value: 'wsl', label: 'WSL' }, { value: 'wchampions', label: 'Champions Femenina' }
];

// Sin tabla, pero con estadísticas de la temporada
const STATS_ONLY: { value: FootballLeagueId; label: string }[] = [{ value: 'copa', label: 'Copa del Rey' }, { value: 'amistosos', label: 'Amistosos' }];

export default function FootballStandings() {
  const [league, setLeague] = useState<FootballLeagueId>(() => {
    try { const v = localStorage.getItem('football-table'); return [...LEAGUES, ...STATS_ONLY].some(l => l.value === v) ? v as FootballLeagueId : 'laliga'; } catch { return 'laliga'; }
  });
  const pick = (l: FootballLeagueId) => { setLeague(l); try { localStorage.setItem('football-table', l); } catch { /* sin almacenamiento */ } };
  // Clasificación, o las estadísticas de la temporada por jugador y por equipo (views/football/SeasonStats.tsx). Se recuerda
  const [mode, setModeState] = useState<'table' | 'players' | 'teams'>(() => {
    try { const v = localStorage.getItem('football-table-mode'); return v === 'players' || v === 'teams' ? v : 'table'; } catch { return 'table'; }
  });
  const setMode = (v: 'table' | 'players' | 'teams') => { setModeState(v); try { localStorage.setItem('football-table-mode', v); } catch { /* sin almacenamiento */ } };
  // La Copa y los amistosos no tienen tabla: en Clasificación, la primera liga
  const shown = mode === 'table' && !LEAGUES.some(l => l.value === league) ? 'laliga' : league;
  const q = useQuery({ queryKey: ['football', 'standings', shown], queryFn: () => window.api.football.standings(shown), staleTime: 15 * 60e3, enabled: mode === 'table' });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Clasificaciones" subtitle="Tabla de cada liga y estadísticas de la temporada: tiros, tarjetas y córneres" />
      <Tabs value={mode} onChange={setMode} items={[{ value: 'table', label: 'Clasificación' }, { value: 'players', label: 'Jugadores' }, { value: 'teams', label: 'Equipos' }]} />
      <TvTabs value={shown} onChange={pick} items={mode === 'table' ? LEAGUES : [...LEAGUES, ...STATS_ONLY]} />
      {mode !== 'table' ? <SeasonStats league={league} kind={mode} />
        : q.isLoading ? <Loading label="Cargando la clasificación…" /> : q.error ? <ErrorBox error={q.error} /> : <StandingsTable groups={q.data ?? []} />}
    </div>
  );
}
