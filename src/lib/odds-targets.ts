// El partido de tenis y de fútbol como lo piden el lector, el comparador y el cupón. Aquí y no en sus vistas para que las
// recomendaciones (components/) lo usen sin importar las vistas, que las importan a ellas
import type { OddsTarget } from '@/components/BasketOdds';
import type { FootballMatch, FootballTeam, TennisMatch } from './types';

// El partido para el lector, el comparador y el cupón: local (a) contra visitante (b), con los mismos nombres que usa el
// programador de lecturas (server/services/odds/scheduler.js), que son la clave del partido. Sin la abreviatura entre los
// otros nombres ("VAL" está dentro de "Valladolid"); los filiales ("Real Sociedad II") en las casas son "Real Sociedad B"
const teamRef = (t: FootballTeam) => ({
  name: t.name, code: '',
  alt: [...new Set([...(/\sII$/.test(t.name) ? [t.name.replace(/\sII$/, ' B')] : []), ...(t.alts ?? []).filter(x => x && x !== t.name && x !== t.abbr)])]
});
// Sólo lo que usa: también vale con una recomendación del día, que trae el partido sin su estado
export const targetOfFootball = (m: Pick<FootballMatch, 'id' | 'home' | 'away' | 'date' | 'league' | 'leagueName'> & { state?: FootballMatch['state'] }): OddsTarget => ({
  id: m.id, done: m.state === 'post', sport: 'football', event: `${m.home.name} - ${m.away.name}`, league: m.leagueName,
  match: { a: teamRef(m.home), b: teamRef(m.away), start: m.date, sport: 'football', league: m.league }
});

// El partido para el lector, el comparador y el cupón
export const targetOfMatch = (m: TennisMatch): OddsTarget => ({
  id: m.id, done: m.state === 'post', sport: 'tennis', event: `${m.a.name} vs ${m.b.name}`, league: m.tournament,
  match: { a: { name: m.a.name, code: '', alt: m.a.alt }, b: { name: m.b.name, code: '', alt: m.b.alt }, start: m.date, sport: 'tennis', league: m.tournament }
});
