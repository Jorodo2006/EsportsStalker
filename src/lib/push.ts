// Notificaciones con la app cerrada (Web Push): el navegador se suscribe con la clave pública del servidor y le pasa la
// suscripción (/api/alerts/push); el servidor manda ahí los avisos de cuotas (server/services/bets/push.js) y public/sw.js los
// enseña. Hace falta https (o 127.0.0.1) y, en el iPhone, tener Sharpex añadida a la pantalla de inicio.

import type { PushTestResult } from './types';

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

// ¿Se hizo esta suscripción con la clave que usa ahora el servidor? Si la clave cambió (otra base de datos, claves nuevas en el
// .env), el servicio de push rechaza todo lo que se le mande a ella, pero el navegador la sigue dando por buena y el interruptor sale
// encendido. Si el navegador no dice con qué clave se hizo, se da por buena
export function sameKey(sub: Pick<PushSubscription, 'options'>, publicKey: string) {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Una suscripción nueva, tirando la que hubiera: el servicio de push da otro endpoint
async function renew(reg: ServiceWorkerRegistration, publicKey: string, old?: PushSubscription | null) {
  if (old) {
    await window.api.alerts.unsubscribe(old.endpoint).catch(() => {});
    await old.unsubscribe().catch(() => false);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

// La que hay si vale; si se hizo con otra clave, una nueva
async function currentSub(reg: ServiceWorkerRegistration, publicKey: string) {
  const sub = await reg.pushManager.getSubscription();
  return sub && sameKey(sub, publicKey) ? sub : renew(reg, publicKey, sub);
}

export async function enablePush(publicKey: string) {
  if (!pushSupported()) throw new Error('Este navegador no deja recibir avisos con la app cerrada');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No has dado permiso para los avisos');
  const reg = await register();
  await navigator.serviceWorker.ready;
  const sub = await currentSub(reg, publicKey);
  await window.api.alerts.subscribe(sub.toJSON());
}

// Prueba de Tu cuenta: manda un aviso sólo a este dispositivo y, si su servicio de push lo rechaza o el servidor no lo tenía
// apuntado, rehace la suscripción y prueba otra vez. repaired: se rehizo; null: este dispositivo no está suscrito
export async function testPush(publicKey: string): Promise<(PushTestResult & { repaired: boolean; host: string }) | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  let sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return null;
  let repaired = false;
  if (!sameKey(sub, publicKey)) { sub = await renew(reg, publicKey, sub); repaired = true; }
  // Que el servidor la tenga, y a nombre de quien está aquí
  await window.api.alerts.subscribe(sub.toJSON());
  let r = await window.api.alerts.testPush(sub.endpoint);
  // Rechazada (caducada, otra clave, un token que Apple ya no reconoce): una nueva. Un 429 o un 5xx es del servicio, no de la suscripción
  if (!r.ok && !repaired && (r.missing || r.gone || (r.status != null && r.status >= 400 && r.status < 500 && r.status !== 429))) {
    sub = await renew(reg, publicKey, sub);
    repaired = true;
    await window.api.alerts.subscribe(sub.toJSON());
    await new Promise(res => setTimeout(res, 10_000)); // el servidor no deja probar dos veces en 10 s
    r = await window.api.alerts.testPush(sub.endpoint);
  }
  let host = '';
  try { host = new URL(sub.endpoint).hostname; } catch { /* sin dirección */ }
  return { ...r, repaired, host };
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await window.api.alerts.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

// Al entrar con otro usuario en el mismo navegador, la suscripción que haya pasa a ser suya (el servidor la reasigna). Si se hizo con
// otra clave, se rehace (con el permiso ya dado no hace falta tocar nada; si el navegador no deja, se queda como estaba y la prueba
// de Tu cuenta lo arregla)
export async function resyncPush(publicKey?: string | null) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  let sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return;
  if (publicKey && !sameKey(sub, publicKey)) sub = await renew(reg, publicKey, sub).catch(() => sub);
  if (sub) await window.api.alerts.subscribe(sub.toJSON()).catch(() => {});
}
