// Service worker de Sharpex: sólo para las notificaciones, las de los avisos de cuotas con la app cerrada (server/services/bets/push.js)
// y las de los avisos del navegador (src/lib/notify.ts), que en el móvil sólo pueden salir desde aquí.
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

// Al pulsarla se va a lo que avisa. La dirección ya es la del partido (/futbol/partido/…?dia=…&aviso=<id>, urlOf en
// server/services/bets/alerts.js). Si la app está abierta en alguna pestaña (mejor la que se ve), se le pasa por mensaje y se pone
// delante: la app abre el partido sin recargar (navegar la pestaña falla si no la controla este service worker, p. ej. tras
// recargar con Ctrl+Mayús+R, y entonces sólo se ponía delante). Si no hay ninguna, se abre en esa dirección
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin);
  const id = url.searchParams.get('aviso');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
    const list = all.filter(c => new URL(c.url).origin === self.location.origin);
    const open = list.find(c => c.focused) || list.find(c => c.visibilityState === 'visible') || list[0];
    if (open && id) { open.postMessage({ type: 'aviso', id, path: url.pathname + url.search }); return open.focus(); }
    if (open) return open.navigate(url.href).then(c => (c || open).focus()).catch(() => open.focus());
    return self.clients.openWindow(url.href);
  }));
});
