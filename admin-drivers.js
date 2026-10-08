// admin-drivers.js — إدارة سائقي التوصيل: الموافقة، الأتعاب، التتبع، الإحصائيات، وتعيين السائق على الطلب
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteField, query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let ctx = { toast: (m) => alert(m) };
export function initAdminDrivers(c) { ctx = { ...ctx, ...c }; }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const money = (n) => Math.round(Number(n) || 0).toLocaleString("ar-MA") + " درهم";
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isOnline = (d) => d.online === true && d.lastSeenAt?.seconds && Date.now() / 1000 - d.lastSeenAt.seconds < 120;
const STATUS_AR = { pending: "قيد المراجعة", active: "مفعّل", suspended: "موقوف" };
const DEL_AR = { pickedUp: "فالطريق 🛵", arrived: "وصل 📍", delivered: "تم التسليم ✅", failed: "تعذر ❌" };
const mapLink = (l) => (l?.lat != null ? `https://www.google.com/maps?q=${l.lat},${l.lng}` : "");

async function loadDrivers() {
  const snap = await getDocs(collection(db, "drivers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function renderDriversTab(el) {
  el.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  let drivers = [], deliveries = [], fee = 0;
  try {
    const [dr, de, st] = await Promise.all([
      loadDrivers(),
      getDocs(query(collection(db, "deliveries"), orderBy("updatedAt", "desc"), limit(800))),
      getDoc(doc(db, "config", "driverSettings")).catch(() => null),
    ]);
    drivers = dr; deliveries = de.docs.map((d) => ({ id: d.id, ...d.data() }));
    fee = st && st.exists() ? Number(st.data().feePerDelivery) || 0 : 0;
  } catch (e) {
    el.innerHTML = `<div class="empty">تعذر تحميل بيانات السائقين. تأكد أنك نشرت قواعد Firestore الجديدة.<br><button class="btn-outline-sm" id="drRetry">إعادة المحاولة</button></div>`;
    document.getElementById("drRetry").onclick = () => renderDriversTab(el);
    return;
  }
  const today = todayStr();
  const stat = (id) => {
    const mine = deliveries.filter((d) => d.driverId === id);
    const done = mine.filter((d) => d.status === "delivered");
    return {
      todayN: done.filter((d) => d.date === today).length,
      totalN: done.length,
      failed: mine.filter((d) => d.status === "failed").length,
      earn: done.reduce((a, d) => a + (Number(d.fee) || 0), 0),
      cash: done.reduce((a, d) => a + (Number(d.collected) || 0), 0),
      active: mine.find((d) => d.status === "pickedUp" || d.status === "arrived"),
    };
  };
  const pending = drivers.filter((d) => d.status === "pending");
  const active = drivers.filter((d) => d.status === "active").sort((a, b) => (isOnline(b) ? 1 : 0) - (isOnline(a) ? 1 : 0));
  const susp = drivers.filter((d) => d.status === "suspended");

  const card = (d) => {
    const s = stat(d.id), on = isOnline(d), loc = mapLink(d.lastLoc);
    return `<div class="admin-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:16px">${esc(d.name)}</b>
        <span class="info-tag" style="${on ? "background:#d1fae5;color:#065f46" : "background:#f1f5f9;color:#64748b"};font-weight:800">${d.status === "active" ? (on ? "● متصل" : "○ غير متصل") : STATUS_AR[d.status] || d.status}</span>
      </div>
      <div style="color:#64748b;font-size:13px;margin:6px 0">📞 <a href="tel:${esc(d.phone)}" dir="ltr">${esc(d.phone)}</a> · 🛵 ${esc(d.vehicle || "—")} · ${esc(d.email || "")}</div>
      ${d.status === "active" ? `<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px;margin:6px 0">
        <span class="info-tag">اليوم: ${s.todayN}</span><span class="info-tag">المجموع: ${s.totalN}</span><span class="info-tag">فشل: ${s.failed}</span>
        <span class="info-tag">أرباحو: ${money(s.earn)}</span><span class="info-tag" style="background:#fffbeb;color:#92400e">كاش عندو: ${money(s.cash)}</span></div>
        ${s.active ? `<div style="font-size:13px;color:#92400e;margin:4px 0">🔴 توصيلة جارية: ${esc(DEL_AR[s.active.status])} · WJ-${esc(String(s.active.orderId).slice(0, 8).toUpperCase())}${mapLink(s.active.driverLoc) ? ` · <a target="_blank" rel="noopener" href="${mapLink(s.active.driverLoc)}">الموقع المباشر</a>` : ""}</div>` : ""}
        ${loc ? `<div style="font-size:12px;color:#64748b">آخر موقع: <a target="_blank" rel="noopener" href="${loc}">فتح فالخريطة 📍</a></div>` : ""}` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${d.status !== "active" ? `<button class="add" data-set="${d.id}|active" style="padding:8px 16px;font-size:13px">✅ تفعيل</button>` : ""}
        ${d.status === "active" ? `<button class="btn-outline-sm" data-set="${d.id}|suspended" style="color:#dc2626">⛔ إيقاف</button>` : ""}
        ${d.status === "pending" ? `<button class="btn-outline-sm" data-set="${d.id}|suspended" style="color:#dc2626">رفض</button>` : ""}
        ${d.status === "suspended" ? `<button class="btn-outline-sm" data-del="${d.id}" style="color:#dc2626">🗑 حذف</button>` : ""}
      </div></div>`;
  };

  const recent = deliveries.slice(0, 25);
  const nameOf = (id) => drivers.find((d) => d.id === id)?.name || "—";
  el.innerHTML = `
    <div class="admin-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px">🛵 السائقون</h3>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:700">أتعاب السائق عن كل توصيلة (درهم)
          <input id="drFee" type="number" min="0" step="0.5" value="${fee}" style="display:block;margin-top:4px;padding:10px;border:1px solid #ddd;border-radius:10px;width:160px"></label>
        <button class="add" id="drFeeSave" style="padding:10px 18px">حفظ</button>
      </div>
      <p style="font-size:12px;color:#78716c;margin:8px 0 0">كتتسجل وقت بداية كل توصيلة، فتغيير الرقم ما كيأثرش على التوصيلات القديمة. رابط تطبيق السائق: <b dir="ltr">${esc(location.origin + location.pathname.replace(/[^/]*$/, ""))}driver/</b></p>
    </div>
    ${pending.length ? `<h4 style="margin:14px 4px 8px">⏳ طلبات التسجيل (${pending.length})</h4>${pending.map(card).join("")}` : ""}
    <h4 style="margin:14px 4px 8px">✅ السائقون المفعّلون (${active.length})</h4>
    ${active.length ? active.map(card).join("") : `<div class="empty">ما كاين سائقين مفعّلين بعد. خلّي السائق يسجل من تطبيق السائق، ومن بعد فعّلو من هنا.</div>`}
    ${susp.length ? `<h4 style="margin:14px 4px 8px">⛔ الموقوفون (${susp.length})</h4>${susp.map(card).join("")}` : ""}
    <h4 style="margin:14px 4px 8px">آخر التوصيلات</h4>
    <div class="admin-card">${recent.length ? recent.map((d) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px">
      <span>WJ-${esc(String(d.orderId).slice(0, 8).toUpperCase())} · ${esc(d.date)}<br><small style="color:#64748b">${esc(nameOf(d.driverId))}</small></span>
      <span style="text-align:end">${esc(DEL_AR[d.status] || d.status)}${d.status === "delivered" && d.cod ? `<br><small style="color:#92400e">كاش ${money(d.collected)}</small>` : ""}${d.status === "failed" ? `<br><small style="color:#dc2626">${esc(d.failReason || "")}</small>` : ""}</span></div>`).join("") : `<div class="empty">ما كاين توصيلات بعد.</div>`}</div>`;

  el.querySelector("#drFeeSave").onclick = async () => {
    const v = Number(document.getElementById("drFee").value);
    if (!(v >= 0 && v <= 10000)) return ctx.toast("قيمة غير صحيحة", "error");
    try { await setDoc(doc(db, "config", "driverSettings"), { feePerDelivery: v, updatedAt: serverTimestamp() }, { merge: true }); ctx.toast("تم حفظ الأتعاب ✓"); }
    catch (e) { ctx.toast("تعذر الحفظ (تأكد من نشر القواعد الجديدة)", "error"); }
  };
  el.querySelectorAll("[data-set]").forEach((b) => (b.onclick = async () => {
    const [id, status] = b.dataset.set.split("|");
    try {
      await updateDoc(doc(db, "drivers", id), { status, statusUpdatedAt: serverTimestamp(), statusUpdatedBy: auth.currentUser.uid });
      ctx.toast(status === "active" ? "تم تفعيل السائق ✓" : "تم تحديث الحالة ✓"); renderDriversTab(el);
    } catch (e) { ctx.toast("تعذر التحديث", "error"); }
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("حذف سجل هاد السائق نهائيا؟")) return;
    try { const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"); await deleteDoc(doc(db, "drivers", b.dataset.del)); renderDriversTab(el); }
    catch (e) { ctx.toast("تعذر الحذف", "error"); }
  }));
}

// يتحط داخل تفاصيل الطلب: تعيين/تغيير/إلغاء السائق + حالة التوصيلات
export async function mountAssignDriver(box, order) {
  if (!box) return;
  box.innerHTML = `<h4>🛵 السائق</h4><div style="color:#78716c;font-size:13px">جارٍ التحميل...</div>`;
  let drivers = [], dels = [];
  try {
    const [dr, de] = await Promise.all([
      getDocs(query(collection(db, "drivers"), where("status", "==", "active"))),
      getDocs(query(collection(db, "deliveries"), where("orderId", "==", order.id))),
    ]);
    drivers = dr.docs.map((d) => ({ id: d.id, ...d.data() }));
    dels = de.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { box.innerHTML = `<h4>🛵 السائق</h4><div style="color:#dc2626;font-size:13px">تعذر التحميل (نشر قواعد Firestore الجديدة مطلوب).</div>`; return; }
  const cur = order.driverId;
  const cancelled = ["ملغى من طرف الزبون", "ملغى من المشرف", "ملغي"].includes(order.status);
  box.innerHTML = `<h4>🛵 السائق</h4>
    ${cur ? `<div class="order-detail-row"><span>المعيّن حاليا</span><b>${esc(order.driverName || "")} · <a href="tel:${esc(order.driverPhone || "")}" dir="ltr">${esc(order.driverPhone || "")}</a></b></div>` : `<div class="order-detail-row"><span style="color:#78716c">ما معيّن حتى سائق</span></div>`}
    <select id="asDriver" style="margin-top:6px" ${cancelled ? "disabled" : ""}>
      <option value="">— اختر سائقا —</option>
      ${drivers.map((d) => `<option value="${d.id}" ${d.id === cur ? "selected" : ""}>${esc(d.name)} ${isOnline(d) ? "● متصل" : "○"}</option>`).join("")}
    </select>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button type="button" class="add" id="asSave" style="padding:8px 16px;font-size:13px" ${cancelled ? "disabled" : ""}>${cur ? "تغيير السائق" : "تعيين السائق"}</button>
      ${cur ? `<button type="button" class="btn-outline-sm" id="asClear" style="color:#dc2626">إلغاء التعيين</button>` : ""}
    </div>
    ${!drivers.length ? `<p style="font-size:12px;color:#78716c">ما كاين سائقين مفعّلين. فعّلهم من تاب «السائقون».</p>` : ""}
    ${dels.length ? `<div style="margin-top:10px;font-size:13px"><b>حالة التوصيلات:</b>${dels.map((d) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #e5e7eb"><span>${esc(d.date)}</span><span>${esc(DEL_AR[d.status] || d.status)}${d.status === "delivered" && d.cod ? ` · كاش ${money(d.collected)}` : ""}${isLive(d) && mapLink(d.driverLoc) ? ` · <a target="_blank" rel="noopener" href="${mapLink(d.driverLoc)}">تتبع 📍</a>` : ""}</span></div>`).join("")}</div>` : ""}`;
  const save = box.querySelector("#asSave");
  if (save) save.onclick = async () => {
    const id = box.querySelector("#asDriver").value; if (!id) return ctx.toast("اختر سائقا أولا", "error");
    const d = drivers.find((x) => x.id === id);
    try {
      await updateDoc(doc(db, "orders", order.id), { driverId: d.id, driverName: d.name, driverPhone: d.phone, assignedAt: serverTimestamp(), assignedBy: auth.currentUser.uid });
      order.driverId = d.id; order.driverName = d.name; order.driverPhone = d.phone;
      ctx.toast("تم تعيين السائق ✓"); mountAssignDriver(box, order);
    } catch (e) { ctx.toast("تعذر التعيين", "error"); }
  };
  const clr = box.querySelector("#asClear");
  if (clr) clr.onclick = async () => {
    try {
      await updateDoc(doc(db, "orders", order.id), { driverId: deleteField(), driverName: deleteField(), driverPhone: deleteField(), assignedAt: deleteField(), assignedBy: deleteField() });
      delete order.driverId; delete order.driverName; delete order.driverPhone;
      ctx.toast("تم إلغاء التعيين"); mountAssignDriver(box, order);
    } catch (e) { ctx.toast("تعذر الإلغاء", "error"); }
  };
}
function isLive(d) { return d.status === "pickedUp" || d.status === "arrived"; }
