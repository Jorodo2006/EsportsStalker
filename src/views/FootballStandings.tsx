// Fútbol · Clasificaciones: la tabla de cada liga y la fase de liga de las competiciones europeas (la Copa no tiene)
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FootballLeagueId } from '@/lib/types';
import { StandingsTable } from '@/components/football';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { TvTabs } from '@/components/viz';

const LEAGUES: { value: FootballLeagueId; label: string }[] = [
  { value: 'laliga', label: 'LaLiga' }, { value: 'premier', label: 'Premier' }, { value: 'seriea', label: 'Serie A' },
  { value: 'bundesliga', label: 'Bundesliga' }, { value: 'ligue1', label: 'Ligue 1' }, { value: 'segunda', label: 'Segunda' }, { value: 'nations', label: 'Nations League' },
  { value: 'champions', label: 'Champions' }, { value: 'europa', label: 'Europa League' }, { value: 'conference', label: 'Conference' },
  { value: 'ligaf', label: 'Liga F' }, { value: 'wsl', label: 'WSL' }, { value: 'wchampions', label: 'Champions Femenina' }
];

export default function FootballStandings() {
  const [league, setLeague] = useState<FootballLeagueId>(() => {
    try { const v = localStorage.getItem('football-table'); return LEAGUES.some(l => l.value === v) ? v as FootballLeagueId : 'laliga'; } catch { return 'laliga'; }
  });
  const pick = (l: FootballLeagueId) => { setLeague(l); try { localStorage.setItem('football-table', l); } catch { /* sin almacenamiento */ } };
  const q = useQuery({ queryKey: ['football', 'standings', league], queryFn: () => window.api.football.standings(league), staleTime: 15 * 60e3 });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Clasificaciones" subtitle="Tabla de cada liga y fase de liga de las competiciones europeas" />
      <TvTabs value={league} onChange={pick} items={LEAGUES} />
      {q.isLoading ? <Loading label="Cargando la clasificación…" /> : q.error ? <ErrorBox error={q.error} /> : <StandingsTable groups={q.data ?? []} />}
    </div>
  );
}
