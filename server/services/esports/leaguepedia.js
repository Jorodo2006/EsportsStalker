// Leaguepedia (lol.fandom.com) expone su base de datos con la API "Cargo". Gratis y sin clave.
// Tablas usadas: Players, ScoreboardPlayers, ScoreboardGames.
// Ojo: tiene límite de peticiones; la caché evita repetir consultas.
const { qs } = require('./http');
const { query } = require('../../shared/db');

const API = 'https://lol.fandom.com/api.php';
const TTL = 6 * 3600e3; // los resultados profesionales no cambian a menudo
const GAP = 3000; // ms mínimos entre peticiones: Fandom limita mucho a los anónimos

// Caché en la base de datos (esports.cache): sobrevive a reinicios y evita gastar el límite repitiendo consultas.
// En memoria se tiene una copia para no ir a la base de datos en cada búsqueda.
let cache = {};
async function init() {
  await query(`DELETE FROM esports.cache WHERE t < now() - interval '6 hours'`);
  const { rows } = await query('SELECT key, value, t FROM esports.cache');
  cache = Object.fromEntries(rows.map(r => [r.key, { t: new Date(r.t).getTime(), v: r.value }]));
}
function persist(key) {
  const hit = cache[key];
  if (!hit) return;
  query(`INSERT INTO esports.cache (key, value, t) VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(hit.v), hit.t])
    .catch(e => console.error('Caché de Leaguepedia:', e.message));
}

// ---------- Sesión opcional (contraseña de bot de Fandom) ----------
// Sin sesión, Fandom deja muy pocas consultas por minuto. Con una "bot password" gratuita
// (lol.fandom.com/wiki/Special:BotPasswords) el límite sube mucho.
let creds = { user: '', pass: '' };
let cookies = '';
let loggedAs = null;

function configure(s) {
  const user = (s.leaguepediaUser || '').trim(), pass = (s.leaguepediaPassword || '').trim();
  if (user !== creds.user || pass !== creds.pass) { creds = { user, pass }; cookies = ''; loggedAs = null; }
}

function storeCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const jar = new Map(cookies.split('; ').filter(Boolean).map(c => [c.split('=')[0], c]));
  for (const c of list) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); }
  cookies = [...jar.values()].join('; ');
}

async function apiFetch(params, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const url = method === 'GET' ? `${API}?${qs(params)}` : API;
    const res = await fetch(url, {
      method,
      body: body ? new URLSearchParams(body) : undefined,
      headers: { 'User-Agent': 'Statex/0.3 (uso personal)', Accept: 'application/json', ...(cookies ? { Cookie: cookies } : {}) },
      signal: ctrl.signal
    });
    storeCookies(res);
    if (res.status === 429) return { error: { code: 'ratelimited' } };
    if (!res.ok) throw new Error(`Leaguepedia: HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Leaguepedia no responde (15 s). Puede que esté caída o bloqueando tu conexión.');
    throw e;
  } finally { clearTimeout(timer); }
}

async function login() {
  if (!creds.user || !creds.pass) return false;
  if (loggedAs === creds.user) return true;
  const t = await apiFetch({ action: 'query', meta: 'tokens', type: 'login', format: 'json' });
  const token = t?.query?.tokens?.logintoken;
  if (!token) throw new Error('Leaguepedia: no se pudo iniciar sesión');
  const r = await apiFetch({}, { method: 'POST', body: { action: 'login', lgname: creds.user, lgpassword: creds.pass, lgtoken: token, format: 'json' } });
  if (r?.login?.result !== 'Success') throw new Error(`Leaguepedia: usuario o contraseña de bot incorrectos (${r?.login?.reason || r?.login?.result || 'error'})`);
  loggedAs = creds.user;
  return true;
}

// ---------- Cola de consultas ----------
// Una petición cada vez y espaciadas. Si Fandom nos limita, un único reintento corto y
// luego error claro (antes se quedaba esperando mucho rato).
let chain = Promise.resolve();
let last = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cargo(params) {
  const full = { action: 'cargoquery', format: 'json', limit: 50, ...params };
  const key = qs(full);
  const hit = cache[key];
  if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.v);
  const job = chain.then(async () => {
    const again = cache[key];
    if (again && Date.now() - again.t < TTL) return again.v;
    await login();
    for (let attempt = 0; ; attempt++) {
      const gap = loggedAs ? 400 : GAP;
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const j = await apiFetch(full);
      const limited = j?.error && (/ratelimit/i.test(j.error.code || '') || /rate limit/i.test(j.error.info || ''));
      if (j?.error && !limited) throw new Error(`Leaguepedia: ${j.error.info || j.error.code}`);
      if (!limited) {
        const v = (j?.cargoquery || []).map(r => r.title);
        cache[key] = { t: Date.now(), v };
        persist(key);
        return v;
      }
      if (attempt >= 1) {
        throw new Error(loggedAs
          ? 'Leaguepedia sigue limitando las consultas. Espera un par de minutos.'
          : 'Leaguepedia limita las consultas sin sesión. Espera unos minutos o añade una contraseña de bot gratuita en Ajustes para subir el límite.');
      }
      await sleep(5000);
    }
  });
  chain = job.catch(() => {});
  return job;
}

// Escapa comillas para las cláusulas WHERE de Cargo
const esc = s => String(s).replace(/\\/g, '').replace(/"/g, '\\"');

async function searchPlayers(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const rows = await cargo({
    tables: 'Players',
    fields: 'Players.ID=id,Players.OverviewPage=page,Players.Name=realName,Players.Team=team,Players.Role=role,Players.Country=country,Players.IsRetired=retired',
    where: `Players.ID LIKE "%${esc(q)}%"`,
    order_by: 'Players.IsRetired ASC, Players.ID ASC',
    limit: 25
  });
  return rows.map(r => ({ ...r, retired: r.retired === '1' || r.retired === 'Yes' }));
}

async function playerGames(page, limit = 40) {
  const rows = await cargo({
    tables: 'ScoreboardPlayers=SP',
    fields: [
      'SP.Link=player', 'SP.Team=team', 'SP.Champion=champion', 'SP.Role=role',
      'SP.Kills=kills', 'SP.Deaths=deaths', 'SP.Assists=assists', 'SP.CS=cs', 'SP.Gold=gold',
      'SP.DamageToChampions=damage', 'SP.PlayerWin=win', 'SP.DateTime_UTC=date', 'SP.Tournament=tournament', 'SP.Side=side'
    ].join(','),
    where: `SP.Link="${esc(page)}"`,
    order_by: 'SP.DateTime_UTC DESC',
    limit
  });
  const n = v => Number(v) || 0;
  return rows.map(r => ({
    ...r, kills: n(r.kills), deaths: n(r.deaths), assists: n(r.assists), cs: n(r.cs), gold: n(r.gold),
    damage: n(r.damage), win: r.win === 'Yes'
  }));
}

async function teamGames(team, limit = 30) {
  const t = esc(team);
  const rows = await cargo({
    tables: 'ScoreboardGames=SG',
    fields: 'SG.Team1=team1,SG.Team2=team2,SG.Winner=winner,SG.DateTime_UTC=date,SG.Tournament=tournament,SG.Gamelength=length,SG.Team1Kills=k1,SG.Team2Kills=k2',
    where: `SG.Team1="${t}" OR SG.Team2="${t}"`,
    order_by: 'SG.DateTime_UTC DESC',
    limit
  });
  return rows;
}

async function teamRoster(team) {
  return cargo({
    tables: 'Players',
    fields: 'Players.ID=id,Players.OverviewPage=page,Players.Role=role,Players.Country=country',
    where: `Players.Team="${esc(team)}" AND (Players.IsRetired IS NULL OR Players.IsRetired="0" OR Players.IsRetired="No")`,
    limit: 15
  });
}

// Forma reciente de los jugadores de un equipo (para estimar las líneas de jugador): una sola consulta con las
// últimas partidas de todos, en vez de una por jugador, por el límite de Leaguepedia. Sólo cuentan las partidas
// con este equipo. Devuelve { team, players: [{ name, link, role, games: [{ k, d, a, win, date }] }] }, lo más reciente primero.
async function teamForm(name, code, perPlayer = 20) {
  const team = await resolveTeam(name, code);
  const rows = await cargo({
    tables: 'ScoreboardPlayers=SP',
    fields: 'SP.Link=link,SP.Name=name,SP.Role=role,SP.Kills=kills,SP.Deaths=deaths,SP.Assists=assists,SP.PlayerWin=win,SP.DateTime_UTC=date',
    where: `SP.Team="${esc(team)}"`,
    order_by: 'SP.DateTime_UTC DESC',
    limit: 250
  });
  const byLink = new Map();
  for (const r of rows) {
    if (!r.link) continue;
    if (!byLink.has(r.link)) byLink.set(r.link, { name: r.name || r.link, link: r.link, role: r.role, games: [] });
    const p = byLink.get(r.link);
    if (p.games.length < perPlayer) p.games.push({ k: Number(r.kills) || 0, d: Number(r.deaths) || 0, a: Number(r.assists) || 0, win: r.win === 'Yes', date: r.date });
  }
  return { team, players: [...byLink.values()] };
}

// Equipos por nombre o siglas (para las sugerencias del buscador)
async function searchTeams(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const rows = await cargo({
    tables: 'Teams',
    fields: 'Teams.Name=name,Teams.OverviewPage=page,Teams.Short=short,Teams.Region=region,Teams.IsDisbanded=disbanded',
    where: `Teams.Name LIKE "%${esc(q)}%" OR Teams.Short LIKE "${esc(q)}%"`,
    order_by: 'Teams.IsDisbanded ASC, Teams.Name ASC',
    limit: 20
  });
  return rows.map(r => ({ ...r, disbanded: r.disbanded === '1' || r.disbanded === 'Yes' }));
}

// Nombre del equipo en Leaguepedia a partir del de lolesports ("Gen.G Esports" → "Gen.G")
const resolved = new Map();
async function resolveTeam(name, code) {
  const key = `${name}|${code || ''}`;
  if (resolved.has(key)) return resolved.get(key);
  const strip = s => String(s).replace(/\s+(e-?sports?|gaming|team|club)$/i, '').trim();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const tries = [...new Set([name, strip(name)])].filter(Boolean);
  let rows = await cargo({
    tables: 'Teams',
    fields: 'Teams.Name=name,Teams.OverviewPage=page,Teams.Short=short,Teams.IsDisbanded=disbanded',
    where: [...tries.map(t => `Teams.Name="${esc(t)}" OR Teams.OverviewPage="${esc(t)}"`), code ? `Teams.Short="${esc(code)}"` : null].filter(Boolean).join(' OR '),
    order_by: 'Teams.IsDisbanded ASC',
    limit: 20
  });
  const active = rows.filter(r => !(r.disbanded === '1' || r.disbanded === 'Yes'));
  const pick = list => list.find(r => tries.some(t => norm(t) === norm(r.page) || norm(t) === norm(r.name)))
    || list.find(r => tries.some(t => norm(r.name).includes(norm(strip(t))) || norm(strip(t)).includes(norm(r.name))));
  let hit = pick(active) || pick(rows);
  if (!hit) { // por nombre parecido
    rows = await searchTeams(strip(name));
    hit = rows.find(r => !r.disbanded) || rows[0];
  }
  const v = hit ? hit.page || hit.name : name;
  resolved.set(key, v);
  return v;
}

module.exports = { init, configure, searchPlayers, searchTeams, resolveTeam, playerGames, teamGames, teamRoster, teamForm };
