// hexgrid.js — شبكة سداسيات (Hexagons) لمدينة برشيد: تقسيم الخريطة، حساب السداسي، والحلقات المجاورة.
// نظام إحداثيات axial (q, r) فوق إسقاط مسطّح محلي حول وسط برشيد. يستعملو تطبيق الإدارة (والسائق).
export const CITY_CENTER = { lat: 33.2655, lng: -7.5875 }; // برشيد
export const HEX_SIZE_M = 500;  // نصف قطر السداسي (من الوسط للركن) بالمتر
export const CITY_RADIUS_M = 6000; // نطاق عرض الشبكة فالخريطة
export const MAX_SEARCH_RING = 14;  // أقصى عمق بحث عن سائق

const M_LAT = 110574;
const M_LNG = 111320 * Math.cos((CITY_CENTER.lat * Math.PI) / 180);
const SQ3 = Math.sqrt(3);

function toXY(lat, lng) { return { x: (lng - CITY_CENTER.lng) * M_LNG, y: (lat - CITY_CENTER.lat) * M_LAT }; }
function toLatLng(x, y) { return { lat: CITY_CENTER.lat + y / M_LAT, lng: CITY_CENTER.lng + x / M_LNG }; }

function cubeRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return { q, r };
}

export const cellId = (c) => `${c.q},${c.r}`;
export const parseCell = (id) => { const [q, r] = String(id).split(",").map(Number); return { q, r }; };

// الإحداثيات الجغرافية → السداسي اللي فيه النقطة
export function latLngToCell(lat, lng) {
  const { x, y } = toXY(lat, lng);
  return cubeRound(((SQ3 / 3) * x - y / 3) / HEX_SIZE_M, ((2 / 3) * y) / HEX_SIZE_M);
}
export function cellCenter(c) {
  return toLatLng(HEX_SIZE_M * SQ3 * (c.q + c.r / 2), HEX_SIZE_M * 1.5 * c.r);
}
// الأركان الستة (للرسم فـ Leaflet: [[lat,lng],...])
export function cellPolygon(c) {
  const cx = HEX_SIZE_M * SQ3 * (c.q + c.r / 2), cy = HEX_SIZE_M * 1.5 * c.r, pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    const p = toLatLng(cx + HEX_SIZE_M * Math.cos(a), cy + HEX_SIZE_M * Math.sin(a));
    pts.push([p.lat, p.lng]);
  }
  return pts;
}
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
// الحلقة k حول السداسي: k=0 هو نفسو، k=1 السداسيات الست المجاورة، k=2 الاثنا عشر اللي بعدهم...
export function ring(c, k) {
  if (k === 0) return [{ q: c.q, r: c.r }];
  const out = [];
  let q = c.q + DIRS[4][0] * k, r = c.r + DIRS[4][1] * k;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < k; step++) { out.push({ q, r }); q += DIRS[side][0]; r += DIRS[side][1]; }
  }
  return out;
}
export function cellDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function metersBetween(a, b) {
  const x = (b.lng - a.lng) * M_LNG, y = (b.lat - a.lat) * M_LAT;
  return Math.sqrt(x * x + y * y);
}
// كل سداسيات المدينة (داخل CITY_RADIUS_M)
export function cityCells() {
  const maxK = Math.ceil(CITY_RADIUS_M / (HEX_SIZE_M * SQ3 * 0.5)) + 1;
  const origin = latLngToCell(CITY_CENTER.lat, CITY_CENTER.lng), out = [];
  for (let k = 0; k <= maxK; k++) for (const c of ring(origin, k)) {
    const p = cellCenter(c);
    if (metersBetween(CITY_CENTER, p) <= CITY_RADIUS_M) out.push(c);
  }
  return out;
}
// البحث بالحلقات: سداسي الطلب ← الست المجاورين ← الحلقة 2 ... ؛ كيرجع أول حلقة فيها مرشح (أقرب مسافة داخلها)
// drivers: [{id, lat, lng, ...}] — dest: {lat, lng}
export function searchByRings(dest, drivers, maxRing = MAX_SEARCH_RING) {
  const origin = latLngToCell(dest.lat, dest.lng);
  const byCell = new Map();
  for (const d of drivers) {
    const id = cellId(latLngToCell(d.lat, d.lng));
    if (!byCell.has(id)) byCell.set(id, []);
    byCell.get(id).push(d);
  }
  for (let k = 0; k <= maxRing; k++) {
    const found = [];
    for (const c of ring(origin, k)) { const arr = byCell.get(cellId(c)); if (arr) found.push(...arr.map((d) => ({ ...d, cell: cellId(c) }))); }
    if (found.length) {
      found.sort((a, b) => metersBetween(dest, a) - metersBetween(dest, b));
      return { driver: found[0], ring: k, originCell: cellId(origin), candidates: found.length };
    }
  }
  return null;
}
