// Cliente del backend para el navegador: la web y el gateway van por el mismo origen (/api y /events).
// Se publica en window.api para que las vistas no tengan que saber cómo se habla con el backend.
import marcador from '../../chrome/bookmarklet/marcador.js?raw';
import { fromCsv, toCsv } from './csv';
import type { Api, AutoJob, TeamRef } from './types';

const DOWN = 'El servidor no responde. Arranca el backend con «npm run backend» (hace falta Docker Desktop encendido).';
const TIMEOUT = 180e3; // las stats esperan en la cola de Leaguepedia

// Devuelve any porque cada respuesta la tipa la interfaz Api
async function call(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('El servidor tarda demasiado en responder');
    throw new Error(DOWN);
  }
  // Sesión caducada o cerrada desde otro sitio: AuthGate vuelve a la pantalla de entrada
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth:lost'));
  const j = await res.json().catch(() => null);
  // nginx responde 502 sin JSON cuando el gateway está parado
  if (!j) throw new Error(res.status === 502 ? DOWN : `El servidor ha respondido HTTP ${res.status}`);
  if (j.ok === false) throw new Error(j.error || 'Error del servidor');
  return j.data;
}

const get = (path: string, params?: Record<string, unknown>) => {
  const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return call('GET', q ? `${path}?${q}` : path);
};
const part = encodeURIComponent;

type MatchRef = { a?: TeamRef; b?: TeamRef; start?: string; sport?: string; league?: string };
const team = (t?: TeamRef) => ({ name: t?.name, code: t?.code, ...(t?.alt?.length ? { alt: t.alt } : {}) });
// sport y league: el lector de Docker busca el partido en la sección de ese deporte
const matchOf = (m?: MatchRef) => ({ a: team(m?.a), b: team(m?.b), start: m?.start, ...(m?.sport ? { sport: m.sport, league: m.league } : {}) });

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Pide un fichero al usuario; null si cancela
function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ---------- Avisos en vivo (SSE): cuotas nuevas y progreso de los trabajos ----------
const onAuto = new Set<(job: AutoJob) => void>();
const onImported = new Set<() => void>();
const onSettled = new Set<() => void>();
const onStatus = new Set<(up: boolean) => void>();
let source: EventSource | null = null;
let connected = false;

function setConnected(up: boolean) {
  if (up === connected) return;
  connected = up;
  onStatus.forEach(cb => cb(up));
}

function connect() {
  source = new EventSource('/events');
  source.onopen = () => setConnected(true);
  source.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === 'odds:imported') onImported.forEach(cb => cb());
      else if (ev.type === 'odds:auto') onAuto.forEach(cb => cb(ev.data));
      else if (ev.type === 'bets:settled') onSettled.forEach(cb => cb());
    } catch { /* un aviso mal formado no debe romper la conexión */ }
  };
  // Con un 502 del proxy el navegador no reintenta por sí mismo: hay que volver a conectar a mano
  source.onerror = () => { source?.close(); setConnected(false); setTimeout(connect, 3000); };
}

function listen<T>(set: Set<T>, cb: T) {
  if (!source) connect();
  set.add(cb);
  return () => { set.delete(cb); };
}

export const api: Api = {
  auth: {
    me: () => get('/api/auth/me'),
    config: () => get('/api/auth/config'),
    login: (username, password) => call('POST', '/api/auth/login', { username, password }),
    register: (username, password) => call('POST', '/api/auth/register', { username, password }),
    logout: () => call('POST', '/api/auth/logout', {}),
    changePassword: (current, next) => call('POST', '/api/auth/password', { current, next })
  },
  settings: { get: () => get('/api/settings'), set: p => call('PUT', '/api/settings', p) },
  bets: {
    list: () => get('/api/bets'),
    save: b => call('POST', '/api/bets', b),
    delete: id => call('DELETE', `/api/bets/${part(id)}`),
    settle: () => call('POST', '/api/bets/settle', {}),
    export: async () => {
      const name = `apuestas-${new Date().toISOString().slice(0, 10)}.csv`;
      download(name, toCsv(await get('/api/bets')));
      return name;
    },
    import: async () => {
      const file = await pickFile('.csv,.json');
      if (!file) return 0;
      const raw = await file.text();
      return call('POST', '/api/bets/import', { list: file.name.toLowerCase().endsWith('.json') ? JSON.parse(raw) : fromCsv(raw) });
    }
  },
  esports: {
    leagues: () => get('/api/esports/leagues'),
    schedule: o => get('/api/esports/schedule', { leagueIds: (o?.leagueIds || []).join(','), pageToken: o?.pageToken }),
    live: () => get('/api/esports/live'),
    eventDetails: id => get(`/api/esports/events/${part(id)}`),
    liveWindow: id => get(`/api/esports/live-window/${part(id)}`)
  },
  stats: {
    searchPlayers: q => get('/api/stats/players', { q }),
    searchTeams: q => get('/api/stats/teams', { q }),
    resolveTeam: (name, code) => get('/api/stats/resolve-team', { name, code }),
    playerGames: page => get('/api/stats/player-games', { page }),
    teamGames: t => get('/api/stats/team-games', { team: t }),
    teamRoster: t => get('/api/stats/team-roster', { team: t }),
    teamForm: (name, code) => get('/api/stats/team-form', { name, code })
  },
  odds: {
    match: (m, opts) => call('POST', '/api/odds/match', { match: matchOf(m), quiet: !!opts?.quiet }),
    board: events => call('POST', '/api/odds/board', { events }),
    // Botón "Actualizar cuotas": crea el trabajo; lo recoge el lector de Docker en unos segundos
    auto: m => call('POST', '/api/odds/jobs', { match: matchOf(m) }),
    autoStatus: () => get('/api/odds/auto/status')
  },
  football: {
    leagues: () => get('/api/football/leagues'),
    games: date => get('/api/football/games', { date }),
    days: (from, n) => get('/api/football/days', { from, n }),
    live: () => get('/api/football/live'),
    match: id => get('/api/football/match', { id }),
    playerStats: (match, team, player) => get('/api/football/player-stats', { match, team, player }),
    photo: (id, name, team) => get('/api/football/photo', { id, name, team }),
    photos: players => call('POST', '/api/football/photos', { players }),
    standings: league => get(`/api/football/standings/${part(league)}`)
  },
  tennis: {
    games: date => get('/api/tennis/games', { date }),
    days: (from, n) => get('/api/tennis/days', { from, n }),
    live: () => get('/api/tennis/live'),
    rankings: tour => get(`/api/tennis/rankings/${part(tour)}`),
    player: (tour, id) => get(`/api/tennis/player/${part(tour)}/${part(id)}`),
    profile: (tour, id) => get(`/api/tennis/profile/${part(tour)}/${part(id)}`),
    stats: (tour, id) => get(`/api/tennis/stats/${part(tour)}/${part(id)}`),
    surface: (tour, name, city) => get(`/api/tennis/surface/${part(tour)}`, { name, city }),
    picks: (date, id) => get('/api/tennis/picks', { date, id }),
    picksDay: date => get('/api/tennis/picks/day', { date })
  },
  basket: {
    leagues: () => get('/api/basket/leagues'),
    games: date => get('/api/basket/games', { date }),
    days: (from, n) => get('/api/basket/days', { from, n }),
    live: () => get('/api/basket/live'),
    roster: (league, t) => get(`/api/basket/roster/${part(league)}/${part(t)}`),
    standings: league => get(`/api/basket/standings/${part(league)}`),
    team: (league, t) => get(`/api/basket/team/${part(league)}/${part(t)}`),
    leagueGames: league => get(`/api/basket/league-games/${part(league)}`),
    colors: league => get(`/api/basket/colors/${part(league)}`),
    teamLogs: (league, t) => get(`/api/basket/team-logs/${part(league)}/${part(t)}`),
    injuries: () => get('/api/basket/injuries'),
    boxscore: id => get(`/api/basket/boxscore/${part(id)}`),
    playerGame: (gameId, playerId) => get(`/api/basket/player-game/${part(gameId)}/${part(playerId)}`),
    search: q => get('/api/basket/search', { q }),
    gamelog: (league, id, t) => get(`/api/basket/gamelog/${part(league)}/${part(id)}`, { team: t })
  },
  onOddsAuto: cb => listen(onAuto, cb),
  marcador: {
    url: async () => 'javascript:' + part(marcador.replace(/__PORT__/g, '47365').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')),
    paste: async m => {
      let data: unknown;
      try { data = JSON.parse(await navigator.clipboard.readText()); } catch { throw new Error('El portapapeles no tiene cuotas del marcador'); }
      return call('POST', '/api/odds/paste', { match: m ? matchOf(m) : null, data });
    }
  },
  onOddsImported: cb => listen(onImported, cb),
  onBetsSettled: cb => listen(onSettled, cb),
  backend: { status: () => get('/api/health') },
  onBackendStatus: cb => listen(onStatus, cb),
  openExternal: async url => { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener'); }
};
