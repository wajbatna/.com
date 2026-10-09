// driver.js — تطبيق سائق وجبتنا (Wajbatna Driver)
// مرتبط بنفس مشروع Firebase: orders (الطلبات المعيّنة) + deliveries (حالة كل توصيلة) + drivers (البروفايل/الاتصال).
import { db, auth } from "../firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged,
  setPersistence, browserLocalPersistence, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import { ic, setIconBase } from "../drvicons.js";
import { compressReceiptImage } from "../receipts.js";
setIconBase("../");

setPersistence(auth, browserLocalPersistence).catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

/* ───────────── أدوات ───────────── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const money = (n) => Math.round(Number(n) || 0).toLocaleString("ar-MA") + " د.م.";
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const niceDate = (s) => new Date(s + "T00:00:00").toLocaleDateString("ar-MA", { weekday: "long", day: "numeric", month: "long" });
const hhmm = (t) => String(t || "").slice(0, 5);
const orderCode = (id) => "WJ-" + String(id || "").slice(0, 8).toUpperCase();
const CANCELLED = ["ملغى من طرف الزبون", "ملغى من المشرف", "ملغي"];

function toast(msg, type = "") {
  const box = $("toast"); const d = document.createElement("div");
  d.className = type; d.textContent = msg; box.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function errMsg(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "ما عندكش الصلاحية لهاد العملية (تأكد أن حسابك مفعّل ولسا الطلب معيّن ليك).";
  if (c.includes("auth/invalid-credential") || c.includes("auth/wrong-password") || c.includes("auth/user-not-found")) return "الإيميل أو كلمة السر غير صحيحة.";
  if (c.includes("auth/email-already-in-use")) return "هاد الإيميل مسجل من قبل، جرب تسجيل الدخول.";
  if (c.includes("auth/weak-password")) return "كلمة السر ضعيفة (6 حروف على الأقل).";
  if (c.includes("auth/invalid-email")) return "الإيميل غير صالح.";
  if (c.includes("auth/too-many-requests")) return "محاولات كثيرة، عاود من بعد شوية.";
  if (c.includes("unavailable") || c.includes("network")) return "ما كاينش اتصال بالإنترنت.";
  return "وقع خطأ، حاول مرة أخرى.";
}
const phoneOk = (p) => /^(0[5-7][0-9]{8}|\+212[5-7][0-9]{8})$/.test(p);
const waNumber = (p) => String(p || "").replace(/\D/g, "").replace(/^0/, "212");
function coordsOf(link) {
  const m = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(link || "");
  return m ? { lat: +m[1], lng: +m[2] } : null;
}
function navLinks(o) {
  const c = coordsOf(o.customer?.mapLink);
  if (c) return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes`,
  };
  const q = encodeURIComponent(o.customer?.address || "");
  return { google: `https://www.google.com/maps/search/?api=1&query=${q}`, waze: `https://waze.com/ul?q=${q}&navigate=yes` };
}

/* ───────────── الحالة ───────────── */
const S = {
  user: null, me: null, screen: "loading", authTab: "login",
  tab: "home", jobsSeg: "today", openKey: null,
  orders: new Map(), deliveries: new Map(), fee: 0,
  wallet: null, txs: [], topups: [], payCfg: {},
  pos: null, busy: false, offline: !navigator.onLine,
};
let unsubs = [];
let firstOrdersSnap = true;
const seenKey = () => "wd_seen_" + (S.user?.uid || "");
const getSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch (e) { return new Set(); } };
const saveSeen = (set) => { try { localStorage.setItem(seenKey(), JSON.stringify([...set].slice(-300))); } catch (e) {} };

/* ───────────── الأعمال (Jobs) ───────────── */
function buildJobs() {
  const today = todayStr(), horizon = addDays(today, 7), jobs = [];
  for (const o of S.orders.values()) {
    if (CANCELLED.includes(o.status)) continue;
    const dates = o.schedule?.dates?.length ? o.schedule.dates : [];
    for (const date of dates) {
      const key = `${o.id}_${date}`;
      const d = S.deliveries.get(key);
      if (!d && (date < today || date > horizon)) continue;
      jobs.push({ key, order: o, date, d, state: d?.status || "assigned" });
    }
  }
  const rank = { pickedUp: 0, arrived: 0, assigned: 1, delivered: 2, failed: 2 };
  jobs.sort((a, b) => rank[a.state] - rank[b.state] || a.date.localeCompare(b.date) || String(a.order.schedule?.deliveryTime).localeCompare(String(b.order.schedule?.deliveryTime)));
  return jobs;
}
const STATE_LABEL = { assigned: "جديد", pickedUp: "فالطريق", arrived: "وصلت", delivered: "تم التسليم", failed: "تعذر التسليم" };
const STATE_CHIP = { assigned: "b", pickedUp: "y", arrived: "y", delivered: "g", failed: "r" };
const isActive = (st) => st === "pickedUp" || st === "arrived";

function stats() {
  const today = todayStr(), now = new Date();
  const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const weekStart = addDays(today, -6);
  const r = { todayN: 0, todayEarn: 0, todayCash: 0, weekEarn: 0, weekN: 0, monthEarn: 0, monthN: 0, monthCash: 0, totalN: 0, totalEarn: 0, failed: 0 };
  for (const d of S.deliveries.values()) {
    if (d.status === "failed") { r.failed++; continue; }
    if (d.status !== "delivered") continue;
    const fee = Number(d.fee) || 0, cash = Number(d.collected) || 0;
    r.totalN++; r.totalEarn += fee;
    if (d.date === today) { r.todayN++; r.todayEarn += fee; r.todayCash += cash; }
    if (d.date >= weekStart && d.date <= today) { r.weekEarn += fee; r.weekN++; }
    if (d.date.startsWith(monthPrefix)) { r.monthEarn += fee; r.monthN++; r.monthCash += cash; }
  }
  return r;
}

/* ───────────── تنبيهات الطلبات الجديدة ───────────── */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = i === 1 ? 1100 : 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.2);
      o.connect(g); g.connect(audioCtx.destination); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.22);
    });
  } catch (e) {}
}
async function systemNotify(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "wd-new", renotify: true, vibrate: [200, 100, 200] });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch (e) {}
}
function newJobAlert(o) {
  beep(); try { navigator.vibrate?.([250, 120, 250, 120, 400]); } catch (e) {}
  const title = "طلب جديد معيّن ليك";
  const body = `${o.customer?.name || ""} — ${o.customer?.address || ""}`.slice(0, 120);
  systemNotify(title, body);
  const old = document.querySelector(".alert-new"); if (old) old.remove();
  const b = document.createElement("button");
  b.className = "alert-new"; b.type = "button";
  b.innerHTML = `<span style="font-size:30px">${ic("scooter")}</span><span style="flex:1">${esc(title)}<small style="display:block;font-weight:600;opacity:.8;margin-top:2px">${esc(body)}</small></span>`;
  b.onclick = () => { b.remove(); S.tab = "jobs"; S.jobsSeg = "today"; render(); };
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 12000);
}

/* ───────────── الموقع المباشر ───────────── */
let watchId = null, lastDeliveryPush = 0, lastDriverPush = 0, wakeLock = null;
function hasActiveDelivery() { for (const d of S.deliveries.values()) if (isActive(d.status)) return true; return false; }
function wantTracking() { return !!S.me && S.me.status === "active" && (S.me.online || hasActiveDelivery()); }
function syncTracking() {
  if (wantTracking()) {
    if (watchId == null && "geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }
  } else if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (hasActiveDelivery()) acquireWake(); else releaseWake();
}
async function acquireWake() { try { if (!wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch (e) {} }
function releaseWake() { try { wakeLock?.release(); } catch (e) {} wakeLock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && hasActiveDelivery()) acquireWake(); });

function onPos(p) {
  S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, speed: p.coords.speed, at: Date.now() };
  pushLocation();
  if (S.openKey && window.__mapUpdate) window.__mapUpdate();
}
function pushLocation(force) {
  if (!S.pos || !S.me || S.me.status !== "active") return;
  const now = Date.now();
  const loc = { lat: +S.pos.lat.toFixed(6), lng: +S.pos.lng.toFixed(6), at: now };
  if (force || now - lastDeliveryPush > 5000) {
    for (const d of S.deliveries.values()) {
      if (!isActive(d.status)) continue;
      lastDeliveryPush = now;
      updateDoc(doc(db, "deliveries", d.id), { driverLoc: loc, updatedAt: serverTimestamp() }).catch(() => {});
    }
  }
  if (S.me.online && (force || now - lastDriverPush > 5000)) {
    lastDriverPush = now;
    updateDoc(doc(db, "drivers", S.user.uid), { lastLoc: loc, lastSeenAt: serverTimestamp() }).catch(() => {});
  }
}
setInterval(() => { // نبض: يبقى السائق "متصل" عند الأدمين حتى بلا حركة
  if (S.me?.online && S.user && Date.now() - lastDriverPush > 15000) {
    lastDriverPush = Date.now();
    const patch = { lastSeenAt: serverTimestamp() };
    if (S.pos) patch.lastLoc = { lat: +S.pos.lat.toFixed(6), lng: +S.pos.lng.toFixed(6), at: Date.now() };
    updateDoc(doc(db, "drivers", S.user.uid), patch).catch(() => {});
  }
}, 5000);

async function toggleOnline() {
  if (S.busy || !S.me) return;
  const next = !S.me.online;
  if (next) {
    try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch (e) {}
    if (!("geolocation" in navigator)) toast("جهازك ما كيدعمش تحديد الموقع", "err");
  }
  S.busy = true;
  try {
    const patch = { online: next, lastSeenAt: serverTimestamp() };
    if (next && S.pos) patch.lastLoc = { lat: +S.pos.lat.toFixed(6), lng: +S.pos.lng.toFixed(6), at: Date.now() };
    await updateDoc(doc(db, "drivers", S.user.uid), patch);
    toast(next ? "أنت الآن متصل — غادي توصلك الطلبات" : "أنت الآن غير متصل");
  } catch (e) { toast(errMsg(e), "err"); }
  S.busy = false;
  syncTracking();
}

/* ───────────── عمليات التوصيل ───────────── */
async function freshFee() {
  try { const s = await getDoc(doc(db, "config", "driverSettings")); S.fee = s.exists() ? Number(s.data().feePerDelivery) || 0 : 0; } catch (e) { /* نحافظ على آخر قيمة */ }
  return S.fee;
}
function singleDay(o) { return (o.schedule?.dates || []).length === 1; }
async function markOrderStatus(o, status) { // طلبات اليوم الواحد فقط: نحدّث حالة الطلب نفسو (محاولة اختيارية)
  if (!singleDay(o)) return;
  try { await updateDoc(doc(db, "orders", o.id), { status }); } catch (e) {}
}
function locNow() { return S.pos ? { lat: +S.pos.lat.toFixed(6), lng: +S.pos.lng.toFixed(6), at: Date.now() } : null; }

async function actStart(job) {
  if (S.busy) return; S.busy = true; render();
  try {
    const fee = await freshFee();
    const o = job.order;
    const data = {
      orderId: o.id, date: job.date, uid: o.uid, driverId: S.user.uid, status: "pickedUp",
      cod: o.paymentMethod === "cod", fee, pickedUpAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    const l = locNow(); if (l) data.driverLoc = l;
    await setDoc(doc(db, "deliveries", job.key), data);
    await markOrderStatus(o, "خرج للتوصيل");
    toast("انطلقت! الزبون كيتتبعك دابا", "ok");
  } catch (e) { toast(errMsg(e), "err"); }
  S.busy = false; syncTracking(); render();
}
async function actArrive(job) {
  if (S.busy) return; S.busy = true; render();
  try {
    const patch = { status: "arrived", arrivedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const l = locNow(); if (l) patch.driverLoc = l;
    await updateDoc(doc(db, "deliveries", job.key), patch);
    toast("تم إعلام الزبون بوصولك", "ok");
  } catch (e) { toast(errMsg(e), "err"); }
  S.busy = false; render();
}
async function actDeliver(job, collected) {
  if (S.busy) return; S.busy = true; render();
  try {
    const patch = { status: "delivered", deliveredAt: serverTimestamp(), updatedAt: serverTimestamp() };
    if (job.d?.cod) patch.collected = Math.max(0, Math.round(Number(collected) || 0));
    const l = locNow(); if (l) patch.driverLoc = l;
    await updateDoc(doc(db, "deliveries", job.key), patch);
    await markOrderStatus(job.order, "تم التسليم");
    toast("تم التسليم — بارك الله فيك", "ok");
    beep();
  } catch (e) { toast(errMsg(e), "err"); }
  S.busy = false; syncTracking(); render();
}
async function actFail(job, reason) {
  if (S.busy) return; S.busy = true; render();
  try {
    const patch = { status: "failed", failedAt: serverTimestamp(), failReason: String(reason).slice(0, 200), updatedAt: serverTimestamp() };
    const l = locNow(); if (l) patch.driverLoc = l;
    await updateDoc(doc(db, "deliveries", job.key), patch);
    toast("تم تسجيل تعذر التسليم", "ok");
  } catch (e) { toast(errMsg(e), "err"); }
  S.busy = false; syncTracking(); render();
}

/* ───────────── الواجهة ───────────── */
function render() {
  const app = $("app");
  if (S.screen === "loading") { app.innerHTML = `<div class="auth"><div class="brand"><img src="icons/icon-192.png" alt=""><b>وجبتنا</b><span>جارٍ التحميل…</span></div></div>`; return; }
  if (S.screen === "auth") return renderAuth(app);
  if (S.screen === "pending") return renderGate(app, ic("hourglass"), "طلبك قيد المراجعة", "تم استلام طلب تسجيلك. غادي تتفعل حسابك من طرف إدارة وجبتنا وتقدر تبدا الخدمة. هاد الصفحة كتتحدّث وحدها.");
  if (S.screen === "suspended") return renderGate(app, ic("ban"), "حسابك موقوف", "تواصل مع إدارة وجبتنا لمعرفة السبب وإعادة التفعيل.");
  renderShell(app);
}

function renderGate(app, icon, title, text) {
  app.innerHTML = `<div class="auth"><div class="brand"><img src="icons/icon-192.png" alt=""><b>وجبتنا — السائق</b></div>
    <div class="box"><div class="pend"><div class="big">${icon}</div><h2>${title}</h2><p>${text}</p>
    <button class="btn ghost" id="gOut" type="button">تسجيل الخروج</button></div></div></div>`;
  $("gOut").onclick = () => signOut(auth);
}

function renderAuth(app) {
  const reg = S.authTab === "register";
  const hasAccount = !!S.user; // مسجل دخول لكن بلا بروفايل سائق
  app.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon-192.png" alt=""><b>وجبتنا — السائق</b><span>Wajbatna Driver</span></div>
    <div class="box">
      ${hasAccount ? "" : `<div class="tabs2"><button type="button" data-t="login" class="${reg ? "" : "on"}">تسجيل الدخول</button><button type="button" data-t="register" class="${reg ? "on" : ""}">حساب جديد</button></div>`}
      <div id="aErr"></div>
      ${hasAccount ? `<div class="note">حسابك موجود فوجبتنا. كمّل بيانات السائق باش نبعثو طلبك للإدارة.</div>` : ""}
      ${reg || hasAccount ? `
        <label class="fld"><span>الاسم الكامل</span><input id="fName" autocomplete="name"></label>
        <label class="fld"><span>رقم الهاتف</span><input id="fPhone" type="tel" inputmode="tel" placeholder="06XXXXXXXX" autocomplete="tel"></label>
        <label class="fld"><span>وسيلة التوصيل (دراجة، سكوتر، سيارة…)</span><input id="fVeh" placeholder="مثال: دراجة نارية"></label>` : ""}
      ${hasAccount ? "" : `
        <label class="fld"><span>الإيميل</span><input id="fMail" type="email" inputmode="email" autocomplete="email"></label>
        <label class="fld"><span>كلمة السر</span><input id="fPass" type="password" autocomplete="${reg ? "new-password" : "current-password"}"></label>`}
      <button class="btn" id="aGo" type="button">${hasAccount ? "إرسال طلب التسجيل" : reg ? "إنشاء حساب سائق" : "دخول"}</button>
      ${!reg && !hasAccount ? `<p class="center" style="margin:12px 0 0"><button class="btn sm ghost" id="aForgot" type="button">نسيت كلمة السر؟</button></p>` : ""}
      ${hasAccount ? `<p class="center" style="margin:12px 0 0"><button class="btn sm ghost" id="aOut" type="button">تسجيل الخروج</button></p>` : ""}
    </div></div>`;
  app.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { S.authTab = b.dataset.t; render(); }));
  const showErr = (m) => ($("aErr").innerHTML = `<div class="err">${esc(m)}</div>`);
  $("aGo").onclick = async () => {
    const btn = $("aGo"); btn.disabled = true;
    try {
      if (reg || hasAccount) {
        const name = $("fName").value.trim(), phone = $("fPhone").value.trim().replace(/\s/g, ""), vehicle = $("fVeh").value.trim();
        if (name.length < 2) throw { msg: "دخل الاسم الكامل." };
        if (!phoneOk(phone)) throw { msg: "رقم الهاتف غير صحيح (مثال: 0612345678)." };
        let user = S.user, email = user?.email || "";
        if (!user) {
          email = $("fMail").value.trim(); const pass = $("fPass").value;
          const cred = await createUserWithEmailAndPassword(auth, email, pass); user = cred.user;
        }
        await setDoc(doc(db, "drivers", user.uid), { name, phone, vehicle, email, status: "pending", online: false, createdAt: serverTimestamp() });
      } else {
        await signInWithEmailAndPassword(auth, $("fMail").value.trim(), $("fPass").value);
      }
    } catch (e) { showErr(e.msg || errMsg(e)); btn.disabled = false; }
  };
  if ($("aForgot")) $("aForgot").onclick = async () => {
    const m = $("fMail").value.trim(); if (!m) return showErr("دخل الإيميل أولا.");
    try { await sendPasswordResetEmail(auth, m); toast("بعثنا ليك رابط تغيير كلمة السر", "ok"); } catch (e) { showErr(errMsg(e)); }
  };
  if ($("aOut")) $("aOut").onclick = () => signOut(auth);
}

function jobCard(j) {
  const o = j.order, c = o.customer || {};
  const codAmt = o.paymentMethod === "cod";
  return `<button class="job s-${j.state}" type="button" data-open="${esc(j.key)}">
    <div class="r1"><span class="nm">${esc(c.name || "زبون")}</span><span class="chip ${STATE_CHIP[j.state]}">${STATE_LABEL[j.state]}</span></div>
    <div class="ad">${ic("pin")} ${esc(c.address || "—")}</div>
    <div class="r3"><span class="chip">${ic("clock")} ${esc(hhmm(o.schedule?.deliveryTime) || "—")}</span><span class="chip">${ic("calendar")} ${j.date === todayStr() ? "اليوم" : esc(niceDate(j.date))}</span>
      ${codAmt ? `<span class="chip y">${ic("money")} دفع عند الاستلام</span>` : `<span class="chip g">${ic("check")} مدفوع/محوّل</span>`}<span class="chip">${esc(orderCode(o.id))}</span></div></button>`;
}

function homeHtml(jobs) {
  const st = stats(), online = !!S.me.online;
  const active = jobs.filter((j) => isActive(j.state));
  const today = todayStr();
  const todo = jobs.filter((j) => j.state === "assigned" && j.date === today);
  const next = active[0] || todo[0];
  return `
  <div class="card"><div class="sw"><div><b style="font-size:16px">${online ? "أنت متصل" : "أنت غير متصل"}</b>
    <div style="color:var(--mut);font-size:12px;margin-top:3px">${online ? "الإدارة كتشوف موقعك وتقدر تعيّن ليك طلبات" : "شعّل الاتصال باش تبان للإدارة وتوصلك التنبيهات"}</div></div>
    <button class="toggle ${online ? "on" : ""}" id="tgOnline" type="button" aria-label="اتصال"></button></div></div>
  <div class="stats"><div class="stat"><b>${st.todayN}</b><span>توصيلات اليوم</span></div>
    <div class="stat"><b>${money(st.todayEarn)}</b><span>أرباح اليوم</span></div>
    <div class="stat"><b>${money(st.todayCash)}</b><span>كاش محصّل اليوم</span></div></div>
  <button class="card" id="hWallet" type="button" style="display:flex;width:100%;align-items:center;justify-content:space-between;border:0;text-align:start;font-size:15px;font-weight:800"><span>${ic("wallet")} رصيد المحفظة</span><span style="color:${balanceOf() < 0 ? "var(--red)" : "var(--p)"}">${money(balanceOf())}</span></button>
  <div class="h2"><span>${active.length ? "توصيلة جارية" : "الطلب الجاي"}</span>${todo.length ? `<span class="chip b">${todo.length} اليوم</span>` : ""}</div>
  ${next ? jobCard(next) : `<div class="empty"><div class="em">${ic("scooter")}</div>ما كاين حتى طلب معيّن ليك دابا.<br>غادي توصلك تنبيه ملي الإدارة تعيّن ليك طلب جديد.</div>`}`;
}

function jobsHtml(jobs) {
  const today = todayStr();
  const seg = S.jobsSeg;
  const list = jobs.filter((j) => seg === "today" ? j.date === today && !(j.state === "delivered" || j.state === "failed") || isActive(j.state)
    : seg === "upcoming" ? j.date > today && j.state === "assigned"
    : j.state === "delivered" || j.state === "failed");
  const doneSorted = seg === "done" ? [...list].sort((a, b) => b.date.localeCompare(a.date)) : list;
  const seen = new Set(); const uniq = doneSorted.filter((j) => (seen.has(j.key) ? false : seen.add(j.key)));
  return `<div class="seg"><button data-seg="today" class="${seg === "today" ? "on" : ""}" type="button">اليوم</button>
    <button data-seg="upcoming" class="${seg === "upcoming" ? "on" : ""}" type="button">القادمة</button>
    <button data-seg="done" class="${seg === "done" ? "on" : ""}" type="button">المنجزة</button></div>
    ${uniq.length ? uniq.map(jobCard).join("") : `<div class="empty"><div class="em">${ic(seg === "done" ? "clipboard" : "scooter")}</div>${seg === "today" ? "ما كاين طلبات لليوم." : seg === "upcoming" ? "ما كاين طلبات قادمة." : "ما كاين توصيلات منجزة بعد."}</div>`}`;
}

const TOPUP_STATUS = { pending: ["قيد المراجعة", "y"], approved: ["تمت الموافقة", "g"], rejected: ["مرفوض", "r"] };
const TX_LABEL = { topup: "شحن المحفظة", settlement: "تسوية الأرباح / الكاش", adjust: "تعديل من الإدارة" };
const balanceOf = () => Number(S.wallet?.balance) || 0;

const EYE_ON = `<svg class="e-on" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>`;
const EYE_OFF = `<svg class="e-off" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M4 20 20 4"/></svg>`;
function walShow() {
  if (S.walShow === undefined) { try { S.walShow = localStorage.getItem("drvWalShow") === "1"; } catch { S.walShow = false; } }
  return S.walShow;
}
function bindWallet() {
  const w = $("wlt"), eye = $("wEye");
  if (!w || !eye) return;
  eye.onclick = () => {
    S.walShow = !walShow();
    try { localStorage.setItem("drvWalShow", S.walShow ? "1" : "0"); } catch {}
    w.classList.toggle("open", S.walShow);
    eye.setAttribute("aria-pressed", S.walShow);
    $("wAmt").textContent = S.walShow ? w.dataset.bal : "******";
    w.querySelectorAll(".wcard b").forEach((b) => (b.textContent = S.walShow ? b.dataset.v : "••••"));
    if (navigator.vibrate) navigator.vibrate(12);
  };
}

function walletHtml() {
  const st = stats(), bal = balanceOf();
  const done = [...S.deliveries.values()].filter((d) => d.status === "delivered").sort((a, b) => b.date.localeCompare(a.date) || (b.deliveredAt?.seconds || 0) - (a.deliveredAt?.seconds || 0)).slice(0, 15);
  const topups = [...S.topups].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 10);
  const txs = [...S.txs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 25);
  const unsettledCash = [...S.deliveries.values()].filter((d) => d.status === "delivered" && d.cod && !d.settledAt).reduce((a, d) => a + (Number(d.collected) || 0), 0);
  const unsettledEarn = [...S.deliveries.values()].filter((d) => d.status === "delivered" && !d.settledAt).reduce((a, d) => a + (Number(d.fee) || 0), 0);
  const show = walShow(), neg = bal < 0;
  const cards = [["wc1", "أرباح لم تُسوَّ", unsettledEarn], ["wc2", "كاش لم يُسلَّم", unsettledCash], ["wc3", "أرباح الشهر", st.monthEarn]];
  return `<div class="wlt ${show ? "open" : ""} ${neg ? "neg" : ""}" id="wlt" data-bal="${esc(money(bal))}">
      <div class="wlt-back"></div>
      <div class="wlt-cards">${cards.map(([c, l, v]) => `<div class="wcard ${c}"><span>${l}</span><b data-v="${esc(money(v))}">${show ? money(v) : "••••"}</b></div>`).join("")}</div>
      <div class="wlt-front">
        <div class="wlt-amt" id="wAmt">${show ? money(bal) : "******"}</div>
        <div class="wlt-lbl">${neg ? "عليك مبلغ للإدارة — اشحن محفظتك" : "رصيد المحفظة"}</div>
        <button class="wlt-eye" id="wEye" type="button" aria-label="إظهار / إخفاء الرصيد" aria-pressed="${show}">${EYE_ON}${EYE_OFF}</button>
      </div></div>
    <button class="btn acc" id="wTopup" type="button" style="margin:0 0 14px">${ic("plus")} شحن المحفظة</button>
    ${topups.length ? `<div class="h2"><span>طلبات الشحن</span></div><div class="card">${topups.map((t) => { const sl = TOPUP_STATUS[t.status] || ["", ""]; return `<div class="row2"><div><b style="color:var(--tx)">${money(t.amount)}</b><small>${esc(payLabel(t.method))} · ${esc(t.createdAt?.toDate ? t.createdAt.toDate().toLocaleDateString("ar-MA") : "")}${t.adminNote ? " · " + esc(t.adminNote) : ""}</small></div><span class="chip ${sl[1]}">${sl[0]}</span></div>`; }).join("")}</div>` : ""}
    <div class="h2"><span>سجل المحفظة</span></div>
    <div class="card">${txs.length ? txs.map((t) => `<div class="row2"><div><b style="color:var(--tx)">${esc(TX_LABEL[t.type] || t.type)}</b><small>${esc(t.createdAt?.toDate ? t.createdAt.toDate().toLocaleDateString("ar-MA") : "")}${t.note ? " · " + esc(t.note) : ""}</small></div><b style="color:${t.amount < 0 ? "var(--red)" : "var(--p)"}" dir="ltr">${t.amount > 0 ? "+" : ""}${money(t.amount)}</b></div>`).join("") : `<div class="empty" style="padding:18px">ما كاين عمليات بعد.</div>`}</div>
    <div class="h2"><span>آخر التوصيلات</span></div>
    <div class="card">${done.length ? done.map((d) => `<div class="row2"><div><b style="color:var(--tx)">${esc(orderCode(d.orderId))}</b><small>${esc(niceDate(d.date))}${d.cod ? " · كاش " + money(d.collected) : ""}${d.settledAt ? " · مُسوّى" : ""}</small></div><b>+${money(d.fee)}</b></div>`).join("") : `<div class="empty" style="padding:18px">ما كاين توصيلات بعد.</div>`}</div>`;
}

/* ───────────── شحن المحفظة (نفس نظام وصولات الزبائن) ───────────── */
const PAY = [
  { id: "card", label: "دفع ببطاقة", img: "../img/icons/paiement.webp" },
  { id: "cih", label: "تطبيق CIH", img: "../img/payments/cih.png" },
  { id: "fellah", label: "القرض الفلاحي", img: "../img/payments/fellah.jpg" },
  { id: "cashplus", label: "كاش بلس", img: "../img/payments/cashplus.jpg" },
  { id: "wafacash", label: "وافا كاش", img: "../img/payments/wafacash.jpg" },
  { id: "tijari", label: "التجاري وفا بنك", img: "../img/payments/tijari.jpg" },
  { id: "baridbank", label: "بريد بنك", img: "../img/payments/baridbank.jpg" },
];
const payLabel = (id) => PAY.find((p) => p.id === id)?.label || id;

async function openTopup() {
  if (!Object.keys(S.payCfg).length) { try { const s = await getDoc(doc(db, "config", "paymentMethods")); S.payCfg = s.exists() ? s.data() : {}; } catch (e) {} }
  const methods = PAY.filter((p) => S.payCfg[p.id]?.enabled !== false);
  let method = methods[0]?.id || "", file = null;
  const m = modal("");
  const mb = m.querySelector(".mb");
  const draw = () => {
    const cfg = S.payCfg[method] || {};
    mb.innerHTML = `<h3>شحن المحفظة</h3>
      <label class="fld"><span>المبلغ (درهم)</span><input id="tAmt" type="number" inputmode="numeric" min="10" max="50000" placeholder="مثال: 200" value="${esc(mb.dataset.amt || "")}"></label>
      <div class="seg" style="flex-wrap:wrap">${[100, 200, 500, 1000].map((v) => `<button type="button" data-q="${v}">${v}</button>`).join("")}</div>
      <div class="h2" style="margin-top:6px"><span>طريقة الدفع</span></div>
      <div class="paygrid">${methods.map((p) => `<button type="button" class="payopt ${p.id === method ? "on" : ""}" data-m="${p.id}"><img src="${p.img}" alt=""><span>${esc(p.label)}</span></button>`).join("")}</div>
      ${cfg.rib || cfg.holder || cfg.note ? `<div class="note" style="margin-top:10px"><b>طريقة التحويل</b>
        ${cfg.rib ? `<div class="copyrow"><div><small>الرقم / RIB</small><b dir="ltr">${esc(cfg.rib)}</b></div><button type="button" class="btn sm ghost" data-copy="${esc(cfg.rib)}">${ic("copy")}</button></div>` : ""}
        ${cfg.holder ? `<div class="copyrow"><div><small>اسم المستفيد</small><b>${esc(cfg.holder)}</b></div><button type="button" class="btn sm ghost" data-copy="${esc(cfg.holder)}">${ic("copy")}</button></div>` : ""}
        ${cfg.note ? `<div style="margin-top:6px">${esc(cfg.note)}</div>` : ""}</div>` : ""}
      <div class="h2" style="margin-top:10px"><span>وصل التحويل</span></div>
      <label class="upl" id="tUpl">${file ? `<img id="tPrev" alt="">` : `${ic("camera")}<span>صوّر أو اختر صورة الوصل</span>`}<input id="tFile" type="file" accept="image/*" hidden></label>
      <div id="tErr"></div>
      <button class="btn" id="tSend" type="button" style="margin-top:12px">${ic("upload")} إرسال الوصل للمراجعة</button>
      <button class="btn ghost" id="tNo" type="button" style="margin-top:8px">رجوع</button>`;
    if (file) { const r = new FileReader(); r.onload = () => { const pv = mb.querySelector("#tPrev"); if (pv) pv.src = r.result; }; r.readAsDataURL(file); }
    mb.querySelector("#tNo").onclick = () => m.remove();
    mb.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { mb.querySelector("#tAmt").value = b.dataset.q; }));
    mb.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mb.dataset.amt = mb.querySelector("#tAmt").value; method = b.dataset.m; draw(); }));
    mb.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("تم النسخ", "ok"); } catch (e) {} }));
    mb.querySelector("#tFile").onchange = (e) => { file = e.target.files?.[0] || null; mb.dataset.amt = mb.querySelector("#tAmt").value; draw(); };
    mb.querySelector("#tSend").onclick = async () => {
      const err = (t) => (mb.querySelector("#tErr").innerHTML = `<div class="err" style="margin-top:10px">${esc(t)}</div>`);
      const amount = Number(mb.querySelector("#tAmt").value);
      if (!(amount >= 10 && amount <= 50000)) return err("المبلغ خاصو يكون بين 10 و 50000 درهم.");
      if (!method) return err("اختر طريقة الدفع.");
      if (!file) return err("زيد صورة وصل التحويل.");
      const btn = mb.querySelector("#tSend"); btn.disabled = true;
      try {
        const image = await compressReceiptImage(file);
        const ref = doc(collection(db, "walletTopups"));
        const batch = writeBatch(db);
        batch.set(ref, { driverId: S.user.uid, amount, method, status: "pending", createdAt: serverTimestamp() });
        batch.set(doc(db, "walletTopupImages", ref.id), { driverId: S.user.uid, image, createdAt: serverTimestamp() });
        await batch.commit();
        m.remove(); toast("تم إرسال الوصل، غادي تراجعو الإدارة وتشحن ليك المحفظة", "ok");
      } catch (e) { btn.disabled = false; err(e?.message === "bad-image" ? "الصورة غير صالحة أو كبيرة بزاف." : errMsg(e)); }
    };
  };
  draw();
}

function profileHtml() {
  const m = S.me;
  return `<div class="card"><div class="h2"><span>بياناتي</span></div>
    <label class="fld"><span>الاسم</span><input id="pName" value="${esc(m.name)}"></label>
    <label class="fld"><span>الهاتف</span><input id="pPhone" type="tel" value="${esc(m.phone)}"></label>
    <label class="fld"><span>وسيلة التوصيل</span><input id="pVeh" value="${esc(m.vehicle || "")}"></label>
    <div class="note" style="margin-bottom:10px">${esc(S.user?.email || "")}</div>
    <button class="btn" id="pSave" type="button">حفظ</button></div>
  <div class="card"><button class="btn ghost" id="pNotif" type="button" style="margin-bottom:8px">${ic("bell")} تفعيل الإشعارات والصوت</button>
    <button class="btn ghost hide" id="pInstall" type="button" style="margin-bottom:8px">${ic("download")} تثبيت التطبيق على الهاتف</button>
    <a class="btn ghost" id="pSupport" href="#" style="text-decoration:none;margin-bottom:8px">${ic("phone")} اتصال بإدارة وجبتنا</a>
    <button class="btn red" id="pOut" type="button">${ic("logout")} تسجيل الخروج</button></div>
  <p class="center" style="color:var(--mut);font-size:12px">وجبتنا — تطبيق السائق v1</p>`;
}

function renderShell(app) {
  const jobs = buildJobs();
  const todayNew = jobs.filter((j) => j.state === "assigned" && j.date === todayStr()).length;
  let body = "";
  if (S.tab === "home") body = homeHtml(jobs);
  else if (S.tab === "jobs") body = jobsHtml(jobs);
  else if (S.tab === "wallet") body = walletHtml();
  else body = profileHtml();
  const titles = { home: "الرئيسية", jobs: "الطلبات", wallet: "المحفظة", me: "حسابي" };
  app.innerHTML = `${S.offline ? `<div class="offline">${ic("alert")} ما كاينش اتصال بالإنترنت — البيانات ممكن ما تكونش محدّثة</div>` : ""}
  <div class="shell"><div class="top"><div class="row"><div><h1>${titles[S.tab]}</h1><small>مرحبا ${esc((S.me.name || "").split(" ")[0])}</small></div>
    <span class="pill ${S.me.online ? "on" : ""}"><i></i>${S.me.online ? "متصل" : "غير متصل"}</span></div></div>
    <div class="main">${body}</div></div>
  <nav class="nav">
    ${[["home", "home", "الرئيسية"], ["jobs", "clipboard", "الطلبات"], ["wallet", "money", "المحفظة"], ["me", "user", "حسابي"]]
      .map(([k, icn, l]) => `<button type="button" data-tab="${k}" class="${S.tab === k ? "on" : ""}"><span class="ic">${ic(icn)}</span>${l}${k === "jobs" && todayNew ? `<span class="bdg">${todayNew}</span>` : ""}</button>`).join("")}
  </nav>
  <div id="sheetHost"></div>`;
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  app.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { S.openKey = b.dataset.open; render(); }));
  app.querySelectorAll("[data-seg]").forEach((b) => (b.onclick = () => { S.jobsSeg = b.dataset.seg; render(); }));
  if ($("tgOnline")) $("tgOnline").onclick = toggleOnline;
  if ($("hWallet")) $("hWallet").onclick = () => { S.tab = "wallet"; render(); };
  if (S.tab === "me") bindProfile();
  if (S.tab === "wallet" && $("wTopup")) $("wTopup").onclick = openTopup;
  if (S.tab === "wallet") bindWallet();
  if (S.openKey) renderSheet(jobs.find((j) => j.key === S.openKey));
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("pInstall")?.classList.remove("hide"); });
function bindProfile() {
  if (deferredInstall) { $("pInstall").classList.remove("hide"); $("pInstall").onclick = () => { deferredInstall.prompt(); deferredInstall = null; $("pInstall").classList.add("hide"); }; }
  $("pOut").onclick = () => signOut(auth);
  $("pNotif").onclick = async () => {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); beep(); } catch (e) {}
    if ("Notification" in window) { const r = await Notification.requestPermission(); toast(r === "granted" ? "تم تفعيل الإشعارات" : "الإشعارات غير مفعّلة", r === "granted" ? "ok" : "err"); }
  };
  $("pSave").onclick = async () => {
    const name = $("pName").value.trim(), phone = $("pPhone").value.trim().replace(/\s/g, ""), vehicle = $("pVeh").value.trim();
    if (name.length < 2) return toast("دخل الاسم", "err");
    if (!phoneOk(phone)) return toast("رقم الهاتف غير صحيح", "err");
    try { await updateDoc(doc(db, "drivers", S.user.uid), { name, phone, vehicle }); toast("تم الحفظ", "ok"); } catch (e) { toast(errMsg(e), "err"); }
  };
  getDocs(collection(db, "siteLinks")).then((snap) => {
    const tel = snap.docs.map((d) => d.data()).find((l) => l.enabled !== false && /^tel:/.test(l.url || ""));
    const a = $("pSupport"); if (!a) return;
    if (tel) a.href = tel.url; else a.classList.add("hide");
  }).catch(() => { $("pSupport")?.classList.add("hide"); });
}

/* ───────────── ورقة تفاصيل الطلب ───────────── */
let map = null, mapMarkers = {};
function destroyMap() { try { map?.remove(); } catch (e) {} map = null; mapMarkers = {}; }
function renderSheet(job) {
  const host = $("sheetHost");
  if (!job) { S.openKey = null; destroyMap(); host.innerHTML = ""; return; }
  const o = job.order, c = o.customer || {}, st = job.state, cod = o.paymentMethod === "cod";
  const today = todayStr(), isToday = job.date === today, nav = navLinks(o);
  const per = Math.round((Number(o.total) || 0) / Math.max(1, (o.schedule?.dates || []).length));
  const stepOrder = ["assigned", "pickedUp", "arrived", "delivered"];
  const idx = st === "failed" ? 2 : stepOrder.indexOf(st);
  const labels = ["معيّن", "فالطريق", "وصلت", "تم التسليم"];
  const steps = labels.map((l, i) => `<div class="st ${i < idx || st === "delivered" ? "done" : i === idx ? "cur" : ""}"><div class="dot">${i < idx || st === "delivered" ? ic("check") : i + 1}</div>${l}</div>`).join("");
  const items = (o.items || []).map((it) => `<div class="kv"><span>${esc(it.name)}</span><b>×${esc(it.qty)}</b></div>`).join("");
  let cta = "";
  const busy = S.busy ? "disabled" : "";
  if (st === "assigned") cta = isToday ? `<button class="btn acc" id="aStart" type="button" ${busy}>${ic("scooter")} استلمت الطلب وانطلقت</button>` : `<button class="btn ghost" type="button" disabled>التوصيل فـ ${esc(niceDate(job.date))}</button>`;
  else if (st === "pickedUp") cta = `<button class="btn acc" id="aArrive" type="button" ${busy}>${ic("pin")} وصلت للعنوان</button><button class="btn red sm" id="aFail" type="button" style="align-self:center">تعذر التسليم</button>`;
  else if (st === "arrived") cta = `<button class="btn" id="aDone" type="button" ${busy}>${ic("check")} تم التسليم</button><button class="btn red sm" id="aFail" type="button" style="align-self:center">تعذر التسليم</button>`;
  const result = st === "delivered" ? `<div class="note">${ic("check")} تم التسليم${job.d?.cod ? " — كاش محصّل: <b>" + money(job.d.collected) + "</b>" : ""} · ربحك: <b>${money(job.d?.fee)}</b></div>`
    : st === "failed" ? `<div class="err">${ic("x")} تعذر التسليم: ${esc(job.d?.failReason || "")}</div>` : "";
  $("sheetHost").innerHTML = `<div class="sheet"><div class="hd"><button id="shClose" type="button" aria-label="رجوع">${ic("chev")}</button><b>${esc(orderCode(o.id))} · ${esc(c.name || "")}</b><span class="chip ${STATE_CHIP[st]}">${STATE_LABEL[st]}</span></div>
    <div class="bd">
      ${result}
      <div class="steps">${steps}</div>
      <div id="map" class="${coordsOf(c.mapLink) || S.pos ? "" : "hide"}"></div>
      <div class="acts">
        <a href="tel:${esc(c.phone)}"><span class="ic">${ic("phone")}</span>اتصال</a>
        <a href="https://wa.me/${esc(waNumber(c.phone))}" target="_blank" rel="noopener"><span class="ic">${ic("chat")}</span>واتساب</a>
        <a href="${esc(nav.google)}" target="_blank" rel="noopener"><span class="ic">${ic("map")}</span>Google Maps</a>
        <a href="${esc(nav.waze)}" target="_blank" rel="noopener"><span class="ic">${ic("car")}</span>Waze</a>
      </div>
      ${cod ? `<div class="cod"><span>حصّل من الزبون عند التسليم</span><b>${money(per)}</b><span>(ثمن اليوم الواحد من ${money(o.total)})</span></div>` : ""}
      <div class="card">
        <div class="kv"><span>الزبون</span><b>${esc(c.name)}</b></div>
        <div class="kv"><span>الهاتف</span><b dir="ltr">${esc(c.phone)}</b></div>
        <div class="kv"><span>العنوان</span><b>${esc(c.address)}</b></div>
        <div class="kv"><span>موعد التوصيل</span><b>${esc(niceDate(job.date))} · ${esc(hhmm(o.schedule?.deliveryTime))}</b></div>
        <div class="kv"><span>الوجبة</span><b>${o.mealType === "dinner" ? "العشاء" : "الغداء"}</b></div>
        <div class="kv"><span>الدفع</span><b>${esc(o.paymentMethodLabel || "")}</b></div>
        ${c.notes ? `<div class="kv"><span>ملاحظات</span><b>${esc(c.notes)}</b></div>` : ""}
      </div>
      <div class="h2"><span>محتوى الطلب</span></div><div class="card">${items || "—"}</div>
    </div>
    ${cta ? `<div class="cta">${cta}</div>` : ""}</div>`;
  $("shClose").onclick = () => { S.openKey = null; destroyMap(); render(); };
  if ($("aStart")) $("aStart").onclick = () => actStart(job);
  if ($("aArrive")) $("aArrive").onclick = () => actArrive(job);
  if ($("aDone")) $("aDone").onclick = () => confirmDeliver(job, per);
  if ($("aFail")) $("aFail").onclick = () => failSheet(job);
  setupMap(o);
}

function setupMap(o) {
  destroyMap();
  const el = $("map"); if (!el || !window.L) return;
  const dest = coordsOf(o.customer?.mapLink);
  if (!dest && !S.pos) return;
  const start = dest || S.pos;
  map = L.map(el, { zoomControl: false, attributionControl: false }).setView([start.lat, start.lng], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  const dot = (name, bg) => L.divIcon({ html: `<div style="width:34px;height:34px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid #fff;box-shadow:0 3px 8px #0006">${ic(name)}</div>`, className: "", iconSize: [34, 34], iconAnchor: [17, 17] });
  if (dest) mapMarkers.dest = L.marker([dest.lat, dest.lng], { icon: dot("pin", "#dc2626") }).addTo(map);
  window.__mapUpdate = () => {
    if (!map || !S.pos) return;
    const ll = [S.pos.lat, S.pos.lng];
    if (mapMarkers.me) mapMarkers.me.setLatLng(ll); else mapMarkers.me = L.marker(ll, { icon: dot("scooter", "#064e3b") }).addTo(map);
    if (dest && !mapMarkers.fitted) { map.fitBounds([ll, [dest.lat, dest.lng]], { padding: [34, 34], maxZoom: 16 }); mapMarkers.fitted = true; }
  };
  window.__mapUpdate();
  setTimeout(() => map?.invalidateSize(), 250);
}

function modal(html) {
  const m = document.createElement("div"); m.className = "modal"; m.innerHTML = `<div class="mb">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
}
function confirmDeliver(job, per) {
  const cod = !!job.d?.cod || job.order.paymentMethod === "cod";
  const m = modal(`<h3>تأكيد التسليم</h3>
    ${cod ? `<label class="fld"><span>المبلغ الذي حصّلتو من الزبون (د.م.)</span><input id="mAmt" type="number" inputmode="decimal" min="0" value="${per}"></label>` : `<div class="note">الطلب مدفوع مسبقا — ما خاصك تحصّل شي مبلغ.</div>`}
    <button class="btn" id="mOk" type="button">تأكيد التسليم</button><button class="btn ghost" id="mNo" type="button" style="margin-top:8px">رجوع</button>`);
  m.querySelector("#mNo").onclick = () => m.remove();
  m.querySelector("#mOk").onclick = () => { const v = m.querySelector("#mAmt")?.value; m.remove(); actDeliver(job, v); };
}
function failSheet(job) {
  const reasons = ["الزبون ما كيجاوبش على الهاتف", "العنوان غير صحيح / ما لقيتوش", "الزبون رفض الطلب", "الزبون مش موجود", "مشكل فالدراجة / السيارة", "سبب آخر"];
  const m = modal(`<h3>سبب تعذر التسليم</h3>${reasons.map((r) => `<button class="opt" type="button" data-r="${esc(r)}">${esc(r)}</button>`).join("")}<button class="btn ghost" id="mNo" type="button">رجوع</button>`);
  m.querySelector("#mNo").onclick = () => m.remove();
  m.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { m.remove(); actFail(job, b.dataset.r); }));
}

/* ───────────── الاتصال بـ Firestore ───────────── */
function stopListeners() { unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = []; firstOrdersSnap = true; }
function startListeners(uid) {
  stopListeners();
  // الطلبات المعيّنة لهاد السائق + التنبيه على الجديد
  unsubs.push(onSnapshot(query(collection(db, "orders"), where("driverId", "==", uid)), (snap) => {
    const seen = getSeen(); let fresh = [];
    snap.docChanges().forEach((ch) => {
      const o = { id: ch.doc.id, ...ch.doc.data() };
      if (ch.type === "removed") S.orders.delete(o.id); else S.orders.set(o.id, o);
      if (ch.type === "added" && !seen.has(o.id) && !CANCELLED.includes(o.status)) { fresh.push(o); seen.add(o.id); }
    });
    saveSeen(seen);
    if (fresh.length) { if (fresh.length === 1) newJobAlert(fresh[0]); else { beep(); toast(`${fresh.length} طلبات جديدة معيّنة ليك`, "ok"); systemNotify("طلبات جديدة", `${fresh.length} طلبات معيّنة ليك`); } }
    firstOrdersSnap = false;
    render();
  }, () => toast("تعذر تحميل الطلبات", "err")));
  // حالة التوصيلات
  unsubs.push(onSnapshot(query(collection(db, "deliveries"), where("driverId", "==", uid)), (snap) => {
    let changed = false;
    snap.docChanges().forEach((ch) => {
      const prev = S.deliveries.get(ch.doc.id);
      if (ch.type === "removed") { S.deliveries.delete(ch.doc.id); changed = true; return; }
      const next = { id: ch.doc.id, ...ch.doc.data() };
      if (!prev || prev.status !== next.status || prev.collected !== next.collected) changed = true;
      S.deliveries.set(ch.doc.id, next);
    });
    if (!changed) return; // تحديثات الموقع فقط: ما نعاودوش رسم الشاشة (باش الخريطة والتمرير ما يتقطعوش)
    syncTracking(); render();
  }, () => {}));
  // المحفظة: الرصيد + العمليات + طلبات الشحن
  unsubs.push(onSnapshot(doc(db, "driverWallets", uid), (snap) => { S.wallet = snap.exists() ? snap.data() : null; render(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "walletTx"), where("driverId", "==", uid)), (snap) => { S.txs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); if (S.tab === "wallet") render(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "walletTopups"), where("driverId", "==", uid)), (snap) => { S.topups = snap.docs.map((d) => ({ id: d.id, ...d.data() })); if (S.tab === "wallet") render(); }, () => {}));
  freshFee();
}

let meUnsub = null;
onAuthStateChanged(auth, (user) => {
  S.user = user; stopListeners(); meUnsub?.(); meUnsub = null;
  S.orders.clear(); S.deliveries.clear(); S.me = null; S.wallet = null; S.txs = []; S.topups = [];
  if (!user) { S.screen = "auth"; syncTracking(); render(); return; }
  S.screen = "loading"; render();
  meUnsub = onSnapshot(doc(db, "drivers", user.uid), (snap) => {
    if (!snap.exists()) { S.me = null; S.screen = "auth"; S.authTab = "register"; syncTracking(); render(); return; }
    const before = S.me;
    S.me = { id: snap.id, ...snap.data() };
    const prev = S.screen;
    // نبض الموقع (lastLoc/lastSeenAt) ما يستحقش إعادة رسم
    if (before && prev === "app" && S.me.status === before.status && S.me.online === before.online && S.me.name === before.name && S.me.phone === before.phone && S.me.vehicle === before.vehicle) return;
    if (S.me.status === "active") { S.screen = "app"; if (prev !== "app") startListeners(user.uid); }
    else { S.screen = S.me.status === "suspended" ? "suspended" : "pending"; stopListeners(); }
    syncTracking(); render();
  }, () => { S.screen = "auth"; render(); });
});

window.addEventListener("online", () => { S.offline = false; render(); });
window.addEventListener("offline", () => { S.offline = true; render(); });
render();
