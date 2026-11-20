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

// ---------- Dobles de tenis ----------
// Nuestras parejas se llaman "Orlando Luz / Rafael Matos" (server/services/tennis/doubles.js): " / " con espacios y nombre y apellido
// a cada lado. Sólo eso cuenta como pareja, para no tocar equipos con barra de otros deportes ("Bodø/Glimt"). Las casas las escriben
// a su manera ("Luz O. / Matos R.", "Matos/Luz"): se parte su nombre por la barra y cada mitad tiene que casar con un jugador
// distinto, en cualquier orden, con las reglas de un jugador. Así una pareja con un solo jugador en común no pasa por la nuestra.
// La misma idea está en server/lector/winamaxfind.js y pagefind.js, que corren dentro de la página y no pueden importar esto
const PAIR_NAME = /^\S+(?: \S+)+ \/ \S+(?: \S+)+$/;
const isPairName = s => PAIR_NAME.test(String(s || '').trim());
const halves = s => String(s || '').split('/').map(x => x.trim()).filter(Boolean);
const playerRef = full => {
  const w = String(full).trim().split(/\s+/), last = w.slice(1).join(' ');
  return { name: full, alt: [last, `${w[0][0]}. ${last}`, `${last} ${w[0][0]}`] };
};
// Un jugador de la pareja contra una mitad del nombre de la casa: basta una palabra de su apellido, sin partículas ("Reyes" en
// "M.A.Reyes-Varela" para "Miguel Angel Reyes", "Trotter" en "J.Trotter" para "James Kent Trotter": Winamax en noviembre de 2026),
// o las reglas de un jugador. Tienen que casar las dos mitades de las dos parejas: por casualidad, casi imposible
const PARTICLE = /^(van|von|der|den|del|dos|das|los|las|les)$/;
const surnameWords = full => { const w = words(full).slice(1), k = w.filter(x => x.length >= 3 && !PARTICLE.test(x)); return k.length ? k : w.slice(-1); };
const playerScore = (full, half) => (surnameWords(full).some(w => words(half).includes(w)) ? 1 : teamScore(playerRef(full), half));
function pairScore(target, name) {
  const mine = halves(target.name), theirs = halves(name);
  if (mine.length !== 2 || theirs.length !== 2) return 0;
  const [p, q] = mine, [x, y] = theirs;
  return Math.max(Math.min(playerScore(p, x), playerScore(q, y)), Math.min(playerScore(p, y), playerScore(q, x)));
}

function teamScore(target, name) {
  if (isPairName(target?.name)) return pairScore(target, name);
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
    // Las mismas palabras salvo una letra en alguna ("Riga Zelli" / "Rigas Zelli"): el mismo equipo. Antes sumaba sólo 0,6 por la
    // última palabra y, con "Derthona" / "Derthona Basket" (0,8), el partido no llegaba al 1,5 y sus cuotas no se guardaban
    if (wt.length >= 2 && wt.length === wn.length && wt.every((w, i) => w === wn[i] || (w.length >= 4 && wn[i].length >= 4 && w[0] === wn[i][0] && within1(w, wn[i])))) best = Math.max(best, 0.9);
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

module.exports = { norm, teamScore, orient, isPairName };
