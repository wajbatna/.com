// driver-ad.js — بانر الإعلانات فتطبيق السائق (config/driverAdBanner). ثابت فوق شريط التنقل باش ما يتعاودش تحميلو مع كل render.
import { db, auth } from "../firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let box = null, closed = false, lastCode = "";
function remove() { if (box) { box.remove(); box = null; } lastCode = ""; }
async function load() {
  if (!auth.currentUser || closed) return remove();
  try {
    const s = await getDoc(doc(db, "config", "driverAdBanner"));
    const d = s.exists() ? s.data() : null;
    if (!d || d.enabled !== true || !String(d.code || "").trim()) return remove();
    const key = d.code + "|" + d.width + "|" + d.height;
    if (box && key === lastCode) return;
    remove();
    lastCode = key;
    const h = Math.min(600, Math.max(50, Number(d.height) || 250));
    const w = Math.min(728, Math.max(50, Number(d.width) || 300));
    box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;right:0;bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:35;display:none;justify-content:center;pointer-events:none";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;pointer-events:auto;max-width:100%;background:#fff;border-radius:12px;box-shadow:0 6px 20px #0f172a33;overflow:hidden";
    const f = document.createElement("iframe");
    f.title = "ad";
    f.style.cssText = "display:block;border:0;width:" + w + "px;max-width:100%;height:" + h + "px";
    f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>' + d.code + "</body></html>";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "إغلاق");
    x.style.cssText = "position:absolute;top:2px;left:2px;width:24px;height:24px;border:0;border-radius:50%;background:#0009;color:#fff;font-size:16px;line-height:1;cursor:pointer";
    x.onclick = () => { closed = true; remove(); };
    wrap.append(f, x); box.appendChild(wrap); document.body.appendChild(box);
  } catch (e) { remove(); }
}
// يبان غير ملي كيكون شريط التنقل (يعني السائق داخل التطبيق)
setInterval(() => { if (box) box.style.display = document.querySelector(".nav") ? "flex" : "none"; }, 800);
onAuthStateChanged(auth, () => { closed = false; load(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
setInterval(load, 5 * 60 * 1000);
