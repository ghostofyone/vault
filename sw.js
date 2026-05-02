// sw.js - Cache Killer
// This Service Worker is designed to DELETE all existing caches to fix the 404/ghost file issues.
const CACHE_NAME = 'vault-cache-kill-v1';

self.addEventListener('install', (event) => {
    // Skip waiting to activate immediately
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Aggressively delete ALL caches to clear any stale 'index.html' references
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Deleting cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            // Claim clients to take control immediately
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Do NOTHING for fetch. Network Only.
    // This ensures we always get the fresh files from the server.
    return;
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.indexOf(self.registration.scope) !== -1 && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(self.registration.scope);
            }
        })
    );
});
