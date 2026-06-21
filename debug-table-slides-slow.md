# Debug Session: table-slides-slow
- **Status**: [FIXED]
- **Issue**: بطء وتهنيج في تحميل شرائح الطاولات يمنع تجربة المسارات التشغيلية.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-table-slides-slow.ndjson

## Reproduction Steps
1. فتح شاشة الطاولات أو شاشة الطلب المرتبطة بالطاولة.
2. الضغط على شريحة الطاولة أو التنقل بين الشرائح التشغيلية.
3. ملاحظة البطء أو التهنيج قبل اكتمال التفاعل.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | الواجهة تعيد حسابات ثقيلة أو render متكرر عند فتح شريحة الطاولة | High | Med | Partial: loadTables start سُجل مرتين، لكن لم تظهر استجابة snapshot من المتصفح |
| B | طلبات API المرتبطة ببيانات الطاولة بطيئة أو تتسلسل بشكل يعلق التحميل | High | Med | Confirmed: operational-snapshot / tables / table-sessions timeout 25s+ |
| C | state مشترك داخل شاشة الطلب يسبب إعادة رسم واسعة عند أي تغيير صغير | Med | Med | Pending |
| D | توجد مزامنة أو أعمال جانبية داخل فتح الطاولة أو الشريحة نفسها | Med | Med | Pending |
| E | النسخة العاملة أو البيئة الحالية لا تطابق الكود الجاري، فيظهر بطء غير متسق | Med | Low | Confirmed: 2288 محجوز من PID مختلف ومنع تحميل النسخة المعدلة |

## Log Evidence
- `.dbg/trae-debug-log-table-slides-slow.ndjson`
  - `WaiterTablesPage.tsx:loadTables:start` سُجل مرتين عند فتح صفحة الشرائح.
  - لم يصل `loadTables:snapshot` ولا `loadTables:success` من نفس الجولة.
- قياسات HTTP مباشرة:
  - `/api/restaurant/operational-snapshot?includeUsers=true` timeout بعد ~29152ms
  - `/api/restaurant/tables` timeout بعد ~26034ms
  - `/api/restaurant/table-sessions?status=active` timeout بعد ~25984ms
  - `/api/auth/users` نجح بعد ~25386ms
  - `/api/mat3am/client-timing` نجح بعد ~38354ms وأعاد:
    - `floor_plan_get ≈ 929.9ms`
    - `tables_get ≈ 3917.3ms`
    - `operational_snapshot ≈ 11846.9ms`
- محاولة تشغيل النسخة المعدلة من `backend/api_server.py` فشلت لأن `2288` كان محجوزًا مسبقًا:
  - `WinError 10048`
  - العملية المالكة الحالية: `PID 10376`
- بعد قتل العملية القديمة على `2288` وتشغيل نسخة المشروع الحالية:
  - `/api/ping` عاد خلال ~243ms
  - `/api/restaurant/operational-snapshot?includeUsers=true` عاد `200` خلال ~3664ms
  - `/api/restaurant/tables` عاد `200` خلال ~256ms
  - `/api/restaurant/table-sessions?status=active` عاد `200` خلال ~439ms
- instrumentation الخلفية بعد التشغيل الصحيح أظهرت:
  - `restaurant sql bulk done` ≈ `842.3ms` لأول تحميل ثم ≈ `12.4ms` لاحقًا
  - `snapshot preload done` ≈ `1574.6ms`
  - `snapshot tables payload done` ≈ `2015.2ms`
  - `snapshot users loaded` ≈ `2579ms`
  - `snapshot sync done` ≈ `2676.5ms`
- المتصفح المدمج فتح `http://127.0.0.1:9999/app/developer/captain-tables` بنجاح بعد إعادة تشغيل `9999`

## Verification Conclusion
- السبب الأوضح حتى الآن: كانت توجد عملية قديمة/عالقة على `2288` تسببت في بطء كارثي وعدم اتساق بين الكود الجاري والنسخة العاملة.
- بعد استبدالها بنسخة المشروع الحالية، اختفى عنق الزجاجة الأساسي وعادت مسارات الطاولات والجلسات إلى أزمنة مقبولة.
- ما بقي ليس تهنيجًا كارثيًا بل حمل طبيعي نسبيًا داخل `operational snapshot`، وأبطأ جزء فيه حاليًا هو `preload + users` في أول تحميل.
