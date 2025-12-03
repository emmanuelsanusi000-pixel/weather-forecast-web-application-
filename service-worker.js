const CACHE_NAME = 'weather-app-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js'
];
const WEATHER_CACHE = 'weather-data-v1';
const WEATHER_MAX_AGE = 10 * 60 * 1000; // 10 minutes

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== WEATHER_CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Weather API requests
  if (url.includes('/data/2.5/') || url.includes('weatherapi.com')) {
    event.respondWith(
      caches.open(WEATHER_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Check age
          const dateHeader = cached.headers.get('sw-fetched-at');
          const fetchedAt = dateHeader ? parseInt(dateHeader, 10) : 0;
          if (Date.now() - fetchedAt < WEATHER_MAX_AGE) {
            return cached;
          }
        }
        // Fetch fresh
        try {
          const response = await fetch(event.request);
          // Clone and add custom header for timestamp
          const headers = new Headers(response.headers);
          headers.append('sw-fetched-at', Date.now().toString());
          const body = await response.clone().blob();
          const newResponse = new Response(body, { status: response.status, statusText: response.statusText, headers });
          cache.put(event.request, newResponse.clone());
          return newResponse;
        } catch (e) {
          // Network failed, fallback to cache
          if (cached) return cached;
          return caches.match('/offline.html');
        }
      })
    );
    return;
  }
  // Navigation requests (HTML pages)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // If we get a valid response, return it
          return response;
        })
        .catch(() => {
          // If fetch fails, return offline.html
          return caches.match('/offline.html');
        })
    );
    return;
  }
  // App shell and other requests
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
}); 