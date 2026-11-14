// Piezas comunes de la vista de fútbol y de su ficha
import type { MatchState } from '@/components/sport';
import type { FootballDetail, FootballMatch } from '@/lib/types';

export const stateOf = (g: FootballMatch): MatchState => (g.state === 'in' ? 'live' : g.state);

// Posiciones y jugadores de las alineaciones (los usan el campo y la ficha del jugador)
// Posiciones de ESPN (en inglés, con el lado detrás: "CD-R") a las abreviaturas de aquí; el banquillo no lleva
const POS: Record<string, string> = {
  G: 'POR', GK: 'POR', RB: 'LD', LB: 'LI', CB: 'DFC', CD: 'DFC', RWB: 'CAD', LWB: 'CAI', DM: 'MCD', CDM: 'MCD', CM: 'MC', AM: 'MCO', CAM: 'MCO',
  RM: 'MD', LM: 'MI', RW: 'ED', LW: 'EI', F: 'DC', CF: 'DC', ST: 'DC', RCF: 'DC', LCF: 'DC', SS: 'SD'
};
export const posEs = (p: string) => (p === 'SUB' ? '' : POS[p.split('-')[0]] ?? p);
export type LineupPlayer = FootballDetail['lineups'][number]['players'][number];
export const baseOf = (pos: string) => pos.toUpperCase().split('-')[0];
