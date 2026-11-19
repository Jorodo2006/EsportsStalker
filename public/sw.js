// Service worker de Sharpex: sólo para las notificaciones con la app cerrada (avisos de cuotas, server/services/bets/push.js).
// No guarda nada en caché a propósito: la web se sirve siempre del servidor, y así nunca se queda una versión vieja.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Sharpex', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Sharpex', {
    body: d.body || '', tag: d.tag, icon: '/icon-192.png', badge: '/favicon-32.png', data: { url: d.url || '/' }
  }));
});

// Al pulsarla se va a lo que avisa. Si la app está abierta en alguna pestaña, se le pasa el aviso por mensaje y se pone delante: la
// app abre su partido sin recargar (navegar la pestaña falla si no la controla este service worker, p. ej. tras recargar con
// Ctrl+Mayús+R, y entonces sólo se ponía delante). Si no hay ninguna, se abre con ?aviso=<id>, que la app lee al arrancar
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin);
  const id = url.searchParams.get('aviso');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === self.location.origin);
    if (open && id) { open.postMessage({ type: 'aviso', id }); return open.focus(); }
    if (open) return open.navigate(url.href).then(c => (c || open).focus()).catch(() => open.focus());
    return self.clients.openWindow(url.href);
  }));
});
