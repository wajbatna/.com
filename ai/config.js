// ai/config.js
// -----------------------------------------------------------------------
// إعدادات المساعد الذكي. المساعد يتصل بـ Gemini عبر Firebase AI Logic فقط
// (نفس Firebase App الموجود في ../firebase.js) — لا يوجد مفتاح Gemini ولا Worker ولا endpoint مباشر.
// المتطلبات الخارجية موجودة في الأعلى من gemini.js.
// -----------------------------------------------------------------------

// الموديل المستعمل عبر Firebase AI Logic
export const AI_MODEL = "gemini-3.5-flash";

// موديلات احتياطية: إلا رجع الموديل الأساسي 404/500/503 (ضغط عالي أو غير متاح) كيجرب الموالي أوتوماتيكياً
export const AI_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

// وضع التشخيص: true = يعرض سبب الفشل داخل المحادثة (بدون أي مفتاح). غيّره إلى false بعد أن يعمل المساعد.
export const AI_DEBUG = true;

// حدود مناسبة للاستخدام المجاني
export const AI_LIMITS = {
  maxInputChars: 300, // أقصى طول لرسالة المستخدم
  maxOutputTokens: 2048, // أقصى طول لرد Gemini
  historyTurns: 6, // عدد الرسائل الأخيرة المرسلة كسياق
  historyCharsPerTurn: 500, // اقتطاع كل رسالة من السياق
  cooldownMs: 3000, // أقل فاصل بين رسالتين
  rateLimitCooldownMs: 30000, // انتظار بعد HTTP 429
  maxMessagesPerWindow: 12, // أقصى عدد رسائل داخل النافذة
  windowMs: 10 * 60 * 1000, // مدة النافذة (10 دقائق)
  timeoutMs: 20000, // مهلة الطلب
  maxRetries: 1, // إعادة محاولة واحدة فقط (أخطاء الشبكة/5xx)
  dataCacheMs: 90000, // مدة تخزين بيانات الموقع مؤقتاً
};
