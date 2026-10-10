// admin-verify.js — تبويب "التحقق عبر واتساب" فلوحة المشرف:
//  1) إعدادات (تشغيل/إيقاف + رقم واتساب المشرف)   2) مخزن رموز من 6 أرقام   3) طلبات التحقق المعلّقة (إرسال الرمز بواتساب بضغطة)
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, onSnapshot,
  query, where, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let ctx = { toast: (m) => alert(m) };
export function initAdminVerify(c) { ctx = { ...ctx, ...c }; }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const CODE_RE = /^\d{6}$/;
// رقم دولي لواتساب (بدون + أو 00): 06XXXXXXXX → 212 6XXXXXXXX
const waNum = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("0")) d = "212" + d.slice(1); return d; };

let unsub = null;
export function cleanupVerify() { try { unsub?.(); } catch (e) {} unsub = null; }

export async function renderVerifyTab(el) {
  cleanupVerify();
  el.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  let cfg = { enabled: false, auto: false, number: "" }, codes = [];
  try {
    const c = await getDoc(doc(db, "config", "whatsappVerify")); if (c.exists()) cfg = { ...cfg, ...c.data() };
    codes = (await getDocs(query(collection(db, "verifyCodes"), limit(1000)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn(e); el.innerHTML = `<div class="empty">تعذر التحميل. تأكد من نشر firestore.rules الجديدة.</div>`; return; }

  let pending = [];
  const free = () => codes.filter((c) => !c.assignedTo);

  const draw = () => {
    el.innerHTML = `
    <div style="max-width:720px;margin:0 auto;display:grid;gap:16px">
      <div class="pcard" style="background:#fff;border-radius:18px;padding:16px;box-shadow:0 2px 10px #0001">
        <h3 style="margin:0 0 10px;color:#064e3b">⚙️ الإعدادات</h3>
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;margin-bottom:10px"><input type="checkbox" id="vEnabled" ${cfg.enabled ? "checked" : ""} style="width:20px;height:20px"> تفعيل التحقق برقم الهاتف للمسجّلين الجدد</label>
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;margin-bottom:10px"><input type="checkbox" id="vAuto" ${cfg.auto ? "checked" : ""} style="width:20px;height:20px"> إرسال الرمز تلقائياً عبر واتساب (يتطلب الدالة السحابية WhatsApp API)</label>
        <label style="font-size:13px;color:#475569;font-weight:700">رقم واتساب المشرف (مع رمز الدولة، مثال: 212612345678)</label>
        <input id="vNumber" type="tel" dir="ltr" value="${esc(cfg.number)}" placeholder="212612345678" style="width:100%;padding:10px;border:1px solid #d6d3d1;border-radius:10px;margin:6px 0 10px">
        <button class="btn-accept" id="vSave" type="button" style="padding:9px 18px">حفظ الإعدادات</button>
        <p style="font-size:12px;color:#78716c;margin:10px 0 0;line-height:1.7">الزبون الجديد يُطلب منه إدخال رمز من 6 أرقام يصله على واتساب قبل متابعة التسجيل. الحسابات القديمة لا تتأثر. رقم المشرف يظهر للزبون في زر «اطلب الرمز عبر واتساب».</p>
      </div>

      <div class="pcard" style="background:#fff;border-radius:18px;padding:16px;box-shadow:0 2px 10px #0001">
        <h3 style="margin:0 0 4px;color:#064e3b">🔢 مخزن الرموز</h3>
        <div style="font-size:13px;color:#475569;margin-bottom:10px">متاح: <b style="color:${free().length < 5 ? "#dc2626" : "#047857"}">${free().length}</b> · مُستعمل/مُعيَّن: <b>${codes.length - free().length}</b></div>
        <textarea id="vCodes" rows="3" dir="ltr" placeholder="أدخل رموزاً من 6 أرقام، افصل بينها بمسافة أو سطر جديد&#10;482915 730264 118853" style="width:100%;padding:10px;border:1px solid #d6d3d1;border-radius:10px;font-family:monospace;letter-spacing:2px"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <button class="btn-accept" id="vAdd" type="button" style="padding:9px 18px">إضافة الرموز</button>
          <span style="color:#78716c;font-size:13px">أو</span>
          <input id="vGenN" type="number" min="1" max="200" value="20" style="width:80px;padding:8px;border:1px solid #d6d3d1;border-radius:10px">
          <button class="btn-outline-sm" id="vGen" type="button">توليد رموز عشوائية</button>
        </div>
        <div id="vList" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${free().map((c) => `<span style="background:#ecfdf5;color:#065f46;border-radius:10px;padding:4px 8px;font:800 13px monospace;display:inline-flex;gap:6px;align-items:center" dir="ltr">${esc(c.code)}<button type="button" data-del="${c.id}" title="حذف" style="border:0;background:none;color:#dc2626;cursor:pointer;font-weight:900">×</button></span>`).join("") || `<span style="color:#78716c;font-size:13px">لا توجد رموز متاحة — أضف رموزاً.</span>`}</div>
      </div>

      <div class="pcard" style="background:#fff;border-radius:18px;padding:16px;box-shadow:0 2px 10px #0001">
        <h3 style="margin:0 0 10px;color:#064e3b">📲 طلبات التحقق المعلّقة <span id="vCount" style="background:#f59e0b;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px"></span></h3>
        <div id="vPending"></div>
      </div>
    </div>`;
    wire(); drawPending();
  };

  const drawPending = () => {
    const box = el.querySelector("#vPending"); if (!box) return;
    el.querySelector("#vCount").textContent = pending.length || "";
    box.innerHTML = pending.length ? pending.map((p) => {
      const code = p.codeId ? codes.find((c) => c.id === p.codeId)?.code : null;
      const t = p.requestedAt?.toDate ? p.requestedAt.toDate().toLocaleTimeString("ar-MA", { hour: "2-digit", minute: "2-digit" }) : "";
      return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding:10px 0">
        <div style="flex:1;min-width:150px"><b dir="ltr">${esc(p.phone)}</b><div style="font-size:12px;color:#78716c">طلب ${esc(t)} ${code ? `· الرمز: <b dir="ltr" style="font-family:monospace">${esc(code)}</b>` : ""}</div>${p.sendError ? `<div style="font-size:12px;color:#dc2626;margin-top:2px" dir="auto">فشل الإرسال التلقائي: ${esc(p.sendError)}</div>` : cfg.auto && p.sentAt ? `<div style="font-size:12px;color:#047857;margin-top:2px">أُرسل تلقائياً ✓ (${esc(p.sentVia || "")})</div>` : cfg.auto ? `<div style="font-size:12px;color:#b45309;margin-top:2px">قيد الإرسال التلقائي...</div>` : ""}</div>
        <button class="btn-accept" type="button" data-send="${p.id}" style="background:#25d366">${code ? "إعادة الإرسال بواتساب" : "إرسال الرمز بواتساب"}</button>
        <button class="btn-outline-sm" type="button" data-manual="${p.id}">تفعيل بدون رمز</button>
      </div>`;
    }).join("") : `<div style="color:#78716c;font-size:14px">لا توجد طلبات حالياً. تظهر هنا فور تسجيل زبون جديد.</div>`;
    box.querySelectorAll("[data-send]").forEach((b) => (b.onclick = () => sendCode(pending.find((x) => x.id === b.dataset.send), b)));
    box.querySelectorAll("[data-manual]").forEach((b) => (b.onclick = async () => {
      if (!confirm("تفعيل هذا الرقم بدون رمز؟")) return;
      try { await updateDoc(doc(db, "phoneVerifications", b.dataset.manual), { status: "verified", verifiedAt: serverTimestamp(), manual: true }); ctx.toast("تم التفعيل"); }
      catch (e) { ctx.toast("تعذر التفعيل", "error"); }
    }));
  };

  async function sendCode(p, btn) {
    if (!p) return;
    // نفتح واتساب فورا (قبل أي await) باش المتصفح ما يحجبش النافذة، ثم نحدّث الرابط بعد تعيين الرمز
    const w = window.open("about:blank", "_blank");
    btn.disabled = true;
    try {
      let code = p.codeId ? codes.find((c) => c.id === p.codeId)?.code : null;
      if (!code) {
        const cands = free().slice(0, 12);
        if (!cands.length) { w?.close(); ctx.toast("نفدت الرموز المتاحة — أضف رموزاً جديدة", "error"); return; }
        const pvRef = doc(db, "phoneVerifications", p.id);
        const got = await runTransaction(db, async (tx) => {
          const pv = await tx.get(pvRef);
          if (pv.data()?.codeId) return { id: pv.data().codeId };
          let pick = null;
          for (const c of cands) { const s = await tx.get(doc(db, "verifyCodes", c.id)); if (s.exists() && !s.data().assignedTo) { pick = { id: c.id, code: s.data().code }; break; } }
          if (!pick) throw new Error("no-code");
          tx.update(doc(db, "verifyCodes", pick.id), { assignedTo: p.id, assignedAt: serverTimestamp() });
          tx.update(pvRef, { codeId: pick.id, sentAt: serverTimestamp() });
          return pick;
        });
        const local = codes.find((c) => c.id === got.id);
        if (local) local.assignedTo = p.id;
        code = got.code || local?.code;
      }
      const msg = `وجبتنا 🍽️\nرمز التحقق الخاص بك: ${code}\nأدخله في الموقع لتأكيد رقم هاتفك. لا تشاركه مع أحد.`;
      const url = `https://wa.me/${waNum(p.phone)}?text=${encodeURIComponent(msg)}`;
      if (w) w.location.href = url; else window.location.href = url;
      draw();
    } catch (e) { w?.close(); console.warn(e); ctx.toast("تعذر تعيين الرمز", "error"); }
    finally { btn.disabled = false; }
  }

  function wire() {
    el.querySelector("#vSave").onclick = async () => {
      const number = el.querySelector("#vNumber").value.replace(/[^\d]/g, "");
      const enabled = el.querySelector("#vEnabled").checked, auto = el.querySelector("#vAuto").checked;
      if (number && number.length < 9) { ctx.toast("رقم واتساب غير صحيح", "error"); return; }
      try {
        const stamp = enabled && !cfg.enabled; // تشغيل جديد → الحسابات المسجلة بعده فقط هي المعنية
        const data = { enabled, auto, number, enabledAt: stamp || !cfg.enabledAt ? serverTimestamp() : cfg.enabledAt, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid };
        await setDoc(doc(db, "config", "whatsappVerify"), data);
        cfg = { ...cfg, enabled, auto, number, enabledAt: stamp || !cfg.enabledAt ? new Date() : cfg.enabledAt };
        ctx.toast("تم الحفظ");
      } catch (e) { console.warn(e); ctx.toast("تعذر الحفظ", "error"); }
    };
    const addCodes = async (list) => {
      const have = new Set(codes.map((c) => c.code));
      const fresh = [...new Set(list)].filter((c) => CODE_RE.test(c) && !have.has(c));
      if (!fresh.length) { ctx.toast("لا توجد رموز جديدة صالحة (6 أرقام، بدون تكرار)", "error"); return; }
      try {
        for (let i = 0; i < fresh.length; i += 400) {
          const b = writeBatch(db);
          fresh.slice(i, i + 400).forEach((code) => b.set(doc(collection(db, "verifyCodes")), { code, assignedTo: null, createdAt: serverTimestamp() }));
          await b.commit();
        }
        codes = (await getDocs(query(collection(db, "verifyCodes"), limit(1000)))).docs.map((d) => ({ id: d.id, ...d.data() }));
        ctx.toast(`تمت إضافة ${fresh.length} رمز`); draw();
      } catch (e) { console.warn(e); ctx.toast("تعذرت الإضافة", "error"); }
    };
    el.querySelector("#vAdd").onclick = () => addCodes(el.querySelector("#vCodes").value.split(/[\s,;،]+/).filter(Boolean));
    el.querySelector("#vGen").onclick = () => {
      const n = Math.min(200, Math.max(1, +el.querySelector("#vGenN").value || 20)), out = [], buf = new Uint32Array(n * 2);
      crypto.getRandomValues(buf); for (let i = 0; i < n; i++) out.push(String(100000 + (buf[i] % 900000)));
      addCodes(out);
    };
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      try { await deleteDoc(doc(db, "verifyCodes", b.dataset.del)); codes = codes.filter((c) => c.id !== b.dataset.del); draw(); } catch (e) { ctx.toast("تعذر الحذف", "error"); }
    }));
  }

  draw();
  unsub = onSnapshot(query(collection(db, "phoneVerifications"), where("status", "==", "pending"), limit(100)), (snap) => {
    if (!el.querySelector("#vPending")) { cleanupVerify(); return; }
    pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.requestedAt?.toMillis?.() || 0) - (a.requestedAt?.toMillis?.() || 0));
    drawPending();
  }, (e) => console.warn("phoneVerifications", e));
}
