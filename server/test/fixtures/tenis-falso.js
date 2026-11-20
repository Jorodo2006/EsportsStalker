// Un circuito de tenis falso con la forma de los CSV de TennisMyLife, y las cuotas de un partido con la forma de odds: para probar el
// modelo, las recomendaciones (picks.js) y las líneas del perfil del jugador sin red ni base de datos. Siempre los mismos números
// (generador con semilla), para poder comparar con lo guardado
const { norm } = require('../../services/tennis/tml');

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PLAYERS = [['Carlos Alpha', 3, 0.70, 0.10], ['Jannik Beta', 8, 0.67, 0.07], ['Pedro Gamma', 25, 0.63, 0.05], ['Luca Delta', 40, 0.62, 0.06], ['Tomas Epsilon', 60, 0.60, 0.04], ['Hugo Zeta', 90, 0.58, 0.05]];

// Unos 160 partidos de 2025 y 2026 entre los seis, en pista dura
function rows() {
  const r = rng(7), out = [];
  for (let i = 0; i < 160; i++) {
    const a = PLAYERS[Math.floor(r() * PLAYERS.length)];
    let b = PLAYERS[Math.floor(r() * PLAYERS.length)];
    if (b === a) b = PLAYERS[(PLAYERS.indexOf(a) + 1) % PLAYERS.length];
    const aWins = r() < 0.5 + (a[2] - b[2]) * 3;
    const [w, l] = aWins ? [a, b] : [b, a];
    const month = 1 + Math.floor(i / 8) % 22, year = month > 11 ? 2026 : 2025, mm = String(((month - 1) % 11) + 1).padStart(2, '0');
    const sets = r() < 0.35 ? ['6-4', '3-6', '7-6(4)'] : r() < 0.5 ? ['6-3', '6-4'] : ['7-5', '6-7(5)', '6-2'];
    const svW = 70 + Math.floor(r() * 30), svL = 70 + Math.floor(r() * 30);
    out.push({
      tourney_id: `${year}-${i}`, tourney_name: `Torneo ${i % 9}`, surface: 'Hard', indoor: 'O', tourney_level: 'A', tourney_date: `${year}${mm}0${1 + (i % 4)}`,
      match_num: String(i), winner_name: w[0], winner_rank: String(w[1]), loser_name: l[0], loser_rank: String(l[1]), score: sets.join(' '), round: 'R32', minutes: '100',
      w_ace: String(Math.round(svW * w[3] * (0.6 + r() * 0.8))), w_df: String(Math.floor(r() * 5)), w_svpt: String(svW), w_1stIn: String(Math.round(svW * 0.62)),
      w_1stWon: String(Math.round(svW * 0.62 * w[2] * 1.1)), w_2ndWon: String(Math.round(svW * 0.38 * 0.5)), w_SvGms: '11', w_bpSaved: '3', w_bpFaced: '5',
      l_ace: String(Math.round(svL * l[3] * (0.6 + r() * 0.8))), l_df: String(Math.floor(r() * 5)), l_svpt: String(svL), l_1stIn: String(Math.round(svL * 0.6)),
      l_1stWon: String(Math.round(svL * 0.6 * l[2])), l_2ndWon: String(Math.round(svL * 0.4 * 0.45)), l_SvGms: '11', l_bpSaved: '4', l_bpFaced: '8'
    });
  }
  return out;
}

// Lo que devuelve tml.dataset: las filas y el índice por jugador
function dataset() {
  const list = rows(), byName = new Map();
  for (const m of list) for (const n of [m.winner_name, m.loser_name]) { const k = norm(n); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(m); }
  return { parts: [list], rows: list, byName };
}

const MATCH = {
  id: '9001', tour: 'atp', tournament: 'Torneo de prueba', city: 'Ciudad', date: '2026-11-21T14:00:00Z', state: 'pre', status: '', round: 'Cuartos de final', bestOf: 3,
  a: { id: '101', name: 'Carlos Alpha', short: 'C. Alpha', alt: ['Alpha', 'C. Alpha'], rank: 3, seed: 1, flag: '', country: '', sets: [], setWins: [], tiebreaks: [], winner: false },
  b: { id: '102', name: 'Jannik Beta', short: 'J. Beta', alt: ['Beta', 'J. Beta'], rank: 8, seed: 4, flag: '', country: '', sets: [], setWins: [], tiebreaks: [], winner: false }
};

const ou = (key, group, line, over, under, extra = {}) => ({
  key, period: 0, line, group, swapped: false, ...extra,
  outcomes: [{ id: 'over', label: `Más de ${line}`, prices: over }, { id: 'under', label: `Menos de ${line}`, prices: under }]
});

// Las cuotas del partido (ts: hora de la lectura, en ms)
function odds(ts) {
  return {
    sources: { winamax: { ts }, betway: { ts } },
    markets: [
      { key: 'moneyline|0||', period: 0, line: null, group: 'Ganador', swapped: false, outcomes: [{ id: 'a', label: 'Carlos Alpha', prices: { Winamax: 1.55, Betway: 1.57 } }, { id: 'b', label: 'Jannik Beta', prices: { Winamax: 2.45, Betway: 2.4 } }] },
      ou('team_total|0|a|12.5', 'Juegos de Carlos Alpha', 12.5, { Winamax: 1.8, Betway: 1.83 }, { Winamax: 1.95, Betway: 1.9 }),
      ou('team_total|0|b|10.5', 'Juegos de Jannik Beta', 10.5, { Winamax: 1.85 }, { Winamax: 1.9 }),
      ou('total|0||21.5', 'Total de juegos', 21.5, { Winamax: 1.87, Betway: 1.85 }, { Winamax: 1.87, Betway: 1.9 }),
      { key: 'spread|0||-2.5', period: 0, line: -2.5, group: 'Hándicap de juegos', swapped: false, outcomes: [{ id: 'a', label: 'Carlos Alpha -2.5', prices: { Winamax: 1.9 } }, { id: 'b', label: 'Jannik Beta +2.5', prices: { Winamax: 1.85 } }] },
      ou('wmx|aces-a', 'Total de aces C. Alpha (6.5)', 6.5, { Winamax: 1.75 }, { Winamax: 1.95 }),
      { key: 'betway|un-set', period: 0, line: null, group: 'Ganará un set', swapped: false, outcomes: [{ id: 'x1', label: 'Carlos Alpha', prices: { Betway: 1.12 } }, { id: 'x2', label: 'Jannik Beta', prices: { Betway: 1.6 } }] }
    ]
  };
}

module.exports = { dataset, MATCH, odds, PLAYERS };
