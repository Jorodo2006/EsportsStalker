// Escáner de valor: cruza las cuotas de la casa con las probabilidades del modelo.

import { normalizeSurface } from './data.js';
import { PlayerIndex } from './names.js';
import { edge, fairOdds, fairProbs, kelly, overround } from './odds.js';
import { parseCsv } from './csv.js';

// ---------- Envío del marcador de Winamax (chrome/bookmarklet/marcador.js y el lector de Docker) ----------
// No trae una lista de partidos: es el estado del socket de Winamax para UN partido, con todos sus mercados:
//   { type: 'LOL_ET', book: 'winamax', matchId, home, away, title, ts,
//     state: { matches: { [matchId]: partido }, bets, outcomes, odds, players } }
// (el tipo se llama LOL_ET por herencia, también en tenis). Del partido sirven competitor1Name/competitor2Name,
// sportId (5 = tenis), status y matchStart (segundos). El ganador del partido es la apuesta "Ganador" de dos salidas
// (template '2way'); las de cada set se titulan "1er set - Ganador" y no valen. Cada salida lleva code '1' o '2'
// (competidor 1 o 2) y su cuota está en state.odds[idSalida].
const WINAMAX_TENNIS = 5;

const isWinamax = (x) => !!x && typeof x === 'object' && x.book === 'winamax' && !!x.state && typeof x.state === 'object';

function fromWinamax(payload) {
  const st = payload.state;
  const m = st.matches?.[payload.matchId];
  if (!m) throw new Error(`El envío de Winamax no trae el partido ${payload.matchId}.`);
  if (m.sportId !== undefined && m.sportId !== WINAMAX_TENNIS) {
    throw new Error(`"${m.title ?? payload.title}" no es un partido de tenis (deporte ${m.sportId} en Winamax).`);
  }
  // Las cuotas en directo no se comparan con un modelo de antes del partido
  if (m.status && m.status !== 'PREMATCH') return [];
  const isWinner = (b) => !!b && b.available !== false && b.template === '2way' && b.outcomes?.length === 2 &&
    /^ganador$/i.test(String(b.betTitle ?? b.betTypeName ?? '').trim());
  // Primero la apuesta principal del partido, que suele ser esa
  const bet = [m.mainBetId, ...(m.bets ?? [])].map((id) => st.bets?.[id]).find(isWinner);
  if (!bet) return [];
  const price = (code) => {
    const id = bet.outcomes.find((o) => String(st.outcomes?.[o]?.code) === code);
    return id === undefined || st.outcomes[id].available === false ? null : st.odds?.[id];
  };
  return [{
    p1: m.competitor1Name ?? payload.home,
    p2: m.competitor2Name ?? payload.away,
    o1: price('1'),
    o2: price('2'),
    start: m.matchStart ? new Date(m.matchStart * 1000).toISOString() : '',
    bookmaker: 'Winamax',
  }];
}

/**
 * Convierte la entrada de cuotas a una lista común:
 *   [{ p1, p2, o1, o2, surface, tournament, start, bookmaker }]
 *
 * Acepta:
 *  - El envío del marcador de Winamax (ver arriba), o un array de envíos (uno por partido).
 *    No dice la superficie ni el torneo: van en defaults.
 *  - JSON con entries: { type: 'TENNIS_EDGE_ODDS', market: 'winner', entries: [...] }
 *    cada entry con p1/p2/o1/o2 (o player1/player2/odds1/odds2).
 *  - Un array con esos mismos objetos.
 *  - Texto CSV con columnas p1,p2,o1,o2,surface,tournament,start,bookmaker
 */
export function normalizeOddsInput(input, defaults = {}) {
  let rows;
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) return normalizeOddsInput(JSON.parse(t), defaults);
    rows = parseCsv(t);
  } else if (Array.isArray(input)) rows = input.flatMap((x) => (isWinamax(x) ? fromWinamax(x) : [x]));
  else if (isWinamax(input)) rows = fromWinamax(input);
  else if (input && Array.isArray(input.entries)) {
    if (input.market && !/winner|ganador|match|1x2|moneyline/i.test(input.market)) {
      throw new Error(`Mercado "${input.market}" no soportado todavía: de momento solo ganador del partido.`);
    }
    rows = input.entries.map((e) => ({ surface: input.surface, tournament: input.tournament, bookmaker: input.bookmaker, ...e }));
  } else throw new Error('Formato de cuotas no reconocido.');

  return rows
    .map((r) => ({
      p1: r.p1 ?? r.player1 ?? r.home,
      p2: r.p2 ?? r.player2 ?? r.away,
      o1: Number(String(r.o1 ?? r.odds1 ?? '').replace(',', '.')),
      o2: Number(String(r.o2 ?? r.odds2 ?? '').replace(',', '.')),
      surface: normalizeSurface(r.surface ?? defaults.surface),
      tournament: r.tournament ?? defaults.tournament ?? '',
      start: r.start ?? '',
      bookmaker: r.bookmaker ?? defaults.bookmaker ?? '',
    }))
    .filter((r) => r.p1 && r.p2 && r.o1 > 1 && r.o2 > 1);
}

/**
 * Busca jugadores del modelo por el nombre de una casa o de LiveScore. Devuelve find(nombre) → { id, name } o null.
 *   activeDays  sólo los que han jugado en esos días antes del último partido del modelo (730 por defecto)
 *   aliases     { "nombre en la casa": "nombre en el histórico" }
 */
export function matcher(model, { activeDays = 730, aliases = {} } = {}) {
  const entry = (p) => ({ id: p.id, name: p.name });
  const all = [...model.players.values()];
  // Con los retirados en el índice, más nombres "Apellido I." salen ambiguos y el partido se descarta: con el histórico
  // de 2015 a 2026, 157 de los 1.576 jugadores activos en Challengers se quedaban sin emparejar; sólo con los de los
  // dos últimos años, 71
  const cutoff = model.lastDate && activeDays > 0
    ? new Date(Date.parse(model.lastDate) - activeDays * 86400000).toISOString().slice(0, 10) : null;
  const index = new PlayerIndex((cutoff ? all.filter((p) => !p.last || p.last >= cutoff) : all).map(entry));
  // Los alias (para nombres ambiguos) se buscan entre todos, por si vuelve alguien que llevaba más de dos años sin jugar
  const allIndex = Object.keys(aliases).length ? new PlayerIndex(all.map(entry)) : null;
  return (raw) => (aliases[raw] ? allIndex.find(aliases[raw]) : index.find(raw));
}

/**
 * Escanea partidos y devuelve oportunidades ordenadas por valor.
 * opts:
 *   minEdge      valor mínimo (0.03 = +3 %)
 *   maxOdds      no recomendar cuotas por encima (las muy altas son ruido)
 *   minOdds      ni por debajo
 *   allowLowData incluir jugadores con pocos partidos (por defecto no)
 *   aliases      { "nombre en la casa": "nombre en el histórico" } para resolver ambigüedades
 *   activeDays   sólo empareja nombres con jugadores que han jugado en esos días antes del último partido del modelo
 *   kellyFraction, kellyCap
 */
export function scan(model, oddsRows, opts = {}) {
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const o = { minEdge: 0.03, minOdds: 1.3, maxOdds: 4.0, allowLowData: false, kellyFraction: 0.25, kellyCap: 0.03, aliases: {}, activeDays: 730, ...given };
  const find = matcher(model, o);
  const results = [];
  const skipped = [];

  for (const r of oddsRows) {
    const a = find(r.p1);
    const b = find(r.p2);
    if (!a || !b) {
      skipped.push({ ...r, reason: `Jugador no encontrado o ambiguo: ${!a ? r.p1 : r.p2}` });
      continue;
    }
    const pred = model.predict(a.id, b.id, r.surface);
    if (pred.lowData && !o.allowLowData) {
      skipped.push({ ...r, reason: `Pocos partidos en el histórico (${pred.nA} / ${pred.nB})` });
      continue;
    }
    const [fair1, fair2] = fairProbs(r.o1, r.o2);
    const sides = [
      { pick: a.name, raw: r.p1, odds: r.o1, prob: pred.pA, bookProb: fair1, matched: a.confidence },
      { pick: b.name, raw: r.p2, odds: r.o2, prob: 1 - pred.pA, bookProb: fair2, matched: b.confidence },
    ];
    for (const s of sides) {
      const e = edge(s.prob, s.odds);
      const row = {
        match: `${a.name} vs ${b.name}`,
        tournament: r.tournament,
        surface: r.surface,
        start: r.start,
        bookmaker: r.bookmaker,
        pick: s.pick,
        odds: s.odds,
        modelProb: s.prob,
        bookProb: s.bookProb,
        fairOdds: fairOdds(s.prob),
        edge: e,
        stake: kelly(s.prob, s.odds, { fraction: o.kellyFraction, cap: o.kellyCap }),
        margin: overround(r.o1, r.o2),
        matched: s.matched,
        lowData: pred.lowData,
        matchesA: pred.nA,
        matchesB: pred.nB,
      };
      if (e >= o.minEdge && s.odds >= o.minOdds && s.odds <= o.maxOdds) results.push(row);
    }
  }
  results.sort((x, y) => y.edge - x.edge);
  return { opportunities: results, skipped };
}
