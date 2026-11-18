// Partidos en juego de las cinco apps: el número rojo del selector, la columna «En directo» y las salidas de una lista
// vacía. Todos usan las mismas claves de consulta, así que se piden una sola vez
import { useQuery } from '@tanstack/react-query';
import type { Sport } from './types';

const EVERY = 60_000;

export function useLive() {
  const lol = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: EVERY });
  const basket = useQuery({ queryKey: ['basket', 'live'], queryFn: () => window.api.basket.live(), refetchInterval: EVERY, enabled: !!window.api.basket });
  const tennis = useQuery({ queryKey: ['tennis', 'live'], queryFn: () => window.api.tennis.live(), refetchInterval: EVERY, enabled: !!window.api.tennis });
  const football = useQuery({ queryKey: ['football', 'live'], queryFn: () => window.api.football.live(), refetchInterval: EVERY, enabled: !!window.api.football });
  const mma = useQuery({ queryKey: ['mma', 'live'], queryFn: () => window.api.mma.live(), refetchInterval: EVERY, enabled: !!window.api.mma });
  const counts: Record<Sport, number> = {
    lol: lol.data?.length ?? 0, basket: basket.data?.length ?? 0, tennis: tennis.data?.length ?? 0, football: football.data?.length ?? 0, mma: mma.data?.length ?? 0
  };
  return { lol: lol.data, basket: basket.data, tennis: tennis.data, football: football.data, mma: mma.data, counts };
}

// Nombre de cada app en una frase («Ver baloncesto») y cómo se llaman sus partidos
export const SPORT_NAME: Record<Sport, string> = { lol: 'LoL', basket: 'baloncesto', tennis: 'tenis', football: 'fútbol', mma: 'MMA' };
export const gamesWord = (s: Sport, n = 2) => (s === 'mma' ? (n === 1 ? 'combate' : 'combates') : n === 1 ? 'partido' : 'partidos');

// La primera visita se abría en LoL, que muchos días está vacío. Ahora se abre en el deporte con más partidos en juego y,
// si no hay ninguno, en el que tiene más partidos hoy. De LoL sólo se sabe lo que hay en juego (su calendario pesa mucho).
// A igualdad, el orden de ORDER: el fútbol es lo que más se busca en España
const ORDER: Sport[] = ['football', 'basket', 'tennis', 'mma', 'lol'];
export async function busiestSport(day: string): Promise<Sport | null> {
  const n = (p: Promise<unknown[]>) => p.then(l => l.length, () => 0);
  const total = (p: Promise<Record<string, { total: number; live: number }>>) => p.then(d => d[day] ?? { total: 0, live: 0 }, () => ({ total: 0, live: 0 }));
  const [lol, basket, tennis, football, mma] = await Promise.all([
    n(window.api.esports.live()).then(live => ({ total: 0, live })),
    total(window.api.basket.days(day, 1)), total(window.api.tennis.days(day, 1)),
    total(window.api.football.days(day, 1)), total(window.api.mma.days(day, 1))
  ]);
  const by: Record<Sport, { total: number; live: number }> = { lol, basket, tennis, football, mma };
  const best = [...ORDER].sort((a, b) => by[b].live - by[a].live || by[b].total - by[a].total)[0];
  return by[best].live || by[best].total ? best : null;
}
