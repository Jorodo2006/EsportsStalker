// Generador de datos sintéticos para probar el motor sin datos reales.
// Crea jugadores con un nivel "verdadero" (y especialidad por superficie),
// simula torneos y decide cada partido con la probabilidad real.
// Si el modelo funciona, sus probabilidades deben acercarse a las reales.

import { expected } from './elo.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const FIRST = ['Alex', 'Pablo', 'Marco', 'Jan', 'Luca', 'Hugo', 'Nicolas', 'Tomas', 'Daniel', 'Felix', 'Max', 'Oscar', 'Leo', 'Ivan', 'Mateo', 'Jordi'];
const LAST = ['Garcia', 'Rossi', 'Novak', 'Muller', 'Dubois', 'Silva', 'Kowalski', 'Ivanov', 'Martinez', 'Berg', 'Costa', 'Moreau', 'Horvat', 'Lindqvist', 'Santos', 'Ferrer', 'Popescu', 'Nagy', 'Jensen', 'Vidal'];

export function generate({ players = 240, years = 3, startYear = 2023, seed = 7 } = {}) {
  const r = rng(seed);
  const surfaces = ['Hard', 'Clay', 'Grass'];
  const ps = Array.from({ length: players }, (_, i) => ({
    id: `syn:${i}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= FIRST.length * LAST.length ? ' ' + i : ''}`,
    skill: 1500 + gauss(r) * 160,
    bias: { Hard: gauss(r) * 50, Clay: gauss(r) * 50, Grass: gauss(r) * 50 },
    drift: gauss(r) * 40, // mejora o empeora por año
  }));

  const matches = [];
  const truth = [];
  for (let y = 0; y < years; y++) {
    for (let week = 0; week < 48; week++) {
      const date = new Date(Date.UTC(startYear + y, 0, 3 + week * 7)).toISOString().slice(0, 10);
      // 2 torneos por semana, 32 jugadores cada uno
      for (let t = 0; t < 2; t++) {
        const surface = week % 12 < 5 ? 'Clay' : week % 12 === 6 ? 'Grass' : 'Hard';
        const pool = [...ps].sort(() => r() - 0.5).slice(0, 32);
        const tourney = `Challenger ${String.fromCharCode(65 + t)}${week + 1} ${startYear + y}`;
        let round = pool;
        const roundNames = ['R32', 'R16', 'QF', 'SF', 'F'];
        let ri = 0, order = 0;
        while (round.length > 1) {
          const next = [];
          for (let i = 0; i < round.length; i += 2) {
            const a = round[i], b = round[i + 1];
            const sa = a.skill + a.bias[surface] + a.drift * (y + week / 48);
            const sb = b.skill + b.bias[surface] + b.drift * (y + week / 48);
            const pA = expected(sa, sb);
            const aWins = r() < pA;
            const w = aWins ? a : b, l = aWins ? b : a;
            matches.push({
              date, tourney, level: 'C', surface, round: roundNames[ri], order: order++,
              winnerId: w.id, winnerName: w.name, loserId: l.id, loserName: l.name,
              score: '6-4 6-4', completed: true,
            });
            truth.push({ date, a: a.id, b: b.id, surface, pA });
            next.push(w);
          }
          round = next; ri++;
        }
      }
    }
  }
  return { players: ps, matches, truth, surfaces };
}
