// admin-appicon.js — تبويب "أيقونة التطبيق": المشرف كيبدّل بين الأيقونات الجاهزة أو كيزيد أيقونة خاصو
import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc, getDocs, addDoc, deleteDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { ICON_PRESETS } from "./app-icons-config.js";

const ctx = { toast: (m) => alert(m) };
export function initAdminAppIcon(o) { Object.assign(ctx, o || {}); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function crop(file, size, type, q) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      res(c.toDataURL(type, q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}
// PNG أولاً، وإلا WebP باش نبقاو تحت الحد المسموح
async function fit(file, size, max) {
  let d = await crop(file, size, "image/png");
  if (d.length <= max) return d;
  for (const q of [0.9, 0.8, 0.7, 0.55]) {
    d = await crop(file, size, "image/webp", q);
    if (d.startsWith("data:image/webp") && d.length <= max) return d;
  }
  throw new Error("big");
}
// الأيقونة الأصلية كتكون بخلفية مربّعة؛ آيفون ما كيقبلش الشفافية → كنثبتو خلفية خضراء
async function applePng(file) {
  const d = await crop(file, 180, "image/png");
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = d; });
  const c = document.createElement("canvas");
  c.width = c.height = 180;
  const x = c.getContext("2d");
  x.fillStyle = "#064E3B";
  x.fillRect(0, 0, 180, 180);
  x.drawImage(img, 0, 0);
  return c.toDataURL("image/png");
}

async function getActive() {
  const s = await getDoc(doc(db, "config", "appIcon"));
  return (s.exists() && s.data().active) || "default";
}
async function setActive(id) {
  await setDoc(doc(db, "config", "appIcon"), { active: id, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
}

export async function renderAppIconTab(el) {
  el.innerHTML = '<div class="empty">...</div>';
  let active = "default", customs = [];
  try {
    active = await getActive();
    const qs = await getDocs(collection(db, "appIcons"));
    customs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    el.innerHTML = '<div class="empty">تعذّر تحميل الأيقونات. تأكد من نشر قواعد Firestore الجديدة.</div>';
    return;
  }
  const items = [
    ...ICON_PRESETS.map((p) => ({ key: p.id, name: p.name, src: p.icon, custom: false })),
    ...customs.map((c) => ({ key: "custom:" + c.id, id: c.id, name: c.name, src: c.icon192, custom: true })),
  ];
  const card = (it) => {
    const on = it.key === active;
    return '<div class="user-order" style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;' + (on ? "outline:3px solid #f59e0b;" : "") + '">' +
      '<img src="' + esc(it.src) + '" alt="" style="width:84px;height:84px;border-radius:20px;object-fit:cover">' +
      "<b>" + esc(it.name) + "</b>" +
      (on ? '<span style="color:#059669;font-weight:800">✔ مُفعّلة</span>'
        : '<button class="btn-outline-sm" data-use="' + esc(it.key) + '">تفعيل</button>') +
      (it.custom ? '<button class="btn-danger-sm" data-del="' + esc(it.id) + '">حذف</button>' : "") + "</div>";
  };
  el.innerHTML =
    '<div class="admin-card"><h3>أيقونة التطبيق</h3>' +
    '<p style="opacity:.75;font-size:13px;line-height:1.6">اختر الأيقونة اللي تظهر للزبناء في التبويب وعند تثبيت التطبيق. ملاحظة: التطبيقات المثبّتة سابقاً قد تحتفظ بالأيقونة القديمة (آيفون خصوصاً) إلى أن يعيد الزبون تثبيتها.</p>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-top:12px">' + items.map(card).join("") + "</div></div>" +
    '<div class="admin-card"><h3>إضافة أيقونة خاصة</h3>' +
    '<div class="users-filters"><input id="aiName" placeholder="اسم الأيقونة (مثال: عيد الأضحى)" maxlength="60">' +
    '<input id="aiFile" type="file" accept="image/png,image/jpeg,image/webp"><button class="add" id="aiAdd">إضافة</button></div>' +
    '<p style="opacity:.7;font-size:12px">يفضّل صورة مربّعة 512×512 أو أكبر. سيتم اقتصاصها من الوسط تلقائياً.</p></div>';

  el.querySelectorAll("[data-use]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await setActive(b.dataset.use); ctx.toast("تم تفعيل الأيقونة"); renderAppIconTab(el); }
    catch (e) { ctx.toast("فشل التفعيل", "error"); b.disabled = false; }
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("حذف هذه الأيقونة؟")) return;
    try {
      if (active === "custom:" + b.dataset.del) await setActive("default");
      await deleteDoc(doc(db, "appIcons", b.dataset.del));
      ctx.toast("تم الحذف"); renderAppIconTab(el);
    } catch (e) { ctx.toast("فشل الحذف", "error"); }
  }));
  el.querySelector("#aiAdd").onclick = async (ev) => {
    const name = el.querySelector("#aiName").value.trim();
    const f = el.querySelector("#aiFile").files[0];
    if (!name || !f) return ctx.toast("اكتب الاسم واختر صورة", "error");
    ev.target.disabled = true;
    try {
      const [icon192, icon512, apple180] = await Promise.all([fit(f, 192, 140000), fit(f, 512, 440000), applePng(f)]);
      await addDoc(collection(db, "appIcons"), { name, icon192, icon512, apple180, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
      ctx.toast("تمت إضافة الأيقونة"); renderAppIconTab(el);
    } catch (e) {
      ctx.toast(e.message === "big" ? "الصورة كبيرة جداً، جرّب صورة أبسط" : "فشلت الإضافة", "error");
      ev.target.disabled = false;
    }
  };
}
