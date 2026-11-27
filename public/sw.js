// Оффлайн: оболочка приложения, последние объявления и уже виденные фото.
const VERSION = 'v11';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const PHOTOS = `photos-${VERSION}`;
const FILES = [
  '/', '/css/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/api.js', '/js/catalog.js', '/js/i18n.js', '/js/icons.js', '/js/images.js', '/js/auth.js', '/js/reviews.js', '/js/unread.js', '/js/viewer.js', '/js/store.js', '/js/ui.js',
  '/js/header.js', '/js/footer.js', '/js/pages/seller.js', '/js/pages/home.js', '/js/pages/search.js', '/js/pages/item.js', '/js/pages/post.js', '/js/pages/fav.js', '/js/pages/me.js', '/js/pages/rules.js', '/js/pages/chats.js', '/js/pages/chat.js', '/js/pages/admin.js',
  '/fonts/manrope-cyrillic-wght-normal.woff2', '/fonts/manrope-cyrillic-ext-wght-normal.woff2', '/fonts/manrope-latin-wght-normal.woff2', '/fonts/manrope-latin-ext-wght-normal.woff2',
  '/icons/icon.svg', '/icons/ghost.svg', '/icons/icon-192.png',
  ...['clothes', 'phones', 'electronics', 'transport', 'realty', 'kids', 'home_garden', 'beauty', 'hobby', 'repair', 'animals', 'services', 'jobs', 'other'].map((id) => `/img/cat/${id}.svg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, PHOTOS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function networkFirst(request, name, key = request) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(PHOTOS);
  const saved = await cache.match(request);
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    trim(PHOTOS, 200);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/p/')) return e.respondWith(cacheFirst(request));
  // Кешируем только публичную ленту — личные данные и контакты не сохраняем.
  if (url.pathname === '/api/listings' || url.pathname === '/api/config') {
    return e.respondWith(networkFirst(request, DATA).finally(() => trim(DATA, 40)));
  }
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    return e.respondWith(
      fetch(request).catch(async () => (await caches.match('/', { cacheName: SHELL })) || Response.error())
    );
  }
  e.respondWith(networkFirst(request, SHELL));
});
