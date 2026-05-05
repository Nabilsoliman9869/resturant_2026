-- توحيد CardGuide بين TBL005 و TBL016 للبيانات القديمة:
-- حيث يطابق اسم مركز التكلفة اسم العميل، ننسخ معرف البطاقة من العميل إلى مركز التكلفة.
-- نفّذ على نسخة احتياطية أولاً وراجع الصفوف المتأثرة.

UPDATE t5
SET t5.CardGuide = t16.CardGuide
FROM dbo.TBL005 AS t5
INNER JOIN dbo.TBL016 AS t16
  ON RTRIM(LTRIM(ISNULL(t16.AgentName, N''))) = RTRIM(LTRIM(ISNULL(t5.CostCenter, N'')))
WHERE t5.CardGuide IS NOT NULL
  AND t16.CardGuide IS NOT NULL
  AND t5.CardGuide <> t16.CardGuide;
