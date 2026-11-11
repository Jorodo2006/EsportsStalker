// Avisos del navegador: apuestas resueltas solas, recomendaciones muy buenas y bajas en apuestas pendientes. Lo que se
// quiere recibir es de cada navegador (localStorage). El navegador sólo deja avisar en un sitio seguro (https, o
// 127.0.0.1 / localhost): desde el móvil por la IP de casa no se puede, y entonces el aviso sale dentro de la app.

export type AlertKind = 'settled' | 'picks' | 'injuries';
export type AlertPrefs = Record<AlertKind, boolean>;
const KEY = 'avisos';
const NONE: AlertPrefs = { settled: false, picks: false, injuries: false };

export function alertPrefs(): AlertPrefs {
  try { return { ...NONE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return NONE; }
}
export function setAlertPrefs(p: AlertPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event('avisos'));
}

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
export const notifyPermission = (): NotificationPermission | 'unsupported' => (canNotify() ? Notification.permission : 'unsupported');
export async function askPermission() {
  if (!canNotify()) return 'unsupported' as const;
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

// Lo ya avisado (para no repetir al recargar), con fecha para olvidarlo a los 4 días
function seen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem('avisos-vistos') || '{}'); } catch { return {}; }
}
export function firstTime(id: string) {
  const s = seen();
  if (s[id]) return false;
  const now = Date.now();
  for (const [k, t] of Object.entries(s)) if (now - t > 4 * 864e5) delete s[k];
  s[id] = now;
  try { localStorage.setItem('avisos-vistos', JSON.stringify(s)); } catch { /* sin almacenamiento */ }
  return true;
}

// fallback: el aviso de dentro de la app (el toast) cuando el navegador no deja
let fallback: ((msg: string) => void) | null = null;
export const setAlertFallback = (f: ((msg: string) => void) | null) => { fallback = f; };

export function alert(kind: AlertKind, title: string, body: string, tag?: string) {
  if (!alertPrefs()[kind]) return;
  if (canNotify() && Notification.permission === 'granted') {
    try { new Notification(title, { body, tag }); return; } catch { /* algunos móviles sólo dejan desde un service worker */ }
  }
  fallback?.(`${title}: ${body}`);
}
