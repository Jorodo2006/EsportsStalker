'use strict';
// Recomendaciones de un combate: cruza el modelo (model.js) con las cuotas de las casas. Para cada mercado que el modelo sabe
// calcular estima la probabilidad, la mezcla con la de la casa sin margen y separa la más fiable, las fáciles y las difíciles.
// Es una estimación: no hay cuotas históricas gratuitas con las que comprobar si a la larga se gana dinero.
const client = require('../../shared/client');
const M = require('./model');

const { clamp } = M;
const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const W_MODEL = { alta: 0.25, media: 0.15, baja: 0.08 }; // las casas aciertan más que cualquier modelo público: el modelo matiza
const ASSUMED_MARGIN = 0.07; // margen supuesto cuando la casa sólo da un lado
const STALE_MS = 6 * 3600e3;
const MAX_DISAGREE = 0.2; // tanta diferencia con la casa suele ser una baja, un cambio de rival o un mercado mal leído
const MIN_PRICE = 1.15, MAX_PRICE_HARD = 15;
const METHOD = { ko: 'KO/TKO', sub: 'sumisión', dec: 'decisión' };
const dec = v => String(v).replace('.', ',');
const sur = n => String(n).split(' ').slice(1).join(' ') || n;

// Qué calcula el modelo para una selección. Devuelve { p, family, side } o null si no sabe ese mercado
function rule(line, o, f, pred) {
  const [type, , kind] = line.key.split('|');
  const side = o.id === 'a' || o.id === 'b' ? o.id : null;
  if (type === 'moneyline' && side) return { p: side === 'a' ? pred.pA : pred.pB, family: 'Ganador', side };
  // open: A y B por KO no suman 100 % (faltan sumisión y decisión): no se le quita el margen sumándolos
  if (type === 'method' && side && METHOD[kind]) return { p: pred.joint[side][kind], family: 'Método', side, open: true };
  if (type === 'distance' && (o.id === 'yes' || o.id === 'no')) return { p: o.id === 'yes' ? pred.goesDistance : 1 - pred.goesDistance, family: 'Duración', side: null };
  if (type === 'total_rounds' && (o.id === 'over' || o.id === 'under') && Number.isFinite(line.line) && !Number.isInteger(line.line)) {
    const over = M.pOver(pred, f.rounds || 3, line.line * 5);
    return { p: o.id === 'over' ? over : 1 - over, family: 'Asaltos', side: null };
  }
  return null;
}

function titleOf(line, o, r, f) {
  const [type, , kind] = line.key.split('|');
  if (type === 'moneyline') return `Gana ${f[o.id].name}`;
  if (type === 'method') return `${sur(f[o.id].name)} gana por ${METHOD[kind]}`;
  if (type === 'distance') return o.id === 'yes' ? 'Llega a la decisión' : 'No llega a la decisión';
  return `${o.id === 'over' ? 'Más' : 'Menos'} de ${dec(line.line)} asaltos`;
}

// Probabilidad de la casa sin margen: la media de cada casa que da el mercado completo
function marketProb(line, o, open) {
  const books = Object.keys(o.prices);
  const fair = books.map(bk => {
    const prices = line.outcomes.map(x => x.prices[bk]);
    const inv = 1 / o.prices[bk];
    return !open && prices.every(Boolean) ? inv / prices.reduce((t, p) => t + 1 / p, 0) : inv / (1 + ASSUMED_MARGIN);
  });
  return fair.reduce((t, x) => t + x, 0) / fair.length;
}

const blend = (model, market, w) => sigmoid(w * logit(clamp(model, 0.002, 0.998)) + (1 - w) * logit(clamp(market, 0.002, 0.998)));
const TRUST = { Ganador: 1, Método: 0.7, Duración: 0.8, Asaltos: 0.75 };

function reliabilityOf({ family, pModel, pMarket, gap, modelRel, books, age }) {
  const modelScore = { alta: 1, media: 0.65, baja: 0.3 }[modelRel] ?? 0.3;
  const factors = [
    { label: 'Datos de los luchadores', max: 30, score: 30 * modelScore, note: `fiabilidad del modelo: ${modelRel}` },
    { label: 'Modelo y casa de acuerdo', max: 35, score: 35 * clamp(1 - (Math.max(gap, Math.abs(pModel - pMarket)) - 0.03) / 0.15, 0, 1), note: `modelo ${Math.round(pModel * 100)} %, casa ${Math.round(pMarket * 100)} %` },
    { label: 'Mercado', max: 20, score: 20 * (TRUST[family] ?? 0.5), note: 'qué tal se calcula este mercado' },
    { label: 'Cuotas', max: 15, score: 15 * (books > 1 ? 1 : 0.6) * (age > STALE_MS ? 0.4 : 1), note: `${books} ${books > 1 ? 'casas' : 'casa'}` }
  ];
  const score = Math.round(clamp(factors.reduce((t, x) => t + x.score, 0), 0, 100));
  return { score, label: score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja', factors, warnings: [] };
}

function reason(p, pred, f) {
  const pc = v => `${Math.round(v * 100)} %`;
  if (p.family === 'Ganador' || p.family === 'Método') return `El modelo da ${pc(pred.pA)} a ${sur(f.a.name)} y ${pc(pred.pB)} a ${sur(f.b.name)}`;
  if (p.family === 'Duración') return `El modelo ve un ${pc(pred.goesDistance)} de llegar a la decisión`;
  return `El modelo ve un ${pc(pred.goesDistance)} de decisión; el resto acaba antes`;
}

function pickDistinct(list, n, used = new Set()) {
  const out = [];
  for (const x of list) {
    if (out.length >= n) break;
    if (used.has(x.family)) continue;
    used.add(x.family); out.push(x);
  }
  return out;
}

// Pura: sin red. f: el combate; pred: lo que dice model.predict; odds: { markets, sources } del servicio odds
function buildPicks(f, pred, odds) {
  const empty = warnings => ({ all: [], top: null, easy: [], hard: [], considered: 0, warnings });
  if (f.cancelled) return empty(['Combate anulado']);
  if (f.state !== 'pre') return empty(['Combate ya empezado o terminado']);
  const age = Math.max(0, Date.now() - Math.max(0, ...Object.values(odds?.sources || {}).map(s => s.ts || 0)));
  const ml = (odds?.markets || []).find(l => l.key === 'moneyline|0||');
  const mlA = ml?.outcomes.find(x => x.id === 'a');
  const mlMarket = mlA && Object.keys(mlA.prices).length ? marketProb(ml, mlA) : null;
  // Cuanto más se aleja el modelo de la casa, más probable es que le falte algo (una baja): pesa menos
  const gap = mlMarket == null ? 0.1 : Math.abs(pred.pA - mlMarket);
  const w = W_MODEL[pred.reliability] * clamp(1 - (gap - 0.05) / 0.2, 0.2, 1);

  const all = [];
  for (const line of odds?.markets || []) {
    for (const o of line.outcomes) {
      const books = Object.entries(o.prices).filter(([, v]) => v > 1);
      if (!books.length) continue;
      const r = rule(line, o, f, pred);
      if (!r || r.p <= 0.001) continue;
      const pMarket = marketProb(line, o, r.open);
      // En el ganador, el modelo sin mezclar con la casa vale lo que dice; la probabilidad final es la mezcla
      const p = blend(r.p, pMarket, w);
      const [book, price] = books.sort((x, y) => y[1] - x[1])[0];
      const pick = {
        id: `${line.key}#${o.id}`, title: titleOf(line, o, r, f), market: line.group, selection: o.label, family: r.family, side: r.side,
        who: r.side, book, price, prices: o.prices, p, pModel: r.p, pMarket, fair: 1 / p, ev: p * price - 1,
        rel: reliabilityOf({ family: r.family, pModel: r.p, pMarket, gap, modelRel: pred.reliability, books: books.length, age })
      };
      pick.why = reason(pick, pred, f);
      all.push(pick);
    }
  }

  const fav = pred.pA >= 0.5 ? 'a' : 'b';
  const sane = x => Math.abs(x.pModel - x.pMarket) <= MAX_DISAGREE;
  const decent = x => sane(x) && x.ev >= -0.1 && x.rel.score >= 40;
  const score = x => x.p + x.ev + 0.05 * (x.rel.score / 100);
  const easyPool = all.filter(x => x.p >= 0.6 && x.price >= MIN_PRICE && decent(x)).sort((x, y) => score(y) - score(x));
  const top = easyPool.find(x => x.rel.score >= 50 && x.ev >= -0.07) ?? null;
  const used = new Set(top ? [top.family] : []);
  const easy = pickDistinct(easyPool.filter(x => x !== top).sort((x, y) => y.ev - x.ev), 3, used);
  const hardPool = all.filter(x => sane(x) && x.p >= 0.15 && x.p <= 0.45 && x.price >= 2.2 && x.price <= MAX_PRICE_HARD && x.ev >= -0.12 && x.rel.score >= 35 && (!x.side || x.side === fav || x.ev >= 0.03))
    .sort((x, y) => y.ev - x.ev);
  const hard = pickDistinct(hardPool, 3);

  const warnings = [];
  if (pred.reliability === 'baja') warnings.push('Poco historial de alguno de los luchadores: pesa casi todo la casa');
  if (f.org === 'wow') warnings.push('WOW: modelo con menos datos que el de UFC y PFL');
  if (age > STALE_MS && Object.keys(odds?.sources || {}).length) warnings.push(`Cuotas de hace ${Math.round(age / 3600e3)} h: actualízalas antes de apostar`);
  return { all, top, easy, hard, considered: all.length, warnings, match: { pModel: pred.pA, pMarket: mlMarket, pFinal: mlMarket == null ? pred.pA : blend(pred.pA, mlMarket, w), weight: w } };
}

// Con red: pide las cuotas leídas y calcula con el Elo de los luchadores (ctx: { a, b } de history.fighterCtx)
async function picksFor(f, ctx, opts = {}) {
  if (f.state !== 'pre') return { ready: false, reason: f.state === 'in' ? 'started' : 'finished' };
  const pred = M.predict(ctx.a, ctx.b, { org: f.org, rounds: f.rounds, weightClass: f.weightClass });
  const mk = x => ({ name: x.name, code: '', alt: x.alt });
  const odds = await client.call('odds', 'POST', '/api/odds/match', { match: { a: mk(f.a), b: mk(f.b), start: f.date, sport: 'mma', league: f.org }, quiet: true });
  const r = buildPicks(f, pred, odds);
  if (!odds?.markets?.length) return { ready: false, reason: 'noodds', pred: { pA: pred.pA, pB: pred.pB, method: pred.method, goesDistance: pred.goesDistance, reliability: pred.reliability } };
  const { all, ...rest } = r;
  return { ready: true, pred: { pA: pred.pA, pB: pred.pB, method: pred.method, goesDistance: pred.goesDistance, reliability: pred.reliability }, ...rest, ...(opts.all ? { all } : {}) };
}

module.exports = { buildPicks, picksFor };
