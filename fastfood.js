// fastfood.js — قسم الفاست فود للزبون: صور فئات قابلة للضغط ← نافذة أصناف ← اختيار الحجم/السعر ← السلة
import { db } from "./firebase.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getLang } from "./i18n.js";

let cats = [], items = [], sig = "", ui = null; // ui = {cat, item, size, qty, ex:Set}
const L = () => getLang() === "fr";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Math.round(n).toLocaleString(L() ? "fr-FR" : "ar-MA") + (L() ? " DH" : " درهم");
const nm = (o) => (L() && o.nameFr ? o.nameFr : o.name);
const SIZE_FR = { "صغيرة": "Petite", "صغير": "Petit", "متوسطة": "Moyenne", "متوسط": "Moyen", "كبيرة": "Grande", "كبير": "Grand", "عائلية": "Familiale" };
const sl = (s) => (L() ? s.labelFr || SIZE_FR[s.label] || s.label : s.label);
const T = () => L()
  ? { title: "Fast Food", sub: "Choisissez votre plat préféré", from: "dès", pick: "Choisissez la taille", extras: "Suppléments (optionnel)", qty: "Quantité", add: "Ajouter au panier", back: "Retour", close: "Fermer", none: "Aucun plat disponible pour le moment" }
  : { title: "الفاست فود", sub: "اختر وجبتك المفضلة", from: "من", pick: "اختر الحجم", extras: "إضافات (اختياري)", qty: "الكمية", add: "أضف إلى السلة", back: "رجوع", close: "إغلاق", none: "لا توجد أصناف متاحة حالياً" };
const sortBy = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name));
const liveCats = () => cats.filter((c) => c.enabled !== false && items.some((i) => i.catId === c.id && i.enabled !== false && (i.sizes || []).length)).sort(sortBy);
const liveItems = (cid) => items.filter((i) => i.catId === cid && i.enabled !== false && (i.sizes || []).length).sort(sortBy);

function ensureSection() {
  let s = document.getElementById("fastFoodSection");
  if (!s) {
    const menu = document.getElementById("menu");
    if (!menu) return null;
    s = document.createElement("section");
    s.id = "fastFoodSection";
    s.style.cssText = "margin:0 0 22px";
    menu.parentNode.insertBefore(s, menu);
  }
  return s;
}
function renderSection() {
  const list = liveCats();
  const key = (L() ? "fr" : "ar") + JSON.stringify(list.map((c) => [c.id, c.name, c.nameFr, c.image && c.image.length]));
  if (key === sig) return;
  sig = key;
  const s = ensureSection();
  if (!s) return;
  if (!list.length) { s.innerHTML = ""; s.style.display = "none"; return; }
  s.style.display = "";
  const t = T();
  s.innerHTML = '<style>#fastFoodSection .ff-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}' +
    '#fastFoodSection .ff-tile{border:0;background:#fff;border-radius:22px;padding:0;overflow:hidden;box-shadow:0 4px 14px #0f172a1a;cursor:pointer;text-align:center;transition:transform .15s}' +
    '#fastFoodSection .ff-tile:active{transform:scale(.97)}#fastFoodSection .ff-tile img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#f5f5f4}' +
    '#fastFoodSection .ff-tile b{display:block;padding:9px 6px 11px;font-size:14px;font-weight:800;color:var(--primary)}</style>' +
    '<h2 style="margin:0 0 4px;color:var(--primary);font-size:20px;font-weight:900">🍔 ' + t.title + '</h2><p style="margin:0 0 12px;color:var(--muted);font-size:13px">' + t.sub + "</p>" +
    '<div class="ff-grid">' + list.map((c) => '<button type="button" class="ff-tile" data-ffcat="' + esc(c.id) + '">' + (c.image ? '<img src="' + esc(c.image) + '" alt="' + esc(nm(c)) + '" loading="lazy" decoding="async">' : '<div style="aspect-ratio:1/1;background:#f5f5f4"></div>') + "<b>" + esc(nm(c)) + "</b></button>").join("") + "</div>";
  s.querySelectorAll("[data-ffcat]").forEach((b) => (b.onclick = () => open(b.dataset.ffcat)));
}

function modal() {
  let m = document.getElementById("ffModal");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.id = "ffModal";
    m.innerHTML = '<div class="modal-box" id="ffBox" role="dialog" aria-modal="true"></div>';
    m.addEventListener("click", (e) => { if (e.target === m) closeM(); });
    document.body.appendChild(m);
  }
  return m;
}
function closeM() { ui = null; const m = document.getElementById("ffModal"); if (m) m.classList.remove("show"); }
function open(catId) { ui = { cat: catId, item: null, size: 0, qty: 1, ex: new Set() }; modal().classList.add("show"); draw(); }

function draw() {
  if (!ui) return;
  const box = document.getElementById("ffBox"), t = T();
  const cat = cats.find((c) => c.id === ui.cat);
  const head = (title, back) => '<div class="modal-head">' + (back ? '<button type="button" class="close" id="ffBack" aria-label="' + t.back + '">' + (L() ? "←" : "→") + "</button>" : "") + "<h3>" + esc(title) + '</h3><button type="button" class="close" id="ffX" aria-label="' + t.close + '">×</button></div>';
  if (!ui.item) {
    const list = liveItems(ui.cat);
    box.innerHTML = head(cat ? nm(cat) : t.title, false) +
      (list.length ? '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">' + list.map((i) => {
        const min = Math.min(...i.sizes.map((s) => Number(s.price) || 0));
        return '<button type="button" data-ffi="' + esc(i.id) + '" style="border:1px solid var(--border);background:#fff;border-radius:18px;padding:0;overflow:hidden;cursor:pointer;text-align:center">' +
          (i.image ? '<img src="' + esc(i.image) + '" alt="" loading="lazy" style="display:block;width:100%;aspect-ratio:4/3;object-fit:cover">' : '<div style="aspect-ratio:4/3;background:#f5f5f4"></div>') +
          '<div style="padding:8px 6px 10px"><b style="display:block;font-size:14px;color:var(--text)">' + esc(nm(i)) + '</b><span style="font-size:13px;color:var(--primary-light);font-weight:800">' + t.from + " " + money(min) + "</span></div></button>";
      }).join("") + "</div>" : '<div class="empty">' + t.none + "</div>");
    box.querySelectorAll("[data-ffi]").forEach((b) => (b.onclick = () => { ui.item = b.dataset.ffi; ui.size = 0; ui.qty = 1; ui.ex = new Set(); draw(); }));
  } else {
    const it = items.find((i) => i.id === ui.item);
    if (!it) { ui.item = null; return draw(); }
    const sz = it.sizes[ui.size] || it.sizes[0];
    const exs = (cat && cat.extras) || [];
    const exSum = [...ui.ex].reduce((a, k) => a + (exs[k] ? Number(exs[k].price) || 0 : 0), 0);
    const unit = (Number(sz.price) || 0) + exSum;
    const desc = L() && it.descriptionFr ? it.descriptionFr : it.description;
    box.innerHTML = head(nm(it), true) +
      (it.image ? '<img src="' + esc(it.image) + '" alt="" style="display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:18px;margin-bottom:12px">' : "") +
      (desc ? '<p style="margin:0 0 14px;color:var(--muted);font-size:14px;line-height:1.6">' + esc(desc) + "</p>" : "") +
      '<h4 style="margin:0 0 8px;color:var(--primary)">' + t.pick + "</h4><div style=\"display:flex;flex-direction:column;gap:8px\">" +
      it.sizes.map((s, k) => '<button type="button" data-ffs="' + k + '" style="display:flex;justify-content:space-between;align-items:center;min-height:48px;padding:10px 14px;border-radius:14px;cursor:pointer;font:800 15px inherit;border:2px solid ' + (k === ui.size ? "var(--primary)" : "var(--border)") + ";background:" + (k === ui.size ? "#f0fdf4" : "#fff") + ';color:var(--text)"><span>' + (k === ui.size ? "● " : "○ ") + esc(sl(s)) + "</span><span>" + money(Number(s.price) || 0) + "</span></button>").join("") + "</div>" +
      (exs.length ? '<h4 style="margin:16px 0 8px;color:var(--primary)">' + t.extras + '</h4><div style="display:flex;flex-direction:column;gap:8px">' + exs.map((e, k) => '<button type="button" data-ffe="' + k + '" style="display:flex;justify-content:space-between;align-items:center;min-height:48px;padding:10px 14px;border-radius:14px;cursor:pointer;font:800 15px inherit;border:2px solid ' + (ui.ex.has(k) ? 'var(--primary)' : 'var(--border)') + ';background:' + (ui.ex.has(k) ? '#f0fdf4' : '#fff') + ';color:var(--text)"><span>' + (ui.ex.has(k) ? '☑ ' : '☐ ') + esc(sl(e)) + '</span><span>+ ' + money(Number(e.price) || 0) + '</span></button>').join('') + '</div>' : '') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 12px"><b>' + t.qty + '</b><div class="qty"><button type="button" id="ffMinus" aria-label="-">−</button><b>' + ui.qty + '</b><button type="button" class="plus" id="ffPlus" aria-label="+">+</button></div></div>' +
      '<button type="button" class="checkout" id="ffAdd" style="width:100%">' + t.add + " — " + money(unit * ui.qty) + "</button>";
    box.querySelectorAll("[data-ffe]").forEach((b) => (b.onclick = () => { const k = Number(b.dataset.ffe); ui.ex.has(k) ? ui.ex.delete(k) : ui.ex.add(k); draw(); }));
    box.querySelectorAll("[data-ffs]").forEach((b) => (b.onclick = () => { ui.size = Number(b.dataset.ffs); draw(); }));
    box.querySelector("#ffMinus").onclick = () => { if (ui.qty > 1) { ui.qty--; draw(); } };
    box.querySelector("#ffPlus").onclick = () => { if (ui.qty < 20) { ui.qty++; draw(); } };
    box.querySelector("#ffAdd").onclick = () => {
      const id = "ff:" + it.id + ":" + ui.size + ":" + [...ui.ex].sort().join(","), q = ui.qty;
      closeM();
      window.add(id, q);
    };
  }
  const x = box.querySelector("#ffX"); if (x) x.onclick = closeM;
  const b = box.querySelector("#ffBack"); if (b) b.onclick = () => { ui.item = null; draw(); };
}

// ربط مع السلة: app.js كيستعمل هاد الدوال
window.ffCartItem = (id, qty) => {
  const [, iid, k, exStr] = id.split(":");
  const it = items.find((i) => i.id === iid);
  const sz = it && it.sizes && it.sizes[Number(k)];
  if (!it || it.enabled === false || !sz) return null;
  const c = cats.find((x) => x.id === it.catId);
  if (!c || c.enabled === false) return null;
  const exs = (c.extras || []), picked = (exStr ? exStr.split(",") : []).map(Number).filter((n) => exs[n]);
  const label = [sl(sz)].concat(picked.map((n) => "+ " + sl(exs[n]))).join(" ");
  const price = (Number(sz.price) || 0) + picked.reduce((a, n) => a + (Number(exs[n].price) || 0), 0);
  return { id, ff: true, name: nm(it) + " — " + label, price, image: it.image || "", qty };
};
window.ffRender = () => { renderSection(); };

const start = (col, set) => onSnapshot(collection(db, col), (s) => { set(s.docs.map((d) => ({ id: d.id, ...d.data() }))); sig = ""; renderSection(); if (ui) draw(); }, () => {});
start("fastFoodCats", (v) => (cats = v));
start("fastFoodItems", (v) => (items = v));
document.addEventListener("DOMContentLoaded", renderSection);
