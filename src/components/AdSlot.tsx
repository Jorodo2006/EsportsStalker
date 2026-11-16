// Hueco para un anuncio con un tamaño estándar de Google AdSense. Con la cuenta y el bloque de anuncios en el .env del
// servidor (ADSENSE_CLIENT, ADSENSE_SLOT_RECT, ADSENSE_SLOT_HALF) es el <ins class="adsbygoogle"> de ese bloque; sin ellos,
// en desarrollo, el marcador con su tamaño, y en producción nada. El tamaño es fijo para que la página no salte al llegar
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/format';
import { fillAd, loadAdsense, usePublicConfig } from '@/lib/ads';

export type AdSize = 'rect' | 'half' | 'banner' | 'mobile';
const SIZES: Record<AdSize, { w: number; h: number }> = {
  rect: { w: 300, h: 250 }, // rectángulo mediano
  half: { w: 300, h: 600 }, // media página
  banner: { w: 728, h: 90 }, // banner horizontal
  mobile: { w: 320, h: 100 } // banner grande del móvil
};

export function AdSlot({ size, className }: { size: AdSize; className?: string }) {
  const { w, h } = SIZES[size];
  const cfg = usePublicConfig();
  const ads = cfg.data?.ads;
  const slot = ads && (size === 'rect' || size === 'half') ? ads.slots[size] : null;
  const ins = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!ads || !slot || !ins.current) return;
    loadAdsense(ads.client);
    // Una sola vez por hueco (en desarrollo React monta dos veces y AdSense da error si se le pide otra)
    if (ins.current.dataset.adsbygoogleStatus || ins.current.dataset.pedido) return;
    ins.current.dataset.pedido = '1';
    try { fillAd(); } catch { /* sin anuncio: el hueco se queda vacío */ }
  }, [ads, slot]);

  if (ads && slot) {
    return (
      <aside aria-label="Publicidad" style={{ width: w, minHeight: h }} className={cn('mx-auto max-w-full shrink-0 overflow-hidden', className)}>
        <ins ref={ins} className="adsbygoogle" style={{ display: 'inline-block', width: w, height: h }} data-ad-client={ads.client} data-ad-slot={slot} />
      </aside>
    );
  }
  if (!import.meta.env.DEV) return null;
  return (
    <aside aria-label="Publicidad" style={{ width: w, height: h }}
      className={cn('mx-auto flex max-w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-800 text-zinc-600', className)}>
      <span className="text-[11px] font-medium">Publicidad</span>
      <span className="text-[11px] tnum">{w} × {h}</span>
    </aside>
  );
}
