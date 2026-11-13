// Piezas comunes de la app de MMA: el icono del selector (el octógono), la hora en España, cómo se cuenta un resultado y el
// combate para el lector, el comparador y el cupón. Las usan la lista de combates, la ficha y la portada Hoy.
import { Octagon } from 'lucide-react';
import type { MmaFight, MmaMethod } from '@/lib/types';
import type { OddsTarget } from './BasketOdds';

export const MmaIcon = ({ size = 16 }: { size?: number }) => <Octagon size={size} />;

export const esTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
// WOW no publica la hora de sus combates (sólo el día): no se enseña una inventada
export const fightTime = (f: MmaFight) => (f.org === 'wow' ? 'Hora por confirmar' : esTime(f.date));
// El día del combate en España: con él busca el servicio el combate
export const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

export const METHOD_ES: Record<MmaMethod, string> = { ko: 'KO/TKO', sub: 'Sumisión', dec: 'Decisión', other: 'Otro', '': '' };
export const surname = (name: string) => name.split(' ').slice(1).join(' ') || name;

// "KO/TKO · asalto 2, 3:40": cómo acabó, para la tarjeta y el marcador. Vacío si aún no ha acabado
export function resultShort(f: MmaFight): string {
  const r = f.result;
  if (f.cancelled) return 'Cancelado';
  if (!r) return '';
  if (r.draw) return 'Empate';
  if (r.noContest) return 'Sin resultado';
  return [METHOD_ES[r.method], r.round ? `asalto ${r.round}${r.time ? `, ${r.time}` : ''}` : ''].filter(Boolean).join(' · ');
}

// Quién ganó, en palabras
export function winnerText(f: MmaFight): string {
  const r = f.result;
  if (f.cancelled) return 'Combate cancelado';
  if (!r) return '';
  if (r.draw) return 'Empate';
  if (r.noContest) return 'Sin resultado';
  return r.winner ? `Gana ${(r.winner === 'a' ? f.a : f.b).name}` : 'Sin ganador registrado';
}

// El combate para el lector, el comparador y el cupón. a es la esquina roja; event, el cartel, con el que el lector encuentra el
// grupo del evento en Betway
export const targetOfFight = (f: MmaFight): OddsTarget => ({
  id: f.id, done: f.state === 'post' || !!f.cancelled, sport: 'mma', event: `${f.a.name} vs ${f.b.name}`, league: f.orgName,
  match: { a: { name: f.a.name, code: '', alt: f.a.alt }, b: { name: f.b.name, code: '', alt: f.b.alt }, start: f.date, sport: 'mma', league: f.org, event: f.event }
});

// Récord "23-12-0" → { w, l, d, pct } para comparar dos luchadores; null si no se lee
export function parseRecord(r: string): { w: number; l: number; d: number; pct: number } | null {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(String(r || '').trim());
  if (!m) return null;
  const w = +m[1], l = +m[2], d = +(m[3] ?? 0);
  return { w, l, d, pct: w + l + d ? w / (w + l + d) : 0 };
}
