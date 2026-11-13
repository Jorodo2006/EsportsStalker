'use strict';
// ¿Este texto habla de este luchador? Lo usan el normalizador de cuotas de MMA (para no mezclar el combate de otro) y el
// resolvedor de apuestas (para no resolver una apuesta con el resultado de otro combate). Exige el apellido y el nombre (o su
// inicial o una variante cercana): el apellido solo no basta, porque "Silva" o "Rodriguez" son de muchos luchadores.
const bare = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => bare(s).split(/[^a-z0-9]+/).filter(Boolean);

// Distancia de edición (sustituir, quitar o poner letras)
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// "Chris" / "Christopher", "C." / "Ciryl" y "Charlie" / "Charles" son el mismo nombre; "David" / "Daniel", no
const firstOk = (fn, t) => t.startsWith(fn) || fn.startsWith(t) || (fn.length >= 6 && t.length >= 6 && lev(fn, t) <= 2);
// Un apellido puede venir con una errata de una letra ("Radke" por "Radtke")
const lastOk = (ln, t) => t === ln || (ln.length >= 5 && t.length >= 5 && lev(ln, t) <= 1);

function mentions(name, text) {
  const nw = words(name), tw = words(text);
  if (!nw.length || !tw.length) return false;
  // Un solo nombre ("Alatengheili"): las casas lo parten ("Alateng Heili")
  if (nw.length === 1) return tw.join('').includes(nw[0]);
  const first = nw[0], last = nw[nw.length - 1];
  const lastHit = tw.some(t => lastOk(last, t)) || tw.join('').includes(nw.slice(1).join(''));
  return lastHit && tw.some(t => firstOk(first, t));
}

module.exports = { mentions, lev, words };
