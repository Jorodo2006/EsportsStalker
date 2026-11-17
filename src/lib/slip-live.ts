// Cuotas al día en el cupón: cada selección recuerda su partido, mercado y selección (SlipLive) y con eso se vuelve a mirar
// lo que dan las casas antes de registrarla. Una cuota vista hace horas puede haber bajado o la casa haber movido la línea.
import type { MatchOdds, SlipLeg, SlipLive } from './types';

// Un partido, para no leer dos veces el mismo si hay varias selecciones suyas en el cupón
export const matchKeyOf = (m: SlipLive['match']) => `${m.sport ?? 'lol'}|${m.a.name}|${m.b.name}`;

// Aplica lo que dan ahora las casas a una selección. Se queda con su casa si sigue teniendo cuota; si no, con la mejor de las
// demás (y cambia la casa). Si el mercado o la selección ya no están, la marca como desaparecida y deja la cuota como estaba
export function applyOdds(l: SlipLeg, data: MatchOdds | undefined, now = Date.now()): SlipLeg {
  if (!l.live || !data) return l;
  const o = data.markets.find(m => m.key === l.live!.key)?.outcomes.find(x => x.id === l.live!.out);
  const prices = Object.entries(o?.prices ?? {}).filter(([, p]) => p > 1);
  if (!prices.length) return { ...l, live: { ...l.live, gone: true, at: now, checked: true } };
  const mine = prices.find(([bk]) => bk === l.bookmaker);
  const [book, price] = mine ?? prices.sort((x, y) => y[1] - x[1])[0];
  const at = data.sources[book]?.ts ?? now;
  const changed = Math.abs(price - l.odds) > 0.001;
  return {
    ...l, odds: price, bookmaker: book,
    live: { ...l.live, gone: false, at, was: changed ? l.odds : l.live.was, checked: true }
  };
}

// "hace 5 min", "hace 3 h", "hace 2 días"
export function ageOf(at: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - at) / 60e3));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

// Más de una hora es lo bastante viejo para avisar: antes de un partido las cuotas se mueven
export const isStale = (at: number | undefined, now = Date.now()) => at != null && now - at > 60 * 60e3;
