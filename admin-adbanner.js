// admin-adbanner.js — تبويب "بانر الإعلانات": المشرف كيحط كود الإعلان وكيفعّلو/كيوقفو (بانر الزبناء + بانر السائقين)
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


function cardHtml(p, title, where, d) {
  return '<div class="admin-card"><h3>' + title + "</h3>" +
    '<p style="opacity:.75;font-size:13px;line-height:1.6">' + where + " الصق كود الإعلان (HTML أو سكريبت Adsterra / AdSense وغيره). عند إيقافه يختفي عن المستخدمين.</p>" +
    '<label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-weight:800"><input type="checkbox" id="' + p + 'On"' + (d.enabled ? " checked" : "") + "> تفعيل البانر</label>" +
    '<textarea id="' + p + 'Code" dir="ltr" rows="8" style="width:100%;font-family:monospace;font-size:13px;padding:10px;border-radius:12px;border:1px solid #cbd5e1;box-sizing:border-box">' + esc(d.code || DEFAULT_CODE) + "</textarea>" +
    '<h4 style="margin:14px 0 8px">تنسيق الوحدة الإعلانية (لافتة)</h4>' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
    SIZES.map(([w, h]) => '<label style="display:flex;align-items:center;gap:6px"><input type="radio" name="' + p + 'Size" value="' + w + "x" + h + '"' + (w === (d.width || 300) && h === (d.height || 250) ? " checked" : "") + "> " + w + "x" + h + "</label>").join("") + "</div>" +
    '<p style="opacity:.7;font-size:12px">يجب أن يطابق الحجم المختار الحجم الذي أنشأت به الوحدة في Adsterra (يُضبط تلقائياً عند لصق الكود).</p>' +
    '<div class="users-filters" style="margin-top:10px"><button class="add" id="' + p + 'Save">حفظ</button></div></div>';
}

function bindCard(el, p, docId) {
  const q = (x) => el.querySelector("#" + p + x);
  const sync = () => {
    const c = q("Code").value;
    const h = c.match(/['"]height['"]\s*:\s*(\d+)/), w = c.match(/['"]width['"]\s*:\s*(\d+)/);
    const r = h && w && el.querySelector('input[name="' + p + 'Size"][value="' + w[1] + "x" + h[1] + '"]');
    if (r) r.checked = true;
  };
  q("Code").addEventListener("input", sync);
  q("Save").onclick = async (ev) => {
    const code = q("Code").value;
    const enabled = q("On").checked;
    const sz = (el.querySelector('input[name="' + p + 'Size"]:checked') || { value: "300x250" }).value.split("x").map(Number);
    if (code.length > 20000) return ctx.toast("الكود طويل جداً", "error");
    if (enabled && !code.trim()) return ctx.toast("ضع كود الإعلان أولاً", "error");
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, "config", docId), { enabled, code, width: sz[0], height: sz[1], updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
      ctx.toast(enabled ? "تم الحفظ والبانر مفعّل" : "تم الحفظ والبانر موقوف");
    } catch (e) { ctx.toast("فشل الحفظ", "error"); }
    ev.target.disabled = false;
  };
  if (!q("Code").value.trim()) sync();
}

export async function renderAdBannerTab(el) {
  el.innerHTML = '<div class="empty">...</div>';
  let a = {}, b = {};
  try {
    const [sa, sb] = await Promise.all([getDoc(doc(db, "config", "adBanner")), getDoc(doc(db, "config", "driverAdBanner"))]);
    if (sa.exists()) a = sa.data();
    if (sb.exists()) b = sb.data();
  } catch (e) { el.innerHTML = '<div class="empty">تعذّر التحميل. تأكد من نشر قواعد Firestore الجديدة.</div>'; return; }
  el.innerHTML = cardHtml("abC", "بانر الإعلانات — تطبيق الزبناء", "يظهر تحت الباقات في الصفحة الرئيسية.", a) +
    cardHtml("abD", "بانر الإعلانات — تطبيق السائق", "يظهر للسائقين أسفل الشاشة فوق شريط التنقل (ويمكن للسائق إغلاقه). يُنصح بحجم صغير مثل 320x50.", b);
  bindCard(el, "abC", "adBanner");
  bindCard(el, "abD", "driverAdBanner");
}
