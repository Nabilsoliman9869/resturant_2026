/*
  فحص جدول وارد الرسائل بين الأقسام (جرس أحمر / role-inbox).
  المنطق في الخادم: dbo.MAT3AM_RESTAURANT_ROLE_INBOX
  عمود الأدوار: TargetRolesJson = JSON مصفوفة نصية صغيرة مثل ["kitchen","cashier"]
*/

-- 1) هل الجدول موجود؟
SELECT OBJECT_ID(N'dbo.MAT3AM_RESTAURANT_ROLE_INBOX', N'U') AS TableObjectId;
-- إذا NULL → الخادم يستخدم ملف config/restaurant/role_inbox فقط؛ نفّذ تهيئة SQL من التطبيق (مطوّر → تهيئة SQL).

-- 2) أعمدة الجدول (مقارنة مع الكود المتوقعة)
SELECT c.name AS ColumnName, t.name AS DataType, c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.MAT3AM_RESTAURANT_ROLE_INBOX')
ORDER BY c.column_id;

-- 3) آخر صفوف غير مُكمّمة (التي يجب أن تظهر في الواجهة)
SELECT TOP 30
  Id,
  AlertType,
  Title,
  TargetRolesJson,
  TableId,
  OrderId,
  SourceKey,
  CreatedAt,
  DismissedAt
FROM dbo.MAT3AM_RESTAURANT_ROLE_INBOX
WHERE DismissedAt IS NULL
ORDER BY CreatedAt DESC;

-- 4) عدّ الصفوف النشطة لكل دور (يدوي: ابحث داخل النص عن "kitchen" إذا لم يكن لديكm OPENJSON)
SELECT COUNT(*) AS ActiveRows FROM dbo.MAT3AM_RESTAURANT_ROLE_INBOX WHERE DismissedAt IS NULL;

-- إن كان SQL Server يدعم OPENJSON:
/*
SELECT DISTINCT j.value AS TargetRoleNorm
FROM dbo.MAT3AM_RESTAURANT_ROLE_INBOX ri
CROSS APPLY OPENJSON(ri.TargetRolesJson) AS j
WHERE ri.DismissedAt IS NULL;
*/

-- 5) صف تجريبي يدوي اختياري (احذفه بعد التجربة)
/*
DECLARE @id UNIQUEIDENTIFIER = NEWID();
INSERT INTO dbo.MAT3AM_RESTAURANT_ROLE_INBOX
  (Id, AlertType, Title, BodyText, TargetRolesJson, TableId, OrderId, SourceKey, CreatedAt, DismissedAt)
VALUES
  (@id, N'waiter_summon', N'اختبار SQL — مطبخ', N'رسالة تجريبة', N'["kitchen"]', NULL, NULL, N'test-sql-manual:' + CAST(@id AS NVARCHAR(50)), SYSUTCDATETIME(), NULL);

SELECT * FROM dbo.MAT3AM_RESTAURANT_ROLE_INBOX WHERE Id = @id;
*/
