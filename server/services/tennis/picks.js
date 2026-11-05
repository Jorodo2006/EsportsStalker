'use strict';
// Recomendaciones de un partido: cruza el modelo (model.js) con las cuotas de las casas. Para cada mercado que el modelo sabe
// calcular estima la probabilidad, la mezcla con la de la casa sin margen y separa la más fiable, las fáciles y las difíciles.
// Es una estimación: no hay cuotas históricas gratuitas con las que comprobar si a la larga se gana dinero.
const client = require('../../shared/client');
const M = require('./model');
const tml = require('./tml');

const { clamp, logit, sigmoid, norm } = M;
const W_MODEL = 0.25; // las casas aciertan más que cualquier modelo público: el modelo matiza, no manda
const W_THIN = 0.1; // con poca muestra de alguno de los dos, todavía menos
const THIN_POINTS = 2500; // puntos ponderados, unos 20-25 partidos recientes
const ASSUMED_MARGIN = 0.07; // margen supuesto cuando la casa sólo da un lado de la línea
const STALE_MS = 6 * 3600e3;
const MAX_DISAGREE = 0.2; // tanta diferencia con la casa suele ser que falta algo (lesión, retirada) o un mercado mal leído
const MIN_PRICE = 1.15; // por debajo se arriesga mucho para ganar casi nada
const MAX_PRICE_HARD = 15;

// ---------- Estado del modelo por circuito: se recalcula sólo cuando cambian los CSV ----------
const states = new Map();
async function stateOf(tour) {
  const data = await tml.dataset(tour);
  const cur = states.get(tour);
  if (cur?.data === data) return cur;
  const next = { data, ...M.replay(data.rows) };
  states.set(tour, next);
  return next;
}

// ---------- Qué dice cada selección ----------
const lastWord = n => norm(n).split(' ').pop();
// A quién se refiere un texto de la casa: "T. Paul", "Daniel Merida Aguilar"…
function whoIn(text, m) {
  const t = ` ${norm(text)} `;
  const has = p => [p.name, ...(p.alt || [])].some(n => t.includes(` ${lastWord(n)} `));
  const a = has(m.a), b = has(m.b);
  return a === b ? null : a ? 'a' : 'b';
}
const isOver = s => /^(m[aá]s|over)/i.test(s), isUnder = s => /^(menos|under)/i.test(s);
const yes = s => /^s[ií]$/i.test(s);
const numIn = s => { const x = String(s).match(/[-+]?\d+(?:[.,]\d+)?/); return x ? Number(x[0].replace(',', '.')) : null; };

// Lo que necesita saber la selección de un resultado: x, y (sets), ga, gb (juegos), tb, s1
const setsOf = (o, who) => (who === 'a' ? o.x - o.y : o.y - o.x);
const wins = (o, who) => (who === 'a' ? o.x > o.y : o.y > o.x);
const gamesOf = (o, who) => (who === 'a' ? o.ga : o.gb);
const SET_FAMILY = { 21: '1.er set', 22: '2.º set' };

// Devuelve { test, scope, family, side } o null si el modelo no sabe calcular ese mercado (aces, roturas, primeros juegos…)
function rule(line, outcome, m) {
  const [type, , whoKey] = line.key.split('|');
  const scope = line.period === 0 ? 'match' : SET_FAMILY[line.period] ? 'set' : line.period === 50 ? 'match' : null;
  if (!scope) return null;
  const inSet = SET_FAMILY[line.period];
  const prefix = inSet ? `${inSet} · ` : '';
  const L = line.line;
  const half = L == null || !Number.isInteger(L); // las líneas enteras pueden ser nulas: se dejan fuera
  const g = norm(line.group), label = outcome.label;
  const side = outcome.id === 'a' ? 'a' : outcome.id === 'b' ? 'b' : null;
  if (type === 'moneyline') return { scope, side, family: inSet ? `${prefix}Ganador` : 'Ganador', test: o => wins(o, side) };
  if (type === 'spread' && half) {
    const h = side === 'a' ? L : -L;
    return { scope, side, family: `${prefix}Hándicap de juegos`, test: o => (side === 'a' ? o.ga - o.gb : o.gb - o.ga) + h > 0 };
  }
  if (type === 'total' && half) return { scope, side: null, family: `${prefix}Total de juegos`, test: o => (outcome.id === 'over' ? o.ga + o.gb > L : o.ga + o.gb < L) };
  if (type === 'team_total' && half) return { scope, side: outcome.id === 'over' ? whoKey : null, family: `${prefix}Juegos de ${m[whoKey].name}`, test: o => (outcome.id === 'over' ? gamesOf(o, whoKey) > L : gamesOf(o, whoKey) < L) };
  if (inSet && /total partidos/.test(g) && half) return { scope, side: null, family: `${prefix}Total de juegos`, test: o => (isOver(label) ? o.ga + o.gb > L : o.ga + o.gb < L) };
  if (line.period === 21 && /resultado exacto$/.test(g)) {
    const who = whoIn(label, m), s = label.match(/(\d)-(\d)\s*$/);
    if (!who || !s) return null;
    return { scope, side: who, family: '1.er set · Resultado', test: o => gamesOf(o, who) === +s[1] && gamesOf(o, who === 'a' ? 'b' : 'a') === +s[2] };
  }
  if (line.period !== 50 && line.period !== 0) return null;
  if (/^numero de sets \d|^total sets/.test(g) && L != null) return { scope: 'match', side: null, family: 'Número de sets', test: o => (isOver(label) ? o.x + o.y > L : o.x + o.y < L) };
  if (/^handicap de sets?/.test(g)) {
    const who = whoIn(label, m), h = numIn(label.replace(/^.*?([-+]\d)/, '$1'));
    if (!who || h == null) return null;
    return { scope: 'match', side: who, family: 'Hándicap de sets', test: o => setsOf(o, who) + h > 0 };
  }
  if (/^gana al menos un set/.test(g)) {
    const who = whoIn(line.group, m);
    if (!who) return null;
    const w = yes(label);
    return { scope: 'match', side: w ? who : null, family: 'Gana un set', test: o => ((who === 'a' ? o.x : o.y) >= 1) === w };
  }
  // Los dos pueden ganar un set: las cuotas no suman 100 % entre ellas y no se les puede quitar el margen juntas
  if (/^ganara un set/.test(g)) { const who = whoIn(label, m); return who && { open: true, scope: 'match', side: who, family: 'Gana un set', test: o => (who === 'a' ? o.x : o.y) >= 1 }; }
  if (/^tiebreak$/.test(g)) { const w = yes(label); return { scope: 'match', side: null, family: 'Tie-break', test: o => (o.tb === 1) === w }; }
  if (/^apuesta de set/.test(g)) {
    const who = whoIn(label, m), s = label.match(/(\d)-(\d)\s*$/);
    if (!who || !s) return null;
    return { scope: 'match', side: who, family: 'Resultado en sets', test: o => wins(o, who) && (who === 'a' ? o.y : o.x) === +s[2] };
  }
  if (/^ganador y numero de juegos/.test(g)) {
    const who = whoIn(label, m), over = /m[aá]s/i.test(label), T = numIn(label);
    if (!who || T == null || Number.isInteger(T)) return null;
    return { scope: 'match', side: who, family: 'Ganador y juegos', test: o => wins(o, who) && (over ? o.ga + o.gb > T : o.ga + o.gb < T) };
  }
  if (/victoria y total de juegos/.test(g) && half && L != null) {
    const who = whoIn(line.group, m);
    if (!who) return null;
    // Sólo cubre las victorias de uno: abierto como el anterior
    return { open: true, scope: 'match', side: who, family: 'Ganador y juegos', test: o => wins(o, who) && (isOver(label) ? o.ga + o.gb > L : o.ga + o.gb < L) };
  }
  if (/^doble resultado/.test(g)) {
    const parts = label.split(/\s+y\s+/);
    if (parts.length !== 2) return null;
    const s1 = whoIn(parts[0], m), w = whoIn(parts[1], m);
    return s1 && w ? { scope: 'match', side: w, family: 'Primer set y partido', test: o => o.s1 === s1 && wins(o, w) } : null;
  }
  return null;
}

// Cómo se lee la apuesta: "Sí" o "Más de 20.5" sueltos no dicen nada fuera de su mercado
function titleOf(line, o, r, m) {
  const sur = w => m[w].name.split(' ').slice(1).join(' ') || m[w].name;
  const dec = v => String(v).replace('.', ',');
  const inSet = SET_FAMILY[line.period];
  const pre = inSet ? `${inSet}: ` : '';
  const [type, , who] = line.key.split('|');
  const low = /^m[aá]s|over/i.test(o.label) || o.id === 'over' ? 'más' : 'menos';
  if (type === 'moneyline') return `${inSet ? `${inSet}: gana` : 'Gana'} ${m[o.id].name}`;
  if (type === 'spread') return `${pre}${m[o.id].name} ${o.id === 'a' ? (line.line > 0 ? '+' : '') : (line.line < 0 ? '+' : '')}${dec(o.id === 'a' ? line.line : -line.line)} juegos`;
  if (type === 'total' || /total partidos/i.test(line.group)) return `${pre}${low === 'más' ? 'Más' : 'Menos'} de ${dec(line.line)} juegos`;
  if (type === 'team_total') return `${inSet ? `${inSet}, ` : ''}${sur(who)}: ${low} de ${dec(line.line)} juegos`;
  if (r.family === 'Número de sets') return `${low === 'más' ? 'Más' : 'Menos'} de ${dec(line.line)} sets`;
  if (r.family === 'Tie-break') return yes(o.label) ? 'Habrá tie-break' : 'Sin tie-break';
  if (/^gana al menos un set/i.test(line.group)) { const w = whoIn(line.group, m); return `${sur(w)} ${yes(o.label) ? 'gana' : 'no gana'} un set`; }
  if (/^ganar[aá] un set/i.test(line.group)) return `${sur(r.side)} gana un set`;
  if (r.family === 'Hándicap de sets') return `${o.label.replace(/(-|\+)?\d.*$/, '').trim()} ${(o.label.match(/[-+]\d(?:[.,]\d)?/) || [''])[0].replace('.', ',')} sets`;
  if (r.family === 'Resultado en sets') return `Gana ${o.label}`;
  if (r.family === '1.er set · Resultado') return `1.er set: ${o.label}`;
  if (/victoria y total de juegos/i.test(line.group)) return `Gana ${sur(r.side)} y ${low} de ${dec(line.line)} juegos`;
  if (r.family === 'Ganador y juegos') return `Gana ${o.label.replace(',', ',')} juegos`;
  if (r.family === 'Primer set y partido') { const [x, y] = o.label.split(/\s+y\s+/); return x === y ? `${x} gana el 1.er set y el partido` : `${x} gana el 1.er set y ${y} el partido`; }
  return o.label;
}

// Probabilidad de la casa sin margen: la media de cada casa que da la línea completa
function marketProb(line, outcome, open) {
  const books = Object.keys(outcome.prices);
  const fair = books.map(bk => {
    const prices = line.outcomes.map(o => o.prices[bk]);
    const inv = 1 / outcome.prices[bk];
    return !open && prices.every(Boolean) ? inv / prices.reduce((t, p) => t + 1 / p, 0) : inv / (1 + ASSUMED_MARGIN);
  });
  return fair.reduce((t, x) => t + x, 0) / fair.length;
}

const blend = (model, market, w) => sigmoid(w * logit(clamp(model, 0.002, 0.998)) + (1 - w) * logit(clamp(market, 0.002, 0.998)));

// Lo calibrado que salió cada mercado en la comprobación con partidos pasados
const FAMILY_TRUST = { Ganador: 1, 'Hándicap de sets': 0.85, 'Gana un set': 0.85, 'Número de sets': 0.85, 'Tie-break': 0.6 };
const trustOf = f => FAMILY_TRUST[f] ?? (/Hándicap|Total|Juegos de/.test(f) ? 0.75 : /Ganador/.test(f) ? 0.75 : 0.5);

function reliabilityOf({ family, pModel, pMarket, gap, minPoints, books, age, sameSurface }) {
  const factors = [
    { label: 'Datos de los jugadores', max: 30, score: 30 * clamp(minPoints / 7000, 0, 1), note: `${Math.round(minPoints / 130)} partidos recientes el que menos` },
    // gap: la discrepancia sobre quién gana, que el modelo calcula sin mirar a la casa. Si ahí no coinciden, nada de lo demás es fiable
    { label: 'Modelo y casa de acuerdo', max: 35, score: 35 * clamp(1 - (Math.max(gap, Math.abs(pModel - pMarket)) - 0.03) / 0.15, 0, 1), note: `modelo ${Math.round(pModel * 100)} %, casa ${Math.round(pMarket * 100)} %` },
    { label: 'Mercado', max: 20, score: 20 * trustOf(family), note: 'qué tal se calcula este mercado' },
    { label: 'Cuotas', max: 15, score: 15 * (books > 1 ? 1 : 0.6) * (age > STALE_MS ? 0.4 : 1), note: `${books} ${books > 1 ? 'casas' : 'casa'}` }
  ];
  let score = factors.reduce((t, f) => t + f.score, 0);
  const warnings = [];
  if (sameSurface === false) { score -= 8; warnings.push('Superficie del torneo sin confirmar'); }
  score = Math.round(clamp(score, 0, 100));
  return { score, label: score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja', factors, warnings };
}

// Una frase con el motivo, a partir de los datos del partido
function reason(p, c) {
  const { m, exp, expA, expB, expSet, f, hold } = c;
  const nameOf = w => m[w].name.split(' ').slice(1).join(' ') || m[w].name;
  const es = v => v.toFixed(1).replace('.', ',');
  if (/set · Total de juegos/.test(p.family)) return `Se esperan ${es(expSet)} juegos en el set`;
  if (/Total de juegos/.test(p.family)) return `Se esperan ${es(exp)} juegos con ${Math.round(hold.a * 100)} % y ${Math.round(hold.b * 100)} % al saque`;
  if (/^Juegos de/.test(p.family)) return `Se esperan ${es(p.who === 'a' ? expA : expB)} juegos de ${nameOf(p.who)}`;
  if (/Tie-break/.test(p.family)) return `Saque al ${Math.round(hold.a * 100)} % y al ${Math.round(hold.b * 100)} %: ${hold.a + hold.b > 1.62 ? 'pocos breaks' : 'bastantes breaks'}`;
  if (p.side) {
    const me = p.side === 'a' ? f.ra : f.rb, ot = p.side === 'a' ? f.rb : f.ra;
    const sv = (me.sv - ot.sv) * 100, ret = (me.ret - ot.ret) * 100;
    const part = (v, t) => (Math.abs(v) < 0.3 ? null : `${v > 0 ? '+' : '−'}${es(Math.abs(v))} pts ${t}`);
    const elo = p.side === 'a' ? f.pElo : 1 - f.pElo;
    return [`Elo le da ${Math.round(elo * 100)} %`, part(sv, 'al saque'), part(ret, 'al resto')].filter(Boolean).join(' · ');
  }
  return `Se esperan ${es(exp)} juegos`;
}

// Elige sin repetir tipo de apuesta: dos líneas seguidas del mismo mercado no son dos ideas distintas
function pickDistinct(list, n, used = new Set()) {
  const out = [];
  for (const x of list) {
    if (out.length >= n) break;
    if (used.has(x.family)) continue;
    used.add(x.family); out.push(x);
  }
  return out;
}

async function picksFor(match, opts = {}) {
  const m = { ...match, league: match.tournament };
  if (match.state !== 'pre') return { ready: false, reason: match.state === 'in' ? 'started' : 'finished' };
  const odds = await client.call('odds', 'POST', '/api/odds/match', { match: { a: { name: m.a.name, code: '', alt: m.a.alt }, b: { name: m.b.name, code: '', alt: m.b.alt }, start: m.date, sport: 'tennis', league: m.tournament }, quiet: true });
  if (!odds?.markets?.length) return { ready: false, reason: 'noodds' };

  const st = await stateOf(m.tour);
  const key = n => { const k = tml.resolve(st.data, n); return k && st.players.has(k) ? k : null; };
  const edition = await tml.tournamentEdition(m.tour, m.tournament, m.city).catch(() => null);
  const surfaceName = edition?.surface || null;
  const surface = surfaceName || 'Hard';
  const day = Date.now() / 864e5;
  const empty = rank => ({ elo: rank ? 2400 - 190 * Math.log(rank) : 1300, n: 0, surf: {}, hist: [] });
  const ka = key(m.a.name), kb = key(m.b.name);
  const pa = ka ? st.players.get(ka) : empty(m.a.rank), pb = kb ? st.players.get(kb) : empty(m.b.rank);
  const avg = st.avgOf(M.conditionOf(surface, edition?.indoor));
  const f = M.predict(pa, pb, surface, day, avg, m.bestOf, M.paramsOf(m.tour));

  const ml = odds.markets.find(l => l.key === 'moneyline|0||');
  const oa = ml?.outcomes.find(o => o.id === 'a');
  const mlMarket = oa && Object.keys(oa.prices).length ? marketProb(ml, oa) : null;
  const minPoints = Math.min(f.ra.points, f.rb.points);
  // Cuanto más se aleja el modelo de la casa, más probable es que le falte algo (una lesión, por ejemplo): pesa menos
  const gap = mlMarket == null ? 0.1 : Math.abs(f.pModel - mlMarket);
  const w = (minPoints < THIN_POINTS ? W_THIN : W_MODEL) * clamp(1 - (gap - 0.05) / 0.2, 0.2, 1);
  const pFinal = mlMarket == null ? f.pModel : blend(f.pModel, mlMarket, w);
  // El partido se recalcula con la probabilidad final: el estilo sigue siendo el de las estadísticas
  const [sa, sb] = M.anchor(f.sa, f.sb, pFinal, m.bestOf);
  const dist = M.matchDistMix(sa, sb, m.bestOf);
  const setDist = M.firstSetDist(sa, sb).map(o => ({ x: o.a > o.b ? 1 : 0, y: o.b > o.a ? 1 : 0, ga: o.a, gb: o.b, tb: o.tb ? 1 : 0, s1: o.a > o.b ? 'a' : 'b', p: o.p }));
  const exp = dist.reduce((t, o) => t + o.p * (o.ga + o.gb), 0), expA = dist.reduce((t, o) => t + o.p * o.ga, 0), expB = exp - expA;
  const hold = { a: M.holdProb(sa), b: M.holdProb(sb) };
  const expSet = setDist.reduce((t, o) => t + o.p * (o.ga + o.gb), 0);
  const ctx = { m, exp, expA, expB, expSet, f, hold };
  const age = Math.max(0, Date.now() - Math.max(...Object.values(odds.sources).map(s => s.ts || 0)));

  const picks = [];
  for (const line of odds.markets) {
    for (const o of line.outcomes) {
      const books = Object.entries(o.prices).filter(([, v]) => v > 1);
      if (!books.length) continue;
      const r = rule(line, o, m);
      if (!r) continue;
      const pool = r.scope === 'set' ? setDist : dist;
      // En el ganador, el modelo sin mezclar: el partido ya está ajustado a la probabilidad final y no diría nada
      const pModel = line.key === 'moneyline|0||' ? (r.side === 'a' ? f.pModel : 1 - f.pModel) : pool.reduce((t, x) => t + (r.test(x) ? x.p : 0), 0);
      if (pModel <= 0.001) continue;
      const pMarket = marketProb(line, o, r.open);
      const p = blend(pModel, pMarket, w);
      const [book, price] = books.sort((x, y) => y[1] - x[1])[0];
      const who = line.key.split('|')[2];
      const pick = {
        id: `${line.key}#${o.id}`, title: titleOf(line, o, r, m), market: line.group, selection: o.label, family: r.family, side: r.side, who: who === 'a' || who === 'b' ? who : r.side,
        book, price, prices: o.prices, p, pModel, pMarket, fair: 1 / p, ev: p * price - 1,
        rel: reliabilityOf({ family: r.family, pModel, pMarket, gap, minPoints, books: books.length, age, sameSurface: surfaceName ? undefined : false })
      };
      picks.push(pick);
    }
  }

  const fav = pFinal >= 0.5 ? 'a' : 'b';
  // Sin ser una mala apuesta clara: el margen de la casa se come algo siempre, pero no se recomienda lo que se lo come todo
  const sane = x => Math.abs(x.pModel - x.pMarket) <= MAX_DISAGREE;
  const decent = x => sane(x) && x.ev >= -0.1 && x.rel.score >= 40;
  // La más fiable: probable, sin regalar margen y con un cálculo en el que se pueda confiar
  // Un set suelto cuenta menos que el partido: tiene más azar y la casa cobra más margen
  const score = x => x.p + x.ev + 0.05 * (x.rel.score / 100) - (/set ·/.test(x.family) ? 0.03 : 0);
  const easyPool = picks.filter(x => x.p >= 0.6 && x.price >= MIN_PRICE && decent(x)).sort((x, y) => score(y) - score(x));
  const top = easyPool.find(x => x.rel.score >= 50 && x.ev >= -0.07) ?? null;
  const used = new Set(top ? [top.family] : []);
  // Fáciles: las de más valor entre las muy probables. Difíciles: contra el favorito sólo si de verdad hay valor
  const easy = pickDistinct(easyPool.filter(x => x !== top).sort((x, y) => y.ev - x.ev), 3, used);
  const hardPool = picks.filter(x => sane(x) && x.p >= 0.15 && x.p <= 0.45 && x.price >= 2.2 && x.price <= MAX_PRICE_HARD && x.ev >= -0.12 && x.rel.score >= 35 && (!x.side || x.side === fav || x.ev >= 0.03))
    .sort((x, y) => y.ev - x.ev);
  const hard = pickDistinct(hardPool, 3);

  const warnings = [];
  for (const [k, pl] of [[ka, m.a], [kb, m.b]]) if (!k) warnings.push(`Sin histórico de ${pl.name} en el circuito: pesa casi todo la casa`);
  if (!surfaceName) warnings.push('Superficie del torneo sin confirmar: se usa pista dura');
  if (age > STALE_MS) warnings.push(`Cuotas de hace ${Math.round(age / 3600e3)} h: actualízalas antes de apostar`);
  const withWhy = x => x && ({ ...x, why: reason(x, ctx) });
  return {
    ready: true, surface: surfaceName, indoor: String(edition?.indoor).toUpperCase() === 'I', bestOf: m.bestOf, oddsAge: age,
    match: { pModel: f.pModel, pElo: f.pElo, pStats: f.pStats, pMarket: mlMarket, pFinal, expectedGames: exp, holdA: hold.a, holdB: hold.b, weight: w },
    top: withWhy(top), easy: easy.map(withWhy), hard: hard.map(withWhy), considered: picks.length, warnings,
    ...(opts.all ? { all: picks.map(withWhy) } : {})
  };
}

module.exports = { picksFor };
