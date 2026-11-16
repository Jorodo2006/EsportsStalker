// Anuncios de Google AdSense. La cuenta (ca-pub-…) y los huecos salen del .env del servidor (/api/public/config): sin
// ADSENSE_CLIENT no se carga nada de Google. El aviso de cookies es el de Google (Privacidad y mensajes, en la cuenta de
// AdSense), que viene con su script: no hay otro banner. La CSP de nginx deja cargarlo (web/cabeceras.conf).
import { useQuery } from '@tanstack/react-query';

export const usePublicConfig = () => useQuery({ queryKey: ['public-config'], queryFn: () => window.api.publicConfig(), staleTime: Infinity, retry: 1 });

type GoogleWindow = Window & {
  adsbygoogle?: unknown[];
  googlefc?: { callbackQueue?: (() => void)[]; showRevocationMessage?: () => void };
};
const w = () => window as GoogleWindow;

let loaded = false;
export function loadAdsense(client: string) {
  if (loaded) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  // El nonce de la página (lo pone nginx en cada <script>): con 'strict-dynamic' no haría falta, pero así vale en todos
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  if (nonce) s.nonce = nonce;
  document.head.appendChild(s);
}

// Pide a Google un anuncio para un <ins class="adsbygoogle"> recién puesto
export function fillAd() {
  const g = w();
  (g.adsbygoogle = g.adsbygoogle || []).push({});
}

// Vuelve a abrir el aviso de cookies de Google para cambiar la elección (lo pide el RGPD: retirarlo tan fácil como darlo)
export function openCookieSettings() {
  const g = w();
  g.googlefc = g.googlefc || {};
  g.googlefc.callbackQueue = g.googlefc.callbackQueue || [];
  g.googlefc.callbackQueue.push(() => g.googlefc?.showRevocationMessage?.());
}
