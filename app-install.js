// app-install.js — شريط "ثبّت التطبيق" للوحة الإدارة وتطبيق السائق (أندرويد/كمبيوتر: زر مباشر، آيفون: تعليمات)
// الإعداد كيجي من وسوم data-* فـ <script>: data-icon (إجباري) / data-name / data-key / data-pos (top|bottom) / data-sw / data-scope
(function () {
  var me = document.currentScript;
  var cfg = (me && me.dataset) || {};
  var NAME = cfg.name || "وجبتنا";
  var ICON = cfg.icon || "";
  var KEY = "pwa_dismissed_" + (cfg.key || "app");
  var POS = cfg.pos === "top" ? "top" : "bottom";

  if (cfg.sw && "serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      var opts = cfg.scope ? { scope: cfg.scope } : undefined;
      navigator.serviceWorker.register(cfg.sw, opts).catch(function () {});
    });
  }

  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (standalone) { window.wajbaInstall = { standalone: true, run: function () { return Promise.resolve(""); } }; return; }

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var deferred = null;
  var bar = null;

  var css = document.createElement("style");
  css.textContent =
    "#pwaBar{position:fixed;left:12px;right:12px;" + POS + ":calc(12px + env(safe-area-inset-" + POS + ",0px));z-index:9990;background:#064e3b;color:#fff;border-radius:18px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px #022c2299;font-family:Tajawal,system-ui,sans-serif;max-width:520px;margin:0 auto;direction:rtl;animation:pwaIn .35s ease}" +
    "@keyframes pwaIn{from{transform:translateY(" + (POS === "top" ? "-30px" : "30px") + ");opacity:0}to{transform:none;opacity:1}}" +
    "#pwaBar img{width:46px;height:46px;border-radius:12px;flex:none}" +
    "#pwaBar .pwa-t{flex:1;min-width:0}#pwaBar b{display:block;font-size:15px;font-weight:800}#pwaBar small{display:block;font-size:12px;opacity:.85;margin-top:2px;line-height:1.4}" +
    "#pwaBar .pwa-go{background:#f59e0b;color:#064e3b;border:0;border-radius:12px;padding:10px 16px;font:800 14px Tajawal,system-ui,sans-serif;cursor:pointer;flex:none}" +
    "#pwaBar .pwa-x{background:none;border:0;color:#fff;opacity:.7;font-size:22px;line-height:1;cursor:pointer;padding:4px;flex:none}";
  document.head.appendChild(css);

  function removeBar() { if (bar) { bar.remove(); bar = null; } }
  function dismiss() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    removeBar();
  }
  function dismissedRecently() {
    try { var v = localStorage.getItem(KEY); return !!v && Date.now() - Number(v) < 7 * 864e5; } catch (e) { return false; }
  }

  function showBar() {
    if (bar || !document.body || dismissedRecently() || !(deferred || isIOS)) return;
    bar = document.createElement("div");
    bar.id = "pwaBar";
    bar.setAttribute("role", "dialog");
    bar.innerHTML =
      (ICON ? '<img src="' + ICON + '" alt="">' : "") +
      '<div class="pwa-t"><b>ثبّت تطبيق ' + NAME + "</b><small>" +
      (deferred ? "وصول سريع من الشاشة الرئيسية بدون متصفح" : "للتثبيت: اضغط على زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»") +
      "</small></div>" +
      (deferred ? '<button class="pwa-go" type="button">تثبيت</button>' : "") +
      '<button class="pwa-x" type="button" aria-label="إغلاق">×</button>';
    document.body.appendChild(bar);
    bar.querySelector(".pwa-x").onclick = dismiss;
    var go = bar.querySelector(".pwa-go");
    if (go) go.onclick = function () { run(); };
  }

  var HINT_IOS = "للتثبيت: اضغط على زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»";
  var HINT_OTHER = "للتثبيت: افتح قائمة المتصفح ⋮ ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»";
  // كيشغّل نافذة التثبيت الرسمية إلا كانت متاحة (كيرجع ""), وإلا كيرجع نص تعليمات التثبيت اليدوي
  function run() {
    if (deferred) {
      var ev = deferred;
      try {
        ev.prompt();
        return ev.userChoice.then(function () { deferred = null; removeBar(); return ""; }, function () { return ""; });
      } catch (e) { deferred = null; }
    }
    return Promise.resolve(isIOS ? HINT_IOS : HINT_OTHER);
  }
  window.wajbaInstall = { standalone: false, run: run };

  // أندرويد / كروم / إيدج (حتى الكمبيوتر): الحدث الرسمي ديال التثبيت
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    setTimeout(showBar, 2500);
  });
  window.addEventListener("appinstalled", function () { deferred = null; removeBar(); });

  // آيفون (سفاري) ما فيهش beforeinstallprompt: كنعرضو تعليمات يدوية
  if (isIOS) setTimeout(showBar, 3500);
})();
