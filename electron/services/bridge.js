// Puente con tu navegador: un mini servidor en 127.0.0.1 que recibe las cuotas que el marcador lee de las
// páginas de Bet365, Winamax y Betway en tu Chrome normal (donde no hay bloqueos anti-bot).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47365;
const TTL = 3 * 3600e3; // una importación vale 3 horas
const BOOKS = ['bet365', 'winamax', 'betway'];
let imports = []; // { book, ts, map, matchKey, ...payload }
let onImport = () => {};
let snapshotDir = null;
let recent = []; // partidos abiertos en la app: { key, a, b, t }
// Botón "Actualizar cuotas": cada pulsación es un trabajo que hace la extensión de Chrome
const jobs = new Map(); // id → { id, match, books, created, picked, steps: { book: { estado, msg } }, done }
let onJob = () => {};
// Dirección de cada partido en cada casa (la aprende del marcador y de la extensión) para ir directo
let urls = {}, urlsFile = null;

const keyOf = m => `${m.a?.name}|${m.b?.name}`;
function noteMatch(m) {
  recent = [{ key: keyOf(m), a: m.a, b: m.b, t: Date.now() }, ...recent.filter(r => r.key !== keyOf(m))].slice(0, 30);
}

// ¿A qué partido de la app pertenece? Por los equipos de la página; si no, el último partido abierto
function assign(p, orient) {
  const job = p.job && jobs.get(p.job);
  if (job) return recent.find(r => r.key === keyOf(job.match)) || { key: keyOf(job.match), a: job.match.a, b: job.match.b };
  if (p.home && p.away) for (const r of recent) if (orient(r.a, r.b, p.home, p.away)) return r;
  const parts = String(p.title || '').split(/\s+(?:v|vs|-)\s+/i);
  const low = `${p.title}\n${p.header || ''}`.toLowerCase();
  const has = t => [t.name, t.code].filter(x => x && x.length >= 2).some(x => low.includes(x.toLowerCase()));
  for (const r of recent) {
    if (parts.length >= 2 && orient(r.a, r.b, parts[0], parts[1])) return r;
    if (has(r.a) && has(r.b)) return r;
  }
  return recent[0] || null;
}

function add(payload, orient) {
  // Compatibilidad con el primer marcador (sólo Bet365)
  if (payload?.type === 'LOL_ET_BET365') payload = { ...payload, type: 'LOL_ET', book: 'bet365' };
  if (payload?.type !== 'LOL_ET' || !BOOKS.includes(payload.book)) throw new Error('No son cuotas del marcador');
  const m = assign(payload, orient);
  const entry = { ...payload, ts: Date.now(), map: payload.map || 1, matchKey: m?.key || null };
  imports = [entry, ...imports.filter(i => Date.now() - i.ts < TTL &&
    // Cada página de la casa (pestaña) sustituye sólo a la misma página; las antiguas sin página, por mapa
    !(i.matchKey === entry.matchKey && i.book === entry.book &&
      (entry.book === 'winamax' || (entry.page && i.page ? i.page === entry.page : i.map === entry.map))))];
  if (m && payload.url) {
    urls[m.key] = { ...urls[m.key], [payload.book]: payload.url };
    if (urlsFile) try { fs.writeFileSync(urlsFile, JSON.stringify(urls)); } catch (_) {}
  }
  onImport(entry);
  return { ok: true, partido: m ? `${m.a.name} vs ${m.b.name}` : null };
}

function saveSnapshot(s) {
  if (!snapshotDir || !BOOKS.includes(s?.book)) return;
  const nombre = /^[a-z0-9-]{1,20}$/.test(s.nombre || '') ? s.nombre : 'marcador';
  fs.writeFileSync(path.join(snapshotDir, `captura-${s.book}-${nombre}.json`), JSON.stringify({ ...s, fecha: new Date().toISOString() }));
}

function newJob(match) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { id, match: { a: match.a, b: match.b }, books: BOOKS.slice(), created: Date.now(), picked: false, steps: {}, done: false };
  for (const b of BOOKS) job.steps[b] = { estado: 'esperando', msg: '' };
  jobs.set(id, job);
  for (const [k, j] of jobs) if (Date.now() - j.created > 3600e3) jobs.delete(k);
  // Si la extensión no lo recoge, lo damos por perdido
  setTimeout(() => { if (!job.picked && !job.done) { job.done = true; job.error = 'sin extensión'; onJob(job); } }, 15000);
  onJob(job);
  return job;
}

function jobProgress({ id, book, estado, msg }) {
  const job = jobs.get(id);
  if (!job) throw new Error('Trabajo desconocido');
  if (book && job.steps[book]) job.steps[book] = { estado, msg: msg || '' };
  if (estado === 'fin') job.done = true;
  onJob(job);
  return { ok: true };
}

// Página que se abre en Chrome al pulsar el botón: la extensión la detecta y se pone a trabajar
const AUTO_PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>LoL Tracker · cuotas</title>
<style>body{background:#18181b;color:#e4e4e7;font:15px system-ui,sans-serif;display:flex;justify-content:center;padding-top:12vh}
main{width:440px}h1{font-size:18px;color:#fbbf24}li{margin:6px 0;list-style:none}.m{color:#a1a1aa;font-size:13px}.e{color:#f87171}</style></head>
<body><main><h1>LoL Esports Tracker · actualizando cuotas</h1><p id="t" class="m"></p><ul id="l"></ul><p id="x" class="m"></p></main>
<script>
var id=new URLSearchParams(location.search).get('job'),N={bet365:'Bet365',winamax:'Winamax',betway:'Betway'},I={esperando:'⏳',buscando:'🔎',leyendo:'📖',ok:'✅',error:'⚠️'};
function tick(){fetch('/auto/status?id='+id).then(function(r){return r.json()}).then(function(j){
 document.getElementById('t').textContent=j.match?j.match.a.name+' vs '+j.match.b.name:'';
 document.getElementById('l').innerHTML=Object.keys(j.steps||{}).map(function(b){var s=j.steps[b];return '<li>'+(I[s.estado]||'')+' <b>'+N[b]+'</b> <span class="m">'+(s.msg||s.estado)+'</span></li>'}).join('');
 var x=document.getElementById('x');
 if(j.error==='sin extensión'||(!j.picked&&Date.now()-j.created>6000))x.innerHTML='<span class="e">No detecto la extensión de LoL Tracker en este Chrome. Instálala desde Ajustes de la app.</span>';
 else x.textContent=j.done?'Listo. Puedes volver a la app (esta pestaña se cierra sola).':'Se abren pestañas en segundo plano; no hace falta que hagas nada.';
 if(!j.done)setTimeout(tick,1000);}).catch(function(){setTimeout(tick,2000)})}tick();
</script></body></html>`;

function start({ orient, onChange, onJobChange, dir }) {
  onImport = onChange || onImport;
  onJob = onJobChange || onJob;
  snapshotDir = dir || null;
  if (dir) {
    urlsFile = path.join(dir, 'casas-urls.json');
    try { urls = JSON.parse(fs.readFileSync(urlsFile, 'utf8')); } catch (_) {}
  }
  const server = http.createServer((req, res) => {
    // CORS + acceso a red local para que la página de la casa pueda llamar a 127.0.0.1
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const u = new URL(req.url, 'http://127.0.0.1');
    const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.method === 'GET') {
      if (u.pathname === '/ping') return json(200, { ok: true });
      if (u.pathname === '/auto') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(AUTO_PAGE); }
      const job = jobs.get(u.searchParams.get('id'));
      if (u.pathname === '/auto/status') return job ? json(200, job) : json(404, { ok: false });
      if (u.pathname === '/auto/job') {
        if (!job || job.done) return json(404, { ok: false });
        if (!job.picked) { job.picked = true; onJob(job); }
        return json(200, { ...job, urls: urls[keyOf(job.match)] || {} });
      }
      res.writeHead(404); return res.end();
    }
    if (req.method !== 'POST' || !['/odds', '/bet365', '/snapshot', '/auto/progress'].includes(u.pathname)) { res.writeHead(404); return res.end(); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 12e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const r = u.pathname === '/snapshot' ? (saveSnapshot(data), { ok: true })
          : u.pathname === '/auto/progress' ? jobProgress(data) : add(data, orient);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  });
  server.on('error', () => {}); // puerto ocupado: sólo queda el pegado manual
  server.listen(PORT, '127.0.0.1');
}

const forMatch = m => imports.filter(i => i.matchKey === keyOf(m) && Date.now() - i.ts < TTL);

function bookmarkletUrl() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet', 'marcador.js'), 'utf8')
    .replace(/__PORT__/g, String(PORT))
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  return 'javascript:' + encodeURIComponent(code);
}

// Lector para la extensión: el mismo código del marcador, con el puerto puesto
const lectorCode = () => fs.readFileSync(path.join(__dirname, '..', 'bookmarklet', 'marcador.js'), 'utf8').replace(/__PORT__/g, String(PORT));

// Copia la extensión de Chrome (plantillas + lector) a una carpeta que el usuario carga en chrome://extensions
function writeExtension(target) {
  const src = path.join(__dirname, '..', 'extension');
  fs.mkdirSync(target, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const out = fs.readFileSync(path.join(src, f), 'utf8').replace(/__PORT__/g, String(PORT));
    const dest = path.join(target, f);
    let prev = null; try { prev = fs.readFileSync(dest, 'utf8'); } catch (_) {}
    if (prev !== out) fs.writeFileSync(dest, out);
  }
  const lector = lectorCode(), dest = path.join(target, 'lector.js');
  let prev = null; try { prev = fs.readFileSync(dest, 'utf8'); } catch (_) {}
  if (prev !== lector) fs.writeFileSync(dest, lector);
  return target;
}

module.exports = { start, add, noteMatch, forMatch, bookmarkletUrl, newJob, writeExtension, PORT };
