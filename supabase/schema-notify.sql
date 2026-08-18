-- ═══════════════════════════════════════════════════════════════
--  إشعارات التحويل وطلبات الصرف — أعمدة قاعدة البيانات
--  شغّل المحتوى ده في:  Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1) عمود تتبّع "تم إشعار صاحب الطلب داخل البورتال" — على مستوى الحساب
--    (يمنع تكرار رسالة "تم تحويل طلبك" على أي جهاز أو متصفح)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS transfer_seen BOOLEAN DEFAULT FALSE;

-- 1ب) مسار PDF لمستند الطلب (يُولّد عند التقديم ويُرفق في إيميلات الإشعار)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_pdf TEXT;

-- 2) (اختياري) أعمدة قديمة لازمة للنظام لو لسه مش موجودة
ALTER TABLE requests ADD COLUMN IF NOT EXISTS transfer_image  TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS attachments_data TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT FALSE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ملاحظة عن RLS:
--   لازم تكون سياسات UPDATE بتسمح للمستخدم المسجّل بتحديث transfer_seen.
--   لو الأرشيف والتعديل شغّالين عندك بالفعل، فالـ UPDATE هيشتغل بدون أي تغيير إضافي.
