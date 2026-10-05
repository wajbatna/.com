// admin-links.js — تبويب "روابطنا / مواقعنا" فلوحة المشرف: إضافة وتعديل وحذف الروابط وتشغيلها/إطفاؤها.
// الروابط المفعّلة كتبان للزبناء فـ footer الموقع (collection: siteLinks).
import { db, auth } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let ctx = { toast: (m) => alert(m) };
export function initAdminLinks(c) {
  ctx = { ...ctx, ...c };
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const TYPES = [
  ["website", "موقع إلكتروني"],
  ["location", "الموقع على الخريطة"],
  ["facebook", "فيسبوك"],
  ["instagram", "إنستغرام"],
  ["tiktok", "تيك توك"],
  ["whatsapp", "واتساب"],
  ["youtube", "يوتيوب"],
  ["phone", "هاتف (tel:)"],
  ["email", "بريد (mailto:)"],
  ["other", "أخرى"],
];
const typeImg = (t, px = 28) =>
  `<img src="img/icons/link-${TYPES.some((x) => x[0] === t) ? t : "other"}.webp" alt="" width="${px}" height="${px}" style="width:${px}px;height:${px}px;object-fit:contain;border-radius:50%;vertical-align:middle">`;
const URL_RE = /^(https?:\/\/|tel:|mailto:).+/i;

export async function renderLinksTab(el) {
  el.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  let links = [];
  try {
    const snap = await getDocs(query(collection(db, "siteLinks"), limit(100)));
    links = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) {
    el.innerHTML = `<div class="empty">⚠️ تعذر تحميل الروابط. <button class="btn-outline-sm" id="lkRetry">إعادة المحاولة</button></div>`;
    document.getElementById("lkRetry").addEventListener("click", () => renderLinksTab(el));
    return;
  }
  const nextOrder = links.length ? Math.max(...links.map((l) => l.order || 0)) + 1 : 1;
  el.innerHTML = `
  <div class="admin-card">
    <h3 style="margin:0 0 4px;color:#064e3b">${typeImg("other", 24)} روابطنا / مواقعنا</h3>
    <div style="font-size:12px;color:#78716c;margin-bottom:12px">الروابط المفعّلة تظهر للزبناء أسفل الموقع تحت «تابعنا». يمكنك تشغيل أي رابط أو إطفاؤه دون حذفه.</div>
    <div id="lkForm" class="users-filters" style="grid-template-columns:repeat(2,1fr)">
      <div><label>النوع <span id="lkTypeIcon">${typeImg("website", 24)}</span></label><select id="lkType">${TYPES.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label>العنوان الظاهر</label><input id="lkTitle" maxlength="100" placeholder="مثال: صفحتنا على فيسبوك"></div>
      <div style="grid-column:1/-1"><label>الرابط</label><input id="lkUrl" dir="ltr" type="url" maxlength="500" placeholder="https://..."></div>
      <div><label>الترتيب</label><input id="lkOrder" type="number" min="0" value="${nextOrder}"></div>
      <div style="display:flex;align-items:flex-end"><label class="privacy-check-admin" style="margin-bottom:12px"><input type="checkbox" id="lkEnabled" checked> <span>مفعّل</span></label></div>
    </div>
    <input type="hidden" id="lkEditId" value="">
    <p id="lkErr" style="color:#dc2626;font-size:12px;margin:4px 0"></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="add" id="lkSave">إضافة الرابط</button>
      <button type="button" class="btn-outline-sm" id="lkCancel" style="display:none">إلغاء التعديل</button>
    </div>
  </div>
  <div class="admin-card"><h3 style="margin:0 0 10px;color:#064e3b">الروابط الحالية (${links.length})</h3>
    ${
      links.length
        ? links
            .map(
              (l) => `<div class="user-order" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;${l.enabled ? "" : "opacity:.6"}">
        <div style="min-width:0;flex:1 1 220px"><b>${typeImg(l.type, 30)} ${esc(l.title)}</b>
          <div dir="ltr" style="font-size:11px;color:#78716c;overflow-wrap:anywhere;text-align:right">${esc(l.url)}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn-outline-sm" data-toggle="${esc(l.id)}">${l.enabled ? "✅ مفعّل — إطفاء" : "⛔ مطفأ — تشغيل"}</button>
          <button type="button" class="btn-outline-sm" data-edit="${esc(l.id)}">تعديل</button>
          <button type="button" class="btn-danger-sm" data-del="${esc(l.id)}">حذف</button>
        </div></div>`
            )
            .join("")
        : `<div class="empty" style="padding:16px">لا توجد روابط بعد. أضف أول رابط من الأعلى.</div>`
    }
  </div>`;
  const $ = (id) => document.getElementById(id);
  $("lkType").addEventListener("change", () => ($("lkTypeIcon").innerHTML = typeImg($("lkType").value, 24)));
  const payload = (existing) => ({
    title: $("lkTitle").value.trim(),
    url: $("lkUrl").value.trim(),
    type: $("lkType").value,
    enabled: $("lkEnabled").checked,
    order: Math.max(0, Math.floor(Number($("lkOrder").value) || 0)),
    ...(existing ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  });
  $("lkSave").addEventListener("click", async () => {
    const err = $("lkErr");
    err.textContent = "";
    const d = payload(true);
    if (!d.title) return (err.textContent = "العنوان مطلوب.");
    if (!URL_RE.test(d.url)) return (err.textContent = "الرابط يجب أن يبدأ بـ https:// أو http:// أو tel: أو mailto:");
    const editId = $("lkEditId").value;
    try {
      if (editId) await setDoc(doc(db, "siteLinks", editId), d, { merge: true });
      else await addDoc(collection(db, "siteLinks"), payload(false));
      ctx.toast(editId ? "تم تحديث الرابط ✓" : "تمت إضافة الرابط ✓");
      renderLinksTab(el);
    } catch (e) {
      err.textContent = "تعذر الحفظ (تحقق من نشر قواعد Firestore).";
    }
  });
  $("lkCancel").addEventListener("click", () => renderLinksTab(el));
  el.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const l = links.find((x) => x.id === b.dataset.toggle);
      try {
        await setDoc(doc(db, "siteLinks", l.id), { enabled: !l.enabled, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge: true });
        ctx.toast(l.enabled ? "تم إطفاء الرابط" : "تم تشغيل الرابط ✓");
        renderLinksTab(el);
      } catch (e) {
        ctx.toast("تعذر التحديث.", "error");
      }
    })
  );
  el.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const l = links.find((x) => x.id === b.dataset.edit);
      $("lkType").value = l.type;
      $("lkTypeIcon").innerHTML = typeImg(l.type, 24);
      $("lkTitle").value = l.title;
      $("lkUrl").value = l.url;
      $("lkOrder").value = l.order || 0;
      $("lkEnabled").checked = !!l.enabled;
      $("lkEditId").value = l.id;
      $("lkSave").textContent = "حفظ التعديل";
      $("lkCancel").style.display = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
  el.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("حذف هذا الرابط نهائياً؟")) return;
      try {
        await deleteDoc(doc(db, "siteLinks", b.dataset.del));
        ctx.toast("تم حذف الرابط ✓");
        renderLinksTab(el);
      } catch (e) {
        ctx.toast("تعذر الحذف.", "error");
      }
    })
  );
}
