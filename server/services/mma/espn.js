// UFC y PFL desde la API pública de ESPN: carteleras con sus combates, luchadores (récord) y resultado (ganador, método).
// El marcador de ESPN no trae el método: sale del endpoint de estado de cada combate terminado (cacheado mucho tiempo).
const SITE = org => `https://site.api.espn.com/apis/site/v2/sports/mma/${org}`;
const CORE = org => `https://sports.core.api.espn.com/v2/sports/mma/leagues/${org}`;

const ORGS = {
  ufc: { name: 'UFC', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/ufc.png' },
  pfl: { name: 'PFL', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/pfl.png' }
};

// 'kotko' → 'ko', 'submission' → 'sub', 'decision-unanimous' → 'dec'; lo demás (descalificación…) → 'other'
function methodOf(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return '';
  if (/^(kotko|ko|tko|ko-tko)/.test(s)) return 'ko';
  if (/^sub/.test(s)) return 'sub';
  // Una decisión técnica (parada por un corte o golpe bajo antes del final) cada casa la paga a su manera: a mano
  if (/technical/.test(s)) return 'other';
  if (/^dec/.test(s)) return 'dec';
  return 'other';
}

const headshot = id => `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;

function fighter(c) {
  const a = c.athlete || {};
  const full = a.displayName || a.fullName || '';
  const last = full.split(' ').slice(1).join(' ') || full;
  const id = String(c.id || '');
  return {
    id, name: full, short: a.shortName || '', country: a.flag?.alt || '', flag: a.flag?.href || '',
    record: c.records?.find(r => r.name === 'overall')?.summary || '', photo: id ? headshot(id) : '',
    // Cómo lo llaman las casas: "Topuria I.", "I. Topuria", "Topuria"
    alt: [...new Set([last, a.shortName, last && full ? `${last} ${full[0]}` : null].filter(Boolean))]
  };
}

// results: { [competitionId]: { name, round, time } } de los combates terminados (endpoint de estado)
function normalizeEvent(e, org, results = {}) {
  const comps = e?.competitions || [];
  const out = [];
  comps.forEach((c, i) => {
    const two = (c.competitors || []).slice().sort((x, y) => (x.order || 0) - (y.order || 0));
    if (two.length !== 2) return;
    const st = c.status?.type;
    const cancelled = /cancel|postpone|suspend/i.test(st?.name || '');
    const state = st?.state === 'in' ? 'in' : st?.state === 'post' || st?.completed ? 'post' : 'pre';
    const [a, b] = two.map(fighter);
    const rounds = c.format?.regulation?.periods || 3;
    const fight = {
      id: `${org}:${c.id}`, org, orgName: ORGS[org]?.name || org.toUpperCase(), event: e.name || '', eventId: String(e.id || ''),
      date: c.date || e.date, state, status: state === 'in' ? `${c.status?.period || 1}.º asalto ${c.status?.displayClock || ''}`.trim() : state === 'post' ? 'Final' : '',
      weightClass: c.type?.text || c.type?.abbreviation || '', title: /title/i.test(c.type?.text || ''), rounds,
      // ESPN las da por orden de cartelera: la última es el combate principal
      cardPos: comps.length - i, venue: c.venue?.fullName || '', city: c.venue?.address?.city || '', a, b
    };
    if (cancelled) fight.cancelled = true;
    if (state === 'post' && !cancelled) {
      const r = results[c.id] || {};
      const w = two.findIndex(x => x.winner);
      const name = String(r.name || '').toLowerCase();
      fight.result = {
        winner: w === 0 ? 'a' : w === 1 ? 'b' : null, method: methodOf(r.name),
        round: r.round ?? c.status?.period ?? null, time: r.time || c.status?.displayClock || '',
        draw: w < 0 && /draw/.test(name), noContest: w < 0 && /no.?contest|^nc$/.test(name)
      };
    }
    out.push(fight);
  });
  return out;
}

// Método, asalto y tiempo de un combate terminado (endpoint de estado de ESPN); null si no se puede leer: se ve el ganador y poco más
async function resultOf(getJSON, org, eventId, compId) {
  try {
    const url = `${CORE(org)}/events/${eventId}/competitions/${compId}/status`;
    let s = await getJSON(url, 7 * 864e5);
    // Recién acabado, ESPN puede no tener aún el método: no se da por bueno una semana
    if (!s.result?.name) s = await getJSON(url, 60e3);
    return { name: s.result?.name || '', round: s.period ?? null, time: s.displayClock || '' };
  } catch (_) { return null; }
}

// Completa el resultado de un combate ya normalizado con el método (para la ficha de un solo combate)
async function withResult(getJSON, f) {
  const r = await resultOf(getJSON, f.org, f.eventId, f.id.split(':')[1]);
  if (r && f.result) Object.assign(f.result, { method: methodOf(r.name), round: r.round ?? f.result.round, time: r.time || f.result.time });
  return f;
}

// Combates de una organización entre dos fechas (AAAAMMDD). getJSON: la caché compartida (shared/cached.js). El método de los
// terminados sale de su estado: como no cambia, la caché lo guarda una semana
async function fights(getJSON, org, fromYmd, toYmd, ttl = 20e3, withResults = true) {
  const j = await getJSON(`${SITE(org)}/scoreboard?dates=${fromYmd}-${toYmd}`, ttl);
  const out = [];
  for (const e of j.events || []) {
    const done = withResults ? (e.competitions || []).filter(c => c.status?.type?.completed) : [];
    const results = {};
    await Promise.all(done.map(async c => { results[c.id] = await resultOf(getJSON, org, e.id, c.id); }));
    out.push(...normalizeEvent(e, org, results));
  }
  return out;
}

// Ficha de un luchador de ESPN: edad, medidas (en métrico), KO y sumisiones ganados y estilo. a: el atleta; rec: su récord total;
// st: sus estadísticas. Lo que falta sale null, no 0 (un 0 diría que no ha ganado nunca por KO)
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, k) => (v == null ? null : Math.round(v * k));
function parseProfile(a, rec, st) {
  const stat = Object.fromEntries((rec?.stats || []).map(x => [x.name, num(x.value)]));
  const style = Object.fromEntries(((st?.splits?.categories) || []).flatMap(c => c.stats || []).map(x => [x.name, num(x.value)]));
  const wins = stat.wins ?? null, kos = stat.tkos ?? null, subs = stat.submissions ?? null;
  const dec = wins != null && kos != null && subs != null ? Math.max(0, wins - kos - subs) : null;
  return {
    age: num(a?.age), heightCm: round(num(a?.height), 2.54), reachCm: round(num(a?.reach), 2.54), weightKg: round(num(a?.weight), 0.45359),
    stance: a?.stance?.text || '', country: a?.citizenship || '',
    wins, losses: stat.losses ?? null, draws: stat.draws ?? null, kos, subs, decisions: dec, titleWins: stat.titleWins ?? null,
    strikesPerMin: style.strikeLPM ?? null, strikeAccuracy: style.strikeAccuracy ?? null, takedownAvg: style.takedownAvg ?? null, submissionAvg: style.submissionAvg ?? null
  };
}

// Pide las tres fichas del luchador a la API core de ESPN (una tarda poco; la caché las guarda un día)
async function profile(getJSON, id) {
  const base = `https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}`;
  const ttl = 24 * 3600e3;
  const [a, rec, st] = await Promise.all([
    getJSON(`${base}?lang=en&region=us`, ttl),
    getJSON(`${base}/records/0?lang=en&region=us`, ttl).catch(() => null),
    getJSON(`${base}/statistics?lang=en&region=us`, ttl).catch(() => null)
  ]);
  return parseProfile(a, rec, st);
}

module.exports = { ORGS, methodOf, normalizeEvent, fights, fighter, withResult, parseProfile, profile };
