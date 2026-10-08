// drvicons.js — أيقونات حقيقية (بدل الإيموجي) لتطبيق السائق ولوحة الإدارة وتتبع الزبون.
// 8 أيقونات PNG (من مجموعة وجبتنا) كتتلوّن بـ currentColor عبر mask + أيقونات SVG خطية بنفس الستايل.
let BASE = "";
export function setIconBase(b) { BASE = b || ""; }
const PNG = new Set(["scooter", "map", "chat", "phone", "user", "money", "clipboard", "home"]);
const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
  car: '<path d="M4 17v-5l2-5h12l2 5v5M4 12h16"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
  nav: '<path d="M12 3l7 17-7-4-7 4z"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  hex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  hourglass: '<path d="M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 16V5M7.5 9L12 4.5 16.5 9M5 20h14"/>',
  sparkle: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};
export function ic(name, size) {
  const st = size ? ` style="font-size:${size}"` : "";
  if (PNG.has(name)) return `<span class="drv-i drv-m" style="--m:url(${BASE}img/drv/${name}.png)${size ? ";font-size:" + size : ""}"></span>`;
  return `<svg class="drv-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${st}>${P[name] || ""}</svg>`;
}
if (typeof document !== "undefined" && !document.getElementById("drvIconStyle")) {
  const s = document.createElement("style");
  s.id = "drvIconStyle";
  s.textContent = ".drv-i{display:inline-block;width:1.25em;height:1.25em;vertical-align:-.25em;flex:none}.drv-m{background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}";
  document.head.appendChild(s);
}
