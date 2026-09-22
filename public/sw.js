// Service worker — makes the app installable and keeps the shell usable offline.
// Business data still needs a connection: Supabase requests are never cached.

const VERSION = 'np-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`

// Precache only what is guaranteed to exist; hashed build assets are cached on demand.
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_URLS))
      .catch(() => undefined)      // a missing file must not block installation
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// Let the page trigger an immediate update
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never touch API traffic — Supabase, Anthropic, auth. These must always be live.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/rest')) return

  // Navigations: network first so deploys land immediately, cache as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone()
          caches.open(SHELL).then(c => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then(r => r ?? Response.error()))
    )
    return
  }

  // Build assets are content-hashed, so cache-first is safe and fast.
  event.respondWith(
    caches.match(request).then(hit => hit ?? fetch(request).then(res => {
      if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?|css|js)$/.test(url.pathname))) {
        const copy = res.clone()
        caches.open(ASSETS).then(c => c.put(request, copy))
      }
      return res
    }))
  )
})
