// Notificaciones con la app cerrada (Web Push): el navegador se suscribe con la clave pública del servidor y le pasa la
// suscripción (/api/alerts/push); el servidor manda ahí los avisos de cuotas (server/services/bets/push.js) y public/sw.js los
// enseña. Hace falta https (o 127.0.0.1) y, en el iPhone, tener Sharpex añadida a la pantalla de inicio.

export type PushState = 'unsupported' | 'denied' | 'on' | 'off';

export const pushSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// En el iPhone sólo funciona con la app instalada (Compartir → Añadir a pantalla de inicio)
export const isIosBrowser = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

const register = () => navigator.serviceWorker.register('/sw.js');

function keyBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
  } catch { return 'off'; }
}

export async function enablePush(publicKey: string) {
  if (!pushSupported()) throw new Error('Este navegador no deja recibir avisos con la app cerrada');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No has dado permiso para los avisos');
  const reg = await register();
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await window.api.alerts.subscribe(sub.toJSON());
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await window.api.alerts.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

// Al entrar con otro usuario en el mismo navegador, la suscripción que haya pasa a ser suya (el servidor la reasigna)
export async function resyncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await window.api.alerts.subscribe(sub.toJSON()).catch(() => {});
}
