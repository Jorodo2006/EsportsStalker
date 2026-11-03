// Emparejar los equipos de las casas con los de lolesports por nombre ("Gen.G Esports" / "GEN" / "Gen G").
// Lo usan el normalizador (odds.js) y el puente (bridge.js) para saber a qué partido van las cuotas.
const STOP = /\b(esports?|e-sports|gaming|team|club|academy|challengers)\b/g;
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(STOP, '').replace(/[^a-z0-9]/g, '');

function teamScore(target, name) {
  const n = norm(name);
  if (!n) return 0;
  let best = 0;
  for (const t of [target.name, target.code, ...(target.alt || [])].filter(Boolean)) {
    const x = norm(t);
    if (!x) continue;
    if (x === n) return 1;
    if (x.length >= 3 && n.length >= 3 && (x.includes(n) || n.includes(x))) best = Math.max(best, 0.8);
    // Abreviaturas de las casas ("R. Madrid" / "Real Madrid"): coincide la última palabra larga
    const last = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 5).pop();
    if (last(t) && last(t) === last(name)) best = Math.max(best, 0.6);
  }
  return best;
}

// Devuelve { swapped, score } si el par (home, away) corresponde a (a, b), o null si no coincide
function orient(a, b, home, away) {
  const direct = teamScore(a, home) + teamScore(b, away);
  const swapped = teamScore(a, away) + teamScore(b, home);
  if (Math.max(direct, swapped) < 1.5) return null;
  return { swapped: swapped > direct, score: Math.max(direct, swapped) };
}

module.exports = { norm, teamScore, orient };
