// pw-eye.js — زر "العين" لإظهار/إخفاء كلمة السر فكل حقول input[type=password] (الموقع + لوحة المشرف).
// كيخدم تلقائياً حتى مع الحقول لي كتترسم لاحقاً (تسجيل الدخول، إنشاء حساب، حذف الحساب...) بواسطة MutationObserver.
const OPEN = "img/icons/eye-open.webp";
const CLOSED = "img/icons/eye-closed.webp";

function enhance(input) {
  if (input.dataset.eye || input.closest(".pw-wrap")) return;
  input.dataset.eye = "1";
  const wrap = document.createElement("div");
  wrap.className = "pw-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-eye";
  btn.setAttribute("aria-label", "إظهار/إخفاء كلمة السر");
  btn.innerHTML = `<img src="${CLOSED}" alt="" width="28" height="28">`;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.firstChild.src = show ? OPEN : CLOSED;
    input.focus({ preventScroll: true });
  });
  wrap.appendChild(btn);
}
function scan(root) {
  (root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : []).forEach(enhance);
}
function start() {
  scan(document);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.('input[type="password"]') ? enhance(n) : scan(n)));
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);
