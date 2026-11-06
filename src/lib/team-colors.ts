// Colores de cada equipo para los rótulos: ESPN da los de la NBA y la WNBA, y los de la Euroliga y la EuroCup salen de su escudo
// (server/services/basket/colors.js). No se usan tal cual: sobre ellos van letras blancas y cifras sobre fondo oscuro, y hay que poder
// leerlos con cualquier equipo. Sin colores, los rótulos se quedan con los de la app.
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BasketLeagueId, BasketTeamColor } from './types';

type RGB = [number, number, number];
const parse = (s?: string | null): RGB | null => { const m = /^#?([0-9a-f]{6})$/i.exec(s || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) as RGB : null; };
const toHex = (c: RGB) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t) as RGB;
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [0, 0, 0];
// Luminancia y contraste de las WCAG
const lum = (c: RGB) => { const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const darken = (c: RGB, min: number) => { let x = c; for (let t = 0; t < 40 && contrast(x, WHITE) < min; t++) x = mix(x, BLACK, 0.05); return x; };
const lighten = (c: RGB, min: number) => { let x = c; for (let t = 0; t < 40 && contrast(x, BLACK) < min; t++) x = mix(x, WHITE, 0.08); return x; };
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// plate: el escudo es casi negro y no tiene nada claro, y sobre su propia banda no se vería: necesita una placa clara detrás
export interface TeamTheme { band: string; band2: string; mark: string; glow: string; plate: boolean; vars: CSSProperties }

const TEXT_ON_BAND = 5; // letras blancas pequeñas sobre la banda
const MARK_ON_DARK = 6; // cifras y líneas sobre el fondo oscuro, y letras negras sobre la línea. Más alto, descarta colores que se ven bien (el naranja de los Suns)

export function teamTheme(c?: BasketTeamColor | null): TeamTheme | null {
  const main = parse(c?.color);
  if (!main) return null;
  const second = parse(c?.alt);
  // Un color muy claro no aguanta letras blancas, y oscurecerlo deja un amarillo marrón: si el otro es oscuro, va él de banda
  const swap = lum(main) > 0.35 && !!second && lum(second) < lum(main) * 0.6;
  const base = swap ? second : main, accent = swap ? main : second;
  const band = darken(base, TEXT_ON_BAND), band2 = mix(band, BLACK, 0.4);
  // La línea y las cifras: el otro color del equipo si se ve bien y no se confunde con la banda; si no, el suyo aclarado
  const mark = accent && contrast(accent, BLACK) >= MARK_ON_DARK && dist(accent, band) > 90 ? accent : lighten(base, MARK_ON_DARK);
  // Un equipo negro no se notaría sobre el fondo oscuro
  const glow = lum(band) < 0.02 ? mix(band, WHITE, 0.28) : band;
  const [b, b2, m, g] = [band, band2, mark, glow].map(toHex);
  return {
    band: b, band2: b2, mark: m, glow: g, plate: lum(band) < 0.02 && !second,
    vars: {
      '--tv-band': b, '--tv-band-2': b2, '--tv-mark': m, '--tv-glow': g,
      // Las barras de la ficha también
      '--color-amber-300': m, '--color-amber-400': m, '--color-amber-500': m
    } as CSSProperties
  };
}

// Casi nunca cambian: una vez por día es de sobra
export function useTeamThemes(league: BasketLeagueId) {
  const q = useQuery({ queryKey: ['basket', 'colors', league], queryFn: () => window.api.basket.colors(league), staleTime: 24 * 3600e3, retry: false });
  return (teamId?: string | null) => (teamId ? teamTheme(q.data?.[teamId]) : null);
}
