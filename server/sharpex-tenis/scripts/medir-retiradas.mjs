// Riesgo de retirada en los Challenger (fase 4 de docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md): con qué frecuencia
// se retira un jugador y cuánto sube tras una retirada reciente, con ranking protegido o al volver de un parón largo. Tasas con
// 2021-2023 y comprobación con 2024-2026; de aquí salen RETIRE en src/form.js. Se lanza a mano y no guarda nada.
//   node --max-old-space-size=2500 scripts/medir-retiradas.mjs <datos>
import { loadMatches, HISTORY_LEVELS } from '../src/index.js';
const [, , DATA] = process.argv;
const all = loadMatches(DATA, { levels: HISTORY_LEVELS });
const DAY = 864e5, day = (d) => Date.parse(d) / DAY;
const lastRet = new Map(), lastPlay = new Map();
const rows = []; // una por jugador y partido Challenger
for (const m of all) {
  const d = day(m.date);
  if (m.level === 'C') {
    for (const [id, entry, isLoser] of [[m.winnerId, m.winnerEntry, false], [m.loserId, m.loserEntry, true]]) {
      const r = lastRet.get(id), p = lastPlay.get(id);
      rows.push({
        date: m.date, src: m.source, retired: isLoser && m.retired ? 1 : 0, matchRet: m.retired ? 1 : 0,
        sinceRet: r == null ? Infinity : d - r, layoff: p == null ? null : d - p, pr: entry === 'PR', entryKnown: m.source === 'sk',
      });
    }
  }
  if (m.retired) lastRet.set(m.loserId, d);
  lastPlay.set(m.winnerId, d); lastPlay.set(m.loserId, d);
}
const fit = rows.filter((r) => r.date >= '2021-01-01' && r.date < '2024-01-01'), test = rows.filter((r) => r.date >= '2024-01-01');
const rate = (xs) => ({ n: xs.length, rate: xs.length ? xs.reduce((s, x) => s + x.retired, 0) / xs.length : null });
const fmt = ({ n, rate: r }) => `${(r * 100).toFixed(2)} % (n=${n}, ±${(196 * Math.sqrt(r * (1 - r) / n)).toFixed(2)})`;
const groups = {
  'todos': () => true,
  'se retiró hace ≤ 14 días': (r) => r.sinceRet <= 14,
  'se retiró hace 15-35 días': (r) => r.sinceRet > 14 && r.sinceRet <= 35,
  'se retiró hace ≤ 35 días': (r) => r.sinceRet <= 35,
  'se retiró hace 36-90 días': (r) => r.sinceRet > 35 && r.sinceRet <= 90,
  'sin retirada en 90 días': (r) => r.sinceRet > 90,
  'ranking protegido (Sackmann)': (r) => r.entryKnown && r.pr,
  'sin ranking protegido (Sackmann)': (r) => r.entryKnown && !r.pr,
  'vuelve tras ≥ 120 días sin jugar': (r) => r.layoff != null && r.layoff >= 120,
  'vuelve tras ≥ 180 días sin jugar': (r) => r.layoff != null && r.layoff >= 180,
};
for (const [label, set] of [['2021-2023 (para las tasas)', fit], ['2024-2026 (comprobación)', test]]) {
  const matches = set.filter((_, i) => i % 2 === 0);
  console.log(`\n${label}: ${matches.length} partidos Challenger, con retirada el ${(matches.reduce((s, x) => s + x.matchRet, 0) / matches.length * 100).toFixed(2)} %`);
  for (const [g, f] of Object.entries(groups)) console.log(`  ${g.padEnd(36)} ${fmt(rate(set.filter(f)))}`);
}
