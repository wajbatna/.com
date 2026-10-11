// wallet.js — محفظة الزبون: رصيد، شحن بوصل تحويل (يراجعه المشرف)، تحويل النقاط إلى رصيد (يراجعه المشرف)، والدفع بالمحفظة عند الطلب.
// الأمان فـ firestore.rules: الزبون ما كيقدر يزيد فرصيدو أبداً، غير كينقص منو وهو كيدفع طلب بنفس مبلغو.
import {
  collection, doc, getDoc, onSnapshot, query, where, writeBatch, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { compressReceiptImage } from "./receipts.js";

export const WS = { settings: null, balance: 0, walletReady: false };
let C = null, unsubs = [], data = { tx: [], topups: [], convs: [] }, pts = { balance: 0 }, show = true, sheet = "home";

const T = {
  ar: {
    title: "محفظتي", bal: "الرصيد المتاح", hide: "إخفاء/إظهار الرصيد", topup: "شحن المحفظة", convert: "تحويل النقاط", myPts: "نقاطي", ptsHint: (r) => `${r} نقطة = 1 درهم`,
    activity: "آخر العمليات", none: "لا توجد عمليات بعد.", off: "المحفظة غير متاحة حالياً.", login: "سجّل الدخول لاستعمال المحفظة.",
    types: { topup: "شحن المحفظة", points: "تحويل نقاط", order: "دفع طلب", refund: "استرداد", adjust: "تعديل من الإدارة" },
    st: { pending: "قيد المراجعة", rejected: "مرفوض", approved: "مقبول" }, topupReq: "طلب شحن", convReq: "طلب تحويل نقاط",
    amount: "المبلغ (درهم)", method: "طريقة التحويل", rib: "الرقم / RIB", holder: "اسم المستفيد", copy: "نسخ", copied: "تم النسخ", receipt: "وصل التحويل",
    pick: "صوّر أو اختر صورة الوصل", send: "إرسال للمراجعة", back: "رجوع", close: "إغلاق",
    amtErr: (a, b) => `المبلغ يجب أن يكون بين ${a} و ${b} درهم.`, noMethod: "لا توجد طريقة تحويل متاحة الآن.", needImg: "أضف صورة وصل التحويل.", badImg: "الصورة غير صالحة أو كبيرة جداً.",
    topupOk: "تم إرسال الوصل. ستُشحن محفظتك بعد مراجعة الإدارة.", topupNote: "حوّل المبلغ ثم ارفع صورة الوصل. تُضاف القيمة لمحفظتك بعد موافقة الإدارة.",
    cvTitle: "تحويل النقاط إلى رصيد", cvAvail: "نقاطك المتاحة", cvPts: "عدد النقاط", cvGet: "ستحصل على", cvMin: (n) => `الحد الأدنى ${n} نقطة`, cvMax: "الكل",
    cvNote: "تُخصم النقاط فوراً وتُضاف القيمة لمحفظتك بعد موافقة الإدارة. في حال الرفض تعود النقاط إليك.", cvBtn: "تأكيد التحويل", cvOk: "تم إرسال طلب التحويل. ستُضاف القيمة بعد موافقة الإدارة.",
    cvLow: (n) => `تحتاج ${n} نقطة على الأقل للتحويل.`, cvOff: "تحويل النقاط متوقف مؤقتاً.", err: "تعذرت العملية، حاول مرة أخرى.", pointsUnit: "نقطة", dh: "د.م.",
    payWallet: "الدفع من المحفظة", insufficient: "رصيد المحفظة غير كافٍ", balanceLbl: "رصيدك",
  },
  fr: {
    title: "Mon portefeuille", bal: "Solde disponible", hide: "Afficher/masquer le solde", topup: "Recharger", convert: "Convertir mes points", myPts: "Mes points", ptsHint: (r) => `${r} points = 1 DH`,
    activity: "Dernières opérations", none: "Aucune opération pour le moment.", off: "Portefeuille indisponible pour le moment.", login: "Connectez-vous pour utiliser le portefeuille.",
    types: { topup: "Recharge", points: "Conversion de points", order: "Paiement de commande", refund: "Remboursement", adjust: "Ajustement" },
    st: { pending: "En cours de vérification", rejected: "Refusé", approved: "Accepté" }, topupReq: "Demande de recharge", convReq: "Demande de conversion",
    amount: "Montant (DH)", method: "Mode de virement", rib: "RIB / numéro", holder: "Bénéficiaire", copy: "Copier", copied: "Copié", receipt: "Reçu de virement",
    pick: "Photographier ou choisir le reçu", send: "Envoyer pour vérification", back: "Retour", close: "Fermer",
    amtErr: (a, b) => `Le montant doit être entre ${a} et ${b} DH.`, noMethod: "Aucun mode de virement disponible.", needImg: "Ajoutez la photo du reçu.", badImg: "Image invalide ou trop lourde.",
    topupOk: "Reçu envoyé. Votre portefeuille sera crédité après vérification.", topupNote: "Effectuez le virement puis envoyez la photo du reçu. Le montant est crédité après validation.",
    cvTitle: "Convertir les points en solde", cvAvail: "Vos points disponibles", cvPts: "Nombre de points", cvGet: "Vous recevrez", cvMin: (n) => `Minimum ${n} points`, cvMax: "Tout",
    cvNote: "Les points sont déduits immédiatement et le montant est crédité après validation. En cas de refus, les points vous sont rendus.", cvBtn: "Confirmer la conversion", cvOk: "Demande envoyée. Le montant sera crédité après validation.",
    cvLow: (n) => `Il faut au moins ${n} points pour convertir.`, cvOff: "La conversion est temporairement suspendue.", err: "Opération impossible, réessayez.", pointsUnit: "pts", dh: "DH",
    payWallet: "Payer avec le portefeuille", insufficient: "Solde insuffisant", balanceLbl: "Votre solde",
  },
};
const PAY = [
  ["card", "دفع ببطاقة", "img/icons/paiement.webp"], ["cih", "CIH", "img/payments/cih.png"], ["fellah", "القرض الفلاحي", "img/payments/fellah.jpg"],
  ["cashplus", "Cash Plus", "img/payments/cashplus.jpg"], ["wafacash", "Wafacash", "img/payments/wafacash.jpg"], ["tijari", "Attijariwafa", "img/payments/tijari.jpg"], ["baridbank", "Al Barid Bank", "img/payments/baridbank.jpg"],
];
const CSS = `
#walletModal .modal-box{max-width:480px}
.wl-card{position:relative;overflow:hidden;border-radius:24px;padding:22px 20px 18px;color:#fff;background:radial-gradient(120% 140% at 90% -10%,#10b98155 0,transparent 55%),linear-gradient(135deg,#022c22 0,#064e3b 55%,#047857 100%);box-shadow:0 14px 34px #022c2255}
.wl-card:before{content:"";position:absolute;inset:auto -40px -60px auto;width:180px;height:180px;border-radius:50%;border:30px solid #ffffff0d}
.wl-top{display:flex;justify-content:space-between;align-items:center;font-size:13px;opacity:.85;font-weight:700}
.wl-eye{border:0;background:#ffffff1f;color:#fff;border-radius:12px;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.wl-amt{font:900 38px/1.2 system-ui;letter-spacing:.5px;margin:10px 0 2px;direction:ltr;text-align:start}
.wl-amt small{font-size:15px;font-weight:700;opacity:.85;margin-inline-start:6px}
.wl-pts{display:inline-flex;align-items:center;gap:6px;background:#ffffff1f;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:800;margin-top:6px}
.wl-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 6px}
.wl-act{border:0;border-radius:18px;padding:14px 8px;background:#f0fdf4;color:#064e3b;font:800 13.5px inherit;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;transition:transform .12s,box-shadow .12s}
.wl-act:active{transform:scale(.97)}
.wl-act svg{width:26px;height:26px;stroke:#059669;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wl-act:disabled{opacity:.45}
.wl-h{margin:18px 2px 8px;font-weight:900;color:#064e3b;font-size:15px}
.wl-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid #f1f5f9}
.wl-ic{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px}
.wl-ic.in{background:#ecfdf5;color:#059669}.wl-ic.out{background:#fef2f2;color:#dc2626}.wl-ic.wait{background:#fffbeb;color:#d97706}
.wl-m{flex:1;min-width:0}.wl-m b{display:block;font-size:14px;color:#1c1917}.wl-m small{color:#78716c;font-size:12px}
.wl-v{font-weight:900;font-size:14px;direction:ltr;white-space:nowrap}
.wl-chip{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800;background:#fef3c7;color:#b45309;margin-inline-start:6px}
.wl-chip.bad{background:#fee2e2;color:#b91c1c}
.wl-quick{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.wl-quick button,.wl-meth{border:1.5px solid #d6d3d1;background:#fff;border-radius:12px;padding:8px 14px;font:800 13px inherit;font-family:inherit;cursor:pointer;color:#064e3b}
.wl-meth{display:flex;align-items:center;gap:6px}.wl-meth img{width:22px;height:22px;object-fit:contain;border-radius:6px}
.wl-meth.on,.wl-quick button.on{border-color:#059669;background:#ecfdf5}
.wl-in{width:100%;padding:13px;border:1.5px solid #d6d3d1;border-radius:14px;font:800 20px system-ui;direction:ltr;text-align:center;box-sizing:border-box}
.wl-upl{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:2px dashed #a7f3d0;border-radius:16px;min-height:110px;color:#047857;font-weight:800;font-size:13px;cursor:pointer;overflow:hidden;background:#f0fdf4}
.wl-upl img{max-width:100%;max-height:200px}
.wl-copy{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#f8fafc;border-radius:12px;padding:8px 12px;margin-top:6px}
.wl-copy small{display:block;color:#78716c;font-size:11px}.wl-copy b{font-size:13px;word-break:break-all}
.wl-copy button{border:0;background:#064e3b;color:#fff;border-radius:10px;padding:6px 12px;font:800 12px inherit;font-family:inherit;cursor:pointer}
.wl-prev{background:#ecfdf5;border-radius:16px;padding:14px;text-align:center;margin:12px 0}
.wl-prev b{font-size:26px;color:#047857;display:block;direction:ltr}
.wl-err{color:#dc2626;font-size:13px;font-weight:700;margin-top:8px;min-height:18px}
.wl-note{font-size:12.5px;color:#57534e;background:#fffbeb;border-radius:12px;padding:10px 12px;line-height:1.7;margin:10px 0}
.wl-range{width:100%;accent-color:#059669;margin:10px 0}
.wl-go{width:100%;border:0;border-radius:16px;padding:14px;background:#059669;color:#fff;font:900 16px inherit;font-family:inherit;cursor:pointer;margin-top:10px}
.wl-go:disabled{opacity:.5}.wl-go.ghost{background:#f1f5f9;color:#475569}
.wl-skel{height:12px;border-radius:6px;background:linear-gradient(90deg,#ffffff22,#ffffff55,#ffffff22);background-size:200% 100%;animation:wlSk 1.2s infinite}
@keyframes wlSk{to{background-position:-200% 0}}
`;

const L = () => T[C.lang()] || T.ar;
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number(n) || 0).toLocaleString(C.lang() === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (v) => { const d = v?.toDate ? v.toDate() : new Date(); return d.toLocaleDateString(C.lang() === "fr" ? "fr-FR" : "ar-MA", { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(C.lang() === "fr" ? "fr-FR" : "ar-MA", { hour: "2-digit", minute: "2-digit" }); };
const ms = (v) => (v?.toMillis ? v.toMillis() : Date.now());

export function initWallet(ctx) {
  C = ctx;
  if (!document.getElementById("wlStyle")) { const s = document.createElement("style"); s.id = "wlStyle"; s.textContent = CSS; document.head.appendChild(s); }
  getDoc(doc(C.db, "config", "walletSettings")).then((d) => { WS.settings = d.exists() ? d.data() : null; WS.walletReady = true; C.onChange?.(); }).catch(() => { WS.walletReady = true; });
}
export const walletOn = () => !!WS.settings?.enabled;

export function walletWatch(user) {
  walletUnwatch();
  if (!user) return;
  const q = (name) => query(collection(C.db, name), where("uid", "==", user.uid));
  unsubs.push(onSnapshot(doc(C.db, "customerWallets", user.uid), (d) => { WS.balance = d.exists() ? Number(d.data().balance) || 0 : 0; C.onChange?.(); render(); }, () => {}));
  unsubs.push(onSnapshot(q("customerTx"), (s) => { data.tx = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, () => {}));
  unsubs.push(onSnapshot(q("customerTopups"), (s) => { data.topups = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, () => {}));
  unsubs.push(onSnapshot(q("pointsConversions"), (s) => { data.convs = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, () => {}));
}
export function walletUnwatch() { unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = []; WS.balance = 0; data = { tx: [], topups: [], convs: [] }; }

/** يدفع الطلب من المحفظة ويخلق الطلب فنفس العملية. كيرجع { id } */
export async function placeWalletOrder(order) {
  const user = C.user(), db = C.db;
  const orderRef = doc(collection(db, "orders")), txRef = doc(db, "customerTx", "ord_" + orderRef.id), wRef = doc(db, "customerWallets", user.uid);
  await runTransaction(db, async (tx) => {
    const w = await tx.get(wRef);
    const bal = w.exists() ? Number(w.data().balance) || 0 : 0;
    if (bal + 0.0001 < order.total) throw new Error("insufficient");
    tx.set(orderRef, { ...order, walletPaid: true });
    tx.set(txRef, { uid: user.uid, type: "order", amount: -order.total, note: "", ref: orderRef.id, createdAt: serverTimestamp() });
    tx.update(wRef, { balance: r2(bal - order.total), updatedAt: serverTimestamp(), lastTx: txRef.id });
  });
  return { id: orderRef.id };
}

/* ───────────── الواجهة ───────────── */
function host() { return document.getElementById("walletContent"); }
export async function openWallet() {
  const t = L();
  if (!C.user()) { C.openAccount(); return; }
  if (!document.getElementById("walletModal")) {
    const m = document.createElement("div"); m.className = "modal"; m.id = "walletModal";
    m.innerHTML = `<div class="modal-box" id="walletContent" role="dialog" aria-modal="true"></div>`;
    m.addEventListener("click", (e) => { if (e.target === m) closeWallet(); });
    document.body.appendChild(m);
  }
  if (!WS.settings) { try { const d = await getDoc(doc(C.db, "config", "walletSettings")); WS.settings = d.exists() ? d.data() : null; } catch (e) {} }
  sheet = "home";
  document.getElementById("walletModal").classList.add("show");
  host().innerHTML = `<div class="wl-card"><div class="wl-skel" style="width:40%"></div><div class="wl-skel" style="height:34px;width:70%;margin-top:14px"></div></div>`;
  walletWatch(C.user());
  refreshPoints();
  render();
}
export function closeWallet() { document.getElementById("walletModal")?.classList.remove("show"); }
async function refreshPoints() { try { const s = await C.fetchPointsSummary(C.user().uid); pts = { balance: Math.max(0, s.balance) }; render(); } catch (e) {} }

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.5 7.6C3.9 9.4 2 12 2 12s3.6 6 10 6a9.4 9.4 0 0 0 4-.9"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
};

function render() {
  const el = host(); if (!el || !document.getElementById("walletModal")?.classList.contains("show")) return;
  if (sheet !== "home") return; // الشاشات الفرعية كترسم راسها
  const t = L(), S = WS.settings;
  const close = `<div class="modal-head"><h3>${t.title}</h3><button class="close" onclick="closeWallet()" aria-label="${t.close}">✕</button></div>`;
  if (!S?.enabled) { el.innerHTML = close + `<div class="empty" style="padding:30px 10px">${t.off}</div>`; return; }
  const rate = S.pointsPerDirham;
  const acts = [];
  data.tx.forEach((x) => acts.push({ k: "tx", t: ms(x.createdAt), x }));
  data.topups.filter((x) => x.status !== "approved").forEach((x) => acts.push({ k: "topup", t: ms(x.createdAt), x }));
  data.convs.filter((x) => x.status !== "approved").forEach((x) => acts.push({ k: "conv", t: ms(x.createdAt), x }));
  acts.sort((a, b) => b.t - a.t);
  const row = (a) => {
    const x = a.x;
    if (a.k === "tx") {
      const pos = x.amount >= 0;
      return `<div class="wl-row"><div class="wl-ic ${pos ? "in" : "out"}">${pos ? "↓" : "↑"}</div><div class="wl-m"><b>${t.types[x.type] || x.type}</b><small>${when(x.createdAt)}${x.note ? " · " + C.esc(x.note) : ""}</small></div><div class="wl-v" style="color:${pos ? "#059669" : "#dc2626"}">${pos ? "+" : "−"}${fmt(Math.abs(x.amount))}</div></div>`;
    }
    const topup = a.k === "topup", bad = x.status === "rejected";
    return `<div class="wl-row"><div class="wl-ic wait">${topup ? "⏳" : "★"}</div><div class="wl-m"><b>${topup ? t.topupReq : t.convReq}<span class="wl-chip ${bad ? "bad" : ""}">${t.st[x.status] || x.status}</span></b><small>${when(x.createdAt)}${x.adminNote ? " · " + C.esc(x.adminNote) : ""}${topup ? "" : " · " + x.points + " " + t.pointsUnit}</small></div><div class="wl-v" style="color:#78716c">${topup ? "+" : "≈ +"}${fmt(x.amount)}</div></div>`;
  };
  el.innerHTML = close + `
    <div class="wl-card">
      <div class="wl-top"><span>${t.bal}</span><button class="wl-eye" id="wlEye" type="button" aria-label="${t.hide}" aria-pressed="${show}">${show ? ICON.eye : ICON.eyeOff}</button></div>
      <div class="wl-amt" id="wlAmt">${show ? fmt(WS.balance) : "••••••"}<small>${t.dh}</small></div>
      <div class="wl-pts">${ICON.star.replace("<svg", '<svg style="width:16px;height:16px;stroke:#fde68a;fill:none;stroke-width:2"')} ${t.myPts}: <b>${pts.balance}</b> ${t.pointsUnit} · ${t.ptsHint(rate)}</div>
    </div>
    <div class="wl-actions">
      <button class="wl-act" id="wlTopup" type="button">${ICON.plus}<span>${t.topup}</span></button>
      <button class="wl-act" id="wlConv" type="button" ${S.convertEnabled === false ? "disabled" : ""}>${ICON.swap}<span>${t.convert}</span></button>
    </div>
    <div class="wl-h">${t.activity}</div>
    ${acts.length ? acts.slice(0, 30).map(row).join("") : `<div class="empty" style="padding:22px">${t.none}</div>`}`;
  el.querySelector("#wlEye").onclick = () => { show = !show; render(); };
  el.querySelector("#wlTopup").onclick = openTopup;
  el.querySelector("#wlConv").onclick = openConvert;
}

function sub(title, html) {
  const t = L();
  host().innerHTML = `<div class="modal-head"><h3>${title}</h3><button class="close" id="wlBack" aria-label="${t.back}">✕</button></div>${html}`;
  host().querySelector("#wlBack").onclick = () => { sheet = "home"; render(); };
  host().scrollTop = 0;
}

async function openTopup() {
  const t = L(), S = WS.settings; sheet = "topup";
  let cfgAll = {}; try { cfgAll = C.payCfg() || {}; } catch (e) {}
  const methods = PAY.filter((p) => cfgAll[p[0]]?.enabled !== false);
  let method = methods[0]?.[0] || "", file = null, amt = "";
  const draw = () => {
    const cfg = cfgAll[method] || {};
    sub(t.topup, `
      <div class="wl-note">${t.topupNote}</div>
      <label style="font-weight:800;font-size:13px;color:#475569">${t.amount}</label>
      <input class="wl-in" id="wlAmtIn" type="number" inputmode="decimal" min="${S.topupMin}" max="${S.topupMax}" placeholder="0" value="${C.esc(amt)}">
      <div class="wl-quick">${[50, 100, 200, 500].filter((v) => v >= S.topupMin && v <= S.topupMax).map((v) => `<button type="button" data-q="${v}">${v}</button>`).join("")}</div>
      <div class="wl-h" style="margin-top:10px">${t.method}</div>
      <div class="wl-quick">${methods.map((p) => `<button type="button" class="wl-meth ${p[0] === method ? "on" : ""}" data-m="${p[0]}"><img src="${p[2]}" alt="">${p[1]}</button>`).join("") || t.noMethod}</div>
      ${cfg.rib ? `<div class="wl-copy"><div><small>${t.rib}</small><b dir="ltr">${C.esc(cfg.rib)}</b></div><button type="button" data-c="${C.esc(cfg.rib)}">${t.copy}</button></div>` : ""}
      ${cfg.holder ? `<div class="wl-copy"><div><small>${t.holder}</small><b>${C.esc(cfg.holder)}</b></div><button type="button" data-c="${C.esc(cfg.holder)}">${t.copy}</button></div>` : ""}
      ${cfg.note ? `<div class="wl-note">${C.esc(cfg.note)}</div>` : ""}
      <div class="wl-h">${t.receipt}</div>
      <label class="wl-upl">${file ? `<img id="wlPrev" alt="">` : `${t.pick}`}<input id="wlFile" type="file" accept="image/*" hidden></label>
      <div class="wl-err" id="wlErr"></div>
      <button class="wl-go" id="wlSend" type="button">${t.send}</button>
      <button class="wl-go ghost" id="wlNo" type="button">${t.back}</button>`);
    const el = host();
    if (file) { const r = new FileReader(); r.onload = () => { const p = el.querySelector("#wlPrev"); if (p) p.src = r.result; }; r.readAsDataURL(file); }
    const keep = () => (amt = el.querySelector("#wlAmtIn").value);
    el.querySelector("#wlNo").onclick = () => { sheet = "home"; render(); };
    el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { el.querySelector("#wlAmtIn").value = b.dataset.q; keep(); }));
    el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { keep(); method = b.dataset.m; draw(); }));
    el.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.c); C.toast(t.copied); } catch (e) {} }));
    el.querySelector("#wlFile").onchange = (e) => { keep(); file = e.target.files?.[0] || null; draw(); };
    el.querySelector("#wlSend").onclick = async () => {
      const err = (m) => (el.querySelector("#wlErr").textContent = m);
      const amount = Number(el.querySelector("#wlAmtIn").value);
      if (!(amount >= S.topupMin && amount <= S.topupMax)) return err(t.amtErr(S.topupMin, S.topupMax));
      if (!method) return err(t.noMethod);
      if (!file) return err(t.needImg);
      const btn = el.querySelector("#wlSend"); btn.disabled = true;
      try {
        const image = await compressReceiptImage(file);
        const ref = doc(collection(C.db, "customerTopups")), b = writeBatch(C.db), uid = C.user().uid;
        b.set(ref, { uid, phone: String(C.profile()?.phone || "").slice(0, 20), amount: r2(amount), method, status: "pending", createdAt: serverTimestamp() });
        b.set(doc(C.db, "customerTopupImages", ref.id), { uid, image, createdAt: serverTimestamp() });
        await b.commit();
        C.toast(t.topupOk); sheet = "home"; render();
      } catch (e) { btn.disabled = false; err(e?.message === "bad-image" ? t.badImg : t.err); }
    };
  };
  draw();
}

async function openConvert() {
  const t = L(), S = WS.settings; sheet = "convert";
  await refreshPoints();
  const avail = Math.floor(pts.balance), max = Math.min(S.maxPoints, avail), rate = S.pointsPerDirham;
  if (avail < S.minPoints) {
    sub(t.cvTitle, `<div class="wl-prev"><small>${t.cvAvail}</small><b>${avail}</b></div><div class="wl-note">${t.cvLow(S.minPoints)}<br>${t.ptsHint(rate)}</div><button class="wl-go ghost" id="wlNo" type="button">${t.back}</button>`);
    host().querySelector("#wlNo").onclick = () => { sheet = "home"; render(); };
    return;
  }
  sub(t.cvTitle, `
    <div class="wl-prev"><small>${t.cvAvail}</small><b>${avail} ${t.pointsUnit}</b></div>
    <label style="font-weight:800;font-size:13px;color:#475569">${t.cvPts} <span style="color:#78716c;font-weight:600">(${t.cvMin(S.minPoints)} · ${t.ptsHint(rate)})</span></label>
    <input class="wl-in" id="cvIn" type="number" inputmode="numeric" min="${S.minPoints}" max="${max}" step="1" value="${max}">
    <input class="wl-range" id="cvRange" type="range" min="${S.minPoints}" max="${max}" step="1" value="${max}">
    <div class="wl-prev"><small>${t.cvGet}</small><b id="cvOut">0.00 ${t.dh}</b></div>
    <div class="wl-note">${t.cvNote}</div>
    <div class="wl-err" id="wlErr"></div>
    <button class="wl-go" id="cvGo" type="button">${t.cvBtn}</button>
    <button class="wl-go ghost" id="wlNo" type="button">${t.back}</button>`);
  const el = host(), inp = el.querySelector("#cvIn"), rng = el.querySelector("#cvRange");
  const val = () => Math.min(max, Math.max(0, Math.floor(Number(inp.value) || 0)));
  const upd = () => { el.querySelector("#cvOut").textContent = `${fmt(val() / rate)} ${t.dh}`; };
  inp.oninput = () => { rng.value = inp.value; upd(); };
  rng.oninput = () => { inp.value = rng.value; upd(); };
  upd();
  el.querySelector("#wlNo").onclick = () => { sheet = "home"; render(); };
  el.querySelector("#cvGo").onclick = async () => {
    const n = val(), err = (m) => (el.querySelector("#wlErr").textContent = m);
    if (n < S.minPoints || n > max) return err(t.cvMin(S.minPoints));
    const btn = el.querySelector("#cvGo"); btn.disabled = true;
    try {
      const uid = C.user().uid, ref = doc(collection(C.db, "pointsConversions")), b = writeBatch(C.db);
      b.set(doc(C.db, "pointsLog", "conv_" + ref.id), { uid, points: -n, reason: C.lang() === "fr" ? "Conversion de points en solde" : "تحويل النقاط إلى رصيد المحفظة", orderId: null, createdAt: serverTimestamp() });
      b.set(ref, { uid, phone: String(C.profile()?.phone || "").slice(0, 20), points: n, amount: n / rate, status: "pending", createdAt: serverTimestamp() });
      await b.commit();
      C.toast(t.cvOk); sheet = "home"; await refreshPoints(); render();
    } catch (e) { btn.disabled = false; err(t.err); }
  };
}
