// Abrir un partido de baloncesto directamente en las estadísticas de un jugador (desde «Tus apuestas», MyBetsLive.tsx). El
// jugador no va en la dirección: se deja aquí al pulsar y la ficha del partido (GameDetail de BasketMatches.tsx) lo recoge al
// abrirse, abre la pestaña Estadísticas y su partido. Caduca enseguida, para que no se abra solo otra vez más tarde.
let pending: { match: string; name: string; at: number } | null = null;

export function focusPlayer(match: string, name: string) { pending = { match, name, at: Date.now() }; }

export function focusedPlayer(match: string): string | null {
  return pending && pending.match === match && Date.now() - pending.at < 15e3 ? pending.name : null;
}

export function clearFocus(match: string) { if (pending?.match === match) pending = null; }
