// Lecturas de cuotas programadas: cada minuto mira qué partidos empiezan pronto y crea un trabajo para el lector
// de Docker si le toca según lo que falte para el partido (everyMinutes). El lector los hace de uno en uno.
const { query } = require('../../shared/db');
const client = require('../../shared/client');
const bridge = require('./bridge');

const TICK = 60e3;
const FAR_HOURS = 48; // hasta dónde llegan las lecturas espaciadas
// El tenis y el fútbol tienen decenas de partidos al día: de cerca sólo las últimas 3 horas y de lejos sólo el último día
const TENNIS_NEAR_HOURS = 3;
const TENNIS_FAR_HOURS = 24;
const CROWDED = ['tennis', 'football', 'mma'];
const MAX_QUEUE = 10; // unos 6 min de trabajo: así la cola no llega a caducar y un partido cercano entra enseguida
const clamp = (v, lo, hi, def) => Math.min(hi, Math.max(lo, Number(v) || def));
const TBD = /^(tbd|tba|por determinar)$/i;

let last = { at: null, matches: [], far: 0, error: null };

// Reparte por turnos entre deportes (cada uno ya ordenado por inicio): si no, las decenas de partidos de tenis
// que empiezan antes llenan la cola y el baloncesto, que suele jugarse de noche, no llega a entrar. Los Challenger
// van en su propio turno (turn), aparte del resto del tenis
function byTurns(list) {
  const groups = new Map();
  for (const m of list) { const g = m.turn || m.sport || 'lol'; groups.set(g, [...(groups.get(g) || []), m]); }
  const out = [];
  for (let i = 0; out.length < list.length; i++) for (const g of groups.values()) if (g[i]) out.push(g[i]);
  return out;
}

const hoursLeft = m => (new Date(m.start).getTime() - Date.now()) / 3600e3;
const isNear = (m, hours) => hoursLeft(m) <= (CROWDED.includes(m.sport) ? Math.min(hours, TENNIS_NEAR_HOURS) : hours);

// Cada cuántos minutos se lee un partido: lo cercano cada X min (ajuste), lo lejano cada hora o cada 3 horas.
// El tenis y el fútbol lejanos siempre cada 3 horas: con una hora, sus partidos solos llenarían las ~100 lecturas por hora del lector
function everyMinutes(m, minutes, hours) {
  if (isNear(m, hours)) return minutes;
  return Math.max(minutes, hoursLeft(m) <= 24 && !CROWDED.includes(m.sport) ? 60 : 180);
}

// Días de España entre ahora y `until`, los dos incluidos
const day = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
function daysUntil(until) {
  const days = new Set([day(until)]);
  for (let t = Date.now(); t < until; t += 864e5) days.add(day(t));
  return [...days];
}

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

// Baloncesto: partidos sin empezar que empiezan antes de `hours` horas.
// El partido va como visitante (a) contra local (b), igual que en la app
async function upcomingBasket(hours) {
  const until = Date.now() + hours * 3600e3;
  const days = daysUntil(until);
  const games = (await Promise.all(days.map(d => client.call('basket', 'GET', `/api/basket/games?date=${d}`).catch(() => [])))).flat();
  const team = s => ({ name: s.name, code: s.abbr || '', alt: s.alt || [] });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && t >= Date.now() && t <= until && g.home?.name && g.away?.name; })
    .map(g => ({ id: g.id, league: g.league, start: g.date, sport: 'basket', a: team(g.away), b: team(g.home) }));
}

// Tenis: sólo los del cuadro final (no la previa) y sin los Challenger: son decenas al día, y leer de más puede hacer que las casas bloqueen
async function upcomingTennis(hours) {
  const until = Date.now() + hours * 3600e3;
  const days = daysUntil(until);
  const games = (await Promise.all(days.map(d => client.call('tennis', 'GET', `/api/tennis/games?date=${d}`).catch(() => [])))).flat();
  const p = x => ({ name: x.name, code: '', alt: x.alt || [] });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && t >= Date.now() && t <= until && !/^previa/i.test(g.round) && g.level !== 'challenger' && g.a?.name && g.b?.name; })
    .map(g => ({ id: g.id, league: g.tournament, start: g.date, sport: 'tennis', a: p(g.a), b: p(g.b) }));
}

// Challenger: decenas al día, así que no se leen como el resto del tenis (cada pocos minutos), sino dos veces: una hasta
// 12 h antes (la cuota de la mañana, para buscar valor) y la de cierre, a 20 min de la hora prevista. Si a esa hora sigue
// sin empezar (las horas de LiveScore son aproximadas), otra cada 40 min, hasta 5 h después: la última antes de empezar
// es la de cierre. Unas 2 o 3 por partido, 50-75 al día de las ~2.400 que puede hacer el lector. Con ellas, el motor de
// los Challenger (servicio challenger, /api/challenger/comparar) mide si gana a la casa. Sólo el cuadro final
const CH_EARLY_HOURS = 12;
const CH_CLOSE_MINUTES = 20;
const CH_LATE_EVERY = 40;
const CH_LATE_HOURS = 5;
const challengerClose = m => hoursLeft(m) * 60 <= CH_CLOSE_MINUTES;
const challengerEvery = m => (challengerClose(m) ? CH_LATE_EVERY : 24 * 60);

async function upcomingChallenger() {
  const now = Date.now();
  const days = [...new Set([...daysUntil(now + CH_EARLY_HOURS * 3600e3), day(now - CH_LATE_HOURS * 3600e3)])];
  const games = (await Promise.all(days.map(d => client.call('tennis', 'GET', `/api/tennis/games?date=${d}`).catch(() => [])))).flat();
  const p = x => ({ name: x.name, code: '', alt: x.alt || [] });
  const seen = new Set();
  return games.filter(g => {
    const t = new Date(g.date).getTime();
    if (g.level !== 'challenger' || g.state !== 'pre' || /^previa/i.test(g.round || '') || !g.a?.name || !g.b?.name || seen.has(g.id)) return false;
    seen.add(g.id);
    return t <= now + CH_EARLY_HOURS * 3600e3 && t >= now - CH_LATE_HOURS * 3600e3;
  }).map(g => ({ id: g.id, league: g.tournament, start: g.date, sport: 'tennis', turn: 'challenger', a: p(g.a), b: p(g.b) }))
    .sort((x, y) => new Date(x.start) - new Date(y.start));
}

// Fútbol: local (a) contra visitante (b), como en la app. Sin los aplazados. Los otros nombres de ESPN ayudan a encontrarlo
// en las casas ("UE Tavernes"), pero no la abreviatura: "VAL" está dentro de "Valladolid". Los filiales de ESPN ("Real
// Sociedad II") en las casas son "Real Sociedad B"
const BIG_NATIONS = /^(españa|francia|inglaterra|alemania|italia|portugal|países bajos|bélgica|croacia|argentina|brasil|uruguay|colombia|méxico|estados unidos|marruecos|japón)$/i;

async function upcomingFootball(hours) {
  const until = Date.now() + hours * 3600e3;
  const days = daysUntil(until);
  const games = (await Promise.all(days.map(d => client.call('football', 'GET', `/api/football/games?date=${d}`).catch(() => [])))).flat();
  const team = s => ({
    name: s.name, code: '',
    alt: [...new Set([...(/\sII$/.test(s.name) ? [s.name.replace(/\sII$/, ' B')] : []), ...(s.alts || []).filter(x => x && x !== s.name && x !== s.abbr)])]
  });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && !g.off && t >= Date.now() && t <= until && g.home?.name && g.away?.name; })
    // En un parón hay decenas de amistosos (Fiyi, Islas Cook…) que las casas casi no tienen: sólo se leen solos los de
    // selecciones grandes; el resto, a mano desde su pestaña de cuotas
    .filter(g => g.league !== 'amistosos' || BIG_NATIONS.test(g.home.name) || BIG_NATIONS.test(g.away.name))
    .map(g => ({ id: g.id, league: g.league, start: g.date, sport: 'football', a: team(g.home), b: team(g.away) }));
}

// MMA: UFC, PFL y WOW. A es el luchador de la esquina roja (el primero del cartel). Los combates anulados no se leen
async function upcomingMma(hours) {
  const until = Date.now() + hours * 3600e3;
  const games = (await Promise.all(daysUntil(until).map(d => client.call('mma', 'GET', `/api/mma/games?date=${d}`).catch(() => [])))).flat();
  const fighter = x => ({ name: x.name, code: '', alt: x.alt || [] });
  return games.filter(g => { const t = new Date(g.date).getTime(); return g.state === 'pre' && !g.cancelled && t >= Date.now() && t <= until && g.a?.name && g.b?.name; })
    .map(g => ({ id: g.id, league: g.org, event: g.event, start: g.date, sport: 'mma', a: fighter(g.a), b: fighter(g.b) }));
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
    if (!s.oddsAutoEnabled) { last = { at: Date.now(), matches: [], far: 0, error: null }; return; }
    const minutes = clamp(s.oddsRefreshMinutes, 2, 240, 5);
    const hours = clamp(s.oddsAutoHours, 1, 48, 6);
    // Con las lecturas espaciadas apagadas sólo se miran los partidos cercanos
    const far = s.oddsFarEnabled !== false;
    // Si una de las fuentes falla, las otras siguen
    const crowdedHours = far ? TENNIS_FAR_HOURS : Math.min(hours, TENNIS_NEAR_HOURS);
    const [lol, basket, tennis, football, mma, chall] = await Promise.all([
      upcoming(far ? FAR_HOURS : hours).catch(e => { console.error('Programador (LoL):', e.message); return []; }),
      upcomingBasket(far ? FAR_HOURS : hours).catch(e => { console.error('Programador (baloncesto):', e.message); return []; }),
      upcomingTennis(crowdedHours).catch(e => { console.error('Programador (tenis):', e.message); return []; }),
      upcomingFootball(crowdedHours).catch(e => { console.error('Programador (fútbol):', e.message); return []; }),
      upcomingMma(crowdedHours).catch(e => { console.error('Programador (MMA):', e.message); return []; }),
      s.challengerOddsEnabled === false ? [] : upcomingChallenger().catch(e => { console.error('Programador (Challenger):', e.message); return []; })
    ]);
    const matches = [...lol, ...basket, ...tennis, ...football, ...mma].sort((x, y) => new Date(x.start) - new Date(y.start));
    const chClose = chall.filter(challengerClose), chEarly = chall.filter(m => !challengerClose(m));
    const { rows } = await query(`SELECT count(*)::int AS n FROM odds.jobs WHERE done_at IS NULL AND picked_at IS NULL AND source = 'auto'`);
    let queued = rows[0].n;
    // Primero los cercanos y luego los lejanos, en cada grupo por turnos entre deportes. El cierre de un Challenger va con
    // los cercanos (no puede esperar); su lectura de la mañana, con los lejanos
    const order = [...byTurns([...matches.filter(m => isNear(m, hours)), ...chClose]), ...byTurns([...matches.filter(m => !isNear(m, hours)), ...chEarly])];
    for (const m of order) {
      if (queued >= MAX_QUEUE) break;
      if (!(await due(bridge.keyOf(m), m.turn === 'challenger' ? challengerEvery(m) : everyMinutes(m, minutes, hours)))) continue;
      await bridge.noteMatch(m);
      await bridge.newJob(m, 'auto');
      queued++;
    }
    const near = matches.filter(m => isNear(m, hours));
    last = { at: Date.now(), matches: [...near, ...chClose], far: matches.length - near.length + chEarly.length, challenger: chall.length, error: null };
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
    challengerEnabled: s.challengerOddsEnabled !== false,
    challenger: last.challenger || 0,
    minutes: clamp(s.oddsRefreshMinutes, 2, 240, 5),
    hours: clamp(s.oddsAutoHours, 1, 48, 6),
    lastRun: last.at,
    error: last.error,
    matches: last.matches,
    far: last.far,
    queued: rows[0].queued,
    running: rows[0].running,
    lastPoll: bridge.lastPoll()
  };
}

module.exports = { start, status, tick };
