// Direcciones de la app: cada pantalla tiene la suya (/futbol, /futbol/partido/laliga:123?dia=…, /tenis/jugadores, /amigos…),
// para que funcionen atrás y adelante del navegador, recargar sin perder el partido y compartir enlaces. Aquí sólo se pasa
// de dirección a pantalla y al revés, sin tocar el historial (eso es src/lib/history.ts). nginx y Vite ya devuelven
// index.html para cualquier camino, así que el servidor no sabe nada de esto.
import type { Sport } from './types';

// settings: los ajustes de la app, sólo del administrador; admin: la administración de cuentas, también sólo suya; account: la
// cuenta de cada uno (contraseña, cartera, avisos); plan: el plan de apuestas, común a los deportes; legal: aviso legal,
// privacidad y cookies (con su dirección propia, LEGAL_PATHS)
export type View = 'matches' | 'players' | 'bets' | 'plan' | 'friends' | 'settings' | 'admin' | 'account' | 'legal';
export type LegalPage = 'aviso-legal' | 'privacidad' | 'cookies';
export const LEGAL_PATHS: LegalPage[] = ['aviso-legal', 'privacidad', 'cookies'];

// app: el deporte; en las pantallas que no son de un deporte (plan, amigos, cuenta, ajustes, administración, legales) es el que
// se estaba viendo.
// match: el partido abierto. day: el día de la lista (AAAA-MM-DD; sin él, hoy), y en un partido, el día en cuya lista está,
// para encontrarlo al entrar por un enlace. param: el equipo de LoL en Jugadores o la página legal
export interface Route { app: Sport; view: View; match?: string; day?: string; param?: string }

const SPORT_SLUG: Record<Sport, string> = { lol: 'lol', basket: 'baloncesto', tennis: 'tenis', football: 'futbol', mma: 'mma' };
const SPORT_OF = Object.fromEntries(Object.entries(SPORT_SLUG).map(([k, v]) => [v, k])) as Record<string, Sport>;
// La segunda sección se llama distinto según el deporte, y la dirección dice lo mismo que el menú
const SECOND: Record<Sport, string> = { lol: 'jugadores', basket: 'jugadores', tennis: 'jugadores', football: 'clasificacion', mma: 'luchadores' };
const GLOBAL: Partial<Record<View, string>> = { plan: 'plan', friends: 'amigos', account: 'cuenta', settings: 'ajustes', admin: 'admin' };
const VIEW_OF = Object.fromEntries(Object.entries(GLOBAL).map(([k, v]) => [v, k])) as Record<string, View>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Días: los mismos que isoDay/today de components/sport.tsx (hora del equipo), repetidos aquí porque sport.tsx importa
// componentes que usan el contexto, y el contexto importa esto
const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// El día en España de una fecha ISO: es el de las listas de baloncesto, tenis, fútbol y MMA (sus servicios cuentan en esa hora)
export const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
// El día de una lista en la dirección: hoy no se escribe, para que /futbol sea siempre la de hoy
export const listDay = (d?: string) => (d && d !== localDay() ? d : undefined);

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
// Los ids de fútbol llevan dos puntos ("laliga:401234"): se dejan tal cual, que en un camino son válidos y se leen mejor
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':');

// De la dirección a la pantalla. fallback: el deporte para las pantallas que no lo llevan en la dirección. Lo que no se
// reconoce lleva a los partidos de ese deporte
export function parseRoute(pathname: string, search: string, fallback: Sport): Route {
  const seg = pathname.split('/').filter(Boolean).map(dec);
  const q = new URLSearchParams(search);
  const dia = q.get('dia');
  const day = dia && DAY.test(dia) ? dia : undefined;
  if (seg.length === 1 && (LEGAL_PATHS as string[]).includes(seg[0])) return { app: fallback, view: 'legal', param: seg[0] };
  // Surebets va dentro del plan, con su propia dirección (la de los avisos de surebets)
  if (seg.length === 1 && seg[0] === 'surebets') return { app: fallback, view: 'plan', param: 'surebets' };
  if (seg.length === 1 && VIEW_OF[seg[0]]) return { app: fallback, view: VIEW_OF[seg[0]] };
  const app = SPORT_OF[seg[0]];
  if (!app) return { app: fallback, view: 'matches' };
  const [, what, id] = seg;
  if (what === 'partido' && id) return { app, view: 'matches', match: id, ...(day ? { day } : {}) };
  // "jugadores" vale en todos los deportes (un enlace viejo o escrito a mano), y cada uno además el nombre de su menú
  if (what === SECOND[app] || what === 'jugadores') {
    const equipo = app === 'lol' ? q.get('equipo') : null;
    return { app, view: 'players', ...(equipo ? { param: equipo } : {}) };
  }
  if (what === 'apuestas') return { app, view: 'bets' };
  return { app, view: 'matches', ...(day && !what ? { day } : {}) };
}

// De la pantalla a la dirección (camino y ?búsqueda)
export function hrefOf(r: Route): string {
  if (r.view === 'legal') return `/${r.param && (LEGAL_PATHS as string[]).includes(r.param) ? r.param : 'aviso-legal'}`;
  if (r.view === 'plan' && r.param === 'surebets') return '/surebets';
  const global = GLOBAL[r.view];
  if (global) return `/${global}`;
  const base = `/${SPORT_SLUG[r.app]}`;
  if (r.view === 'players') return `${base}/${SECOND[r.app]}${r.app === 'lol' && r.param ? `?${new URLSearchParams({ equipo: r.param })}` : ''}`;
  if (r.view === 'bets') return `${base}/apuestas`;
  const dia = r.day ? `?dia=${r.day}` : '';
  return r.match ? `${base}/partido/${enc(r.match)}${dia}` : `${base}${dia}`;
}

const SPORT_NAME: Record<Sport, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };
const SECOND_NAME: Record<Sport, string> = { lol: 'Jugadores', basket: 'Jugadores', tennis: 'Jugadores', football: 'Clasificación', mma: 'Luchadores' };
const LEGAL_NAME: Record<LegalPage, string> = { 'aviso-legal': 'Aviso legal', privacidad: 'Privacidad', cookies: 'Cookies' };

// Título de la pestaña: es lo que sale en la lista que se abre manteniendo pulsado atrás
export function titleOf(r: Route): string {
  const page = r.view === 'legal' ? LEGAL_NAME[(r.param as LegalPage)] ?? LEGAL_NAME['aviso-legal']
    : r.view === 'friends' ? 'Amigos' : r.view === 'account' ? 'Tu cuenta' : r.view === 'settings' ? 'Ajustes'
      : r.view === 'plan' ? (r.param === 'surebets' ? 'Surebets' : 'Plan de apuestas') : r.view === 'admin' ? 'Administración'
      : `${SPORT_NAME[r.app]} · ${r.view === 'players' ? SECOND_NAME[r.app] : r.view === 'bets' ? 'Mis apuestas' : r.match ? (r.app === 'mma' ? 'Combate' : 'Partido') : r.app === 'mma' ? 'Combates' : 'Partidos'}`;
  return `${page} · Sharpex`;
}
