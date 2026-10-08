// sw.js — Service Worker بسيط: network-first مع احتياط من الكاش (ما كيخبّي حتى شي من Firebase/Firestore)
const CACHE = "wajbatna-v2";
const SHELL = ["./", "index.html", "app.js", "i18n.js", "firebase.js", "manifest.webmanifest", "pwa.js", "img/wordmark.webp", "img/logo.png", "img/pwa/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // ملفات الموقع فقط (نفس الدومين) — Firebase/Google خارج الكاش
  if (url.origin !== self.location.origin) return;
  // لوحة الإدارة ديما من الشبكة
  if (url.pathname.endsWith("/admin.html") || url.pathname.endsWith("/admin.js")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
