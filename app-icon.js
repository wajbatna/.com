// app-icon.js — كيطبّق أيقونة التطبيق اللي اختارها المشرف (favicon + apple-touch-icon + manifest + أيقونة شريط التثبيت)
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { ICON_PRESETS, ICON_LS_KEY } from "./app-icons-config.js";

function setLink(rel, href, extra) {
  let l = document.querySelector('link[rel="' + rel + '"]');
  if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
  if (extra) for (const k in extra) l.setAttribute(k, extra[k]);
  l.href = href;
}
function apply(cfg) {
  if (!cfg) return;
  window.wajbaAppIcon = cfg.icon;
  setLink("icon", cfg.favicon || cfg.icon, { type: "image/png" });
  setLink("apple-touch-icon", cfg.apple);
  if (cfg.manifest) {
    setLink("manifest", cfg.manifest);
  } else if (cfg.big) {
    // أيقونة مخصّصة: manifest ديناميكي بروابط مطلقة
    try {
      const abs = (p) => new URL(p, location.href).href;
      const m = {
        name: "وجبتنا — أكل بيتي مغربي أصيل", short_name: "وجبتنا", lang: "ar", dir: "rtl",
        id: abs("./"), start_url: abs("./?source=pwa"), scope: abs("./"),
        display: "standalone", orientation: "portrait", background_color: "#064E3B", theme_color: "#064E3B",
        icons: [
          { src: cfg.icon, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: cfg.big, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: cfg.big, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      setLink("manifest", URL.createObjectURL(new Blob([JSON.stringify(m)], { type: "application/manifest+json" })));
    } catch (e) {}
  }
  document.querySelectorAll("#pwaBar img,#installBtn img,.pwa-install-btn img").forEach((i) => { i.src = cfg.icon; });
}
function fromPreset(id) { return ICON_PRESETS.find((p) => p.id === id) || null; }

// تطبيق فوري من آخر قيمة محفوظة (بلا وميض)
try {
  const c = JSON.parse(localStorage.getItem(ICON_LS_KEY) || "null");
  if (c && c.cfg) apply(c.cfg);
} catch (e) {}

(async () => {
  try {
    const s = await getDoc(doc(db, "config", "appIcon"));
    const active = (s.exists() && s.data().active) || "default";
    let cfg = null;
    if (active.startsWith("custom:")) {
      const c = await getDoc(doc(db, "appIcons", active.slice(7)));
      if (c.exists()) {
        const d = c.data();
        cfg = { icon: d.icon192, big: d.icon512, apple: d.apple180, favicon: d.icon192 };
      }
    } else {
      cfg = fromPreset(active);
    }
    if (!cfg) cfg = fromPreset("default");
    try { localStorage.setItem(ICON_LS_KEY, JSON.stringify({ active, cfg })); } catch (e) {}
    apply(cfg);
  } catch (e) {}
})();
