// Keeps Sky2Root working without a connection once it has been opened. Always tries the network first, so a
// new version shows up at once; falls back on the last copy. NASA data is cached separately by the app ("s2r-data").
const SHELL = "s2r-shell-6";
const CROPS = ["maize", "sorghum", "millet", "rice", "wheat", "winterWheat", "barley", "soybean", "cowpea", "bean", "groundnut", "chickpea", "lentil", "sunflower", "sesame", "mustard", "potato", "coverWarm", "coverCool"];
const FILES = ["./", "index.html", "css/app.css", "css/archivo-latin.woff2", "js/i18n.js", "js/engine.js", "js/nasa.js", "js/explain.js", "js/season-view.js", "js/app.js", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/images/marker-shadow.png", "data/cmip6-deltas.bin", "data/soil-grid.bin.gz", "data/country-crops.json", "data/enso.json", "data/crop-photos.json", "fields/index.json", "manifest.webmanifest", "img/icon-192.png", "img/icon-512.png", ...CROPS.map((id) => `img/crops/${id}.webp`)];

self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => Promise.allSettled(FILES.map((f) => c.add(f))))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("s2r-shell-") && k !== SHELL).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(url.origin + url.pathname, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }))); // ?field=...&screen=... is still the same page
});
