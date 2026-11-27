import type { FootballSeasonPlayer, FootballSeasonStats, FootballSeasonTeam } from '@/lib/types';

// Las tablas de la temporada del fútbol (src/views/football/SeasonStats.tsx): orden, mínimo de partidos y medias por partido.
// Pruebas en football-season.test.ts

const per = (v: number, g: number) => (g ? v / g : 0);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type PlayerSort = 'shots' | 'onTarget' | 'goals' | 'cards' | 'fouls';
// Lo que mide cada orden: por partido (tiros, a puerta, faltas) o total (goles; tarjetas: la roja cuenta como dos amarillas)
export const PLAYER_SORTS: { value: PlayerSort; label: string; of: (p: FootballSeasonPlayer) => number }[] = [
  { value: 'shots', label: 'Tiros', of: p => per(p.shots, p.games) },
  { value: 'onTarget', label: 'A puerta', of: p => per(p.shotsOnTarget, p.games) },
  { value: 'goals', label: 'Goles', of: p => p.goals },
  { value: 'cards', label: 'Tarjetas', of: p => p.yellow + 2 * p.red },
  { value: 'fouls', label: 'Faltas', of: p => per(p.fouls, p.games) }
];

export function playerRows(stats: FootballSeasonStats, sort: PlayerSort, minGames: number, q = '') {
  const of = PLAYER_SORTS.find(s => s.value === sort)!.of;
  const teams = new Map(stats.teams.map(t => [t.id, t]));
  const f = fold(q.trim());
  return stats.players
    .filter(p => p.games >= minGames && (!f || fold(p.name).includes(f) || fold(teams.get(p.team)?.name ?? '').includes(f)))
    .map(p => ({ ...p, teamName: teams.get(p.team)?.name ?? '', logo: teams.get(p.team)?.logo ?? '', value: of(p) }))
    .sort((a, b) => b.value - a.value || b.games - a.games || a.name.localeCompare(b.name));
}

export type TeamSort = 'corners' | 'cornersFor' | 'cornersAgainst' | 'cards' | 'shots';
// Por partido. «Córneres» y «Tarjetas» son las del partido entero (las suyas y las del rival): lo que se apuesta en un total
export const TEAM_SORTS: { value: TeamSort; label: string; of: (t: FootballSeasonTeam) => number }[] = [
  { value: 'corners', label: 'Córneres del partido', of: t => per(t.cornersFor + t.cornersAgainst, t.games) },
  { value: 'cornersFor', label: 'Córneres a favor', of: t => per(t.cornersFor, t.games) },
  { value: 'cornersAgainst', label: 'Córneres en contra', of: t => per(t.cornersAgainst, t.games) },
  { value: 'cards', label: 'Tarjetas del partido', of: t => per(t.yellow + t.yellowAgainst, t.games) },
  { value: 'shots', label: 'Tiros', of: t => per(t.shots, t.games) }
];

export function teamRows(stats: FootballSeasonStats, sort: TeamSort) {
  const of = TEAM_SORTS.find(s => s.value === sort)!.of;
  return stats.teams.map(t => ({ ...t, value: of(t) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

// Media de la competición por partido (cada partido sale dos veces, una por equipo)
export function leagueAverages(stats: FootballSeasonStats) {
  const games = stats.teams.reduce((s, t) => s + t.games, 0) / 2;
  const sum = (f: (t: FootballSeasonTeam) => number) => stats.teams.reduce((s, t) => s + f(t), 0);
  return { games, corners: per(sum(t => t.cornersFor), games), yellow: per(sum(t => t.yellow), games), shots: per(sum(t => t.shots), games) };
}
