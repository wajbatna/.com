// admin-fastfood.js — تبويب "الفاست فود": فئات (صورة قابلة للضغط) + أصناف بأحجام وأسعار، مع تشغيل/إيقاف
import { db, auth } from "./firebase.js";
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const ctx = { toast: (m) => alert(m) };
export function initAdminFastFood(o) { Object.assign(ctx, o || {}); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let root = null, cats = [], items = [], filter = "", fc = null, fi = null; // fc/fi = نموذج التعديل الحالي
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name));

function cropImage(file, w, h) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
      const k = Math.max(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      URL.revokeObjectURL(url);
      let out = "";
      for (const q of [0.85, 0.75, 0.6, 0.45]) {
        out = c.toDataURL("image/webp", q);
        if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", q);
        if (out.length <= 200000) return res(out);
      }
      rej(new Error("big"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad")); };
    img.src = url;
  });
}
const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

async function load() {
  const [a, b] = await Promise.all([getDocs(collection(db, "fastFoodCats")), getDocs(collection(db, "fastFoodItems"))]);
  cats = a.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
  items = b.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
}
const inp = "padding:9px 10px;border-radius:10px;border:1px solid #cbd5e1;font:inherit;box-sizing:border-box;width:100%";
const sw = (on, attr) => '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:800;cursor:pointer"><input type="checkbox" ' + attr + (on ? " checked" : "") + "> " + (on ? "مفعّل" : "موقوف") + "</label>";
const thumb = (s, r) => s ? '<img src="' + esc(s) + '" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:' + (r || 12) + 'px;flex:none">' : '<div style="width:54px;height:54px;border-radius:12px;background:#e7e5e4;flex:none"></div>';

function catForm() {
  const f = fc;
  return '<div class="user-order" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><b>' + (f.id ? "تعديل فئة" : "فئة جديدة") + "</b>" +
    '<input id="cName" style="' + inp + '" placeholder="الاسم (مثال: بيتزا)" maxlength="80" value="' + esc(f.name) + '">' +
    '<input id="cNameFr" style="' + inp + '" dir="ltr" placeholder="Nom en français (اختياري)" maxlength="80" value="' + esc(f.nameFr) + '">' +
    '<input id="cOrder" type="number" min="0" style="' + inp + '" placeholder="الترتيب (0 يظهر أولاً)" value="' + esc(f.order) + '">' +
    '<div style="display:flex;align-items:center;gap:10px">' + thumb(f.image) + '<input id="cImg" type="file" accept="image/*"></div>' +
    sw(f.enabled, 'id="cOn"') +
    '<div style="display:flex;gap:8px"><button class="add" id="cSave">حفظ</button><button class="btn-outline-sm" id="cCancel">إلغاء</button></div></div>';
}
function itemForm() {
  const f = fi;
  const sizes = f.sizes.map((s, k) => '<div style="display:flex;gap:6px;align-items:center"><input data-sl="' + k + '" style="' + inp + ';flex:2" placeholder="الحجم (صغيرة)" maxlength="40" value="' + esc(s.label) + '"><input data-sp="' + k + '" type="number" min="0" step="any" style="' + inp + ';flex:1" placeholder="السعر" value="' + esc(s.price) + '"><button type="button" class="btn-danger-sm" data-sd="' + k + '">×</button></div>').join("");
  return '<div class="user-order" style="display:flex;flex-direction:column;gap:8px;margin-top:10px"><b>' + (f.id ? "تعديل صنف" : "صنف جديد") + "</b>" +
    '<select id="iCat" style="' + inp + '">' + cats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === f.catId ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
    '<input id="iName" style="' + inp + '" placeholder="اسم الصنف (مثال: بيتزا مارغريتا)" maxlength="120" value="' + esc(f.name) + '">' +
    '<input id="iNameFr" style="' + inp + '" dir="ltr" placeholder="Nom en français (اختياري)" maxlength="120" value="' + esc(f.nameFr) + '">' +
    '<textarea id="iDesc" rows="2" style="' + inp + '" placeholder="وصف (اختياري)" maxlength="1000">' + esc(f.description) + "</textarea>" +
    '<input id="iOrder" type="number" min="0" style="' + inp + '" placeholder="الترتيب" value="' + esc(f.order) + '">' +
    '<div style="display:flex;align-items:center;gap:10px">' + thumb(f.image) + '<input id="iImg" type="file" accept="image/*"></div>' +
    "<b>الأحجام والأسعار</b>" + sizes +
    '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn-outline-sm" id="sAdd">+ حجم</button><button type="button" class="btn-outline-sm" id="sStd">صغيرة / متوسطة / كبيرة</button></div>' +
    sw(f.enabled, 'id="iOn"') +
    '<div style="display:flex;gap:8px"><button class="add" id="iSave">حفظ</button><button class="btn-outline-sm" id="iCancel">إلغاء</button></div></div>';
}

function paint() {
  const list = items.filter((i) => !filter || i.catId === filter);
  root.innerHTML =
    '<div class="admin-card"><h3>فئات الفاست فود</h3><p style="opacity:.75;font-size:13px;line-height:1.6">كل فئة تظهر للزبون كصورة قابلة للضغط (بيتزا، برغر...). عند الضغط تُفتح أصنافها. الفئة الموقوفة أو التي بلا أصناف مفعّلة لا تظهر.</p>' +
    (cats.length ? cats.map((c) => '<div class="user-order" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' + thumb(c.image) + '<div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b><div style="font-size:12px;opacity:.7">' + items.filter((i) => i.catId === c.id).length + " صنف</div></div>" + sw(c.enabled !== false, 'data-ctog="' + esc(c.id) + '"') + '<button class="btn-outline-sm" data-cedit="' + esc(c.id) + '">تعديل</button><button class="btn-danger-sm" data-cdel="' + esc(c.id) + '">حذف</button></div>').join("") : '<div class="empty">لا توجد فئات بعد</div>') +
    (fc ? catForm() : '<button class="add" id="cNew" style="margin-top:8px">+ فئة جديدة</button>') + "</div>" +
    '<div class="admin-card"><h3>أصناف الفاست فود</h3>' +
    '<select id="iFilter" style="' + inp + ';margin-bottom:10px"><option value="">كل الفئات</option>' + cats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === filter ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select>" +
    (list.length ? list.map((i) => '<div class="user-order" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' + thumb(i.image) + '<div style="flex:1;min-width:0"><b>' + esc(i.name) + '</b><div style="font-size:12px;opacity:.7">' + esc((cats.find((c) => c.id === i.catId) || {}).name || "—") + " · " + (i.sizes || []).map((s) => esc(s.label) + " " + s.price).join(" / ") + "</div></div>" + sw(i.enabled !== false, 'data-itog="' + esc(i.id) + '"') + '<button class="btn-outline-sm" data-iedit="' + esc(i.id) + '">تعديل</button><button class="btn-danger-sm" data-idel="' + esc(i.id) + '">حذف</button></div>').join("") : '<div class="empty">لا توجد أصناف</div>') +
    (fi ? itemForm() : (cats.length ? '<button class="add" id="iNew" style="margin-top:8px">+ صنف جديد</button>' : '<p style="opacity:.7;font-size:13px">أضف فئة أولاً.</p>')) + "</div>";
  bind();
}

async function guarded(fn, okMsg) {
  try { await fn(); if (okMsg) ctx.toast(okMsg); await load(); paint(); }
  catch (e) { ctx.toast(e && e.message === "big" ? "الصورة كبيرة جداً" : "فشلت العملية", "error"); }
}
const q = (s) => root.querySelector(s);
const qa = (s) => root.querySelectorAll(s);

function bind() {
  qa("[data-ctog]").forEach((c) => (c.onchange = () => { const x = cats.find((k) => k.id === c.dataset.ctog); guarded(() => setDoc(doc(db, "fastFoodCats", x.id), { name: x.name, nameFr: x.nameFr || "", image: x.image || "", order: x.order || 0, enabled: c.checked, ...stamp() }), c.checked ? "تم التفعيل" : "تم الإيقاف"); }));
  qa("[data-itog]").forEach((c) => (c.onchange = () => { const x = items.find((k) => k.id === c.dataset.itog); guarded(() => setDoc(doc(db, "fastFoodItems", x.id), { catId: x.catId, name: x.name, nameFr: x.nameFr || "", description: x.description || "", descriptionFr: x.descriptionFr || "", image: x.image || "", sizes: x.sizes, order: x.order || 0, enabled: c.checked, ...stamp() }), c.checked ? "تم التفعيل" : "تم الإيقاف"); }));
  qa("[data-cedit]").forEach((b) => (b.onclick = () => { fc = { ...cats.find((c) => c.id === b.dataset.cedit) }; paint(); }));
  qa("[data-iedit]").forEach((b) => (b.onclick = () => { const i = items.find((c) => c.id === b.dataset.iedit); fi = { ...i, sizes: (i.sizes || []).map((s) => ({ ...s })) }; paint(); }));
  qa("[data-cdel]").forEach((b) => (b.onclick = () => {
    const c = cats.find((k) => k.id === b.dataset.cdel), n = items.filter((i) => i.catId === c.id);
    if (!confirm('حذف الفئة "' + c.name + '"' + (n.length ? " مع " + n.length + " صنف؟" : "؟"))) return;
    guarded(async () => { const w = writeBatch(db); n.forEach((i) => w.delete(doc(db, "fastFoodItems", i.id))); w.delete(doc(db, "fastFoodCats", c.id)); await w.commit(); }, "تم الحذف");
  }));
  qa("[data-idel]").forEach((b) => (b.onclick = () => { if (confirm("حذف هذا الصنف؟")) guarded(() => deleteDoc(doc(db, "fastFoodItems", b.dataset.idel)), "تم الحذف"); }));
  const fl = q("#iFilter"); if (fl) fl.onchange = () => { filter = fl.value; paint(); };
  const cn = q("#cNew"); if (cn) cn.onclick = () => { fc = { name: "", nameFr: "", image: "", order: cats.length, enabled: true }; paint(); };
  const inw = q("#iNew"); if (inw) inw.onclick = () => { fi = { catId: filter || cats[0].id, name: "", nameFr: "", description: "", image: "", order: items.length, enabled: true, sizes: [{ label: "", price: "" }] }; paint(); };
  if (fc) {
    q("#cCancel").onclick = () => { fc = null; paint(); };
    q("#cImg").onchange = async (e) => { try { fc.image = await cropImage(e.target.files[0], 480, 480); sync(); paint(); } catch (x) { ctx.toast("تعذّر قراءة الصورة", "error"); } };
    q("#cSave").onclick = () => {
      sync();
      if (!fc.name.trim()) return ctx.toast("اكتب اسم الفئة", "error");
      if (!fc.image) return ctx.toast("اختر صورة للفئة", "error");
      const id = fc.id || newId();
      guarded(() => setDoc(doc(db, "fastFoodCats", id), { name: fc.name.trim(), nameFr: (fc.nameFr || "").trim(), image: fc.image, order: Number(fc.order) || 0, enabled: !!fc.enabled, ...stamp() }).then(() => { fc = null; }), "تم الحفظ");
    };
  }
  if (fi) {
    q("#iCancel").onclick = () => { fi = null; paint(); };
    q("#iImg").onchange = async (e) => { try { syncI(); fi.image = await cropImage(e.target.files[0], 640, 480); paint(); } catch (x) { ctx.toast("تعذّر قراءة الصورة", "error"); } };
    q("#sAdd").onclick = () => { syncI(); if (fi.sizes.length < 6) fi.sizes.push({ label: "", price: "" }); paint(); };
    q("#sStd").onclick = () => { syncI(); fi.sizes = ["صغيرة", "متوسطة", "كبيرة"].map((l, k) => ({ label: l, price: (fi.sizes[k] && fi.sizes[k].price) || "" })); paint(); };
    qa("[data-sd]").forEach((b) => (b.onclick = () => { syncI(); fi.sizes.splice(Number(b.dataset.sd), 1); if (!fi.sizes.length) fi.sizes.push({ label: "", price: "" }); paint(); }));
    q("#iSave").onclick = () => {
      syncI();
      if (!fi.name.trim()) return ctx.toast("اكتب اسم الصنف", "error");
      const sizes = fi.sizes.filter((s) => String(s.label).trim() || String(s.price).trim());
      if (!sizes.length || sizes.some((s) => !String(s.label).trim() || !(Number(s.price) >= 0) || String(s.price).trim() === "")) return ctx.toast("أكمل الأحجام والأسعار", "error");
      const id = fi.id || newId();
      guarded(() => setDoc(doc(db, "fastFoodItems", id), { catId: fi.catId, name: fi.name.trim(), nameFr: (fi.nameFr || "").trim(), description: (fi.description || "").trim(), descriptionFr: fi.descriptionFr || "", image: fi.image || "", sizes: sizes.map((s) => ({ label: String(s.label).trim(), price: Number(s.price) })), order: Number(fi.order) || 0, enabled: !!fi.enabled, ...stamp() }).then(() => { fi = null; }), "تم الحفظ");
    };
  }
}
function sync() {
  if (!fc || !q("#cName")) return;
  fc.name = q("#cName").value; fc.nameFr = q("#cNameFr").value; fc.order = q("#cOrder").value; fc.enabled = q("#cOn").checked;
}
function syncI() {
  if (!fi || !q("#iName")) return;
  fi.catId = q("#iCat").value; fi.name = q("#iName").value; fi.nameFr = q("#iNameFr").value; fi.description = q("#iDesc").value; fi.order = q("#iOrder").value; fi.enabled = q("#iOn").checked;
  fi.sizes = fi.sizes.map((s, k) => ({ ...s, label: q('[data-sl="' + k + '"]').value, price: q('[data-sp="' + k + '"]').value }));
}

export async function renderFastFoodTab(el) {
  root = el; fc = fi = null;
  el.innerHTML = '<div class="empty">...</div>';
  try { await load(); } catch (e) { el.innerHTML = '<div class="empty">تعذّر التحميل. تأكد من نشر قواعد Firestore الجديدة.</div>'; return; }
  paint();
}
