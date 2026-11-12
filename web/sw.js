// Service worker do Chalkmark: abre o app sem sinal (ginásio!) e mostra as notificações.
// A versão do cache é trocada no build pelo nome do JS do app; mudou o build, muda o cache.
const CACHE = 'chalkmark-__VERSION__';

self.addEventListener('install', (e) => {
  // Guarda a casca do app; o resto entra no cache conforme é usado.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chalkmark-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // API, fotos (outro domínio) e escrita: sempre pela rede.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Assets com hash no nome (e modelo/runtime versionados): cache primeiro, nunca mudam.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Páginas e config: rede primeiro (versão nova), cache se estiver sem sinal.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((hit) => hit ?? Response.error())));
});

// ---------- notificações ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  // O iPhone exige mostrar uma notificação para cada push recebido.
  e.waitUntil(self.registration.showNotification(d.title || 'Chalkmark', {
    body: d.body || '',
    icon: '/icon-180.png',
    badge: '/icon-180.png',
    tag: d.tag || 'chalkmark',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((x) => x.url.startsWith(location.origin));
    if (w) { w.navigate(target).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
