// admin-adbanner.js — تبويب "بانر الإعلانات": المشرف كيحط كود الإعلان وكيفعّلو/كيوقفو
import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const ctx = { toast: (m) => alert(m) };
export function initAdminAdBanner(o) { Object.assign(ctx, o || {}); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SIZES = [[300, 250], [728, 90], [468, 60], [320, 50], [160, 300], [160, 600]];
const DEFAULT_CODE = `<script>
  atOptions = {
    'key' : 'f19b9a823f603075bd52da3844f6906a',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
<\/script>
<script src="https://www.highrevenueformat.com/f19b9a823f603075bd52da3844f6906a/invoke.js"><\/script>`;

export async function renderAdBannerTab(el) {
  el.innerHTML = '<div class="empty">...</div>';
  let d = {};
  try { const s = await getDoc(doc(db, "config", "adBanner")); if (s.exists()) d = s.data(); }
  catch (e) { el.innerHTML = '<div class="empty">تعذّر التحميل. تأكد من نشر قواعد Firestore الجديدة.</div>'; return; }
  el.innerHTML =
    '<div class="admin-card"><h3>بانر الإعلانات</h3>' +
    '<p style="opacity:.75;font-size:13px;line-height:1.6">يظهر تحت الباقات في الصفحة الرئيسية. الصق كود الإعلان (HTML أو سكريبت AdSense وغيره). عند إيقافه يختفي فوراً عن الزبناء.</p>' +
    '<label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-weight:800"><input type="checkbox" id="abOn"' + (d.enabled ? " checked" : "") + '> تفعيل البانر</label>' +
    '<textarea id="abCode" dir="ltr" rows="9" placeholder="&lt;script ...&gt;&lt;/script&gt;" style="width:100%;font-family:monospace;font-size:13px;padding:10px;border-radius:12px;border:1px solid #cbd5e1;box-sizing:border-box">' + esc(d.code || DEFAULT_CODE) + "</textarea>" +
    '<h4 style="margin:14px 0 8px">تنسيق الوحدة الإعلانية (لافتة)</h4>' +
    '<div id="abSizes" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
    SIZES.map(([w, h]) => '<label style="display:flex;align-items:center;gap:6px"><input type="radio" name="abSize" value="' + w + "x" + h + '"' + (w === (d.width || 300) && h === (d.height || 250) ? " checked" : "") + "> " + w + "x" + h + "</label>").join("") + "</div>" +
    '<p style="opacity:.7;font-size:12px">يجب أن يطابق الحجم المختار الحجم الذي أنشأت به الوحدة في Adsterra (يُضبط تلقائياً عند لصق الكود).</p>' +
    '<div class="users-filters" style="margin-top:10px"><button class="add" id="abSave">حفظ</button></div>' +
    '<p style="opacity:.7;font-size:12px;line-height:1.6">يُعرض الإعلان داخل إطار داخل الصفحة. ضع فقط أكواد من شبكات إعلانية تثق بها، لأن الكود يعمل بنفس صلاحيات الموقع. إن لم يظهر إعلان فتأكد أن الدومين مقبول في Adsterra.</p></div>';
  const pick = (w, h) => { const r = el.querySelector('input[name="abSize"][value="' + w + "x" + h + '"]'); if (r) r.checked = true; };
  const sync = () => {
    const c = el.querySelector("#abCode").value;
    const h = c.match(/['"]height['"]\s*:\s*(\d+)/), w = c.match(/['"]width['"]\s*:\s*(\d+)/);
    if (h && w) pick(w[1], h[1]);
  };
  el.querySelector("#abCode").addEventListener("input", sync);
  if (!d.code) sync();
  el.querySelector("#abSave").onclick = async (ev) => {
    const code = el.querySelector("#abCode").value;
    const enabled = el.querySelector("#abOn").checked;
    const sz = (el.querySelector('input[name="abSize"]:checked') || { value: "300x250" }).value.split("x").map(Number);
    const width = sz[0], height = sz[1];
    if (code.length > 20000) return ctx.toast("الكود طويل جداً", "error");
    if (enabled && !code.trim()) return ctx.toast("ضع كود الإعلان أولاً", "error");
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, "config", "adBanner"), { enabled, code, width, height, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
      ctx.toast(enabled ? "تم الحفظ والبانر مفعّل" : "تم الحفظ والبانر موقوف");
    } catch (e) { ctx.toast("فشل الحفظ", "error"); }
    ev.target.disabled = false;
  };
}
