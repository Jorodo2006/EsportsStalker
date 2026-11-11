// Contexto de un partido para el modelo de props: descanso del jugador y vuelta tras perderse partidos. Sale sólo de su
// registro, del calendario de su equipo y de la fecha, así que el analizador, el escáner y la prueba con partidos pasados
// (scripts/backtest-basket.ts) lo calculan igual y dan la misma probabilidad.
import type { BasketLogGame, BasketTeamLogs } from './types';

// Día del partido en Nueva York (las fechas de la NBA son las de allí: las 01:30 UTC son la noche anterior)
export const nyDay = (iso: string) => {
  const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
};

export interface GameCtx {
  rest?: number; // noches libres desde su último partido de la temporada (0 = B2B)
  b2b?: boolean;
  back?: number; // 1, 2 o 3: es su 1.º, 2.º o 3.º partido tras perderse 3 o más seguidos de su equipo
  missed?: number; // cuántos se perdió
}

// prior: sus partidos anteriores; team: partidos de su equipo (vacío si no se sabe, p. ej. en la Euroliga)
export function gameCtx(prior: BasketLogGame[], team: { id: string; date: string }[], date: string, teamId: string | null | undefined): GameCtx {
  const t = +new Date(date);
  const own = prior.filter(g => g.type !== 'pre' && +new Date(g.date) < t).sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const out: GameCtx = {};
  const prev = own[0];
  const season = (d: string) => { const x = new Date(d); return x.getUTCMonth() >= 8 ? x.getUTCFullYear() + 1 : x.getUTCFullYear(); };
  if (prev && season(prev.date) === season(date)) {
    out.rest = nyDay(date) - nyDay(prev.date) - 1;
    out.b2b = out.rest === 0;
  }
  if (!team.length || !teamId) return out;
  // Partidos de su equipo entre dos suyos: si son 3 o más, estuvo de baja. Se mira hasta 3 partidos atrás
  const dates = team.map(g => +new Date(g.date));
  let cur = t;
  for (let k = 1; k <= 3; k++) {
    const p = own[k - 1];
    if (!p || p.teamId !== teamId || season(p.date) !== season(date)) break;
    const pt = +new Date(p.date);
    const missed = dates.filter(d => d > pt && d < cur).length;
    if (missed >= 3) { out.back = k; out.missed = missed; break; }
    cur = pt;
  }
  return out;
}

// Calendario de un equipo sacado de los partidos de su plantilla (escáner y recomendaciones, que ya la tienen). Es el mismo
// que da /api/basket/schedule para el analizador: un partido del equipo lo juega siempre alguien de la plantilla
export function teamGamesOf(data: BasketTeamLogs, teamId: string) {
  const seen = new Map<string, string>();
  for (const p of data.players) for (const g of p.games) if (g.teamId === teamId && g.type !== 'pre') seen.set(g.id, g.date);
  return [...seen].map(([id, date]) => ({ id, date }));
}
