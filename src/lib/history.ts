// El único sitio que toca window.history. Dos tipos de entrada:
//   - pantallas: cada una con su dirección (src/lib/route.ts). navigate() las apila; atrás y adelante las recuperan.
//   - capas: fichas, chat del móvil y ventanas (useBackLayer). Apilan una entrada con la misma dirección para que atrás
//     las cierre en vez de salir de la pantalla.
// Cada entrada guarda { idx, prev, layer }: idx, su posición (para saber si se va hacia atrás o hacia adelante); prev, la
// dirección de la pantalla de la que se vino (para que «Volver a partidos» sea un atrás de verdad); layer, si es de una capa.
import { useEffect, useRef } from 'react';
import { hrefOf, parseRoute, type Route } from './route';

interface Entry { idx?: number; prev?: string; layer?: number }

let idx = 0;
let current: Route | null = null;
let onChange: ((r: Route) => void) | null = null;
// Lo pedido durante el mismo clic se junta en una sola entrada: el buscador cambia de deporte, de día y abre el partido
// con tres llamadas, y con una entrada por llamada habría que pulsar atrás tres veces
let pending: { route: Route; push: boolean } | null = null;
const layers: { id: number; idx: number; close: () => void }[] = [];
let seq = 0;

const here = () => location.pathname + location.search;
const entry = (): Entry => (history.state && typeof history.state === 'object' ? history.state : {}) as Entry;

// La pantalla actual, contando lo que está pendiente de escribirse en el historial
export const currentRoute = () => pending?.route ?? current;

// Lo llama AppProvider una vez. La dirección queda escrita como la entiende la app ("/" pasa a "/futbol") y sin marca de
// capa: al recargar no queda ninguna abierta
export function startHistory(initial: Route, listener: (r: Route) => void): () => void {
  current = initial;
  onChange = listener;
  const e = entry();
  idx = typeof e.idx === 'number' ? e.idx : 0;
  try { history.replaceState({ idx, prev: e.prev } satisfies Entry, '', hrefOf(initial) + location.hash); } catch { /* sin historial */ }
  window.addEventListener('popstate', onPop);
  return () => { window.removeEventListener('popstate', onPop); onChange = null; };
}

function flush() {
  const p = pending;
  pending = null;
  if (!p) return;
  const href = hrefOf(p.route);
  if (href !== here()) {
    try {
      if (p.push) { idx++; history.pushState({ idx, prev: here() } satisfies Entry, '', href); }
      else history.replaceState({ ...entry(), layer: undefined } satisfies Entry, '', href);
    } catch { /* sin historial (una vista previa): la app sigue, sólo que sin dirección */ }
  }
  current = p.route;
  onChange?.(p.route);
}

// Cambia de pantalla. replace: sustituye la entrada en vez de apilar otra (cambiar de día en la tira, corregir la dirección)
export function navigate(to: (r: Route) => Route, opts?: { replace?: boolean }) {
  const base = currentRoute();
  if (!base) return;
  if (!pending) queueMicrotask(flush);
  pending = { route: to(base), push: !opts?.replace || !!pending?.push };
}

// Volver a una pantalla: si es de la que se vino, es un atrás (el historial no crece y adelante sigue funcionando); si no
// (se entró por un enlace, o se llegó desde otra sección), sustituye a la actual
export function backTo(target: Route) {
  const e = entry();
  if (e.idx && e.prev === hrefOf(target)) history.back();
  else navigate(() => target, { replace: true });
}

function onPop(ev: PopStateEvent) {
  const e = (ev.state && typeof ev.state === 'object' ? ev.state : {}) as Entry;
  const to = typeof e.idx === 'number' ? e.idx : 0;
  const from = idx;
  idx = to;
  pending = null;
  if (!current) return;
  const next = parseRoute(location.pathname, location.search, current.app);
  const closing = layers.filter(l => l.idx > to);
  for (const l of closing) layers.splice(layers.indexOf(l), 1);
  const moved = hrefOf(next) !== hrefOf(current);
  if (moved) { current = next; onChange?.(next); }
  for (const l of closing.reverse()) l.close();
  // Una entrada que no cambia nada es de una capa que ya se cerró de otra forma (su «Volver», Escape, clic fuera, recargar):
  // se sigue en la misma dirección, para que ninguna pulsación de atrás se quede sin hacer nada. Desde la primera entrada,
  // seguir hacia atrás es salir de la web, que es lo que se pedía
  if (!moved && !closing.length) {
    if (to < from) history.back();
    else if (to > from) history.forward();
  }
}

function openLayer(close: () => void): number {
  // Si hay un cambio de pantalla pendiente, va antes: la capa se apila encima de la pantalla en la que se abre
  if (pending) flush();
  const id = ++seq;
  idx++;
  try { history.pushState({ idx, prev: entry().prev, layer: id } satisfies Entry, '', here() + location.hash); } catch { /* sin historial */ }
  layers.push({ id, idx, close });
  return id;
}

function dropLayer(id: number) {
  const i = layers.findIndex(l => l.id === id);
  if (i >= 0) layers.splice(i, 1);
}

// Una ficha, un chat o una ventana que se cierra con atrás. open: si está abierta; close: lo que hace su botón de cerrar.
// Cambiar lo que enseña sin cerrarla (de un jugador a otro) no apila nada: es la misma capa
export function useBackLayer(open: boolean, close: () => void) {
  const ref = useRef(close);
  useEffect(() => { ref.current = close; });
  useEffect(() => {
    if (!open) return;
    const id = openLayer(() => ref.current());
    return () => dropLayer(id);
  }, [open]);
}
