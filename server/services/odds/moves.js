// Movimientos fuertes de una cuota entre una lectura y la anterior de la misma casa: lo que alerts.js (bets) avisa a quien le
// importa. Sólo los mercados que se pueden seguir (ganador, hándicap, totales, los de fútbol y MMA del partido y las líneas de
// jugador, que es donde hay apuestas) y sólo cambios que no sean ruido: un 10 % o más, y cuotas entre 1,15 y 10 (por encima, un
// salto de 12 a 13,5 pasa a menudo y no dice nada)
const MOVE = 0.10;
const MIN_PRICE = 1.15, MAX_PRICE = 10;
const WATCHED = /^(moneyline|spread|total|team_total|double|dnb|btts|corners|cards|method|distance|total_rounds)\|0\||^player\|/;

// prev: Map de `${market_key}\0${outcome_id}` a la fila anterior ({ price }); rows: las cuotas de esta lectura
function movesOf(prev, rows) {
  const out = [];
  for (const r of rows) {
    if (!WATCHED.test(r.market_key)) continue;
    const p = prev.get(`${r.market_key}\u0000${r.outcome_id}`);
    if (!p || !(p.price > 1) || !(r.price > 1)) continue;
    const from = Number(p.price), to = Number(r.price);
    if (Math.max(from, to) > MAX_PRICE || Math.min(from, to) < MIN_PRICE) continue;
    const change = to / from - 1;
    if (Math.abs(change) < MOVE || Math.abs(to - from) < 0.05) continue;
    out.push({ market_key: r.market_key, market: r.market, outcome_id: r.outcome_id, outcome: r.outcome, line: r.line ?? null, from, to, change });
  }
  return out;
}

module.exports = { movesOf, MOVE, WATCHED };
