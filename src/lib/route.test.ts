// Direcciones de la app (src/lib/route.ts): de la dirección a la pantalla y vuelta, sin perder nada por el camino
import { describe, expect, it } from 'vitest';
import { hrefOf, listDay, localDay, madridDay, parseRoute, titleOf, type Route } from './route';

const parse = (href: string, fallback: Route['app'] = 'lol') => {
  const u = new URL(href, 'http://x');
  return parseRoute(u.pathname, u.search, fallback);
};
// Ida y vuelta: la dirección que sale de leer una dirección es la misma
const roundTrip = (href: string) => expect(hrefOf(parse(href))).toBe(href);

describe('parseRoute y hrefOf', () => {
  it('la lista de cada deporte, con y sin día', () => {
    for (const s of ['/lol', '/baloncesto', '/tenis', '/futbol', '/mma', '/futbol?dia=2026-11-20']) roundTrip(s);
    expect(parse('/baloncesto')).toEqual({ app: 'basket', view: 'matches' });
    expect(parse('/tenis?dia=2026-11-20')).toEqual({ app: 'tennis', view: 'matches', day: '2026-11-20' });
  });

  it('un partido, con su día y con los dos puntos de los ids de fútbol sin escapar', () => {
    roundTrip('/futbol/partido/laliga:401234?dia=2026-11-17');
    roundTrip('/mma/partido/600041234?dia=2026-11-22');
    expect(parse('/futbol/partido/laliga:401234?dia=2026-11-17')).toEqual({ app: 'football', view: 'matches', match: 'laliga:401234', day: '2026-11-17' });
    // Escapado también se entiende (un enlace pegado desde otro sitio)
    expect(parse('/futbol/partido/laliga%3A401234').match).toBe('laliga:401234');
  });

  it('un id con caracteres raros va escapado y vuelve igual', () => {
    const r: Route = { app: 'tennis', view: 'matches', match: 'atp/2026 x?y', day: '2026-11-17' };
    expect(parse(hrefOf(r))).toEqual(r);
  });

  it('la segunda sección se llama como en el menú, y "jugadores" vale en todos', () => {
    expect(hrefOf({ app: 'football', view: 'players' })).toBe('/futbol/clasificacion');
    expect(hrefOf({ app: 'mma', view: 'players' })).toBe('/mma/luchadores');
    expect(hrefOf({ app: 'tennis', view: 'players' })).toBe('/tenis/jugadores');
    expect(parse('/futbol/jugadores')).toEqual({ app: 'football', view: 'players' });
    expect(parse('/mma/luchadores')).toEqual({ app: 'mma', view: 'players' });
  });

  it('el equipo de LoL en Jugadores va en ?equipo=, con su "|"', () => {
    const r: Route = { app: 'lol', view: 'players', param: 'G2 Esports|G2' };
    expect(parse(hrefOf(r))).toEqual(r);
    // En los demás deportes no se usa
    expect(parse('/tenis/jugadores?equipo=x')).toEqual({ app: 'tennis', view: 'players' });
  });

  it('apuestas van con el deporte; plan, amigos, cuenta, ajustes y administración no, y conservan el que se veía', () => {
    roundTrip('/futbol/apuestas');
    for (const s of ['/plan', '/amigos', '/cuenta', '/ajustes', '/admin']) roundTrip(s);
    expect(parse('/amigos', 'mma')).toEqual({ app: 'mma', view: 'friends' });
    expect(parse('/plan', 'basket')).toEqual({ app: 'basket', view: 'plan' });
    expect(titleOf({ app: 'lol', view: 'admin' })).toBe('Administración · Sharpex');
    expect(hrefOf({ app: 'tennis', view: 'account' })).toBe('/cuenta');
  });

  it('las páginas legales siguen en su dirección de siempre', () => {
    for (const s of ['/aviso-legal', '/privacidad', '/cookies']) roundTrip(s);
    expect(parse('/privacidad', 'basket')).toEqual({ app: 'basket', view: 'legal', param: 'privacidad' });
  });

  it('la raíz y lo que no se reconoce llevan a los partidos del deporte guardado', () => {
    expect(parse('/', 'football')).toEqual({ app: 'football', view: 'matches' });
    expect(parse('/no-existe', 'tennis')).toEqual({ app: 'tennis', view: 'matches' });
    expect(parse('/futbol/no-existe?dia=2026-11-20')).toEqual({ app: 'football', view: 'matches' });
    expect(parse('/futbol/partido')).toEqual({ app: 'football', view: 'matches' });
  });

  it('un ?dia= mal escrito se ignora', () => {
    expect(parse('/futbol?dia=mañana')).toEqual({ app: 'football', view: 'matches' });
    expect(parse('/futbol/partido/laliga:1?dia=2026-1-1')).toEqual({ app: 'football', view: 'matches', match: 'laliga:1' });
  });
});

describe('días', () => {
  it('hoy no se escribe en la dirección de la lista', () => {
    expect(listDay(localDay())).toBeUndefined();
    expect(listDay(undefined)).toBeUndefined();
    expect(listDay('2020-01-01')).toBe('2020-01-01');
  });
  it('el día en España de una hora UTC de madrugada es el siguiente', () => {
    expect(madridDay('2026-11-17T23:30:00Z')).toBe('2026-11-18');
    expect(madridDay('2026-07-01T21:59:00Z')).toBe('2026-07-01');
  });
});

describe('titleOf', () => {
  it('dice el deporte y la pantalla', () => {
    expect(titleOf({ app: 'football', view: 'matches' })).toBe('Fútbol · Partidos · Sharpex');
    expect(titleOf({ app: 'mma', view: 'matches', match: '1' })).toBe('MMA · Combate · Sharpex');
    expect(titleOf({ app: 'mma', view: 'matches' })).toBe('MMA · Combates · Sharpex');
    expect(titleOf({ app: 'football', view: 'players' })).toBe('Fútbol · Clasificación · Sharpex');
    expect(titleOf({ app: 'lol', view: 'friends' })).toBe('Amigos · Sharpex');
    expect(titleOf({ app: 'lol', view: 'legal', param: 'cookies' })).toBe('Cookies · Sharpex');
  });
});
