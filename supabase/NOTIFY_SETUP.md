# إشعارات زمزم — دليل مختصر

إشعارات تلقائية لحدثين على جدول `requests` (عبر Database Webhook → Edge Function `notify`):

| الحدث | المُبلَّغ | القنوات |
|------|----------|---------|
| INSERT لطلب صرف (`disb`) | المحاسب | إيميل + واتساب |
| UPDATE برفع `transfer_image` لأول مرة | صاحب الطلب (الموظف) | إيميل (+ مرفق إثبات التحويل) + واتساب |

## القنوات
- **إيميل:** Gmail SMTP عبر `nodemailer` — المُرسِل `portal.zamzam@gmail.com` بـ App Password. تصميم بهوية زمزم (لوجو + ألوان + زر «Open Portal»).
- **واتساب:** CallMeBot المجاني — كل مستخدم له `apikey` خاص بعد تفعيله على موبايله (رقم خدمة CallMeBot الحالي: `+34 611 08 28 80`، رسالة التفعيل: `I allow callmebot to send me messages`).

## الأسرار في Supabase (Edge Functions → Secrets)
- `GMAIL_USER` = `portal.zamzam@gmail.com`
- `GMAIL_APP_PASSWORD` = App Password (١٦ حرف بدون مسافات)
- (تلقائيًا متوفّرة: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — تُستخدم لجلب صورة إثبات التحويل)
- اختياري: `WEBHOOK_SECRET`, `EMAIL_FROM_NAME`, `PORTAL_URL`

## قاعدة البيانات
شغّل [schema-notify.sql](schema-notify.sql) (عمود `transfer_seen` + الأعمدة اللازمة).

## إضافة موظف للواتساب
1. الموظف يفتح `https://wa.me/34611082880` ويبعت `I allow callmebot to send me messages`.
2. يوصله `apikey` → ضيف `phone` (بصيغة دولية بدون +) و `wa_apikey` في `DIRECTORY` داخل [functions/notify/index.ts](functions/notify/index.ts).
3. أعد نشر الوظيفة (الصق الكود في Dashboard → Deploy).

## نشر التعديلات
تعديل كود الوظيفة → Supabase Dashboard → Edge Functions → `notify` → الصق الكود → **Deploy**.
