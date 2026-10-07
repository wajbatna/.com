// receipts.js — مساعدات "إيصال الدفع": طرق الأداء لي كتحتاج إيصال + ضغط الصورة قبل الرفع.
// الإيصال كيتخزن كصورة مضغوطة (data URL JPEG) فـ Firestore (بدون Firebase Storage)، بحد أقصى ~450KB.
// ⚠️ لازم يبقى هاد الترتيب مطابق لقائمة receiptOrderOk فـ firestore.rules.
export const RECEIPT_METHODS = ["card", "cih", "fellah", "cashplus", "wafacash", "tijari", "baridbank"];

const MAX_CHARS = 450000; // أقل من حد القواعد (600000) وحد الوثيقة (1MB)

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad-image"));
    };
    img.src = url;
  });
}

// كيرجع data URL (image/jpeg) أصغر من MAX_CHARS، أو كيرمي Error("bad-image")
export async function compressReceiptImage(file) {
  if (!file || !/^image\//.test(file.type) || file.size > 25 * 1024 * 1024) throw new Error("bad-image");
  const img = await loadImage(file);
  let side = 1200;
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // PNG شفاف → خلفية بيضاء
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= MAX_CHARS) return data;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error("bad-image");
}
