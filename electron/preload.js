// Puente seguro entre la interfaz y el proceso principal (que es quien hace las peticiones a internet)
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
    teamRoster: t => call('stats:teamRoster', t)
  },
  odds: { match: m => call('odds:match', m), board: evs => call('odds:board', evs), auto: m => call('odds:auto', m) },
  extension: { folder: () => call('extension:folder'), open: () => call('extension:open') },
  // Progreso del botón "Actualizar cuotas" (lo hace la extensión de Chrome)
  onOddsAuto: cb => { const h = (_e, job) => cb(job); ipcRenderer.on('odds:auto', h); return () => ipcRenderer.removeListener('odds:auto', h); },
  marcador: { url: () => call('marcador:url'), paste: m => call('marcador:paste', m) },
  // Avisa a la interfaz cuando llegan cuotas nuevas desde el marcador
  onOddsImported: cb => { const h = () => cb(); ipcRenderer.on('odds:imported', h); return () => ipcRenderer.removeListener('odds:imported', h); },
  openExternal: url => call('open:external', url)
});
