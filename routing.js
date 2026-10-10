// routing.js — مسار على الطرق بين نقطتين عبر خدمات خارجية، مع كاش وبديل مستقيم.
import { ROUTING as C } from "./routing-config.js";

const rad = (x) => (x * Math.PI) / 180;
export function haversine(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
export function fmtDist(m, lang) {
  const fr = lang === "fr";
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} ${fr ? "m" : "م"}` : `${(m / 1000).toFixed(1)} ${fr ? "km" : "كم"}`;
}
export function fmtDur(s, lang) {
  const m = Math.max(1, Math.round(s / 60)); const fr = lang === "fr";
  return m < 60 ? `${m} ${fr ? "min" : "د"}` : `${Math.floor(m / 60)}${fr ? "h" : "س"} ${m % 60}${fr ? "" : "د"}`;
}

const tmo = (url, opt = {}) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), C.timeoutMs);
  return fetch(url, { ...opt, signal: ac.signal }).finally(() => clearTimeout(t));
};
const P = (p) => `${p.lng},${p.lat}`;
const prof = { driving: { ors: "driving-car", mapbox: "driving", gh: "car" }, cycling: { ors: "cycling-regular", mapbox: "cycling", gh: "bike" }, walking: { ors: "foot-walking", mapbox: "walking", gh: "foot" } }[C.profile] || {};

// كل مزود يرجّع { coords:[[lat,lng],...], distance(m), duration(s) }
const PROVIDERS = {
  async osrm(a, b) {
    const r = await tmo(`${C.osrmUrl}/route/v1/${C.profile}/${P(a)};${P(b)}?overview=full&geometries=geojson`);
    const j = await r.json(); const x = j.routes?.[0]; if (!x) throw new Error("osrm");
    return { coords: x.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: x.distance, duration: x.duration };
  },
  async ors(a, b) {
    if (!C.keys.ors) throw new Error("no key");
    const r = await tmo(`https://api.openrouteservice.org/v2/directions/${prof.ors}/geojson`, {
      method: "POST", headers: { Authorization: C.keys.ors, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }),
    });
    const j = await r.json(); const f = j.features?.[0]; if (!f) throw new Error("ors");
    return { coords: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: f.properties.summary.distance, duration: f.properties.summary.duration };
  },
  async mapbox(a, b) {
    if (!C.keys.mapbox) throw new Error("no key");
    const r = await tmo(`https://api.mapbox.com/directions/v5/mapbox/${prof.mapbox}/${P(a)};${P(b)}?overview=full&geometries=geojson&access_token=${encodeURIComponent(C.keys.mapbox)}`);
    const j = await r.json(); const x = j.routes?.[0]; if (!x) throw new Error("mapbox");
    return { coords: x.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: x.distance, duration: x.duration };
  },
  async graphhopper(a, b) {
    if (!C.keys.graphhopper) throw new Error("no key");
    const r = await tmo(`https://graphhopper.com/api/1/route?point=${a.lat},${a.lng}&point=${b.lat},${b.lng}&profile=${prof.gh}&points_encoded=false&key=${encodeURIComponent(C.keys.graphhopper)}`);
    const j = await r.json(); const x = j.paths?.[0]; if (!x) throw new Error("gh");
    return { coords: x.points.coordinates.map(([lng, lat]) => [lat, lng]), distance: x.distance, duration: x.time / 1000 };
  },
};

const cache = new Map(); // مفتاح مقرّب → نتيجة
const key = (a, b) => [a.lat, a.lng, b.lat, b.lng].map((v) => v.toFixed(4)).join(",");

/** يرجّع مساراً على الطرق؛ إن فشلت كل الخدمات يرجّع خطاً مستقيماً { fallback:true } */
export async function getRoute(a, b) {
  const k = key(a, b); if (cache.has(k)) return cache.get(k);
  for (const name of C.providers) {
    try {
      const r = await PROVIDERS[name](a, b);
      if (r.coords.length > 1) { const out = { ...r, provider: name, fallback: false }; cache.set(k, out); if (cache.size > 60) cache.delete(cache.keys().next().value); return out; }
    } catch (e) { /* جرّب المزود التالي */ }
  }
  const d = haversine(a, b);
  return { coords: [[a.lat, a.lng], [b.lat, b.lng]], distance: d, duration: d / 8, provider: "straight", fallback: true };
}

/**
 * مسار حيّ على خريطة Leaflet: يرسم خطاً مستقيماً فوراً ثم يستبدله بمسار الطرق، ويعيد الحساب
 * فقط إذا تحرك أحد الطرفين minMoveMeters ومرّ minIntervalMs.
 *   const lr = createLiveRoute(map, { color, onInfo })   ;   lr.update(from, to)   ;   lr.clear()
 */
export function createLiveRoute(map, { color = "#059669", casing = "#ffffff", onInfo } = {}) {
  const L = window.L; let line = null, cas = null, last = null, lastAt = 0, busy = false, dead = false, seq = 0;
  const set = (pts) => {
    if (line) { line.setLatLngs(pts); cas.setLatLngs(pts); return; }
    cas = L.polyline(pts, { color: casing, weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
    line = L.polyline(pts, { color, weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);
  };
  return {
    async update(from, to) {
      if (dead || !from || !to) return;
      const moved = !last || haversine(last.from, from) > C.minMoveMeters || haversine(last.to, to) > C.minMoveMeters;
      if (!line) { const d = haversine(from, to); set([[from.lat, from.lng], [to.lat, to.lng]]); onInfo?.({ distance: d, duration: d / 8, fallback: true, pending: true }); }
      if (!moved || busy || (last && Date.now() - lastAt < C.minIntervalMs)) return;
      busy = true; const my = ++seq;
      try {
        const r = await getRoute(from, to);
        if (dead || my !== seq) return;
        last = { from: { ...from }, to: { ...to } }; lastAt = Date.now();
        set(r.coords); onInfo?.(r);
      } finally { busy = false; }
    },
    clear() { dead = true; try { line && map.removeLayer(line); cas && map.removeLayer(cas); } catch (e) {} line = cas = null; },
  };
}
