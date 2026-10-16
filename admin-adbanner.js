// admin-adbanner.js — تبويب "بانر الإعلانات": المشرف كيحط كود الإعلان وكيفعّلو/كيوقفو
import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const ctx = { toast: (m) => alert(m) };
export function initAdminAdBanner(o) { Object.assign(ctx, o || {}); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function renderAdBannerTab(el) {
  el.innerHTML = '<div class="empty">...</div>';
  let d = {};
  try { const s = await getDoc(doc(db, "config", "adBanner")); if (s.exists()) d = s.data(); }
  catch (e) { el.innerHTML = '<div class="empty">تعذّر التحميل. تأكد من نشر قواعد Firestore الجديدة.</div>'; return; }
  el.innerHTML =
    '<div class="admin-card"><h3>بانر الإعلانات</h3>' +
    '<p style="opacity:.75;font-size:13px;line-height:1.6">يظهر تحت الباقات في الصفحة الرئيسية. الصق كود الإعلان (HTML أو سكريبت AdSense وغيره). عند إيقافه يختفي فوراً عن الزبناء.</p>' +
    '<label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-weight:800"><input type="checkbox" id="abOn"' + (d.enabled ? " checked" : "") + '> تفعيل البانر</label>' +
    '<textarea id="abCode" dir="ltr" rows="9" placeholder="&lt;script ...&gt;&lt;/script&gt;" style="width:100%;font-family:monospace;font-size:13px;padding:10px;border-radius:12px;border:1px solid #cbd5e1;box-sizing:border-box">' + esc(d.code || "") + "</textarea>" +
    '<div class="users-filters" style="margin-top:10px"><label>ارتفاع البانر (بكسل) <input id="abH" type="number" min="50" max="1000" value="' + esc(d.height || 250) + '" style="width:100px"></label>' +
    '<button class="add" id="abSave">حفظ</button></div>' +
    '<p style="opacity:.7;font-size:12px;line-height:1.6">للأمان يُعرض الإعلان داخل إطار معزول. بعض الشبكات الإعلانية قد لا تعمل داخل إطار معزول؛ جرّب وتأكد من الظهور في الصفحة الرئيسية.</p></div>';
  el.querySelector("#abSave").onclick = async (ev) => {
    const code = el.querySelector("#abCode").value;
    const enabled = el.querySelector("#abOn").checked;
    const height = Math.min(1000, Math.max(50, parseInt(el.querySelector("#abH").value, 10) || 250));
    if (code.length > 20000) return ctx.toast("الكود طويل جداً", "error");
    if (enabled && !code.trim()) return ctx.toast("ضع كود الإعلان أولاً", "error");
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, "config", "adBanner"), { enabled, code, height, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
      ctx.toast(enabled ? "تم الحفظ والبانر مفعّل" : "تم الحفظ والبانر موقوف");
    } catch (e) { ctx.toast("فشل الحفظ", "error"); }
    ev.target.disabled = false;
  };
}
