// admin-wallets.js — تبويب "محافظ الزبناء": إعدادات المحفظة، مراجعة طلبات الشحن وتحويل النقاط، أرصدة الزبناء، واسترداد الطلبات الملغاة.
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, runTransaction, onSnapshot, query, where, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let ctx = { toast: (m) => alert(m) };
export function initAdminWallets(c) { ctx = { ...ctx, ...c }; }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const r2 = (n) => Math.round(n * 100) / 100;
const dh = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " د.م.";
const PAYN = { card: "بطاقة", cih: "CIH", fellah: "القرض الفلاحي", cashplus: "كاش بلس", wafacash: "وافا كاش", tijari: "التجاري وفا بنك", baridbank: "بريد بنك" };
const DEF = { enabled: false, convertEnabled: true, pointsPerDirham: 10, minPoints: 50, maxPoints: 2000, topupMin: 20, topupMax: 5000 };
const CANCELLED = ["ملغى من طرف الزبون", "ملغى من المشرف", "ملغي"];

let unsubs = [];
export function cleanupWallets() { unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = []; }

/** رصيد المحفظة + كتابة سجل العملية فنفس transaction (القواعد كتتحقق أن مبلغ السجل == الفرق فالرصيد) */
async function credit({ uid, phone, amount, type, txId, note, ref, extra }) {
  const wref = doc(db, "customerWallets", uid), tref = doc(db, "customerTx", txId);
  await runTransaction(db, async (tx) => {
    const w = await tx.get(wref);
    const old = w.exists() ? Number(w.data().balance) || 0 : 0;
    const nb = r2(old + amount);
    if (nb < 0) throw new Error("negative");
    if (extra) await extra(tx);
    tx.set(wref, { balance: nb, updatedAt: serverTimestamp(), lastTx: txId, phone: String(w.exists() ? w.data().phone ?? phone ?? "" : phone ?? "").slice(0, 20) });
    tx.set(tref, { uid, type, amount, note: (note || "").slice(0, 300), ref: ref || "", createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
  });
}

export async function renderWalletsTab(el) {
  cleanupWallets();
  el.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  let cfg = { ...DEF }, wallets = [], refunds = [];
  try {
    const c = await getDoc(doc(db, "config", "walletSettings")); if (c.exists()) cfg = { ...DEF, ...c.data() };
  } catch (e) { el.innerHTML = `<div class="empty">تعذر التحميل. تأكد من نشر firestore.rules الجديدة.</div>`; return; }
  const state = { topups: [], convs: [], filter: "" };

  const loadWallets = async () => {
    try { wallets = (await getDocs(query(collection(db, "customerWallets"), limit(300)))).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.balance || 0) - (a.balance || 0)); } catch (e) { wallets = []; }
    try {
      const os = (await getDocs(query(collection(db, "orders"), where("walletPaid", "==", true), limit(300)))).docs.map((d) => ({ id: d.id, ...d.data() }));
      refunds = os.filter((o) => CANCELLED.includes(o.status) && !o.walletRefunded);
    } catch (e) { refunds = []; }
  };
  await loadWallets();

  const card = (h, body) => `<div style="background:#fff;border-radius:18px;padding:16px;box-shadow:0 2px 10px #0001">${h ? `<h3 style="margin:0 0 10px;color:#064e3b">${h}</h3>` : ""}${body}</div>`;
  const fld = (id, label, v, step = "1") => `<label style="font-size:12.5px;color:#475569;font-weight:700;display:block">${label}<input id="${id}" type="number" step="${step}" value="${esc(v)}" style="width:100%;padding:9px;border:1px solid #d6d3d1;border-radius:10px;margin-top:4px;box-sizing:border-box"></label>`;

  const draw = () => {
    const f = state.filter.trim();
    const ws = wallets.filter((w) => !f || String(w.phone || "").includes(f) || w.id.includes(f));
    const total = wallets.reduce((a, w) => a + (Number(w.balance) || 0), 0);
    el.innerHTML = `<div style="max-width:760px;margin:0 auto;display:grid;gap:16px">
      ${card("⚙️ إعدادات المحفظة", `
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;margin-bottom:8px"><input type="checkbox" id="wsOn" ${cfg.enabled ? "checked" : ""} style="width:20px;height:20px"> تفعيل محفظة الزبناء (شحن + دفع)</label>
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;margin-bottom:12px"><input type="checkbox" id="wsConv" ${cfg.convertEnabled !== false ? "checked" : ""} style="width:20px;height:20px"> السماح بتحويل النقاط إلى رصيد</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
          ${fld("wsRate", "كم نقطة = 1 درهم", cfg.pointsPerDirham)}${fld("wsMin", "أقل نقاط للتحويل", cfg.minPoints)}${fld("wsMax", "أقصى نقاط بالطلب الواحد", cfg.maxPoints)}
          ${fld("wsTMin", "أقل مبلغ شحن (د.م.)", cfg.topupMin)}${fld("wsTMax", "أقصى مبلغ شحن (د.م.)", cfg.topupMax)}
        </div>
        <button class="btn-accept" id="wsSave" type="button" style="padding:9px 18px;margin-top:12px">حفظ الإعدادات</button>
        <p style="font-size:12px;color:#78716c;margin:10px 0 0;line-height:1.7">الزبون يحوّل نقاطه بطلب يراجعه المشرف (الرصيد الحقيقي للنقاط يظهر أمامك). لا يستطيع الزبون زيادة رصيده بنفسه أبداً؛ الزيادة بيدك فقط (شحن/تحويل/استرداد/تعديل).</p>`)}

      ${card(`💳 طلبات الشحن المعلّقة <span id="wsTCount" style="background:#f59e0b;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${state.topups.length || ""}</span>`, `<div id="wsTopups"></div>`)}
      ${card(`⭐ طلبات تحويل النقاط <span id="wsCCount" style="background:#f59e0b;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${state.convs.length || ""}</span>`, `<div id="wsConvs"></div>`)}
      ${refunds.length ? card(`↩️ طلبات ملغاة مدفوعة بالمحفظة (تنتظر الاسترداد) <span style="background:#dc2626;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${refunds.length}</span>`, refunds.map((o) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding:10px 0"><div style="flex:1;min-width:150px"><b dir="ltr">${esc(o.customer?.phone || "")}</b><div style="font-size:12px;color:#78716c">WJ-${esc(o.id.slice(0, 8).toUpperCase())} · ${esc(o.status)} · ${dh(o.total)}</div></div><button class="btn-accept" data-refund="${o.id}" type="button">استرداد ${dh(o.total)}</button></div>`).join("")) : ""}
      ${card(`👛 أرصدة الزبناء <small style="color:#78716c;font-weight:600">(${wallets.length} محفظة · المجموع ${dh(total)})</small>`, `
        <input id="wsFind" type="search" placeholder="بحث برقم الهاتف..." value="${esc(state.filter)}" style="width:100%;padding:9px;border:1px solid #d6d3d1;border-radius:10px;margin-bottom:8px;box-sizing:border-box">
        ${ws.length ? ws.slice(0, 60).map((w) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding:9px 0"><div style="flex:1;min-width:140px"><b dir="ltr">${esc(w.phone || w.id.slice(0, 8))}</b></div><b style="color:#047857;direction:ltr">${dh(w.balance)}</b><button class="btn-outline-sm" data-adj="${w.id}" type="button">تعديل</button></div>`).join("") : `<div style="color:#78716c;font-size:14px">لا توجد محافظ بعد. تُنشأ المحفظة عند أول شحن.</div>`}`)}
    </div>`;
    wire(); drawLists();
  };

  const showReceipt = async (id) => {
    try {
      const s = await getDoc(doc(db, "customerTopupImages", id));
      const m = document.createElement("div");
      m.style.cssText = "position:fixed;inset:0;background:#000c;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
      m.innerHTML = `<img src="${s.data().image}" style="max-width:100%;max-height:100%;border-radius:12px;background:#fff">`;
      m.onclick = () => m.remove(); document.body.appendChild(m);
    } catch (e) { ctx.toast("تعذر تحميل الوصل", "error"); }
  };

  const guard = (fn, okMsg) => async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { await fn(); if (okMsg) ctx.toast(okMsg); await loadWallets(); draw(); }
    catch (e) {
      b.disabled = false;
      if (e?.message === "cancel" || e?.message === "bad") return;
      console.warn(e); ctx.toast(e?.message === "negative" ? "الرصيد لا يمكن أن يصبح سالباً" : "تعذرت العملية", "error");
    }
  };

  const drawLists = () => {
    const tb = el.querySelector("#wsTopups"), cb = el.querySelector("#wsConvs"); if (!tb || !cb) return;
    el.querySelector("#wsTCount").textContent = state.topups.length || ""; el.querySelector("#wsCCount").textContent = state.convs.length || "";
    const age = (v) => (v?.toDate ? v.toDate().toLocaleString("ar-MA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
    tb.innerHTML = state.topups.length ? state.topups.map((t) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding:10px 0">
        <div style="flex:1;min-width:150px"><b dir="ltr">${esc(t.phone)}</b> · <b style="color:#047857">${dh(t.amount)}</b><div style="font-size:12px;color:#78716c">${esc(PAYN[t.method] || t.method)} · ${esc(age(t.createdAt))}</div></div>
        <button class="btn-outline-sm" data-img="${t.id}" type="button">عرض الوصل</button>
        <button class="btn-accept" data-tok="${t.id}" type="button">قبول وشحن</button>
        <button class="btn-danger-sm" data-trej="${t.id}" type="button">رفض</button></div>`).join("") : `<div style="color:#78716c;font-size:14px">لا توجد طلبات شحن.</div>`;
    cb.innerHTML = state.convs.length ? state.convs.map((c) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding:10px 0">
        <div style="flex:1;min-width:150px"><b dir="ltr">${esc(c.phone)}</b> · ${c.points} نقطة ← <b style="color:#047857">${dh(c.amount)}</b>
          <div style="font-size:12px;color:#78716c">${esc(age(c.createdAt))} · <span data-bal="${c.uid}">نقاطه الحالية: ...</span></div></div>
        <button class="btn-accept" data-cok="${c.id}" type="button">قبول</button>
        <button class="btn-danger-sm" data-crej="${c.id}" type="button">رفض وإرجاع النقاط</button></div>`).join("") : `<div style="color:#78716c;font-size:14px">لا توجد طلبات تحويل.</div>`;

    // الرصيد الحقيقي للنقاط (بعد خصم هاد الطلب): إلا كان سالب فالنقاط ما كانتش كافية → غالباً خاصك ترفض
    new Set(state.convs.map((c) => c.uid)).forEach(async (uid) => {
      try {
        const s = await getDocs(query(collection(db, "pointsLog"), where("uid", "==", uid)));
        const bal = s.docs.reduce((a, d) => a + (Number(d.data().points) || 0), 0);
        el.querySelectorAll(`[data-bal="${uid}"]`).forEach((n) => { n.textContent = `نقاطه بعد الخصم: ${bal}`; n.style.color = bal < 0 ? "#dc2626" : "#047857"; n.style.fontWeight = "800"; if (bal < 0) n.textContent += " ⚠ غير كافية"; });
      } catch (e) {}
    });

    el.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => showReceipt(b.dataset.img)));
    el.querySelectorAll("[data-tok]").forEach((b) => (b.onclick = guard(async () => {
      const t = state.topups.find((x) => x.id === b.dataset.tok);
      await credit({ uid: t.uid, phone: t.phone, amount: t.amount, type: "topup", txId: "top_" + t.id, note: "شحن عبر " + (PAYN[t.method] || t.method), ref: t.id,
        extra: async (tx) => { tx.update(doc(db, "customerTopups", t.id), { status: "approved", reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid }); } });
    }, "تم شحن المحفظة")));
    el.querySelectorAll("[data-trej]").forEach((b) => (b.onclick = guard(async () => {
      const note = prompt("سبب الرفض (يظهر للزبون):", "") ?? null; if (note === null) throw new Error("cancel");
      await updateDoc(doc(db, "customerTopups", b.dataset.trej), { status: "rejected", adminNote: note.slice(0, 300), reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid });
    }, "تم الرفض")));
    el.querySelectorAll("[data-cok]").forEach((b) => (b.onclick = guard(async () => {
      const c = state.convs.find((x) => x.id === b.dataset.cok);
      await credit({ uid: c.uid, phone: c.phone, amount: c.amount, type: "points", txId: "cv_" + c.id, note: `تحويل ${c.points} نقطة`, ref: c.id,
        extra: async (tx) => { tx.update(doc(db, "pointsConversions", c.id), { status: "approved", reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid }); } });
    }, "تم تحويل النقاط وشحن المحفظة")));
    el.querySelectorAll("[data-crej]").forEach((b) => (b.onclick = guard(async () => {
      const c = state.convs.find((x) => x.id === b.dataset.crej);
      const note = prompt("سبب الرفض (يظهر للزبون):", "") ?? null; if (note === null) throw new Error("cancel");
      const bt = writeBatch(db);
      bt.update(doc(db, "pointsConversions", c.id), { status: "rejected", adminNote: note.slice(0, 300), reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid });
      bt.set(doc(db, "pointsLog", "convrej_" + c.id), { uid: c.uid, points: c.points, reason: "إرجاع نقاط: رفض طلب التحويل", orderId: null, createdAt: serverTimestamp() });
      await bt.commit();
    }, "تم الرفض وإرجاع النقاط")));
  };

  const wire = () => {
    el.querySelector("#wsSave").onclick = async () => {
      const n = (id) => Number(el.querySelector("#" + id).value);
      const data = { enabled: el.querySelector("#wsOn").checked, convertEnabled: el.querySelector("#wsConv").checked, pointsPerDirham: n("wsRate"), minPoints: n("wsMin"), maxPoints: n("wsMax"), topupMin: n("wsTMin"), topupMax: n("wsTMax"), updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid };
      if (!(data.pointsPerDirham >= 1 && data.minPoints >= 1 && data.maxPoints >= data.minPoints && data.topupMin >= 1 && data.topupMax >= data.topupMin)) { ctx.toast("تحقق من القيم (الحد الأقصى ≥ الأدنى وكلها موجبة)", "error"); return; }
      try { await setDoc(doc(db, "config", "walletSettings"), data); cfg = { ...cfg, ...data }; ctx.toast("تم الحفظ"); } catch (e) { console.warn(e); ctx.toast("تعذر الحفظ", "error"); }
    };
    el.querySelector("#wsFind").oninput = (e) => { state.filter = e.target.value; const pos = e.target.selectionStart; draw(); const i = el.querySelector("#wsFind"); i.focus(); i.setSelectionRange(pos, pos); };
    el.querySelectorAll("[data-refund]").forEach((b) => (b.onclick = guard(async () => {
      const o = refunds.find((x) => x.id === b.dataset.refund);
      await credit({ uid: o.uid, phone: o.customer?.phone, amount: r2(o.total), type: "refund", txId: "refund_" + o.id, note: "استرداد طلب ملغى WJ-" + o.id.slice(0, 8).toUpperCase(), ref: o.id,
        extra: async (tx) => { tx.update(doc(db, "orders", o.id), { walletRefunded: true }); } });
    }, "تم الاسترداد إلى المحفظة")));
    el.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = guard(async () => {
      const w = wallets.find((x) => x.id === b.dataset.adj);
      const v = prompt(`تعديل رصيد ${w.phone || ""} (الرصيد الحالي ${dh(w.balance)}).\nأدخل مبلغاً موجباً للإضافة أو سالباً للخصم:`, ""); if (v === null) throw new Error("cancel");
      const amount = r2(Number(v)); if (!amount || !isFinite(amount)) throw new Error("bad");
      const note = prompt("ملاحظة (سبب التعديل):", "") ?? ""; 
      await credit({ uid: w.id, phone: w.phone, amount, type: "adjust", txId: "adj_" + w.id + "_" + Date.now().toString(36), note, ref: "" });
    }, "تم تعديل الرصيد")));
  };

  draw();
  unsubs.push(onSnapshot(query(collection(db, "customerTopups"), where("status", "==", "pending"), limit(100)), (s) => {
    if (!el.querySelector("#wsTopups")) { cleanupWallets(); return; }
    state.topups = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)); drawLists();
  }, (e) => console.warn(e)));
  unsubs.push(onSnapshot(query(collection(db, "pointsConversions"), where("status", "==", "pending"), limit(100)), (s) => {
    if (!el.querySelector("#wsConvs")) { cleanupWallets(); return; }
    state.convs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)); drawLists();
  }, (e) => console.warn(e)));
}
