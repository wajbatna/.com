// ai/gemini.js — الاتصال المباشر بـ Google Gemini API عبر fetch
import { GEMINI_API_KEY, GEMINI_ENDPOINT, AI_LIMITS } from "./config.js";

export class GeminiError extends Error {
  constructor(kind) {
    super(kind); // kind: "config" | "rate" | "timeout" | "network" | "blocked" | "empty" | "http"
    this.kind = kind;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestOnce(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_LIMITS.timeoutMs);
  let res;
  try {
    res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new GeminiError(e && e.name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new GeminiError("rate");
  if (!res.ok) {
    const err = new GeminiError("http");
    err.status = res.status;
    try {
      const j = await res.json();
      err.detail = j && j.error && j.error.message ? String(j.error.message).slice(0, 300) : "";
    } catch (e) {
      err.detail = "";
    }
    throw err;
  }
  try {
    return await res.json();
  } catch (e) {
    throw new GeminiError("empty");
  }
}

// contents: [{ role: "user"|"model", parts: [{ text }] }]
export async function askGemini(systemText, contents) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith("PUT_YOUR")) throw new GeminiError("config");
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: AI_LIMITS.maxOutputTokens,
    },
  };
  let attempt = 0;
  for (;;) {
    try {
      const data = await requestOnce(body);
      if (data.candidates && data.candidates[0] && data.candidates[0].finishReason && data.candidates[0].finishReason !== "STOP") {
        console.warn("[Wajbatna AI] finishReason:", data.candidates[0].finishReason);
      }
      if (data.promptFeedback && data.promptFeedback.blockReason) throw new GeminiError("blocked");
      const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = Array.isArray(parts) ? parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim() : "";
      if (!text) throw new GeminiError("empty");
      return text;
    } catch (e) {
      const retryable = e instanceof GeminiError && (e.kind === "network" || (e.kind === "http" && e.status >= 500));
      if (retryable && attempt < AI_LIMITS.maxRetries) {
        attempt++;
        await sleep(1200);
        continue;
      }
      // تشخيص في وحدة التحكم فقط (بدون المفتاح) ولا يظهر للمستخدم
      console.warn("[Wajbatna AI]", e && e.kind, e && e.status ? e.status : "", e && e.detail ? e.detail : "");
      throw e instanceof GeminiError ? e : new GeminiError("network");
    }
  }
}
