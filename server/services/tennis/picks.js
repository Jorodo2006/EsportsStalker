'use strict';
// Recomendaciones de un partido: cruza el modelo (model.js) con las cuotas de las casas. Para cada mercado que el modelo sabe
// calcular estima la probabilidad y la mezcla con la de la casa sin margen. La interfaz (src/lib/tennis-picks.ts) elige la más fiable y
// separa las demás por riesgo, como en el baloncesto. Es una estimación: no hay cuotas históricas gratuitas con las que comprobar si a la larga se gana dinero.
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
const MAX_PRICE = 15;
const MIN_P = 0.15, MIN_EV = -0.12, MIN_REL = 35;

// ---------- Estado del modelo por circuito: se recalcula sólo cuando cambian los CSV ----------
// tour: 'atp' o 'wta'. Los Challenger no pasan por aquí: tienen su propio motor (servicio challenger)
const states = new Map();
async function stateOf(tour) {
  const data = await tml.dataset(tour);
  const cur = states.get(tour);
  if (cur?.data === data) return cur;
  const next = { data, ...M.replay(data.rows, null, M.paramsOf(tour)) };
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

// Devuelve { test, scope, family, side } o null si el modelo no sabe calcular ese mercado. Los que no salen del marcador final (el
// primer juego al saque, los primeros juegos, el primer break y los aces) traen la probabilidad hecha en prob. x: cálculos del partido
function rule(line, outcome, m, x) {
  const [type, , whoKey] = line.key.split('|');
  const scope = line.period === 0 ? 'match' : SET_FAMILY[line.period] ? 'set' : line.period === 50 ? 'match' : null;
  if (!scope) return null;
  const inSet = SET_FAMILY[line.period];
  const prefix = inSet ? `${inSet} · ` : '';
  const L = line.line;
  const half = L == null || !Number.isInteger(L); // las líneas enteras pueden ser nulas: se dejan fuera
  const g = norm(line.group), label = outcome.label;
  // norm quita las cifras, y para "1er juego" o "después de 4 juegos" hacen falta
  const gd = String(line.group).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const side = outcome.id === 'a' ? 'a' : outcome.id === 'b' ? 'b' : null;
  // Winamax da los marcadores ("6-3", "2 - 0") con sus jugadores en su orden, que puede ser el contrario al nuestro
  const score = t => { const r = String(t).match(/(\d+)\s*-\s*(\d+)\s*$/); return r ? (line.swapped ? [+r[2], +r[1]] : [+r[1], +r[2]]) : null; };
  const lead = sc => (sc[0] > sc[1] ? 'a' : sc[1] > sc[0] ? 'b' : null);
  // Betway lo pone en el primer set, pero es del partido
  if (/pierde el 1er set y gana/.test(gd)) { const who = whoIn(label, m); return who && { scope: 'match', side: who, family: 'Remontada', test: o => o.s1 !== who && wins(o, who) }; }
  if (/^1er juego de saque de/.test(gd)) {
    const server = whoIn(line.group.replace(/\s+-\s+[^-]*$/, ''), m);
    if (!server) return null;
    if (/ganador$/.test(g)) { const w = whoIn(label, m); return w && { scope: 'match', side: w, server, family: '1.er juego al saque', prob: w === server ? x.hold(server) : 1 - x.hold(server) }; }
    if (!/marcador exacto$/.test(g)) return null;
    const [winner, rest] = label.split(/\s+gana,?\s*/i), w = whoIn(winner, m), pts = numIn(rest), i = { 0: 0, 15: 1, 30: 2, 40: 3 }[pts];
    return w && i != null ? { scope: 'match', side: w, server, pts, family: '1.er juego al saque · Marcador', prob: x.game(server, i, w === server) } : null;
  }
  const after = gd.match(/^(resultado|marcador exacto) despues de (\d+) juegos$/);
  if (after) {
    const n = +after[2];
    if (n > 6) return null; // hasta 6 juegos se sigue en el primer set, y el cálculo no tiene en cuenta el cambio de set
    if (after[1] === 'resultado') {
      if (/^empate$/i.test(label.trim())) return { scope: 'match', side: null, n, family: `Tras ${n} juegos`, prob: x.after(n, o => o.a === o.b) };
      const w = whoIn(label, m);
      return w && { scope: 'match', side: w, n, family: `Tras ${n} juegos`, prob: x.after(n, o => (w === 'a' ? o.a > o.b : o.b > o.a)) };
    }
    const sc = score(label);
    return sc && sc[0] + sc[1] === n ? { scope: 'match', side: lead(sc), n, sc, family: `Tras ${n} juegos · Marcador`, prob: x.after(n, o => o.a === sc[0] && o.b === sc[1]) } : null;
  }
  if (/^primer jugador en convertir un break/.test(g)) { const w = whoIn(label, m); return w && { scope: 'match', side: w, family: 'Primer break', prob: w === 'a' ? x.breakA() : 1 - x.breakA() }; }
  // Los "aces (logros)" de Winamax no son del partido: dan a quien saca 4 o 5 de media un 58 % de llegar a 10. Parecen del torneo
  if (/^total de aces/.test(g) && !/logros/.test(g)) {
    const who = whoIn(line.group, m) || 'both', k = numIn(label) ?? L, milestone = /o m[aá]s/i.test(label);
    // Las líneas enteras de más o menos pueden ser nulas: se dejan fuera
    if (k == null || (!milestone && Number.isInteger(k)) || (!milestone && !isOver(label) && !isUnder(label))) return null;
    const t = x.aces(who), at = v => t[Math.min(t.length - 1, Math.max(0, v))];
    const over = milestone || isOver(label);
    const prob = milestone ? at(Math.ceil(k)) : over ? at(Math.floor(k) + 1) : 1 - at(Math.ceil(k));
    // "10 o más" va suelto, sin su contrario: no se le puede quitar el margen con el otro lado
    return { open: milestone, scope: 'match', side: over && who !== 'both' ? who : null, aceWho: who, aceK: k, over, family: who === 'both' ? 'Total de aces' : `Aces de ${m[who].name}`, prob };
  }
  if (/par impar$/.test(g)) {
    const t = label.trim().toLowerCase();
    if (t !== 'par' && t !== 'impar') return null;
    return { scope, side: null, even: t === 'par', family: `${prefix}Juegos par o impar`, test: o => ((o.ga + o.gb) % 2 === 0) === (t === 'par') };
  }
  if (/^cualquier set a cero$/.test(g)) { const y = yes(label); return { scope: 'match', side: null, family: 'Set a cero', test: o => (o.z === 1) === y }; }
  if (/^numero (total )?de sets$/.test(g) && /^\d$/.test(label.trim())) { const n = +label.trim(); return { scope: 'match', side: null, n, family: 'Número de sets', test: o => o.x + o.y === n }; }
  if (line.period === 50 && /^resultado exacto$/.test(g)) { const sc = score(label); return sc && { scope: 'match', side: lead(sc), sc, family: 'Resultado en sets', test: o => o.x === sc[0] && o.y === sc[1] }; }
  if (line.period === 21 && /marcador exacto$/.test(g)) { const sc = score(label); return sc && { scope: 'set', side: lead(sc), sc, family: '1.er set · Resultado', test: o => o.ga === sc[0] && o.gb === sc[1] }; }
  if (/^no ganar un set/.test(g)) { const who = whoIn(label, m); return who && { open: true, scope: 'match', side: who === 'a' ? 'b' : 'a', noSet: who, family: 'Gana un set', test: o => (who === 'a' ? o.x : o.y) === 0 }; }
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
  const other = w => (w === 'a' ? 'b' : 'a');
  if (r.family === 'Remontada') return `${sur(r.side)} pierde el 1.er set y gana el partido`;
  if (r.family === '1.er juego al saque') return r.side === r.server ? `${sur(r.server)} gana su 1.er juego al saque` : `${sur(r.side)} rompe el 1.er saque de ${sur(r.server)}`;
  if (r.family === '1.er juego al saque · Marcador') return `1.er saque de ${sur(r.server)}: gana ${sur(r.side)}, ${sur(other(r.side))} a ${r.pts}`;
  if (r.sc && r.n) return `Tras ${r.n} juegos: ${sur('a')} ${r.sc[0]}-${r.sc[1]} ${sur('b')}`;
  if (r.n && /^Tras/.test(r.family)) return r.side ? `${sur(r.side)} por delante tras ${r.n} juegos` : `Empate tras ${r.n} juegos`;
  if (r.family === 'Primer break') return `${sur(r.side)} rompe primero`;
  if (r.aceWho) {
    const words = /o m[aá]s/i.test(o.label) ? `${dec(r.aceK)} aces o más` : `${r.over ? 'más' : 'menos'} de ${dec(r.aceK)} aces`;
    return r.aceWho === 'both' ? `${words[0].toUpperCase()}${words.slice(1)} entre los dos` : `${sur(r.aceWho)}: ${words}`;
  }
  if (/Juegos par o impar$/.test(r.family)) return `${pre}Total de juegos ${r.even ? 'par' : 'impar'}`;
  if (r.family === 'Set a cero') return yes(o.label) ? 'Algún set acaba 6-0' : 'Ningún set acaba 6-0';
  if (r.family === 'Número de sets' && r.n) return `Se juegan ${r.n} sets`;
  if (r.family === 'Resultado en sets' && r.sc) return `Gana ${sur(r.side)} ${Math.max(...r.sc)}-${Math.min(...r.sc)} en sets`;
  if (r.family === '1.er set · Resultado' && r.sc) return `1.er set: ${sur(r.side)} gana ${Math.max(...r.sc)}-${Math.min(...r.sc)}`;
  if (r.noSet) return `${sur(r.noSet)} no gana ningún set`;
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
// Los aces y el set a cero también se comprobaron (docs/specs/09-tenis.md). El primer juego al saque, los primeros juegos y el primer
// break no se pueden comprobar con el marcador final: cuentan menos
const FAMILY_TRUST = { Ganador: 1, 'Hándicap de sets': 0.85, 'Gana un set': 0.85, 'Número de sets': 0.85, 'Tie-break': 0.6, 'Set a cero': 0.75, 'Resultado en sets': 0.7, Remontada: 0.7 };
const trustOf = f => FAMILY_TRUST[f] ?? (/aces/i.test(f) ? 0.8 : /saque|^Tras|break/.test(f) ? 0.55 : /par o impar/.test(f) ? 0.5
  : /Hándicap|Total|Juegos de/.test(f) ? 0.75 : /Ganador/.test(f) ? 0.75 : 0.5);

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
function reason(p, c, r) {
  const { m, exp, expA, expB, expSet, f, hold, x } = c;
  const nameOf = w => m[w].name.split(' ').slice(1).join(' ') || m[w].name;
  const es = v => v.toFixed(1).replace('.', ',');
  const pc = v => Math.round(v * 100);
  if (r.aceWho) {
    const mean = x.aceMean(r.aceWho);
    return r.aceWho === 'both' ? `Se esperan ${es(mean)} aces entre los dos` : `Se esperan ${es(mean)} aces de ${nameOf(r.aceWho)}: ${es(f.aces[r.aceWho] * 100)} % de sus puntos al saque`;
  }
  if (r.server) return `${nameOf(r.server)} gana su saque un ${pc(x.hold(r.server))} % de las veces`;
  if (/^Tras|^Primer break/.test(p.family)) return `Mantienen el saque un ${pc(x.hold('a'))} % y un ${pc(x.hold('b'))} %`;
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

async function picksFor(match) {
  const m = { ...match, league: match.tournament };
  if (match.state !== 'pre') return { ready: false, reason: match.state === 'in' ? 'started' : 'finished' };
  const odds = await client.call('odds', 'POST', '/api/odds/match', { match: { a: { name: m.a.name, code: '', alt: m.a.alt }, b: { name: m.b.name, code: '', alt: m.b.alt }, start: m.date, sport: 'tennis', league: m.tournament }, quiet: true });
  if (!odds?.markets?.length) return { ready: false, reason: 'noodds' };

  const tour = m.tour, P = M.paramsOf(tour);
  const st = await stateOf(tour);
  const key = n => { const k = tml.resolve(st.data, n); return k && st.players.has(k) ? k : null; };
  const edition = await tml.tournamentEdition(tour, m.tournament, m.city).catch(() => null);
  const surfaceName = edition?.surface || null;
  const surface = surfaceName || 'Hard';
  const day = Date.now() / 864e5;
  const empty = rank => ({ elo: rank ? 2400 - 190 * Math.log(rank) : 1300, n: 0, surf: {}, hist: [] });
  const ka = key(m.a.name), kb = key(m.b.name);
  const pa = ka ? st.players.get(ka) : empty(m.a.rank), pb = kb ? st.players.get(kb) : empty(m.b.rank);
  const avg = st.avgOf(M.conditionOf(surface, edition?.indoor));
  const f = M.predict(pa, pb, surface, day, avg, m.bestOf, P);

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
  // Lo que no sale del marcador final, promediando sobre la forma del día como el resto del modelo. Sólo se calcula si hay mercado
  const mix = fn => M.forms(sa, sb, P).reduce((t, [u, v, wf]) => t + wf * fn(u, v), 0);
  const memo = new Map(), once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  const x = {
    hold: who => once(`h${who}`, () => mix((u, v) => M.holdProb(who === 'a' ? u : v))),
    game: (server, i, held) => once(`g${server}${i}${held}`, () => mix((u, v) => M.gameScores(server === 'a' ? u : v)[held ? 'hold' : 'brk'][i])),
    after: (n, test) => mix((u, v) => M.afterGames(u, v, n).reduce((t, o) => t + (test(o) ? o.p : 0), 0)),
    breakA: () => once('b', () => mix((u, v) => M.firstBreakA(u, v))),
    aces: who => once(`a${who}`, () => M.acesTail(dist, sa, sb, f.aces.a, f.aces.b, who, P)),
    aceMean: who => x.aces(who).slice(1).reduce((t, v) => t + v, 0)
  };
  const ctx = { m, exp, expA, expB, expSet, f, hold, x };
  const age = Math.max(0, Date.now() - Math.max(...Object.values(odds.sources).map(s => s.ts || 0)));

  const picks = [];
  for (const line of odds.markets) {
    for (const o of line.outcomes) {
      const books = Object.entries(o.prices).filter(([, v]) => v > 1);
      if (!books.length) continue;
      const r = rule(line, o, m, x);
      if (!r) continue;
      const pool = r.scope === 'set' ? setDist : dist;
      // En el ganador, el modelo sin mezclar: el partido ya está ajustado a la probabilidad final y no diría nada
      const pModel = line.key === 'moneyline|0||' ? (r.side === 'a' ? f.pModel : 1 - f.pModel) : r.prob ?? pool.reduce((t, d) => t + (r.test(d) ? d.p : 0), 0);
      if (pModel <= 0.001) continue;
      const pMarket = marketProb(line, o, r.open);
      const p = blend(pModel, pMarket, w);
      const [book, price] = books.sort((x, y) => y[1] - x[1])[0];
      const who = line.key.split('|')[2];
      const pick = {
        id: `${line.key}#${o.id}`, title: titleOf(line, o, r, m), market: line.group, selection: o.label, family: r.family, side: r.side, who: who === 'a' || who === 'b' ? who : r.side,
        book, price, prices: o.prices, p, pModel, pMarket, fair: 1 / p, ev: p * price - 1,
        rel: reliabilityOf({ family: r.family, pModel, pMarket, gap, minPoints, books: books.length, age, sameSurface: surfaceName ? undefined : false }), _r: r
      };
      picks.push(pick);
    }
  }

  // Lo que no se recomienda nunca: tanta diferencia con la casa suele ser un error, una cuota que regala el margen entero o algo
  // casi imposible. El resto va a la interfaz, que lo filtra y lo separa por riesgo (src/lib/tennis-picks.ts)
  const sane = x => Math.abs(x.pModel - x.pMarket) <= MAX_DISAGREE && x.price >= MIN_PRICE && x.price <= MAX_PRICE && x.p >= MIN_P && x.ev >= MIN_EV && x.rel.score >= MIN_REL;
  const shown = picks.filter(sane).map(({ _r, ...pick }) => ({ ...pick, why: reason(pick, ctx, _r) }));
  const classic = classicOf(shown, pFinal);

  const warnings = [];
  for (const [k, pl] of [[ka, m.a], [kb, m.b]]) if (!k) warnings.push(`Sin histórico de ${pl.name} en el circuito: pesa casi todo la casa`);
  if (!surfaceName) warnings.push('Superficie del torneo sin confirmar: se usa pista dura');
  if (age > STALE_MS) warnings.push(`Cuotas de hace ${Math.round(age / 3600e3)} h: actualízalas antes de apostar`);
  return {
    ready: true, surface: surfaceName, indoor: String(edition?.indoor).toUpperCase() === 'I', bestOf: m.bestOf, oddsAge: age,
    summary: { pModel: f.pModel, pElo: f.pElo, pStats: f.pStats, pMarket: mlMarket, pFinal, expectedGames: exp, holdA: hold.a, holdB: hold.b, weight: w },
    picks: shown, ...classic, considered: picks.length, warnings
  };
}

// La selección de siempre: la más fiable, tres fáciles y tres complicadas, de familias distintas. No es lo que enseña el tablero
// (que lo separa con filtros en src/lib/tennis-picks.ts), sino lo que se registra para medir el acierto y lo que sale en Hoy
function classicOf(list, pFinal) {
  const fav = pFinal >= 0.5 ? 'a' : 'b';
  const distinct = (pool, n, used = new Set()) => {
    const out = [];
    for (const x of pool) { if (out.length >= n) break; if (used.has(x.family)) continue; used.add(x.family); out.push(x); }
    return out;
  };
  // Un set suelto cuenta menos que el partido: tiene más azar y la casa cobra más margen
  const score = x => x.p + x.ev + 0.05 * (x.rel.score / 100) - (/set ·/.test(x.family) ? 0.03 : 0);
  const easyPool = list.filter(x => x.p >= 0.6 && x.ev >= -0.1 && x.rel.score >= 40).sort((x, y) => score(y) - score(x));
  const top = easyPool.find(x => x.rel.score >= 50 && x.ev >= -0.07) ?? null;
  const easy = distinct(easyPool.filter(x => x !== top).sort((x, y) => y.ev - x.ev), 3, new Set(top ? [top.family] : []));
  const hard = distinct(list.filter(x => x.p <= 0.45 && x.price >= 2.2 && (!x.side || x.side === fav || x.ev >= 0.03)).sort((x, y) => y.ev - x.ev), 3);
  return { top, easy, hard };
}

module.exports = { picksFor };
