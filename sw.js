// Service Worker — Bio Nutrition PV PWA
// نسخة بسيطة: تخلّي التطبيق قابل للتثبيت، وتسرّع فتح الملفات الثابتة.
// ملاحظة: البيانات (Supabase) دايمًا من النت — مابنعملهاش cache.

const CACHE = 'bionutrition-pv-v36';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/styles.css',
  './assets/fonts/font-3835919ff0bd.woff2',
  './assets/fonts/font-0305c87c8230.woff2',
  './assets/fonts/font-7b57f8d314ea.woff2',
  './assets/js/script-1.js',
  './assets/js/script-2.js',
  './assets/js/script-3.js',
  './assets/js/script-4.js',
  './assets/js/script-5.js',
  './assets/images/bn-logo.png',
  './assets/images/bn-emblem.png',
  './assets/images/stamp.png',
  './assets/images/signature.png',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
  './assets/images/icon-180.png',
];

// تثبيت: نخزّن ملفات الواجهة
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

// تفعيل: نمسح الكاش القديم
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// الطلبات: أي حاجة من Supabase أو خارجية تروح للنت مباشرة؛ ملفات الموقع: كاش أولاً ثم النت
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // الكتابة دايمًا للنت
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Supabase وغيره: من النت
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => {
      // fallback الصفحة يخصّ التنقّل بس — لو رجّعناه لطلب خط/صورة الملف بيتقرا HTML ويبوظ
      if (req.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }))
  );
});
