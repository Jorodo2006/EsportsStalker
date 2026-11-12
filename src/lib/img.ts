// Imágenes de ESPN (escudos, banderas, fotos de jugadores) a su tamaño. El original es de 500 px y pesa 30–60 KB; el
// redimensionador de ESPN (combiner, que mantiene la transparencia y, con sólo el ancho, la proporción) lo da a 64 px en
// 2–5 KB. Los escudos de la Euroliga y la EuroCup (incrowdsports y cortextech) pesan hasta 130 KB y sus CDN también los
// redimensionan con ?width= (unos 8 KB). Se pide al doble de lo que se pinta (pantallas de alta densidad) y redondeado a pocos
// anchos, para que el navegador y la CDN reaprovechen las mismas. Las de lolesports no tienen redimensionador y van tal cual.
import type { SyntheticEvent } from 'react';

const WIDTHS = [40, 64, 96, 160, 320];
const ESPN = /^https?:\/\/a\.espncdn\.com(\/i\/[^?#]+\.(?:png|jpe?g))$/i;
const WIDTH_CDN = /^https:\/\/media-cdn\.(?:incrowdsports\.com|cortextech\.io)\/[^?#]+\.(?:png|jpe?g)$/i;

export function sized(src: string | null | undefined, px: number): string | undefined {
  if (!src) return undefined;
  const w = WIDTHS.find(x => x >= px * 2);
  if (!w) return src;
  const m = ESPN.exec(src);
  if (m) return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${w}`;
  return WIDTH_CDN.test(src) ? `${src}?width=${w}` : src;
}

// Si el redimensionador falla, se prueba con la original (una sola vez)
export const fallbackTo = (src: string | null | undefined) => (e: SyntheticEvent<HTMLImageElement>) => {
  const t = e.currentTarget;
  if (src && t.src !== src) t.src = src;
};
