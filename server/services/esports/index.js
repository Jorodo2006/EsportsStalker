// esports-svc: calendario, directo y detalle (lolesports.com) y stats de jugadores y equipos (Leaguepedia)
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const client = require('../../shared/client');
const env = require('../../shared/env');
const lolesports = require('./lolesports');
const leaguepedia = require('./leaguepedia');

// Clave pública que usa la propia web de lolesports (por si bets-svc no responde)
const DEFAULT_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

async function s() {
  const st = await client.settings().catch(() => env.settings());
  return { lolesportsKey: DEFAULT_KEY, ...st };
}
const key = async () => (await s()).lolesportsKey;
// Antes de cada consulta a Leaguepedia, por si han cambiado las credenciales en Ajustes
const lp = fn => async ctx => { leaguepedia.configure(await s()); return fn(ctx); };
const need = (v, what) => { if (!v) throw fail(`Falta ${what}`); return v; };

const routes = [
  ['GET', '/api/esports/leagues', async () => lolesports.getLeagues(await key())],
  ['GET', '/api/esports/schedule', async ({ query: q }) => lolesports.getSchedule(await key(), {
    leagueIds: q.leagueIds ? q.leagueIds.split(',').filter(Boolean) : [], pageToken: q.pageToken || undefined
  })],
  ['GET', '/api/esports/live', async () => lolesports.getLive(await key())],
  ['GET', '/api/esports/events/:id', async ({ params }) => lolesports.getEventDetails(await key(), params.id)],
  ['GET', '/api/esports/live-window/:gameId', ({ params }) => lolesports.getLiveWindow(params.gameId)],

  ['GET', '/api/stats/players', lp(({ query: q }) => leaguepedia.searchPlayers(q.q))],
  ['GET', '/api/stats/teams', lp(({ query: q }) => leaguepedia.searchTeams(q.q))],
  ['GET', '/api/stats/resolve-team', lp(({ query: q }) => leaguepedia.resolveTeam(need(q.name, 'el equipo'), q.code))],
  ['GET', '/api/stats/player-games', lp(({ query: q }) => leaguepedia.playerGames(need(q.page, 'el jugador')))],
  ['GET', '/api/stats/team-games', lp(({ query: q }) => leaguepedia.teamGames(need(q.team, 'el equipo')))],
  ['GET', '/api/stats/team-form', lp(({ query: q }) => leaguepedia.teamForm(need(q.name, 'el equipo'), q.code))],
  ['GET', '/api/stats/team-roster', lp(({ query: q }) => leaguepedia.teamRoster(need(q.team, 'el equipo')))]
];

migrate('esports', path.join(__dirname, 'migrations'))
  .then(() => leaguepedia.init())
  .then(() => start({ name: 'esports', port: Number(process.env.PORT) || 4001, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
