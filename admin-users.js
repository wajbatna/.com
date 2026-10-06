// admin-users.js — صفحتا "المستخدمون / إدارة الحسابات" و"سياسة الخصوصية" فلوحة المشرف.
// مدمجتان فنفس لوحة التحكم (يستدعيهما admin.js) ويستعملان نفس Firebase Auth/Firestore.
// الحذف والحظر كيدوزو عبر Cloudflare Worker (Admin SDK) — ما كاين حتى سر فالـ Frontend.
import { db, auth } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const PAGE_SIZE = 50;
let ctx = { toast: (m) => alert(m), ico: () => "" };
export function initAdminExtras(c) {
  ctx = { ...ctx, ...c };
}

/* ───────────── مساعدات ───────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const money = (n) => Math.round(n || 0).toLocaleString("ar-MA") + " درهم";
const tsDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const fmtDate = (d) => (d ? d.toLocaleDateString("ar-MA", { day: "numeric", month: "long", year: "numeric" }) : "—");
const fmtTime = (d) => (d ? d.toLocaleTimeString("ar-MA", { hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDateTime = (d) => (d ? fmtDate(d) + " " + fmtTime(d) : "—");
const orderCode = (id) => "WJ-" + String(id || "").slice(0, 8).toUpperCase();
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isCancelled = (st) => st === "ملغي" || st === "ملغى من طرف الزبون" || st === "ملغى من المشرف";

/* ═════════════════════════════════════════════════════════════
   1) المستخدمون / إدارة الحسابات
   ═════════════════════════════════════════════════════════════ */
const U = {
  rows: [], // المستخدمون المحمّلون (صفحات متتالية)
  cursor: null, // آخر وثيقة محمّلة (للتحميل التدريجي)
  done: false,
  loading: false,
  error: false,
  orderStats: new Map(), // uid -> {count,total,last}
  filters: { q: "", gender: "all", date: "all", month: "", from: "", to: "", orders: "all", status: "all", sort: "newest" },
  source: "users", // "users" | "deletedUsers"
};

async function loadStats() {
  const col = collection(db, "users");
  const now = new Date();
  const today = startOfDay(now);
  const since = (days) => Timestamp.fromDate(new Date(today.getTime() - (days - 1) * 86400000));
  const cnt = async (...c) => (await getCountFromServer(query(col, ...c))).data().count;
  try {
    const [total, today_, d7, d30, male, female, withOrders] = await Promise.all([
      cnt(),
      cnt(where("createdAt", ">=", Timestamp.fromDate(today))),
      cnt(where("createdAt", ">=", since(7))),
      cnt(where("createdAt", ">=", since(30))),
      cnt(where("gender", "==", "male")),
      cnt(where("gender", "==", "female")),
      cnt(where("orderCount", ">", 0)),
    ]);
    return { total, today: today_, d7, d30, male, female, withOrders, withoutOrders: Math.max(0, total - withOrders) };
  } catch (e) {
    return null;
  }
}

// إحصائيات الطلبات لكل مستخدم (مجموعات صغيرة 'in' ≤ 30) — فقط للمستخدمين لي ظاهرين، ماشي كل الطلبات
async function loadOrderStatsFor(uids) {
  const need = uids.filter((u) => !U.orderStats.has(u));
  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30);
    chunk.forEach((u) => U.orderStats.set(u, { count: 0, total: 0, last: null }));
    try {
      const snap = await getDocs(query(collection(db, "orders"), where("uid", "in", chunk)));
      snap.forEach((d) => {
        const o = d.data();
        const st = U.orderStats.get(o.uid);
        if (!st) return;
        st.count++;
        if (!isCancelled(o.status)) st.total += Number(o.total) || 0;
        const c = tsDate(o.createdAt);
        if (c && (!st.last || c > st.last)) st.last = c;
        if (!st.name && o.customer?.name) st.name = o.customer.name;
      });
    } catch (e) {
      /* نبقاو على 0 */
    }
  }
}

async function loadMoreUsers() {
  if (U.loading || U.done) return;
  U.loading = true;
  U.error = false;
  paintUsersList();
  try {
    // بلا orderBy باش حتى الحسابات القديمة لي ما عندها createdAt تبان (ترتيب العرض كيتدار فالواجهة)
    const q = U.cursor
      ? query(collection(db, U.source), startAfter(U.cursor), limit(PAGE_SIZE))
      : query(collection(db, U.source), limit(PAGE_SIZE));
    const snap = await getDocs(q);
    const batch = snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
    U.rows.push(...batch);
    U.cursor = snap.docs[snap.docs.length - 1] || U.cursor;
    if (snap.docs.length < PAGE_SIZE) U.done = true;
    if (U.source === "users") await loadOrderStatsFor(batch.map((u) => u.uid));
  } catch (e) {
    U.error = true;
  }
  U.loading = false;
  paintUsersList();
}

function resetUsers(source) {
  U.source = source;
  U.rows = [];
  U.cursor = null;
  U.done = false;
  U.error = false;
}

// البحث الدقيق بـ UID أو رقم الهاتف مباشرة من Firestore (حتى لو المستخدم ما تحمّلش بعد)
async function serverSearch(qtext) {
  const q = qtext.trim();
  if (!q) return;
  const found = new Map();
  try {
    const byId = await getDoc(doc(db, U.source, q));
    if (byId.exists()) found.set(byId.id, { ...byId.data(), uid: byId.id });
  } catch (_) {}
  try {
    let phone = q.replace(/[\s-]/g, "");
    if (phone.startsWith("+212")) phone = "0" + phone.slice(4);
    const snap = await getDocs(query(collection(db, U.source), where("phone", "==", phone), limit(10)));
    snap.forEach((d) => found.set(d.id, { ...d.data(), uid: d.id }));
  } catch (_) {}
  const fresh = [...found.values()].filter((r) => !U.rows.some((x) => x.uid === r.uid));
  if (fresh.length) {
    U.rows.push(...fresh);
    if (U.source === "users") await loadOrderStatsFor(fresh.map((u) => u.uid));
  }
}

function userStatus(u) {
  if (U.source === "deletedUsers") return "deleted";
  return u.status === "banned" ? "banned" : "active";
}
const STATUS_AR = { active: "نشط", banned: "محظور", deleted: "محذوف" };
const STATUS_STYLE = { active: "background:#dcfce7;color:#166534", banned: "background:#fee2e2;color:#991b1b", deleted: "background:#e7e5e4;color:#44403c" };

function userName(u) {
  return u.name || U.orderStats.get(u.uid)?.name || "—";
}
function userEmail(u) {
  return u.email || "—";
}

function applyFilters() {
  const f = U.filters;
  const now = new Date();
  const today = startOfDay(now);
  const q = f.q.trim().toLowerCase();
  const qPhone = q.replace(/[\s-]/g, "");
  let list = U.rows.filter((u) => {
    if (q) {
      const hay = [userName(u), u.email, u.phone, u.uid].map((x) => String(x || "").toLowerCase());
      if (!hay.some((h) => h.includes(q) || (qPhone && h.replace(/[\s-]/g, "").includes(qPhone)))) return false;
    }
    if (f.gender !== "all" && u.gender !== f.gender) return false;
    const c = tsDate(u.createdAt);
    if (f.date !== "all") {
      if (!c) return false;
      const t = c.getTime();
      const T = today.getTime();
      if (f.date === "today" && t < T) return false;
      if (f.date === "yesterday" && !(t >= T - 86400000 && t < T)) return false;
      if (f.date === "7d" && t < T - 6 * 86400000) return false;
      if (f.date === "30d" && t < T - 29 * 86400000) return false;
      if (f.date === "month" && !(c.getFullYear() === now.getFullYear() && c.getMonth() === now.getMonth())) return false;
      if (f.date === "specific") {
        if (!f.month) return false;
        const [y, m] = f.month.split("-").map(Number);
        if (!(c.getFullYear() === y && c.getMonth() === m - 1)) return false;
      }
      if (f.date === "custom") {
        if (f.from && t < new Date(f.from + "T00:00:00").getTime()) return false;
        if (f.to && t >= new Date(f.to + "T00:00:00").getTime() + 86400000) return false;
      }
    }
    const os = U.orderStats.get(u.uid);
    const cnt = os ? os.count : u.orderCount || 0;
    if (f.orders === "with" && cnt === 0) return false;
    if (f.orders === "without" && cnt > 0) return false;
    if (f.status !== "all" && f.status !== "deleted" && userStatus(u) !== f.status) return false;
    return true;
  });
  const val = (u) => ({
    created: tsDate(u.createdAt)?.getTime() || 0,
    count: U.orderStats.get(u.uid)?.count || 0,
    last: U.orderStats.get(u.uid)?.last?.getTime() || 0,
  });
  list.sort((a, b) => {
    if (f.sort === "oldest") return (val(a).created || Infinity) - (val(b).created || Infinity);
    if (f.sort === "name") return userName(a).localeCompare(userName(b), "ar");
    if (f.sort === "orders") return val(b).count - val(a).count;
    if (f.sort === "lastOrder") return val(b).last - val(a).last;
    return val(b).created - val(a).created;
  });
  return list;
}

export async function renderUsersTab(el) {
  U.el = el;
  resetUsers("users");
  U.filters.status = U.filters.status === "deleted" ? "all" : U.filters.status;
  el.innerHTML = `
  <div class="admin-card">
    <h3 style="margin:0 0 12px;color:#064e3b">${ctx.ico("customers")}المستخدمون / إدارة الحسابات</h3>
    <div id="usersStats" class="users-stats"><div class="empty" style="padding:16px;grid-column:1/-1">جارٍ تحميل الإحصائيات...</div></div>
  </div>
  <div class="admin-card">
    <div class="users-filters">
      <div class="uf-wide"><label>بحث (الاسم / البريد / الهاتف / UID)</label><input id="ufQ" type="search" placeholder="ابحث..." value="${esc(U.filters.q)}"></div>
      <div><label>الجنس</label><select id="ufGender"><option value="all">الكل</option><option value="male">ذكر</option><option value="female">أنثى</option></select></div>
      <div><label>تاريخ الإنشاء</label><select id="ufDate">
        <option value="all">الكل</option><option value="today">اليوم</option><option value="yesterday">أمس</option>
        <option value="7d">آخر 7 أيام</option><option value="30d">آخر 30 يوماً</option><option value="month">هذا الشهر</option>
        <option value="specific">شهر محدد</option><option value="custom">تاريخ مخصص</option></select></div>
      <div id="ufMonthWrap" style="display:none"><label>الشهر</label><input id="ufMonth" type="month"></div>
      <div id="ufFromWrap" style="display:none"><label>من</label><input id="ufFrom" type="date"></div>
      <div id="ufToWrap" style="display:none"><label>إلى</label><input id="ufTo" type="date"></div>
      <div><label>الطلبات</label><select id="ufOrders"><option value="all">الكل</option><option value="with">لديه طلبات</option><option value="without">بدون طلبات</option></select></div>
      <div><label>حالة الحساب</label><select id="ufStatus"><option value="all">الكل</option><option value="active">نشط</option><option value="banned">محظور</option><option value="deleted">محذوف</option></select></div>
      <div><label>الترتيب</label><select id="ufSort"><option value="newest">الأحدث إنشاءً</option><option value="oldest">الأقدم</option><option value="name">الاسم</option><option value="orders">عدد الطلبات</option><option value="lastOrder">آخر طلب</option></select></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="btn-outline-sm" id="ufServerSearch">🔎 بحث دقيق في السيرفر (UID / هاتف)</button>
      <button type="button" class="btn-outline-sm" id="ufReset">إعادة ضبط الفلاتر</button>
    </div>
  </div>
  <div id="usersList"></div>`;
  const f = U.filters;
  const bind = (id, key, ev = "change") => {
    const n = document.getElementById(id);
    if (!n) return;
    n.value = f[key];
    n.addEventListener(ev, () => {
      f[key] = n.value;
      if (id === "ufDate") syncDateInputs();
      if (id === "ufStatus") return onStatusChange();
      paintUsersList();
    });
  };
  bind("ufQ", "q", "input");
  bind("ufGender", "gender");
  bind("ufDate", "date");
  bind("ufMonth", "month");
  bind("ufFrom", "from");
  bind("ufTo", "to");
  bind("ufOrders", "orders");
  bind("ufStatus", "status");
  bind("ufSort", "sort");
  syncDateInputs();
  document.getElementById("ufReset").addEventListener("click", () => {
    Object.assign(U.filters, { q: "", gender: "all", date: "all", month: "", from: "", to: "", orders: "all", status: "all", sort: "newest" });
    renderUsersTab(el);
  });
  document.getElementById("ufServerSearch").addEventListener("click", async () => {
    if (!U.filters.q.trim()) return ctx.toast("اكتب UID أو رقم الهاتف أولاً", "error");
    await serverSearch(U.filters.q);
    paintUsersList();
  });
  loadStats().then(paintStats);
  loadMoreUsers();
}

function syncDateInputs() {
  const d = U.filters.date;
  const set = (id, on) => {
    const n = document.getElementById(id);
    if (n) n.style.display = on ? "" : "none";
  };
  set("ufMonthWrap", d === "specific");
  set("ufFromWrap", d === "custom");
  set("ufToWrap", d === "custom");
}

// "محذوف" كيقرا من أرشيف deletedUsers (المستخدم المحذوف ما بقاش فمجموعة users)
async function onStatusChange() {
  const wantDeleted = U.filters.status === "deleted";
  if (wantDeleted !== (U.source === "deletedUsers")) {
    resetUsers(wantDeleted ? "deletedUsers" : "users");
    await loadMoreUsers();
  } else paintUsersList();
}

function paintStats(s) {
  const box = document.getElementById("usersStats");
  if (!box) return;
  if (!s) {
    box.innerHTML = `<div class="empty" style="padding:16px;grid-column:1/-1">⚠️ تعذر تحميل الإحصائيات.</div>`;
    return;
  }
  const items = [
    ["إجمالي المستخدمين", s.total],
    ["جدد اليوم", s.today],
    ["جدد آخر 7 أيام", s.d7],
    ["جدد آخر 30 يوماً", s.d30],
    ["الذكور", s.male],
    ["الإناث", s.female],
    ["لديهم طلبات", s.withOrders],
    ["بدون طلبات", s.withoutOrders],
  ];
  box.innerHTML = items.map(([l, v]) => `<div class="stat-box"><b>${v.toLocaleString("ar-MA")}</b><span>${l}</span></div>`).join("");
}

function paintUsersList() {
  const box = document.getElementById("usersList");
  if (!box) return;
  const list = applyFilters();
  let html = "";
  if (U.error) {
    html += `<div class="empty">⚠️ تعذر تحميل المستخدمين. <button class="btn-outline-sm" id="usersRetry">إعادة المحاولة</button></div>`;
  } else if (!list.length && U.loading) {
    html += `<div class="empty">${ctx.ico("loading")}جارٍ التحميل...</div>`;
  } else if (!list.length) {
    html += `<div class="empty">لا يوجد مستخدمون مطابقون.${!U.done ? " (جرّب «تحميل المزيد» — الفلاتر تُطبَّق على المستخدمين المحمّلين)" : ""}</div>`;
  } else {
    html += `<div style="font-size:12px;color:#78716c;margin:0 4px 8px">المعروض: ${list.length} من ${U.rows.length} محمّل</div>
    <div class="users-table-wrap"><table class="users-table"><thead><tr>
      <th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الجنس</th><th>تاريخ الإنشاء</th><th>الوقت</th><th>آخر دخول</th><th>الحالة</th><th>الطلبات</th><th>الإجمالي</th><th>آخر طلب</th><th></th>
    </tr></thead><tbody>${list
      .map((u) => {
        const c = tsDate(u.createdAt);
        const st = userStatus(u);
        const os = U.orderStats.get(u.uid);
        return `<tr>
        <td><b>${esc(userName(u))}</b><div class="uid-small">${esc(u.uid)}</div></td>
        <td>${esc(userEmail(u))}</td>
        <td dir="ltr" style="text-align:right">${esc(u.phone || "—")}</td>
        <td>${u.gender === "female" ? "أنثى" : u.gender === "male" ? "ذكر" : "—"}</td>
        <td>${fmtDate(c)}</td><td>${fmtTime(c)}</td>
        <td>${fmtDateTime(tsDate(u.lastLoginAt))}</td>
        <td><span class="status-badge" style="${STATUS_STYLE[st]}">${STATUS_AR[st]}</span></td>
        <td>${os ? os.count : u.orderCount || 0}</td>
        <td>${os ? money(os.total) : "—"}</td>
        <td>${fmtDate(os?.last)}</td>
        <td><button type="button" class="btn-outline-sm" data-user="${esc(u.uid)}">تفاصيل</button></td>
      </tr>`;
      })
      .join("")}</tbody></table></div>`;
  }
  if (!U.done && !U.error) {
    html += `<div style="text-align:center;margin:14px 0"><button type="button" class="add" id="usersMore" ${U.loading ? "disabled" : ""}>${U.loading ? "جارٍ التحميل..." : "تحميل المزيد"}</button></div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-user]").forEach((b) => b.addEventListener("click", () => openUserDetail(b.dataset.user)));
  document.getElementById("usersMore")?.addEventListener("click", loadMoreUsers);
  document.getElementById("usersRetry")?.addEventListener("click", loadMoreUsers);
}

/* ───────────── تفاصيل المستخدم ───────────── */
async function openUserDetail(uid) {
  const u = U.rows.find((x) => x.uid === uid);
  if (!u) return;
  const modal = document.getElementById("adminModal");
  const box = document.getElementById("adminModalBox");
  modal.classList.add("show");
  box.innerHTML = `<div class="empty">${ctx.ico("loading")}جارٍ التحميل...</div>`;
  let orders = [];
  let ordersErr = false;
  if (U.source === "users" || true) {
    try {
      const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", uid)));
      orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (tsDate(b.createdAt)?.getTime() || 0) - (tsDate(a.createdAt)?.getTime() || 0));
    } catch (e) {
      ordersErr = true;
    }
  }
  const valid = orders.filter((o) => !isCancelled(o.status));
  const totalSum = valid.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const st = userStatus(u);
  const c = tsDate(u.createdAt);
  const row = (l, v) => `<div class="order-detail-row"><span>${l}</span><b style="text-align:left;overflow-wrap:anywhere">${v}</b></div>`;
  const known = new Set(["name", "email", "phone", "gender", "avatar", "address", "createdAt", "lastLoginAt", "status", "orderCount", "referralCode", "referredByUid", "referralBonusGiven", "ordersThisMonth", "lastOrderMonthKey", "orderMilestone3Given", "privacyPolicyAccepted", "privacyPolicyVersion", "privacyPolicyAcceptedAt", "uid", "statusUpdatedAt", "statusUpdatedBy", "deletedAt", "deletedBy"]);
  const extra = Object.entries(u).filter(([k]) => !known.has(k));
  const isDeleted = st === "deleted";
  box.innerHTML = `
    <div class="modal-head"><h3 style="margin:0;color:#064e3b">تفاصيل المستخدم</h3><button class="close" id="umClose">✕</button></div>
    <div class="order-detail-section"><h4>المعلومات الأساسية</h4>
      ${row("الاسم", esc(userName(u)))}${row("الجنس", u.gender === "female" ? "أنثى" : u.gender === "male" ? "ذكر" : "—")}
      ${row("البريد", esc(userEmail(u)))}${row("الهاتف", esc(u.phone || "—"))}
      ${row("حالة الحساب", `<span class="status-badge" style="${STATUS_STYLE[st]}">${STATUS_AR[st]}</span>`)}
      ${row("تاريخ إنشاء الحساب", fmtDateTime(c))}${row("آخر تسجيل دخول", fmtDateTime(tsDate(u.lastLoginAt)))}
      ${isDeleted ? row("تاريخ الحذف", fmtDateTime(tsDate(u.deletedAt))) : ""}
      ${row("UID", `<span dir="ltr" style="font-size:11px">${esc(u.uid)}</span>`)}
    </div>
    <div class="order-detail-section"><h4>العنوان</h4>${row("العنوان المحفوظ", esc(u.address || "—"))}</div>
    <div class="order-detail-section"><h4>الإحصائيات</h4>
      ${row("عدد الطلبات", orders.length)}${row("إجمالي المبالغ (بدون الملغاة)", money(totalSum))}
      ${row("آخر طلب", fmtDateTime(tsDate(orders[0]?.createdAt)))}
      ${row("رمز الدعوة", esc(u.referralCode || "—"))}
    </div>
    <div class="order-detail-section"><h4>سياسة الخصوصية</h4>
      ${row("وافق؟", u.privacyPolicyAccepted ? "نعم ✓" : "لا / حساب قديم")}${row("النسخة", esc(u.privacyPolicyVersion || "—"))}${row("تاريخ الموافقة", fmtDateTime(tsDate(u.privacyPolicyAcceptedAt)))}
    </div>
    ${extra.length ? `<div class="order-detail-section"><h4>بيانات أخرى</h4>${extra.map(([k, v]) => row(esc(k), esc(typeof v === "object" ? JSON.stringify(v?.toDate ? v.toDate() : v) : v))).join("")}</div>` : ""}
    <div class="order-detail-section"><h4>الطلبات السابقة</h4>
      ${ordersErr ? `<div class="empty" style="padding:14px">⚠️ تعذر تحميل الطلبات.</div>` : ""}
      ${!ordersErr && !orders.length ? `<div class="empty" style="padding:14px">لا توجد طلبات.</div>` : ""}
      ${orders
        .map(
          (o) => `<div class="user-order">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${orderCode(o.id)}</b><span class="status-badge ${isCancelled(o.status) ? "status-cancelled" : "status-pending"}">${esc(o.status || "قيد المراجعة")}</span></div>
        <div style="font-size:12px;color:#78716c">${fmtDateTime(tsDate(o.createdAt))} · ${esc(o.paymentMethodLabel || "—")} · <b style="color:#047857">${money(o.total)}</b></div>
        <div style="font-size:12px;margin-top:4px">${(o.items || []).map((i) => esc(i.name) + " ×" + esc(i.qty)).join("، ")}</div>
        <div style="font-size:12px;color:#57534e;margin-top:4px">📍 ${esc(o.customer?.address || "—")}</div>
        ${o.cancelledAt ? `<div style="font-size:12px;color:#991b1b;margin-top:4px">أُلغي (${o.cancelledBy === "customer" ? "من الزبون" : "من المشرف"}) — ${fmtDateTime(tsDate(o.cancelledAt))}${o.cancellationReason ? " — " + esc(o.cancellationReason) : ""}</div>` : ""}
      </div>`
        )
        .join("")}
    </div>
    ${
      isDeleted
        ? ""
        : `<div class="order-detail-section" style="border-color:#fecaca"><h4 style="color:#991b1b">إدارة الحساب</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-outline-sm" id="umBan">${st === "banned" ? "إلغاء الحظر" : "حظر الحساب"}</button>
        <button type="button" class="btn-danger-sm" id="umDelete">حذف الحساب</button>
      </div></div>`
    }`;
  document.getElementById("umClose").addEventListener("click", closeAdminModal);
  document.getElementById("umBan")?.addEventListener("click", () => toggleBan(u));
  document.getElementById("umDelete")?.addEventListener("click", () => confirmDeleteUser(u));
}
function closeAdminModal() {
  document.getElementById("adminModal").classList.remove("show");
}

/* ───────────── حذف/حظر الحساب — Firebase + قواعد Firestore فقط (بدون Worker) ───────────── */
// ملاحظة: متصفح الأدمين ما يقدرش يمسح حساب الدخول (Auth) ديال شخص آخر (كيحتاج Admin SDK).
// فكنمسحو بيانات Firestore + كنكتبو شاهد فـ deletedUsers؛ وعند أول محاولة دخول للزبون،
// التطبيق كيمسح حساب Auth ديالو بنفسو وكيخرجو (انظر app.js). حتى لذاك الوقت: ما يقدرش يدير طلبات ولا يخلق ملف.
async function isTargetAdmin(uid) {
  try {
    return (await getDoc(doc(db, "admins", uid))).exists();
  } catch (_) {
    return true; // احتياطاً: إلا ما قدرناش نتأكدو، ما نكملوش
  }
}

function adminAccountGuard(u) {
  if (u.uid === auth.currentUser?.uid) {
    ctx.toast("لا يمكنك تنفيذ هذه العملية على حسابك أنت", "error");
    return false;
  }
  return true;
}

async function toggleBan(u) {
  if (!adminAccountGuard(u)) return;
  const ban = u.status !== "banned";
  try {
    if (await isTargetAdmin(u.uid)) return ctx.toast("لا يمكن تنفيذ العملية على حساب مشرف", "error");
    await updateDoc(doc(db, "users", u.uid), { status: ban ? "banned" : "active", statusUpdatedAt: serverTimestamp(), statusUpdatedBy: auth.currentUser.uid });
    u.status = ban ? "banned" : "active";
    ctx.toast(ban ? "تم حظر الحساب ✓" : "تم إلغاء الحظر ✓");
    openUserDetail(u.uid);
    paintUsersList();
  } catch (e) {
    ctx.toast("تعذر تنفيذ العملية (تحقق من نشر قواعد Firestore).", "error");
  }
}

// نافذة تأكيد الحذف (ما كيتمش الحذف مباشرة)
function confirmDeleteUser(u) {
  if (!adminAccountGuard(u)) return;
  const box = document.getElementById("adminModalBox");
  box.innerHTML = `
    <div style="text-align:center;padding:6px 2px">
      <div style="font-size:42px">⚠️</div>
      <h3 style="color:#991b1b;margin:6px 0">هل أنت متأكد من حذف هذا الحساب؟</h3>
      <p style="color:#57534e;font-size:14px;margin:6px 0"><b>${esc(userName(u))}</b> — ${esc(u.phone || u.uid)}</p>
      <p style="color:#78716c;font-size:13px;line-height:1.7">تحذير: سيتم حذف الملف الشخصي وبطاقة العضوية نهائياً، ولن يستطيع الزبون الدخول أو الطلب بعد الآن (يُمسح حساب دخوله عند أول محاولة). تبقى الطلبات السابقة محفوظة كسجل للإدارة والإحصائيات. لا يمكن التراجع عن هذه العملية.</p>
      <p id="delErr" style="color:#dc2626;font-size:12px"></p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn-outline-sm" style="flex:1;padding:12px" id="delCancel">إلغاء</button>
        <button type="button" class="btn-danger-sm" style="flex:1;padding:12px" id="delOk">حذف الحساب</button>
      </div>
    </div>`;
  document.getElementById("delCancel").addEventListener("click", () => openUserDetail(u.uid));
  document.getElementById("delOk").addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = "جارٍ الحذف...";
    try {
      if (await isTargetAdmin(u.uid)) throw new Error("لا يمكن حذف حساب مشرف");
      // دفعة واحدة (كلها أو لا شيء): شاهد الحذف + مسح الملف الشخصي + بطاقة العضوية + كود الدعوة. الطلبات كتبقى.
      const b = writeBatch(db);
      b.set(doc(db, "deletedUsers", u.uid), {
        phone: String(u.phone || ""),
        gender: String(u.gender || ""),
        name: String(u.name || ""),
        email: String(u.email || ""),
        ...(u.createdAt ? { createdAt: u.createdAt } : {}),
        deletedAt: serverTimestamp(),
        deletedBy: auth.currentUser.uid,
      });
      b.delete(doc(db, "users", u.uid));
      b.delete(doc(db, "members", u.uid));
      if (u.referralCode) b.delete(doc(db, "referralCodes", String(u.referralCode)));
      await b.commit();
      U.rows = U.rows.filter((x) => x.uid !== u.uid);
      closeAdminModal();
      ctx.toast("تم حذف الحساب ✓");
      paintUsersList();
      loadStats().then(paintStats);
    } catch (e) {
      document.getElementById("delErr").textContent = e.message && e.message.startsWith("لا يمكن") ? e.message : "تعذر الحذف (تحقق من نشر قواعد Firestore).";
      ev.target.disabled = false;
      ev.target.textContent = "حذف الحساب";
    }
  });
}

/* ═════════════════════════════════════════════════════════════
   2) إدارة سياسة الخصوصية
   ═════════════════════════════════════════════════════════════ */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

export async function renderPrivacyTab(el) {
  el.innerHTML = `<div class="empty">${ctx.ico("loading")}جارٍ تحميل سياسة الخصوصية...</div>`;
  let live = null;
  let versions = [];
  try {
    const [liveSnap, vSnap] = await Promise.all([getDoc(doc(db, "config", "privacyPolicy")), getDocs(query(collection(db, "privacyPolicyVersions"), limit(100)))]);
    live = liveSnap.exists() ? liveSnap.data() : null;
    versions = vSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    el.innerHTML = `<div class="empty">⚠️ تعذر تحميل سياسة الخصوصية. <button class="btn-outline-sm" id="ppRetry">إعادة المحاولة</button></div>`;
    document.getElementById("ppRetry").addEventListener("click", () => renderPrivacyTab(el));
    return;
  }
  versions.sort((a, b) => (tsDate(b.updatedAt)?.getTime() || 0) - (tsDate(a.updatedAt)?.getTime() || 0));
  const isLive = live && live.published === true;
  const base = live || versions[0] || { version: "1.0", title: "سياسة الخصوصية", content: "" };
  el.innerHTML = `
  <div class="admin-card">
    <h3 style="margin:0 0 6px;color:#064e3b">سياسة الخصوصية</h3>
    <div style="font-size:13px;margin-bottom:10px">الحالة: ${
      isLive
        ? `<span class="status-badge" style="background:#dcfce7;color:#166534">منشورة — الإصدار ${esc(live.version)}</span>`
        : `<span class="status-badge" style="background:#fef3c7;color:#92400e">غير منشورة (يُعرض النص الافتراضي للزبناء)</span>`
    }
    ${live?.updatedAt ? `<div style="color:#78716c;font-size:12px;margin-top:6px">آخر تعديل: ${fmtDateTime(tsDate(live.updatedAt))} — بواسطة <span dir="ltr">${esc(live.updatedBy || "—")}</span></div>` : ""}</div>
    <label>رقم الإصدار</label><input id="ppVersion" maxlength="20" placeholder="مثال: 1.1" value="${esc(base.version)}">
    <label>العنوان</label><input id="ppTitle" maxlength="200" value="${esc(base.title || "سياسة الخصوصية")}">
    <label>نص السياسة</label><textarea id="ppContent" rows="14" maxlength="100000" style="line-height:1.7">${esc(base.content || "")}</textarea>
    <label class="privacy-check-admin"><input type="checkbox" id="ppReaccept" ${live?.requireReaccept ? "checked" : ""}> <span>إلزام المستخدمين الحاليين بالموافقة من جديد على هذه النسخة (يظهر لهم عند فتح الموقع)</span></label>
    <p id="ppErr" style="color:#dc2626;font-size:12px;margin:8px 0 0"></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button type="button" class="btn-outline-sm" id="ppDraft">حفظ كمسودة</button>
      <button type="button" class="add" id="ppPublish">نشر هذه النسخة</button>
      ${isLive ? `<button type="button" class="btn-danger-sm" id="ppUnpublish">إلغاء النشر</button>` : ""}
    </div>
    <div style="font-size:12px;color:#78716c;margin-top:8px">لإنشاء نسخة جديدة: غيّر رقم الإصدار ثم احفظ أو انشر — تبقى النسخ القديمة في الأرشيف أسفله.</div>
  </div>
  <div class="admin-card"><h3 style="margin:0 0 10px;color:#064e3b">أرشيف النسخ</h3>
    ${
      versions.length
        ? versions
            .map(
              (v) => `<div class="user-order" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
      <div><b>الإصدار ${esc(v.version)}</b> <span class="status-badge" style="${v.status === "published" ? "background:#dcfce7;color:#166534" : v.status === "draft" ? "background:#fef3c7;color:#92400e" : "background:#e7e5e4;color:#44403c"}">${v.status === "published" ? "منشورة" : v.status === "draft" ? "مسودة" : "مؤرشفة"}</span>
      <div style="font-size:11px;color:#78716c">${fmtDateTime(tsDate(v.updatedAt))}</div></div>
      <button type="button" class="btn-outline-sm" data-load="${esc(v.id)}">تحميل للتعديل</button></div>`
            )
            .join("")
        : `<div class="empty" style="padding:16px">لا توجد نسخ محفوظة بعد.</div>`
    }
  </div>`;
  const readForm = () => {
    const version = document.getElementById("ppVersion").value.trim();
    const title = document.getElementById("ppTitle").value.trim();
    const content = document.getElementById("ppContent").value;
    const err = document.getElementById("ppErr");
    err.textContent = "";
    if (!VERSION_RE.test(version)) return (err.textContent = "رقم الإصدار غير صالح (حروف/أرقام/نقطة/شرطة، 20 كحد أقصى).") && null;
    if (!title) return (err.textContent = "العنوان مطلوب.") && null;
    if (content.trim().length < 20) return (err.textContent = "نص السياسة قصير جداً.") && null;
    return { version, title, content, requireReaccept: document.getElementById("ppReaccept").checked };
  };
  const adminUid = () => auth.currentUser.uid;

  document.getElementById("ppDraft").addEventListener("click", async () => {
    const f = readForm();
    if (!f) return;
    const existing = versions.find((v) => v.id === f.version);
    if (existing && existing.status === "published") return (document.getElementById("ppErr").textContent = "هذه النسخة منشورة. غيّر رقم الإصدار لإنشاء نسخة جديدة.");
    try {
      await setDoc(
        doc(db, "privacyPolicyVersions", f.version),
        { version: f.version, title: f.title, content: f.content, status: "draft", ...(existing ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp(), updatedBy: adminUid() },
        { merge: true }
      );
      ctx.toast("تم حفظ المسودة ✓");
      renderPrivacyTab(el);
    } catch (e) {
      ctx.toast("تعذر الحفظ.", "error");
    }
  });

  document.getElementById("ppPublish").addEventListener("click", async () => {
    const f = readForm();
    if (!f) return;
    const prev = versions.find((v) => v.status === "published" && v.id !== f.version);
    const sameLive = isLive && live.version === f.version;
    if (sameLive && !confirm("هذه النسخة منشورة بالفعل. تحديث نصها سيغيّره للجميع دون تغيير رقم الإصدار (لن يُطلب من أحد إعادة الموافقة). متابعة؟")) return;
    try {
      const b = writeBatch(db);
      const existing = versions.find((v) => v.id === f.version);
      if (prev) b.set(doc(db, "privacyPolicyVersions", prev.id), { status: "archived", updatedAt: serverTimestamp(), updatedBy: adminUid(), version: prev.version, title: prev.title, content: prev.content }, { merge: true });
      b.set(
        doc(db, "privacyPolicyVersions", f.version),
        { version: f.version, title: f.title, content: f.content, status: "published", ...(existing ? {} : { createdAt: serverTimestamp() }), updatedAt: serverTimestamp(), updatedBy: adminUid() },
        { merge: true }
      );
      b.set(doc(db, "config", "privacyPolicy"), {
        version: f.version,
        title: f.title,
        content: f.content,
        published: true,
        requireReaccept: f.requireReaccept,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: adminUid(),
      });
      await b.commit();
      ctx.toast("تم نشر سياسة الخصوصية ✓");
      renderPrivacyTab(el);
    } catch (e) {
      ctx.toast("تعذر النشر.", "error");
    }
  });

  document.getElementById("ppUnpublish")?.addEventListener("click", async () => {
    if (!confirm("إلغاء النشر؟ سيُعرض النص الافتراضي للمستخدمين الجدد.")) return;
    try {
      const b = writeBatch(db);
      b.set(doc(db, "config", "privacyPolicy"), {
        version: live.version,
        title: live.title || "",
        content: live.content || "",
        published: false,
        requireReaccept: false,
        updatedAt: serverTimestamp(),
        updatedBy: adminUid(),
      });
      b.set(doc(db, "privacyPolicyVersions", live.version), { version: live.version, title: live.title || "", content: live.content || "", status: "archived", updatedAt: serverTimestamp(), updatedBy: adminUid() }, { merge: true });
      await b.commit();
      ctx.toast("تم إلغاء النشر ✓");
      renderPrivacyTab(el);
    } catch (e) {
      ctx.toast("تعذر إلغاء النشر.", "error");
    }
  });

  el.querySelectorAll("[data-load]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = versions.find((x) => x.id === btn.dataset.load);
      if (!v) return;
      document.getElementById("ppVersion").value = v.version;
      document.getElementById("ppTitle").value = v.title || "";
      document.getElementById("ppContent").value = v.content || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
}
