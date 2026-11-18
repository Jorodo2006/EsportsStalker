// Los mismos equipos se vuelven a enfrentar (en la NBA, a menudo dos noches seguidas; en tenis y LoL, en otro torneo) y las
// direcciones de cada casa se guardan por los nombres (odds.book_urls): una dirección guardada puede llevar al partido anterior,
// ya terminado, y entonces cada lectura volvía a traer sus cuotas viejas. Winamax dice la hora del partido que ha leído
// (matchStart, en segundos) y su estado: si no es el del trabajo, la lectura se rechaza y la dirección se olvida (bridge.add).
const MAX_DIFF = 12 * 3600e3;

// jobStart y now en milisegundos; book: el partido de Winamax ({ matchStart, status })
function isOtherMatch(jobStart, book, now = Date.now()) {
  if (!jobStart || !book) return false;
  const start = Number(book.matchStart) * 1000;
  if (start && Math.abs(start - jobStart) > MAX_DIFF) return true;
  // Terminado cuando el nuestro aún no ha empezado
  return /^(ENDED|CLOSED|FINISHED)$/i.test(String(book.status || '')) && jobStart > now;
}

module.exports = { isOtherMatch };
