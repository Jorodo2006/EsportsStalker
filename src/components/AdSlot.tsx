// Hueco para un anuncio con un tamaño estándar de Google AdSense. De momento es sólo el marcador: cuando haya cuenta, aquí va
// el <ins class="adsbygoogle"> con su data-ad-slot. El tamaño es fijo para que la página no salte cuando llegue el anuncio
import { cn } from '@/lib/format';

export type AdSize = 'rect' | 'half' | 'banner' | 'mobile';
const SIZES: Record<AdSize, { w: number; h: number }> = {
  rect: { w: 300, h: 250 }, // rectángulo mediano
  half: { w: 300, h: 600 }, // media página
  banner: { w: 728, h: 90 }, // banner horizontal
  mobile: { w: 320, h: 100 } // banner grande del móvil
};

export function AdSlot({ size, className }: { size: AdSize; className?: string }) {
  const { w, h } = SIZES[size];
  return (
    <aside aria-label="Publicidad" style={{ width: w, height: h }}
      className={cn('mx-auto flex max-w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-800 text-zinc-600', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider">Publicidad</span>
      <span className="text-[11px] tnum">{w} × {h}</span>
    </aside>
  );
}
