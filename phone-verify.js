// phone-verify.js — شاشة تأكيد رقم الهاتف برمز من 6 أرقام يصل على واتساب (واجهة خانات + تحقق تلقائي عند اكتمال الرمز).
// المقارنة بين الرمز المُدخل والرمز المعيّن كتدير فـ firestore.rules (الزبون عمرو ما كيقرا مخزن الرموز).
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const TXT = {
  ar: {
    title: "تأكيد رقم هاتفك", sub: (p) => `سنرسل إليك رمزاً من 6 أرقام عبر واتساب إلى <b dir="ltr">${p}</b>`,
    waiting: "في انتظار إرسال الرمز إليك على واتساب...", sent: "تم إرسال الرمز! تفقّد واتساب وأدخله هنا.",
    noCode: "لم يصلك الرمز؟", resend: "إعادة الطلب", wait: (s) => `إعادة الطلب بعد ${s} ث`, asked: "تم إرسال طلبك للمشرف.",
    wa: "اطلب الرمز عبر واتساب", waMsg: (p) => `مرحباً، أريد رمز التحقق لرقم هاتفي ${p} في وجبتنا.`,
    bad: "الرمز غير صحيح، حاول مرة أخرى.", ok: "تم التحقق بنجاح", logout: "تسجيل الخروج", err: "تعذر الاتصال، حاول مجدداً.",
  },
  fr: {
    title: "Confirmez votre numéro", sub: (p) => `Nous vous envoyons un code à 6 chiffres sur WhatsApp au <b dir="ltr">${p}</b>`,
    waiting: "En attente de l'envoi du code sur WhatsApp...", sent: "Code envoyé ! Vérifiez WhatsApp et saisissez-le ici.",
    noCode: "Code non reçu ?", resend: "Renvoyer", wait: (s) => `Renvoyer dans ${s} s`, asked: "Votre demande a été envoyée.",
    wa: "Demander le code via WhatsApp", waMsg: (p) => `Bonjour, je voudrais le code de vérification pour mon numéro ${p} (Wajbati).`,
    bad: "Code incorrect, réessayez.", ok: "Vérifié avec succès", logout: "Se déconnecter", err: "Erreur de connexion, réessayez.",
  },
};

const CSS = `
.pv{text-align:center;padding:6px 4px 2px}
.pv h3{margin:0 0 6px;color:#064e3b;font-size:20px}
.pv p{margin:0 0 16px;color:#475569;font-size:14px;line-height:1.7}
.pv-boxes{display:flex;gap:8px;justify-content:center;direction:ltr;margin:6px 0 10px}
.pv-boxes input{width:46px;height:56px;border:2px solid #d6d3d1;border-radius:14px;text-align:center;font:800 24px system-ui;color:#064e3b;background:#fff;padding:0;outline:none;transition:border-color .15s,box-shadow .15s,transform .15s}
.pv-boxes input:focus{border-color:#059669;box-shadow:0 0 0 4px #05966922;transform:translateY(-2px)}
.pv-boxes input.fill{border-color:#10b981;background:#f0fdf4}
.pv-boxes.err input{border-color:#dc2626;animation:pvShake .4s}
@keyframes pvShake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
.pv-st{min-height:22px;font-size:13px;font-weight:700;color:#047857;margin-bottom:6px}
.pv-st.bad{color:#dc2626}
.pv-row{font-size:13px;color:#78716c;margin-top:8px}
.pv-link{border:0;background:none;color:#064e3b;font-weight:800;cursor:pointer;font-size:13px;padding:2px 4px}
.pv-link:disabled{color:#a8a29e;cursor:default}
.pv-wa{display:inline-block;margin-top:10px;background:#25d366;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:10px 18px;border-radius:12px}
.pv-ok{padding:26px 0;text-align:center}
.pv-ok h3{color:#064e3b;margin:18px 0 0}
.pv-chk{width:86px;height:86px;border-radius:24px;margin:0 auto;display:flex;align-items:center;justify-content:center;background:#ecfdf5;border:2px solid #10b981;box-shadow:0 0 0 0 #10b98188;animation:pvGlow 1.4s ease-out infinite}
.pv-chk svg{width:44px;height:44px;stroke:#059669;stroke-width:3.2;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:pvDraw .5s .15s ease forwards}
@keyframes pvDraw{to{stroke-dashoffset:0}}
@keyframes pvGlow{70%{box-shadow:0 0 0 22px #10b98100}100%{box-shadow:0 0 0 0 #10b98100}}
`;

const ms = (v) => (v?.toMillis ? v.toMillis() : v ? new Date(v).getTime() : Date.now());

/** يرجّع true إلا كان الزبون خاصو يتحقق (وكيعرض الشاشة)، وإلا false. onDone كيتنادى بعد النجاح. */
export async function runPhoneGate({ db, user, profile, lang = "ar", container, onDone, onLogout, openModal }) {
  if (!user || !profile?.phone) return false;
  let cfg;
  try { const c = await getDoc(doc(db, "config", "whatsappVerify")); cfg = c.exists() ? c.data() : null; } catch (e) { return false; }
  if (!cfg?.enabled) return false;
  if (cfg.enabledAt && ms(profile.createdAt) < ms(cfg.enabledAt)) return false; // حسابات قديمة ما كتتأثرش
  const ref = doc(db, "phoneVerifications", user.uid);
  let snap;
  try { snap = await getDoc(ref); } catch (e) { return false; }
  if (snap.exists() && snap.data().status === "verified") return false;
  if (!snap.exists()) {
    try { await setDoc(ref, { phone: String(profile.phone).slice(0, 20), status: "pending", requestedAt: serverTimestamp() }); }
    catch (e) { console.warn("phoneVerifications", e); return false; }
  }

  const T = TXT[lang] || TXT.ar;
  if (!document.getElementById("pvStyle")) { const st = document.createElement("style"); st.id = "pvStyle"; st.textContent = CSS; document.head.appendChild(st); }
  openModal?.();
  const waNum = String(cfg.number || "").replace(/\D/g, "");
  container.innerHTML = `<div class="pv">
    <h3>${T.title}</h3><p>${T.sub(String(profile.phone))}</p>
    <div class="pv-boxes" id="pvBoxes">${Array.from({ length: 6 }, () => `<input inputmode="numeric" autocomplete="one-time-code" maxlength="1" pattern="[0-9]*">`).join("")}</div>
    <div class="pv-st" id="pvSt">${T.waiting}</div>
    ${waNum ? `<a class="pv-wa" id="pvWa" target="_blank" rel="noopener" href="https://wa.me/${waNum}?text=${encodeURIComponent(T.waMsg(profile.phone))}">${T.wa}</a>` : ""}
    <div class="pv-row">${T.noCode} <button class="pv-link" id="pvRe" type="button"></button></div>
    <div class="pv-row"><button class="pv-link" id="pvOut" type="button" style="color:#dc2626">${T.logout}</button></div>
  </div>`;
  const q = (id) => container.querySelector("#" + id);
  const boxes = [...q("pvBoxes").querySelectorAll("input")], st = q("pvSt"), re = q("pvRe");
  let busy = false, done = false, cool = 45, timer = null;

  const tick = () => { re.disabled = cool > 0; re.textContent = cool > 0 ? T.wait(cool) : T.resend; };
  tick(); timer = setInterval(() => { if (cool > 0) { cool--; tick(); } }, 1000);
  re.onclick = async () => {
    if (cool > 0) return; cool = 45; tick();
    try { await updateDoc(ref, { requestedAt: serverTimestamp() }); st.className = "pv-st"; st.textContent = T.asked; } catch (e) { st.className = "pv-st bad"; st.textContent = T.err; }
  };
  q("pvOut").onclick = () => { clearInterval(timer); unsub(); onLogout?.(); };

  const success = () => {
    if (done) return; done = true; clearInterval(timer); unsub();
    container.innerHTML = `<div class="pv-ok"><div class="pv-chk"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>${T.ok}</h3></div>`;
    setTimeout(() => onDone?.(), 1400);
  };
  const submit = async () => {
    const code = boxes.map((b) => b.value).join("");
    if (code.length !== 6 || busy || done) return;
    busy = true; boxes.forEach((b) => (b.disabled = true));
    try { await updateDoc(ref, { status: "verified", verifiedAt: serverTimestamp(), attempt: code }); success(); }
    catch (e) {
      const denied = e?.code === "permission-denied";
      q("pvBoxes").classList.add("err"); st.className = "pv-st bad"; st.textContent = denied ? T.bad : T.err;
      setTimeout(() => { q("pvBoxes").classList.remove("err"); boxes.forEach((b) => { b.disabled = false; b.value = ""; b.classList.remove("fill"); }); boxes[0].focus(); busy = false; }, 600);
    }
  };
  boxes.forEach((b, i) => {
    b.addEventListener("input", () => {
      b.value = b.value.replace(/\D/g, "").slice(-1); b.classList.toggle("fill", !!b.value);
      if (b.value && i < 5) boxes[i + 1].focus();
      submit();
    });
    b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].classList.remove("fill"); boxes[i - 1].focus(); } });
    b.addEventListener("paste", (e) => {
      const d = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (!d) return; e.preventDefault();
      boxes.forEach((x, k) => { x.value = d[k] || ""; x.classList.toggle("fill", !!x.value); }); boxes[Math.min(d.length, 5)].focus(); submit();
    });
  });
  boxes[0].focus();

  // حالة الطلب لحظيا: الرمز تبعت؟ أو المشرف فعّل الرقم يدويا
  const unsub = onSnapshot(ref, (s) => {
    const d = s.data(); if (!d || done) return;
    if (d.status === "verified") { success(); return; }
    if (!busy && !q("pvBoxes")?.classList.contains("err")) { st.className = "pv-st"; st.textContent = d.codeId ? T.sent : T.waiting; }
  }, () => {});
  return true;
}
