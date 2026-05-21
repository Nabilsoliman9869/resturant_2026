# Debug Session: railway-response-speed

- Status: OPEN
- Symptom: قياس سرعة الاستجابة الحية على Railway بعد استقرار startup
- Scope: `__whoami__`, `api/ping`, صفحة `captain-tables`, وأهم طلبات البيانات المرتبطة بها

## Hypotheses

1. المسارات الخفيفة على Railway أصبحت مستقرة وسريعة بعد إصلاح startup.
2. بعض endpoints الثقيلة فقط هي التي ترفع زمن فتح الصفحة.
3. هناك تذبذب ملحوظ بين الطلبات المتكررة على نفس endpoint.
4. الصفحة HTML قد تفتح سريعاً بينما الطلبات اللاحقة داخلها هي مصدر البطء.
