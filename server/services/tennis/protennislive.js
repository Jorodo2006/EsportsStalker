'use strict';
// La previa (qualy) de los Challenger, de ProTennisLive: la web oficial de resultados de la ATP (sin robots.txt). LiveScore no la
// tiene (docs/specs/09-tenis.md). Cada torneo publica en /posting/<año>/<id ATP>/ el cuadro de la previa (qs.pdf) y el orden de juego
// del día (op.pdf); se leen con ptlpdf.js.
// - Qué torneos: el id ATP de un Challenger se repite de un año a otro, así que se prueban los de la misma semana de los dos años
//   anteriores (histórico de Sackmann, servicio challenger) y se queda el que trae las fechas de esta semana. Un torneo nuevo, que no
//   estaba hace un año, no sale.
// - Cada cuánto: los PDF los sirve la caché de Cloudflare 5 minutos (max-age=300), así que preguntar más a menudo no da nada nuevo.
//   En los días de previa, cada torneo cada 5 min de día (cada 30 de noche, hora del torneo); antes, cada 3 h hasta que sale el
//   cuadro. Peticiones condicionales (ETag): si no ha cambiado responde 304 sin el PDF. De una en una y como poco a 8 s; con un 429
//   se para 5 min y se espacia más. Unas 2 por minuto con ocho torneos en previa, casi todas 304.
// - Lo leído se guarda en tennis.cache (ptl:<año>-<id>) para no volver a pedirlo al arrancar.
const { query } = require('../../shared/db');
const client = require('../../shared/client');
const { pdfItems, parseDraw, parseOrder } = require('./ptlpdf');

const BASE = 'https://www.protennislive.com/posting';
const MIN_GAP = 8e3, MAX_GAP = 60e3, PAUSE_429 = 5 * 60e3;
const EVERY = { live: 5 * 60e3, night: 30 * 60e3, waiting: 3 * 3600e3, done: 6 * 3600e3, missing: 6 * 3600e3, missingSoon: 90 * 60e3 };

const DAY = 864e5;
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const lastWord = s => norm(s).split(' ').pop();

// ---------- Zona horaria del torneo ("Sydney, Australia") ----------
// Las horas del orden de juego son las del torneo. País con una sola zona → la suya; con varias, por la ciudad; si la ciudad no
// está, la más habitual del país y la hora se avisa como aproximada
const COUNTRY_TZ = {
  spain: 'Europe/Madrid', france: 'Europe/Paris', italy: 'Europe/Rome', germany: 'Europe/Berlin', austria: 'Europe/Vienna', switzerland: 'Europe/Zurich',
  portugal: 'Europe/Lisbon', 'united kingdom': 'Europe/London', 'great britain': 'Europe/London', ireland: 'Europe/Dublin', netherlands: 'Europe/Amsterdam',
  belgium: 'Europe/Brussels', luxembourg: 'Europe/Luxembourg', denmark: 'Europe/Copenhagen', sweden: 'Europe/Stockholm', norway: 'Europe/Oslo',
  finland: 'Europe/Helsinki', estonia: 'Europe/Tallinn', latvia: 'Europe/Riga', lithuania: 'Europe/Vilnius', poland: 'Europe/Warsaw',
  'czech republic': 'Europe/Prague', czechia: 'Europe/Prague', slovakia: 'Europe/Bratislava', hungary: 'Europe/Budapest', slovenia: 'Europe/Ljubljana',
  croatia: 'Europe/Zagreb', 'bosnia and herzegovina': 'Europe/Sarajevo', bosnia: 'Europe/Sarajevo', serbia: 'Europe/Belgrade', montenegro: 'Europe/Podgorica',
  romania: 'Europe/Bucharest', bulgaria: 'Europe/Sofia', greece: 'Europe/Athens', cyprus: 'Asia/Nicosia', turkey: 'Europe/Istanbul', turkiye: 'Europe/Istanbul',
  georgia: 'Asia/Tbilisi', armenia: 'Asia/Yerevan', azerbaijan: 'Asia/Baku', israel: 'Asia/Jerusalem', egypt: 'Africa/Cairo', tunisia: 'Africa/Tunis',
  morocco: 'Africa/Casablanca', 'south africa': 'Africa/Johannesburg', nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi', uae: 'Asia/Dubai',
  'united arab emirates': 'Asia/Dubai', qatar: 'Asia/Qatar', bahrain: 'Asia/Bahrain', india: 'Asia/Kolkata', pakistan: 'Asia/Karachi', uzbekistan: 'Asia/Tashkent',
  china: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', taiwan: 'Asia/Taipei', 'chinese taipei': 'Asia/Taipei', japan: 'Asia/Tokyo', korea: 'Asia/Seoul',
  'south korea': 'Asia/Seoul', thailand: 'Asia/Bangkok', vietnam: 'Asia/Ho_Chi_Minh', philippines: 'Asia/Manila', malaysia: 'Asia/Kuala_Lumpur', singapore: 'Asia/Singapore',
  'new zealand': 'Pacific/Auckland', argentina: 'America/Argentina/Buenos_Aires', uruguay: 'America/Montevideo', paraguay: 'America/Asuncion',
  chile: 'America/Santiago', peru: 'America/Lima', bolivia: 'America/La_Paz', colombia: 'America/Bogota', venezuela: 'America/Caracas',
  'el salvador': 'America/El_Salvador', guatemala: 'America/Guatemala', 'costa rica': 'America/Costa_Rica', panama: 'America/Panama',
  'dominican republic': 'America/Santo_Domingo', 'puerto rico': 'America/Puerto_Rico', ecuador: 'America/Guayaquil',
  // Varias zonas: la más habitual (y la hora sale como aproximada si la ciudad no está abajo)
  usa: 'America/New_York', 'united states': 'America/New_York', canada: 'America/Toronto', australia: 'Australia/Sydney', brazil: 'America/Sao_Paulo',
  mexico: 'America/Mexico_City', russia: 'Europe/Moscow', kazakhstan: 'Asia/Almaty', indonesia: 'Asia/Jakarta'
};
const MULTI = new Set(['usa', 'united states', 'canada', 'australia', 'brazil', 'mexico', 'russia', 'kazakhstan', 'indonesia', 'spain', 'portugal', 'ecuador']);
const CITY_TZ = {
  // Estados Unidos
  champaign: 'America/Chicago', 'little rock': 'America/Chicago', houston: 'America/Chicago', tyler: 'America/Chicago', chicago: 'America/Chicago',
  'bloomfield hills': 'America/Detroit', knoxville: 'America/New_York', charlottesville: 'America/New_York', cleveland: 'America/New_York',
  tallahassee: 'America/New_York', savannah: 'America/New_York', sarasota: 'America/New_York', lexington: 'America/New_York', cary: 'America/New_York',
  columbus: 'America/New_York', 'winston salem': 'America/New_York', orlando: 'America/New_York', 'new haven': 'America/New_York', atlanta: 'America/New_York',
  'las vegas': 'America/Los_Angeles', 'indian wells': 'America/Los_Angeles', 'rancho santa fe': 'America/Los_Angeles', fairfield: 'America/Los_Angeles',
  tiburon: 'America/Los_Angeles', 'newport beach': 'America/Los_Angeles', phoenix: 'America/Phoenix', 'south padre island': 'America/Chicago',
  // Canadá
  drummondville: 'America/Toronto', granby: 'America/Toronto', toronto: 'America/Toronto', montreal: 'America/Toronto', calgary: 'America/Edmonton',
  vancouver: 'America/Vancouver', winnipeg: 'America/Winnipeg', saskatoon: 'America/Regina',
  // Australia
  sydney: 'Australia/Sydney', canberra: 'Australia/Sydney', 'shepparton': 'Australia/Melbourne', traralgon: 'Australia/Melbourne', melbourne: 'Australia/Melbourne',
  bendigo: 'Australia/Melbourne', brisbane: 'Australia/Brisbane', playford: 'Australia/Adelaide', adelaide: 'Australia/Adelaide', burnie: 'Australia/Hobart',
  launceston: 'Australia/Hobart', hobart: 'Australia/Hobart', perth: 'Australia/Perth', darwin: 'Australia/Darwin',
  // México, Brasil, Rusia, Kazajistán, Indonesia
  monterrey: 'America/Monterrey', 'san luis potosi': 'America/Mexico_City', morelos: 'America/Mexico_City', 'puerto vallarta': 'America/Mexico_City',
  'mexico city': 'America/Mexico_City', cancun: 'America/Cancun', merida: 'America/Merida', 'sao paulo': 'America/Sao_Paulo', campinas: 'America/Sao_Paulo',
  florianopolis: 'America/Sao_Paulo', 'rio de janeiro': 'America/Sao_Paulo', brasilia: 'America/Sao_Paulo', 'porto alegre': 'America/Sao_Paulo',
  moscow: 'Europe/Moscow', astana: 'Asia/Almaty', almaty: 'Asia/Almaty', shymkent: 'Asia/Almaty', jakarta: 'Asia/Jakarta',
  // España y Portugal: las islas
  'gran canaria': 'Atlantic/Canary', 'las palmas': 'Atlantic/Canary', tenerife: 'Atlantic/Canary', lanzarote: 'Atlantic/Canary', madeira: 'Atlantic/Madeira',
  azores: 'Atlantic/Azores', 'ponta delgada': 'Atlantic/Azores', galapagos: 'Pacific/Galapagos'
};
function zoneOf(city) {
  const [c, ...rest] = String(city || '').split(','), country = norm(rest.join(',')), place = norm(c);
  const byCity = Object.entries(CITY_TZ).find(([k]) => place === k || place.startsWith(`${k} `) || place.includes(k));
  if (byCity) return { tz: byCity[1], sure: true };
  const tz = COUNTRY_TZ[country];
  return tz ? { tz, sure: !MULTI.has(country) || ['spain', 'portugal', 'ecuador'].includes(country) } : { tz: 'UTC', sure: false };
}
// Minutos que va la zona por delante de UTC en ese momento
function offsetMin(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(t).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t) / 60e3;
}
// "2026-11-16" "10:00" en la zona del torneo → instante
function atLocal(day, hm, tz) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMin(guess, tz) * 60e3;
  t = guess - offsetMin(t, tz) * 60e3;
  return t;
}
const localHour = (t, tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(t));

// ---------- Peticiones: de una en una, espaciadas, condicionales ----------
let gap = MIN_GAP, last = 0, pausedUntil = 0, okRun = 0;
let chain = Promise.resolve();
const validators = new Map(); // url → { etag, modified }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// null: no existe (404/410); 'same': no ha cambiado (304); Buffer: el PDF
function ask(url) {
  const job = chain.then(async () => {
    const wait = Math.max(last + gap, pausedUntil) - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const v = validators.get(url), headers = { Accept: 'application/pdf' };
    if (v?.etag) headers['If-None-Match'] = v.etag;
    if (v?.modified) headers['If-Modified-Since'] = v.modified;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (res.status === 429) {
      pausedUntil = Date.now() + PAUSE_429; gap = Math.min(MAX_GAP, gap * 2); okRun = 0;
      console.error(`[tennis] ProTennisLive: 429, se para 5 min y se pasa a una petición cada ${Math.round(gap / 1000)} s`);
      throw new Error('429');
    }
    if (++okRun >= 20 && gap > MIN_GAP) { gap = Math.max(MIN_GAP, Math.round(gap * 0.8)); okRun = 0; }
    if (res.status === 304) return 'same';
    if (res.status === 404 || res.status === 410) { await res.arrayBuffer().catch(() => {}); return null; }
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    validators.set(url, { etag: res.headers.get('etag'), modified: res.headers.get('last-modified') });
    return buf;
  });
  chain = job.catch(() => {});
  return job;
}

// ---------- Estado: los torneos de la semana ----------
const state = new Map(); // "<año>-<id>" → torneo
const save = t => query(`INSERT INTO tennis.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`,
  [`ptl:${t.key}`, JSON.stringify(t)]).catch(e => console.error('[tennis] ProTennisLive (guardar):', e.message));
async function restore() {
  const { rows } = await query(`SELECT value FROM tennis.cache WHERE key LIKE 'ptl:%' AND t > now() - interval '10 days'`).catch(() => ({ rows: [] }));
  for (const r of rows) if (r.value?.key) state.set(r.value.key, { ...r.value, qsAt: 0, opAt: 0 });
}

let catalog = { t: 0, list: [] };
async function tournaments() {
  if (Date.now() - catalog.t < 12 * 3600e3 && catalog.list.length) return catalog.list;
  const list = await client.call('challenger', 'GET', '/internal/challenger/torneos');
  catalog = { t: Date.now(), list };
  return list;
}

// Lunes de esta semana y de la siguiente (la previa de la siguiente es este fin de semana)
function mondays(now = Date.now()) {
  const d = new Date(now), dow = (d.getUTCDay() + 6) % 7;
  const m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY;
  return [m0, m0 + 7 * DAY];
}

// Los ids que probar para un lunes: los Challenger de esa semana hace uno y dos años, con una semana de margen (muchos cambian de
// semana de un año a otro: Champaign, Kobe o Helsinki se jugaron en 2025 una antes o después), y los de las ciudades que ya salen
// en LiveScore esta semana (hint)
const cityKey = s => norm(String(s).split(',')[0]).replace(/\bch\b/g, '').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();
const hinted = new Set();
// El torneo de LiveScore de cada ciudad, para meter la previa en su panel aunque ese día LiveScore aún no lo tenga
const panels = new Map();
function hint(list) {
  for (const x of list) {
    const name = typeof x === 'string' ? x : x?.tournament;
    if (!name) continue;
    hinted.add(cityKey(name));
    if (x.tournamentId) panels.set(cityKey(name), { tournament: name, tournamentId: x.tournamentId });
  }
}
function candidates(list, monday, cities = hinted) {
  const ids = new Map();
  for (const k of [1, 2]) {
    const prior = monday - 364 * k * DAY;
    for (const t of list) if (Math.abs(dayMs(t.date) - prior) <= 10 * DAY && !ids.has(t.id)) ids.set(t.id, t.name);
  }
  for (const t of list) if (cities.has(cityKey(t.name)) && !ids.has(t.id)) ids.set(t.id, t.name);
  return [...ids].map(([id, name]) => ({ id, name }));
}

// ---------- Lecturas ----------
async function readDraw(t) {
  const buf = await ask(`${BASE}/${t.year}/${t.id}/qs.pdf`);
  t.qsAt = Date.now();
  if (buf === 'same') return;
  if (buf === null) { t.status = t.draw ? t.status : 'missing'; return; }
  const draw = parseDraw(pdfItems(buf));
  // Antes de publicarse el cuadro hay una hoja de aviso de 2-3 KB (de Word): como si no estuviera
  if (!draw) { if (!t.draw) t.status = buf.length < 20000 ? 'missing' : 'unreadable'; if (buf.length >= 20000) console.error(`[tennis] ProTennisLive: no se entiende el cuadro de ${t.id}`); return; }
  // La semana es la que dice el cuadro, si es ésta o la siguiente; si no, el id es de otro torneo este año
  const week = mondays().find(m => Math.abs(dayMs(draw.start) - m) <= 3 * DAY);
  if (week == null) { t.status = 'other'; return; }
  t.monday = week;
  t.status = 'active';
  t.draw = draw;
  t.zone = zoneOf(draw.city);
  await save(t);
}

async function readOrder(t) {
  const buf = await ask(`${BASE}/${t.year}/${t.id}/op.pdf`);
  t.opAt = Date.now();
  if (!buf || buf === 'same') return;
  const op = parseOrder(pdfItems(buf));
  if (!op || !t.draw) return;
  // Cada partido del orden de juego que es de la previa (los dos jugadores, en un cruce del cuadro) se apunta con su día y hora.
  // Se guarda: el orden de juego de mañana sustituye al de hoy, y lo de hoy hay que recordarlo
  t.sched ??= {};
  for (const m of op.matches) {
    if (!m.a.last || !m.b.last) continue;
    const ka = lastWord(m.a.last), kb = lastWord(m.b.last);
    const q = t.draw.matches.find(x => x.a && x.b && [lastWord(x.a.last), lastWord(x.b.last)].sort().join('|') === [ka, kb].sort().join('|'));
    if (q) t.sched[`${q.round}-${q.index}`] = { day: op.day, time: m.time, approx: m.approx, court: m.court, order: m.order };
  }
  await save(t);
}

// Qué toca ahora: lo más atrasado de todo
function dueJobs(now = Date.now()) {
  const jobs = [];
  for (const t of state.values()) {
    if (t.monday + 7 * DAY < now) continue; // torneo acabado
    if (t.status === 'other' || t.status === 'unreadable') { if (now - t.qsAt > 24 * 3600e3) jobs.push({ t, kind: 'qs', late: now - t.qsAt }); continue; }
    if (!t.draw) {
      // Con el torneo ya empezado, si no ha salido su cuadro ya no va a salir: no se sigue preguntando
      if (now > t.monday + DAY) continue;
      const soon = now > t.monday - 4 * DAY;
      const every = t.status === 'missing' ? (soon ? EVERY.missingSoon : EVERY.missing) : EVERY.waiting;
      if (now - t.qsAt >= every) jobs.push({ t, kind: 'qs', late: now - t.qsAt - every });
      continue;
    }
    const done = t.draw.matches.filter(m => m.round === t.draw.rounds).every(m => m.winner);
    const tz = t.zone?.tz || 'UTC', h = localHour(now, tz);
    const window = now >= t.monday - 3 * DAY && now < t.monday + 2 * DAY;
    const every = done ? EVERY.done : window ? (h >= 7 && h < 23 ? EVERY.live : EVERY.night) : EVERY.waiting;
    if (now - t.qsAt >= every) jobs.push({ t, kind: 'qs', late: now - t.qsAt - every });
    if (!done && window && now - (t.opAt || 0) >= every) jobs.push({ t, kind: 'op', late: now - (t.opAt || 0) - every });
  }
  return jobs.sort((a, b) => b.late - a.late);
}

// Los torneos de LiveScore de hoy y los dos días siguientes, como pista de qué Challenger se juegan (cada 2 h; sale de su caché)
let hintedAt = 0;
async function hintFromLiveScore() {
  if (Date.now() - hintedAt < 2 * 3600e3) return;
  hintedAt = Date.now();
  const days = [0, 1, 2].map(k => isoDay(Date.now() + k * DAY).replace(/-/g, ''));
  const list = await require('./livescore').challengers(days).catch(() => []);
  hint(list.map(m => ({ tournament: m.tournament, tournamentId: m.tournamentId })));
}

let running = false;
async function loop() {
  if (running) return;
  running = true;
  for (;;) {
    try {
      await hintFromLiveScore();
      // Los torneos que probar esta semana y la siguiente
      const list = await tournaments().catch(e => { console.error('[tennis] ProTennisLive (torneos):', e.message); return null; });
      for (const [k, t] of state) if (t.monday + 21 * DAY < Date.now()) state.delete(k);
      if (list) {
        for (const monday of mondays()) {
          const year = new Date(monday).getUTCFullYear();
          for (const c of candidates(list, monday)) {
            const key = `${year}-${c.id}`;
            if (!state.has(key)) state.set(key, { key, id: c.id, year, monday, name: c.name, status: 'new', qsAt: 0, opAt: 0 });
          }
        }
      }
      const [job] = dueJobs();
      if (!job) { await sleep(30e3); continue; }
      await (job.kind === 'qs' ? readDraw(job.t) : readOrder(job.t)).catch(e => { if (e.message !== '429') console.error(`[tennis] ProTennisLive ${job.t.id} ${job.kind}:`, e.message); });
    } catch (e) {
      console.error('[tennis] ProTennisLive:', e.message);
      await sleep(60e3);
    }
  }
}

async function start() {
  await restore();
  loop();
}

// ---------- Los partidos, con la forma de los de LiveScore ----------
const short = p => `${p.first ? `${p.first[0]}. ` : ''}${p.last}`;
function playerOf(p, me, score, winner) {
  const sets = score ? score.sets.map(s => (me === winner ? s : [s[1], s[0]])) : [];
  return {
    id: `ptl:${norm(p.name).replace(/ /g, '-')}`, name: p.name, short: short(p), flag: '', country: p.country || '', seed: p.seed ?? null, rank: null,
    entry: p.entry || null,
    sets: sets.map(s => s[0]), setWins: sets.map(s => s[0] > s[1]),
    // El PDF da los puntos del que pierde el desempate; el que lo gana hizo 7, o dos más si se alargó
    tiebreaks: sets.map((s, i) => (score.tb[i] == null ? null : s[0] < s[1] ? score.tb[i] : Math.max(7, score.tb[i] + 2))),
    winner: !!winner && me === winner,
    alt: [...new Set([p.last, short(p), `${p.last} ${p.first?.[0] || ''}`.trim()])]
  };
}

// Los partidos de la previa de los Challenger de [desde, hasta)
function games(from, to) {
  const out = [];
  for (const t of state.values()) {
    if (t.status !== 'active' || !t.draw) continue;
    const d = t.draw, tz = t.zone?.tz || 'UTC';
    // Sin orden de juego, el día se calcula hacia atrás desde el de la ronda final (domingo si no se sabe; en muchos es el lunes)
    const finalDay = Object.entries(t.sched || {}).find(([k]) => Number(k.split('-')[0]) === d.rounds)?.[1]?.day;
    const base = finalDay ? dayMs(finalDay) : t.monday - DAY;
    const panel = panels.get(cityKey(d.city));
    for (const m of d.matches) {
      if (!m.a || !m.b || m.a.bye || m.b.bye) continue;
      const s = t.sched?.[`${m.round}-${m.index}`];
      const guessDay = isoDay(base - (d.rounds - m.round) * DAY);
      const date = s?.time ? atLocal(s.day, s.time, tz) : atLocal(s?.day || guessDay, '10:00', tz);
      if (date < from || date >= to) continue;
      const approx = !s?.time ? 'hora por confirmar' : s.approx || (!t.zone?.sure ? 'hora aproximada' : '');
      const sc = m.score;
      out.push({
        id: `ptl:${t.year}-${t.id}-${m.round}-${m.index}`, tour: 'atp', level: 'challenger', source: 'ProTennisLive',
        tournament: panel?.tournament || d.city, tournamentId: panel?.tournamentId || `ptl:${t.id}`, major: false, date: new Date(date).toISOString(),
        state: m.winner ? 'post' : 'pre', status: m.winner ? (sc?.wo ? 'W.O.' : sc?.ret ? 'Retirada' : 'Final') : '',
        round: m.round === d.rounds && d.rounds > 1 ? 'Previa, ronda final' : `Previa, ${m.round}.ª ronda`,
        court: s?.court || '', city: d.city, bestOf: 3, note: approx ? `${approx[0].toUpperCase()}${approx.slice(1)}` : '',
        a: playerOf(m.a, 'a', sc, m.winner), b: playerOf(m.b, 'b', sc, m.winner)
      });
    }
  }
  return out;
}

// Lo que se sabe, para comprobarlo (y para el registro)
const status = () => [...state.values()].filter(t => t.monday + 7 * DAY >= Date.now()).map(t => ({
  id: t.id, year: t.year, week: isoDay(t.monday), name: t.draw?.name || t.name, city: t.draw?.city || '', status: t.status,
  matches: t.draw?.matches.length || 0, decided: t.draw?.matches.filter(m => m.winner).length || 0, scheduled: Object.keys(t.sched || {}).length,
  zone: t.zone?.tz || null, checked: t.qsAt ? new Date(t.qsAt).toISOString() : null
}));
const requests = () => ({ gap, pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null });

module.exports = { start, games, status, requests, hint, zoneOf, atLocal, candidates, mondays };
