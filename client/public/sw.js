// TradeGateway NGSWTP — Service Worker v3
// v56: Cache-busting on deployment — SKIP_WAITING message handler + bumped cache version

const CACHE_NAME = 'tradegateway-v4';
const OFFLINE_QUEUE_NAME = 'tradegateway-offline-queue';
const STATIC_ASSETS = [
  '/manifest.json',
  '/offline.html',
  '/icon-192.png',
  // Note: index.html is intentionally excluded — always fetched from network
];

// Install: cache static assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up all old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_QUEUE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── MESSAGE (SKIP_WAITING for instant activation on deployment) ─────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // ── Offline queue for tRPC mutations (POST to /api/trpc) ─────────────────
  if (request.method === 'POST' && url.pathname.startsWith('/api/trpc')) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        const body = await request.clone().text();
        const queuedRequest = {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body,
          queuedAt: Date.now(),
        };
        const cache = await caches.open(OFFLINE_QUEUE_NAME);
        const key = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await cache.put(
          new Request(key),
          new Response(JSON.stringify(queuedRequest), { headers: { 'Content-Type': 'application/json' } })
        );
        if ('sync' in self.registration) {
          await self.registration.sync.register('trpc-offline-queue');
        }
        await broadcastQueueCount();
        return new Response(
          JSON.stringify({ error: { message: 'OFFLINE_QUEUED', code: 'OFFLINE' } }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': 'true' } }
        );
      })
    );
    return;
  }

  // Skip non-GET requests from here
  if (request.method !== 'GET') return;

  // ── HTML navigation: always network-first, never serve stale HTML ─────────
  // This is the core cache-busting behaviour — HTML is never cached by the SW
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline fallback only — serve the honest offline page
        return caches.match('/offline.html');
      })
    );
    return;
  }

  // ── Hashed static assets (JS/CSS/fonts/images): cache-first ─────────────
  // Vite uses content-hash filenames so these are safe to cache indefinitely
  if (url.pathname.match(/\.(js|css|woff2?|png|svg|ico|webp)$/) &&
      (url.pathname.includes('/assets/') || url.pathname.match(/\.[a-f0-9]{8,}\./))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Everything else (incl. GET /api/trpc): network-first, stale-flagged cache fallback
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (!cached) return Response.json(
        { error: { message: 'OFFLINE', code: 'OFFLINE' } },
        { status: 503, headers: { 'X-SW-Offline': 'true' } }
      );
      // Badge cached data as stale so the UI can disclose it honestly
      const headers = new Headers(cached.headers);
      headers.set('X-SW-Stale', 'true');
      headers.set('X-SW-Stale-Since', cached.headers.get('date') || 'unknown');
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    })
  );
});

async function broadcastQueueCount() {
  try {
    const cache = await caches.open(OFFLINE_QUEUE_NAME);
    const keys = await cache.keys();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type: 'SW_QUEUE_COUNT', count: keys.length });
  } catch { /* best-effort */ }
}

// ─── BACKGROUND SYNC ─────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'trpc-offline-queue') {
    event.waitUntil(replayOfflineQueue());
  }
});

async function replayOfflineQueue() {
  const cache = await caches.open(OFFLINE_QUEUE_NAME);
  const keys = await cache.keys();
  let replayed = 0, failed = 0;
  for (const key of keys) {
    const response = await cache.match(key);
    if (!response) continue;
    let queued;
    try { queued = await response.json(); } catch { await cache.delete(key); continue; }
    if (Date.now() - queued.queuedAt > 24 * 60 * 60 * 1000) { await cache.delete(key); continue; }
    try {
      const r = await fetch(queued.url, {
        method: queued.method,
        headers: { ...queued.headers, 'X-Offline-Replay': 'true' },
        body: queued.body,
        credentials: 'include',
      });
      if (r.ok || r.status < 500) { await cache.delete(key); replayed++; } else { failed++; }
    } catch { failed++; }
  }
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage({ type: 'OFFLINE_QUEUE_REPLAYED', replayed, failed });
  await broadcastQueueCount();
}

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'TradeGateway', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'TradeGateway', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'tradegateway-notification',
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
