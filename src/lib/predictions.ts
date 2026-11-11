// Manda al servidor las recomendaciones que se están viendo, para medir después si el modelo acierta (Mis apuestas →
// Acierto del modelo), de partidos que no han empezado: de baloncesto, las de valor; de tenis, todas las que enseña (la
// principal es "la más fiable", que puede no tener valor). No repite las que no han cambiado y
// las junta en un envío cada pocos segundos: una jornada de baloncesto son cientos.
import { BASKET_MARKETS } from './basket-model';
import { POINT_PERIODS } from './basket-teams';
import type { BasketPick } from './basket-picks';
import { alert, firstTime } from './notify';
import type { PredictionIn, TennisPick } from './types';

const sent = new Map<string, string>();
let queue: PredictionIn[] = [];
let timer: number | undefined;

// Una recomendación que merece aviso: mucho valor y bastante fiable (como las de arriba de Recomendaciones)
const STRONG_EV = 0.08, STRONG_REL = 65;

export function logPredictions(list: PredictionIn[]) {
  const now = Date.now();
  const strong: PredictionIn[] = [];
  for (const x of list) {
    if (!x.start || +new Date(x.start) <= now) continue;
    if (x.ev >= STRONG_EV && (x.rel ?? 0) >= STRONG_REL && firstTime(`pick:${x.match}|${x.key}|${x.out}`)) strong.push(x);
    const id = `${x.match}|${x.key}|${x.out}`, sig = `${x.price}|${x.p.toFixed(3)}`;
    if (sent.get(id) === sig) continue;
    sent.set(id, sig);
    queue = queue.filter(q => `${q.match}|${q.key}|${q.out}` !== id);
    queue.push(x);
  }
  // Un solo aviso aunque salgan varias a la vez (al abrir la app por la mañana pueden ser decenas): la mejor, y cuántas más
  if (strong.length) {
    const x = strong.sort((a, b) => b.ev - a.ev)[0];
    const what = `${x.title} (${x.event}) · cuota ${x.price.toFixed(2)}${x.book ? ` en ${x.book}` : ''} · probabilidad ${Math.round(x.p * 100)} %`;
    alert('picks', strong.length === 1 ? 'Recomendación fuerte' : `${strong.length} recomendaciones fuertes`, strong.length === 1 ? what : `La mejor: ${what}`, 'picks');
  }
  if (!queue.length || timer) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    const batch = queue.splice(0, 400);
    // Si falla no pasa nada: se volverá a mandar la próxima vez que cambie
    window.api.bets.recordPredictions(batch).catch(() => { for (const x of batch) sent.delete(`${x.match}|${x.key}|${x.out}`); });
  }, 4000);
}

// Baloncesto: la clave del mercado es la misma del comparador de cuotas, con la que se resuelven las apuestas
export function basketPrediction(p: BasketPick): PredictionIn | null {
  const base = { sport: 'basket' as const, match: p.game.id, start: p.game.date, event: `${p.game.away.abbr} @ ${p.game.home.abbr}`, league: p.game.league.toUpperCase(), out: p.side, title: p.title, book: p.book, price: p.price, p: p.p, pModel: p.pModel, pMarket: p.pMarket, ev: p.ev, rel: p.rel.score };
  if (p.kind === 'player' && p.who && p.marketKey) {
    const label = BASKET_MARKETS[p.marketKey].label;
    return { ...base, key: `player|${label}|${p.who.name.toLowerCase()}|${p.line}`, group: label };
  }
  if (p.period && p.pointKind) {
    const per = POINT_PERIODS.find(x => x.id === p.period)!;
    const key = p.pointKind === 'total' ? `total|${per.odds}||${p.line}` : `team_total|${per.odds}|${p.pointKind === 'away' ? 'a' : 'b'}|${p.line}`;
    return { ...base, key, group: `${p.pointKind === 'total' ? 'Total' : 'Puntos de equipo'} · ${per.label.toLowerCase()}` };
  }
  return null;
}

// Sólo los mercados que sabe resolver el servidor (settle.js); el resto ("betway|Ganará un set|", sin normalizar) no se cerraría nunca
const KNOWN = /^(moneyline|total|team_total|spread|double|dnb|btts|player)\|/;

// Tenis: el id de cada recomendación es "<clave del mercado>#<selección>"
export function tennisPredictions(m: { id: string; date: string; tournament?: string; a: { name: string }; b: { name: string } }, picks: (TennisPick | null | undefined)[]): PredictionIn[] {
  return picks.filter((x): x is TennisPick => !!x).map((x): PredictionIn => {
    const [key, out] = x.id.split('#');
    return {
      sport: 'tennis', match: m.id, start: m.date, key, out, group: x.market, title: x.title, event: `${m.a.name} - ${m.b.name}`,
      league: m.tournament ?? '', book: x.book, price: x.price, p: x.p, pModel: x.pModel, pMarket: x.pMarket, ev: x.ev, rel: x.rel.score
    };
  }).filter(x => x.key && x.out && KNOWN.test(x.key));
}
