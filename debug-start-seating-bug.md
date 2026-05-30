# Debug Session: start-seating-bug [OPEN]

## Symptom
- زر `ابدأ التسكين` لا يعمل.

## Scope
- تشخيص سببي مع جمع أدلة تشغيلية قبل أي إصلاح منطقي.

## Hypotheses
- H1: طلب إنشاء الجلسة لا يخرج من الواجهة أصلًا بسبب شرط UI أو state معطل.
- H2: الطلب يخرج لكن endpoint الخلفي يفشل أو يرجع خطأ غير ظاهر للمستخدم.
- H3: إنشاء الجلسة ينجح لكن تحديث حالة الطاولة أو إعادة تحميل الشرائح يفشل، فيبدو أن الزر لا يعمل.
- H4: هناك اختلاف بين اسم/معرف الطاولة الممرر من الشريحة وبين ما يتوقعه الخادم.
- H5: الطلب يتأثر ببيانات تشغيل محلية قديمة أو جلسة نشطة سابقة على نفس الطاولة.

## Current Status
- Session opened.
- Runtime evidence collected.

## Evidence
- `GET /api/settings/shared-terminal` أكد أن `sharedTerminalEnabled=false`؛ إذن فرضية PIN/terminalToken مرفوضة.
- إعادة تنفيذ `POST /api/restaurant/table-sessions` أعادت `500` قبل الإصلاح.
- وُجدت بقايا debug قديمة في:
  - `restaurant_create_session`
  - `_restaurant_save`
  - `_restaurant_sql_set`
- هذه الأسطر كانت تستدعي `http://127.0.0.1:7777/event` اعتمادًا على `.dbg/send-order-stuck.env`.
- فحص `http://127.0.0.1:7777/health` فشل: `Unable to connect to the remote server`.
- بعد إزالة هذه الاستدعاءات من مسار التسكين والحفظ، ظهر في `GET /api/restaurant/table-sessions?status=active` سجل نشط للطاولة `T15`.

## Conclusion
- H1 مرفوضة: الطلب يخرج من الواجهة.
- H2 مؤكدة: الباك إند كان يسقط بـ `500`.
- H3 مرفوضة للحالة الحالية: بعد الإصلاح ظهرت الجلسة النشطة نفسها.
- H4 غير مدعومة بالدليل الحالي.
- H5 ليست السبب المباشر الحالي.

## Fix Applied
- إزالة instrumentation debug المتبقي من جلسة `send-order-stuck` داخل:
  - `POST /api/restaurant/table-sessions`
  - `_restaurant_save`
  - `_restaurant_sql_set`

## Next Step
- التحقق من الواجهة يدويًا عبر زر `ابدأ التسكين`.
