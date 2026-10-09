// admin-drivers.js — إدارة سائقي التوصيل: الموافقة، الأتعاب، خريطة السداسيات، المحفظة (شحن/تسوية/تعديل)، والتعيين التلقائي
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, deleteField, query, where, orderBy, limit,
  onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { ic, setIconBase } from "./drvicons.js";
import { CITY_CENTER, cityCells, cellPolygon, cellId, latLngToCell, searchByRings, metersBetween, MAX_SEARCH_RING, HEX_SIZE_M } from "./hexgrid.js";

setIconBase("");
let ctx = { toast: (m) => alert(m) };
export function initAdminDrivers(c) { ctx = { ...ctx, ...c }; }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const money = (n) => Math.round(Number(n) || 0).toLocaleString("ar-MA") + " درهم";
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isOnline = (d) => d.online === true && d.lastSeenAt?.seconds && Date.now() / 1000 - d.lastSeenAt.seconds < 120;
const locFresh = (d) => d.lastLoc && Date.now() - (d.lastLoc.at || 0) < 120000;
const STATUS_AR = { pending: "قيد المراجعة", active: "مفعّل", suspended: "موقوف" };
const DEL_AR = { pickedUp: "فالطريق", arrived: "وصل", delivered: "تم التسليم", failed: "تعذر" };
const PAY_AR = { card: "بطاقة", cih: "CIH", fellah: "القرض الفلاحي", cashplus: "كاش بلس", wafacash: "وافا كاش", tijari: "التجاري وفا بنك", baridbank: "بريد بنك" };
const mapLink = (l) => (l?.lat != null ? `https://www.google.com/maps?q=${l.lat},${l.lng}` : "");
const MAX_ACTIVE = 2; // أقصى توصيلات جارية فنفس الوقت لسائق واحد فالتعيين التلقائي
const ARC = ["ملغى من طرف الزبون", "ملغى من المشرف", "ملغي"];

export function coordsFromLink(link) {
  const m = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(link || "");
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

/* ───────────── البحث عن سائق بالسداسيات ───────────── */
// سداسي الزبون ← الست المجاورين ← الحلقات اللي بعدهم، وفكل حلقة كنختار الأقرب (غير السائقين المتصلين والمتاحين).
export async function findDriverForOrder(order) {
  const dest = coordsFromLink(order?.customer?.mapLink);
  if (!dest) return { error: "nocoords" };
  const [drs, act] = await Promise.all([
    getDocs(query(collection(db, "drivers"), where("status", "==", "active"))),
    getDocs(query(collection(db, "deliveries"), where("status", "in", ["pickedUp", "arrived"]))).catch(() => ({ docs: [] })),
  ]);
  const busy = {};
  act.docs.forEach((d) => { const id = d.data().driverId; busy[id] = (busy[id] || 0) + 1; });
  const cands = drs.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => isOnline(d) && locFresh(d) && (busy[d.id] || 0) < MAX_ACTIVE)
    .map((d) => ({ id: d.id, name: d.name, phone: d.phone, lat: d.lastLoc.lat, lng: d.lastLoc.lng }));
  if (!cands.length) return { error: "nodrivers", dest };
  const r = searchByRings(dest, cands);
  if (!r) return { error: "outofrange", dest };
  return { ...r, dest };
}

async function assignTo(order, driver, extra) {
  const patch = { driverId: driver.id, driverName: driver.name, driverPhone: driver.phone, assignedAt: serverTimestamp(), assignedBy: auth.currentUser.uid };
  if (extra) patch.dispatch = extra;
  await updateDoc(doc(db, "orders", order.id), patch);
  order.driverId = driver.id; order.driverName = driver.name; order.driverPhone = driver.phone;
  if (extra) order.dispatch = extra;
}

export async function autoAssignDriver(order, { quiet } = {}) {
  if (!order || ARC.includes(order.status)) return null;
  try {
    const r = await findDriverForOrder(order);
    if (r.error === "nocoords") { if (!quiet) ctx.toast("الطلب ما فيهش موقع الزبون على الخريطة — عيّن السائق يدويا", "error"); return null; }
    if (r.error) { if (!quiet) ctx.toast(r.error === "nodrivers" ? "ما كاين حتى سائق متصل ومتاح دابا" : "ما لقيت سائق قريب فنطاق المدينة", "error"); return null; }
    const info = { mode: "auto", ring: r.ring, cell: r.originCell, driverCell: r.driver.cell, candidates: r.candidates, at: Date.now() };
    await assignTo(order, r.driver, info);
    ctx.toast(`تم تعيين ${r.driver.name} تلقائيا (${r.ring === 0 ? "نفس السداسي" : "الحلقة " + r.ring})`);
    return r;
  } catch (e) { if (!quiet) ctx.toast("تعذر البحث التلقائي عن سائق", "error"); return null; }
}
// كيتنادى من admin.js ملي المشرف يقبل الطلب
export async function autoDispatchAfterAccept(order) {
  if (!order || order.driverId) return;
  await autoAssignDriver(order);
}

/* ───────────── خريطة السداسيات ───────────── */
let hexUnsub = null, hexMap = null;
function cleanupHex() { try { hexUnsub?.(); } catch (e) {} hexUnsub = null; try { hexMap?.remove(); } catch (e) {} hexMap = null; }

function mountHexMap(box) {
  if (!window.L) { box.innerHTML = `<div class="empty">تعذر تحميل مكتبة الخريطة (Leaflet). تأكد من الاتصال بالإنترنت.</div>`; return; }
  box.innerHTML = `<div id="hexMap" style="height:380px;border-radius:14px;overflow:hidden;z-index:1"></div>
    <div id="hexInfo" style="font-size:13px;color:#475569;margin-top:8px;line-height:1.7"></div>`;
  const L = window.L;
  const map = (hexMap = L.map("hexMap", { zoomControl: true, attributionControl: false }).setView([CITY_CENTER.lat, CITY_CENTER.lng], 13));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  const polys = new Map();
  for (const c of cityCells()) {
    const id = cellId(c);
    const p = L.polygon(cellPolygon(c), { color: "#64748b", weight: 1, fillColor: "#f59e0b", fillOpacity: 0, opacity: 0.55 }).addTo(map);
    polys.set(id, p);
  }
  const markers = new Map();
  let live = [], testPin = null;
  const info = box.querySelector("#hexInfo");
  const mIcon = (name) => L.divIcon({
    className: "", iconSize: [38, 38], iconAnchor: [19, 19],
    html: `<div title="${esc(name)}" style="width:38px;height:38px;border-radius:50%;background:#064e3b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;border:3px solid #fff;box-shadow:0 3px 8px #0006">${ic("scooter")}</div>`,
  });
  function refresh(docs) {
    const drivers = docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.status === "active");
    live = drivers.filter((d) => isOnline(d) && locFresh(d));
    const counts = new Map();
    const seen = new Set();
    for (const d of live) {
      seen.add(d.id);
      const cid = cellId(latLngToCell(d.lastLoc.lat, d.lastLoc.lng));
      counts.set(cid, (counts.get(cid) || 0) + 1);
      const ll = [d.lastLoc.lat, d.lastLoc.lng];
      const age = Math.max(0, Math.round((Date.now() - d.lastLoc.at) / 1000));
      const html = `<b>${esc(d.name)}</b><br><span dir="ltr">${esc(d.phone)}</span><br>السداسي: ${esc(cid)}<br>آخر تحديث: منذ ${age} ثانية`;
      if (markers.has(d.id)) { markers.get(d.id).setLatLng(ll).setPopupContent(html); }
      else markers.set(d.id, L.marker(ll, { icon: mIcon(d.name) }).addTo(map).bindPopup(html));
    }
    for (const [id, m] of markers) if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); }
    polys.forEach((p, id) => { const n = counts.get(id) || 0; p.setStyle({ fillOpacity: n ? 0.28 + Math.min(0.4, n * 0.12) : 0, weight: n ? 2 : 1, color: n ? "#b45309" : "#64748b" }); });
    if (!testPin) info.innerHTML = `${ic("hex")} <b>${polys.size}</b> سداسي (نصف القطر ${HEX_SIZE_M} م) · سائقون متصلون: <b>${live.length}</b> · الموقع كيتحدّث كل 5 ثواني.<br><span style="color:#78716c">اضغط على أي نقطة فالخريطة باش تجرب البحث عن أقرب سائق (سداسي الزبون ← الست المجاورين ← الحلقات اللي بعدهم).</span>`;
  }
  map.on("click", (e) => {
    const dest = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (testPin) map.removeLayer(testPin);
    testPin = L.circleMarker(e.latlng, { radius: 8, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9 }).addTo(map);
    const cands = live.map((d) => ({ id: d.id, name: d.name, lat: d.lastLoc.lat, lng: d.lastLoc.lng }));
    const r = cands.length ? searchByRings(dest, cands) : null;
    const oc = cellId(latLngToCell(dest.lat, dest.lng));
    info.innerHTML = r
      ? `${ic("search")} سداسي النقطة <b>${esc(oc)}</b> ← أول سائق لقيتو فـ <b>${r.ring === 0 ? "نفس السداسي" : "الحلقة " + r.ring}</b>: <b>${esc(r.driver.name)}</b> (على بعد ${Math.round(metersBetween(dest, r.driver))} م) · عدد المرشحين فهاد الحلقة: ${r.candidates}`
      : `${ic("search")} سداسي النقطة <b>${esc(oc)}</b> ← ما لقيت حتى سائق متصل فنطاق ${MAX_SEARCH_RING} حلقة.`;
  });
  hexUnsub = onSnapshot(query(collection(db, "drivers"), where("status", "==", "active")), (snap) => {
    if (!document.getElementById("hexMap")) { cleanupHex(); return; } // خرجنا من التاب
    refresh(snap.docs);
  }, () => {});
  setTimeout(() => map.invalidateSize(), 300);
}

/* ───────────── المحفظة: شحن/تسوية/تعديل ───────────── */
async function applyWallet(driverId, amount, type, note, ref, extraWrites) {
  const wref = doc(db, "driverWallets", driverId);
  await runTransaction(db, async (tx) => {
    const w = await tx.get(wref);
    const bal = w.exists() ? Number(w.data().balance) || 0 : 0;
    if (extraWrites) await extraWrites(tx);
    tx.set(wref, { balance: bal + amount, updatedAt: serverTimestamp() });
    tx.set(doc(collection(db, "walletTx")), { driverId, type, amount, note: note || "", ref: ref || "", createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
  });
}

async function approveTopup(t) {
  await runTransaction(db, async (tx) => {
    const tref = doc(db, "walletTopups", t.id), wref = doc(db, "driverWallets", t.driverId);
    const [ts, ws] = await Promise.all([tx.get(tref), tx.get(wref)]);
    if (!ts.exists() || ts.data().status !== "pending") throw new Error("already");
    const amount = Number(ts.data().amount) || 0;
    const bal = ws.exists() ? Number(ws.data().balance) || 0 : 0;
    tx.update(tref, { status: "approved", reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid });
    tx.set(wref, { balance: bal + amount, updatedAt: serverTimestamp() });
    tx.set(doc(collection(db, "walletTx")), { driverId: t.driverId, type: "topup", amount, note: `شحن عبر ${PAY_AR[ts.data().method] || ts.data().method}`, ref: t.id, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
  });
}

async function settleDriver(driver) {
  const snap = await getDocs(query(collection(db, "deliveries"), where("driverId", "==", driver.id)));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.status === "delivered" && !d.settledAt).slice(0, 400);
  if (!list.length) return ctx.toast("ما كاين توصيلات جديدة للتسوية");
  const earn = list.reduce((a, d) => a + (Number(d.fee) || 0), 0);
  const cash = list.reduce((a, d) => a + (d.cod ? Number(d.collected) || 0 : 0), 0);
  const net = earn - cash;
  if (!confirm(`تسوية حساب ${driver.name}\n\nتوصيلات: ${list.length}\nأرباح السائق: +${earn} درهم\nكاش محصّل عند الزبناء: −${cash} درهم\nالصافي فالمحفظة: ${net >= 0 ? "+" : ""}${net} درهم\n\nتأكيد؟`)) return;
  await applyWallet(driver.id, net, "settlement", `تسوية ${list.length} توصيلة (أرباح ${earn} − كاش ${cash})`, "", async (tx) => {
    list.forEach((d) => tx.update(doc(db, "deliveries", d.id), { settledAt: serverTimestamp() }));
  });
  ctx.toast("تمت التسوية");
}

async function viewReceipt(id) {
  const s = await getDoc(doc(db, "walletTopupImages", id));
  if (!s.exists()) return ctx.toast("ما لقيت صورة الوصل", "error");
  const w = window.open("", "_blank");
  if (w) { w.document.write(`<title>وصل الشحن</title><body style="margin:0;background:#111;display:flex;justify-content:center"><img src="${s.data().image}" style="max-width:100%;height:auto">`); w.document.close(); }
}

/* ───────────── تاب السائقين ───────────── */
export async function renderDriversTab(el) {
  cleanupHex();
  el.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  let drivers = [], deliveries = [], fee = 0, wallets = {}, topups = [], reviews = [];
  try {
    const [dr, de, st, wa, tp] = await Promise.all([
      getDocs(collection(db, "drivers")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      getDocs(query(collection(db, "deliveries"), orderBy("updatedAt", "desc"), limit(800))),
      getDoc(doc(db, "config", "driverSettings")).catch(() => null),
      getDocs(collection(db, "driverWallets")),
      getDocs(query(collection(db, "walletTopups"), where("status", "==", "pending"))),
    ]);
    drivers = dr; deliveries = de.docs.map((d) => ({ id: d.id, ...d.data() }));
    fee = st && st.exists() ? Number(st.data().feePerDelivery) || 0 : 0;
    wa.docs.forEach((d) => (wallets[d.id] = Number(d.data().balance) || 0));
    topups = tp.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  } catch (e) {
    el.innerHTML = `<div class="empty">تعذر تحميل بيانات السائقين. تأكد أنك نشرت قواعد Firestore الجديدة.<br><button class="btn-outline-sm" id="drRetry">إعادة المحاولة</button></div>`;
    document.getElementById("drRetry").onclick = () => renderDriversTab(el);
    return;
  }
  // تقييمات الزبناء للسائقين (لا تمنع تحميل الصفحة إلا كانت القواعد الجديدة ما نشرتش بعد)
  try { reviews = (await getDocs(query(collection(db, "driverReviews"), orderBy("createdAt", "desc"), limit(1000)))).docs.map((d) => d.data()); } catch (e) { reviews = []; }
  const today = todayStr();
  const rate = (id) => {
    const r = reviews.filter((x) => x.driverId === id), n = r.length;
    return { n, avg: n ? r.reduce((a, x) => a + (Number(x.stars) || 0), 0) / n : 0, rude: r.filter((x) => x.polite === false).length, money: r.filter((x) => x.askedMoney === true).length };
  };
  const stat = (id) => {
    const mine = deliveries.filter((d) => d.driverId === id);
    const done = mine.filter((d) => d.status === "delivered");
    return {
      todayN: done.filter((d) => d.date === today).length, totalN: done.length, failed: mine.filter((d) => d.status === "failed").length,
      cashDue: done.filter((d) => d.cod && !d.settledAt).reduce((a, d) => a + (Number(d.collected) || 0), 0),
      earnDue: done.filter((d) => !d.settledAt).reduce((a, d) => a + (Number(d.fee) || 0), 0),
      active: mine.find((d) => d.status === "pickedUp" || d.status === "arrived"),
    };
  };
  const nameOf = (id) => drivers.find((d) => d.id === id)?.name || "—";
  const pending = drivers.filter((d) => d.status === "pending");
  const active = drivers.filter((d) => d.status === "active").sort((a, b) => (isOnline(b) ? 1 : 0) - (isOnline(a) ? 1 : 0));
  const susp = drivers.filter((d) => d.status === "suspended");

  const card = (d) => {
    const s = stat(d.id), on = isOnline(d), loc = mapLink(d.lastLoc), bal = wallets[d.id] || 0;
    return `<div class="admin-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:16px">${esc(d.name)}</b>
        <span class="info-tag" style="${on ? "background:#d1fae5;color:#065f46" : "background:#f1f5f9;color:#64748b"};font-weight:800">${d.status === "active" ? (on ? "● متصل" : "○ غير متصل") : STATUS_AR[d.status] || d.status}</span>
      </div>
      <div style="color:#64748b;font-size:13px;margin:6px 0">${ic("phone")} <a href="tel:${esc(d.phone)}" dir="ltr">${esc(d.phone)}</a> · ${ic("scooter")} ${esc(d.vehicle || "—")} · ${esc(d.email || "")}</div>
      ${d.status === "active" ? `<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px;margin:6px 0">
        <span class="info-tag">اليوم: ${s.todayN}</span><span class="info-tag">المجموع: ${s.totalN}</span><span class="info-tag">فشل: ${s.failed}</span>
        ${(() => { const r = rate(d.id); return r.n ? `<span class="info-tag" style="background:#fffbeb;color:#92400e;font-weight:800">★ ${r.avg.toFixed(1)} (${r.n})</span>${r.rude ? `<span class="info-tag" style="background:#fee2e2;color:#991b1b">غير مهذب: ${r.rude}</span>` : ""}${r.money ? `<span class="info-tag" style="background:#fee2e2;color:#991b1b">طلب زيادة مال: ${r.money}</span>` : ""}` : `<span class="info-tag" style="color:#94a3b8">بدون تقييم</span>`; })()}
        <span class="info-tag" style="background:${bal < 0 ? "#fee2e2;color:#991b1b" : "#ecfdf5;color:#065f46"}">${ic("wallet")} المحفظة: ${money(bal)}</span>
        <span class="info-tag">أرباح لم تُسوَّ: ${money(s.earnDue)}</span><span class="info-tag" style="background:#fffbeb;color:#92400e">كاش لم يُسلَّم: ${money(s.cashDue)}</span></div>
        ${s.active ? `<div style="font-size:13px;color:#92400e;margin:4px 0">توصيلة جارية: ${esc(DEL_AR[s.active.status])} · WJ-${esc(String(s.active.orderId).slice(0, 8).toUpperCase())}${mapLink(s.active.driverLoc) ? ` · <a target="_blank" rel="noopener" href="${mapLink(s.active.driverLoc)}">الموقع المباشر</a>` : ""}</div>` : ""}
        ${loc ? `<div style="font-size:12px;color:#64748b">آخر موقع: <a target="_blank" rel="noopener" href="${loc}">فتح فالخريطة</a></div>` : ""}` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${d.status !== "active" ? `<button class="add" data-set="${d.id}|active" style="padding:8px 16px;font-size:13px">${ic("check")} تفعيل</button>` : ""}
        ${d.status === "active" ? `<button class="btn-outline-sm" data-settle="${d.id}">${ic("money")} تسوية الحساب</button><button class="btn-outline-sm" data-adjust="${d.id}">${ic("wallet")} تعديل الرصيد</button><button class="btn-outline-sm" data-set="${d.id}|suspended" style="color:#dc2626">${ic("ban")} إيقاف</button>` : ""}
        ${d.status === "pending" ? `<button class="btn-outline-sm" data-set="${d.id}|suspended" style="color:#dc2626">رفض</button>` : ""}
        ${d.status === "suspended" ? `<button class="btn-outline-sm" data-del="${d.id}" style="color:#dc2626">حذف</button>` : ""}
      </div></div>`;
  };

  const topupCard = (t) => `<div class="admin-card" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><b>${esc(nameOf(t.driverId))}</b><b style="color:#065f46">${money(t.amount)}</b></div>
    <div style="font-size:13px;color:#64748b;margin:4px 0">${esc(PAY_AR[t.method] || t.method)} · ${esc(t.createdAt?.toDate ? t.createdAt.toDate().toLocaleString("ar-MA") : "")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn-outline-sm" data-receipt="${t.id}">${ic("receipt")} عرض الوصل</button>
      <button class="add" data-tok="${t.id}" style="padding:8px 16px;font-size:13px">${ic("check")} قبول وشحن</button>
      <button class="btn-outline-sm" data-trej="${t.id}" style="color:#dc2626">${ic("x")} رفض</button></div></div>`;

  const recent = deliveries.slice(0, 25);
  el.innerHTML = `
    <div class="admin-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px">${ic("scooter")} السائقون</h3>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:700">أتعاب السائق عن كل توصيلة (درهم)
          <input id="drFee" type="number" min="0" step="0.5" value="${fee}" style="display:block;margin-top:4px;padding:10px;border:1px solid #ddd;border-radius:10px;width:160px"></label>
        <button class="add" id="drFeeSave" style="padding:10px 18px">حفظ</button>
      </div>
      <p style="font-size:12px;color:#78716c;margin:8px 0 0">الأتعاب كتتسجل وقت بداية كل توصيلة. رابط تطبيق السائق: <b dir="ltr">${esc(location.origin + location.pathname.replace(/[^/]*$/, ""))}driver/</b></p>
    </div>
    <div class="admin-card" style="margin-bottom:12px"><h3 style="margin:0 0 10px">${ic("hex")} خريطة برشيد بالسداسيات</h3><div id="hexBox"></div></div>
    ${topups.length ? `<h4 style="margin:14px 4px 8px">${ic("wallet")} طلبات شحن المحفظة (${topups.length})</h4>${topups.map(topupCard).join("")}` : ""}
    ${pending.length ? `<h4 style="margin:14px 4px 8px">${ic("hourglass")} طلبات التسجيل (${pending.length})</h4>${pending.map(card).join("")}` : ""}
    <h4 style="margin:14px 4px 8px">السائقون المفعّلون (${active.length})</h4>
    ${active.length ? active.map(card).join("") : `<div class="empty">ما كاين سائقين مفعّلين بعد. خلّي السائق يسجل من تطبيق السائق، ومن بعد فعّلو من هنا.</div>`}
    ${susp.length ? `<h4 style="margin:14px 4px 8px">الموقوفون (${susp.length})</h4>${susp.map(card).join("")}` : ""}
    <h4 style="margin:14px 4px 8px">آخر التوصيلات</h4>
    <div class="admin-card">${recent.length ? recent.map((d) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #eee;font-size:13px">
      <span>WJ-${esc(String(d.orderId).slice(0, 8).toUpperCase())} · ${esc(d.date)}<br><small style="color:#64748b">${esc(nameOf(d.driverId))}</small></span>
      <span style="text-align:end">${esc(DEL_AR[d.status] || d.status)}${d.status === "delivered" && d.cod ? `<br><small style="color:#92400e">كاش ${money(d.collected)}</small>` : ""}${d.status === "failed" ? `<br><small style="color:#dc2626">${esc(d.failReason || "")}</small>` : ""}</span></div>`).join("") : `<div class="empty">ما كاين توصيلات بعد.</div>`}</div>`;

  mountHexMap(el.querySelector("#hexBox"));
  const again = () => renderDriversTab(el);
  const guard = (fn, okMsg) => async (e) => { try { await fn(e); if (okMsg) ctx.toast(okMsg); again(); } catch (err) {
    if (err?.message === "cancel") return;
    ctx.toast(err?.message === "already" ? "الطلب تعالج من قبل" : err?.message === "bad" ? "قيمة غير صحيحة" : "تعذرت العملية", "error");
  } };
  el.querySelector("#drFeeSave").onclick = async () => {
    const v = Number(document.getElementById("drFee").value);
    if (!(v >= 0 && v <= 10000)) return ctx.toast("قيمة غير صحيحة", "error");
    try { await setDoc(doc(db, "config", "driverSettings"), { feePerDelivery: v, updatedAt: serverTimestamp() }, { merge: true }); ctx.toast("تم حفظ الأتعاب"); }
    catch (e) { ctx.toast("تعذر الحفظ (تأكد من نشر القواعد الجديدة)", "error"); }
  };
  el.querySelectorAll("[data-set]").forEach((b) => (b.onclick = guard(async () => {
    const [id, status] = b.dataset.set.split("|");
    await updateDoc(doc(db, "drivers", id), { status, statusUpdatedAt: serverTimestamp(), statusUpdatedBy: auth.currentUser.uid });
  }, "تم تحديث الحالة")));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = guard(async () => { if (!confirm("حذف سجل هاد السائق نهائيا؟")) throw new Error("cancel"); await deleteDoc(doc(db, "drivers", b.dataset.del)); })));
  el.querySelectorAll("[data-receipt]").forEach((b) => (b.onclick = () => viewReceipt(b.dataset.receipt).catch(() => ctx.toast("تعذر فتح الوصل", "error"))));
  el.querySelectorAll("[data-tok]").forEach((b) => (b.onclick = guard(async () => { const t = topups.find((x) => x.id === b.dataset.tok); b.disabled = true; await approveTopup(t); }, "تم شحن المحفظة")));
  el.querySelectorAll("[data-trej]").forEach((b) => (b.onclick = guard(async () => {
    const note = prompt("سبب الرفض (يبان للسائق):", "الوصل غير واضح"); if (note === null) throw new Error("cancel");
    await updateDoc(doc(db, "walletTopups", b.dataset.trej), { status: "rejected", adminNote: note.slice(0, 300), reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid });
  }, "تم رفض الطلب")));
  el.querySelectorAll("[data-settle]").forEach((b) => (b.onclick = guard(async () => { await settleDriver(drivers.find((d) => d.id === b.dataset.settle)); })));
  el.querySelectorAll("[data-adjust]").forEach((b) => (b.onclick = guard(async () => {
    const v = prompt("المبلغ (موجب = إضافة للمحفظة، سالب = خصم). مثال: 150 أو -80"); if (v === null) throw new Error("cancel");
    const amount = Number(v); if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) throw new Error("bad");
    const note = prompt("ملاحظة (مثلا: دفع أرباح نقدا):", "") ?? "";
    await applyWallet(b.dataset.adjust, amount, "adjust", note.slice(0, 300), "");
  }, "تم تعديل الرصيد")));
}

/* ───────────── قسم السائق داخل تفاصيل الطلب ───────────── */
export async function mountAssignDriver(box, order) {
  if (!box) return;
  box.innerHTML = `<h4>${ic("scooter")} السائق</h4><div style="color:#78716c;font-size:13px">جارٍ التحميل...</div>`;
  let drivers = [], dels = [];
  try {
    const [dr, de] = await Promise.all([
      getDocs(query(collection(db, "drivers"), where("status", "==", "active"))),
      getDocs(query(collection(db, "deliveries"), where("orderId", "==", order.id))),
    ]);
    drivers = dr.docs.map((d) => ({ id: d.id, ...d.data() }));
    dels = de.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { box.innerHTML = `<h4>${ic("scooter")} السائق</h4><div style="color:#dc2626;font-size:13px">تعذر التحميل (نشر قواعد Firestore الجديدة مطلوب).</div>`; return; }
  const cur = order.driverId, cancelled = ARC.includes(order.status);
  const dp = order.dispatch;
  box.innerHTML = `<h4>${ic("scooter")} السائق</h4>
    ${cur ? `<div class="order-detail-row"><span>المعيّن حاليا</span><b>${esc(order.driverName || "")} · <a href="tel:${esc(order.driverPhone || "")}" dir="ltr">${esc(order.driverPhone || "")}</a></b></div>${dp?.mode === "auto" ? `<div style="font-size:12px;color:#065f46;margin:4px 0">${ic("hex")} تعيين تلقائي: ${dp.ring === 0 ? "نفس سداسي الزبون" : "الحلقة " + dp.ring} (سداسي الزبون ${esc(dp.cell)})</div>` : ""}` : `<div class="order-detail-row"><span style="color:#78716c">ما معيّن حتى سائق</span></div>`}
    <button type="button" class="add" id="asAuto" style="padding:9px 16px;font-size:13px;margin-top:6px" ${cancelled ? "disabled" : ""}>${ic("hex")} بحث تلقائي عن أقرب سائق</button>
    <select id="asDriver" style="margin-top:8px" ${cancelled ? "disabled" : ""}>
      <option value="">— أو اختر سائقا يدويا —</option>
      ${drivers.map((d) => `<option value="${d.id}" ${d.id === cur ? "selected" : ""}>${esc(d.name)} ${isOnline(d) ? "● متصل" : "○"}</option>`).join("")}
    </select>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button type="button" class="btn-outline-sm" id="asSave" ${cancelled ? "disabled" : ""}>${cur ? "تغيير السائق" : "تعيين السائق"}</button>
      ${cur ? `<button type="button" class="btn-outline-sm" id="asClear" style="color:#dc2626">إلغاء التعيين</button>` : ""}
    </div>
    ${!drivers.length ? `<p style="font-size:12px;color:#78716c">ما كاين سائقين مفعّلين. فعّلهم من تاب «السائقون».</p>` : ""}
    ${dels.length ? `<div style="margin-top:10px;font-size:13px"><b>حالة التوصيلات:</b>${dels.map((d) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #e5e7eb"><span>${esc(d.date)}</span><span>${esc(DEL_AR[d.status] || d.status)}${d.status === "delivered" && d.cod ? ` · كاش ${money(d.collected)}` : ""}${(d.status === "pickedUp" || d.status === "arrived") && mapLink(d.driverLoc) ? ` · <a target="_blank" rel="noopener" href="${mapLink(d.driverLoc)}">تتبع ${ic("pin")}</a>` : ""}</span></div>`).join("")}</div>` : ""}`;
  box.querySelector("#asAuto").onclick = async () => { const b = box.querySelector("#asAuto"); b.disabled = true; await autoAssignDriver(order); mountAssignDriver(box, order); };
  box.querySelector("#asSave").onclick = async () => {
    const id = box.querySelector("#asDriver").value; if (!id) return ctx.toast("اختر سائقا أولا", "error");
    const d = drivers.find((x) => x.id === id);
    try { await assignTo(order, d, { mode: "manual", at: Date.now() }); ctx.toast("تم تعيين السائق"); mountAssignDriver(box, order); } catch (e) { ctx.toast("تعذر التعيين", "error"); }
  };
  const clr = box.querySelector("#asClear");
  if (clr) clr.onclick = async () => {
    try {
      await updateDoc(doc(db, "orders", order.id), { driverId: deleteField(), driverName: deleteField(), driverPhone: deleteField(), assignedAt: deleteField(), assignedBy: deleteField(), dispatch: deleteField() });
      delete order.driverId; delete order.driverName; delete order.driverPhone; delete order.dispatch;
      ctx.toast("تم إلغاء التعيين"); mountAssignDriver(box, order);
    } catch (e) { ctx.toast("تعذر الإلغاء", "error"); }
  };
}
