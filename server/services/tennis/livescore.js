'use strict';
// Los partidos ATP Challenger (ESPN no los trae) y los puntos del juego de la ATP (su web responde 403) salen de la API de la app de
// LiveScore, sin documentar. El robots.txt de su web prohíbe /api/: se usa por decisión expresa del usuario, para uso personal, sin
// disfrazar las peticiones (docs/specs/09-tenis.md). Nada se guarda en tennis.cache.

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
      if (hit) { mem.set(path, { ...hit, running: null }); return hit.v; }
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
    id: `ls${t.ID}`, name: t.Nm, short, flag: '', country: '', seed: null, rank: null,
    sets: sets.map(s => s[me]),
    setWins: sets.map((s, i) => (i < sets.length - 1 || done) && s[me] > s[1 - me]),
    tiebreaks: sets.map((_, i) => num(e[`Tr${me + 1}S${i + 1}T`])),
    winner: e.Ewt === me + 1,
    // Cómo lo llaman las casas: los mismos nombres que con ESPN
    alt: [...new Set([last, short, `${last} ${t.Nm[0]}`])]
  };
}

function matchOf(st, e) {
  const { state, status } = stateOf(e), sets = setsOf(e);
  const a = playerOf(e.T1[0], 0, e, sets, e.Eps === 'FT'), b = playerOf(e.T2[0], 1, e, sets, e.Eps === 'FT');
  return {
    id: `ch:${e.Eid}`, tour: 'atp', level: 'challenger', tournament: st.Snm.replace(QUALI, ''), tournamentId: String(st.Sid), major: false, date: dateOf(e.Esd),
    state, status, round: roundOf(st, e), court: '', city: '', bestOf: 3, note: '', a, b,
    // withPoints lo convierte en points y lo quita: no sale del servicio
    ...(isLive(e) ? { record: record(e) } : {})
  };
}

// days: 'AAAAMMDD' en UTC. Sólo hoy y ayer cambian de verdad
async function challengers(days) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const feeds = await Promise.all(days.map(d => feed(`/date/tennis/${d}/0?MD=1`, d === today || d === yesterday ? LIVE_TTL : DAY_TTL).catch(err => { console.error(`[tennis] LiveScore ${d}:`, err.message); return null; })));
  const seen = new Set(), out = [];
  for (const j of feeds) {
    for (const st of j?.Stages || []) {
      if (st.Cnm !== 'ATP Challenger') continue;
      for (const e of singles(st)) {
        // Los cancelados no se llegaron a jugar y sólo ensucian la lista
        if (seen.has(e.Eid) || e.Eps === 'Canc.') continue;
        seen.add(e.Eid);
        out.push(matchOf(st, e));
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

module.exports = { liveAtp, challengers, mainTour };
