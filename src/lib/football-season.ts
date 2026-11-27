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

// ---------- Líneas: «más de 1,5 remates en 7 de sus 9 partidos» ----------
// Lo que se mira en cada partido (los índices de log, server/services/football/season.js) y las líneas típicas de las casas
export type PlayerLineStat = 'shots' | 'onTarget' | 'fouls' | 'fouled' | 'cards';
export const PLAYER_LINE_STATS: { value: PlayerLineStat; label: string; idx: number; lines: number[] }[] = [
  { value: 'shots', label: 'Remates', idx: 0, lines: [0.5, 1.5, 2.5, 3.5] },
  { value: 'onTarget', label: 'Remates a puerta', idx: 1, lines: [0.5, 1.5, 2.5] },
  { value: 'fouls', label: 'Faltas hechas', idx: 2, lines: [0.5, 1.5, 2.5] },
  { value: 'fouled', label: 'Faltas recibidas', idx: 3, lines: [0.5, 1.5, 2.5] },
  { value: 'cards', label: 'Tarjetas', idx: 4, lines: [0.5] }
];
export type TeamLineStat = 'corners' | 'cornersFor' | 'cornersAgainst' | 'cards' | 'shots';
// of: el valor de un partido sacado de log
export const TEAM_LINE_STATS: { value: TeamLineStat; label: string; of: (x: number[]) => number; lines: number[] }[] = [
  { value: 'corners', label: 'Córneres del partido', of: x => x[0] + x[1], lines: [7.5, 8.5, 9.5, 10.5, 11.5] },
  { value: 'cornersFor', label: 'Córneres a favor', of: x => x[0], lines: [2.5, 3.5, 4.5, 5.5, 6.5] },
  { value: 'cornersAgainst', label: 'Córneres en contra', of: x => x[1], lines: [2.5, 3.5, 4.5, 5.5, 6.5] },
  { value: 'cards', label: 'Tarjetas del partido', of: x => x[2] + x[3], lines: [2.5, 3.5, 4.5, 5.5, 6.5] },
  { value: 'shots', label: 'Remates', of: x => x[4], lines: [8.5, 10.5, 12.5, 14.5] }
];
export type Side = 'over' | 'under';
const hit = (v: number, line: number, side: Side) => (side === 'over' ? v > line : v < line);

// Una fila de línea: en cuántos partidos se cumplió, la media y los últimos 5 (de más antiguo a más reciente, con si se cumplió)
function lineRow(values: number[], line: number, side: Side) {
  const hits = values.filter(v => hit(v, line, side)).length;
  return {
    hits, n: values.length, rate: values.length ? hits / values.length : 0, avg: values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0,
    last: values.slice(-5).map(v => ({ v, ok: hit(v, line, side) }))
  };
}

// Por porcentaje de partidos que la cumplen y, a igualdad, por más partidos (7 de 7 vale más que 2 de 2)
const byRate = (a: { rate: number; n: number }, b: { rate: number; n: number }) => b.rate - a.rate || b.n - a.n;

export function playerLines(stats: FootballSeasonStats, stat: PlayerLineStat, line: number, side: Side, minGames: number, q = '') {
  const idx = PLAYER_LINE_STATS.find(s => s.value === stat)!.idx;
  const teams = new Map(stats.teams.map(t => [t.id, t]));
  const f = fold(q.trim());
  return stats.players
    .filter(p => p.games >= minGames && (!f || fold(p.name).includes(f) || fold(teams.get(p.team)?.name ?? '').includes(f)))
    .map(p => ({ ...p, teamName: teams.get(p.team)?.name ?? '', logo: teams.get(p.team)?.logo ?? '', ...lineRow((p.log ?? []).map(x => x[idx]), line, side) }))
    .sort((a, b) => byRate(a, b) || a.name.localeCompare(b.name));
}

export function teamLines(stats: FootballSeasonStats, stat: TeamLineStat, line: number, side: Side) {
  const of = TEAM_LINE_STATS.find(s => s.value === stat)!.of;
  return stats.teams.map(t => ({ ...t, ...lineRow((t.log ?? []).map(of), line, side) })).sort((a, b) => byRate(a, b) || a.name.localeCompare(b.name));
}
