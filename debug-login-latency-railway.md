# Debug Session: login-latency-railway

- Status: OPEN
- Symptom: تأخير كبير عند تسجيل الدخول على Railway ثم فشل/تعثر بعد الانتظار
- Scope: صفحة `/login` ومسارات `api/auth/*` وما يرتبط بها من DB/kash/session

## Hypotheses

1. طلب `POST /api/auth/login` بطيء بسبب قراءة SQL أو تهيئة schema داخل مسار الدخول.
2. الواجهة ترسل طلب الدخول ثم تنتظر طلبات لاحقة أبطأ فتبدو عملية الدخول نفسها بطيئة.
3. هناك fallback أو retry داخل مسار التحقق من المستخدم/الدور يضاعف الزمن على Railway.
4. session/token أو إعدادات shared terminal تضيف قراءة SQL إضافية بعد نجاح كلمة المرور.
