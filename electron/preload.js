// Puente seguro entre la interfaz y el proceso principal (que es quien habla con el backend y con internet)
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  settings: { get: () => call('settings:get'), set: p => call('settings:set', p) },
  bets: {
    list: () => call('bets:list'),
    save: b => call('bets:save', b),
    delete: id => call('bets:delete', id),
    export: () => call('bets:export'),
    import: () => call('bets:import')
  },
  esports: {
    leagues: () => call('esports:leagues'),
    schedule: o => call('esports:schedule', o),
    live: () => call('esports:live'),
    eventDetails: id => call('esports:eventDetails', id),
    liveWindow: id => call('esports:liveWindow', id)
  },
  stats: {
    searchPlayers: q => call('stats:searchPlayers', q),
    searchTeams: q => call('stats:searchTeams', q),
    resolveTeam: (name, code) => call('stats:resolveTeam', name, code),
    playerGames: p => call('stats:playerGames', p),
    teamGames: t => call('stats:teamGames', t),
    teamRoster: t => call('stats:teamRoster', t),
    teamForm: (name, code) => call('stats:teamForm', name, code)
  },
  odds: {
    match: (m, opts) => call('odds:match', m, opts), board: evs => call('odds:board', evs), auto: m => call('odds:auto', m),
    autoStatus: () => call('odds:autoStatus')
  },
  tennis: {
    games: date => call('tennis:games', date),
    days: (from, n) => call('tennis:days', from, n),
    live: () => call('tennis:live'),
    rankings: tour => call('tennis:rankings', tour),
    player: (tour, id) => call('tennis:player', tour, id),
    profile: (tour, id) => call('tennis:profile', tour, id),
    stats: (tour, id) => call('tennis:stats', tour, id),
    surface: (tour, name, city) => call('tennis:surface', tour, name, city),
    picks: (date, id) => call('tennis:picks', date, id),
    picksDay: date => call('tennis:picksDay', date)
  },
  basket: {
    leagues: () => call('basket:leagues'),
    games: date => call('basket:games', date),
    days: (from, n) => call('basket:days', from, n),
    live: () => call('basket:live'),
    roster: (league, team) => call('basket:roster', league, team),
    standings: league => call('basket:standings', league),
    team: (league, team) => call('basket:team', league, team),
    leagueGames: league => call('basket:leagueGames', league),
    teamLogs: (league, team) => call('basket:teamLogs', league, team),
    injuries: () => call('basket:injuries'),
    boxscore: id => call('basket:boxscore', id),
    search: q => call('basket:search', q),
    gamelog: (league, id, team) => call('basket:gamelog', league, id, team)
  },
  extension: { folder: () => call('extension:folder'), open: () => call('extension:open') },
  // Progreso del botón "Actualizar cuotas" (lo hace la extensión de Chrome)
  onOddsAuto: cb => { const h = (_e, job) => cb(job); ipcRenderer.on('odds:auto', h); return () => ipcRenderer.removeListener('odds:auto', h); },
  marcador: { url: () => call('marcador:url'), paste: m => call('marcador:paste', m) },
  // Avisa a la interfaz cuando llegan cuotas nuevas desde el marcador
  onOddsImported: cb => { const h = () => cb(); ipcRenderer.on('odds:imported', h); return () => ipcRenderer.removeListener('odds:imported', h); },
  // Estado del backend (gateway + servicios en Docker) y aviso cuando se conecta o se cae
  backend: { status: () => call('backend:status') },
  onBackendStatus: cb => { const h = (_e, up) => cb(up); ipcRenderer.on('backend:status', h); return () => ipcRenderer.removeListener('backend:status', h); },
  openExternal: url => call('open:external', url)
});
