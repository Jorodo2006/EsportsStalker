const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./services/store');
const lolesports = require('./services/lolesports');
const leaguepedia = require('./services/leaguepedia');
const odds = require('./services/odds');
const bridge = require('./services/bridge');

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
let store;
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

function registerIpc() {
  const s = () => store.getSettings();

  handle('settings:get', () => s());
  handle('settings:set', patch => store.setSettings(patch));

  handle('bets:list', () => store.listBets());
  handle('bets:save', bet => store.saveBet(bet));
  handle('bets:delete', id => store.deleteBet(id));

  handle('bets:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportar apuestas', defaultPath: `apuestas-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    const bets = store.listBets();
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
    return store.importBets(list);
  });

  handle('esports:leagues', () => lolesports.getLeagues(s().lolesportsKey));
  handle('esports:schedule', opts => lolesports.getSchedule(s().lolesportsKey, opts || {}));
  handle('esports:live', () => lolesports.getLive(s().lolesportsKey));
  handle('esports:eventDetails', id => lolesports.getEventDetails(s().lolesportsKey, id));
  handle('esports:liveWindow', gameId => lolesports.getLiveWindow(gameId));

  handle('stats:searchPlayers', q => (leaguepedia.configure(s()), leaguepedia.searchPlayers(q)));
  handle('stats:searchTeams', q => (leaguepedia.configure(s()), leaguepedia.searchTeams(q)));
  handle('stats:resolveTeam', (name, code) => (leaguepedia.configure(s()), leaguepedia.resolveTeam(name, code)));
  handle('stats:playerGames', page => (leaguepedia.configure(s()), leaguepedia.playerGames(page)));
  handle('stats:teamGames', team => (leaguepedia.configure(s()), leaguepedia.teamGames(team)));
  handle('stats:teamRoster', team => (leaguepedia.configure(s()), leaguepedia.teamRoster(team)));

  handle('odds:match', match => (bridge.noteMatch(match), odds.getMatchOdds(s(), match)));
  // Marcador de cuotas para tu Chrome y pegado manual si el envío directo falla
  handle('marcador:url', () => bridge.bookmarkletUrl());
  // Botón "Actualizar cuotas": abre en Chrome la página que activa la extensión
  handle('odds:auto', match => {
    bridge.noteMatch(match);
    const job = bridge.newJob(match);
    openInChrome(`http://127.0.0.1:${bridge.PORT}/auto?job=${job.id}`);
    return job;
  });
  handle('extension:folder', () => extensionDir());
  handle('extension:open', async () => { const err = await shell.openPath(extensionDir()); if (err) throw new Error(err); });
  handle('marcador:paste', match => {
    if (match) bridge.noteMatch(match);
    let data;
    try { data = JSON.parse(clipboard.readText()); } catch (_) { throw new Error('El portapapeles no tiene cuotas del marcador'); }
    return bridge.add(data, odds.orient);
  });
  // Recibe [{ id, a, b, start }] del calendario y devuelve { id: { a, b } } con la cuota de ganador
  handle('odds:board', events => odds.getBoardFor(events));

  handle('open:external', url => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
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
  store = new Store(app.getPath('userData'));
  leaguepedia.init(app.getPath('userData'));
  registerIpc();
  createWindow();
  bridge.start({
    orient: odds.orient,
    onChange: () => win && !win.isDestroyed() && win.webContents.send('odds:imported'),
    onJobChange: job => win && !win.isDestroyed() && win.webContents.send('odds:auto', job),
    // Fotos de las páginas de las casas (para ajustar el lector): junto al proyecto en desarrollo
    dir: app.isPackaged ? app.getPath('userData') : app.getAppPath()
  });
  try { bridge.writeExtension(extensionDir()); } catch (e) { console.error('No se ha podido preparar la extensión', e); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
