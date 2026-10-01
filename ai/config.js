// ai/config.js
// -----------------------------------------------------------------------
// المكان الوحيد الذي يوضع فيه مفتاح Gemini.
// ضع مفتاحك بدل النص التالي. لا تكرر المفتاح في أي ملف آخر.
//
// مهم: الموقع مستضاف على GitHub Pages بدون Backend، فالمفتاح سيكون ظاهراً لمن
// يفتح أدوات المتصفح. لذلك قيّد المفتاح من Google AI Studio / Google Cloud Console:
//   Credentials -> API key -> Application restrictions -> Websites (HTTP referrers)
//   ثم أضف دومين موقعك فقط (مثال: https://USERNAME.github.io/*)
//   و API restrictions -> Generative Language API فقط.
// -----------------------------------------------------------------------

export const GEMINI_API_KEY = "AQ.Ab8RN6L-CR91hawkFwbMZH7tZofnAI-lxMWwii-h2w76qAx6rw";

// وضع التشخيص: true = يعرض سبب الفشل داخل المحادثة (بدون المفتاح).
// غيّره إلى false بعد حل المشكلة.
export const AI_DEBUG = true;

export const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

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
