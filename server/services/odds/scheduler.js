// Lecturas de cuotas programadas: cada minuto mira qué partidos empiezan en las próximas N horas y crea un
// trabajo para la extensión de Chrome si hace más de X minutos que no se leen. La extensión los recoge sola
// (chrome.alarms), así que hace falta que Chrome esté abierto con la extensión cargada.
const { query } = require('../../shared/db');
const client = require('../../shared/client');
const bridge = require('./bridge');

const TICK = 60e3;
const clamp = (v, lo, hi, def) => Math.min(hi, Math.max(lo, Number(v) || def));
const TBD = /^(tbd|tba|por determinar)$/i;

let last = { at: null, matches: [], error: null };

// Partidos sin empezar con los dos equipos conocidos que empiezan antes de `hours` horas
async function upcoming(hours) {
  const until = Date.now() + hours * 3600e3;
  const events = [];
  let page = await client.call('esports', 'GET', '/api/esports/schedule');
  events.push(...page.events);
  // La primera página puede quedarse corta si hay muchos partidos: una más hacia delante
  const latest = Math.max(0, ...page.events.map(e => new Date(e.startTime).getTime()));
  if (latest < until && page.newer) {
    page = await client.call('esports', 'GET', `/api/esports/schedule?pageToken=${encodeURIComponent(page.newer)}`);
    events.push(...page.events);
  }
  const seen = new Set();
  return events.filter(e => {
    const t = new Date(e.startTime).getTime();
    const [a, b] = e.teams || [];
    if (e.state !== 'unstarted' || !(t >= Date.now() && t <= until) || !a?.name || !b?.name) return false;
    if (TBD.test(a.name) || TBD.test(b.name) || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  }).map(e => ({ id: e.id, league: e.league, start: e.startTime, a: { name: e.teams[0].name, code: e.teams[0].code }, b: { name: e.teams[1].name, code: e.teams[1].code } }));
}

// Baloncesto: partidos sin empezar de hoy y mañana (días de España) que empiezan antes de `hours` horas.
// El partido va como visitante (a) contra local (b), igual que en la app
async function upcomingBasket(hours) {
  const until = Date.now() + hours * 3600e3;
  const day = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const days = [...new Set([day(Date.now()), day(until)])];
  const games = (await Promise.all(days.map(d => client.call('basket', 'GET', `/api/basket/games?date=${d}`).catch(() => [])))).flat();
  const team = s => ({ name: s.name, code: s.abbr || '', alt: s.alt || [] });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && t >= Date.now() && t <= until && g.home?.name && g.away?.name; })
    .map(g => ({ id: g.id, league: g.league, start: g.date, sport: 'basket', a: team(g.away), b: team(g.home) }));
}

// Tenis: hay decenas de partidos al día, así que sólo los del cuadro final (no la previa) de las próximas 3 horas
async function upcomingTennis(hours) {
  const until = Date.now() + Math.min(hours, 3) * 3600e3;
  const day = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const days = [...new Set([day(Date.now()), day(until)])];
  const games = (await Promise.all(days.map(d => client.call('tennis', 'GET', `/api/tennis/games?date=${d}`).catch(() => [])))).flat();
  const p = x => ({ name: x.name, code: '', alt: x.alt || [] });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && t >= Date.now() && t <= until && !/^previa/i.test(g.round) && g.a?.name && g.b?.name; })
    .map(g => ({ id: g.id, league: g.tournament, start: g.date, sport: 'tennis', a: p(g.a), b: p(g.b) }));
}

// ¿Toca leerlo? No si tiene un trabajo abierto o uno (manual o programado) de hace menos de `minutes`
async function due(key, minutes) {
  const { rowCount } = await query(`SELECT 1 FROM odds.jobs WHERE match_key = $1
    AND (done_at IS NULL OR created > now() - make_interval(mins => $2)) LIMIT 1`, [key, minutes]);
  return rowCount === 0;
}

async function tick() {
  try {
    await bridge.cleanup();
    const s = await client.settings();
    if (!s.oddsAutoEnabled) { last = { at: Date.now(), matches: [], error: null }; return; }
    const minutes = clamp(s.oddsRefreshMinutes, 2, 240, 5);
    const hours = clamp(s.oddsAutoHours, 1, 48, 6);
    // Si una de las dos fuentes falla, la otra sigue
    const [lol, basket, tennis] = await Promise.all([
      upcoming(hours).catch(e => { console.error('Programador (LoL):', e.message); return []; }),
      upcomingBasket(hours).catch(e => { console.error('Programador (baloncesto):', e.message); return []; }),
      upcomingTennis(hours).catch(e => { console.error('Programador (tenis):', e.message); return []; })
    ]);
    const matches = [...lol, ...basket, ...tennis];
    for (const m of matches) {
      if (!(await due(bridge.keyOf(m), minutes))) continue;
      await bridge.noteMatch(m);
      await bridge.newJob(m, 'auto');
    }
    last = { at: Date.now(), matches, error: null };
  } catch (e) {
    console.error('Programador de cuotas:', e.message);
    last = { ...last, at: Date.now(), error: e.message };
  }
}

function start() {
  setTimeout(tick, 5e3);
  setInterval(tick, TICK);
}

// Para la pantalla de Ajustes
async function status() {
  const s = await client.settings().catch(() => ({}));
  const { rows } = await query(`SELECT count(*) FILTER (WHERE picked_at IS NULL) AS queued, count(*) FILTER (WHERE picked_at IS NOT NULL) AS running
    FROM odds.jobs WHERE done_at IS NULL`);
  return {
    enabled: s.oddsAutoEnabled !== false,
    minutes: clamp(s.oddsRefreshMinutes, 2, 240, 5),
    hours: clamp(s.oddsAutoHours, 1, 48, 6),
    lastRun: last.at,
    error: last.error,
    matches: last.matches,
    queued: rows[0].queued,
    running: rows[0].running,
    lastPoll: bridge.lastPoll()
  };
}

module.exports = { start, status, tick };
