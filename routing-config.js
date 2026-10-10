// routing-config.js — إعدادات خدمة المسارات الخارجية.
// الافتراضي: OSRM العمومي (مجاني، بدون مفتاح). للإنتاج الثقيل استعمل مزوداً بمفتاح (ORS / Mapbox / GraphHopper)
// أو سيرفر OSRM خاص بك. إن فشل المزود يجرّب التالي، وإن فشلوا كلهم يرسم خطاً مستقيماً كاحتياط.
export const ROUTING = {
  // ترتيب المحاولة
  providers: ["ors", "mapbox", "graphhopper", "osrm"],
  keys: {
    ors: "",         // https://openrouteservice.org  (مجاني: 2000 طلب/يوم)
    mapbox: "",      // https://www.mapbox.com  (access token)
    graphhopper: "", // https://www.graphhopper.com
  },
  osrmUrl: "https://router.project-osrm.org", // غيّره لسيرفرك الخاص إن أردت
  profile: "driving",     // driving | cycling | walking
  minMoveMeters: 40,      // لا نعيد حساب المسار إلا بعد تحرك السائق هذه المسافة
  minIntervalMs: 15000,   // وحدّ أدنى بين طلبين
  timeoutMs: 8000,
};
