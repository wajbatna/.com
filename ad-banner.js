// ad-banner.js — بانر الإعلانات تحت الباقات. كيبان غير إيلا فعّلو المشرف (config/adBanner).
// الكود كيتعرض داخل iframe معزول (sandbox بلا allow-same-origin) باش ما يقدرش يوصل لحساب الزبون ولا لبيانات الموقع.
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

(async () => {
  try {
    const s = await getDoc(doc(db, "config", "adBanner"));
    const d = s.exists() ? s.data() : null;
    const old = document.getElementById("adBannerBox");
    if (old) old.remove();
    if (!d || d.enabled !== true || !d.code || !String(d.code).trim()) return;
    const anchor = document.getElementById("weeklyPackagesSection");
    if (!anchor) return;
    const h = Math.min(1000, Math.max(50, Number(d.height) || 250));
    const box = document.createElement("div");
    box.id = "adBannerBox";
    box.style.cssText = "margin:0 0 22px;text-align:center";
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("loading", "lazy");
    f.title = "ad";
    f.style.cssText = "width:100%;max-width:728px;height:" + h + "px;border:0;border-radius:14px;background:transparent;overflow:hidden";
    f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>' + d.code + "</body></html>";
    box.appendChild(f);
    anchor.insertAdjacentElement("afterend", box);
  } catch (e) {}
})();
