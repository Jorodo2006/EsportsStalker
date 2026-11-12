// Las cuotas sólo cambian cuando el lector (o el marcador) manda una lectura nueva, y el servidor lo avisa por SSE con la clave
// del partido ("equipo A|equipo B", keyOf en server/services/odds/bridge.js). Cada consulta de cuotas lleva esa clave en meta
// y se recarga con su aviso, en vez de preguntar cada minuto: con trece partidos en pantalla eran 1,2 MB por minuto casi
// siempre repetidos. ODDS_FALLBACK es por si se pierde algún aviso sin que se note la reconexión.
import type { QueryClient } from '@tanstack/react-query';

export const ODDS_FALLBACK = 10 * 60e3;

export const oddsKey = (m: { a: { name: string }; b: { name: string } }) => `${m.a.name}|${m.b.name}`;
export const oddsMeta = (m: { a: { name: string }; b: { name: string } }) => ({ oddsKey: oddsKey(m) });

// Una lectura llega en varias páginas seguidas (una por pestaña de la casa, unos segundos entre ellas): se espera a que paren
// (QUIET) para recargar una sola vez, pero sin pasar de MAX desde el primer aviso
const QUIET = 4000, MAX = 15000;

export function listenOdds(qc: QueryClient) {
  const keys = new Set<string>();
  let all = false, timer: ReturnType<typeof setTimeout> | null = null, first = 0;
  const flush = () => {
    const only = new Set(keys), every = all;
    keys.clear(); all = false; timer = null; first = 0;
    qc.invalidateQueries({ predicate: q => typeof q.meta?.oddsKey === 'string' && (every || only.has(q.meta.oddsKey)) });
    // La mejor cuota de ganador de las tarjetas también sale de las lecturas
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  return window.api.onOddsImported(d => {
    // Sin clave: una reconexión (se pueden haber perdido avisos) o un aviso antiguo; se recarga todo lo que esté en pantalla
    if (d?.matchKey) keys.add(d.matchKey); else all = true;
    const now = Date.now();
    if (!first) first = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, now - first >= MAX ? 0 : QUIET);
  });
}
