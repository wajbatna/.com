// admin.js — منطق لوحة التحكم (يتطلب تسجيل دخول عبر Firebase Authentication)
import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import { renderUsersTab, renderPrivacyTab, initAdminExtras } from "./admin-users.js";
import "./pw-eye.js";
import { renderLinksTab, initAdminLinks } from "./admin-links.js";

setPersistence(auth, browserLocalPersistence).catch(() => {});

let meals = [];
let currentTab = "meals";
// طرق الأداء الثابتة المتاحة فالموقع — الأدمين كيقدر يفعّل/يعطّل كل وحدة ويحط ليها RIB
const PAYMENT_METHODS = [
  { id: "card", icon: "💳", label: "دفع ببطاقة", img: "img/icons/paiement.webp" },
  { id: "cod", icon: "💵", label: "دفع عند الاستلام", img: "img/icons/money.webp" },
  { id: "tpe", icon: "📟", label: "دفع بواسطة TPE عند الاستلام", img: "img/icons/tpe.webp" },
  { id: "cih", icon: "🏦", label: "دفع عبر تطبيق CIH", img: "img/payments/cih.png" },
  { id: "fellah", icon: "🌾", label: "دفع عبر القرض الفلاحي", img: "img/payments/fellah.jpg" },
  { id: "cashplus", icon: "💸", label: "دفع عبر كاش بليس", img: "img/payments/cashplus.jpg" },
  { id: "wafacash", icon: "💰", label: "دفع عبر وافا كاش", img: "img/payments/wafacash.jpg" },
  { id: "tijari", icon: "🏛", label: "دفع عبر تطبيق تجاري وفا بنك", img: "img/payments/tijari.jpg" },
  { id: "baridbank", icon: "📮", label: "دفع عبر تطبيق بريد بنك", img: "img/payments/baridbank.jpg" },
];
// كيرجع HTML ديال أيقونة طريقة الأداء: تصويرة الشركة إلا كانت، وإلا الإيموجي كـ fallback
function paymentIconHtml(pm) {
  return pm.img
    ? `<img src="${pm.img}" alt="${pm.id}" class="pay-icon-img">`
    : pm.icon;
}

function money(n) {
  return Math.round(n).toLocaleString("ar-MA") + " درهم";
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
// روابط وتصاوير جاية من الزبناء: ما كنقبلو إلا https:// للروابط و data:image base64 للتصاوير (حماية من حقن جافاسكريبت فلوحة الأدمين)
function safeHttpUrl(u) {
  const v = String(u ?? "").trim();
  return /^https:\/\//i.test(v) ? v : "";
}
function safeChatImageHtml(v) {
  const src = String(v ?? "");
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return `<div class="chat-text">${ico("camera")}</div>`;
  return `<img src="${escapeAttr(src)}" class="chat-image" onclick="openImageLightbox(this.src)">`;
}
function safeChatAudioHtml(v) {
  const src = String(v ?? "");
  if (!/^data:audio\/[a-zA-Z0-9.+-]+(;[a-zA-Z0-9=_-]+)*;base64,[A-Za-z0-9+/=]+$/.test(src)) return `<div class="chat-text">⚠️</div>`;
  return `<audio class="chat-audio" controls src="${escapeAttr(src)}"></audio>`;
}
function chatMessageBodyHtml(m) {
  if (m.imageData) return safeChatImageHtml(m.imageData);
  if (m.audioData) return safeChatAudioHtml(m.audioData);
  return `<div class="chat-text">${escapeHtml(m.text)}</div>`;
}
function openImageLightbox(src) {
  let box = document.getElementById("imageLightbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "imageLightbox";
    box.className = "image-lightbox";
    box.onclick = closeImageLightbox;
    document.body.appendChild(box);
  }
  box.innerHTML = `<img src="${escapeAttr(src)}" onclick="event.stopPropagation()"><button type="button" class="image-lightbox-close" onclick="closeImageLightbox()">${ico("close")}</button>`;
  box.classList.add("show");
}
function closeImageLightbox() {
  const box = document.getElementById("imageLightbox");
  if (box) box.classList.remove("show");
}
function formatDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("ar-MA", { day: "numeric", month: "long", year: "numeric" });
}
/* ═══════ إشعارات Toast (بدل alert() المزعج فالميزات الجديدة) ═══════ */
let adminToastTimer = null;
function toast(msg, type = "success") {
  const box = document.getElementById("toasts");
  if (!box) return;
  box.innerHTML = "";
  clearTimeout(adminToastTimer);
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = msg;
  box.appendChild(el);
  adminToastTimer = setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }, 2600);
}
/* ═══════ نغمة تنبيه رسائل الدعم — مصنوعة بالكود (بلا ملف صوتي)، تحترم قيود التشغيل التلقائي ═══════ */
let notifyAudioCtx = null;
let notifyAudioUnlocked = false;
function unlockNotifySound() {
  if (notifyAudioUnlocked) return;
  try {
    notifyAudioCtx = notifyAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
    notifyAudioUnlocked = true;
  } catch (e) {
    /* المتصفح ما كيدعمش Web Audio — التنبيه النصي/البصري كيبقى خدام وحدو */
  }
}
["click", "touchstart", "keydown"].forEach((evt) => document.addEventListener(evt, unlockNotifySound, { once: true, passive: true }));
function playNotifySound() {
  if (!notifyAudioUnlocked || !notifyAudioCtx) return; // المتصفح مازال ما سمحش بالصوت — التنبيه النصي كيبقى كافي، والنظام ما يتوقفش
  try {
    const ctx = notifyAudioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1175, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
  } catch (e) {
    /* أي خطأ فالصوت ما كيوقفش الإشعار النصي */
  }
}

/* ---------- تسجيل الدخول ---------- */
function login(e) {
  e.preventDefault();
  const email = document.getElementById("adminEmail").value.trim();
  const pass = document.getElementById("adminPassInput").value;
  const err = document.getElementById("loginError");
  err.textContent = "";
  signInWithEmailAndPassword(auth, email, pass).catch(() => {
    err.textContent = "بيانات الدخول غير صحيحة، أو الحساب غير موجود بعد فـ Firebase Authentication.";
  });
}
function logout() {
  signOut(auth);
}

onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById("loginScreen");
  const panel = document.getElementById("adminPanel");
  const menuBtn = document.getElementById("menuBtn");
  const err = document.getElementById("loginError");
  if (user) {
    // فحص إضافي (بجانب قواعد الأمان): هل هاد الحساب عندو صلاحية أدمين فعلاً؟
    let isAdmin = false;
    try {
      const snap = await getDoc(doc(db, "admins", user.uid));
      isAdmin = snap.exists();
    } catch (e) {
      isAdmin = false;
    }
    if (!isAdmin) {
      err.textContent = "هاد الحساب ماعندوش صلاحيات الإدارة. تواصل مع المطور باش يزيدك لمجموعة admins.";
      loginScreen.style.display = "block";
      panel.style.display = "none";
      menuBtn.style.display = "none";
      await signOut(auth);
      return;
    }
    loginScreen.style.display = "none";
    panel.style.display = "block";
    menuBtn.style.display = "flex";
    subscribeMeals();
    watchAdminUnread();
    switchTab("meals");
  } else {
    loginScreen.style.display = "block";
    panel.style.display = "none";
    menuBtn.style.display = "none";
    closeSidebar();
    stopWatchingAdminUnread();
  }
});

/* ---------- القائمة الجانبية (☰) بدل صف الأزرار لي كان كيزحم الهيدر ---------- */
function openSidebar() {
  renderAdminSidebar();
  document.getElementById("sidebar").classList.add("show");
  document.getElementById("sidebarOverlay").classList.add("show");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("show");
  document.getElementById("sidebarOverlay").classList.remove("show");
}
function navTo(tab) {
  closeSidebar();
  switchTab(tab);
}
function logoutFromMenu() {
  closeSidebar();
  logout();
}
function ico(name) {
  return `<img src="img/icons/${name}.webp" alt="" width="24" height="24" style="width:1.35em;height:1.35em;vertical-align:-0.32em;margin-inline-end:.3em;display:inline-block;object-fit:contain">`;
}
function renderAdminSidebar() {
  const body = document.getElementById("sidebarBody");
  if (!body) return;
  const items = [
    { id: "meals", icon: ico("dejeuner"), label: "الأطباق" },
    { id: "weekly", icon: ico("plan"), label: "الباقة الأسبوعية" },
    { id: "orders", icon: ico("orders"), label: "الطلبات" },
    { id: "users", icon: ico("customers"), label: "المستخدمون / إدارة الحسابات" },
    { id: "privacy", icon: ico("verify"), label: "سياسة الخصوصية" },
    { id: "links", icon: ico("link-other"), label: "روابطنا / مواقعنا" },
    { id: "loyalty", icon: ico("rewards"), label: "الولاء" },
    { id: "payments", icon: ico("paiement"), label: "طرق الدفع" },
    { id: "support", icon: ico("support"), label: "الدعم" },
  ];
  body.innerHTML =
    items
      .map(
        (it) => `<button class="side-item ${currentTab === it.id ? "active" : ""}" onclick="navTo('${it.id}')">
      <span class="side-icon">${it.icon}${it.id === "support" ? '<span class="side-badge" id="sideSupportBadge"></span>' : ""}</span>
      <span class="side-label">${it.label}</span>
    </button>`
      )
      .join("") +
    `<hr class="side-sep">
    <button class="side-item" style="color:#dc2626" onclick="logoutFromMenu()">
      <span class="side-icon">${ico("logout")}</span>
      <span class="side-label">تسجيل الخروج</span>
    </button>`;
  syncAdminUnreadUI();
}

/* ---------- نقطة تنبيه الرسائل الجديدة الغير مقروءة (فزر ☰ وفعنصر الدعم بالقائمة) ---------- */
let unreadAdminCount = 0;
let unreadAdminUnsub = null;
let lastSeenAdminUnreadIds = new Set();
let adminUnreadInitialized = false;
function watchAdminUnread() {
  if (unreadAdminUnsub) return;
  const q = query(collection(db, "messages"), where("senderRole", "==", "customer"), where("readByAdmin", "==", false));
  unreadAdminUnsub = onSnapshot(
    q,
    (snap) => {
      const ids = new Set(snap.docs.map((d) => d.id));
      // نبينو الصوت/التنبيه غير على رسالة جديدة فعلاً (ماشي أول تحميل للوحة)
      if (adminUnreadInitialized) {
        const hasNew = [...ids].some((id) => !lastSeenAdminUnreadIds.has(id));
        if (hasNew) {
          playNotifySound();
          // رسالة إلغاء الطلب التلقائية (من الزبون) كتبان كإشعار خاص بالإلغاء، وكتمر عبر نظام الدعم الموجود
          const newDocs = snap.docChanges().filter((c) => c.type === "added");
          const isCancel = newDocs.some((c) => String(c.doc.data().text || "").startsWith("⚠️ قام الزبون بإلغاء الطلب"));
          toast(isCancel ? "⚠️ زبون ألغى طلباً — راجع الطلبات" : "🔔 رسالة دعم جديدة");
          if (isCancel && currentTab === "orders") renderOrdersTab();
        }
      }
      lastSeenAdminUnreadIds = ids;
      adminUnreadInitialized = true;
      unreadAdminCount = snap.size;
      syncAdminUnreadUI();
    },
    () => {}
  );
}
function stopWatchingAdminUnread() {
  if (unreadAdminUnsub) {
    unreadAdminUnsub();
    unreadAdminUnsub = null;
  }
  unreadAdminCount = 0;
  lastSeenAdminUnreadIds = new Set();
  adminUnreadInitialized = false;
}
function syncAdminUnreadUI() {
  const dot = document.getElementById("menuDot");
  if (dot) dot.style.display = unreadAdminCount > 0 ? "block" : "none";
  const badge = document.getElementById("sideSupportBadge");
  if (badge) badge.style.display = unreadAdminCount > 0 ? "block" : "none";
}

/* ---------- الاشتراك بقائمة الأطباق ---------- */
let unsubscribeMeals = null;
function subscribeMeals() {
  if (unsubscribeMeals) return;
  const q = query(collection(db, "meals"), orderBy("name"));
  unsubscribeMeals = onSnapshot(q, (snap) => {
    meals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (currentTab === "meals") renderMealsTab();
  });
}

/* ---------- التبويبات ---------- */
async function switchTab(tab) {
  if (currentTab === "support" && tab !== "support") {
    openThreadUid = null;
    if (adminChatUnsubscribe) {
      adminChatUnsubscribe();
      adminChatUnsubscribe = null;
    }
  }
  currentTab = tab;
  renderAdminSidebar();
  if (tab === "meals") await renderMealsTab();
  else if (tab === "weekly") await renderWeeklyTab();
  else if (tab === "orders") await renderOrdersTab();
  else if (tab === "users") await renderUsersTab(document.getElementById("adminContent"));
  else if (tab === "privacy") await renderPrivacyTab(document.getElementById("adminContent"));
  else if (tab === "links") await renderLinksTab(document.getElementById("adminContent"));
  else if (tab === "loyalty") await renderLoyaltyTab();
  else if (tab === "payments") await renderPaymentsTab();
  else await renderSupportTab();
}

async function renderMealsTab() {
  const a = document.getElementById("adminContent");
  let dailyMealImage = "";
  let dailyMealTitle = "";
  let dailyMealAuto = true;
  try {
    const snap = await getDoc(doc(db, "config", "dailyMeal"));
    if (snap.exists()) {
      dailyMealImage = snap.data().image || "";
      dailyMealTitle = snap.data().title || "";
      dailyMealAuto = snap.data().auto !== false;
    }
  } catch (e) {
    /* تجاهل */
  }
  a.innerHTML = `<div class="admin-card"><h2 style="color:#064e3b;margin-top:0">${ico("dejeuner")}صورة وجبة اليوم</h2>
   <p style="color:#a8a29e;font-size:12px;margin-top:-8px">كتبان فوق فئات (الكل / الفطور / الغداء / العشاء) فالصفحة الرئيسية. خليها فارغة باش تخفيها.</p>
   <form id="dailyMealForm">
   <label class="privacy-check-admin" style="margin-bottom:10px"><input type="checkbox" id="dailyMealAutoInput" ${dailyMealAuto ? "checked" : ""}> <span>تلقائي: من الإثنين إلى الجمعة تُؤخذ الصورة واسم الطبق من «باقة الكبار» لنفس اليوم (بتوقيت المغرب)</span></label>
   <div style="font-size:12px;color:#78716c;margin-bottom:8px">الحقلان التاليان يُستعملان يوم <b>السبت والأحد</b>، وكذلك إذا لم يكن في باقة الكبار طبق (بصورة) لذلك اليوم، أو إذا أوقفت الوضع التلقائي.</div>
   <label>رابط الصورة (السبت/الاحتياطي)</label><input id="dailyMealImageInput" placeholder="https://..." value="${escapeAttr(dailyMealImage)}">
   <label>العنوان (اختياري)</label><input id="dailyMealTitleInput" maxlength="150" placeholder="مثال: كسكس بالخضر" value="${escapeAttr(dailyMealTitle)}">
   <button class="add" type="submit" style="width:100%;margin-top:12px;padding:12px">✓ حفظ الصورة</button></form></div>
  <div class="admin-card"><h2 style="color:#064e3b;margin-top:0">إضافة طبق جديد</h2>
   <form id="addMealForm"><label>اسم الطبق</label><input id="newName" required><label>الفئة</label>
   <select id="newCat"><option value="breakfast">الفطور</option><option value="lunch" selected>الغداء</option><option value="dinner">العشاء</option></select>
   <label>السعر (درهم)</label><input id="newPrice" type="number" min="0" required><label>رابط الصورة</label><input id="newImage">
   <label>الوصف</label><textarea id="newDesc" rows="2"></textarea>
   <button class="add" type="submit" style="width:100%;margin-top:14px;padding:12px">＋ إضافة الطبق</button></form></div>
  <div class="admin-list">${meals
    .map(
      (m) => `<div class="item-admin"><div><b>${escapeHtml(m.name)}</b><br><small style="color:#047857">${money(
        m.price
      )}</small></div><div style="display:flex;gap:6px"><button class="add" style="padding:6px 12px;font-size:12px" data-edit="${m.id}">✎ تعديل</button><button class="delete" data-delete="${m.id}">${ico("trash")}</button></div></div>`
    )
    .join("")}</div>
  ${meals.length === 0 ? `<div class="empty">لا توجد أطباق بعد. زيدي أول طبق من الفورم فوق.</div>` : ""}`;

  document.getElementById("dailyMealForm").addEventListener("submit", saveDailyMealImage);
  document.getElementById("addMealForm").addEventListener("submit", addMeal);
  a.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => editMeal(btn.dataset.edit)));
  a.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteMeal(btn.dataset.delete)));
}

async function saveDailyMealImage(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true;
  try {
    const url = document.getElementById("dailyMealImageInput").value.trim();
    const title = document.getElementById("dailyMealTitleInput").value.trim().slice(0, 150);
    const auto = document.getElementById("dailyMealAutoInput").checked;
    await setDoc(doc(db, "config", "dailyMeal"), { image: url, title, auto, updatedAt: serverTimestamp() }, { merge: true });
    btn.textContent = "✓ تم الحفظ";
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1500);
  } catch (err) {
    alert("تعذر حفظ الصورة.");
    btn.disabled = false;
  }
}

// خريطة القيمة المخزنة فعلياً فـ status إلى مفتاح ثابت (للترجمة البصرية والألوان)
const ORDER_STATUS_KEYS = {
  "قيد المراجعة": "pending",
  "تم قبول الطلب": "accepted",
  "قيد التحضير": "preparing",
  "خرج للتوصيل": "outForDelivery",
  "تم التسليم": "delivered",
  ملغي: "cancelled",
  "ملغى من طرف الزبون": "cancelledByCustomer",
  "ملغى من المشرف": "cancelledByAdmin",
};
const ORDER_STATUS_LABELS = {
  pending: "قيد المراجعة",
  accepted: `تم قبول الطلب ${ico("verify")}`,
  preparing: "قيد التحضير 👨‍🍳",
  outForDelivery: "خرج للتوصيل 🛵",
  delivered: "تم التسليم ✔️",
  cancelled: "ملغي ❌",
  cancelledByCustomer: "ملغى من طرف الزبون ❌",
  cancelledByAdmin: "ملغى من المشرف ❌",
};
function orderStatusKey(status) {
  return ORDER_STATUS_KEYS[status] || "pending";
}
function orderStatusBadge(status) {
  const key = orderStatusKey(status);
  return `<span class="status-badge status-${key}">${ORDER_STATUS_LABELS[key]}</span>`;
}
// رقم طلب مختصر وقابل للقراءة مشتق من معرّف الوثيقة (نفس المنطق فـ app.js حتى يتطابق الرقم فالجهتين)
function orderCode(id) {
  return "WJ-" + String(id || "").slice(0, 8).toUpperCase();
}
// الطلب يقدر "يتقبل" غير إلا كانت الحالة الافتراضية أو غير محددة (الطلبات القديمة بلا status)
function canAcceptOrder(status) {
  return !status || status === "قيد المراجعة";
}

let ordersCache = [];
// فلتر حالة الطلبات (الكل / قيد المراجعة / مقبول / قيد التحضير / جاهز / تم التوصيل / ملغى من الزبون / ملغى من المشرف)
let ordersFilter = "all";
const ORDER_FILTERS = [
  ["all", "الكل", null],
  ["pending", "قيد المراجعة", ["قيد المراجعة"]],
  ["accepted", "مقبول", ["تم قبول الطلب"]],
  ["preparing", "قيد التحضير", ["قيد التحضير"]],
  ["ready", "جاهز", ["خرج للتوصيل"]],
  ["delivered", "تم التوصيل", ["تم التسليم"]],
  ["cancelledByCustomer", "ملغى من الزبون", ["ملغى من طرف الزبون"]],
  ["cancelledByAdmin", "ملغى من المشرف", ["ملغى من المشرف", "ملغي"]],
];
function setOrdersFilter(v) {
  ordersFilter = v;
  renderOrdersTab(true);
}
function filteredOrders() {
  const f = ORDER_FILTERS.find((x) => x[0] === ordersFilter);
  if (!f || !f[2]) return ordersCache;
  return ordersCache.filter((o) => f[2].includes(o.status || "قيد المراجعة"));
}
function cancelInfoHtml(o) {
  if (!o.cancelledAt && o.status !== "ملغى من طرف الزبون") return "";
  const when = o.cancelledAt?.toDate ? o.cancelledAt.toDate().toLocaleString("ar-MA") : "—";
  const who = o.cancelledBy === "customer" ? "الزبون" : o.cancelledBy === "admin" ? "المشرف" : "—";
  return `<div style="margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:8px 10px;font-size:12px;color:#991b1b">
    ❌ أُلغي بواسطة: <b>${who}</b> — ${escapeHtml(when)}${o.cancellationReason ? `<br>السبب: ${escapeHtml(o.cancellationReason)}` : ""}</div>`;
}
async function renderOrdersTab(keepCache) {
  const a = document.getElementById("adminContent");
  if (keepCache !== true) {
    a.innerHTML = `<div class="empty">${ico("loading")}جارٍ تحميل الطلبات...</div>`;
    try {
      const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      ordersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      a.innerHTML = `<div class="empty">⚠️ تعذر تحميل الطلبات.</div>`;
      return;
    }
  }
  const visibleOrders = filteredOrders();
  const filterBar = `<div class="admin-card" style="padding:12px 16px"><label style="margin:0 0 6px">تصفية الطلبات حسب الحالة</label>
    <select id="ordersFilterSel" onchange="setOrdersFilter(this.value)">${ORDER_FILTERS.map(
      (f) => `<option value="${f[0]}" ${f[0] === ordersFilter ? "selected" : ""}>${f[1]}</option>`
    ).join("")}</select></div>`;
  a.innerHTML = filterBar + (visibleOrders.length
    ? visibleOrders
        .map((o) => {
          const mapHref = safeHttpUrl(o.customer.mapLink);
          const addressHtml = mapHref
            ? `<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" style="color:#047857;text-decoration:underline">${escapeHtml(
                o.customer.address
              )}</a> <button type="button" class="copy-link-btn" data-copy="${escapeAttr(mapHref)}" style="border:0;background:#f0fdf4;color:#047857;border-radius:8px;padding:2px 8px;font-size:11px;cursor:pointer">${ico("copy")}نسخ</button>`
            : escapeHtml(o.customer.address);
          const locLabel = o.deliveryLocation === "work" ? ico("travail") + "العمل" : o.deliveryLocation === "home" ? ico("maison") + "المنزل" : "غير محدد";
          const mealLabel = o.mealType === "lunch" ? ico("dejeuner") + "غداء" : o.mealType === "dinner" ? ico("diner") + "عشاء" : "غير محدد";
          const acceptBtn = canAcceptOrder(o.status)
            ? `<button type="button" class="btn-accept" data-accept="${o.id}">✓ قبول الطلب</button>`
            : o.status === "تم قبول الطلب"
            ? `<button type="button" class="btn-accept" disabled>✓ تم قبول الطلب</button>`
            : "";
          return `<div class="admin-card">
   <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
     <b style="color:#064e3b">${orderCode(o.id)}</b>
     ${orderStatusBadge(o.status)}
   </div>
   <div style="margin-top:6px"><b>${escapeHtml(o.customer.name)}</b><br><small>${escapeHtml(o.customer.phone)} — ${addressHtml}</small></div>
   <hr><small>${o.items.map((i) => escapeHtml(i.name) + " ×" + escapeHtml(i.qty)).join("، ")}</small>
   ${cancelInfoHtml(o)}
   <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
     <span class="info-tag">${locLabel}</span>
     <span class="info-tag">${mealLabel}</span>
     ${(o.items || []).some((i) => i.pack) ? `<span class="info-tag" style="background:#fef3c7;color:#92400e;font-weight:800">${ico("plan")}طلب باقة</span>` : ""}
   </div>
   ${
     o.schedule
       ? `<div style="margin-top:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:13px;padding:9px;font-size:12px;color:#92400e">${ico("date")}${
           o.schedule.dates && o.schedule.dates.length
             ? [...o.schedule.dates].sort().map((d) => formatDate(d)).join("، ")
             : `من ${formatDate(o.schedule.dateFrom)} إلى ${formatDate(o.schedule.dateTo)}`
         } (${escapeHtml(o.durationDays || "?")} يوم)<br>${ico("clock")}وقت الوصول: ${escapeHtml(o.schedule.deliveryTime)}</div>`
       : ""
   }
   <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
     <span style="font-weight:900;color:#047857">${money(o.total)}</span>
     <div style="display:flex;gap:6px;flex-wrap:wrap">
       ${
         o.uid
           ? `<button type="button" class="add" style="padding:6px 12px;font-size:11px" data-msg="${escapeAttr(o.uid)}">${ico("support")}راسل الزبون</button>`
           : ""
       }
       <button type="button" class="btn-outline-sm" data-detail="${o.id}">تفاصيل</button>
       ${acceptBtn}
     </div>
   </div></div>`;
        })
        .join("")
    : `<div class="empty">لا توجد طلبات ${ordersFilter === "all" ? "واردة حالياً" : "بهذه الحالة"}.</div>`);
  a.querySelectorAll("[data-msg]").forEach((btn) => btn.addEventListener("click", () => openThreadFromOrders(btn.dataset.msg)));
  a.querySelectorAll("[data-detail]").forEach((btn) => btn.addEventListener("click", () => openOrderDetailAdmin(btn.dataset.detail)));
  a.querySelectorAll("[data-accept]").forEach((btn) => btn.addEventListener("click", () => acceptOrder(btn.dataset.accept, btn)));
  a.querySelectorAll(".copy-link-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const old = btn.innerHTML;
        btn.textContent = "✓ تم النسخ";
        setTimeout(() => (btn.innerHTML = old), 1500);
      } catch (e) {
        alert(btn.dataset.copy);
      }
    })
  );
}

// قبول الطلب: يحدّث الحالة + يبعث رسالة تلقائية وحيدة للدعم — محمي من الضغط المتكرر ومن إعادة الإرسال
async function acceptOrder(id, btn) {
  const order = ordersCache.find((o) => o.id === id);
  if (!order || !canAcceptOrder(order.status)) return; // محمي: الطلب متقبول من قبل، ما نبعثوش الرسالة مرة ثانية
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${ico("loading")}جارٍ القبول...`;
  }
  try {
    await updateDoc(doc(db, "orders", id), { status: "تم قبول الطلب", acceptedAt: serverTimestamp() });
    order.status = "تم قبول الطلب"; // نحدثو الكاش المحلي فالحين باش زر القبول ما يبانش مرة أخرى
    if (order.uid) {
      const welcomeMsg =
        "مرحباً بك في وجبتنا 👋\n\nتم قبول طلبك بنجاح ✅\n\nشكراً لاختيارك وجبتنا ❤️\nسيتصل بكم فريقنا في أقرب وقت ممكن لتأكيد التفاصيل ومتابعة طلبكم.\n\nنتمنى لك وجبة شهية 🍽️";
      try {
        await addDoc(collection(db, "messages"), {
          threadId: order.uid,
          senderUid: auth.currentUser.uid,
          senderRole: "admin",
          text: welcomeMsg,
          readByCustomer: false,
          readByAdmin: true,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        /* الطلب تقبل بنجاح حتى لو تعذر إرسال رسالة الدعم التلقائية */
      }
    }
    toast("تم قبول الطلب ✓");
    if (btn) {
      btn.textContent = "✓ تم قبول الطلب";
    }
    const badgeEl = btn?.closest(".admin-card")?.querySelector(".status-badge");
    if (badgeEl) badgeEl.outerHTML = orderStatusBadge(order.status);
  } catch (e) {
    toast("تعذر قبول الطلب، حاول مرة أخرى.", "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✓ قبول الطلب";
    }
  }
}

// تفاصيل الطلب الكاملة (بطاقات منفصلة) — Full Screen بشكل طبيعي فالهاتف حيت adminContent كتاخد الشاشة كاملة
function openOrderDetailAdmin(id) {
  const o = ordersCache.find((x) => x.id === id);
  const a = document.getElementById("adminContent");
  if (!o) {
    a.innerHTML = `<div class="empty">⚠️ الطلب ماكاينش.</div>`;
    return;
  }
  const mapHref = safeHttpUrl(o.customer.mapLink);
  const locLabel = o.deliveryLocation === "work" ? ico("travail") + "العمل" : o.deliveryLocation === "home" ? ico("maison") + "المنزل" : "غير محدد";
  const mealLabel = o.mealType === "lunch" ? ico("dejeuner") + "غداء" : o.mealType === "dinner" ? ico("diner") + "عشاء" : "غير محدد";
  const itemsHtml = (o.items || [])
    .map(
      (it) =>
        `<div class="order-detail-row"><span>${escapeHtml(it.name)} ×${escapeHtml(it.qty)}</span><b>${money((it.price || 0) * (it.qty || 0))}</b></div>`
    )
    .join("");
  a.innerHTML = `
    <div class="modal-head">
      <h3 style="margin:0;color:#064e3b">${orderCode(o.id)}</h3>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn-outline-sm" id="editOrderBtn">${ico("settings")}تعديل</button>
        <button type="button" class="btn-outline-sm" id="backToOrdersBtn">→ رجوع للطلبات</button>
      </div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("orders")}معلومات الطلب</h4>
      <div class="order-detail-row"><span>رقم الطلب</span><b>${orderCode(o.id)}</b></div>
      <div class="order-detail-row"><span>تاريخ الطلب</span><b>${o.createdAt?.toDate ? formatDate(o.createdAt.toDate().toISOString().slice(0, 10)) : "—"}</b></div>
      <div class="order-detail-row"><span>وقت الوصول</span><b>${escapeHtml(o.schedule?.deliveryTime || "غير محدد")}</b></div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("account")}معلومات الزبون</h4>
      <div class="order-detail-row"><span>الاسم</span><b>${escapeHtml(o.customer?.name || "")}</b></div>
      <div class="order-detail-row"><span>الهاتف</span><b>${escapeHtml(o.customer?.phone || "")}</b></div>
      <div class="order-detail-row"><span>العنوان</span><span>${escapeHtml(o.customer?.address || "")}</span></div>
      ${mapHref ? `<button type="button" class="copy-link-btn" data-copy="${escapeAttr(mapHref)}" style="border:0;background:#f0fdf4;color:#047857;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;margin-top:4px">${ico("copy")}نسخ رابط الموقع</button>` : ""}
    </div>

    <div class="order-detail-section">
      <h4>${ico("location")}مكان التوصيل</h4>
      <div class="order-detail-row"><span>${locLabel}</span></div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("dejeuner")}نوع الوجبة</h4>
      <div class="order-detail-row"><span>${mealLabel}</span></div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("panier")}محتوى الطلب</h4>
      ${itemsHtml}
    </div>

    <div class="order-detail-section">
      <h4>${ico("paiement")}طريقة الدفع</h4>
      <div class="order-detail-row"><span>${escapeHtml(o.paymentMethodLabel || "غير محدد")}</span></div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("money")}المبلغ</h4>
      <div class="order-detail-row"><span>المجموع</span><b>${money(o.total)}</b></div>
    </div>

    ${
      o.customer?.notes
        ? `<div class="order-detail-section"><h4>📝 ملاحظات الزبون</h4><div class="order-detail-row"><span>${escapeHtml(o.customer.notes)}</span></div></div>`
        : ""
    }

    <div class="order-detail-section">
      <h4>${ico("order-status")}حالة الطلب</h4>
      <div class="order-detail-row" style="margin-bottom:8px">${orderStatusBadge(o.status)}</div>
      ${cancelInfoHtml(o)}
      <label style="font-size:12px;color:#78716c">تغيير الحالة يدوياً</label>
      <select id="statusSelect">
        ${Object.entries(ORDER_STATUS_LABELS)
          .map((entry) => `<option value="${entry[0]}" ${orderStatusKey(o.status) === entry[0] ? "selected" : ""}>${entry[1]}</option>`)
          .join("")}
      </select>
      <button type="button" class="add" id="saveStatusBtn" style="margin-top:8px;padding:8px 16px;font-size:13px">حفظ الحالة</button>
    </div>
  `;
  document.getElementById("backToOrdersBtn").addEventListener("click", renderOrdersTab);
  document.getElementById("editOrderBtn").addEventListener("click", () => openOrderEditAdmin(o.id));
  a.querySelectorAll(".copy-link-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast("تم النسخ ✓");
      } catch (e) {
        alert(btn.dataset.copy);
      }
    })
  );
  document.getElementById("saveStatusBtn").addEventListener("click", async () => {
    const key = document.getElementById("statusSelect").value;
    const newStatus = ORDER_STATUS_LABELS_RAW[key];
    try {
      const patch = { status: newStatus };
      // إلغاء من طرف المشرف: نسجلو الوقت والجهة (الطلب ما كيتحذفش أبداً)
      if (key === "cancelledByAdmin" && o.status !== newStatus) {
        patch.cancelledAt = serverTimestamp();
        patch.cancelledBy = "admin";
        patch.cancellationReason = o.cancellationReason || "";
      }
      await updateDoc(doc(db, "orders", o.id), patch);
      o.status = newStatus;
      if (patch.cancelledBy) {
        o.cancelledBy = "admin";
        o.cancelledAt = { toDate: () => new Date() };
      }
      toast("تم تحديث حالة الطلب ✓");
      openOrderDetailAdmin(o.id);
    } catch (e) {
      toast("تعذر تحديث الحالة، حاول مرة أخرى.", "error");
    }
  });
}
// القيمة الحقيقية المخزنة فـ Firestore لكل مفتاح حالة (بلا الإيموجي المضاف للعرض فقط)
const ORDER_STATUS_LABELS_RAW = {
  pending: "قيد المراجعة",
  accepted: "تم قبول الطلب",
  preparing: "قيد التحضير",
  outForDelivery: "خرج للتوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  cancelledByCustomer: "ملغى من طرف الزبون",
  cancelledByAdmin: "ملغى من المشرف",
};

/* ═══════ تعديل طلب (الأدمين يقدر يبدل كل شيء: الأيام، الأطباق، الباقة، الثمن...) ═══════ */
const EDIT_PLAN_META = { daily: { label: "يومي", discount: 0 }, weekly: { label: "أسبوعي", discount: 0.1 }, monthly: { label: "شهري", discount: 0.2 } };
let editOrderState = null;
let editOrderCalendarMonth = null;

function openOrderEditAdmin(id) {
  const o = ordersCache.find((x) => x.id === id);
  const a = document.getElementById("adminContent");
  if (!o) return;
  const existingDates = o.schedule?.dates?.length ? [...o.schedule.dates] : o.schedule?.dateFrom ? [o.schedule.dateFrom] : [];
  editOrderState = {
    name: o.customer?.name || "",
    phone: o.customer?.phone || "",
    address: o.customer?.address || "",
    mapLink: o.customer?.mapLink || "",
    notes: o.customer?.notes || "",
    deliveryLocation: o.deliveryLocation || "home",
    mealType: o.mealType || "lunch",
    deliveryTime: o.schedule?.deliveryTime || "",
    dates: existingDates.sort(),
    items: (o.items || []).map((it) => ({ ...it })),
    plan: o.plan in EDIT_PLAN_META ? o.plan : "daily",
    paymentMethod: o.paymentMethod || "cod",
    total: o.total || 0,
  };
  editOrderCalendarMonth = existingDates.length ? new Date(existingDates[0] + "T00:00:00") : new Date();

  a.innerHTML = `
    <div class="modal-head">
      <h3 style="margin:0;color:#064e3b">تعديل ${orderCode(o.id)}</h3>
      <button type="button" class="btn-outline-sm" id="cancelEditBtn">إلغاء</button>
    </div>

    <div class="order-detail-section">
      <h4>${ico("account")}معلومات الزبون</h4>
      <label>الاسم</label><input id="editName" value="${escapeAttr(editOrderState.name)}">
      <label>الهاتف</label><input id="editPhone" value="${escapeAttr(editOrderState.phone)}">
      <label>العنوان</label><input id="editAddress" value="${escapeAttr(editOrderState.address)}">
      <label>ملاحظات</label><textarea id="editNotes" rows="2">${escapeHtml(editOrderState.notes)}</textarea>
    </div>

    <div class="order-detail-section">
      <h4>${ico("location")}مكان التوصيل ونوع الوجبة</h4>
      <label>مكان التوصيل</label>
      <select id="editLocation">
        <option value="home" ${editOrderState.deliveryLocation === "home" ? "selected" : ""}>المنزل</option>
        <option value="work" ${editOrderState.deliveryLocation === "work" ? "selected" : ""}>العمل</option>
      </select>
      <label>نوع الوجبة</label>
      <select id="editMealType">
        <option value="lunch" ${editOrderState.mealType === "lunch" ? "selected" : ""}>غداء</option>
        <option value="dinner" ${editOrderState.mealType === "dinner" ? "selected" : ""}>عشاء</option>
      </select>
    </div>

    <div class="order-detail-section">
      <h4>${ico("date")}أيام التوصيل ووقت الوصول</h4>
      <div id="editDatesChips" class="date-chips">${editOrderDatesChipsHtml()}</div>
      <div id="editCalendar" class="schedule-calendar">${editOrderCalendarHtml()}</div>
      <label>وقت الوصول</label><input type="time" id="editDeliveryTime" value="${escapeAttr(editOrderState.deliveryTime)}">
    </div>

    <div class="order-detail-section">
      <h4>${ico("panier")}محتوى الطلب</h4>
      <div id="editItemsList">${editOrderItemsHtml()}</div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <select id="addItemSelect" style="flex:1">
          ${meals.map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.name)} — ${money(m.price)}</option>`).join("")}
        </select>
        <button type="button" class="add" id="addItemBtn" style="padding:0 16px;width:auto">+ إضافة</button>
      </div>
    </div>

    <div class="order-detail-section">
      <h4>${ico("plan")}الباقة وطريقة الدفع</h4>
      <label>الباقة</label>
      <select id="editPlan">
        ${Object.entries(EDIT_PLAN_META).map(([k, v]) => `<option value="${k}" ${editOrderState.plan === k ? "selected" : ""}>${v.label}</option>`).join("")}
      </select>
      <label>طريقة الدفع</label>
      <select id="editPaymentMethod">
        ${PAYMENT_METHODS.map((p) => `<option value="${p.id}" ${editOrderState.paymentMethod === p.id ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
      </select>
    </div>

    <div class="order-detail-section">
      <h4>${ico("money")}المجموع</h4>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="number" id="editTotal" value="${editOrderState.total}" style="flex:1" min="0" step="0.01">
        <button type="button" class="btn-outline-sm" id="recalcTotalBtn" style="white-space:nowrap">${ico("renew")}احتساب</button>
      </div>
      <p style="font-size:11px;color:#a8a29e;margin:6px 0 0">الاحتساب = (ثمن الأطباق × عددها) × عدد الأيام المختارة × خصم الباقة. الباقات (أطفال/كبار) بلا خصم.</p>
    </div>

    <button type="button" class="add" id="saveOrderEditBtn" style="width:100%;padding:12px;margin-top:6px;margin-bottom:20px">${ico("verify")}حفظ التعديلات</button>
  `;
  wireOrderEditEvents(id);
}

function editOrderDatesChipsHtml() {
  if (!editOrderState.dates.length) return `<span style="font-size:12px;color:#a8a29e">ما كاين حتى يوم مختار</span>`;
  return [...editOrderState.dates]
    .sort()
    .map((d) => `<span class="date-chip">${formatDate(d)}<button type="button" data-remove-date="${d}">×</button></span>`)
    .join("");
}
function editOrderCalendarHtml() {
  const year = editOrderCalendarMonth.getFullYear();
  const month = editOrderCalendarMonth.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString("ar-MA", { month: "long", year: "numeric" });
  let cells = "";
  for (let i = 0; i < startWeekday; i++) cells += `<span class="cal-cell cal-empty"></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isSelected = editOrderState.dates.includes(dateStr);
    cells += `<button type="button" class="cal-cell${isSelected ? " selected" : ""}" data-toggle-date="${dateStr}">${d}</button>`;
  }
  return `
   <div class="cal-header">
     <button type="button" class="cal-nav" data-month-delta="-1">‹</button>
     <span class="cal-month-label">${monthLabel}</span>
     <button type="button" class="cal-nav" data-month-delta="1">›</button>
   </div>
   <div class="cal-daynames"><span>ح</span><span>ن</span><span>ث</span><span>ر</span><span>خ</span><span>ج</span><span>س</span></div>
   <div class="cal-grid">${cells}</div>`;
}
function editOrderItemsHtml() {
  if (!editOrderState.items.length) return `<div class="empty" style="padding:14px">لا توجد أطباق فهاد الطلب</div>`;
  return editOrderState.items
    .map(
      (it, idx) => `
    <div class="edit-item-row">
      <span style="flex:1">${escapeHtml(it.name)}${it.pack ? ` <small style="color:#a8a29e">(باقة)</small>` : ""}</span>
      <input type="number" min="0" value="${it.qty}" data-item-qty="${idx}">
      <b style="width:70px;text-align:end">${money((it.price || 0) * (it.qty || 0))}</b>
      <button type="button" class="delete" data-remove-item="${idx}">${ico("trash")}</button>
    </div>`
    )
    .join("");
}
function refreshEditOrderChipsAndCalendar() {
  const chips = document.getElementById("editDatesChips");
  const cal = document.getElementById("editCalendar");
  if (chips) chips.innerHTML = editOrderDatesChipsHtml();
  if (cal) cal.innerHTML = editOrderCalendarHtml();
  wireEditCalendarClicks();
}
function refreshEditOrderItems() {
  const list = document.getElementById("editItemsList");
  if (list) list.innerHTML = editOrderItemsHtml();
  wireEditItemsClicks();
}
function wireEditCalendarClicks() {
  document.querySelectorAll("[data-toggle-date]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const d = btn.dataset.toggleDate;
      const idx = editOrderState.dates.indexOf(d);
      if (idx >= 0) editOrderState.dates.splice(idx, 1);
      else editOrderState.dates.push(d);
      refreshEditOrderChipsAndCalendar();
    })
  );
  document.querySelectorAll("[data-remove-date]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const idx = editOrderState.dates.indexOf(btn.dataset.removeDate);
      if (idx >= 0) editOrderState.dates.splice(idx, 1);
      refreshEditOrderChipsAndCalendar();
    })
  );
  document.querySelectorAll("[data-month-delta]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const d = new Date(editOrderCalendarMonth);
      d.setDate(1);
      d.setMonth(d.getMonth() + Number(btn.dataset.monthDelta));
      editOrderCalendarMonth = d;
      refreshEditOrderChipsAndCalendar();
    })
  );
}
function wireEditItemsClicks() {
  document.querySelectorAll("[data-item-qty]").forEach((input) =>
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.itemQty);
      editOrderState.items[idx].qty = Math.max(0, Number(input.value) || 0);
      refreshEditOrderItems();
    })
  );
  document.querySelectorAll("[data-remove-item]").forEach((btn) =>
    btn.addEventListener("click", () => {
      editOrderState.items.splice(Number(btn.dataset.removeItem), 1);
      refreshEditOrderItems();
    })
  );
}
function wireOrderEditEvents(id) {
  document.getElementById("cancelEditBtn").addEventListener("click", () => openOrderDetailAdmin(id));
  wireEditCalendarClicks();
  wireEditItemsClicks();
  document.getElementById("addItemBtn").addEventListener("click", () => {
    const mealId = document.getElementById("addItemSelect").value;
    const m = meals.find((x) => x.id === mealId);
    if (!m) return;
    const existing = editOrderState.items.find((it) => it.name === m.name && !it.pack);
    if (existing) existing.qty = (existing.qty || 0) + 1;
    else editOrderState.items.push({ name: m.name, price: m.price, qty: 1 });
    refreshEditOrderItems();
  });
  document.getElementById("recalcTotalBtn").addEventListener("click", () => {
    const dailyTotal = editOrderState.items.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 0), 0);
    const days = editOrderState.dates.length || 1;
    const hasPack = editOrderState.items.some((it) => it.pack);
    const discount = hasPack ? 0 : EDIT_PLAN_META[document.getElementById("editPlan").value]?.discount || 0;
    const total = Math.round(dailyTotal * days * (1 - discount) * 100) / 100;
    document.getElementById("editTotal").value = total;
  });
  document.getElementById("saveOrderEditBtn").addEventListener("click", () => saveOrderEdit(id));
}
async function saveOrderEdit(id) {
  const o = ordersCache.find((x) => x.id === id);
  if (!o) return;
  const dates = [...editOrderState.dates].sort();
  if (!dates.length) {
    toast("خاصك تختار على الأقل يوم وحد.", "error");
    return;
  }
  if (!editOrderState.items.length) {
    toast("الطلب خاصو يحتوي على طبق واحد على الأقل.", "error");
    return;
  }
  const paymentMethod = document.getElementById("editPaymentMethod").value;
  const paymentLabel = PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.label || paymentMethod;
  const btn = document.getElementById("saveOrderEditBtn");
  btn.disabled = true;
  const updates = {
    customer: {
      name: document.getElementById("editName").value.trim(),
      phone: document.getElementById("editPhone").value.trim(),
      address: document.getElementById("editAddress").value.trim(),
      mapLink: editOrderState.mapLink,
      notes: document.getElementById("editNotes").value.trim(),
    },
    schedule: { dates, dateFrom: dates[0], dateTo: dates[dates.length - 1], deliveryTime: document.getElementById("editDeliveryTime").value },
    deliveryLocation: document.getElementById("editLocation").value,
    mealType: document.getElementById("editMealType").value,
    items: editOrderState.items
      .filter((it) => (it.qty || 0) > 0)
      .map((it) => (it.pack ? { name: it.name, price: it.price, qty: it.qty, pack: it.pack } : { name: it.name, price: it.price, qty: it.qty })),
    plan: document.getElementById("editPlan").value,
    durationDays: dates.length,
    paymentMethod,
    paymentMethodLabel: paymentLabel,
    total: Number(document.getElementById("editTotal").value) || 0,
  };
  try {
    await updateDoc(doc(db, "orders", id), updates);
    Object.assign(o, updates);
    toast("تم حفظ تعديلات الطلب ✓");
    openOrderDetailAdmin(id);
  } catch (e) {
    toast("تعذر حفظ التعديلات، حاول مرة أخرى.", "error");
    btn.disabled = false;
  }
}

/* ---------- إضافة / تعديل / حذف الأطباق ---------- */
async function addMeal(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await addDoc(collection(db, "meals"), {
      name: document.getElementById("newName").value.trim(),
      description: document.getElementById("newDesc").value.trim(),
      category: document.getElementById("newCat").value,
      price: Number(document.getElementById("newPrice").value),
      image: document.getElementById("newImage").value.trim(),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    alert("تعذرت إضافة الطبق. تأكد من صلاحياتك ومن الاتصال بالإنترنت.");
  }
  btn.disabled = false;
}

function editMeal(id) {
  const m = meals.find((x) => x.id === id);
  if (!m) return;
  const a = document.getElementById("adminContent");
  a.innerHTML = `<div class="admin-card">
 <div class="modal-head"><h2 style="color:#064e3b;margin:0">✎ تعديل الطبق</h2><button class="close" id="cancelEdit">${ico("close")}</button></div>
 <form id="editMealForm">
 <label>اسم الطبق</label><input id="editName" required value="${escapeAttr(m.name)}">
 <label>الفئة</label><select id="editCat"><option value="breakfast" ${m.category === "breakfast" ? "selected" : ""}>الفطور</option><option value="lunch" ${
    m.category === "lunch" ? "selected" : ""
  }>الغداء</option><option value="dinner" ${m.category === "dinner" ? "selected" : ""}>العشاء</option></select>
 <label>السعر (درهم)</label><input id="editPrice" type="number" min="0" required value="${m.price}">
 <label>رابط الصورة</label><input id="editImage" value="${escapeAttr(m.image || "")}">
 <label>الوصف</label><textarea id="editDesc" rows="3">${escapeHtml(m.description || "")}</textarea>
 <button class="add" type="submit" style="width:100%;margin-top:14px;padding:12px">✓ حفظ التعديلات</button></form></div>`;
  document.getElementById("cancelEdit").addEventListener("click", renderMealsTab);
  document.getElementById("editMealForm").addEventListener("submit", (e) => saveEditedMeal(e, id));
}

async function saveEditedMeal(e, id) {
  e.preventDefault();
  try {
    await updateDoc(doc(db, "meals", id), {
      name: document.getElementById("editName").value.trim(),
      category: document.getElementById("editCat").value,
      price: Number(document.getElementById("editPrice").value),
      image: document.getElementById("editImage").value.trim(),
      description: document.getElementById("editDesc").value.trim(),
    });
    renderMealsTab();
  } catch (err) {
    alert("تعذر حفظ التعديلات.");
  }
}

async function deleteMeal(id) {
  if (!confirm("حذف هذا الطبق؟")) return;
  try {
    await deleteDoc(doc(db, "meals", id));
  } catch (err) {
    alert("تعذر حذف الطبق.");
  }
}

/* ═══════ الباقات الأسبوعية (باقة الأطفال / باقة الكبار) ═══════ */
const WEEKLY_DAYS = [
  { key: "mon", label: "الإثنين" },
  { key: "tue", label: "الثلاثاء" },
  { key: "wed", label: "الأربعاء" },
  { key: "thu", label: "الخميس" },
  { key: "fri", label: "الجمعة" },
];
const WEEKLY_PACKS = [
  { id: "kids", icon: ico("enfant"), title: "باقة الأطفال" },
  { id: "adults", icon: ico("jeune-adulte"), title: "باقة الكبار" },
];

async function renderWeeklyTab() {
  const a = document.getElementById("adminContent");
  let prices = { kids: 30, adults: 50 };
  const slots = {};
  try {
    const priceSnap = await getDoc(doc(db, "config", "weeklyPackagePrices"));
    if (priceSnap.exists()) prices = { ...prices, ...priceSnap.data() };
  } catch (e) {
    /* تجاهل */
  }
  try {
    const slotsSnap = await getDocs(collection(db, "weeklyMeals"));
    slotsSnap.forEach((d) => (slots[d.id] = d.data()));
  } catch (e) {
    /* تجاهل */
  }

  const packageCard = (pack) => `
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">${pack.icon} ${pack.title}</h2>
      <form id="weeklyForm_${pack.id}">
        <label>السعر لليوم الواحد (درهم)</label>
        <input id="weeklyPrice_${pack.id}" type="number" min="0" value="${prices[pack.id] ?? 0}">
        ${WEEKLY_DAYS.map((d) => {
          const slot = slots[`${pack.id}_${d.key}`] || {};
          return `
          <div style="border-top:1px solid #f0f0f0;margin-top:14px;padding-top:14px">
            <label style="font-weight:800">${d.label}</label>
            <input id="weeklyName_${pack.id}_${d.key}" placeholder="اسم الأكلة" value="${escapeAttr(slot.name || "")}">
            <input id="weeklyImage_${pack.id}_${d.key}" placeholder="رابط صورة الأكلة" value="${escapeAttr(slot.image || "")}">
          </div>`;
        }).join("")}
        <button class="add" type="submit" style="width:100%;margin-top:14px;padding:12px">✓ حفظ ${pack.title}</button>
      </form>
    </div>`;

  a.innerHTML = `
    <h1 style="color:#064e3b">${ico("plan")}الباقات الأسبوعية</h1>
    <p style="color:#78716c;font-size:13px;margin:6px 0 16px">
      حدد أكلة كل يوم (الإثنين للجمعة) وثمن اليوم الواحد لكل باقة، وغادي تبان مباشرة للزبناء فالصفحة الرئيسية. سيب اسم اليوم فارغ إلا مازال ماحددتيهش، وماغاديش يبان للزبون. ثمن اليوم هو لي كيتضرب فمدة الاشتراك لي كيختار الزبون (5 أيام فالأسبوعي، 20 يوم فالشهري).
    </p>
    ${WEEKLY_PACKS.map(packageCard).join("")}
  `;
  WEEKLY_PACKS.forEach((pack) => {
    document.getElementById(`weeklyForm_${pack.id}`).addEventListener("submit", (e) => saveWeeklyPackage(e, pack.id));
  });
}

async function saveWeeklyPackage(e, packId) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const price = Number(document.getElementById(`weeklyPrice_${packId}`).value);
    const writes = [setDoc(doc(db, "config", "weeklyPackagePrices"), { [packId]: price }, { merge: true })];
    for (const d of WEEKLY_DAYS) {
      const name = document.getElementById(`weeklyName_${packId}_${d.key}`).value.trim();
      const image = document.getElementById(`weeklyImage_${packId}_${d.key}`).value.trim();
      writes.push(setDoc(doc(db, "weeklyMeals", `${packId}_${d.key}`), { package: packId, day: d.key, name, image }));
    }
    await Promise.all(writes);
    toast("تم حفظ الباقة بنجاح ✓");
  } catch (err) {
    toast("تعذر الحفظ، حاول مرة أخرى.", "error");
  }
  btn.disabled = false;
}

/* ═══════ نظام النقاط والولاء ═══════ */
let loyaltySubTab = "customers";

async function renderLoyaltyTab() {
  const a = document.getElementById("adminContent");
  a.innerHTML = `
    <div class="admin-tabs" style="margin-bottom:16px">
      <button id="subCustomers" class="${loyaltySubTab === "customers" ? "active" : ""}">${ico("customers")}العملاء</button>
      <button id="subRewards" class="${loyaltySubTab === "rewards" ? "active" : ""}">${ico("rewards")}المكافآت</button>
      <button id="subRules" class="${loyaltySubTab === "rules" ? "active" : ""}">${ico("settings")}الإعدادات</button>
      <button id="subLog" class="${loyaltySubTab === "log" ? "active" : ""}">${ico("history")}السجل</button>
    </div>
    <div id="loyaltySubContent"><div class="empty">${ico("loading")}جارٍ التحميل...</div></div>`;
  document.getElementById("subCustomers").addEventListener("click", () => {
    loyaltySubTab = "customers";
    renderLoyaltyTab();
  });
  document.getElementById("subRewards").addEventListener("click", () => {
    loyaltySubTab = "rewards";
    renderLoyaltyTab();
  });
  document.getElementById("subRules").addEventListener("click", () => {
    loyaltySubTab = "rules";
    renderLoyaltyTab();
  });
  document.getElementById("subLog").addEventListener("click", () => {
    loyaltySubTab = "log";
    renderLoyaltyTab();
  });

  if (loyaltySubTab === "customers") await renderLoyaltyCustomers();
  else if (loyaltySubTab === "rewards") await renderLoyaltyRewards();
  else if (loyaltySubTab === "rules") await renderLoyaltyRules();
  else await renderLoyaltyLog();
}

/* ---------- تبويب العملاء: بحث + تعديل يدوي + الأكثر نشاطاً ---------- */
function tierForAdmin(lifetime) {
  if (lifetime >= 2000) return "👑 VIP";
  if (lifetime >= 1000) return "🥇 ذهبي";
  if (lifetime >= 500) return "🥈 فضي";
  return "🥉 برونزي";
}
async function fetchPointsSummaryAdmin(uid) {
  let entries = [];
  try {
    const q = query(collection(db, "pointsLog"), where("uid", "==", uid));
    const snap = await getDocs(q);
    entries = snap.docs.map((d) => d.data());
  } catch (e) {
    /* تجاهل */
  }
  let balance = 0,
    lifetime = 0;
  entries.forEach((en) => {
    const p = Number(en.points) || 0;
    balance += p;
    if (p > 0) lifetime += p;
  });
  return { balance, lifetime };
}

async function renderLoyaltyCustomers() {
  const el = document.getElementById("loyaltySubContent");
  el.innerHTML = `
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">🔍 البحث عن زبون (برقم الهاتف)</h2>
      <div style="display:flex;gap:8px">
        <input id="searchPhone" placeholder="مثال: 0612345678" style="flex:1">
        <button class="add" id="searchBtn" type="button">بحث</button>
      </div>
      <div id="customerResult" style="margin-top:14px"></div>
    </div>
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">🏆 العملاء الأكثر نشاطاً</h2>
      <div id="topCustomers"><div class="empty">${ico("loading")}جارٍ التحميل...</div></div>
    </div>`;
  document.getElementById("searchBtn").addEventListener("click", searchCustomer);
  document.getElementById("searchPhone").addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchCustomer();
  });
  loadTopCustomers();
}

async function searchCustomer() {
  const phone = document.getElementById("searchPhone").value.trim();
  const resultEl = document.getElementById("customerResult");
  if (!phone) return;
  resultEl.innerHTML = `<div class="empty">${ico("loading")}جارٍ البحث...</div>`;
  try {
    const q = query(collection(db, "users"), where("phone", "==", phone), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      resultEl.innerHTML = `<div class="empty">ما لقيناش زبون بهاد الرقم.</div>`;
      return;
    }
    const uid = snap.docs[0].id;
    const profile = snap.docs[0].data();
    const { balance, lifetime } = await fetchPointsSummaryAdmin(uid);
    resultEl.innerHTML = `
      <div class="item-admin" style="flex-direction:column;align-items:stretch;gap:10px">
        <div><b>${escapeHtml(profile.name || profile.phone || "")}</b> — ${escapeHtml(profile.phone || "")}</div>
        <div>الرصيد: <b style="color:#047857">${balance} نقطة</b> — المستوى: <b>${tierForAdmin(lifetime)}</b> — عدد الطلبات: ${
      escapeHtml(profile.orderCount || 0)
    }</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="adjustPoints" type="number" placeholder="+/- عدد النقط" style="flex:1;min-width:120px">
          <input id="adjustReason" placeholder="السبب (اختياري)" style="flex:2;min-width:150px">
          <button class="add" id="adjustBtn" type="button">تطبيق</button>
        </div>
      </div>`;
    document.getElementById("adjustBtn").addEventListener("click", () => adjustCustomerPoints(uid));
  } catch (e) {
    resultEl.innerHTML = `<div class="empty">⚠️ وقع خطأ فالبحث.</div>`;
  }
}

async function adjustCustomerPoints(uid) {
  const amount = Number(document.getElementById("adjustPoints").value);
  const reason = document.getElementById("adjustReason").value.trim() || "تعديل من الإدارة";
  if (!amount) return;
  try {
    await addDoc(collection(db, "pointsLog"), {
      uid,
      points: amount,
      reason: `⚙ ${reason}`,
      orderId: null,
      createdAt: serverTimestamp(),
    });
    alert("تم تعديل النقط بنجاح.");
    searchCustomer();
  } catch (e) {
    alert("تعذر تعديل النقط.");
  }
}

async function loadTopCustomers() {
  const el = document.getElementById("topCustomers");
  try {
    const q = query(collection(db, "users"), orderBy("orderCount", "desc"), limit(10));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => d.data()).filter((u) => (u.orderCount || 0) > 0);
    el.innerHTML = rows.length
      ? rows
          .map(
            (u) =>
              `<div class="item-admin"><div><b>${escapeHtml(u.name || u.phone || "")}</b><br><small>${escapeHtml(
                u.phone || ""
              )}</small></div><div style="font-weight:800;color:#047857">${escapeHtml(u.orderCount || 0)} طلب</div></div>`
          )
          .join("")
      : `<div class="empty">لا يوجد عملاء نشيطون بعد.</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">⚠️ تعذر التحميل.</div>`;
  }
}

/* ---------- تبويب المكافآت: كتالوج قابل للتعديل ---------- */
async function renderLoyaltyRewards() {
  const el = document.getElementById("loyaltySubContent");
  el.innerHTML = `<div class="empty">${ico("loading")}جارٍ التحميل...</div>`;
  let rewards = [];
  try {
    const snap = await getDocs(collection(db, "rewards"));
    rewards = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.pointsCost - b.pointsCost);
  } catch (e) {
    /* تجاهل */
  }
  el.innerHTML = `
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">إضافة مكافأة جديدة</h2>
      <form id="addRewardForm">
        <label>اسم المكافأة</label><input id="rewardName" required placeholder="مثال: مشروب مجاني">
        <label>عدد النقط المطلوبة</label><input id="rewardCost" type="number" min="1" required>
        <label>الوصف (اختياري)</label><textarea id="rewardDesc" rows="2"></textarea>
        <button class="add" type="submit" style="width:100%;margin-top:12px;padding:12px">＋ إضافة المكافأة</button>
      </form>
    </div>
    <div class="admin-list">
      ${
        rewards.length
          ? rewards
              .map(
                (r) =>
                  `<div class="item-admin"><div><b>${escapeHtml(r.name)}</b><br><small style="color:#047857">${
                    escapeHtml(r.pointsCost)
                  } نقطة</small>${
                    r.active === false ? ' <small style="color:#dc2626">(معطلة)</small>' : ""
                  }</div><div style="display:flex;gap:6px"><button class="add" style="padding:6px 10px;font-size:11px" data-toggle="${
                    r.id
                  }" data-active="${r.active !== false}">${
                    r.active !== false ? "⏸ تعطيل" : "▶ تفعيل"
                  }</button><button class="delete" data-del="${r.id}">${ico("trash")}</button></div></div>`
              )
              .join("")
          : `<div class="empty">مازال ما زدتي حتى مكافأة.</div>`
      }
    </div>`;
  document.getElementById("addRewardForm").addEventListener("submit", addReward);
  el.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => toggleReward(btn.dataset.toggle, btn.dataset.active === "true"))
  );
  el.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", () => deleteReward(btn.dataset.del)));
}
async function addReward(e) {
  e.preventDefault();
  try {
    await addDoc(collection(db, "rewards"), {
      name: document.getElementById("rewardName").value.trim(),
      pointsCost: Number(document.getElementById("rewardCost").value),
      description: document.getElementById("rewardDesc").value.trim(),
      active: true,
      createdAt: serverTimestamp(),
    });
    renderLoyaltyRewards();
  } catch (e) {
    alert("تعذرت إضافة المكافأة.");
  }
}
async function toggleReward(id, isActive) {
  try {
    await updateDoc(doc(db, "rewards", id), { active: !isActive });
    renderLoyaltyRewards();
  } catch (e) {
    alert("تعذر تعديل المكافأة.");
  }
}
async function deleteReward(id) {
  if (!confirm("حذف هاد المكافأة؟")) return;
  try {
    await deleteDoc(doc(db, "rewards", id));
    renderLoyaltyRewards();
  } catch (e) {
    alert("تعذر حذف المكافأة.");
  }
}

/* ---------- تبويب الإعدادات: قواعد احتساب النقاط ---------- */
async function renderLoyaltyRules() {
  const el = document.getElementById("loyaltySubContent");
  let rules = {
    firstOrderPoints: 50,
    perDirham: 10,
    reviewPoints: 10,
    referralPoints: 150,
    streak3Bonus: 50,
    monthly5Bonus: 100,
    monthly10Bonus: 200,
  };
  let loyaltyEnabled = true;
  try {
    const snap = await getDoc(doc(db, "config", "pointsRules"));
    if (snap.exists()) rules = { ...rules, ...snap.data() };
  } catch (e) {
    /* تجاهل */
  }
  try {
    const snap = await getDoc(doc(db, "config", "loyaltyProgram"));
    if (snap.exists() && snap.data().enabled === false) loyaltyEnabled = false;
  } catch (e) {
    /* تجاهل */
  }
  el.innerHTML = `
    <div class="admin-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <h2 style="color:#064e3b;margin:0">${ico("rewards")}مركز المكافآت والنقاط</h2>
          <p style="color:#78716c;font-size:13px;margin-top:6px;max-width:520px">
            إلا بغيتي توقف نظام النقاط والمكافآت مؤقتاً: الزبناء ما غاديش يربحو نقط على الطلبات الجداد، وزر "مكافآتي" غادي يختفي عندهم تماماً.
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="pm-status ${loyaltyEnabled ? "on" : "off"}" id="loyaltyEnabledStatus">${loyaltyEnabled ? "🟢 مفعّل" : "🔴 متوقف"}</span>
          <label class="switch" aria-label="تفعيل/تعطيل مركز المكافآت">
            <input type="checkbox" id="loyaltyEnabledToggle" ${loyaltyEnabled ? "checked" : ""} onchange="toggleLoyaltyProgram(this.checked)">
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    </div>
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">${ico("settings")}قواعد احتساب النقاط</h2>
      <form id="rulesForm">
        <label>نقاط أول طلب</label><input id="r_firstOrderPoints" type="number" value="${rules.firstOrderPoints}">
        <label>كل كم درهم = نقطة وحدة</label><input id="r_perDirham" type="number" value="${rules.perDirham}">
        <label>نقاط تقييم الطلب</label><input id="r_reviewPoints" type="number" value="${rules.reviewPoints}">
        <label>نقاط دعوة صديق (بعد أول طلب ليه)</label><input id="r_referralPoints" type="number" value="${rules.referralPoints}">
        <label>مكافأة الوصول لـ 3 طلبات</label><input id="r_streak3Bonus" type="number" value="${rules.streak3Bonus}">
        <label>مكافأة 5 طلبات فنفس الشهر</label><input id="r_monthly5Bonus" type="number" value="${rules.monthly5Bonus}">
        <label>مكافأة خاصة: 10 طلبات فنفس الشهر</label><input id="r_monthly10Bonus" type="number" value="${rules.monthly10Bonus}">
        <button class="add" type="submit" style="width:100%;margin-top:14px;padding:12px">✓ حفظ القواعد</button>
      </form>
      <p style="color:#a8a29e;font-size:11px;margin-top:12px">
        ملاحظة: مكافأة "الطلب المتكرر" (10/20/30 نقطة حسب رقم الطلب) مضبوطة فالكود مباشرة وماشي قابلة للتعديل من هنا حالياً.
      </p>
    </div>`;
  document.getElementById("rulesForm").addEventListener("submit", saveRules);
}
// تفعيل/تعطيل فوري لمركز المكافآت بالكامل (كيتحفظ فـ config/loyaltyProgram، منفصل على قواعد احتساب النقاط)
async function toggleLoyaltyProgram(enabled) {
  const statusEl = document.getElementById("loyaltyEnabledStatus");
  const checkbox = document.getElementById("loyaltyEnabledToggle");
  try {
    await setDoc(doc(db, "config", "loyaltyProgram"), { enabled }, { merge: true });
    if (statusEl) {
      statusEl.textContent = enabled ? "🟢 مفعّل" : "🔴 متوقف";
      statusEl.className = "pm-status " + (enabled ? "on" : "off");
    }
    toast(enabled ? "تم تفعيل مركز المكافآت ✓" : "تم إيقاف مركز المكافآت ✓");
  } catch (e) {
    if (checkbox) checkbox.checked = !enabled; // نرجعو الحالة القديمة إلا فشل الحفظ فـ Firebase
    toast("تعذر حفظ التغيير، حاول مرة أخرى.", "error");
  }
}
async function saveRules(e) {
  e.preventDefault();
  const data = {
    firstOrderPoints: Number(document.getElementById("r_firstOrderPoints").value),
    perDirham: Number(document.getElementById("r_perDirham").value),
    reviewPoints: Number(document.getElementById("r_reviewPoints").value),
    referralPoints: Number(document.getElementById("r_referralPoints").value),
    streak3Bonus: Number(document.getElementById("r_streak3Bonus").value),
    monthly5Bonus: Number(document.getElementById("r_monthly5Bonus").value),
    monthly10Bonus: Number(document.getElementById("r_monthly10Bonus").value),
  };
  try {
    await setDoc(doc(db, "config", "pointsRules"), data, { merge: true });
    alert("تم حفظ القواعد بنجاح. الزبناء غادي يشوفو القيم الجداد فالطلب الجاي ديالهم.");
  } catch (e) {
    alert("تعذر الحفظ.");
  }
}


/* ---------- تبويب طرق الدفع: RIB وتفعيل كل طريقة أداء ---------- */
async function renderPaymentsTab() {
  const a = document.getElementById("adminContent");
  a.innerHTML = `<div class="admin-card"><div class="empty">${ico("loading")}جارٍ التحميل...</div></div>`;
  let cfg = {};
  try {
    const snap = await getDoc(doc(db, "config", "paymentMethods"));
    if (snap.exists()) cfg = snap.data() || {};
  } catch (e) {
    /* تجاهل */
  }
  a.innerHTML = `
    <div class="admin-card">
      <h2 style="color:#064e3b;margin-top:0">${ico("paiement")}طرق الدفع</h2>
      <p style="color:#78716c;font-size:13px;margin-top:-6px">
        بدّل المفتاح باش تفعّل أو تعطّل طريقة دفع — كيتحفظ فـ Firebase فالحين، والطريقة المعطلة ما تبقاش تبان للزبون فصفحة الطلب. حط رقم الحساب (RIB) من تحت وصيفط بزر الحفظ.
      </p>
      <form id="paymentsForm">
        ${PAYMENT_METHODS.map((pm) => {
          const m = cfg[pm.id] || {};
          const enabled = m.enabled !== false;
          return `
          <div style="border:1px solid #eee;border-radius:18px;padding:14px;margin-top:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <span style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${paymentIconHtml(pm)} ${pm.label}</span>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="pm-status ${enabled ? "on" : "off"}" id="pm_${pm.id}_status">${enabled ? "🟢 مفعلة" : "🔴 غير مفعلة"}</span>
                <label class="switch" aria-label="تفعيل/تعطيل ${pm.label}">
                  <input type="checkbox" id="pm_${pm.id}_enabled" ${enabled ? "checked" : ""} onchange="togglePaymentEnabled('${pm.id}', this.checked)">
                  <span class="switch-track"></span>
                </label>
              </div>
            </div>
            <label>رقم الحساب (RIB)</label>
            <input id="pm_${pm.id}_rib" placeholder="مثال: 0123456789012345678901" value="${escapeAttr(m.rib || "")}">
            <label>صاحب الحساب</label>
            <input id="pm_${pm.id}_holder" placeholder="مثال: وجبتنا SARL" value="${escapeAttr(m.holder || "")}">
            <label>ملاحظات إضافية (اختياري)</label>
            <textarea id="pm_${pm.id}_note" rows="2" placeholder="مثال: صيفط لينا تصويرة الوصل بعد التحويل">${escapeHtml(m.note || "")}</textarea>
          </div>`;
        }).join("")}
        <button class="add" type="submit" style="width:100%;margin-top:18px;padding:12px">✓ حفظ تفاصيل الحسابات</button>
      </form>
    </div>`;
  document.getElementById("paymentsForm").addEventListener("submit", savePaymentMethods);
}
// تفعيل/تعطيل فوري لطريقة دفع وحدها (merge جزئي — ما كيمسحش RIB/صاحب الحساب/الملاحظات ديال باقي الطرق)
async function togglePaymentEnabled(id, enabled) {
  const statusEl = document.getElementById(`pm_${id}_status`);
  const checkbox = document.getElementById(`pm_${id}_enabled`);
  try {
    await setDoc(doc(db, "config", "paymentMethods"), { [id]: { enabled } }, { merge: true });
    if (statusEl) {
      statusEl.textContent = enabled ? "🟢 مفعلة" : "🔴 غير مفعلة";
      statusEl.className = "pm-status " + (enabled ? "on" : "off");
    }
    toast(enabled ? "تم تفعيل طريقة الدفع ✓" : "تم إيقاف طريقة الدفع ✓");
  } catch (e) {
    if (checkbox) checkbox.checked = !enabled; // نرجعو الحالة القديمة إلا فشل الحفظ فـ Firebase
    toast("تعذر حفظ التغيير، حاول مرة أخرى.", "error");
  }
}
async function savePaymentMethods(e) {
  e.preventDefault();
  const data = {};
  PAYMENT_METHODS.forEach((pm) => {
    data[pm.id] = {
      enabled: document.getElementById(`pm_${pm.id}_enabled`).checked,
      rib: document.getElementById(`pm_${pm.id}_rib`).value.trim(),
      holder: document.getElementById(`pm_${pm.id}_holder`).value.trim(),
      note: document.getElementById(`pm_${pm.id}_note`).value.trim(),
    };
  });
  try {
    await setDoc(doc(db, "config", "paymentMethods"), data, { merge: true });
    toast("تم حفظ طرق الدفع بنجاح ✓");
  } catch (e) {
    toast("تعذر الحفظ، حاول مرة أخرى.", "error");
  }
}

/* ---------- تبويب السجل: آخر العمليات ---------- */
async function renderLoyaltyLog() {
  const el = document.getElementById("loyaltySubContent");
  el.innerHTML = `<div class="empty">${ico("loading")}جارٍ التحميل...</div>`;
  try {
    const snap = await getDocs(query(collection(db, "pointsLog"), orderBy("createdAt", "desc"), limit(50)));
    const rows = snap.docs.map((d) => d.data());
    el.innerHTML = `<div class="admin-card"><h2 style="color:#064e3b;margin-top:0">${ico("history")}آخر 50 عملية</h2>
      <div class="admin-list" style="grid-template-columns:1fr">
      ${
        rows.length
          ? rows
              .map(
                (r) =>
                  `<div class="item-admin"><div><small style="color:#a8a29e">${escapeHtml(
                    (r.uid || "").slice(0, 8)
                  )}...</small><br>${escapeHtml(r.reason || "")}</div><b style="color:${
                    r.points >= 0 ? "#047857" : "#dc2626"
                  }">${r.points >= 0 ? "+" : ""}${escapeHtml(r.points)}</b></div>`
              )
              .join("")
          : `<div class="empty">مازال ما كاين حتى عملية.</div>`
      }
      </div></div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">⚠️ تعذر تحميل السجل.</div>`;
  }
}

/* ═══════ الدعم / الدردشة مع الزبناء ═══════ */
let openThreadUid = null;
let adminChatUnsubscribe = null;

function openThreadFromOrders(uid) {
  switchTab("support").then(() => renderSupportThread(uid));
}

async function renderSupportTab() {
  const el = document.getElementById("adminContent");
  if (openThreadUid) {
    await renderSupportThread(openThreadUid);
    return;
  }
  el.innerHTML = `<div class="empty">${ico("loading")}جارٍ التحميل...</div>`;
  try {
    const snap = await getDocs(query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(200)));
    const all = snap.docs.map((d) => d.data());
    const threads = {};
    all.forEach((m) => {
      if (!threads[m.threadId]) threads[m.threadId] = { lastMessage: m, unread: 0 };
      if (m.senderRole === "customer" && !m.readByAdmin) threads[m.threadId].unread++;
    });
    const threadList = Object.entries(threads).sort(
      (a, b) => (b[1].lastMessage.createdAt?.seconds || 0) - (a[1].lastMessage.createdAt?.seconds || 0)
    );
    const rows = await Promise.all(
      threadList.map(async ([uid, info]) => {
        let name = uid.slice(0, 8) + "...";
        try {
          const uSnap = await getDoc(doc(db, "users", uid));
          if (uSnap.exists()) name = uSnap.data().name || uSnap.data().phone || name;
        } catch (e) {
          /* تجاهل */
        }
        return { uid, name, ...info };
      })
    );
    el.innerHTML = `
      <div class="admin-card">
        <h2 style="color:#064e3b;margin-top:0">${ico("support")}المحادثات</h2>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input id="newThreadPhone" placeholder="راسل زبون مباشرة برقم الهاتف">
          <button class="add" id="newThreadBtn" type="button">فتح</button>
        </div>
        <div class="admin-list" style="grid-template-columns:1fr">
        ${
          rows.length
            ? rows
                .map(
                  (r) =>
                    `<div class="item-admin" style="cursor:pointer" data-open="${escapeAttr(r.uid)}"><div><b>${escapeHtml(
                      r.name
                    )}</b><br><small style="color:#78716c">${
                      r.lastMessage.imageData ? `${ico("camera")}صورة` : escapeHtml((r.lastMessage.text || "").slice(0, 50))
                    }</small></div>${
                      r.unread > 0
                        ? `<span style="background:#f59e0b;color:#fff;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:800">${r.unread}</span>`
                        : ""
                    }</div>`
                )
                .join("")
            : `<div class="empty">مازال ما وصلات حتى رسالة.</div>`
        }
        </div>
      </div>`;
    el.querySelectorAll("[data-open]").forEach((row) => row.addEventListener("click", () => renderSupportThread(row.dataset.open)));
    document.getElementById("newThreadBtn").addEventListener("click", async () => {
      const phone = document.getElementById("newThreadPhone").value.trim();
      if (!phone) return;
      try {
        const q = query(collection(db, "users"), where("phone", "==", phone), limit(1));
        const snap2 = await getDocs(q);
        if (snap2.empty) {
          alert("ما لقيناش زبون بهاد الرقم.");
          return;
        }
        renderSupportThread(snap2.docs[0].id);
      } catch (e) {
        alert("وقع خطأ فالبحث.");
      }
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">⚠️ تعذر تحميل المحادثات.</div>`;
  }
}

async function renderSupportThread(uid) {
  openThreadUid = uid;
  const el = document.getElementById("adminContent");
  let name = uid;
  try {
    const uSnap = await getDoc(doc(db, "users", uid));
    if (uSnap.exists()) name = uSnap.data().name || uSnap.data().phone || uid;
  } catch (e) {
    /* تجاهل */
  }
  el.innerHTML = `
    <div class="admin-card">
      <div class="modal-head"><h2 style="color:#064e3b;margin:0">${ico("support")}${escapeHtml(name)}</h2><button class="close" id="backToThreads">${ico("close")}</button></div>
      <div id="adminChatMessages" class="chat-box"></div>
      <form id="adminChatForm" style="display:flex;gap:8px;margin-top:10px">
        <button type="button" id="adminVoiceBtn" class="chat-photo-btn" title="إرسال تسجيل صوتي">${ico("mic")}</button>
        <input id="adminChatInput" placeholder="اكتب ردك..." style="flex:1" required autocomplete="off">
        <button class="add" type="submit">إرسال</button>
      </form>
      <div id="adminVoiceBar" class="voice-recording-bar" style="display:none">
        <span class="voice-dot" aria-hidden="true"></span>
        <span id="adminVoiceTimer">00:00</span>
        <button type="button" id="adminVoiceCancel" class="voice-cancel-btn" aria-label="إلغاء التسجيل">${ico("trash")}</button>
        <button type="button" id="adminVoiceSend" class="voice-send-btn" aria-label="إرسال التسجيل">✓</button>
      </div>
    </div>`;
  document.getElementById("backToThreads").addEventListener("click", () => {
    openThreadUid = null;
    if (adminChatUnsubscribe) {
      adminChatUnsubscribe();
      adminChatUnsubscribe = null;
    }
    renderSupportTab();
  });
  document.getElementById("adminChatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("adminChatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await addDoc(collection(db, "messages"), {
        threadId: uid,
        senderUid: auth.currentUser.uid,
        senderRole: "admin",
        text,
        readByCustomer: false,
        readByAdmin: true,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      input.value = text;
    }
  });

  document.getElementById("adminVoiceBtn").addEventListener("click", () => startAdminVoiceRecording(uid));
  document.getElementById("adminVoiceCancel").addEventListener("click", cancelAdminVoiceRecording);
  document.getElementById("adminVoiceSend").addEventListener("click", stopAndSendAdminVoiceRecording);

  if (adminChatUnsubscribe) adminChatUnsubscribe();
  const q = query(collection(db, "messages"), where("threadId", "==", uid));
  adminChatUnsubscribe = onSnapshot(q, (snap) => {
    const messages = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    const box = document.getElementById("adminChatMessages");
    if (!box) return;
    box.innerHTML = messages.length
      ? messages
          .map(
            (m) =>
              `<div class="chat-bubble ${m.senderRole === "admin" ? "chat-mine" : "chat-theirs"}">${chatMessageBodyHtml(m)}</div>`
          )
          .join("")
      : `<div class="empty" style="padding:20px">مازال ما كاين حتى رسالة.</div>`;
    box.scrollTop = box.scrollHeight;
    messages
      .filter((m) => m.senderRole === "customer" && !m.readByAdmin)
      .forEach((m) => updateDoc(doc(db, "messages", m.id), { readByAdmin: true }).catch(() => {}));
  });
}

/* ---------- تسجيل صوتي فدردشة الأدمين ---------- */
let adminVoiceRecorder = null;
let adminVoiceChunks = [];
let adminVoiceStream = null;
let adminVoiceStartTime = 0;
let adminVoiceTimerInterval = null;
const ADMIN_VOICE_MAX_SECONDS = 60;
function pickAdminVoiceMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}
async function startAdminVoiceRecording(uid) {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast("خاصك تسمح باستخدام الميكروفون باش تصيفط تسجيل صوتي.", "error");
    return;
  }
  try {
    adminVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast("خاصك تسمح باستخدام الميكروفون باش تصيفط تسجيل صوتي.", "error");
    return;
  }
  adminVoiceChunks = [];
  const mimeType = pickAdminVoiceMimeType();
  adminVoiceRecorder = mimeType ? new MediaRecorder(adminVoiceStream, { mimeType }) : new MediaRecorder(adminVoiceStream);
  adminVoiceRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) adminVoiceChunks.push(e.data);
  };
  adminVoiceRecorder.start();
  adminVoiceStartTime = Date.now();
  const form = document.getElementById("adminChatForm");
  const bar = document.getElementById("adminVoiceBar");
  if (form) form.style.display = "none";
  if (bar) bar.style.display = "flex";
  updateAdminVoiceTimer(uid);
  adminVoiceTimerInterval = setInterval(() => updateAdminVoiceTimer(uid), 250);
}
function updateAdminVoiceTimer(uid) {
  const elapsed = Math.floor((Date.now() - adminVoiceStartTime) / 1000);
  const el = document.getElementById("adminVoiceTimer");
  if (el) {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  }
  if (elapsed >= ADMIN_VOICE_MAX_SECONDS) stopAndSendAdminVoiceRecording(uid);
}
function stopAdminVoiceInternal() {
  if (adminVoiceTimerInterval) {
    clearInterval(adminVoiceTimerInterval);
    adminVoiceTimerInterval = null;
  }
  if (adminVoiceStream) {
    adminVoiceStream.getTracks().forEach((tr) => tr.stop());
    adminVoiceStream = null;
  }
  const bar = document.getElementById("adminVoiceBar");
  const form = document.getElementById("adminChatForm");
  if (bar) bar.style.display = "none";
  if (form) form.style.display = "flex";
}
function cancelAdminVoiceRecording() {
  if (adminVoiceRecorder && adminVoiceRecorder.state !== "inactive") {
    adminVoiceRecorder.onstop = null;
    adminVoiceRecorder.stop();
  }
  adminVoiceRecorder = null;
  adminVoiceChunks = [];
  stopAdminVoiceInternal();
}
function stopAndSendAdminVoiceRecording() {
  if (!adminVoiceRecorder || adminVoiceRecorder.state === "inactive") return;
  const recorder = adminVoiceRecorder;
  const uid = openThreadUid;
  recorder.onstop = async () => {
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(adminVoiceChunks, { type: mimeType });
    adminVoiceChunks = [];
    stopAdminVoiceInternal();
    if (blob.size < 300 || !uid) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read-failed"));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.length > 1000000) {
        toast("التسجيل طويل بزاف، جرب تسجيل أقصر.", "error");
        return;
      }
      await addDoc(collection(db, "messages"), {
        threadId: uid,
        senderUid: auth.currentUser.uid,
        senderRole: "admin",
        text: "",
        audioData: dataUrl,
        readByCustomer: false,
        readByAdmin: true,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      toast("تعذر إرسال التسجيل الصوتي، عاود جرب.", "error");
    }
  };
  recorder.stop();
  adminVoiceRecorder = null;
}

initAdminExtras({ toast, ico });
initAdminLinks({ toast });
Object.assign(window, { setOrdersFilter, login, logout, switchTab, openSidebar, closeSidebar, navTo, logoutFromMenu, togglePaymentEnabled, openImageLightbox, closeImageLightbox });
document.getElementById("loginForm").addEventListener("submit", login);
document.getElementById("year").textContent = new Date().getFullYear();
