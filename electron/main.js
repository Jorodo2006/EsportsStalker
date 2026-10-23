const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const backend = require('./services/backend');
const extension = require('./services/extension');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Carpeta de la extensión de Chrome (se carga en chrome://extensions → Cargar descomprimida)
const extensionDir = () => path.join(app.isPackaged ? app.getPath('userData') : app.getAppPath(), 'extension-chrome');

// La extensión vive en Chrome: abrimos ahí la página aunque el navegador por defecto sea otro
function openInChrome(url) {
  const { spawn } = require('child_process');
  const tryRun = (cmd, args) => { try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => shell.openExternal(url)).unref(); return true; } catch (_) { return false; } };
  if (process.platform === 'win32') {
    const exe = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(f => fs.existsSync(f));
    if (exe && tryRun(exe, [url])) return;
  } else if (process.platform === 'darwin') {
    if (tryRun('open', ['-a', 'Google Chrome', url])) return;
  } else if (tryRun('google-chrome', [url])) return;
  shell.openExternal(url);
}
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#09090b',
    title: 'LoL Esports Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // En desarrollo cargamos el servidor de Vite (recarga en caliente); en producción el build de dist/
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Los enlaces externos se abren en el navegador, no dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Envuelve cada handler para que los errores lleguen al renderer como { error } en vez de romper
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

// Todo lo que antes hacían los servicios locales ahora lo hace el backend (gateway + microservicios en Docker).
// Aquí sólo quedan los diálogos de fichero, el portapapeles, Chrome y la carpeta de la extensión.
function registerIpc() {
  const { call, get } = backend;
  const team = t => ({ name: t?.name, code: t?.code });
  const matchOf = m => ({ a: team(m?.a), b: team(m?.b), start: m?.start });

  handle('settings:get', () => get('/api/settings'));
  handle('settings:set', patch => call('PUT', '/api/settings', patch));

  handle('bets:list', () => get('/api/bets'));
  handle('bets:save', bet => call('POST', '/api/bets', bet));
  handle('bets:delete', id => call('DELETE', `/api/bets/${encodeURIComponent(id)}`));

  handle('bets:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportar apuestas', defaultPath: `apuestas-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    const bets = await get('/api/bets');
    if (filePath.toLowerCase().endsWith('.json')) fs.writeFileSync(filePath, JSON.stringify(bets, null, 2));
    else fs.writeFileSync(filePath, toCsv(bets));
    return filePath;
  });

  handle('bets:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Importar apuestas', properties: ['openFile'],
      filters: [{ name: 'CSV o JSON', extensions: ['csv', 'json'] }]
    });
    if (canceled || !filePaths?.length) return 0;
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const list = filePaths[0].toLowerCase().endsWith('.json') ? JSON.parse(raw) : fromCsv(raw);
    return call('POST', '/api/bets/import', { list });
  });

  handle('esports:leagues', () => get('/api/esports/leagues'));
  handle('esports:schedule', opts => get('/api/esports/schedule', { leagueIds: (opts?.leagueIds || []).join(','), pageToken: opts?.pageToken }));
  handle('esports:live', () => get('/api/esports/live'));
  handle('esports:eventDetails', id => get(`/api/esports/events/${encodeURIComponent(id)}`));
  handle('esports:liveWindow', gameId => get(`/api/esports/live-window/${encodeURIComponent(gameId)}`));

  handle('stats:searchPlayers', q => get('/api/stats/players', { q }));
  handle('stats:searchTeams', q => get('/api/stats/teams', { q }));
  handle('stats:resolveTeam', (name, code) => get('/api/stats/resolve-team', { name, code }));
  handle('stats:playerGames', page => get('/api/stats/player-games', { page }));
  handle('stats:teamGames', t => get('/api/stats/team-games', { team: t }));
  handle('stats:teamRoster', t => get('/api/stats/team-roster', { team: t }));

  handle('odds:match', match => call('POST', '/api/odds/match', { match: matchOf(match) }));
  // Recibe [{ id, a, b, start }] del calendario y devuelve { id: { a, b } } con la cuota de ganador
  handle('odds:board', events => call('POST', '/api/odds/board', { events }));
  // Botón "Actualizar cuotas": crea el trabajo y abre en Chrome la página que activa la extensión
  handle('odds:auto', async match => {
    const job = await call('POST', '/api/odds/jobs', { match: matchOf(match) });
    openInChrome(`${backend.BASE}/auto?job=${job.id}`);
    return job;
  });
  handle('odds:autoStatus', () => get('/api/odds/auto/status'));
  // Marcador de cuotas para tu Chrome y pegado manual si el envío directo falla
  handle('marcador:url', () => extension.bookmarkletUrl());
  handle('marcador:paste', match => {
    let data;
    try { data = JSON.parse(clipboard.readText()); } catch (_) { throw new Error('El portapapeles no tiene cuotas del marcador'); }
    return call('POST', '/api/odds/paste', { match: match ? matchOf(match) : null, data });
  });
  handle('extension:folder', () => extensionDir());
  handle('extension:open', async () => { const err = await shell.openPath(extensionDir()); if (err) throw new Error(err); });

  handle('backend:status', () => get('/api/health'));
  handle('open:external', url => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
}

// Primera vez con backend: lo que había en local (data.json y casas-urls.json) pasa a la base de datos.
// Después el fichero se renombra para no volver a importarlo.
async function migrateLegacy() {
  const done = f => { try { fs.renameSync(f, `${f}.migrado-${new Date().toISOString().slice(0, 10)}`); } catch (_) {} };
  const dataFile = path.join(app.getPath('userData'), 'data.json');
  if (fs.existsSync(dataFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const r = await backend.call('POST', '/api/legacy/import', { bets: raw.bets || [], settings: raw.settings || null });
      console.log(`data.json importado: ${r.bets} apuestas${r.settings ? ' y los ajustes' : ''}`);
      done(dataFile);
    } catch (e) { console.error('No se ha podido importar data.json:', e.message); }
  }
  const urlsFile = path.join(app.isPackaged ? app.getPath('userData') : app.getAppPath(), 'casas-urls.json');
  if (fs.existsSync(urlsFile)) {
    try {
      await backend.call('POST', '/api/odds/legacy-urls', { urls: JSON.parse(fs.readFileSync(urlsFile, 'utf8')) });
      done(urlsFile);
    } catch (e) { console.error('No se ha podido importar casas-urls.json:', e.message); }
  }
}

const CSV_COLS = ['id', 'date', 'league', 'event', 'market', 'selection', 'bookmaker', 'odds', 'stake', 'status', 'cashout', 'notes', 'legs'];

function toCsv(rows) {
  const cell = v => { const t = Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [CSV_COLS.join(','), ...rows.map(r => CSV_COLS.map(c => cell(r[c])).join(','))].join('\n');
}

function fromCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c !== '')) rows.push(row);
  const [head, ...body] = rows;
  const keys = head.map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}

app.whenReady().then(() => {
  if (!DEV_URL) {
    // Política de seguridad del contenido sólo en producción (Vite en desarrollo necesita scripts inline)
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:"]
      }
    }));
  }
  registerIpc();
  createWindow();
  // Avisos del backend → interfaz (cuotas nuevas, progreso de "Actualizar cuotas" y de las lecturas programadas)
  const send = (ch, v) => win && !win.isDestroyed() && win.webContents.send(ch, v);
  let migrated = false;
  backend.events({
    onEvent: ev => {
      if (ev.type === 'odds:imported') send('odds:imported');
      else if (ev.type === 'odds:auto') send('odds:auto', ev.data);
    },
    onConnect: () => {
      send('backend:status', true);
      if (!migrated) { migrated = true; migrateLegacy(); }
    },
    onDisconnect: () => send('backend:status', false)
  });
  try { extension.writeExtension(extensionDir()); } catch (e) { console.error('No se ha podido preparar la extensión', e); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
