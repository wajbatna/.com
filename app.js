// app.js — منطق الواجهة الأمامية (الزبون) — ثنائي اللغة + حساب + بطاقة العضوية
import { db, auth } from "./firebase.js";
import { getLang, setLang, t } from "./i18n.js";
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const authReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

const PLANS_META = [
  { id: "daily", days: 1, discount: 0 },
  { id: "weekly", days: 5, discount: 0.1 },
  { id: "monthly", days: 20, discount: 0.2 },
];
const CAT_IDS = ["all", "breakfast", "lunch", "dinner"];
const CAT_EMOJI = { all: "🍽", breakfast: ico("petit-dej"), lunch: ico("dejeuner"), dinner: ico("diner") };
// طرق الأداء المتاحة للزبون فصفحة إتمام الطلب — الأدمين كيقدر يفعّل/يعطّل كل وحدة ويحط ليها RIB من لوحة التحكم (config/paymentMethods)
const PAYMENT_METHODS = [
  { id: "card", icon: "💳", img: "img/icons/paiement.webp" },
  { id: "cod", icon: "💵", img: "img/icons/money.webp" },
  { id: "tpe", icon: "📟", img: "img/icons/tpe.webp" },
  { id: "cih", icon: "🏦", img: "img/payments/cih.png" },
  { id: "fellah", icon: "🌾", img: "img/payments/fellah.jpg" },
  { id: "cashplus", icon: "💸", img: "img/payments/cashplus.jpg" },
  { id: "wafacash", icon: "💰", img: "img/payments/wafacash.jpg" },
  { id: "tijari", icon: "🏛", img: "img/payments/tijari.jpg" },
  { id: "baridbank", icon: "📮", img: "img/payments/baridbank.jpg" },
];
// كيرجع HTML ديال أيقونة طريقة الأداء: تصويرة الشركة إلا كانت، وإلا الإيموجي كـ fallback
function paymentIconHtml(pm) {
  return pm.img
    ? `<img src="${pm.img}" alt="${pm.id}" class="pay-icon-img" onerror="this.outerHTML='${pm.icon}'">`
    : pm.icon;
}
// الحد الأدنى لعدد أيام الطلب باش يستحق الزبون بطاقة العضوية تلقائياً
const MEMBERSHIP_MIN_DAYS = 3;
const PHONE_RE = /^(0[5-7]\d{8}|\+212[5-7]\d{8})$/;

// قواعد احتساب النقاط الافتراضية — الأدمين يقدر يبدلها من config/pointsRules،
// وإلا ما كايناش وثيقة، هاد القيم هي لي كتخدم
const DEFAULT_POINTS_RULES = {
  firstOrderPoints: 50,
  perDirham: 10, // كل 10 دراهم = نقطة وحدة
  reviewPoints: 10,
  referralPoints: 150,
  streak3Bonus: 50,
  monthly5Bonus: 100,
  monthly10Bonus: 200,
};
const TIERS = [
  { id: "bronze", min: 0, max: 499 },
  { id: "silver", min: 500, max: 999 },
  { id: "gold", min: 1000, max: 1999 },
  { id: "vip", min: 2000, max: Infinity },
];
let pointsRules = { ...DEFAULT_POINTS_RULES };
// تفعيل/تعطيل مركز المكافآت والنقاط بالكامل (يتحكم فيه الأدمين من config/loyaltyProgram)
let loyaltyEnabled = true;
// الباقات الأسبوعية (طفل/كبير) — ثمن اليوم الواحد لكل باقة + أكلة كل يوم، كيتحكم فيهم الأدمين
let weeklyPackages = { kids: { price: 30, days: {} }, adults: { price: 50, days: {} } };
const WEEKLY_DAYS_UI = [
  { key: "mon", ar: "الإثنين", fr: "Lundi" },
  { key: "tue", ar: "الثلاثاء", fr: "Mardi" },
  { key: "wed", ar: "الأربعاء", fr: "Mercredi" },
  { key: "thu", ar: "الخميس", fr: "Jeudi" },
  { key: "fri", ar: "الجمعة", fr: "Vendredi" },
];
function renderWeeklyPackages() {
  const el = document.getElementById("weeklyPackagesSection");
  if (!el) return;
  const isFr = lang === "fr";
  const packCard = (packId, titleAr, titleFr, icon) => {
    const days = weeklyPackages[packId].days;
    const dayChips = WEEKLY_DAYS_UI.map((d) => {
      const slot = days[d.key];
      if (!slot || !slot.name) return "";
      return `<div class="weekly-day">
        <span class="weekly-day-badge">${isFr ? d.fr : d.ar}</span>
        <img src="${escapeAttr(slot.image || "")}" alt="${escapeAttr(slot.name)}" loading="lazy" onerror="this.style.opacity='0'">
        <div class="weekly-day-name">${escapeHtml(slot.name)}</div>
      </div>`;
    }).join("");
    if (!dayChips) return ""; // ماعندوش ولا يوم محدد بعد، منخبيوه
    const price = weeklyPackages[packId].price || 0;
    return `<div class="weekly-pack">
      <div class="weekly-pack-head">
        <span class="weekly-pack-title">${icon} ${isFr ? titleFr : titleAr}</span>
        <span class="weekly-pack-price">${price} ${isFr ? "DH / jour" : "درهم / اليوم"}</span>
      </div>
      <div class="weekly-days">${dayChips}</div>
      <button type="button" class="weekly-pack-cta" onclick="orderWeeklyPack('${packId}')">${isFr ? "Commander cette formule" : "اطلب هاد الباقة"}</button>
    </div>`;
  };
  el.innerHTML = packCard("kids", "باقة الأطفال", "Formule Enfants", ico("enfant")) + packCard("adults", "باقة الكبار", "Formule Adultes", ico("jeune-adulte"));
}

let lang = getLang();
let meals = [];
let dailyMealImage = "";
let cart = {};
let category = "all",
  plan = "weekly";
// طرق الأداء: الإعدادات (RIB/تفعيل) جاية من config/paymentMethods، والطريقة المختارة فالطلب الحالي
let paymentMethodsConfig = {};
let paymentMethod = null;
let paymentPickerOpen = false;
// مكان الاستلام (منزل/عمل) ونوع الوجبة (غداء/عشاء) المختارين فالطلب الحالي
let deliveryLocation = null;
let mealType = null;
// أيام التوصيل المختارة (تقويم شهري، اختيار حر بلا قيد التوالي) + الشهر المعروض حالياً فالتقويم
let selectedScheduleDates = [];
let scheduleCalendarMonth = null;

/* ---------- الحساب / تسجيل الدخول ---------- */
let currentUser = null; // كائن Firebase Auth
let userProfile = null; // { phone, gender, avatar }
let membershipData = null; // { name, phone, avatar, startDate, endDate, ... } أو null
let authTab = "login";
let signupGender = "male";
let countdownInterval = null;
let pendingCheckoutAfterLogin = false;
let pendingSupportAfterLogin = false;
let profileIncomplete = false; // true إلا دخل الزبون بـ Google/Apple ومازال ما كملش رقم الهاتف/الجنس
let chatUnsubscribe = null;
let unreadUnsubscribe = null;
let hasUnreadSupport = false; // حالة وجود رسائل دعم غير مقروءة — كتحدث نقطة التنبيه فالقائمة وزر ☰

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");

function phoneToEmail(phone) {
  return `${phone}@wajbati.app`;
}
function normalizePhone(raw) {
  // كيحول أي صيغة (+212612345678 / 212612345678 / 0612345678) لنفس الصيغة الموحدة
  // باش نفس رقم الهاتف يعطي دائماً نفس "الإيميل المصطنع"، فتسجيل الدخول يخدم بجد
  let p = String(raw || "").replace(/[\s-]/g, "").trim();
  if (p.startsWith("+212")) p = "0" + p.slice(4);
  else if (p.startsWith("212") && p.length === 12) p = "0" + p.slice(3);
  return p;
}
function avatarFor(gender) {
  return gender === "female" ? "👩" : "👨";
}
// كيحدد أيقونة الشخص (رجل/امرأة) من الإيموجي المخزّنة أو من الجنس — العرض فقط، البيانات المخزّنة كتبقى بحالها
function avatarKey(avatar, gender) {
  if (avatar === "👩") return "femme";
  if (avatar === "👨") return "homme";
  if (gender === "female") return "femme";
  if (gender === "male") return "homme";
  return null;
}
function avatarHtml(avatar, gender) {
  const k = avatarKey(avatar, gender);
  return k ? ico(k) : escapeHtml(avatar || "");
}

function money(n) {
  const cur = lang === "fr" ? "DH" : "درهم";
  const locale = lang === "fr" ? "fr-FR" : "ar-MA";
  return `${Math.round(n).toLocaleString(locale)} ${cur}`;
}
function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const locale = lang === "fr" ? "fr-FR" : "ar-MA";
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}
function filtered() {
  return category === "all" ? meals : meals.filter((m) => m.category === category);
}
// الباقات الأسبوعية كتدوز من نفس مراحل الطلب العادي: كتزاد للسلة كعنصر (id = "pack:kids" / "pack:adults")
// weeklyPackages[packId].price هو ثمن اليوم الواحد مباشرة (كيحدده الأدمين)، وكيتضرب فعدد أيام الخطة المختارة (يومي/أسبوعي/شهري)
const PACK_TITLES = { kids: { ar: "باقة الأطفال", fr: "Formule Enfants" }, adults: { ar: "باقة الكبار", fr: "Formule Adultes" } };
function packItem(id, qty) {
  const packId = id.slice(5);
  const w = weeklyPackages[packId];
  if (!w) return null;
  const tt = PACK_TITLES[packId];
  return {
    id,
    pack: packId,
    name: lang === "fr" ? tt.fr : tt.ar,
    price: w.price || 0,
    image: Object.values(w.days || {}).find((d) => d && d.image)?.image || "",
    qty,
  };
}
function cartHasPack() {
  return Object.keys(cart).some((id) => id.startsWith("pack:"));
}
// خطة الطلب الفعلية: الباقات الأسبوعية ثمنها أصلاً مخفض، فما كنزيدوش خصم الخطة عليها
function effectivePlan() {
  const p = PLANS_META.find((x) => x.id === plan);
  return cartHasPack() ? { ...p, discount: 0 } : p;
}
function cartItems() {
  return Object.entries(cart)
    .map(([id, qty]) => {
      if (id.startsWith("pack:")) return packItem(id, qty);
      const m = meals.find((x) => x.id === id);
      return m ? { ...m, qty } : null;
    })
    .filter(Boolean);
}
// كيزيد الباقة للسلة (كيعوض أي أطباق أخرى)، وكيوجه الزبون لاختيار المدة (يومي/أسبوعي/شهري) ثم إتمام الطلب
function orderWeeklyPack(packId) {
  if (!weeklyPackages[packId]) return;
  cart = { ["pack:" + packId]: 1 };
  plan = "weekly";
  lastTouchedId = "pack:" + packId;
  render();
  const tt = PACK_TITLES[packId];
  toast(t(lang).toastAdded(lang === "fr" ? tt.fr : tt.ar));
  bump(document.getElementById("headerCartCount"));
  bump(document.getElementById("mobileCartCount"));
  goToCart();
}
function dailyTotal() {
  return cartItems().reduce((s, m) => s + m.price * m.qty, 0);
}
function total() {
  // تقدير أولي (قبل ما يختار الزبون التواريخ الحقيقية فنافذة الطلب) — مبني على مدة الباقة النموذجية فقط
  const p = effectivePlan();
  return dailyTotal() * p.days * (1 - p.discount);
}
function actualDays() {
  return selectedScheduleDates.length || null;
}
function checkoutTotal() {
  // السعر الحقيقي: مبني على عدد الأيام الفعلي المختار (من - إلى)، ماشي على مدة الباقة الثابتة
  const p = effectivePlan();
  const days = actualDays() ?? p.days;
  return dailyTotal() * days * (1 - p.discount);
}
function count() {
  return Object.values(cart).reduce((a, b) => a + b, 0);
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
// كينسخ نص لحافظة الجهاز (RIB أو اسم صاحب الحساب) وكيبين ✓ فالزر لمدة قصيرة كتأكيد للزبون
function copyToClipboard(btn) {
  const text = btn.dataset.copy || "";
  const done = () => {
    const original = btn.innerHTML;
    btn.textContent = "✓";
    setTimeout(() => {
      btn.innerHTML = original;
    }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, cb) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    /* تجاهل */
  }
  document.body.removeChild(ta);
  if (cb) cb();
}
// رقم طلب مختصر وقابل للقراءة مشتق من معرّف الوثيقة فـ Firestore (بلا الحاجة لعداد مركزي جديد)
function orderCode(id) {
  return "WJ-" + String(id || "").slice(0, 8).toUpperCase();
}
// نسخ رقم الطلب لحافظة الجهاز (يخدم فـ Android وiPhone والكمبيوتر) مع تنبيه تأكيدي
function copyOrderNumber(btn) {
  const text = btn.dataset.copy || "";
  const s = t(lang);
  const done = () => toast(s.orderNumberCopied);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

/* ---------- إشعارات Toast (بدل alert) ---------- */
let toastTimer = null;
function toast(msg, type = "success") {
  const box = document.getElementById("toasts");
  if (!box) return;
  // إشعار واحد فقط فكل مرة باش ما يتراكموش مع الضغط المتكرر
  box.innerHTML = "";
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = msg;
  box.appendChild(el);
  toastTimer = setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }, 2600);
}
function scrollToMenu() {
  const el = document.getElementById("menu");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
function goToCart() {
  const el = document.getElementById("cartPanel");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function bump(el) {
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

/* ---------- بانر وجبة اليوم (فوق الفئات: الكل/الفطور/الغداء/العشاء) ---------- */
function renderDailyMealBanner() {
  const banner = document.getElementById("dailyMealBanner");
  const img = document.getElementById("dailyMealImg");
  if (!banner || !img) return;
  if (dailyMealImage) {
    img.src = dailyMealImage;
    banner.classList.add("show");
  } else {
    banner.classList.remove("show");
  }
}

/* ---------- نصوص ثابتة (رأس الصفحة، الفوتر...) ---------- */
function applyStaticText() {
  const s = t(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = s.dir;
  document.getElementById("badgeText").textContent = s.badge;
  document.getElementById("dailyMealBadge").textContent = s.dailyMealBadge;
  document.getElementById("tagline").textContent = s.tagline;
  document.getElementById("trust1b").textContent = s.trust1[0];
  document.getElementById("trust1s").textContent = s.trust1[1];
  document.getElementById("trust2b").textContent = s.trust2[0];
  document.getElementById("trust2s").textContent = s.trust2[1];
  document.getElementById("trust3b").textContent = s.trust3[0];
  document.getElementById("trust3s").textContent = s.trust3[1];
  document.getElementById("mobileTotalLabel").textContent = s.mobileTotalLabel;
  document.getElementById("mobileCheckoutBtn").textContent = s.mobileCheckoutBtn;
  document.getElementById("footerText").textContent = s.footer;
  document.querySelectorAll(".lang-btn").forEach((b) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  // ترجمة العناصر الثابتة المعلّمة بـ data-i18n / data-i18n-aria (يدعم مسارات مثل how1.0)
  const pick = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), s);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = pick(el.dataset.i18n);
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const v = pick(el.dataset.i18nAria);
    if (typeof v === "string") el.setAttribute("aria-label", v);
  });
  const dmImg = document.getElementById("dailyMealImg");
  if (dmImg) dmImg.alt = s.dailyMealBadge;
  document.title = lang === "fr" ? "Wajbatna — Cuisine marocaine maison authentique" : "وجبتنا — أكل بيتي مغربي أصيل";
  updateAccountButton();
}

/* ---------- القائمة الجانبية (☰) بدل أزرار رأس الصفحة ---------- */
// يفصل الإيموجي الأول عن النص (النصوص فالترجمة كلها بصيغة "إيموجي نص")
function splitIcon(str) {
  const idx = (str || "").indexOf(" ");
  if (idx === -1) return { icon: "", text: str || "" };
  return { icon: str.slice(0, idx), text: str.slice(idx + 1) };
}

function openSidebar() {
  renderSidebar();
  const sb = document.getElementById("sidebar");
  sb.classList.add("show");
  sb.setAttribute("aria-hidden", "false");
  document.getElementById("sidebarOverlay").classList.add("show");
  document.getElementById("menuBtn").setAttribute("aria-expanded", "true");
  syncBodyScrollLock();
  setTimeout(() => sb.querySelector(".side-item, .sidebar-close")?.focus(), 50);
}
function closeSidebar() {
  const sb = document.getElementById("sidebar");
  const wasOpen = sb.classList.contains("show");
  sb.classList.remove("show");
  sb.setAttribute("aria-hidden", "true");
  document.getElementById("sidebarOverlay").classList.remove("show");
  document.getElementById("menuBtn").setAttribute("aria-expanded", "false");
  syncBodyScrollLock();
  if (wasOpen) document.getElementById("menuBtn").focus({ preventScroll: true });
}
// كيمنع تمرير الصفحة ملي كاينة نافذة أو قائمة مفتوحة، وكيرجعو ملي تتسكر
function syncBodyScrollLock() {
  const anyModal = document.querySelector(".modal.show");
  const sidebarOpen = document.getElementById("sidebar")?.classList.contains("show");
  document.body.classList.toggle("no-scroll", !!(anyModal || sidebarOpen));
}
// إغلاق النوافذ بالضغط خارجها أو بزر Escape
const MODAL_CLOSERS = {
  checkoutModal: () => closeCheckout(),
  membershipModal: () => closeMembership(),
  accountModal: () => {
    if (!profileIncomplete) closeAccount(); // إكمال الملف الشخصي إجباري بعد Google/Apple
  },
  rewardsModal: () => closeRewards(),
  rateModal: () => closeRateOrder(),
  supportModal: () => closeSupport(),
};
function closeTopModal() {
  if (document.getElementById("sidebar").classList.contains("show")) {
    closeSidebar();
    return true;
  }
  const open = [...document.querySelectorAll(".modal.show")].pop();
  if (open && MODAL_CLOSERS[open.id]) {
    MODAL_CLOSERS[open.id]();
    return true;
  }
  return false;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTopModal();
});
document.querySelectorAll(".modal").forEach((m) => {
  let downOnBackdrop = false;
  m.addEventListener("mousedown", (e) => (downOnBackdrop = e.target === m));
  m.addEventListener("touchstart", (e) => (downOnBackdrop = e.target === m), { passive: true });
  m.addEventListener("click", (e) => {
    if (e.target === m && downOnBackdrop && MODAL_CLOSERS[m.id]) MODAL_CLOSERS[m.id]();
  });
});
// كيراقب فتح/إغلاق النوافذ: قفل التمرير + labels لأزرار × + ربط label بالحقل
const a11yObserver = new MutationObserver(() => {
  syncBodyScrollLock();
  const s = t(lang);
  document.querySelectorAll(".modal .close:not([aria-label])").forEach((b) => b.setAttribute("aria-label", s.closeAria));
  document.querySelectorAll(".modal label:not([for])").forEach((l) => {
    const f = l.nextElementSibling;
    if (f && f.id && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName)) l.setAttribute("for", f.id);
  });
});
document.querySelectorAll(".modal").forEach((m) => a11yObserver.observe(m, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true }));
// يسكر القائمة قبل ما يشغل الإجراء المطلوب (فتح الدعم، المكافآت...)
function openSidebarAction(fnName) {
  closeSidebar();
  window[fnName]();
}

function ico(name) {
  return `<img src="img/icons/${name}.webp" alt="" width="24" height="24" style="width:1.35em;height:1.35em;vertical-align:-0.32em;margin-inline-end:.3em;display:inline-block;object-fit:contain">`;
}
const ICON_EMOJI_RE = /🎫|👤|🎁|💬|📦|⚙/g;
const ICON_BY_EMOJI = { "🎫": "card", "👤": "account", "🎁": "rewards", "💬": "support", "📦": "orders", "⚙": "settings" };
// كيعوض الإيموجي القديمة (مثلا المحفوظة فسجل النقاط) بالأيقونات الجديدة
function iconize(html) {
  return String(html ?? "").replace(ICON_EMOJI_RE, (m) => ico(ICON_BY_EMOJI[m]));
}
// أيقونات القائمة الجانبية (صور 3D بدل الإيموجي)
const sideImg = (name) => `<img class="side-icon-img" src="img/icons/${name}.webp" alt="" width="44" height="44" decoding="async" loading="lazy">`;

function renderSidebar() {
  const s = t(lang);
  const body = document.getElementById("sidebarBody");
  if (!body) return;
  const items = [];

  const support = splitIcon(s.supportBtn);
  items.push(`<button type="button" class="side-item" onclick="openSidebarAction('openSupport')">
    <span class="side-icon">${sideImg("support")}<span class="side-badge" id="sideSupportBadge"></span></span>
    <span class="side-label">${support.text}</span>
  </button>`);

  if (currentUser) {
    const myOrders = splitIcon(s.myOrdersBtn);
    items.push(`<button type="button" class="side-item" onclick="openSidebarAction('openMyOrders')">
      <span class="side-icon">${sideImg("orders")}</span>
      <span class="side-label">${myOrders.text}</span>
    </button>`);
    const rewards = splitIcon(s.rewardsBtn);
    items.push(`<button type="button" class="side-item" onclick="openSidebarAction('openRewards')">
      <span class="side-icon">${sideImg("rewards")}</span>
      <span class="side-label">${rewards.text}</span>
    </button>`);
  }

  if (currentUser && membershipData) {
    const memText = lang === "fr" ? "Carte de membre" : "بطاقة العضوية";
    items.push(`<button type="button" class="side-item" onclick="openSidebarAction('openMembership')">
      <span class="side-icon">${sideImg("card")}</span>
      <span class="side-label">${memText}</span>
    </button>`);
  }

  const account =
    currentUser && userProfile
      ? { icon: "", text: userProfile.phone || userProfile.name || (lang === "fr" ? "Mon compte" : "حسابي") }
      : splitIcon(s.accountBtnLogin);
  items.push(`<button type="button" class="side-item" onclick="openSidebarAction('openAccount')">
    <span class="side-icon">${sideImg("account")}</span>
    <span class="side-label">${account.text}</span>
  </button>`);

  body.innerHTML = items.join("");
  syncSupportBadgeUI();
}
// نبقيو الاسم القديم شغال (كيتصاوب عليه نداء فبزاف ديال الأماكن) وكيدير تحديث القائمة الجانبية
function updateAccountButton() {
  renderSidebar();
}
function switchLang(l) {
  if (l === lang) return;
  lang = l;
  setLang(l);
  applyStaticText();
  updateAccountButton();
  render();
  renderWeeklyPackages();
}

/* ---------- عرض القائمة والسلة ---------- */
function renderCategories() {
  const s = t(lang);
  document.getElementById("categories").innerHTML = CAT_IDS.map(
    (id) => `<button type="button" class="cat ${category === id ? "active" : ""}" aria-pressed="${category === id}" onclick="setCategory('${id}')">
      <span class="cat-circle">${CAT_EMOJI[id]}</span>
      <span class="cat-label">${s.categories[id]}</span>
    </button>`
  ).join("");
}
function setCategory(c) {
  category = c;
  render();
}
let lastTouchedId = null;
function mealName(id) {
  if (id.startsWith("pack:")) return packItem(id, 1)?.name || "";
  return meals.find((x) => x.id === id)?.name || "";
}
function add(id) {
  if (!id.startsWith("pack:") && cartHasPack()) {
    Object.keys(cart).forEach((k) => k.startsWith("pack:") && delete cart[k]);
  }
  const first = !cart[id];
  cart[id] = (cart[id] || 0) + 1;
  lastTouchedId = id;
  render();
  setTimeout(() => (lastTouchedId = null), 600);
  if (first) toast(t(lang).toastAdded(mealName(id)));
  bump(document.getElementById("headerCartCount"));
  bump(document.getElementById("mobileCartCount"));
}
function remove(id) {
  lastTouchedId = id;
  if (cart[id] > 1) {
    cart[id]--;
    render();
  } else {
    delete cart[id];
    render();
    toast(t(lang).toastRemoved);
  }
}
function removeAll(id) {
  delete cart[id];
  render();
  toast(t(lang).toastRemoved);
}

function qtyControl(m, s) {
  const pop = lastTouchedId === m.id ? " pop" : "";
  return `<div class="qty${pop}" role="group" aria-label="${escapeAttr(m.name)}"><button type="button" aria-label="${escapeAttr(s.minusAria(m.name))}" onclick="remove('${m.id}')">−</button><b aria-live="polite">${cart[m.id]}</b><button type="button" class="plus" aria-label="${escapeAttr(s.plusAria(m.name))}" onclick="add('${m.id}')">+</button></div>`;
}
function renderMeals() {
  const s = t(lang);
  const list = filtered();
  const el = document.getElementById("meals");
  if (!meals.length) {
    el.innerHTML = `<div class="empty">${s.emptyNoMeals}</div>`;
    return;
  }
  el.innerHTML = list.length
    ? list
        .map(
          (m) => `
 <article class="meal">
  <div class="meal-img${m.image ? "" : " no-img"}">
   ${
     m.image
       ? `<img src="${escapeAttr(m.image)}" alt="${escapeAttr(m.name)}" width="640" height="400" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('no-img');this.remove()">`
       : ""
   }
   <span class="category">${s.categories[m.category] || ""}</span>
  </div>
  <div class="meal-body">
   <h3>${escapeHtml(m.name)}</h3>
   <div class="desc">${escapeHtml(m.description || "")}</div>
   <div class="meal-bottom">
    <span class="price">${money(m.price)}</span>
    ${
      cart[m.id]
        ? qtyControl(m, s)
        : `<button type="button" class="add" aria-label="${escapeAttr(s.addBtn + " — " + m.name)}" onclick="add('${m.id}')">${s.addBtn}</button>`
    }
   </div>
  </div>
 </article>`
        )
        .join("")
    : `<div class="empty">${s.emptyCategory}</div>`;
}

function renderCart() {
  const s = t(lang);
  const items = cartItems();
  const el = document.getElementById("cartPanel");
  const n = count();
  document.body.classList.toggle("cart-has-items", n > 0);
  ["headerCartCount", "mobileCartCount"].forEach((id) => {
    const c = document.getElementById(id);
    if (!c) return;
    c.textContent = n;
    c.classList.toggle("show", n > 0);
  });
  if (!items.length) {
    el.innerHTML = `<section class="panel cart-empty">
  <div class="ico" aria-hidden="true"><img src="img/icons/panier.webp" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:contain"></div>
  <h2>${s.cartEmptyTitle}</h2>
  <p>${s.cartEmptyText}</p>
  <a class="add" href="#menu">${s.browseMeals}</a>
 </section>`;
    return;
  }
  document.getElementById("mobileTotal").textContent = money(total());
  const p = effectivePlan();
  el.innerHTML = `<section class="panel">
  <h2 style="margin-top:0;color:var(--primary);font-size:20px;font-weight:900">${s.choosePlan}</h2>
  <div class="plans" role="group">${PLANS_META.map((x) => {
    const [label, note] = s.plans[x.id];
    return `<button type="button" class="plan ${plan === x.id ? "active" : ""}" aria-pressed="${plan === x.id}" onclick="choosePlan('${x.id}')"><strong>${label}${
      x.discount && !cartHasPack() ? `<span class="discount">${note}</span>` : ""
    }</strong><small style="color:var(--muted)">${x.days} ${x.days === 1 ? s.day : s.days}</small></button>`;
  }).join("")}</div>
  <h3 class="cart-head">${ico("panier")}${s.cartTitle} <small>(${n} ${s.itemsSuffix})</small></h3>
  ${items
    .map(
      (i) => `<div class="cart-row">
    ${i.image ? `<img class="cart-thumb" src="${escapeAttr(i.image)}" alt="${escapeAttr(i.name)}" width="64" height="64" loading="lazy" decoding="async" onerror="this.remove()">` : ""}
    <div class="cart-info"><b>${escapeHtml(i.name)}</b><small>${money(i.price)} ${s.perDish}</small></div>
    <div class="cart-ctrl">
      <div class="qty" role="group" aria-label="${escapeAttr(i.name)}">
        <button type="button" aria-label="${escapeAttr(s.minusAria(i.name))}" onclick="remove('${i.id}')">−</button><b aria-live="polite">${i.qty}</b><button type="button" class="plus" aria-label="${escapeAttr(s.plusAria(i.name))}" onclick="add('${i.id}')">+</button>
      </div>
      <span class="cart-line" aria-label="${escapeAttr(s.lineTotal)}">${money(i.price * i.qty)}</span>
      <button type="button" class="trash-btn" aria-label="${escapeAttr(s.removeAria(i.name))}" onclick="removeAll('${i.id}')">${ico("trash")}</button>
    </div>
  </div>`
    )
    .join("")}
  <div class="summary">
   <div class="sumrow"><span>${s.dailyCost}</span><b>${money(dailyTotal())}</b></div>
   <div class="sumrow"><span>${s.planDuration}</span><b>× ${p.days}</b></div>
   ${p.discount ? `<div class="sumrow" style="color:var(--primary-light)"><span>${s.planDiscount}</span><b>-${Math.round(p.discount * 100)}%</b></div>` : ""}
   <div class="sumrow total"><span>${s.finalTotal}</span><b>${money(total())}</b></div>
  </div>
  <div class="field-note" style="text-align:center;margin-top:8px">${s.estimatedNote}</div>
  <button type="button" class="checkout" onclick="openCheckout()">${s.continueCheckout}</button>
 </section>`;
}
function choosePlan(p) {
  plan = p;
  render();
}
function render() {
  renderCategories();
  renderMeals();
  renderCart();
}

/* ---------- إتمام الطلب ---------- */
function openCheckout() {
  const s = t(lang);
  if (!cartItems().length) return;
  if (!currentUser) {
    pendingCheckoutAfterLogin = true;
    authTab = "login";
    document.getElementById("accountModal").classList.add("show");
    renderAccountAuth();
    return;
  }
  document.getElementById("checkoutModal").classList.add("show");
  // الدفع عند الاستلام هو الخيار الافتراضي إلا كان مفعّل (الزبون يقدر يبدلو)
  paymentMethod = enabledPaymentMethods().some((pm) => pm.id === "cod") ? "cod" : null;
  paymentPickerOpen = false;
  // نبداو من جديد فكل مرة: بلا اختيار مسبق ديال المكان، والوقت الحالي كيقترح غداء أو عشاء بشكل افتراضي فقط
  deliveryLocation = null;
  mealType = new Date().getHours() >= 16 ? "dinner" : "lunch";
  document.getElementById("checkoutContent").innerHTML = `
 <div class="modal-head"><h3>${s.checkoutTitle}</h3><button type="button" class="close" aria-label="${s.closeAria}" onclick="closeCheckout()">${ico("close")}</button></div>
 <div class="notice">${s.checkoutNotice}</div>
 ${enabledPaymentMethods().some((pm) => pm.id === "cod") ? `<div class="cod-note">${s.codHighlight}</div>` : ""}
 <form onsubmit="submitOrder(event)" novalidate>
  <label for="name">${s.fullName}</label><input id="name" required autocomplete="name" placeholder="${s.fullNamePh}">
  <label for="phone">${s.phone}</label><input id="phone" required type="tel" inputmode="tel" autocomplete="tel" placeholder="${s.phonePh}">

  <label>${s.deliveryLocationTitle}</label>
  <div class="choice-row" id="deliveryLocationPicker" role="group" aria-label="${s.deliveryLocationTitle}">
    <button type="button" class="choice-btn ${deliveryLocation === "home" ? "active" : ""}" aria-pressed="${deliveryLocation === "home"}" onclick="selectDeliveryLocation('home')"><span class="choice-emoji">${ico("maison")}</span>${s.deliveryHome}</button>
    <button type="button" class="choice-btn ${deliveryLocation === "work" ? "active" : ""}" aria-pressed="${deliveryLocation === "work"}" onclick="selectDeliveryLocation('work')"><span class="choice-emoji">${ico("travail")}</span>${s.deliveryWork}</button>
  </div>

  <label>${s.mealTypeTitle}</label>
  <div class="choice-row" id="mealTypePicker" role="group" aria-label="${s.mealTypeTitle}">
    <button type="button" class="choice-btn ${mealType === "lunch" ? "active" : ""}" aria-pressed="${mealType === "lunch"}" onclick="selectMealType('lunch')"><span class="choice-emoji">${ico("dejeuner")}</span>${s.mealTypeLunch}</button>
    <button type="button" class="choice-btn ${mealType === "dinner" ? "active" : ""}" aria-pressed="${mealType === "dinner"}" onclick="selectMealType('dinner')"><span class="choice-emoji">${ico("diner")}</span>${s.mealTypeDinner}</button>
  </div>

  <label for="address" id="addressLabel">${deliveryLocation === "work" ? s.addressLabelWork : s.addressLabelHome}</label>
  <div style="display:flex;gap:8px;align-items:center">
    <input id="address" required autocomplete="street-address" placeholder="${s.addressPh}" style="flex:1;min-width:0" oninput="document.getElementById('mapLink').value=''">
    <button type="button" id="locBtn" class="location-btn" onclick="useMyLocation()">${s.locateBtn}</button>
  </div>
  <input type="hidden" id="mapLink" value="">
  <div id="locStatus" class="field-note"></div>

  <div class="schedule-box">
    <div class="schedule-title">${s.scheduleTitle}</div>
    <div id="scheduleCalendar" class="schedule-calendar">${scheduleCalendarHtml()}</div>
    <div class="time-row">
      <div><label for="deliveryTime">${s.deliveryTime}</label><input id="deliveryTime" type="time" required onchange="updateSchedulePreview()"></div>
    </div>
    <div id="schedulePreview" class="schedule-preview">${s.schedulePreviewDefault}</div>
  </div>

  <div class="schedule-box" style="background:#f0fdf4;border-color:#a7f3d0">
    <div class="schedule-title" style="color:#065f46">${s.paymentMethodLabel}</div>
    <div id="paymentMethodPicker">${paymentMethodBoxHtml()}</div>
  </div>

  <label for="notes">${s.notes}</label><textarea id="notes" rows="2" placeholder="${s.notesPh}"></textarea>
  <div class="summary" id="checkoutSummary">${checkoutSummaryHtml()}</div>
  <button class="checkout" type="submit">${s.confirmOrder}</button>
 </form>`;
  setupScheduleDefaults();
  if (userProfile) {
    if (userProfile.name) document.getElementById("name").value = userProfile.name;
    if (userProfile.phone) document.getElementById("phone").value = userProfile.phone;
    if (userProfile.address) document.getElementById("address").value = userProfile.address;
  }
}
// كيبني تفصيل حساب المجموع فصفحة إتمام الطلب (تكلفة اليوم × عدد الأيام الحقيقي المختار، وخصم الباقة إلا كان)
// باش الزبون يشوف بعينيه كيفاش تحسب نسبة 10%/20% ديال الباقة، ماشي غير رقم نهائي بلا تفصيل
function checkoutSummaryHtml() {
  const s = t(lang);
  const p = effectivePlan();
  const days = actualDays() ?? p.days;
  return `
   <div class="sumrow"><span>${s.dailyCost}</span><b>${money(dailyTotal())}</b></div>
   <div class="sumrow"><span>${s.planDuration}</span><b>× ${days}</b></div>
   ${p.discount ? `<div class="sumrow" style="color:#047857"><span>${s.planDiscount}</span><b>-${p.discount * 100}%</b></div>` : ""}
   <div class="sumrow total"><span>${s.subscriptionTotal}</span><b id="checkoutTotalDisplay">${money(checkoutTotal())}</b></div>`;
}
function closeCheckout() {
  document.getElementById("checkoutModal").classList.remove("show");
}
/* ---------- طريقة الأداء ---------- */
function enabledPaymentMethods() {
  return PAYMENT_METHODS.filter((pm) => (paymentMethodsConfig[pm.id]?.enabled ?? true) !== false);
}
function paymentMethodBoxHtml() {
  const s = t(lang);
  const list = enabledPaymentMethods();
  const selected = PAYMENT_METHODS.find((p) => p.id === paymentMethod);
  const cfg = paymentMethod ? paymentMethodsConfig[paymentMethod] || {} : null;
  return `
   <button type="button" class="pay-toggle" aria-expanded="${paymentPickerOpen}" onclick="togglePaymentPicker()">
     <span>${selected ? paymentIconHtml(selected) + " " + s.paymentMethods[selected.id] : s.choosePaymentMethod}</span>
     <span aria-hidden="true">${paymentPickerOpen ? "▲" : "▼"}</span>
   </button>
   ${
     paymentPickerOpen
       ? `<div class="pay-list">${list
           .map(
             (pm) =>
               `<button type="button" class="pay-item ${paymentMethod === pm.id ? "active" : ""}" aria-pressed="${paymentMethod === pm.id}" onclick="selectPaymentMethod('${pm.id}')">${paymentIconHtml(pm)} ${
                 s.paymentMethods[pm.id]
               }</button>`
           )
           .join("")}</div>`
       : ""
   }
   ${
     cfg && (cfg.rib || cfg.holder || cfg.note)
       ? `<div class="notice pay-info" style="margin-top:10px">
       <b>${s.paymentInstructionsTitle}</b>
       ${
         cfg.rib
           ? `<div class="pay-info-row">
              <div><span>${s.paymentRibLabel}</span><b class="pay-info-value">${escapeHtml(cfg.rib)}</b></div>
              <button type="button" class="copy-btn" data-copy="${escapeAttr(cfg.rib)}" onclick="copyToClipboard(this)">${s.copyBtn}</button>
            </div>`
           : ""
       }
       ${
         cfg.holder
           ? `<div class="pay-info-row">
              <div><span>${s.paymentHolderLabel}</span><b class="pay-info-value">${escapeHtml(cfg.holder)}</b></div>
              <button type="button" class="copy-btn" data-copy="${escapeAttr(cfg.holder)}" onclick="copyToClipboard(this)">${s.copyBtn}</button>
            </div>`
           : ""
       }
       ${cfg.note ? `<div class="pay-info-note">${escapeHtml(cfg.note)}</div>` : ""}
     </div>`
       : ""
   }`;
}
function togglePaymentPicker() {
  paymentPickerOpen = !paymentPickerOpen;
  const el = document.getElementById("paymentMethodPicker");
  if (el) el.innerHTML = paymentMethodBoxHtml();
}
function selectPaymentMethod(id) {
  paymentMethod = id;
  paymentPickerOpen = false;
  const el = document.getElementById("paymentMethodPicker");
  if (el) el.innerHTML = paymentMethodBoxHtml();
}
// اختيار مكان الاستلام (منزل/عمل): كيبدل الزر النشيط وكيبدل تسمية حقل العنوان تبعاً لهاد الاختيار
function selectDeliveryLocation(loc) {
  const s = t(lang);
  deliveryLocation = loc;
  const el = document.getElementById("deliveryLocationPicker");
  if (el) {
    el.querySelectorAll(".choice-btn").forEach((btn, i) => {
      const active = i === 0 ? loc === "home" : loc === "work";
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
  const label = document.getElementById("addressLabel");
  if (label) label.textContent = loc === "work" ? s.addressLabelWork : s.addressLabelHome;
}
// اختيار نوع الوجبة (غداء/عشاء)
function selectMealType(type) {
  mealType = type;
  const el = document.getElementById("mealTypePicker");
  if (el) {
    el.querySelectorAll(".choice-btn").forEach((btn, i) => {
      const active = i === 0 ? type === "lunch" : type === "dinner";
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
}
// كيبني شبكة التقويم الشهري لاختيار أيام التوصيل — اختيار حر لعدة أيام مو متتالية بلا قيد، والأيام لي فاتت معطلة
function scheduleCalendarHtml() {
  const s = t(lang);
  if (!scheduleCalendarMonth) scheduleCalendarMonth = new Date();
  const year = scheduleCalendarMonth.getFullYear();
  const month = scheduleCalendarMonth.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthLabel = first.toLocaleDateString(lang === "fr" ? "fr-FR" : "ar-MA", { month: "long", year: "numeric" });
  const now = new Date();
  const atCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  let cells = "";
  for (let i = 0; i < startWeekday; i++) cells += `<span class="cal-cell cal-empty"></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isPast = dateStr < todayStr;
    const isSelected = selectedScheduleDates.includes(dateStr);
    cells += isPast
      ? `<span class="cal-cell disabled">${d}</span>`
      : `<button type="button" class="cal-cell${isSelected ? " selected" : ""}" onclick="toggleScheduleDate('${dateStr}')">${d}</button>`;
  }
  return `
   <div class="cal-header">
     <button type="button" class="cal-nav" onclick="changeScheduleMonth(-1)" aria-label="${s.calPrevMonth}" ${atCurrentMonth ? "disabled" : ""}>‹</button>
     <span class="cal-month-label">${monthLabel}</span>
     <button type="button" class="cal-nav" onclick="changeScheduleMonth(1)" aria-label="${s.calNextMonth}">›</button>
   </div>
   <div class="cal-daynames">${s.calendarDayNames.map((n) => `<span>${n}</span>`).join("")}</div>
   <div class="cal-grid">${cells}</div>`;
}
function refreshScheduleCalendar() {
  const cal = document.getElementById("scheduleCalendar");
  if (cal) cal.innerHTML = scheduleCalendarHtml();
}
function changeScheduleMonth(delta) {
  const d = new Date(scheduleCalendarMonth);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const minMonth = new Date();
  minMonth.setDate(1);
  if (d < minMonth) d.setTime(minMonth.getTime());
  scheduleCalendarMonth = d;
  refreshScheduleCalendar();
}
// كيبدّل اختيار يوم معين (يزيده أو يحيدو) — الزبون يقدر يختار عدة أيام مو متتالية (مثلاً 5 و6 و7 و9)
function toggleScheduleDate(dateStr) {
  const idx = selectedScheduleDates.indexOf(dateStr);
  const wasSelected = idx >= 0;
  if (wasSelected) selectedScheduleDates.splice(idx, 1);
  else selectedScheduleDates.push(dateStr);
  selectedScheduleDates.sort();
  refreshScheduleCalendar();
  updateSchedulePreview();
  if (!wasSelected && cartHasPack()) showMealConfirmPopup(dateStr);
}
// كيرجع لائحة الوجبات المحددة (من إدارة الباقات الأسبوعية) ليوم من الأسبوع معين، غير للباقات لي كاينة فالسلة دابا
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function packMealsForDate(dateStr) {
  const dayKey = WEEKDAY_KEYS[new Date(dateStr + "T00:00:00").getDay()];
  const activePacks = Object.keys(cart)
    .filter((id) => id.startsWith("pack:"))
    .map((id) => id.slice(5));
  const out = [];
  for (const packId of activePacks) {
    const meal = weeklyPackages[packId]?.days?.[dayKey];
    if (meal && meal.name) out.push({ packId, name: meal.name });
  }
  return out;
}
// كيبان لما الزبون يختار يوم فيه باقة، باش يتأكد من الوجبة لي غادي توصل ليه هاد اليوم قبل ما يكمل
function showMealConfirmPopup(dateStr) {
  const meals = packMealsForDate(dateStr);
  if (!meals.length) return;
  const s = t(lang);
  const lines = meals
    .map((mm) => `<b>${escapeHtml(lang === "fr" ? PACK_TITLES[mm.packId].fr : PACK_TITLES[mm.packId].ar)}</b>: ${escapeHtml(mm.name)}`)
    .join("<br>");
  let box = document.getElementById("mealConfirmPopup");
  if (!box) {
    box = document.createElement("div");
    box.id = "mealConfirmPopup";
    box.className = "meal-confirm-popup";
    document.body.appendChild(box);
  }
  box.innerHTML = `<div class="meal-confirm-box">
    <div class="meal-confirm-text">${s.mealConfirmText(formatDate(new Date(dateStr + "T00:00:00")), lines)}</div>
    <button type="button" class="meal-confirm-ok" onclick="closeMealConfirmPopup()">${s.mealConfirmOk}</button>
  </div>`;
  box.classList.add("show");
}
function closeMealConfirmPopup() {
  const box = document.getElementById("mealConfirmPopup");
  if (box) box.classList.remove("show");
}
// أول مرة كتفتح صفحة الجدولة، كنقترحو أيام متتالية بعدد مدة الباقة المختارة (يومي/أسبوعي/شهري) كنقطة بداية، والزبون حر يبدلها
function setupScheduleDefaults() {
  if (!scheduleCalendarMonth) scheduleCalendarMonth = new Date();
  if (!selectedScheduleDates.length) {
    const p = effectivePlan();
    const today = new Date();
    for (let i = 0; i < p.days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      selectedScheduleDates.push(d.toISOString().slice(0, 10));
    }
  }
  refreshScheduleCalendar();
  updateSchedulePreview();
}
function updateSchedulePreview() {
  const s = t(lang);
  const time = document.getElementById("deliveryTime")?.value;
  const box = document.getElementById("schedulePreview");
  const summaryBox = document.getElementById("checkoutSummary");
  if (summaryBox) summaryBox.innerHTML = checkoutSummaryHtml();
  if (!box) return;
  if (!selectedScheduleDates.length || !time) {
    box.textContent = s.schedulePreviewDefault;
    return;
  }
  const sorted = [...selectedScheduleDates].sort();
  const list = sorted.map((d) => formatDate(new Date(d + "T00:00:00"))).join("، ");
  box.innerHTML = s.schedulePreviewDays(sorted.length, list, time);
}

function useMyLocation() {
  const s = t(lang);
  const btn = document.getElementById("locBtn");
  const status = document.getElementById("locStatus");
  const field = document.getElementById("address");
  if (!btn || !status || !field) return;

  if (!window.isSecureContext && location.hostname !== "localhost") {
    status.textContent = s.locSecure;
    status.style.color = "#dc2626";
    return;
  }
  if (!navigator.geolocation) {
    status.textContent = s.locUnsupported;
    status.style.color = "#dc2626";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = s.locWaiting;
  status.style.color = "#064e3b";
  status.textContent = s.locPermissionNote;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const mapLinkField = document.getElementById("mapLink");
      if (mapLinkField) mapLinkField.value = `https://www.google.com/maps?q=${latitude},${longitude}`;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=${lang}&zoom=18`
        );
        const data = await res.json();
        field.value = data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        status.style.color = "#047857";
        status.textContent = s.locSuccess;
      } catch (e) {
        field.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        status.style.color = "#047857";
        status.textContent = s.locSuccessCoords;
      }
      btn.disabled = false;
      btn.innerHTML = s.locRefresh;
    },
    (err) => {
      btn.disabled = false;
      btn.innerHTML = s.locRetry;
      status.style.color = "#dc2626";
      if (err.code === 1) status.textContent = s.locDenied;
      else if (err.code === 3) status.textContent = s.locTimeout;
      else status.textContent = s.locFailed;
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
  );
}

async function submitOrder(e) {
  e.preventDefault();
  const s = t(lang);
  // الطلب كيتطلب حساب مسجل (قواعد Firestore كتفرض هادشي): إلا سالات الجلسة والنموذج مازال مفتوح، نرجعو الزبون لتسجيل الدخول والسلة كتبقى محفوظة
  if (!currentUser) {
    pendingCheckoutAfterLogin = true;
    closeCheckout();
    openAccount();
    return;
  }
  const phone = normalizePhone(document.getElementById("phone").value);
  if (!document.getElementById("name").value.trim()) {
    toast(s.fullName + " ✗", "error");
    document.getElementById("name").focus();
    return;
  }
  if (!PHONE_RE.test(phone)) {
    toast(s.phoneInvalid, "error");
    document.getElementById("phone").focus();
    return;
  }
  if (!document.getElementById("address").value.trim()) {
    toast(s.address + " ✗", "error");
    document.getElementById("address").focus();
    return;
  }
  if (!deliveryLocation) {
    toast(s.deliveryLocationRequired, "error");
    return;
  }
  if (!mealType) {
    toast(s.mealTypeRequired, "error");
    return;
  }
  const scheduleDates = [...selectedScheduleDates].sort();
  const deliveryTime = document.getElementById("deliveryTime").value;
  if (!scheduleDates.length || !deliveryTime) {
    toast(s.scheduleMissing, "error");
    return;
  }
  if (!paymentMethod) {
    toast(s.paymentMethodRequired, "error");
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = s.sendingOrder;
  }

  const durationDays = actualDays() || 1;
  const name = document.getElementById("name").value.trim();
  const address = document.getElementById("address").value.trim();
  const mapLink = document.getElementById("mapLink")?.value || "";

  const order = {
    uid: currentUser ? currentUser.uid : null,
    customer: {
      name,
      phone,
      address,
      mapLink,
      notes: document.getElementById("notes").value.trim(),
    },
    schedule: { dates: scheduleDates, dateFrom: scheduleDates[0], dateTo: scheduleDates[scheduleDates.length - 1], deliveryTime },
    plan,
    durationDays,
    paymentMethod,
    paymentMethodLabel: s.paymentMethods[paymentMethod] || paymentMethod,
    deliveryLocation,
    mealType,
    lang,
    items: cartItems().map((x) => (x.pack ? { name: x.name, price: x.price, qty: x.qty, pack: x.pack } : { name: x.name, price: x.price, qty: x.qty })),
    total: checkoutTotal(),
    status: "قيد المراجعة",
    createdAt: serverTimestamp(),
  };

  try {
    const ref = await addDoc(collection(db, "orders"), order);
    await maybeCreateMembership(order, ref.id);
    if (currentUser) {
      await awardOrderPoints(currentUser.uid, order, ref.id);
    }
    // نحفظو معلومات الزبون (الاسم والعنوان) فحسابو باش تتعبى تلقائياً فالمرة الجاية
    if (currentUser) {
      try {
        await setDoc(doc(db, "users", currentUser.uid), { name, address, phone }, { merge: true });
        userProfile = { ...userProfile, name, address, phone };
      } catch (e) {
        /* ما توقفش الطلب إلا فشل حفظ الملف الشخصي */
      }
    }
    cart = {};
    selectedScheduleDates = [];
    scheduleCalendarMonth = null;
    render();
    // حالة تأكيد الطلب فنفس النافذة (ما كتتمسحش ملي كيتحدثو الأطباق)
    const box = document.getElementById("checkoutContent");
    box.innerHTML = `
     <div class="confirm-box" role="status">
       <div class="confirm-check" aria-hidden="true">✓</div>
       <h2>${s.orderSuccessTitle}</h2>
       <p>${s.orderRefLabel}</p>
       <div class="confirm-ref">${orderCode(ref.id)}</div>
       <button type="button" class="copy-link-btn" data-copy="${escapeAttr(orderCode(ref.id))}" onclick="copyOrderNumber(this)" style="border:0;background:#f0fdf4;color:#047857;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:800;cursor:pointer;margin:2px 0 10px">${s.copyOrderNumber}</button>
       <p>${s.orderWillContact(escapeHtml(phone))}</p>
       <button type="button" class="checkout" onclick="closeCheckout();scrollToMenu()">${s.newOrderBtn}</button>
     </div>`;
    box.scrollTop = 0;
  } catch (err) {
    toast(s.orderError, "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = s.confirmOrder;
    }
  }
}

/* ---------- نظام الحساب: تسجيل الدخول / التسجيل / الملف الشخصي ---------- */
/* ═══════ نظام النقاط والولاء ═══════ */
function tierFor(lifetimePoints) {
  return TIERS.find((tr) => lifetimePoints >= tr.min && lifetimePoints <= tr.max) || TIERS[0];
}
function tierLabel(tierId, s) {
  return { bronze: s.tierBronze, silver: s.tierSilver, gold: s.tierGold, vip: s.tierVip }[tierId] || s.tierBronze;
}

async function awardPoints(uid, points, reason, orderId, docId) {
  if (!points || !loyaltyEnabled) return;
  try {
    const entry = {
      uid,
      points,
      reason,
      orderId: orderId || null,
      createdAt: serverTimestamp(),
    };
    // docId ثابت (مثلاً ref_<uid المدعو>) كيمنع تسجيل نفس المكافأة مرتين؛ بدونو كيتولد id تلقائي
    if (docId) await setDoc(doc(db, "pointsLog", docId), entry);
    else await addDoc(collection(db, "pointsLog"), entry);
  } catch (e) {
    /* ما توقفش الطلب إلا فشل تسجيل النقط */
  }
}

// كود الدعوة → uid ديال صاحبو. كنقراو وثيقة referralCodes/{CODE} بالاسم (ماشي استعلام على users، حيت users مقفلة على الزبناء)
async function lookupReferrerUid(code, ownUid) {
  const clean = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return null;
  try {
    const snap = await getDoc(doc(db, "referralCodes", clean));
    const refUid = snap.exists() ? snap.data().uid : null;
    return refUid && refUid !== ownUid ? refUid : null;
  } catch (e) {
    return null;
  }
}
// كيسجل كود الدعوة ديال الزبون (referralCodes/{CODE} = { uid }) إلا ماكانش مسجل — مرة وحدة، وما كيوقف حتى شي عملية إلا فشل
async function ensureReferralCodeDoc(uid, code) {
  if (!uid || !/^[A-Z0-9]{6}$/.test(code || "")) return;
  try {
    const ref = doc(db, "referralCodes", code);
    const snap = await getDoc(ref);
    if (!snap.exists()) await setDoc(ref, { uid });
  } catch (e) {
    /* غير أساسي */
  }
}

async function fetchPointsSummary(uid) {
  // الرصيد الحقيقي = مجموع كل عمليات النقط ديال الزبون (كنحسبوه هنا، ماشي رقم مخزن قابل للتلاعب)
  let entries = [];
  try {
    const q = query(collection(db, "pointsLog"), where("uid", "==", uid));
    const snap = await getDocs(q);
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    entries = [];
  }
  entries.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  let balance = 0,
    lifetime = 0;
  entries.forEach((en) => {
    const p = Number(en.points) || 0;
    balance += p;
    if (p > 0) lifetime += p;
  });
  return { balance, lifetime, entries };
}

async function awardOrderPoints(uid, order, orderId) {
  const s = t(lang);
  let profile;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    profile = snap.exists() ? snap.data() : {};
  } catch (e) {
    profile = {};
  }

  const orderCountBefore = profile.orderCount || 0;
  const newOrderCount = orderCountBefore + 1;
  const isFirstOrder = orderCountBefore === 0;

  const monthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const sameMonth = profile.lastOrderMonthKey === monthKey;
  const ordersThisMonth = (sameMonth ? profile.ordersThisMonth || 0 : 0) + 1;

  const awards = [];
  if (isFirstOrder) awards.push({ points: pointsRules.firstOrderPoints, reason: s.reasonFirstOrder });

  const madPoints = Math.floor(order.total / pointsRules.perDirham);
  if (madPoints > 0) awards.push({ points: madPoints, reason: s.reasonOrderPoints(Math.round(order.total)) });

  let repeatBonus = 0;
  if (newOrderCount >= 2 && newOrderCount <= 4) repeatBonus = 10;
  else if (newOrderCount >= 5 && newOrderCount <= 9) repeatBonus = 20;
  else if (newOrderCount >= 10) repeatBonus = 30;
  if (repeatBonus) awards.push({ points: repeatBonus, reason: s.reasonRepeatBonus });

  if (newOrderCount === 3 && !profile.orderMilestone3Given) {
    awards.push({ points: pointsRules.streak3Bonus, reason: s.reasonStreak3 });
  }
  if (ordersThisMonth === 5) awards.push({ points: pointsRules.monthly5Bonus, reason: s.reasonMonthly5 });
  if (ordersThisMonth === 10) awards.push({ points: pointsRules.monthly10Bonus, reason: s.reasonMonthly10 });

  for (const a of awards) {
    await awardPoints(uid, a.points, a.reason, orderId);
  }

  // مكافأة الدعوة: إلا كان الزبون مدعو من صاحبو وهاد أول طلب ليه، صاحبو كيربح النقط
  if (isFirstOrder && profile.referredByUid && !profile.referralBonusGiven) {
    await awardPoints(profile.referredByUid, pointsRules.referralPoints, s.reasonReferral(order.customer.name), orderId, "ref_" + uid);
  }

  try {
    await setDoc(
      doc(db, "users", uid),
      {
        orderCount: newOrderCount,
        ordersThisMonth,
        lastOrderMonthKey: monthKey,
        orderMilestone3Given: profile.orderMilestone3Given || newOrderCount >= 3,
        referralBonusGiven: profile.referralBonusGiven || (isFirstOrder && !!profile.referredByUid),
      },
      { merge: true }
    );
  } catch (e) {
    /* تجاهل */
  }
}

/* ---------- صفحة "مكافآتي" ---------- */
function rewardsDisabledHtml() {
  const s = t(lang);
  return `<div class="modal-head"><h3>${ico("rewards")}${s.rewardsTitle}</h3><button class="close" onclick="closeRewards()">${ico("close")}</button></div>
   <div class="empty" style="padding:60px 20px">${s.loyaltyComingSoon}</div>`;
}
async function openRewards() {
  if (!currentUser) {
    pendingCheckoutAfterLogin = false;
    openAccount();
    return;
  }
  document.getElementById("accountModal").classList.remove("show");
  document.getElementById("rewardsModal").classList.add("show");
  if (!loyaltyEnabled) {
    document.getElementById("rewardsContent").innerHTML = rewardsDisabledHtml();
    return;
  }
  document.getElementById("rewardsContent").innerHTML = `<div class="empty">${ico("loading")}</div>`;
  await renderRewardsPage();
}
function closeRewards() {
  document.getElementById("rewardsModal").classList.remove("show");
}

/* ═══════ طلباتي: لائحة الطلبات السابقة + رقم الطلب القابل للنسخ + التفاصيل ═══════ */
// خريطة القيمة الفعلية المخزنة فـ Firestore (status) إلى مفتاح ثابت للترجمة/الألوان
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
function orderStatusKey(status) {
  return ORDER_STATUS_KEYS[status] || "pending";
}
function orderStatusBadge(status, s) {
  const key = orderStatusKey(status);
  return `<span class="status-badge status-${key}">${s.orderStatus[key]}</span>`;
}
async function openMyOrders() {
  if (!currentUser) {
    openAccount();
    return;
  }
  const s = t(lang);
  document.getElementById("accountModal").classList.remove("show");
  document.getElementById("myOrdersModal").classList.add("show");
  document.getElementById("myOrdersContent").innerHTML = `<div class="modal-head"><h3>${ico("orders")}${s.myOrdersTitle}</h3><button class="close" onclick="closeMyOrders()">${ico("close")}</button></div><div class="empty" style="padding:30px">…</div>`;
  await renderMyOrdersList();
}
function closeMyOrders() {
  document.getElementById("myOrdersModal").classList.remove("show");
}
// كاش بسيط فالذاكرة لطلبات الزبون الحالية (باش زر "التفاصيل" ما يعاودش يقرا Firestore)
let myOrdersCache = [];
async function renderMyOrdersList() {
  const s = t(lang);
  const uid = currentUser.uid;
  try {
    const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", uid)));
    myOrdersCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch (e) {
    document.getElementById("myOrdersContent").innerHTML = `<div class="modal-head"><h3>${ico("orders")}${s.myOrdersTitle}</h3><button class="close" onclick="closeMyOrders()">${ico("close")}</button></div><div class="empty" style="padding:30px">${s.orderError}</div>`;
    return;
  }
  const cardsHtml = myOrdersCache.length
    ? myOrdersCache
        .map(
          (o) => `
      <div class="order-card">
        <div class="order-card-top">
          <span class="order-code">${orderCode(o.id)}</span>
          ${orderStatusBadge(o.status, s)}
        </div>
        <div class="order-card-meta">${formatDate(o.schedule?.dateFrom || "")} · ${money(o.total)}</div>
        <div class="order-card-actions">
          <button type="button" class="copy-link-btn" data-copy="${escapeAttr(orderCode(o.id))}" onclick="copyOrderNumber(this)" style="border:0;background:#f0fdf4;color:#047857;border-radius:10px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer">${s.copyOrderNumber}</button>
          <button type="button" class="btn-outline-sm" onclick="openOrderDetail('${o.id}')">${s.orderDetailsBtn}</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty" style="padding:30px">${s.noOrdersYet}</div>`;
  document.getElementById("myOrdersContent").innerHTML = `
    <div class="modal-head"><h3>${ico("orders")}${s.myOrdersTitle}</h3><button class="close" onclick="closeMyOrders()">${ico("close")}</button></div>
    ${cardsHtml}`;
}
function openOrderDetail(id) {
  const s = t(lang);
  const o = myOrdersCache.find((x) => x.id === id);
  if (!o) return;
  const itemsHtml = (o.items || [])
    .map(
      (it) =>
        `<div class="order-detail-row"><span>${escapeHtml(it.name)} ×${escapeHtml(it.qty)}</span><b>${money((it.price || 0) * (it.qty || 0))}</b></div>`
    )
    .join("");
  const locLabel = o.deliveryLocation === "work" ? s.deliveryWork : o.deliveryLocation === "home" ? s.deliveryHome : s.notSpecified;
  const mealLabel = o.mealType === "lunch" ? s.mealTypeLunch : o.mealType === "dinner" ? s.mealTypeDinner : s.notSpecified;
  document.getElementById("myOrdersContent").innerHTML = `
    <div class="modal-head"><h3>${orderCode(o.id)}</h3><button class="close" onclick="closeMyOrders()">${ico("close")}</button></div>
    <button type="button" class="link-btn" style="margin-bottom:10px" onclick="renderMyOrdersList()">${s.backToOrders}</button>
    <div class="order-detail-section">
      <div class="order-detail-row"><span>${s.orderStatusLabel}</span>${orderStatusBadge(o.status, s)}</div>
      <div class="order-detail-row"><span>${s.orderDateLabel}</span><b>${formatDate(o.schedule?.dateFrom || "")}</b></div>
      <button type="button" class="copy-link-btn" data-copy="${escapeAttr(orderCode(o.id))}" onclick="copyOrderNumber(this)" style="margin-top:6px;border:0;background:#f0fdf4;color:#047857;border-radius:10px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer">${s.copyOrderNumber}</button>
    </div>
    <div class="order-detail-section">
      <h4>${ico("location")}${s.deliveryLocationTitle}</h4>
      <div class="order-detail-row"><span>${locLabel}</span></div>
      <div class="order-detail-row"><span>${s.orderAddressLabel}</span><span>${escapeHtml(o.customer?.address || s.notSpecified)}</span></div>
    </div>
    <div class="order-detail-section">
      <h4>${ico("dejeuner")}${s.mealTypeTitle}</h4>
      <div class="order-detail-row"><span>${mealLabel}</span></div>
    </div>
    <div class="order-detail-section">
      <h4>${ico("panier")}${s.orderItemsLabel}</h4>
      ${itemsHtml}
    </div>
    <div class="order-detail-section">
      <div class="order-detail-row"><span>${s.orderPaymentLabel}</span><span>${escapeHtml(o.paymentMethodLabel || s.notSpecified)}</span></div>
      <div class="order-detail-row"><span>${s.orderTotalLabel}</span><b>${money(o.total)}</b></div>
    </div>
    ${
      o.customer?.notes
        ? `<div class="order-detail-section"><h4>📝 ${s.orderNotesLabel}</h4><div class="order-detail-row"><span>${escapeHtml(o.customer.notes)}</span></div></div>`
        : ""
    }
    ${cancelOrderBlockHtml(o, s)}
  `;
}

async function renderRewardsPage() {
  const s = t(lang);
  const uid = currentUser.uid;
  ensureReferralCodeDoc(uid, userProfile?.referralCode); // باش رابط الدعوة يخدم (كيتسجل مرة وحدة)

  const [{ balance, lifetime, entries }, rewardsSnap, ordersSnap] = await Promise.all([
    fetchPointsSummary(uid),
    getDocs(query(collection(db, "rewards"), where("active", "==", true))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, "orders"), where("uid", "==", uid))).catch(() => ({ docs: [] })),
  ]);

  const rewards = rewardsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.pointsCost - b.pointsCost);
  const orders = ordersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const tier = tierFor(lifetime);
  const nextReward = rewards.find((r) => r.pointsCost > balance);
  const cheapestCost = rewards.length ? rewards[0].pointsCost : null;
  const progressTarget = nextReward ? nextReward.pointsCost : cheapestCost;
  const progressPct = progressTarget ? Math.max(0, Math.min(100, Math.round((balance / progressTarget) * 100))) : 100;

  const referralLink = `${window.location.origin}${window.location.pathname}?ref=${userProfile?.referralCode || ""}`;

  const rewardsHtml = rewards.length
    ? rewards
        .map(
          (r) => `<div class="reward-card">
      <div class="reward-name">${escapeHtml(r.name)}</div>
      ${r.description ? `<div class="reward-desc">${escapeHtml(r.description)}</div>` : ""}
      <div class="reward-bottom">
        <span class="reward-cost">${r.pointsCost} ${s.pointsLabel}</span>
        <button class="add" ${balance < r.pointsCost ? "disabled style='opacity:.4;cursor:not-allowed'" : ""} onclick="redeemReward('${r.id}')">${s.redeemBtn}</button>
      </div>
    </div>`
        )
        .join("")
    : "";

  const historyHtml = entries.length
    ? entries
        .slice(0, 20)
        .map(
          (en) =>
            `<div class="history-row"><span>${iconize(escapeHtml(en.reason || ""))}</span><b style="color:${
              en.points >= 0 ? "#047857" : "#dc2626"
            }">${en.points >= 0 ? "+" : ""}${en.points}</b></div>`
        )
        .join("")
    : `<div class="empty" style="padding:20px">${s.noPointsHistory}</div>`;

  const unratedOrders = orders.filter((o) => !o.reviewed).slice(0, 5);
  const ordersHtml = unratedOrders.length
    ? unratedOrders
        .map(
          (o) =>
            `<div class="history-row"><span>${formatDate(o.schedule?.dateFrom || o.createdAt)} — ${money(o.total)}</span><button class="link-btn" onclick="openRateOrder('${
              o.id
            }')">${s.rateOrder}</button></div>`
        )
        .join("")
    : orders.length
    ? ""
    : `<div class="empty" style="padding:20px">${s.noOrdersYet}</div>`;

  document.getElementById("rewardsContent").innerHTML = `
   <div class="modal-head"><h3>${ico("rewards")}${s.rewardsTitle}</h3><button class="close" onclick="closeRewards()">${ico("close")}</button></div>
   <div class="points-hero">
     <div class="points-balance">${balance} <small>${s.pointsLabel}</small></div>
     <div class="points-tier">${tierLabel(tier.id, s)}</div>
   </div>
   <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progressPct}%"></div></div>
   <p style="text-align:center;font-size:13px;color:#57534e;margin:8px 0 20px">
     ${nextReward ? s.progressToNext(nextReward.pointsCost - balance, escapeHtml(nextReward.name)) + " " + ico("rewards") : rewards.length ? s.allRewardsUnlocked : ""}
   </p>

   ${rewards.length ? `<h4 style="margin:16px 0 10px;color:var(--primary)">${s.availableRewards}</h4><div class="rewards-grid">${rewardsHtml}</div>` : ""}

   <div class="referral-box">
     <div style="font-weight:900;margin-bottom:4px">${s.inviteFriend}</div>
     <div style="font-size:12px;opacity:.85;margin-bottom:10px">${s.inviteFriendDesc}</div>
     <button type="button" class="location-btn" style="width:100%;justify-content:center" onclick="copyReferralLink('${referralLink}')">${s.copyReferralLink}</button>
   </div>

   ${
     unratedOrders.length
       ? `<h4 style="margin:20px 0 10px;color:var(--primary)">${s.myOrdersToRate}</h4><div class="history-list">${ordersHtml}</div>`
       : ""
   }

   <h4 style="margin:20px 0 10px;color:var(--primary)">${s.pointsHistory}</h4>
   <div class="history-list">${historyHtml}</div>
  `;
}

function copyReferralLink(link) {
  const s = t(lang);
  navigator.clipboard
    .writeText(link)
    .then(() => toast(s.copied))
    .catch(() => toast(link));
}

async function redeemReward(rewardId) {
  if (!loyaltyEnabled) return;
  const s = t(lang);
  const uid = currentUser.uid;
  const { balance } = await fetchPointsSummary(uid);
  let reward;
  try {
    const snap = await getDoc(doc(db, "rewards", rewardId));
    if (!snap.exists()) return;
    reward = snap.data();
  } catch (e) {
    return;
  }
  if (balance < reward.pointsCost) {
    toast(s.notEnoughPoints, "error");
    return;
  }
  const code = "WJ" + Math.random().toString(36).slice(2, 8).toUpperCase();
  try {
    // عملية وحدة (batch): خصم النقاط + طلب الاستبدال كيتسجلو مع بعض أو ما كيتسجل والو (قواعد Firestore كتطلب هادشي)
    const batch = writeBatch(db);
    batch.set(doc(db, "pointsLog", "redeem_" + code), {
      uid,
      points: -reward.pointsCost,
      reason: s.reasonRedeem(reward.name),
      orderId: null,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, "redemptions", code), {
      uid,
      rewardId,
      rewardName: reward.name,
      pointsCost: reward.pointsCost,
      code,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    document.getElementById("rewardsContent").innerHTML = `
      <div class="modal-head"><h3>${s.redeemSuccessTitle}</h3><button class="close" onclick="closeRewards()">${ico("close")}</button></div>
      <div class="notice" style="text-align:center">
        <div style="font-size:15px;margin-bottom:10px">${s.redeemCodeNote}</div>
        <div style="font-size:26px;font-weight:900;letter-spacing:3px;color:var(--primary)">${code}</div>
      </div>
      <button class="checkout" style="margin-top:16px" onclick="closeRewards()">${s.closeRedeem}</button>`;
  } catch (e) {
    toast(s.notEnoughPoints, "error");
  }
}

/* ---------- تقييم الطلب ---------- */
let ratingValue = 5;
function openRateOrder(orderId) {
  const s = t(lang);
  document.getElementById("rewardsModal").classList.remove("show");
  document.getElementById("rateModal").classList.add("show");
  ratingValue = 5;
  document.getElementById("rateContent").innerHTML = `
   <div class="modal-head"><h3>${s.rateModalTitle}</h3><button class="close" onclick="closeRateOrder()">${ico("close")}</button></div>
   <div id="starsRow" style="text-align:center;margin:16px 0"></div>
   <textarea id="rateComment" rows="2" placeholder="..."></textarea>
   <button class="checkout" style="margin-top:14px" onclick="submitRating('${orderId}')">${s.rateSubmit}</button>`;
  renderStars();
}
function renderStars() {
  const row = document.getElementById("starsRow");
  if (!row) return;
  row.innerHTML = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" aria-label="${n}/5" aria-pressed="${n === ratingValue}" style="border:0;background:none;padding:0 3px;min-width:var(--tap);min-height:var(--tap);font-size:34px;line-height:1;cursor:pointer;color:${n <= ratingValue ? "var(--accent)" : "var(--border)"}" onclick="setRating(${n})">★</button>`)
    .join("");
}
function setRating(n) {
  ratingValue = n;
  renderStars();
}
function closeRateOrder() {
  document.getElementById("rateModal").classList.remove("show");
}
async function submitRating(orderId) {
  const s = t(lang);
  const comment = document.getElementById("rateComment").value.trim();
  try {
    await setDoc(doc(db, "orders", orderId), { reviewed: true, rating: ratingValue, reviewComment: comment }, { merge: true });
    await awardPoints(currentUser.uid, pointsRules.reviewPoints, s.reasonReview, orderId);
    document.getElementById("rateContent").innerHTML = `<div class="notice" style="text-align:center;font-size:16px">${s.rateThanks}</div>
     <button class="checkout" style="margin-top:14px" onclick="closeRateOrder()">${s.closeRedeem}</button>`;
  } catch (e) {
    toast(s.orderError, "error");
  }
}


/* ═══════ الدردشة مع الدعم ═══════ */
// كيقبل غير تصويرة data:image/... base64 صحيحة، وأي شي آخر ما كيتحقنش فـ HTML
function safeChatImageHtml(v) {
  const src = String(v ?? "");
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return `<div class="chat-text">${ico("camera")}</div>`;
  return `<img src="${escapeAttr(src)}" class="chat-image" onclick="openImageLightbox(this.src)">`;
}
// كيقبل غير تسجيل data:audio/... base64 صحيح
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
// عارض الصور بملء الشاشة — يفتح مباشرة فالتطبيق بلا ما يحتاج نافذة منبثقة خارجية (window.open ما كيخدمش دائماً فتطبيقات الموبايل)
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
function renderChatMessages(messages) {
  const s = t(lang);
  const box = document.getElementById("chatMessages");
  if (!box) return;
  box.innerHTML = messages.length
    ? messages
        .map(
          (m) =>
            `<div class="chat-bubble ${m.senderRole === "customer" ? "chat-mine" : "chat-theirs"}">${chatMessageBodyHtml(m)}</div>`
        )
        .join("")
    : `<div class="empty" style="padding:30px 10px">${s.supportEmpty}</div>`;
  box.scrollTop = box.scrollHeight;
}

function openSupport() {
  if (!currentUser) {
    pendingSupportAfterLogin = true;
    openAccount();
    return;
  }
  const s = t(lang);
  document.getElementById("supportModal").classList.add("show");
  document.getElementById("supportContent").innerHTML = `
   <div class="modal-head"><h3>${ico("support")}${s.supportTitle}</h3><button class="close" onclick="closeSupport()">${ico("close")}</button></div>
   <div id="chatMessages" class="chat-box"></div>
   <div id="supportImageStatus" style="font-size:12px;color:#78716c;margin-top:6px"></div>
   <form id="supportForm" style="display:flex;gap:8px;margin-top:10px" onsubmit="sendSupportMessage(event)">
    <button type="button" class="chat-photo-btn" onclick="document.getElementById('supportImageInput').click()" title="${s.supportSendImage}">${ico("camera")}</button>
    <button type="button" class="chat-photo-btn" onclick="startVoiceRecording()" title="${s.supportSendVoice}">${ico("mic")}</button>
    <input type="file" id="supportImageInput" accept="image/*" style="display:none" onchange="handleSupportImageSelected(event)">
    <input id="supportInput" placeholder="${s.supportPlaceholder}" style="flex:1" required autocomplete="off">
    <button class="add" type="submit">${s.supportSend}</button>
   </form>
   <div id="voiceRecordingBar" class="voice-recording-bar" style="display:none">
    <span class="voice-dot" aria-hidden="true"></span>
    <span id="voiceTimer">00:00</span>
    <button type="button" class="voice-cancel-btn" aria-label="${s.voiceCancelAria}" onclick="cancelVoiceRecording()">${ico("trash")}</button>
    <button type="button" class="voice-send-btn" aria-label="${s.voiceSendAria}" onclick="stopAndSendVoiceRecording()">✓</button>
   </div>`;
  if (chatUnsubscribe) chatUnsubscribe();
  const uid = currentUser.uid;
  const q = query(collection(db, "messages"), where("threadId", "==", uid));
  chatUnsubscribe = onSnapshot(q, (snap) => {
    const messages = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    renderChatMessages(messages);
    messages
      .filter((m) => m.senderRole === "admin" && !m.readByCustomer)
      .forEach((m) => updateDoc(doc(db, "messages", m.id), { readByCustomer: true }).catch(() => {}));
  });
}
function closeSupport() {
  document.getElementById("supportModal").classList.remove("show");
  if (chatUnsubscribe) {
    chatUnsubscribe();
    chatUnsubscribe = null;
  }
}
async function sendSupportMessage(e) {
  e.preventDefault();
  const input = document.getElementById("supportInput");
  const text = input.value.trim();
  if (!text || !currentUser) return;
  input.value = "";
  try {
    await addDoc(collection(db, "messages"), {
      threadId: currentUser.uid,
      senderUid: currentUser.uid,
      senderRole: "customer",
      text,
      readByCustomer: true,
      readByAdmin: false,
      createdAt: serverTimestamp(),
    });
  } catch (e2) {
    input.value = text; // نرجعو النص للحقل إلا فشل الإرسال
  }
}
// كيضغط الصورة (تصغير الأبعاد + JPEG) قبل ما يصيفطها، حيت ما كاينش Firebase Storage فهاد المشروع
// والرسائل كتخزن مباشرة فـ Firestore، فخاصنا الحجم يبقى صغير
function compressImageFile(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode-failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function handleSupportImageSelected(event) {
  const s = t(lang);
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !currentUser) return;
  const statusBox = document.getElementById("supportImageStatus");
  if (statusBox) statusBox.innerHTML = s.supportImageSending;
  try {
    let dataUrl = await compressImageFile(file, 1000, 0.7);
    // إلا بقات الصورة كبيرة، نعاودو نضغطوها بجودة أقل
    if (dataUrl.length > 900000) dataUrl = await compressImageFile(file, 700, 0.5);
    if (dataUrl.length > 900000) {
      if (statusBox) statusBox.textContent = s.supportImageTooBig;
      return;
    }
    await addDoc(collection(db, "messages"), {
      threadId: currentUser.uid,
      senderUid: currentUser.uid,
      senderRole: "customer",
      text: "",
      imageData: dataUrl,
      readByCustomer: true,
      readByAdmin: false,
      createdAt: serverTimestamp(),
    });
    if (statusBox) statusBox.textContent = "";
  } catch (e) {
    if (statusBox) statusBox.textContent = s.supportImageFailed;
  }
}

/* ---------- تسجيل صوتي فالدردشة (رسالة صوتية بدل الكتابة) ---------- */
let voiceRecorder = null;
let voiceChunks = [];
let voiceStream = null;
let voiceStartTime = 0;
let voiceTimerInterval = null;
const VOICE_MAX_SECONDS = 60;
function pickVoiceMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}
async function startVoiceRecording() {
  const s = t(lang);
  if (!currentUser || !navigator.mediaDevices || !window.MediaRecorder) {
    toast(s.voiceMicDenied, "error");
    return;
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast(s.voiceMicDenied, "error");
    return;
  }
  voiceChunks = [];
  const mimeType = pickVoiceMimeType();
  voiceRecorder = mimeType ? new MediaRecorder(voiceStream, { mimeType }) : new MediaRecorder(voiceStream);
  voiceRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) voiceChunks.push(e.data);
  };
  voiceRecorder.start();
  voiceStartTime = Date.now();
  const form = document.getElementById("supportForm");
  const bar = document.getElementById("voiceRecordingBar");
  if (form) form.style.display = "none";
  if (bar) bar.style.display = "flex";
  updateVoiceTimer();
  voiceTimerInterval = setInterval(updateVoiceTimer, 250);
}
function updateVoiceTimer() {
  const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
  const el = document.getElementById("voiceTimer");
  if (el) {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  }
  if (elapsed >= VOICE_MAX_SECONDS) stopAndSendVoiceRecording();
}
function stopVoiceInternal() {
  if (voiceTimerInterval) {
    clearInterval(voiceTimerInterval);
    voiceTimerInterval = null;
  }
  if (voiceStream) {
    voiceStream.getTracks().forEach((tr) => tr.stop());
    voiceStream = null;
  }
  const bar = document.getElementById("voiceRecordingBar");
  const form = document.getElementById("supportForm");
  if (bar) bar.style.display = "none";
  if (form) form.style.display = "flex";
}
function cancelVoiceRecording() {
  if (voiceRecorder && voiceRecorder.state !== "inactive") {
    voiceRecorder.onstop = null;
    voiceRecorder.stop();
  }
  voiceRecorder = null;
  voiceChunks = [];
  stopVoiceInternal();
}
function stopAndSendVoiceRecording() {
  if (!voiceRecorder || voiceRecorder.state === "inactive") return;
  const s = t(lang);
  const recorder = voiceRecorder;
  recorder.onstop = async () => {
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(voiceChunks, { type: mimeType });
    voiceChunks = [];
    stopVoiceInternal();
    if (blob.size < 300) return; // تسجيل قصير بزاف أو فارغ، ما كنصيفطوش
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read-failed"));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.length > 1000000) {
        toast(s.voiceTooBig, "error");
        return;
      }
      await addDoc(collection(db, "messages"), {
        threadId: currentUser.uid,
        senderUid: currentUser.uid,
        senderRole: "customer",
        text: "",
        audioData: dataUrl,
        readByCustomer: true,
        readByAdmin: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      toast(s.voiceSendFailed, "error");
    }
  };
  recorder.stop();
  voiceRecorder = null;
}

// كتحدث نقطة التنبيه فزر ☰ وفعنصر "الدعم" داخل القائمة الجانبية على حساب hasUnreadSupport
function syncSupportBadgeUI() {
  const menuDot = document.getElementById("menuDot");
  if (menuDot) menuDot.style.display = hasUnreadSupport ? "block" : "none";
  const sideBadge = document.getElementById("sideSupportBadge");
  if (sideBadge) sideBadge.style.display = hasUnreadSupport ? "block" : "none";
}
let lastSeenUnreadIds = new Set();
let unreadWatchInitialized = false;
function watchUnreadMessages(uid) {
  if (unreadUnsubscribe) unreadUnsubscribe();
  lastSeenUnreadIds = new Set();
  unreadWatchInitialized = false;
  const q = query(collection(db, "messages"), where("threadId", "==", uid));
  unreadUnsubscribe = onSnapshot(q, (snap) => {
    const unreadIds = new Set();
    snap.docs.forEach((d) => {
      const m = d.data();
      if (m.senderRole === "admin" && !m.readByCustomer) unreadIds.add(d.id);
    });
    // نبينو الصوت/التنبيه غير على رسالة جديدة فعلاً (ماشي أول تحميل، وماشي ونافذة الدعم محلولة)
    if (unreadWatchInitialized) {
      const hasNew = [...unreadIds].some((id) => !lastSeenUnreadIds.has(id));
      if (hasNew) {
        playNotifySound();
        const supportOpen = document.getElementById("supportModal")?.classList.contains("show");
        if (!supportOpen) toast(t(lang).newSupportMessageToast);
      }
    }
    lastSeenUnreadIds = unreadIds;
    unreadWatchInitialized = true;
    hasUnreadSupport = unreadIds.size > 0;
    syncSupportBadgeUI();
  });
}
function stopWatchingUnreadMessages() {
  if (unreadUnsubscribe) {
    unreadUnsubscribe();
    unreadUnsubscribe = null;
  }
  // الإصلاح: بلا هاد السطر كانت نقطة التنبيه كتبقى بادية بعد تسجيل الخروج
  // حتى ولو ماكاينش رسائل غير مقروءة للمستخدم الجديد
  hasUnreadSupport = false;
  lastSeenUnreadIds = new Set();
  unreadWatchInitialized = false;
  syncSupportBadgeUI();
}

function openAccount() {
  document.getElementById("accountModal").classList.add("show");
  if (currentUser && profileIncomplete) renderCompleteProfile();
  else if (currentUser) renderAccountProfile();
  else {
    authTab = "login";
    renderAccountAuth();
  }
}
function closeAccount() {
  document.getElementById("accountModal").classList.remove("show");
  pendingCheckoutAfterLogin = false;
}
function switchAuthTab(tabName) {
  authTab = tabName;
  renderAccountAuth();
}
function selectSignupGender(g) {
  signupGender = g;
  const male = document.getElementById("genderMaleOpt");
  const female = document.getElementById("genderFemaleOpt");
  if (male && female) {
    male.classList.toggle("active", g === "male");
    female.classList.toggle("active", g === "female");
  }
}

// أزرار المتابعة عبر Google / Apple — كتبان تحت نموذج الدخول والتسجيل بجوج
function socialLoginHtml(s) {
  return `
   <div class="social-divider"><span>${s.orContinueWith}</span></div>
   <button type="button" class="social-btn google-btn" onclick="signInWithGoogle()">
     <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
       <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
       <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
       <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
       <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
     </svg>
     <span>${s.continueWithGoogle}</span>
   </button>
   <button type="button" class="social-btn apple-btn" onclick="signInWithApple()">
     <svg width="16" height="16" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
       <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
     </svg>
     <span>${s.continueWithApple}</span>
   </button>`;
}

function renderAccountAuth() {
  const s = t(lang);
  const notice = pendingCheckoutAfterLogin ? `<div class="notice" style="background:#fffbeb;border-color:#fde68a;color:#92400e">${s.loginRequiredNotice}</div>` : "";
  const el = document.getElementById("accountContent");
  if (authTab === "login") {
    el.innerHTML = `
     <div class="modal-head"><h3>${s.loginTitle}</h3><button class="close" onclick="closeAccount()">${ico("close")}</button></div>
     ${notice}
     <div class="auth-tabs">
       <button type="button" class="auth-tab active">${s.loginTab}</button>
       <button type="button" class="auth-tab" onclick="switchAuthTab('signup')">${s.signupTab}</button>
     </div>
     <form onsubmit="submitLogin(event)">
       <label>${s.phone}</label><input id="loginPhone" required type="tel" inputmode="tel" placeholder="${s.phonePh}">
       <label>${s.passwordLabel}</label><input id="loginPassword" required type="password" placeholder="${s.passwordPh}">
       <p id="authError" style="color:#dc2626;font-size:12px;margin:6px 0 0"></p>
       <button class="checkout" type="submit" style="width:100%;margin-top:14px">${s.loginBtn}</button>
     </form>
     ${socialLoginHtml(s)}`;
  } else {
    el.innerHTML = `
     <div class="modal-head"><h3>${ico("account")}${s.signupTitle}</h3><button class="close" onclick="closeAccount()">${ico("close")}</button></div>
     ${notice}
     <div class="auth-tabs">
       <button type="button" class="auth-tab" onclick="switchAuthTab('login')">${s.loginTab}</button>
       <button type="button" class="auth-tab active">${s.signupTab}</button>
     </div>
     <form onsubmit="submitSignup(event)">
       <label>${s.phone}</label><input id="signupPhone" required type="tel" inputmode="tel" placeholder="${s.phonePh}">
       <label>${s.genderLabel}</label>
       <div class="gender-row">
         <div class="gender-opt active" id="genderMaleOpt" onclick="selectSignupGender('male')">${s.genderMale}</div>
         <div class="gender-opt" id="genderFemaleOpt" onclick="selectSignupGender('female')">${s.genderFemale}</div>
       </div>
       <label>${s.passwordLabel}</label><input id="signupPassword" required type="password" placeholder="${s.passwordPh}">
       <label>${s.confirmPassword}</label><input id="signupPassword2" required type="password" placeholder="${s.passwordPh}">
       <label class="privacy-check"><input type="checkbox" id="privacyCheck"><span>${s.privacyAgree} <a href="#" onclick="openPrivacyPolicy(event)">${s.privacyPolicyLink}</a></span></label>
       <p id="authError" style="color:#dc2626;font-size:12px;margin:6px 0 0"></p>
       <button class="checkout" type="submit" style="width:100%;margin-top:14px">${s.signupBtn}</button>
     </form>
     ${socialLoginHtml(s)}`;
  }
  signupGender = "male";
}

// تسجيل الدخول عبر Google/Apple — نافذة منبثقة، وonAuthStateChanged كيدير الباقي (بما فيه فتح نموذج إكمال الملف الشخصي إلا كان الحساب جديد)
async function signInWithGoogle() {
  const s = t(lang);
  const errEl = document.getElementById("authError");
  try {
    await authReady;
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err?.code !== "auth/popup-closed-by-user" && errEl) errEl.textContent = s.socialLoginError;
  }
}
async function signInWithApple() {
  const s = t(lang);
  const errEl = document.getElementById("authError");
  try {
    await authReady;
    await signInWithPopup(auth, appleProvider);
  } catch (err) {
    if (err?.code !== "auth/popup-closed-by-user" && errEl) errEl.textContent = s.socialLoginError;
  }
}

// نموذج إكمال الملف الشخصي — كيبان مرة وحدة بعد أول تسجيل دخول عبر Google/Apple باش الزبون يعطي رقم الهاتف والجنس
function renderCompleteProfile() {
  const s = t(lang);
  const el = document.getElementById("accountContent");
  el.innerHTML = `
   <div class="modal-head"><h3>${s.completeProfileTitle}</h3><button class="close" onclick="closeAccount()">${ico("close")}</button></div>
   <div class="notice">${s.completeProfileDesc}</div>
   <form onsubmit="submitCompleteProfile(event)">
     <label>${s.phone}</label><input id="completePhone" required type="tel" inputmode="tel" placeholder="${s.phonePh}">
     <label>${s.genderLabel}</label>
     <div class="gender-row">
       <div class="gender-opt active" id="genderMaleOpt" onclick="selectSignupGender('male')">${s.genderMale}</div>
       <div class="gender-opt" id="genderFemaleOpt" onclick="selectSignupGender('female')">${s.genderFemale}</div>
     </div>
       <label class="privacy-check"><input type="checkbox" id="privacyCheck"><span>${s.privacyAgree} <a href="#" onclick="openPrivacyPolicy(event)">${s.privacyPolicyLink}</a></span></label>
     <p id="authError" style="color:#dc2626;font-size:12px;margin:6px 0 0"></p>
     <button class="checkout" type="submit" style="width:100%;margin-top:14px">${s.completeProfileBtn}</button>
   </form>
   <button type="button" class="link-btn" style="width:100%;margin-top:12px" onclick="logoutAccount()">${ico("logout")}${s.logoutBtn}</button>`;
  signupGender = "male";
}

async function submitCompleteProfile(e) {
  e.preventDefault();
  const s = t(lang);
  const errEl = document.getElementById("authError");
  const phone = normalizePhone(document.getElementById("completePhone").value);
  if (!PHONE_RE.test(phone)) {
    errEl.textContent = s.authPhoneInvalid;
    return;
  }
  if (!document.getElementById("privacyCheck")?.checked) {
    errEl.textContent = s.privacyRequired;
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = s.signingUp;
  try {
    const policy = await fetchActivePolicy(); // نسخة طازجة من السيرفر وقت الموافقة
    const referredByUid = await lookupReferrerUid(incomingReferralCode, currentUser.uid);
    const profileData = {
      ...(currentUser.displayName ? { name: currentUser.displayName.slice(0, 200) } : {}),
      ...(currentUser.email ? { email: currentUser.email.slice(0, 254) } : {}),
      privacyPolicyAccepted: true,
      privacyPolicyVersion: policy.version,
      privacyPolicyAcceptedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      phone,
      gender: signupGender,
      avatar: avatarFor(signupGender),
      referralCode: currentUser.uid.slice(0, 6).toUpperCase(),
      referredByUid,
      referralBonusGiven: false,
      orderCount: 0,
      ordersThisMonth: 0,
      lastOrderMonthKey: "",
      orderMilestone3Given: false,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, "users", currentUser.uid), profileData);
    ensureReferralCodeDoc(currentUser.uid, profileData.referralCode); // بلا await باش التسجيل ما يتعطلش
    userProfile = { ...profileData, createdAt: new Date().toISOString(), privacyPolicyAcceptedAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() };
    profileIncomplete = false;
    updateAccountButton();
    document.getElementById("accountModal").classList.remove("show");
    if (pendingCheckoutAfterLogin) {
      pendingCheckoutAfterLogin = false;
      openCheckout();
    }
    if (pendingSupportAfterLogin) {
      pendingSupportAfterLogin = false;
      openSupport();
    }
  } catch (err) {
    errEl.textContent = s.signupError;
    btn.disabled = false;
    btn.textContent = s.completeProfileBtn;
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const s = t(lang);
  const errEl = document.getElementById("authError");
  const phone = normalizePhone(document.getElementById("loginPhone").value);
  const password = document.getElementById("loginPassword").value;
  if (!PHONE_RE.test(phone)) {
    errEl.textContent = s.authPhoneInvalid;
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = s.loggingIn;
  try {
    await authReady;
    await signInWithEmailAndPassword(auth, phoneToEmail(phone), password);
    // onAuthStateChanged غادي يدير الباقي (تحميل الملف الشخصي وإغلاق المودال)
  } catch (err) {
    errEl.textContent = s.loginError;
    btn.disabled = false;
    btn.textContent = s.loginBtn;
  }
}

async function submitSignup(e) {
  e.preventDefault();
  const s = t(lang);
  const errEl = document.getElementById("authError");
  const phone = normalizePhone(document.getElementById("signupPhone").value);
  const password = document.getElementById("signupPassword").value;
  const password2 = document.getElementById("signupPassword2").value;
  if (!PHONE_RE.test(phone)) {
    errEl.textContent = s.authPhoneInvalid;
    return;
  }
  if (password.length < 8) {
    errEl.textContent = s.authPasswordShort;
    return;
  }
  if (password !== password2) {
    errEl.textContent = s.authPasswordMismatch;
    return;
  }
  // لا يُسمح بإنشاء الحساب بدون الموافقة على سياسة الخصوصية (والسيرفر/القواعد كيرفضو بدورهم أي محاولة بدونها)
  if (!document.getElementById("privacyCheck")?.checked) {
    errEl.textContent = s.privacyRequired;
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = s.signingUp;
  let cred = null;
  try {
    await authReady;
    const policy = await fetchActivePolicy(); // نسخة طازجة من السيرفر وقت الموافقة
    cred = await createUserWithEmailAndPassword(auth, phoneToEmail(phone), password);

    // إلا جا الزبون من رابط دعوة (?ref=CODE)، كنقلبو على صاحب هاد الكود باش نربطو بيه
    const referredByUid = await lookupReferrerUid(incomingReferralCode, cred.user.uid);

    const profileData = {
      privacyPolicyAccepted: true,
      privacyPolicyVersion: policy.version,
      privacyPolicyAcceptedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      phone,
      gender: signupGender,
      avatar: avatarFor(signupGender),
      referralCode: cred.user.uid.slice(0, 6).toUpperCase(),
      referredByUid,
      referralBonusGiven: false,
      orderCount: 0,
      ordersThisMonth: 0,
      lastOrderMonthKey: "",
      orderMilestone3Given: false,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, "users", cred.user.uid), profileData);
    ensureReferralCodeDoc(cred.user.uid, profileData.referralCode); // بلا await باش التسجيل ما يتعطلش
    // onAuthStateChanged قد يكون قرا الوثيقة قبل ما يكتبها setDoc (سباق)، فكنثبتو
    // البيانات الصحيحة هنا مباشرة بدل ما نعتمدو غير على القراءة ديالو
    userProfile = { ...profileData, createdAt: new Date().toISOString(), privacyPolicyAcceptedAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() };
    updateAccountButton();
  } catch (err) {
    // إلا تخلق حساب Auth وفشل حفظ الملف الشخصي (مثلاً رفض القواعد)، نمسحو الحساب باش ما يبقاش حساب يتيم بلا موافقة
    if (cred && cred.user) {
      try {
        await deleteUser(cred.user);
      } catch (_) {}
    }
    errEl.textContent = s.signupError;
    btn.disabled = false;
    btn.textContent = s.signupBtn;
  }
}


/* ═══════ سياسة الخصوصية ═══════ */
// النص الافتراضي كيتستعمل إلا ما نشر المشرف حتى سياسة (النسخة ثابتة: 1.0-default). المشرف يقدر يعوضو من لوحة التحكم > سياسة الخصوصية.
const DEFAULT_POLICY_VERSION = "1.0-default";
const DEFAULT_POLICY = {
  version: DEFAULT_POLICY_VERSION,
  title: "سياسة الخصوصية",
  content:
    "نحن في وجبتنا نحترم خصوصيتك.\n\n" +
    "1) البيانات التي نجمعها: رقم الهاتف، الجنس، الاسم والعنوان عند إتمام الطلب، وسجل الطلبات.\n" +
    "2) كيف نستخدمها: لتجهيز طلباتك وتوصيلها، والتواصل معك، وإدارة النقاط والمكافآت وبطاقة العضوية.\n" +
    "3) المشاركة: لا نبيع بياناتك ولا نشاركها مع أطراف خارجية إلا بالقدر اللازم لتنفيذ الخدمة.\n" +
    "4) الحماية: تُخزَّن بياناتك في خدمات آمنة ولا يصل إليها إلا المشرفون المخوّلون.\n" +
    "5) حقوقك: يمكنك طلب تعديل بياناتك أو حذف حسابك في أي وقت.\n\n" +
    "Politique de confidentialité : nous collectons votre numéro de téléphone, genre, nom et adresse de livraison uniquement pour traiter vos commandes. Vos données ne sont jamais vendues. Vous pouvez demander la suppression de votre compte à tout moment.",
  requireReaccept: false,
};
let activePolicy = { ...DEFAULT_POLICY };

// كيجيب السياسة المنشورة من السيرفر (config/privacyPolicy)، وإلا النسخة الافتراضية
async function fetchActivePolicy() {
  try {
    const snap = await getDoc(doc(db, "config", "privacyPolicy"));
    if (snap.exists() && snap.data().published === true && snap.data().version) {
      const d = snap.data();
      activePolicy = { version: String(d.version), title: d.title || DEFAULT_POLICY.title, content: d.content || "", requireReaccept: d.requireReaccept === true };
    } else {
      activePolicy = { ...DEFAULT_POLICY };
    }
  } catch (e) {
    /* نبقاو على آخر نسخة معروفة */
  }
  return activePolicy;
}
async function openPrivacyPolicy(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const s = t(lang);
  const box = document.getElementById("privacyContent");
  document.getElementById("privacyModal").classList.add("show");
  box.innerHTML = `<div class="modal-head"><h3>${s.privacyPolicyLink}</h3><button class="close" onclick="closePrivacyPolicy()">${ico("close")}</button></div><div class="empty" style="padding:30px">…</div>`;
  const p = await fetchActivePolicy();
  box.innerHTML = `
    <div class="modal-head"><h3>${escapeHtml(p.title)}</h3><button class="close" onclick="closePrivacyPolicy()">${ico("close")}</button></div>
    <div style="font-size:12px;color:#78716c;margin-bottom:8px">${s.privacyVersionLabel}: ${escapeHtml(p.version)}</div>
    <div class="policy-body">${escapeHtml(p.content)}</div>
    <button type="button" class="checkout" style="margin-top:14px" onclick="closePrivacyPolicy()">${s.cancelOrderBack}</button>`;
}
function closePrivacyPolicy() {
  document.getElementById("privacyModal").classList.remove("show");
}

// إعادة الموافقة: كتبان غير إلا فعّلها المشرف (requireReaccept) والزبون وافق على نسخة قديمة/ما وافقش
async function maybeRequirePolicyReaccept() {
  if (!currentUser || !userProfile || profileIncomplete) return;
  const p = await fetchActivePolicy();
  if (!p.requireReaccept || userProfile.privacyPolicyVersion === p.version) return;
  const s = t(lang);
  document.getElementById("policyReacceptContent").innerHTML = `
    <div class="modal-head"><h3>${s.privacyReacceptTitle}</h3></div>
    <div class="notice">${s.privacyReacceptDesc}</div>
    <div style="font-size:12px;color:#78716c;margin:8px 0">${s.privacyVersionLabel}: ${escapeHtml(p.version)}</div>
    <div class="policy-body">${escapeHtml(p.content)}</div>
    <p id="reacceptError" style="color:#dc2626;font-size:12px;margin:6px 0 0"></p>
    <button type="button" class="checkout" id="reacceptBtn" onclick="acceptNewPolicy()">${s.privacyAcceptBtn}</button>
    <button type="button" class="link-btn" style="width:100%;margin-top:8px" onclick="logoutAccount()">${ico("logout")}${s.logoutBtn}</button>`;
  document.getElementById("policyReacceptModal").classList.add("show");
}
async function acceptNewPolicy() {
  const s = t(lang);
  const btn = document.getElementById("reacceptBtn");
  btn.disabled = true;
  try {
    const p = await fetchActivePolicy();
    await updateDoc(doc(db, "users", currentUser.uid), {
      privacyPolicyAccepted: true,
      privacyPolicyVersion: p.version,
      privacyPolicyAcceptedAt: serverTimestamp(),
    });
    userProfile = { ...userProfile, privacyPolicyAccepted: true, privacyPolicyVersion: p.version };
    document.getElementById("policyReacceptModal").classList.remove("show");
  } catch (e) {
    document.getElementById("reacceptError").textContent = s.signupError;
    btn.disabled = false;
  }
}

// آخر تسجيل دخول: مرة وحدة لكل جلسة صفحة (القواعد كتفرض أن القيمة وقت السيرفر)
let lastLoginTouchedFor = null;
function touchLastLogin(uid) {
  if (lastLoginTouchedFor === uid) return;
  lastLoginTouchedFor = uid;
  updateDoc(doc(db, "users", uid), { lastLoginAt: serverTimestamp() }).catch(() => {});
}

/* ═══════ إلغاء الطلب من طرف الزبون ═══════ */
// ⚠️ الفحص هنا للواجهة فقط (إظهار/إخفاء الزر). التحقق الحقيقي كيتدار فـ firestore.rules (ownerCanCancel)
// بوقت السيرفر (request.time) مقابل createdAt المحفوظ، فتغيير ساعة الهاتف ما كيأثر على النتيجة.
const CANCEL_WINDOW_MS = 30 * 60 * 1000;
const CANCELLABLE_STATUSES = ["قيد المراجعة", "تم قبول الطلب"]; // حالات قبل بدء التحضير
let serverClockOffsetMs = 0; // فرق بين وقت السيرفر وساعة الجهاز (من ترويسة Date ديال الاستضافة)
async function syncServerClock() {
  try {
    const r = await fetch(location.pathname, { method: "HEAD", cache: "no-store" });
    const d = r.headers.get("Date");
    if (d) serverClockOffsetMs = new Date(d).getTime() - Date.now();
  } catch (_) {}
}
syncServerClock();
function canCancelOrderUi(o) {
  if (!o.createdAt?.toDate) return false;
  if (!CANCELLABLE_STATUSES.includes(o.status || "قيد المراجعة")) return false;
  const age = Date.now() + serverClockOffsetMs - o.createdAt.toDate().getTime();
  return age < CANCEL_WINDOW_MS;
}
function cancelOrderBlockHtml(o, s) {
  if (o.status === "ملغى من طرف الزبون" || o.status === "ملغى من المشرف" || o.status === "ملغي") {
    const when = o.cancelledAt?.toDate ? o.cancelledAt.toDate().toLocaleString(lang === "fr" ? "fr-FR" : "ar-MA") : "";
    const who = o.cancelledBy === "customer" ? s.cancelledByCustomerLabel : o.cancelledBy === "admin" ? s.cancelledByAdminLabel : "";
    return `<div class="order-detail-section" style="background:#fef2f2;border-color:#fecaca">
      ${who ? `<div class="order-detail-row"><span>${who}</span></div>` : ""}
      ${when ? `<div class="order-detail-row"><span>${s.cancelledAtLabel}</span><b>${escapeHtml(when)}</b></div>` : ""}
      ${o.cancellationReason ? `<div class="order-detail-row"><span>${escapeHtml(o.cancellationReason)}</span></div>` : ""}
    </div>`;
  }
  if (!canCancelOrderUi(o)) return "";
  return `<div class="order-detail-section">
      <div style="font-size:12px;color:#78716c;margin-bottom:8px">${s.cancelOrderHint}</div>
      <button type="button" class="btn-cancel-order" onclick="openCancelOrder('${o.id}')">${s.cancelOrderBtn}</button>
    </div>`;
}
function openCancelOrder(id) {
  const s = t(lang);
  const o = myOrdersCache.find((x) => x.id === id);
  if (!o) return;
  document.getElementById("cancelOrderContent").innerHTML = `
    <div class="confirm-box">
      <h2 style="font-size:19px;color:#991b1b">${s.cancelOrderConfirm}</h2>
      <p>${orderCode(o.id)}</p>
      <textarea id="cancelReason" rows="2" maxlength="300" placeholder="${s.cancelOrderReasonPh}" style="margin:10px 0"></textarea>
      <p id="cancelError" style="color:#dc2626;font-size:12px"></p>
      <button type="button" class="btn-danger" id="cancelYesBtn" onclick="confirmCancelOrder('${o.id}')">${s.cancelOrderYes}</button>
      <button type="button" class="link-btn" style="width:100%;margin-top:8px" onclick="closeCancelOrder()">${s.cancelOrderBack}</button>
    </div>`;
  document.getElementById("cancelOrderModal").classList.add("show");
}
function closeCancelOrder() {
  document.getElementById("cancelOrderModal").classList.remove("show");
}
async function confirmCancelOrder(id) {
  const s = t(lang);
  const o = myOrdersCache.find((x) => x.id === id);
  if (!o || !currentUser) return;
  const btn = document.getElementById("cancelYesBtn");
  btn.disabled = true;
  const reason = (document.getElementById("cancelReason")?.value || "").trim().slice(0, 300);
  try {
    // القواعد كترفض الطلب إلا فاتت 30 دقيقة (وقت السيرفر) أو بدأ التحضير — حتى لو تلاعب الزبون بالواجهة
    await updateDoc(doc(db, "orders", id), {
      status: "ملغى من طرف الزبون",
      cancelledAt: serverTimestamp(),
      cancelledBy: "customer",
      cancellationReason: reason,
    });
  } catch (e) {
    document.getElementById("cancelError").textContent = s.cancelOrderFailed;
    btn.disabled = false;
    await renderMyOrdersList().catch(() => {}); // نحدثو الحالة المعروضة (ربما تبدلات من الأدمين)
    return;
  }
  // إشعار المشرف عبر نظام الدعم الموجود (رسالة تلقائية فـ thread ديال الزبون) — فشلها ما كيأثرش على الإلغاء
  try {
    await addDoc(collection(db, "messages"), {
      threadId: currentUser.uid,
      senderUid: currentUser.uid,
      senderRole: "customer",
      text: ("⚠️ قام الزبون بإلغاء الطلب " + orderCode(id) + (reason ? " — السبب: " + reason : "")).slice(0, 2000),
      readByCustomer: true,
      readByAdmin: false,
      createdAt: serverTimestamp(),
    });
  } catch (_) {}
  closeCancelOrder();
  await renderMyOrdersList();
  openOrderDetail(id);
  toast(s.cancelOrderDone);
}

function logoutAccount() {
  signOut(auth);
  closeAccount();
}

function renderAccountProfile() {
  const s = t(lang);
  const el = document.getElementById("accountContent");
  const avatar = avatarKey(userProfile?.avatar, userProfile?.gender) ? avatarHtml(userProfile?.avatar, userProfile?.gender) : userProfile?.avatar ? escapeHtml(userProfile.avatar) : ico("account");
  const phone = userProfile?.phone || "";
  const genderLabel = userProfile?.gender === "female" ? s.genderFemale : s.genderMale;
  el.innerHTML = `
   <div class="modal-head"><h3>${ico("account")}${s.profileTitle}</h3><button class="close" onclick="closeAccount()">${ico("close")}</button></div>
   <div class="profile-head"><div class="avatar-circle">${avatar}</div><b style="font-size:16px">${escapeHtml(phone)}</b></div>
   <div class="profile-row"><span>${s.profilePhoneLabel}</span><b>${escapeHtml(phone)}</b></div>
   <div class="profile-row"><span>${s.profileGenderLabel}</span><b>${genderLabel}</b></div>
   ${
     membershipData
       ? `<button class="checkout" style="width:100%;margin-top:18px" onclick="openMembership()">${ico("card")}${s.goToMembership}</button>`
       : `<div class="notice" style="margin-top:16px">${s.noMembershipYet}</div>`
   }
   <button class="checkout" style="width:100%;margin-top:12px;background:#f59e0b;color:#1c1917" onclick="openRewards()">${s.rewardsBtn}</button>
   <button class="link-btn" style="width:100%;margin-top:14px" onclick="logoutAccount()">${ico("logout")}${s.logoutBtn}</button>
   <button class="link-btn" style="width:100%;margin-top:8px;color:#dc2626" onclick="openDeleteAccountConfirm()">${s.deleteAccountBtn}</button>`;
}

/* ---------- حذف الحساب نهائياً ---------- */
function openDeleteAccountConfirm() {
  renderDeleteAccountConfirm();
}
function cancelDeleteAccount() {
  renderAccountProfile();
}
function renderDeleteAccountConfirm() {
  const s = t(lang);
  const el = document.getElementById("accountContent");
  el.innerHTML = `
   <div class="modal-head"><h3>${s.deleteAccountConfirmTitle}</h3><button class="close" onclick="closeAccount()">${ico("close")}</button></div>
   <div class="notice" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">${s.deleteAccountWarning}</div>
   <form onsubmit="submitDeleteAccount(event)">
     <label>${s.deleteAccountPasswordLabel}</label>
     <input id="deleteAccountPassword" required type="password" placeholder="${s.passwordPh}">
     <p id="deleteAccountError" style="color:#dc2626;font-size:12px;margin:6px 0 0"></p>
     <button type="submit" style="width:100%;margin-top:14px;border:0;background:#dc2626;color:#fff;border-radius:999px;padding:12px;font-weight:800">${s.confirmDeleteBtn}</button>
     <button type="button" class="link-btn" style="width:100%;margin-top:10px" onclick="cancelDeleteAccount()">${s.cancelDeleteBtn}</button>
   </form>`;
}
async function submitDeleteAccount(e) {
  e.preventDefault();
  const s = t(lang);
  const errEl = document.getElementById("deleteAccountError");
  const password = document.getElementById("deleteAccountPassword").value;
  if (!currentUser || !userProfile) return;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = s.deletingAccount;
  try {
    // إعادة التحقق من كلمة السر إجباري من Firebase قبل حذف أي حساب حساس
    const cred = EmailAuthProvider.credential(phoneToEmail(userProfile.phone), password);
    await reauthenticateWithCredential(currentUser, cred);
    const uid = currentUser.uid;
    // كنمسحو الملف الشخصي وبطاقة العضوية قبل حذف حساب Auth
    // (الطلبات كتبقى محفوظة كسجل تجاري للأدمين، وماشي مرتبطة ببيانات شخصية إضافية)
    try {
      await deleteDoc(doc(db, "members", uid));
    } catch (_) {}
    try {
      if (userProfile.referralCode) await deleteDoc(doc(db, "referralCodes", userProfile.referralCode));
    } catch (_) {}
    await deleteDoc(doc(db, "users", uid));
    await deleteUser(currentUser);
    closeAccount();
    toast(s.accountDeletedMsg);
  } catch (err) {
    errEl.textContent = s.deleteAccountError;
    btn.disabled = false;
    btn.textContent = s.confirmDeleteBtn;
  }
}

/* ---------- بطاقة العضوية (تلقائية بعد طلب من 3 أيام فما فوق) ---------- */
async function loadMembership(uid) {
  try {
    const snap = await getDoc(doc(db, "members", uid));
    membershipData = snap.exists() ? snap.data() : null;
  } catch (e) {
    membershipData = null;
  }
  updateAccountButton();
}

async function maybeCreateMembership(order, orderId) {
  if (!currentUser) return;

  // كنجمعو كل الطلبات ديال هاد الزبون باش نربطوهم فبطاقة عضوية واحدة
  // (بدل ما نبقاو نحسبو غير الطلب الأخير بوحدو)
  let totalDays = order.durationDays || 1;
  let minStart = order.schedule.dateFrom;
  let maxEnd = order.schedule.dateTo;
  try {
    const q = query(collection(db, "orders"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(q);
    totalDays = 0;
    snap.forEach((docSnap) => {
      const o = docSnap.data();
      if (!o.schedule) return;
      totalDays += o.durationDays || 1;
      if (o.schedule.dateFrom < minStart) minStart = o.schedule.dateFrom;
      if (o.schedule.dateTo > maxEnd) maxEnd = o.schedule.dateTo;
    });
  } catch (e) {
    /* إلا فشل التجميع، كنكملو بمعطيات الطلب الحالي وحده */
  }
  if (totalDays < MEMBERSHIP_MIN_DAYS) return;

  const memberRef = doc(db, "members", currentUser.uid);
  let joinDate = new Date().toISOString();
  try {
    const existing = await getDoc(memberRef);
    if (existing.exists() && existing.data().joinDate) joinDate = existing.data().joinDate;
  } catch (e) {
    /* تجاهل */
  }

  const data = {
    uid: currentUser.uid,
    name: order.customer.name,
    phone: userProfile?.phone || order.customer.phone,
    gender: userProfile?.gender || "male",
    avatar: userProfile?.avatar || "👨",
    startDate: minStart,
    endDate: maxEnd,
    totalDays,
    orderId,
    plan: order.plan || null,
    joinDate,
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(memberRef, data, { merge: true });
    membershipData = data;
    updateAccountButton();
  } catch (e) {
    /* الفشل هنا ما كيوقفش الطلب — الطلب راه تسجل بنجاح فـ orders */
  }
}

function openMembership() {
  const s = t(lang);
  if (!membershipData) return;
  document.getElementById("accountModal").classList.remove("show");
  document.getElementById("membershipModal").classList.add("show");
  renderMembershipCard();
  clearInterval(countdownInterval);
  countdownInterval = setInterval(renderCountdownOnly, 1000);
}
function closeMembership() {
  document.getElementById("membershipModal").classList.remove("show");
  clearInterval(countdownInterval);
  countdownInterval = null;
}
function backToProfileFromMembership() {
  document.getElementById("membershipModal").classList.remove("show");
  clearInterval(countdownInterval);
  countdownInterval = null;
  openAccount();
}

function remainingParts(endDate) {
  const end = new Date(endDate + "T23:59:59");
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds };
}

function renderMembershipCard() {
  const s = t(lang);
  const m = membershipData;
  if (!m) return;
  const memberId = "MB-" + (currentUser?.uid || "").slice(0, 6).toUpperCase();
  document.getElementById("membershipContent").innerHTML = `
   <div class="modal-head"><h3>${s.cardSubtitle}</h3><button class="close" onclick="closeMembership()">${ico("close")}</button></div>
   <div class="member-card">
     <div class="member-card-brand">وجبتنا <span style="opacity:.6;font-size:12px">Wajbatna</span></div>
     <div class="member-card-name">${avatarHtml(m.avatar, m.gender)} ${escapeHtml(m.name || m.phone || "")}</div>
     <div class="member-card-row"><span>${s.memberSince}</span><b>${formatDate(m.joinDate)}</b></div>
     <div class="member-card-row"><span>${s.validUntil}</span><b>${formatDate(m.endDate + "T00:00:00")}</b></div>
     ${m.plan && s.plans[m.plan] ? `<div class="member-card-row"><span>${s.currentPlanLabel}</span><b>${s.plans[m.plan][0]}</b></div>` : ""}
     <div id="countdownWrap"></div>
     <div class="member-card-id">${memberId}</div>
   </div>
   <button class="link-btn" style="width:100%;margin-top:14px;color:#dc2626" onclick="cancelSubscription()">${s.cancelSubscriptionBtn}</button>
   <button id="downloadCardBtn" class="link-btn" style="width:100%;margin-top:8px" onclick="downloadMembershipCard()">${s.downloadCardBtn}</button>
   <button class="link-btn" style="width:100%;margin-top:8px" onclick="backToProfileFromMembership()">${s.backToProfile}</button>`;
  renderCountdownOnly();
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale,
    sh = h / scale;
  const sx = (img.width - sw) / 2,
    sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
// كيصاوب صورة PNG ديال بطاقة العضوية (خلفية + إطار + النصوص) ويحملها مباشرة للزبون
async function downloadMembershipCard() {
  const s = t(lang);
  const m = membershipData;
  if (!m || !currentUser) return;
  const btn = document.getElementById("downloadCardBtn");
  if (btn) btn.disabled = true;
  try {
    const [bg, frame] = await Promise.all([loadImageEl("img/membership-bg.webp"), loadImageEl("img/membership-frame.webp")]);
    const W = 1000,
      H = 630;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    drawImageCover(ctx, bg, 0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W * 0.6, H);
    grad.addColorStop(0, "rgba(6,78,59,.35)");
    grad.addColorStop(1, "rgba(3,20,13,.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(frame, 0, 0, W, H);

    const rtl = lang !== "fr";
    ctx.direction = rtl ? "rtl" : "ltr";
    const startX = rtl ? W - 50 : 50;
    const memberId = "MB-" + (currentUser.uid || "").slice(0, 6).toUpperCase();

    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 26px Arial, sans-serif";
    ctx.fillText("وجبتنا — Wajbatna", startX, 62);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px Arial, sans-serif";
    const nameText = String(m.name || m.phone || "").trim();
    const avKey = avatarKey(m.avatar, m.gender);
    let avImg = null;
    if (avKey) {
      try {
        avImg = await loadImageEl(`img/icons/${avKey}.webp`);
      } catch (e) {
        avImg = null;
      }
    }
    if (avImg) {
      const icon = 48,
        gap = 12,
        iy = 122 - 38;
      if (rtl) {
        ctx.drawImage(avImg, startX - icon, iy, icon, icon);
        ctx.fillText(nameText, startX - icon - gap, 122);
      } else {
        ctx.drawImage(avImg, startX, iy, icon, icon);
        ctx.fillText(nameText, startX + icon + gap, 122);
      }
    } else {
      ctx.fillText(`${m.avatar || ""} ${nameText}`.trim(), startX, 122);
    }

    let y = 190;
    const rows = [
      [s.memberSince, formatDate(m.joinDate)],
      [s.validUntil, formatDate(m.endDate + "T00:00:00")],
    ];
    if (m.plan && s.plans[m.plan]) rows.push([s.currentPlanLabel, s.plans[m.plan][0]]);
    ctx.font = "600 19px Arial, sans-serif";
    for (const [label, value] of rows) {
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(label, startX, y);
      ctx.fillStyle = "#fff";
      ctx.textAlign = rtl ? "left" : "right";
      ctx.fillText(value, rtl ? 50 : W - 50, y);
      ctx.strokeStyle = "rgba(255,255,255,.15)";
      ctx.beginPath();
      ctx.moveTo(50, y + 16);
      ctx.lineTo(W - 50, y + 16);
      ctx.stroke();
      y += 52;
    }
    ctx.textAlign = rtl ? "right" : "left";
    ctx.font = "15px monospace";
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.fillText(memberId, startX, H - 36);

    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "wajbatna-membership-card.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    toast(s.cardDownloadFailed, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderCountdownOnly() {
  const s = t(lang);
  const wrap = document.getElementById("countdownWrap");
  if (!wrap || !membershipData) return;
  const parts = remainingParts(membershipData.endDate);
  if (!parts) {
    wrap.innerHTML = `
     <div class="notice" style="margin-top:14px;background:rgba(255,255,255,.12);color:#fff;border-color:transparent">${s.membershipExpired}</div>
     <button class="renew-btn" onclick="renewSubscription()">${s.renewSubscriptionBtn}</button>`;
    clearInterval(countdownInterval);
    countdownInterval = null;
    return;
  }
  wrap.innerHTML = `
   <div style="position:relative;font-size:11px;opacity:.75;margin-top:10px">${s.membershipRemaining}</div>
   <div class="countdown">
     <div class="countdown-box"><b>${parts.days}</b><span>${s.countdownDays}</span></div>
     <div class="countdown-box"><b>${parts.hours}</b><span>${s.countdownHours}</span></div>
     <div class="countdown-box"><b>${parts.minutes}</b><span>${s.countdownMinutes}</span></div>
     <div class="countdown-box"><b>${parts.seconds}</b><span>${s.countdownSeconds}</span></div>
   </div>`;
}

// كيلغي اشتراك الزبون فالباقة الحالية — كيمسح بطاقة العضوية ديالو من قاعدة البيانات، دون ما يمس أي حاجة أخرى (النقاط، الطلبات، الحساب...)
async function cancelSubscription() {
  const s = t(lang);
  if (!currentUser || !membershipData) return;
  if (!confirm(s.cancelSubscriptionConfirm)) return;
  try {
    await deleteDoc(doc(db, "members", currentUser.uid));
    membershipData = null;
    clearInterval(countdownInterval);
    countdownInterval = null;
    document.getElementById("membershipModal").classList.remove("show");
    updateAccountButton();
    toast(s.cancelSubscriptionDone);
    openAccount();
  } catch (e) {
    toast(s.cancelSubscriptionError, "error");
  }
}

// كيوجه الزبون باش يجدد الاشتراك: كيسد بطاقة العضوية والحساب، ويمشي لقائمة الأطباق باش يصاوب طلب جديد (البطاقة كتترجع تلقائياً بعد طلب من 3 أيام فما فوق)
function renewSubscription() {
  document.getElementById("membershipModal").classList.remove("show");
  document.getElementById("accountModal").classList.remove("show");
  const meals = document.getElementById("meals");
  if (meals) meals.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- تعريض الدوال للـ HTML (الملف عبارة عن module) ---------- */
Object.assign(window, {
  orderWeeklyPack,
  setCategory,
  add,
  remove,
  removeAll,
  choosePlan,
  openCheckout,
  closeCheckout,
  updateSchedulePreview,
  toggleScheduleDate,
  changeScheduleMonth,
  togglePaymentPicker,
  selectPaymentMethod,
  copyToClipboard,
  useMyLocation,
  submitOrder,
  render,
  switchLang,
  openAccount,
  closeAccount,
  switchAuthTab,
  selectSignupGender,
  submitLogin,
  submitSignup,
  signInWithGoogle,
  signInWithApple,
  submitCompleteProfile,
  logoutAccount,
  openDeleteAccountConfirm,
  cancelDeleteAccount,
  submitDeleteAccount,
  openMembership,
  closeMembership,
  backToProfileFromMembership,
  cancelSubscription,
  renewSubscription,
  openRewards,
  closeRewards,
  copyReferralLink,
  redeemReward,
  openMyOrders,
  closeMyOrders,
  renderMyOrdersList,
  openOrderDetail,
  copyOrderNumber,
  openPrivacyPolicy,
  closePrivacyPolicy,
  acceptNewPolicy,
  openCancelOrder,
  closeCancelOrder,
  confirmCancelOrder,
  selectDeliveryLocation,
  selectMealType,
  openRateOrder,
  closeRateOrder,
  setRating,
  submitRating,
  openSupport,
  closeSupport,
  sendSupportMessage,
  handleSupportImageSelected,
  openImageLightbox,
  closeImageLightbox,
  startVoiceRecording,
  cancelVoiceRecording,
  stopAndSendVoiceRecording,
  downloadMembershipCard,
  closeMealConfirmPopup,
  openSidebar,
  closeSidebar,
  openSidebarAction,
  scrollToMenu,
  goToCart,
});

/* ---------- الاشتراك بقائمة الأطباق (تحديث فوري) ---------- */
let mealsUnsub = null;
function subscribeMeals() {
  if (mealsUnsub) mealsUnsub();
  mealsUnsub = onSnapshot(
    query(collection(db, "meals"), orderBy("name")),
    (snap) => {
      meals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    () => {
      // ما كنبينوش أخطاء تقنية للزبون — رسالة مفهومة + زر إعادة المحاولة
      const s = t(lang);
      document.getElementById("meals").innerHTML = `<div class="error-box"><p>⚠️ ${s.loadError}</p><button type="button" class="add" onclick="retryMeals()">${s.retry}</button></div>`;
    }
  );
}
function retryMeals() {
  document.getElementById("meals").innerHTML = '<div class="skel-meal"><div class="skel-img"></div><div class="skel-body"><div class="skel-line w90"></div><div class="skel-line w60"></div><div class="skel-line w40"></div></div></div>'.repeat(3);
  subscribeMeals();
}
window.retryMeals = retryMeals;
subscribeMeals();

/* ---------- الاشتراك بصورة وجبة اليوم (تحديث فوري بمجرد ما الأدمين يبدلها) ---------- */
onSnapshot(
  doc(db, "config", "dailyMeal"),
  (snap) => {
    dailyMealImage = snap.exists() ? snap.data().image || "" : "";
    renderDailyMealBanner();
  },
  () => {}
);

/* ---------- الاشتراك بتفعيل/تعطيل مركز المكافآت — تحديث فوري بمجرد ما الأدمين يبدل السويتش، بلا حاجة لتحديث الصفحة ---------- */
onSnapshot(
  doc(db, "config", "loyaltyProgram"),
  (snap) => {
    loyaltyEnabled = !(snap.exists() && snap.data().enabled === false);
    renderSidebar();
    // إلا كانت صفحة المكافآت مفتوحة بالضبط ولحظة تبدل السويتش، نعاودو رسمها باش تبان الحالة الجديدة مباشرة
    if (document.getElementById("rewardsModal")?.classList.contains("show")) {
      openRewards();
    }
  },
  () => {}
);

/* ---------- الاشتراك بالباقات الأسبوعية (سعر كل باقة + أكلة كل يوم) — تحديث فوري بمجرد ما الأدمين يبدل حاجة ---------- */
onSnapshot(
  doc(db, "config", "weeklyPackagePrices"),
  (snap) => {
    if (snap.exists()) {
      const p = snap.data();
      if (typeof p.kids === "number") weeklyPackages.kids.price = p.kids;
      if (typeof p.adults === "number") weeklyPackages.adults.price = p.adults;
    }
    renderWeeklyPackages();
  },
  () => {}
);
onSnapshot(
  collection(db, "weeklyMeals"),
  (snap) => {
    weeklyPackages.kids.days = {};
    weeklyPackages.adults.days = {};
    snap.forEach((d) => {
      const data = d.data();
      if (weeklyPackages[data.package]) weeklyPackages[data.package].days[data.day] = data;
    });
    renderWeeklyPackages();
  },
  () => {}
);

/* ---------- الاشتراك بإعدادات طرق الأداء (RIB/تفعيل) — تحديث فوري بمجرد ما الأدمين يبدلها ---------- */
onSnapshot(
  doc(db, "config", "paymentMethods"),
  (snap) => {
    paymentMethodsConfig = snap.exists() ? snap.data() || {} : {};
    if (paymentMethod && !enabledPaymentMethods().some((pm) => pm.id === paymentMethod)) paymentMethod = null;
    const el = document.getElementById("paymentMethodPicker");
    if (el) el.innerHTML = paymentMethodBoxHtml();
  },
  () => {}
);

/* ---------- حالة تسجيل الدخول ---------- */
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    // زبون داخل عبر Google/Apple ما عندوش وثيقة فـ users بعد (ماشي دخول بكلمة السر، فتلك الحالة submitSignup كيصاوبها هو)
    const isSocialProvider = user.providerData[0]?.providerId !== "password";
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        userProfile = snap.data();
        profileIncomplete = false;
        if (userProfile.status === "banned") {
          // حساب محظور من المشرف: خروج فوري (الـ Worker كيعطّل الحساب فـ Auth بدوره)
          await signOut(auth);
          toast(t(lang).accountBannedMsg, "error");
          return;
        }
        touchLastLogin(user.uid);
      } else {
        userProfile = { phone: "", gender: "male", avatar: "👨" };
        profileIncomplete = isSocialProvider;
      }
    } catch (e) {
      userProfile = { phone: "", gender: "male", avatar: "👨" };
      profileIncomplete = isSocialProvider;
    }
    if (profileIncomplete) {
      // خاص الزبون يعطي رقم الهاتف والجنس قبل ما يكمل — نبقاو المودال مفتوح ونبانو ليه النموذج
      document.getElementById("accountModal").classList.add("show");
      renderCompleteProfile();
    } else {
      // إغلاق مودال الحساب فوراً وإكمال الطلب — ماشي خاصنا ننتظرو بطاقة العضوية باش الدخول يبان سريع
      document.getElementById("accountModal").classList.remove("show");
      if (pendingCheckoutAfterLogin) {
        pendingCheckoutAfterLogin = false;
        openCheckout();
      }
      if (pendingSupportAfterLogin) {
        pendingSupportAfterLogin = false;
        openSupport();
      }
    }
    updateAccountButton();
    loadMembership(user.uid); // كيكمل فالخلفية، وكيحدث الزر وحدو ملي يوصل
    watchUnreadMessages(user.uid);
    maybeRequirePolicyReaccept();
  } else {
    userProfile = null;
    membershipData = null;
    profileIncomplete = false;
    stopWatchingUnreadMessages();
  }
  updateAccountButton();
});

applyStaticText();
renderCategories(); // كتبان الفئات فوراً، بلا ما تنتظر جواب Firestore ديال الأطباق
renderCart();
document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- نظام النقاط: تحميل القواعد + التقاط رابط الدعوة ---------- */
getDoc(doc(db, "config", "pointsRules"))
  .then((snap) => {
    if (snap.exists()) pointsRules = { ...DEFAULT_POINTS_RULES, ...snap.data() };
  })
  .catch(() => {});

const urlParams = new URLSearchParams(window.location.search);
const incomingReferralCode = urlParams.get("ref") || null;
