// Lo que cambia de una liga de baloncesto a otra en la interfaz
import type { BasketLeagueId } from './types';

// Las que salen de ESPN (NBA, WNBA y NBL): tienen calendario de cada equipo, jugada a jugada, descanso entre partidos y
// numeran la temporada por el año en que acaba. La Euroliga y la EuroCup salen de su propia API y no tienen nada de eso
export const espnLeague = (l: BasketLeagueId) => l === 'nba' || l === 'wnba' || l === 'nbl';

// Minutos de un partido, para saber si un compañero que falta es importante (matesOut). La WNBA y la NBL juegan cuartos de 10.
// La Euroliga y la EuroCup también, pero siempre se les ha pasado 48: se deja así hasta medirlo
export const gameMinutes = (l: BasketLeagueId) => (l === 'wnba' || l === 'nbl' ? 40 : 48);
