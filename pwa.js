// pwa.js — تسجيل الـ Service Worker + رسالة "تجربة أحسن على هاتفك" + زر "تحميل التطبيق" فـ نوافذ الدخول/إنشاء الحساب
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  // منع قائمة الضغط المطوّل (نسخ/حفظ الصورة) خارج الحقول — إحساس تطبيق حقيقي
  document.addEventListener("contextmenu", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("input,textarea,select,[contenteditable='true'],.selectable")) return;
    e.preventDefault();
  });

  var KEY = "wajba_pwa_dismissed";
  function lang() {
    try { return localStorage.getItem("wajba_lang") === "fr" ? "fr" : "ar"; } catch (e) { return "ar"; }
  }
  var T = {
    ar: { title: "تجربة أحسن على هاتفك", sub: "حمّل تطبيق وجبتنا للوصول السريع", btn: "تحميل", btnFull: "تحميل التطبيق", close: "إغلاق",
          ios: "للتحميل: اضغط على زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»" },
    fr: { title: "Meilleure expérience sur votre téléphone", sub: "Installez l'app Wajbatna pour un accès rapide", btn: "Installer", btnFull: "Installer l'application", close: "Fermer",
          ios: "Pour installer : touchez Partager ⬆️ puis « Sur l'écran d'accueil »" }
  };

  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (standalone) return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  var deferred = null;
  var bar = null;

  var css = document.createElement("style");
  css.textContent =
    "#pwaBar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9990;background:#064e3b;color:#fff;border-radius:18px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px #022c2299;font-family:Tajawal,system-ui,sans-serif;max-width:520px;margin:0 auto;animation:pwaUp .35s ease}" +
    "@keyframes pwaUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}" +
    "#pwaBar img{width:46px;height:46px;border-radius:12px;flex:none}" +
    "#pwaBar .pwa-t{flex:1;min-width:0}#pwaBar b{display:block;font-size:15px;font-weight:800}#pwaBar small{display:block;font-size:12px;opacity:.85;margin-top:2px;line-height:1.4}" +
    "#pwaBar .pwa-go{background:#f59e0b;color:#064e3b;border:0;border-radius:12px;padding:10px 16px;font:800 14px Tajawal,system-ui,sans-serif;cursor:pointer;flex:none}" +
    "#pwaBar .pwa-x{background:none;border:0;color:#fff;opacity:.7;font-size:22px;line-height:1;cursor:pointer;padding:4px;flex:none}" +
    ".pwa-slot{margin-top:12px}.pwa-slot:empty{display:none}" +
    ".pwa-inst{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;color:#064e3b;border:1.5px solid #064e3b;border-radius:14px;padding:12px;font:800 14px Tajawal,system-ui,sans-serif;cursor:pointer;min-height:44px}" +
    ".pwa-inst img{width:22px;height:22px;border-radius:6px}" +
    ".pwa-hint{font-size:12px;color:#475569;margin:8px 2px 0;line-height:1.5;text-align:center}";
  document.head.appendChild(css);

  function removeBar() { if (bar) { bar.remove(); bar = null; } }
  function dismiss() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    removeBar();
  }
  function bannerDismissedRecently() {
    try { var v = localStorage.getItem(KEY); return !!v && Date.now() - Number(v) < 7 * 864e5; } catch (e) { return false; }
  }

  function doInstall() {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () { deferred = null; removeBar(); fillSlots(); });
  }

  function canInstall() { return !!deferred || (isIOS && isMobile); }

  function showBar() {
    if (bar || !document.body || bannerDismissedRecently() || !canInstall()) return;
    var t = T[lang()];
    bar = document.createElement("div");
    bar.id = "pwaBar";
    bar.setAttribute("role", "dialog");
    bar.dir = lang() === "fr" ? "ltr" : "rtl";
    bar.innerHTML =
      '<img src="img/pwa/icon-192.png" alt="">' +
      '<div class="pwa-t"><b>' + t.title + "</b><small>" + (deferred ? t.sub : t.ios) + "</small></div>" +
      (deferred ? '<button class="pwa-go" type="button">' + t.btn + "</button>" : "") +
      '<button class="pwa-x" type="button" aria-label="' + t.close + '">×</button>';
    document.body.appendChild(bar);
    bar.querySelector(".pwa-x").onclick = dismiss;
    var go = bar.querySelector(".pwa-go");
    if (go) go.onclick = doInstall;
  }

  // زر "تحميل التطبيق" داخل أي عنصر .pwa-slot (كيتزاد فـ نوافذ تسجيل الدخول وإنشاء الحساب)
  function fillSlots() {
    var slots = document.querySelectorAll(".pwa-slot");
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (!canInstall()) { slot.innerHTML = ""; continue; }
      if (slot.firstChild) continue;
      var t = T[lang()];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pwa-inst";
      b.innerHTML = '<img src="img/pwa/icon-192.png" alt="">' + t.btnFull;
      var hint = document.createElement("div");
      hint.className = "pwa-hint";
      hint.style.display = "none";
      hint.textContent = t.ios;
      b.onclick = (function (h) {
        return function () {
          if (deferred) doInstall();
          else h.style.display = "block";
        };
      })(hint);
      slot.appendChild(b);
      slot.appendChild(hint);
    }
  }

  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; fillSlots(); }, 50);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Android / Chrome / Edge: الحدث الرسمي ديال التحميل
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    fillSlots();
    setTimeout(showBar, 2500);
  });
  window.addEventListener("appinstalled", function () { deferred = null; removeBar(); fillSlots(); });

  // iOS Safari ما فيهش beforeinstallprompt: كنعرضو تعليمات يدوية
  if (isIOS && isMobile) { fillSlots(); setTimeout(showBar, 3500); }
})();
