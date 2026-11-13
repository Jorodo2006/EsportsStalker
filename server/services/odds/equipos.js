// Emparejar los equipos de las casas con los de lolesports por nombre ("Gen.G Esports" / "GEN" / "Gen G").
// Lo usan el normalizador (odds.js) y el puente (bridge.js) para saber a qué partido van las cuotas.
const STOP = /\b(esports?|e-sports|gaming|team|club|academy|challengers)\b/g;
const ACCENTS = /[\u0300-\u036f]/g; // "Uroš Medić" y "Uros Medic" son el mismo luchador
const bare = s => String(s || '').normalize('NFD').replace(ACCENTS, '');
const norm = s => bare(s).toLowerCase().replace(/\(.*?\)/g, '').replace(STOP, '').replace(/[^a-z0-9]/g, '');

// Distancia de edición de 1 como mucho (una letra de más, de menos o cambiada): "Radtke" / "Radke"
const within1 = (x, y) => {
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return x.slice(i + 1) === y.slice(i + 1) || x.slice(i) === y.slice(i + 1) || x.slice(i + 1) === y.slice(i);
};
const words = s => bare(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

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
    // Errata de una letra en el apellido (las casas escriben "Radke" por "Radtke") con la misma inicial del nombre: casi seguro
    // el mismo luchador; con las dos partes del combate suma lo justo para emparejar
    const wt = words(t), wn = words(name);
    if (wt.length >= 2 && wn.length >= 2 && wt[0][0] === wn[0][0]) {
      const lt = wt[wt.length - 1], ln = wn[wn.length - 1];
      if (lt.length >= 5 && ln.length >= 5 && lt !== ln && within1(lt, ln)) best = Math.max(best, 0.75);
    }
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
