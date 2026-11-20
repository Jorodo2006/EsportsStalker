'use strict';
// Los partidos ATP Challenger (ESPN no los trae) y los puntos del juego de la ATP (su web responde 403) salen de la API de la app de
// LiveScore, sin documentar. El robots.txt de su web prohíbe /api/: se usa por decisión expresa del usuario, para uso personal, sin
// disfrazar las peticiones (docs/specs/09-tenis.md). Nada se guarda en tennis.cache.

const { pairOf, withMtb } = require('./doubles');
const { flagOf } = require('./flags');

const API = 'https://prod-public-api.livescore.com/v1/api/app';
const LIVE_TTL = 15e3;
const DAY_TTL = 5 * 60e3;

// Caducado hace poco (hasta tres veces su duración, 45 s en directo): se devuelve lo que había mientras se renueva por detrás
const staleFor = ttl => Math.min(ttl * 3, 10 * 60e3);
const mem = new Map();
function feed(path, ttl) {
  const hit = mem.get(path);
  const age = hit ? Date.now() - hit.t : Infinity;
  if (hit && age < ttl) return Promise.resolve(hit.v);
  const recent = hit?.v != null && age < ttl + staleFor(ttl);
  if (hit?.running) return recent ? Promise.resolve(hit.v) : hit.running;
  const running = (async () => {
    try {
      const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`respondió ${res.status}`);
      const v = await res.json();
      mem.set(path, { t: Date.now(), v });
      return v;
    } catch (e) {
      // Si falla, lo último que se leyó sigue valiendo para la lista; los puntos no se enseñan sin fecha reciente (ver changed)
      if (hit?.v != null) { mem.set(path, { ...hit, running: null }); return hit.v; }
      // Sin nada leído antes, se borra la entrada para que la siguiente consulta lo vuelva a pedir. Antes se quedaba guardada la
      // promesa fallida: un corte en la primera petición del día (al arrancar el contenedor el 19-11-2026) dejó sin Challenger ese
      // día y el siguiente hasta reiniciar, devolviendo el mismo error al momento y sin volver a preguntar
      mem.delete(path);
      throw e;
    }
  })();
  mem.set(path, { ...(hit || { t: 0, v: null }), running });
  if (recent) { running.catch(() => {}); return Promise.resolve(hit.v); }
  return running;
}

const num = v => (v == null || v === '' ? null : Number(v));
const singles = st => (st.Events || []).filter(e => e.T1?.length === 1 && e.T2?.length === 1);
const setsOf = e => { const out = []; for (let i = 1; i <= 5; i++) { const a = num(e[`Tr1S${i}`]), b = num(e[`Tr2S${i}`]); if (a == null || b == null) break; out.push([a, b]); } return out; };
const lastWord = n => String(n).trim().split(/\s+/).pop();
const isLive = e => /^S\d$/.test(e.Eps);

// Cuándo cambió por última vez el marcador de cada partido: esta API no lo dice. Y si ya ha dado puntos: cuando no los trae es que
// van 0-0, pero en un partido que nunca los ha traído no se sabe, y un 0-0 fijo sería mentira
const track = new Map();
function changed(e, now = Date.now()) {
  const key = `${JSON.stringify(setsOf(e))}|${e.Tr1G ?? ''}|${e.Tr2G ?? ''}`;
  const cur = track.get(e.Eid);
  const covered = !!cur?.covered || e.Tr1G != null || e.Tr2G != null;
  const at = cur && cur.key === key ? cur.at : now;
  if (track.size > 3000) track.clear();
  track.set(e.Eid, { key, at, covered });
  return { at, covered };
}

// Los puntos y quién saca, en el formato de points.js. null en los dos puntos: todavía no se sabe
function record(e) {
  const { at, covered } = changed(e);
  const zero = covered ? '0' : null;
  return {
    source: 'LiveScore', lastA: lastWord(e.T1[0].Nm), lastB: lastWord(e.T2[0].Nm), sets: setsOf(e),
    a: e.Tr1G ?? zero, b: e.Tr2G ?? zero, serve: e.Esrv === 1 ? 'a' : e.Esrv === 2 ? 'b' : null, at
  };
}

// Los partidos en juego de la ATP, para cruzarlos con los de ESPN
async function liveAtp() {
  const j = await feed('/live/tennis/0?MD=1', LIVE_TTL);
  return (j.Stages || []).filter(s => /^ATP/.test(s.Cnm)).flatMap(singles).filter(isLive).map(record);
}

// ---------- los partidos Challenger, con la misma forma que los de ESPN ----------
// 16, 8, 4 y 2 partidos: se comprobó contando los de cada código en un torneo entero
const ROUNDS = { 4: 'Dieciseisavos de final', 5: 'Octavos de final', 6: 'Cuartos de final', 7: 'Semifinales' };
const QUALI = /:\s*Qualification.*$/i;
const roundOf = (st, e) => (QUALI.test(st.Snm) ? 'Previa' : e.ErnInf === 'final' ? 'Final' : ROUNDS[String(e.ErnInf)[0]] || '');

// 20261105101000, en UTC porque se pide con la zona 0
const dateOf = v => { const s = String(v); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00Z`; };

function stateOf(e) {
  if (e.Eps === 'NS') return { state: 'pre', status: '' };
  if (isLive(e)) return { state: 'in', status: `${e.Eps[1]}.º set` };
  if (/susp|int/i.test(e.Eps)) return { state: 'in', status: 'Interrumpido' };
  if (/post|delay/i.test(e.Eps)) return { state: 'pre', status: '' };
  return { state: 'post', status: ({ FT: 'Final', 'Ret.': 'Retirada', 'W.O.': 'W.O.' })[e.Eps] || e.Eps };
}

function playerOf(t, side, e, sets, done) {
  const me = side === 0 ? 0 : 1, words = String(t.Nm).split(/\s+/), last = words.slice(1).join(' ') || t.Nm, short = `${words[0][0]}. ${last}`;
  return {
    id: `ls${t.ID}`, name: t.Nm, short, flag: flagOf(t.CoId, t.CoNm), country: t.CoNm || '', seed: null, rank: null,
    sets: sets.map(s => s[me]),
    setWins: sets.map((s, i) => (i < sets.length - 1 || done) && s[me] > s[1 - me]),
    tiebreaks: sets.map((_, i) => num(e[`Tr${me + 1}S${i + 1}T`])),
    winner: e.Ewt === me + 1,
    // Cómo lo llaman las casas: los mismos nombres que con ESPN
    alt: [...new Set([last, short, `${last} ${t.Nm[0]}`])]
  };
}

// extra: lo que cambia en la previa de la ATP y la WTA (qualifying), que no son Challenger
function matchOf(st, e, extra = {}) {
  const { state, status } = stateOf(e), sets = setsOf(e);
  const a = playerOf(e.T1[0], 0, e, sets, e.Eps === 'FT'), b = playerOf(e.T2[0], 1, e, sets, e.Eps === 'FT');
  return {
    id: `ch:${e.Eid}`, tour: 'atp', level: 'challenger', tournament: st.Snm.replace(QUALI, ''), tournamentId: String(st.Sid), major: false, date: dateOf(e.Esd),
    state, status, round: roundOf(st, e), court: '', city: '', bestOf: 3, note: '', a, b,
    // withPoints lo convierte en points y lo quita: no sale del servicio
    ...(isLive(e) ? { record: record(e) } : {}),
    ...extra
  };
}

// El país de cada jugador (nombre en inglés y código ISO: "Spain", "ESP"): los días no lo traen y la fase entera sí. Se pide una vez
// por torneo cada 30 min, y es la misma petición para los individuales y los dobles (van en la misma fase)
const stageFeed = st => feed(`/stage/tennis/${st.Ccd}/${st.Scd}/0?MD=1`, 30 * 60e3);
function countriesIn(events) {
  const out = new Map();
  for (const e of events) for (const t of [...(e.T1 || []), ...(e.T2 || [])]) if (t.CoNm || t.CoId) out.set(String(t.ID), { name: t.CoNm || '', code: t.CoId || '' });
  return out;
}
async function stageCountries(stages) {
  const out = new Map();
  await Promise.all([...stages].map(st => stageFeed(st).then(j => { for (const [k, v] of countriesIn(j?.Stages?.[0]?.Events || [])) out.set(k, v); }).catch(() => {})));
  return out;
}
// El país y la bandera de un jugador que no los trae
const withCountry = (p, c) => { if (!c) return; p.country ||= c.name; p.flag ||= flagOf(c.code, c.name); };

// days: 'AAAAMMDD' en UTC. Sólo hoy y ayer cambian de verdad
// Los días enteros (todo el tenis de cada uno): los individuales y los dobles de los Challenger salen de las mismas peticiones
function dayFeeds(days) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  return Promise.all(days.map(d => feed(`/date/tennis/${d}/0?MD=1`, d === today || d === yesterday ? LIVE_TTL : DAY_TTL).catch(err => { console.error(`[tennis] LiveScore ${d}:`, err.message); return null; })));
}

async function challengers(days) {
  const feeds = await dayFeeds(days);
  const seen = new Set(), out = [], stages = new Map();
  for (const j of feeds) {
    for (const st of j?.Stages || []) {
      if (st.Cnm !== 'ATP Challenger') continue;
      stages.set(`${st.Ccd}/${st.Scd}`, st);
      for (const e of singles(st)) {
        // Los cancelados no se llegaron a jugar y sólo ensucian la lista
        if (seen.has(e.Eid) || e.Eps === 'Canc.') continue;
        seen.add(e.Eid);
        out.push({ m: matchOf(st, e), ids: [String(e.T1[0].ID), String(e.T2[0].ID)] });
      }
    }
  }
  const country = await stageCountries(stages.values());
  return out.map(({ m, ids }) => { withCountry(m.a, country.get(ids[0])); withCountry(m.b, country.get(ids[1])); return m; });
}

// ---------- La previa de los torneos ATP y WTA ----------
// ESPN trae la de unos torneos y la de otros no (el 1-11-2026 faltaban la de París, Chennai y Hong Kong; el 8, la segunda jornada
// de Estocolmo). LiveScore la da como una fase aparte ("Paris Masters: Qualification"). La de los Challenger no la tiene en ningún
// sitio (ni en los días, ni como fase, ni en su web; comprobado en noviembre de 2026): ver docs/specs/09-tenis.md.
const isTour = st => /^(ATP|WTA)/.test(st.Cnm) && !/challenger|125|ITF/i.test(st.Cnm) && !/doubles/i.test(st.Snm);

// La fase entera (se pide una vez cada 30 min): el primer dígito de ErnInf es la ronda (4xxx, 5xxx, 6xxx: menos jugadores cuanto más
// alto), y con todas se sabe cuál es la 1.ª, la 2.ª… y la final; un día suelto sólo trae una. También trae el país de cada jugador,
// que los días no traen. null si no se ha podido pedir: entonces sólo se dice "Previa"
async function qualiStage(st) {
  const j = await stageFeed(st);
  const events = j?.Stages?.[0]?.Events || [];
  const digits = [...new Set(events.map(e => String(e.ErnInf)[0]).filter(d => /\d/.test(d)))].sort();
  return digits.length ? { digits, country: countriesIn(events) } : null;
}
const qualiRound = (stage, e) => {
  const n = stage ? stage.digits.indexOf(String(e.ErnInf)[0]) + 1 : 0;
  if (n < 1) return 'Previa';
  return n === stage.digits.length && n > 1 ? 'Previa, ronda final' : `Previa, ${n}.ª ronda`;
};

async function qualifying(days) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const feeds = await Promise.all(days.map(d => feed(`/date/tennis/${d}/0?MD=1`, d >= today ? LIVE_TTL : DAY_TTL).catch(() => null)));
  const seen = new Set(), out = [];
  for (const j of feeds) {
    for (const st of j?.Stages || []) {
      if (!isTour(st) || !QUALI.test(st.Snm)) continue;
      const stage = await qualiStage(st).catch(() => null);
      for (const e of singles(st)) {
        if (seen.has(e.Eid) || e.Eps === 'Canc.') continue;
        seen.add(e.Eid);
        const m = matchOf(st, e, {
          id: `lsq:${e.Eid}`, tour: /^WTA/.test(st.Cnm) ? 'wta' : 'atp', level: undefined, tournamentId: `lsq:${st.Sid}`,
          round: qualiRound(stage, e), source: 'LiveScore'
        });
        for (const [p, t] of [[m.a, e.T1[0]], [m.b, e.T2[0]]]) withCountry(p, stage?.country.get(String(t.ID)));
        out.push(m);
      }
    }
  }
  return out;
}

// Los individuales de la ATP y la WTA (sin Challenger ni ITF) de unos días, sólo la hora y los nombres: para comprobar los
// cruces de ESPN, que a veces pone a la rival equivocada (en las WTA Finals de 2026 dio a la reserva en lugar de Muchova)
async function mainTour(days) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const feeds = await Promise.all(days.map(d => feed(`/date/tennis/${d}/0?MD=1`, d >= today ? LIVE_TTL : DAY_TTL).catch(() => null)));
  const seen = new Set(), out = [];
  for (const j of feeds) {
    for (const st of j?.Stages || []) {
      if (!/^(ATP|WTA)/.test(st.Cnm) || /challenger|125|ITF/i.test(st.Cnm) || /doubles/i.test(st.Snm)) continue;
      for (const e of singles(st)) {
        if (seen.has(e.Eid) || e.Eps === 'Canc.') continue;
        seen.add(e.Eid);
        out.push({ at: new Date(dateOf(e.Esd)).getTime(), a: e.T1[0].Nm, b: e.T2[0].Nm });
      }
    }
  }
  return out;
}

// ---------- Los dobles de los Challenger ----------
// Van en la misma fase que los individuales ("Metz, France"), con dos jugadores en T1 y T2, y salen de los mismos días: ni una
// petición más. La previa de dobles no la hay. El país de cada uno sale de la fase entera, como en los individuales; los puntos del
// juego no se traen
const doubles = st => (st.Events || []).filter(e => e.T1?.length === 2 && e.T2?.length === 2);
function doublesOf(st, e, country = new Map()) {
  const { state, status } = stateOf(e), sets = setsOf(e), done = e.Eps === 'FT';
  const one = t => { const c = country.get(String(t.ID)); return { name: t.Nm, country: t.CoNm || c?.name || '', flag: flagOf(t.CoId || c?.code, t.CoNm || c?.name) }; };
  const side = (ts, me) => pairOf(`dbl:ls${ts.map(t => t.ID).join('-')}`, ts.map(one), {
    sets: sets.map(s => s[me]), setWins: sets.map((s, i) => (i < sets.length - 1 || done) && s[me] > s[1 - me]),
    tiebreaks: sets.map((_, i) => num(e[`Tr${me + 1}S${i + 1}T`])), winner: e.Ewt === me + 1
  });
  return withMtb({
    id: `dbl:ch:${e.Eid}`, tour: 'atp', level: 'challenger', tournament: st.Snm, tournamentId: String(st.Sid), major: false, date: dateOf(e.Esd),
    state, status, round: roundOf(st, e), court: '', city: '', bestOf: 3, note: '', a: side(e.T1, 0), b: side(e.T2, 1), doubles: true
  });
}

async function challengerDoubles(days) {
  const seen = new Set(), found = [], stages = new Map();
  for (const j of await dayFeeds(days)) {
    for (const st of j?.Stages || []) {
      if (st.Cnm !== 'ATP Challenger' || QUALI.test(st.Snm)) continue;
      for (const e of doubles(st)) {
        if (seen.has(e.Eid) || e.Eps === 'Canc.') continue;
        seen.add(e.Eid);
        stages.set(`${st.Ccd}/${st.Scd}`, st);
        found.push([st, e]);
      }
    }
  }
  const country = await stageCountries(stages.values());
  return found.map(([st, e]) => doublesOf(st, e, country));
}

module.exports = { liveAtp, challengers, challengerDoubles, mainTour, qualifying };
