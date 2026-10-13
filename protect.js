// protect.js — حماية خفيفة من النسخ اليدوي (رادع فقط، ماشي حماية مطلقة: أي محتوى كيبان فالمتصفح كيتقدر ينقل)
// كيمنع نسخ/قص/سحب المحتوى خارج الحقول، وكيمنع سحب الصور. الحقول (input/textarea) وعناصر .selectable كتبقى خدامة عادي.
(function () {
  function allowed(t) {
    return !!(t && t.closest && t.closest("input,textarea,select,[contenteditable='true'],.selectable"));
  }
  ["copy", "cut"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (allowed(e.target) || allowed(document.activeElement)) return;
      e.preventDefault();
    });
  });
  document.addEventListener("dragstart", function (e) {
    if (!allowed(e.target)) e.preventDefault();
  });
  // الصور: بلا سحب ولا حفظ بالضغط المطوّل
  function lockImages(root) {
    var imgs = (root || document).querySelectorAll("img:not([draggable])");
    for (var i = 0; i < imgs.length; i++) imgs[i].setAttribute("draggable", "false");
  }
  lockImages();
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; lockImages(); }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
