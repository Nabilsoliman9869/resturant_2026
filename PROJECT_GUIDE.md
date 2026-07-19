# دليل المشروع — مطعم POS / KDS

## نظرة عامة

مشروع **مطعم متكامل** يتكون من:
- **Frontend:** React + TypeScript (Vite)
- **Backend:** Python FastAPI (Uvicorn)
- **Database:** SQL Server (TBLxxx tables)
- **Storage محلي:** JSON files (`data/*.json`)

---

## هيكل الملفات الرئيسية

| الملف | الوظيفة |
|-------|---------|
| `backend/api_server.py` | السيرفر الرئيسي (28,000+ سطر). يحتوي على كل الـ endpoints |
| `backend/mat3am_sql_cache.py` | Cache لجداول SQL (TBL005, TBL006, TBL007...) |
| `src/App.tsx` | Router + AuthContext |
| `src/lib/apiBase.ts` | تحديد عنوان API (localhost أو IP) |
| `src/auth/AuthContext.tsx` | صلاحيات المستخدمين والأدوار |
| `run_api.bat` | تشغيل السيرفر (Port 2288) 

### صفحات Frontend الرئيسية

| الصفحة | المسار | الوظيفة |
|--------|--------|---------|
| `KitchenPage.tsx` | `/kitchen` | شاشة المطبخ (KDS) — عرض الطلبات + عداد التحضير |
| `WaiterOrderPage.tsx` | `/waiter-order` | جرسون الطلبات — إضافة بنود + إرسال للمطبخ |
| `RunnerPage.tsx` | `/runner` | مناديب التوصيل — استلام جاهز + تسليم للطاولة |
| `CashierPayInvoiceModal.tsx` | مودال | الكاشير — تسديد فواتير + ترحيل للحساب |
| `TableSessionsReportPage.tsx` | `/table-sessions-report` | تقرير الجلسات + أوقات التحضير |
| `TablesLayoutPage.tsx` | `/tables` | خريطة الطاولات |
| `PosAdminPage.tsx` | `/pos-admin` | إعدادات المطعم |

---

## قواعد العمل (Business Rules)

### 1. الجلسات (Sessions)

- عند **فتح جلسة جديدة** (`POST /api/restaurant/table-sessions`):
  - يُقرأ `minimumChargePerSeat` من:
    1. شريحة الطاولة (`tables.json → minimumCharge`) إن كانت > 0
    2. الإعدادات العامة (`ops-settings → tableDefaultMinimumCharge`) كـ fallback
  - **لا يُمحى** القيمة المخصصة على الشريحة عند فتح جلسة جديدة (تم إصلاحه)

### 2. الطلبات (Orders)

- **إنشاء طلب:** `POST /api/restaurant/orders`
  - يُدمج على طلب مفتوح لنفس الجلسة/الطاولة
  - يُحسب `prepTargetMinutes` تلقائياً من:
    1. أوقات البنود الفردية (`TBL007.Hieght3`)
    2. إعدادات KDS (`prepTargetMinutes`) كـ fallback
- **تحديث حالة الطلب:** `PATCH /api/restaurant/orders/{id}/status`
  - `preparing` → يضبط `prepStartTime`
  - `ready` → يضبط `prepEndTime` + يعلّم البنود `prepared`
  - `served/paid` → يضبط `completedAt` + يحسب `kpiLeadMinutes`

### 3. المطبخ (KDS)

- **KitchenPage.tsx** تعرض الطلبات التي status ∈ {pending, preparing, ready}
- **عداد التحضير:** يبدأ من `prepStartTime` (وليس `createdAt`)
- **زر "إرسال"** في KDS (`POST …/items/{lineId}/send`):
  - يضبط `handoffAt` فقط
  - **لا يُعدّل** `sent` أو `status`
  - الطلب يبقى `ready` حتى يأتي المناديب (`RunnerPage`) ويضغط "تسليم"
- **التسليم التلقائي:** إذا كان `workflow.deliverFromKitchenBy` ليس `server/waiter/manager/host`، يتم التسليم تلقائياً

### 4. الفوترة (Invoices)

- **طلب الحساب:** `POST /api/restaurant/sessions/request-bill`
  - يُلغي البنود التي لم تبدأ بالمطبخ (`cancelled`)
  - يرفض إذا بقي طلب بدأ التحضير ولم يُسلَّم (`blockers`)
  - يجمع الطلبات المفتوحة → فاتورة SQL
  - يضبط `finalInvoiceId` على الطلبات
- **تسديد الكاشير:** `POST /api/restaurant/invoices-local/pay`
- **ترحيل للحساب:** `POST /api/restaurant/invoices-local/mark-on-account`

### 5. التقارير

- **TableSessionsReportPage:**
  - يقرأ الجلسات + الطلبات + الطاولات
  - يحسب `totalCost`, `serviceCharge`, `vatValue`, `grandTotal`
  - يعرض `kpiLeadMinutes` للطلبات المُسلَّمة

---

## الأخطاء التي تم إصلاحها حديثاً

### أوقات التحضير (Kitchen Prep Time)

| المشكلة | الإصلاح | الملف |
|---------|---------|-------|
| العداد يبدأ من `createdAt` بدلاً من `prepStartTime` | أولوية `prepStartTime` كبداية | `KitchenPage.tsx:205` |
| العداد لا يعمل إلا عند `status === preparing` | تمرير `prepStartTime` دائماً إن وُجد | `KitchenPage.tsx:327` |
| `prepTargetMinutes` غير مُثبّت عند إنشاء الطلب | استخدام KDS defaults كـ fallback | `api_server.py:23817, 25948, 25963` |
| `kpiLeadMinutes` لا يُحسب عند `served/paid` | إضافة حساب تلقائي | `api_server.py:26042` |

### Minimum Charge

| المشكلة | الإصلاح | الملف |
|---------|---------|-------|
| القيمة المخصصة على الشريحة تُمحى عند فتح جلسة | عدم المس إذا `minimumCharge > 0` | `api_server.py:19640` |

### ترحيل الطلبات

**المشكلة المفتوحة:**
- زر "إرسال" في KDS يضع `handoffAt` فقط → الطلب يبقى `ready`
- طلب الحساب يرفض إذا بقي طلب `ready` غير مُسلَّم (`sent === false`)
- **الحل المطلوب:** إما:
  1. تعديل `request-bill` ليقبل `handoffAt` كـ "تم التسليم"
  2. أو تعديل `POST …/send` ليضبط `sent = True` + `status = "served"`

---

## Endpoints الرئيسية

### Sessions
```
GET  /api/restaurant/table-sessions
POST /api/restaurant/table-sessions          # فتح جلسة
POST /api/restaurant/sessions/{id}/close     # إغلاق جلسة
POST /api/restaurant/sessions/request-bill     # طلب الحساب
```

### Orders
```
GET    /api/restaurant/orders
POST   /api/restaurant/orders                  # إنشاء طلب
PATCH  /api/restaurant/orders/{id}/status      # تحديث حالة
PATCH  /api/restaurant/orders/{id}/items/{lid} # تحديث بند
POST   /api/restaurant/orders/{id}/items/{lid}/send  # إرسال من المطبخ
```

### Invoices
```
POST /api/restaurant/invoices                  # إنشاء فاتورة
POST /api/restaurant/invoices-local/pay        # تسديد
POST /api/restaurant/invoices-local/mark-on-account  # ترحيل
```

### Settings
```
GET  /api/restaurant/ops-settings              # إعدادات المطعم
GET  /api/restaurant/kds-settings              # إعدادات KDS
```

---

## نوصي الوكالة الجديدة بـ

1. **قبل أي تعديل:** افهم `_kds_refresh_order_status()` — هذه الدالة تُحدّث حالة الطلب تلقائياً بناءً على حالة البنود.
2. **لا تُغيّر** `_kds_normalize_item()` بدون فهم شامل — كل الحالات (prepared/sent/cancelled) مترابطة.
3. **اختبر** كل تعديل عبر:
   - إنشاء طلب → التحقق من `prepTargetMinutes`
   - تحديث حالة → التحقق من `prepStartTime` و `kpiLeadMinutes`
   - طلب الحساب → التحقق من عدم وجود `blockers`
4. **Minimum Charge:** الأولوية دائماً للشريحة المخصصة ثم الإعدادات العامة.
5. **KDS → الفاتورة:** التسليم يمر بمرحلتين: `handoffAt` (مطبخ) ثم `sent` (مناديب/تلقائي).

---

## اتصال محلي

- **Server IP:** `192.168.100.8`
- **Port:** `2288`
- **Firewall:** افتح البورت عبر PowerShell:
  ```powershell
  netsh advfirewall firewall add rule name="Mat3am API" dir=in action=allow protocol=tcp localport=2288
  ```

---

*آخر تحديث: 27 يونيو 2026*
