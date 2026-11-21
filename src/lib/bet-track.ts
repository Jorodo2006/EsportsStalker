// Cómo va una apuesta pendiente mientras se juega su partido (bloque «Tus apuestas» de Partidos, components/MyBetsLive.tsx).
// Lee la clave de mercado del ref (las de odds.js, las mismas que resuelve server/services/bets/settle.js) y la compara con el
// marcador y la ficha en juego. Es sólo para mirar: lo que cuenta es la resolución del servidor, que espera al final y, ante
// la duda, deja la apuesta a mano. Aquí, ante la duda, no se enseña nada (null).
import type { BetRef } from './types';

export interface LivePlayer { name: string; min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg3: string }
// El partido como lo necesita el seguimiento, orientado como las claves: a y b son visitante y local en baloncesto, local y
// visitante en fútbol, y como vienen en tenis y MMA
export interface LiveGame {
  state: 'pre' | 'in' | 'post';
  // Marcador de un periodo (0 el partido; baloncesto 1-2 mitades y 11-14 cuartos; fútbol 1-2 partes; tenis 21-25 sets), o null
  score(period: number): [number, number] | null;
  sets?: [number, number]; // tenis: sets ganados
  winner?: 'a' | 'b' | null; // tenis y MMA, ya acabado
  players?: LivePlayer[]; // baloncesto: la ficha
  scorers?: string[]; // fútbol: quién ha marcado, una vez por gol (sin los de propia puerta)
}

// good: va bien; bad: va mal; even: ni una cosa ni otra (empate, o un «más de» que aún no ha llegado)
export type Mood = 'good' | 'bad' | 'even';
// bar: una cifra que tiene que pasar (o no pasar) una línea; done: ya está decidida (el «más de» ya se ha pasado, o el «menos
// de» ya se ha roto). lead: quién va por delante, con un texto corto
export type Track =
  | { kind: 'bar'; value: number; line: number; over: boolean; mood: Mood; done: boolean; what: string; player?: string; dnp?: boolean }
  | { kind: 'lead'; mood: Mood; text: string };

// Nombres comparables: sin acentos, mayúsculas, signos ni "Jr." (como norm de settle.js)
export const normName = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z]/g, '');

// El jugador de la ficha que dice la casa: por el nombre exacto o, si encaja con uno solo, por la inicial y el apellido
// ("D. Mitchell"); el mismo criterio que la resolución
export function findPlayer<P extends { name: string }>(players: P[], who: string): P | null {
  const n = normName(who);
  if (!n) return null;
  const near = players.filter(x => { const a = normName(x.name); return a.length > 4 && n.length > 4 && (a.endsWith(n.slice(1)) || n.endsWith(a.slice(1))) && a[0] === n[0]; });
  return players.find(x => normName(x.name) === n) ?? (near.length === 1 ? near[0] : null);
}

// Las mismas estadísticas que PLAYER_STAT de settle.js
const PLAYER_STAT: Record<string, (p: LivePlayer) => number> = {
  Puntos: p => p.pts, Rebotes: p => p.reb, Asistencias: p => p.ast, 'Triples anotados': p => parseInt(p.fg3, 10) || 0,
  Robos: p => p.stl, Tapones: p => p.blk, Pérdidas: p => p.tov, 'Pts + Reb + Ast': p => p.pts + p.reb + p.ast,
  'Pts + Reb': p => p.pts + p.reb, 'Pts + Ast': p => p.pts + p.ast, 'Reb + Ast': p => p.reb + p.ast, 'Robos + Tapones': p => p.stl + p.blk
};

// El jugador de una línea de jugador de baloncesto (para abrir sus estadísticas en el partido), o null
export function playerOf(ref: Pick<BetRef, 'key'>): string | null {
  const p = ref.key.split('|');
  return p[0] === 'player' && p[2] ? p[2] : null;
}

const es = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

function bar(value: number, line: number, over: boolean, state: LiveGame['state'], what: string, extra: { player?: string; dnp?: boolean } = {}): Track {
  // El «más de» ya pasado está ganado; el «menos de» pasado, perdido. Lo demás se decide al final
  const crossed = value > line;
  const done = crossed || state === 'post';
  const mood: Mood = over ? (crossed ? 'good' : state === 'post' ? 'bad' : 'even') : (crossed ? 'bad' : 'good');
  return { kind: 'bar', value, line, over, mood, done, what, ...extra };
}

const signed = (d: number) => (d > 0 ? 'good' : d < 0 ? 'bad' : 'even') as Mood;

// → cómo va, o null si no se sabe (partido sin empezar, mercado que no se sigue, sin datos)
export function trackOf(ref: Pick<BetRef, 'key' | 'out'> & { sport: BetRef['sport'] }, g: LiveGame | null | undefined, selection = ''): Track | null {
  if (!g || g.state === 'pre') return null;
  const parts = ref.key.split('|');
  const type = parts[0], out = ref.out;

  if (type === 'player') {
    const [, stat, who, l] = parts, line = Number(l), f = PLAYER_STAT[stat];
    if (!f || !isFinite(line) || !g.players) return null;
    const p = findPlayer(g.players, who);
    // Aún no ha salido a la pista (o no está en la ficha): lleva cero
    const value = p ? f(p) : 0;
    return bar(value, line, out === 'over', g.state, stat, { player: p?.name ?? who, dnp: g.state === 'post' && (!p || !p.min) });
  }
  // Fútbol, de Winamax: «Goleador» y «Marca N goles o más» (la selección es el jugador)
  if (type === 'wmx') {
    if (ref.sport !== 'football' || !g.scorers || !selection) return null;
    const t = parts[1]?.trim() ?? '';
    const n = /^goleador$/i.test(t) ? 1 : Number(/^marca (\d+) goles o más$/i.exec(t)?.[1]);
    if (!(n >= 1)) return null;
    const goals = g.scorers.filter(s => normName(s) === normName(selection)).length;
    return bar(goals, n - 0.5, true, g.state, 'Goles', { player: selection });
  }

  const period = Number(parts[1]) || 0, side = parts[2], line = Number(parts[3]);
  const unit = ref.sport === 'tennis' ? 'Juegos' : ref.sport === 'football' ? 'Goles' : ref.sport === 'lol' ? 'Mapas' : 'Puntos';

  // Ganador del partido en tenis: los sets; en MMA, sólo cuando ya ha acabado
  if (type === 'moneyline' && period === 0 && (ref.sport === 'tennis' || ref.sport === 'mma')) {
    if (g.winner) return { kind: 'lead', mood: g.winner === out ? 'good' : 'bad', text: g.winner === out ? 'Ha ganado' : 'Ha perdido' };
    if (ref.sport === 'mma' || !g.sets || (out !== 'a' && out !== 'b')) return null;
    const [x, y] = out === 'a' ? g.sets : [g.sets[1], g.sets[0]];
    return { kind: 'lead', mood: signed(x - y), text: x === y ? `Igualados a ${x} en sets` : `${x > y ? 'Gana' : 'Pierde'} ${x}-${y} en sets` };
  }

  const sc = g.score(period);
  if (!sc || sc.some(v => !isFinite(v))) return null;
  const [a, b] = sc;
  switch (type) {
    case 'moneyline': {
      if (out === 'x') return { kind: 'lead', mood: a === b ? 'good' : 'bad', text: a === b ? 'Empate' : `No hay empate (${a}-${b})` };
      if (out !== 'a' && out !== 'b') return null;
      const d = out === 'a' ? a - b : b - a;
      return { kind: 'lead', mood: signed(d), text: d > 0 ? `Gana de ${es(d)}` : d < 0 ? `Pierde de ${es(-d)}` : 'Empate' };
    }
    case 'spread': {
      if (!isFinite(line) || (out !== 'a' && out !== 'b')) return null;
      const d = (a - b + line) * (out === 'a' ? 1 : -1); // la línea es la del primero (a)
      return { kind: 'lead', mood: signed(d), text: d > 0 ? `Cubre por ${es(d)}` : d < 0 ? `Le faltan ${es(-d)}` : 'Justo en la línea' };
    }
    case 'total':
      return isFinite(line) ? bar(a + b, line, out === 'over', g.state, unit) : null;
    case 'team_total': {
      const v = side === 'a' ? a : side === 'b' ? b : null;
      return v != null && isFinite(line) ? bar(v, line, out === 'over', g.state, unit) : null;
    }
    case 'double': {
      const w = a > b ? 'a' : b > a ? 'b' : 'x';
      const ok = ({ '1x': ['a', 'x'], '12': ['a', 'b'], x2: ['x', 'b'] } as Record<string, string[]>)[out];
      return ok ? { kind: 'lead', mood: ok.includes(w) ? 'good' : 'bad', text: ok.includes(w) ? 'Va cumpliendo' : 'Ahora mismo, no' } : null;
    }
    case 'dnb': {
      const d = out === 'a' ? a - b : out === 'b' ? b - a : NaN;
      return isFinite(d) ? { kind: 'lead', mood: signed(d), text: d > 0 ? `Gana de ${d}` : d < 0 ? `Pierde de ${-d}` : 'Empate: se devolvería' } : null;
    }
    case 'btts': {
      const both = a > 0 && b > 0, yes = out === 'yes';
      // «Sí» con los dos marcando ya está ganada; «No» se rompe con el segundo en marcar
      return { kind: 'lead', mood: both === yes ? 'good' : yes && g.state !== 'post' ? 'even' : 'bad', text: both ? 'Han marcado los dos' : 'Aún no han marcado los dos' };
    }
    default: return null;
  }
}
