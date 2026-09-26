// Offline support: keep a copy of the app so it works with no signal.
// Your bankroll, tickets and the racing world live in localStorage, not here.
// Network first, so a new version shows up as soon as you're online.

const CACHE = 'post-time-v1'; // bump the number when the file list changes (npm test checks the list)
const SHELL = [
  './', 'index.html', 'icon.svg', 'icon-192.png', 'manifest.webmanifest',
  'css/app.css',
  'fonts/oswald.woff2', 'fonts/plex-condensed-400-italic.woff2', 'fonts/plex-condensed-400.woff2',
  'fonts/plex-condensed-600.woff2',
  'js/app.js', 'js/audio.js', 'js/call.js', 'js/chart.js', 'js/data.js', 'js/forum.js', 'js/game.js',
  'js/handicap.js', 'js/rng.js', 'js/sim.js', 'js/tote.js', 'js/track.js', 'js/world.js',
  'js/draw/circle.js', 'js/draw/horse.js', 'js/draw/photo.js', 'js/draw/scene.js',
  'js/ui/book.js', 'js/ui/card.js', 'js/ui/dom.js', 'js/ui/race.js', 'js/ui/results.js', 'js/ui/watch.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fresh(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});

// GitHub Pages lets browsers keep files for ten minutes, so without this an update can take that long to show up.
// Ask the server every time instead; a file that hasn't changed comes back as a quick "not modified".
function fresh(request) {
  const got = request.mode === 'navigate'
    // A page load can't be answered with a redirected response, so fall back to the plain request if there was one.
    ? fetch(request.url, { cache: 'no-cache' }).then(res => (res.redirected ? fetch(request) : res))
    : fetch(request, { cache: 'no-cache' });
  return got.then(askAgainNextTime);
}

// The open tab keeps its own copy of each file too, and would reuse it on a reload without asking.
// Marking the copy it gets from here no-cache sends that reload back through fresh() as well.
function askAgainNextTime(res) {
  if (res.status !== 200 || res.type !== 'basic' || res.redirected) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  headers.delete('content-encoding'); // the body here is already unpacked
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
