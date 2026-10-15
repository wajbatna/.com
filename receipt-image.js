// receipt-image.js — يرسم "وصل الطلب" كصورة (Canvas) بشكل ورقة خارجة من طابعة حرارية، بدون أي مكتبة خارجية.
// الوحدة ما كتعرف والو على Firestore ولا على الترجمة: app.js كيعطيها بيانات جاهزة (نصوص مترجمة) وهي كترسم.
//
// شكل البيانات (d):
// { rtl, title, orderNoLabel, code, dateLabel, dateText,
//   info: [[label, value], ...],
//   itemsLabel, items: [{ name, qty, amountText }],
//   totalLabel, totalText,
//   paymentLabel, paymentText, payStatusLabel, payStatusText, payTone: "ok" | "wait" | "bad",
//   statusLabel, statusText, statusTone, steps: [..], doneCount, currentIndex (أو -1), thanks }

const W = 900; // العرض المنطقي (الصورة النهائية مضاعفة SCALE مرة للوضوح)
const SCALE = 2;
const FONT = 'Tajawal, "Segoe UI", Tahoma, Arial, sans-serif';
const MONO = '"Courier New", Courier, monospace';

const INK = "#1c1917";
const MUTED = "#78716c";
const LINE = "#e7e5e4";
const GREEN = "#059669";

const PAPER_X0 = 100;
const PAPER_X1 = 800;
const PAPER_TOP = 112;
const XL = 140; // بداية المحتوى (يسار)
const XR = 760; // نهاية المحتوى (يمين)

const TONES = {
  ok: { bg: "#dcfce7", fg: "#15803d" },
  wait: { bg: "#fef3c7", fg: "#b45309" },
  bad: { bg: "#fee2e2", fg: "#b91c1c" },
};

function font(ctx, weight, size, family = FONT) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function fit(ctx, text, maxW) {
  const str = String(text ?? "");
  if (ctx.measureText(str).width <= maxW) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// جهة "العنوان" وجهة "القيمة" حسب اتجاه اللغة
function sides(d) {
  return d.rtl
    ? { labelX: XR, labelAlign: "right", valueX: XL, valueAlign: "left" }
    : { labelX: XL, labelAlign: "left", valueX: XR, valueAlign: "right" };
}

function dashed(ctx, y) {
  ctx.save();
  ctx.strokeStyle = "#a8a29e";
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.moveTo(XL, y);
  ctx.lineTo(XR, y);
  ctx.stroke();
  ctx.restore();
}

function divider(ctx, y) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(XL, y);
  ctx.lineTo(XR, y);
  ctx.stroke();
}

// سطر "عنوان … قيمة"
function row(ctx, d, y, label, value, opts = {}) {
  const sd = sides(d);
  ctx.textBaseline = "alphabetic";
  font(ctx, 500, 21);
  ctx.fillStyle = MUTED;
  ctx.textAlign = sd.labelAlign;
  const labelW = ctx.measureText(label).width;
  ctx.fillText(label, sd.labelX, y);
  font(ctx, 800, 23, opts.mono ? MONO : FONT);
  ctx.fillStyle = opts.color || INK;
  ctx.textAlign = sd.valueAlign;
  ctx.fillText(fit(ctx, value, XR - XL - labelW - 28), sd.valueX, y);
  divider(ctx, y + 17);
  return y + 46;
}

function pill(ctx, d, y, text, tone) {
  const sd = sides(d);
  const c = TONES[tone] || TONES.wait;
  font(ctx, 800, 21);
  const w = ctx.measureText(text).width + 40;
  const h = 40;
  const x = sd.valueAlign === "left" ? sd.valueX : sd.valueX - w;
  ctx.fillStyle = c.bg;
  roundRect(ctx, x, y - 28, w, h, 20);
  ctx.fill();
  ctx.fillStyle = c.fg;
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y);
}

function stepper(ctx, d, top) {
  const boxH = 168;
  ctx.fillStyle = "#fafaf9";
  roundRect(ctx, XL, top, XR - XL, boxH, 22);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  const sd = sides(d);
  ctx.textBaseline = "alphabetic";
  font(ctx, 500, 20);
  ctx.fillStyle = MUTED;
  ctx.textAlign = sd.labelAlign;
  ctx.fillText(d.statusLabel, sd.labelX === XR ? XR - 26 : XL + 26, top + 44);
  const tone = TONES[d.statusTone] || null;
  font(ctx, 900, 25);
  ctx.fillStyle = tone ? tone.fg : INK;
  ctx.textAlign = sd.valueAlign;
  ctx.fillText(d.statusText, sd.valueX === XL ? XL + 26 : XR - 26, top + 44);

  const n = d.steps.length;
  const innerL = XL + 62;
  const innerR = XR - 62;
  const step = (innerR - innerL) / (n - 1);
  const cy = top + 94;
  const xs = d.steps.map((_, i) => (d.rtl ? innerR - i * step : innerL + i * step));

  // الخطوط بين النقاط
  for (let i = 0; i < n - 1; i++) {
    ctx.strokeStyle = i < d.doneCount - 1 ? INK : LINE;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(xs[i] + (xs[i + 1] > xs[i] ? 20 : -20), cy);
    ctx.lineTo(xs[i + 1] + (xs[i + 1] > xs[i] ? -20 : 20), cy);
    ctx.stroke();
  }
  // النقاط
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    if (i < d.doneCount) {
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.arc(x, cy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x - 7, cy + 1);
      ctx.lineTo(x - 2, cy + 6);
      ctx.lineTo(x + 8, cy - 5);
      ctx.stroke();
    } else if (i === d.currentIndex) {
      ctx.fillStyle = "rgba(28,25,23,.12)";
      ctx.beginPath();
      ctx.arc(x, cy, 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, cy, 15, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#d6d3d1";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    font(ctx, i === d.currentIndex || i < d.doneCount ? 800 : 500, 18);
    ctx.fillStyle = i === d.currentIndex ? INK : MUTED;
    ctx.textAlign = "center";
    ctx.fillText(fit(ctx, d.steps[i], step - 8), x, cy + 46);
  }
  return top + boxH;
}

// باركود شكلي (زخرفة فقط) مولَّد من رقم الطلب
function barcode(ctx, code, top) {
  let seed = 7;
  for (const ch of String(code)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const total = 440;
  let x = (W - total) / 2;
  ctx.fillStyle = INK;
  while (x < (W + total) / 2 - 4) {
    const bw = 2 + Math.floor(rnd() * 5);
    ctx.fillRect(x, top, bw, 64);
    x += bw + 2 + Math.floor(rnd() * 4);
  }
  font(ctx, 700, 19, MONO);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  ctx.fillText(String(code), W / 2, top + 92);
  return top + 112;
}

// محتوى الورقة؛ كيرجع Y لي وصل ليه (كنستعملو لقياس الارتفاع قبل الرسم الحقيقي)
function paintContent(ctx, d) {
  ctx.direction = d.rtl ? "rtl" : "ltr";
  ctx.textBaseline = "alphabetic";
  let y = 168;
  dashed(ctx, y);
  font(ctx, 800, 26, MONO);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText(fit(ctx, d.title, XR - XL), W / 2, y + 42);
  dashed(ctx, y + 66);

  y += 112;
  y = row(ctx, d, y, d.orderNoLabel, d.code, { mono: true });
  y = row(ctx, d, y, d.dateLabel, d.dateText);
  for (const [label, value] of d.info) y = row(ctx, d, y, label, value);

  // المنتجات
  y += 14;
  font(ctx, 800, 19);
  ctx.fillStyle = MUTED;
  ctx.textAlign = d.rtl ? "right" : "left";
  ctx.fillText(d.itemsLabel, d.rtl ? XR : XL, y);
  y += 30;
  const sd = sides(d);
  for (const it of d.items) {
    font(ctx, 800, 23);
    const amountW = ctx.measureText(it.amountText).width;
    ctx.fillStyle = INK;
    ctx.textAlign = sd.valueAlign;
    ctx.fillText(it.amountText, sd.valueX, y);
    ctx.textAlign = sd.labelAlign;
    const qty = `×${it.qty}`;
    font(ctx, 800, 22);
    const qtyW = ctx.measureText(qty).width;
    font(ctx, 700, 23);
    ctx.fillStyle = INK;
    const nm = fit(ctx, it.name, XR - XL - amountW - qtyW - 52);
    ctx.fillText(nm, sd.labelX, y);
    const nmW = ctx.measureText(nm).width;
    font(ctx, 800, 22);
    ctx.fillStyle = MUTED;
    ctx.fillText(qty, d.rtl ? sd.labelX - nmW - 14 : sd.labelX + nmW + 14, y);
    divider(ctx, y + 17);
    y += 46;
  }

  // المجموع
  y += 14;
  dashed(ctx, y - 18);
  y += 26;
  font(ctx, 800, 26);
  ctx.fillStyle = INK;
  ctx.textAlign = sd.labelAlign;
  ctx.fillText(d.totalLabel, sd.labelX, y);
  font(ctx, 900, 38);
  ctx.fillStyle = "#064e3b";
  ctx.textAlign = sd.valueAlign;
  ctx.fillText(d.totalText, sd.valueX, y);
  y += 22;
  divider(ctx, y);

  // الدفع
  y += 44;
  y = row(ctx, d, y, d.paymentLabel, d.paymentText);
  font(ctx, 500, 21);
  ctx.fillStyle = MUTED;
  ctx.textAlign = sd.labelAlign;
  ctx.fillText(d.payStatusLabel, sd.labelX, y);
  pill(ctx, d, y, d.payStatusText, d.payTone);
  y += 52;

  // حالة الطلب + المراحل
  y = stepper(ctx, d, y);

  // الباركود + الشكر
  y += 54;
  y = barcode(ctx, d.code, y);
  font(ctx, 600, 20);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  ctx.fillText(d.thanks, W / 2, y + 12);
  return y + 34;
}

function drawBackground(ctx, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#f3f5f8");
  g.addColorStop(1, "#e4e8ee");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawPrinter(ctx) {
  const x = 50;
  const y = 36;
  const w = 800;
  const h = 92;
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,.30)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 16;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#52555d");
  g.addColorStop(0.55, "#2f3136");
  g.addColorStop(1, "#1d1f23");
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 34);
  ctx.fill();
  ctx.restore();
  // لمعة علوية
  ctx.strokeStyle = "rgba(255,255,255,.20)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 3);
  ctx.lineTo(x + w - 40, y + 3);
  ctx.stroke();
  // ضوء الحالة
  ctx.save();
  ctx.shadowColor = "#22c55e";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#4ade80";
  ctx.beginPath();
  ctx.arc(x + 62, y + 32, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // فتحة الورق
  const sg = ctx.createLinearGradient(0, y + 56, 0, y + 84);
  sg.addColorStop(0, "#050506");
  sg.addColorStop(1, "#16171a");
  ctx.fillStyle = sg;
  roundRect(ctx, x + 36, y + 56, w - 72, 28, 14);
  ctx.fill();
}

function drawPaper(ctx, bottom) {
  const tooth = (PAPER_X1 - PAPER_X0) / 35;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(PAPER_X0, PAPER_TOP);
    ctx.lineTo(PAPER_X1, PAPER_TOP);
    ctx.lineTo(PAPER_X1, bottom);
    for (let i = 1; i <= 35; i++) {
      const x = PAPER_X1 - i * tooth;
      ctx.lineTo(x + tooth / 2, bottom + 11);
      ctx.lineTo(x, bottom);
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,.22)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  path();
  const pg = ctx.createLinearGradient(PAPER_X0, 0, PAPER_X1, 0);
  pg.addColorStop(0, "#fbfaf7");
  pg.addColorStop(0.5, "#ffffff");
  pg.addColorStop(1, "#faf9f6");
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.restore();
  // ظل الفتحة فوق الورقة (كأنها خارجة من الطابعة)
  ctx.save();
  path();
  ctx.clip();
  const sh = ctx.createLinearGradient(0, PAPER_TOP, 0, PAPER_TOP + 46);
  sh.addColorStop(0, "rgba(0,0,0,.34)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(PAPER_X0, PAPER_TOP, PAPER_X1 - PAPER_X0, 46);
  ctx.restore();
}

async function ensureFonts() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([document.fonts.load("500 21px Tajawal"), document.fonts.load("800 23px Tajawal"), document.fonts.load("900 26px Tajawal")]);
    }
  } catch (_) {
    /* نكملو بالخطوط الاحتياطية */
  }
}

// كيرجع { canvas, printerPct } — printerPct = نسبة ارتفاع الطابعة من الصورة (لحركة "الطباعة" فالعرض)
export async function drawReceiptCanvas(d) {
  await ensureFonts();
  // مرحلة القياس: نرسمو المحتوى فـ canvas مؤقت باش نعرفو الارتفاع
  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = 4000;
  const contentBottom = paintContent(probe.getContext("2d"), d);
  const paperBottom = contentBottom;
  const H = paperBottom + 11 + 64;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  drawBackground(ctx, H);
  drawPrinter(ctx);
  drawPaper(ctx, paperBottom);
  paintContent(ctx, d);
  return { canvas, printerPct: Math.round(((36 + 92 + 10) / H) * 1000) / 10 };
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    // JPEG بجودة عالية: الصورة فيها ظلال وتدرجات، PNG كيخرج ~3MB وJPEG ~0.5MB
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob-failed"))), "image/jpeg", 0.93);
  });
}
