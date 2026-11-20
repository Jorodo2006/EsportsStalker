// Cuándo lee solo el lector las cuotas de un partido, para decirle al usuario por qué todavía no hay. Son las mismas reglas
// que server/services/odds/scheduler.js: si cambian allí, cambian aquí.
// - Con las lecturas lejanas encendidas (oddsFarEnabled), todo hasta 48 h antes; si no, hasta oddsAutoHours (tenis, fútbol y
//   MMA: 3 h como mucho)
// - Challenger: sólo el cuadro final, desde 12 h antes. Las previas y los dobles del tenis no se leen solos (los dobles no llegan
//   al programador: van en /api/tennis/doubles)
import type { Settings, Sport } from './types';

const FAR_HOURS = 48, CROWDED_NEAR_HOURS = 3, CHALLENGER_HOURS = 12;
const CROWDED: Sport[] = ['tennis', 'football', 'mma'];

export type OddsKind = { sport: Sport; challenger?: boolean; qualifying?: boolean; doubles?: boolean };

// Horas antes del partido desde las que se leen solas, o null si no se leen solas
export function aheadHours(k: OddsKind, s?: Partial<Settings> | null): number | null {
  if (s?.oddsAutoEnabled === false || k.qualifying || k.doubles) return null;
  if (k.challenger) return s?.challengerOddsEnabled === false ? null : CHALLENGER_HOURS;
  if (s?.oddsFarEnabled !== false) return FAR_HOURS;
  const hours = Math.min(48, Math.max(1, Number(s?.oddsAutoHours) || 6));
  return CROWDED.includes(k.sport) ? Math.min(hours, CROWDED_NEAR_HOURS) : hours;
}

const when = (t: number) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

// Desde cuándo se leen (ms), o null si no se leen solas
export function autoFrom(start: string | undefined, k: OddsKind, s?: Partial<Settings> | null) {
  const h = aheadHours(k, s);
  return start && h != null ? +new Date(start) - h * 3600e3 : null;
}

// Texto corto para la tarjeta de un partido sin cuotas
export function cardNote(start: string | undefined, k: OddsKind, s?: Partial<Settings> | null) {
  const from = autoFrom(start, k, s);
  if (from == null) return 'Sin cuotas';
  return from > Date.now() ? `Cuotas desde el ${when(from)}` : 'Sin cuotas todavía';
}

// Explicación larga para la pestaña de cuotas: cuándo se leen y qué dijeron las casas la última vez
export function oddsExplanation(start: string | undefined, k: OddsKind, s: Partial<Settings> | null | undefined,
  sources: Record<string, { ok: boolean; msg: string; ts?: number }> | undefined) {
  const from = autoFrom(start, k, s), h = aheadHours(k, s);
  const said = Object.entries(sources ?? {}).filter(([, x]) => !x.ok && x.msg);
  const last = Math.max(0, ...said.map(([, x]) => x.ts ?? 0));
  const lines: string[] = [];
  if (said.length) {
    lines.push(`En la última lectura${last ? ` (${when(last)})` : ''} las casas aún no tenían este partido: ${said.map(([b, x]) => `${b}, «${x.msg.replace(/\s*\(he guardado[^)]*\)/, '')}»`).join('; ')}. Suelen publicarlo uno o dos días antes, y el lector lo vuelve a mirar solo.`);
  } else if (from != null && from > Date.now()) {
    lines.push(`Las cuotas se leen solas desde ${h} h antes del partido: a partir del ${when(from)}.`);
  } else if (from != null) {
    lines.push('Todavía no se han leído: el lector las trae solo, cada pocas horas y cada pocos minutos en las últimas 3 horas.');
  } else {
    lines.push(k.doubles ? 'Los dobles no se leen solos.' : k.qualifying ? 'Las previas no se leen solas.' : 'Las lecturas automáticas están apagadas en los ajustes.');
  }
  if (k.sport === 'basket') lines.push('Las líneas de jugador (puntos, rebotes…) las casas suelen sacarlas el mismo día del partido.');
  lines.push('Si las quieres ya, pulsa Actualizar cuotas: tarda un minuto.');
  return lines;
}
