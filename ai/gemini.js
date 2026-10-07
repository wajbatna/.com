// ai/gemini.js — المسار الوحيد للمساعد الذكي: assistant.js → askGemini → Firebase AI Logic → Gemini
// • كيستعمل نفس Firebase App (app من ../firebase.js) لي كيستعملو Auth وFirestore — ما كاين حتى initializeApp ثاني.
// • ما كاين مفتاح Gemini ولا OAuth token ولا Worker: Firebase AI Logic كيدير المصادقة بنفسو
//   (مفتاح الويب ديال المشروع + App Check إلا فعّلتيه + ID Token ديال المستخدم إلا كان مسجل دخول).
// • المساعد ما كيتطلبش تسجيل دخول.
//
// المتطلبات الخارجية (ماشي فالكود):
//  1) Firebase Console > Build > AI Logic > Get started > Gemini Developer API (كيفعّل الـ APIs).
//  2) Google Cloud Console > APIs & Services > Credentials > Browser key ديال Firebase:
//     إلا كانت عندو API restrictions لازم يكون فيها "Firebase AI Logic API" (firebasevertexai.googleapis.com)
//     و"Generative Language API"؛ وإلا كانت عندو HTTP referrers لازم يكون فيها wajbatna.github.io/*
//  3) Firebase Console > App Check: إلا كان AI Logic "Enforced" بلا ما يكون App Check مدمج فالموقع، كيرجع 401/403.
import { app } from "../firebase.js";
import { AI_MODEL, AI_FALLBACK_MODELS, AI_LIMITS } from "./config.js";

export class GeminiError extends Error {
  constructor(kind) {
    super(kind); // kind: "config" | "rate" | "timeout" | "network" | "blocked" | "empty" | "http"
    this.kind = kind;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let sdkPromise = null;
let aiInstance = null;
function loadSdk() {
  // تحميل كسول: إلا فشل تحميل الـ SDK ما يتأثر باقي الموقع
  if (!sdkPromise) sdkPromise = import("https://www.gstatic.com/firebasejs/12.18.0/firebase-ai.js");
  return sdkPromise;
}
async function getAiClient() {
  const sdk = await loadSdk();
  // نفس الـ app ديال Auth/Firestore؛ الـ SDK كيجمع Auth وApp Check ديالو تلقائياً من هاد الـ app
  if (!aiInstance) aiInstance = sdk.getAI(app, { backend: new sdk.GoogleAIBackend() });
  return { sdk, ai: aiInstance };
}

const HINT_AUTH =
  "رفض Google/Firebase الاعتماد. تحقق من: (1) تفعيل AI Logic فـ Firebase Console (Build > AI Logic)؛ " +
  "(2) قيود مفتاح الويب فـ Google Cloud > Credentials: تسمح بـ Firebase AI Logic API ودومين الموقع؛ " +
  "(3) App Check غير مُلزِم لـ AI Logic.";

// كيستخرج كود HTTP الحقيقي من خطأ الـ SDK (customErrorData.status) وإلا من نص الرسالة
function extractStatus(e) {
  const fromData = Number(e && e.customErrorData && e.customErrorData.status);
  if (fromData) return fromData;
  const m = String((e && e.message) || "").match(/\[(\d{3})\b/) || String((e && e.message) || "").match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : 0;
}

function mapError(e) {
  if (e instanceof GeminiError) return e;
  const msg = String((e && e.message) || "");
  const status = extractStatus(e);
  if (e && e.name === "AbortError") return new GeminiError("timeout");
  if (/timeout|deadline/i.test(msg) && !status) return new GeminiError("timeout");
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) return new GeminiError("rate");
  if (/prompt was blocked|blockReason|SAFETY/i.test(msg) && !status) return new GeminiError("blocked");
  if (status) {
    const err = new GeminiError("http");
    err.status = status;
    err.detail = (status === 401 || status === 403 ? HINT_AUTH + " — " : "") + msg.slice(0, 220);
    return err;
  }
  const err = new GeminiError("network");
  err.detail = msg.slice(0, 300);
  return err;
}

// contents: [{ role: "user"|"model", parts: [{ text }] }]
export async function askGemini(systemText, contents) {
  let attempt = 0;
  const models = [AI_MODEL, ...(AI_FALLBACK_MODELS || [])];
  let mi = 0;
  for (;;) {
    try {
      const { sdk, ai } = await getAiClient();
      const model = sdk.getGenerativeModel(
        ai,
        {
          model: models[mi],
          systemInstruction: { role: "system", parts: [{ text: systemText }] },
          generationConfig: { temperature: 0.3, maxOutputTokens: AI_LIMITS.maxOutputTokens },
        },
        { timeout: AI_LIMITS.timeoutMs }
      );
      const result = await model.generateContent({ contents });
      const fb = result.response.promptFeedback;
      if (fb && fb.blockReason) throw new GeminiError("blocked");
      let text = "";
      try {
        text = String(result.response.text() || "").trim();
      } catch (_) {
        text = ""; // text() كيرمي إلا كان الرد محجوب/فارغ → كنعتبروه "empty"
      }
      if (!text) throw new GeminiError("empty");
      return text;
    } catch (raw) {
      const e = mapError(raw);
      // الموديل الحالي مشغول/غير متاح → جرّب الموديل الاحتياطي مباشرة
      if (e.kind === "http" && [404, 500, 502, 503, 504].includes(e.status) && mi < models.length - 1) {
        console.warn("[Wajbatna AI] fallback from", models[mi], "status", e.status);
        mi++;
        continue;
      }
      const retryable = e.kind === "network" || (e.kind === "http" && e.status >= 500);
      if (retryable && attempt < AI_LIMITS.maxRetries) {
        attempt++;
        await sleep(1200);
        continue;
      }
      // 401/403 ماشي أخطاء مؤقتة: كنرميوها كما هي (مع سبب واضح فـ detail) بلا إخفاء ولا نجاح وهمي
      console.warn("[Wajbatna AI]", e.kind, e.status || "", e.detail || "");
      throw e;
    }
  }
}
