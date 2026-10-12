// admin-sw.js — Service Worker لوحة الإدارة (يخلي التطبيق قابل للتثبيت)
// عمداً ما كنخبّيو حتى شي فالكاش: لوحة الإدارة ديما كتجي من الشبكة باش دايما تكون آخر نسخة وبيانات حيّة.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body dir="rtl" style="font-family:Tahoma,Arial,sans-serif;text-align:center;padding:48px 20px;color:#064e3b"><h2>لا يوجد اتصال بالإنترنت</h2><p>تأكد من الاتصال ثم أعد فتح التطبيق.</p></body>',
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
    )
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./admin.html");
    })
  );
});
