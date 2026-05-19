# تشخيص بطء نقل البيانات من SQL — مطاعم

**الحالة:** جاهز للقياس  
**آخر تحديث:** 2026-05-20  
**أدوات:** `GET /api/mat3am/perf-probe` · `python scripts/bench_db_latency.py`

---

## 1. أسباب ملحوظة (من الكود — مرتبة بالأثر المتوقع)

### أ) فتح اتصال ODBC جديد لكل طلب (بدون Pool)

`get_connection()` في `backend/api_server.py` يستدعي `pyodbc.connect` ثم يُغلق الاتصال في `finally` تقريباً في كل endpoint.

على **Railway ↔ SQL Server بعيد**، handshake واحد قد يستغرق **2–15 ثانية**.  
عشر طلبات متوازية من الواجهة ≈ عشر اتصالات ≈ انطباع «النظام بطيء جداً».

**دليل في الكود:** `mat3am_sql_cache.py` يذكر صراحة «≈10–20 ثانية/طلب» قبل الكاش.

### ب) تحميل صفحة الطلب يطلق طلبات API كثيرة متوازية

`WaiterOrderPage` → `loadAll()` يستدعي معاً (من بين غيرها):

- `/api/products` — **مسح كامل لـ TBL007** + manifest صور  
- `/api/product-groups`  
- `/api/restaurant/tables` — TBL005 (كاش) + ملفات  
- `/api/restaurant/table-sessions` — تحميل جلسات + قد يفتح SQL لأسماء طاولات  
- `/api/agents`، إعدادات، مطبخ، floor-plan…

كل مسار SQL غالباً **اتصال مستقل**.

### ج) كاش محدود — لا يغطي المنتجات

| البيانات | كاش | TTL افتراضي |
|----------|-----|-------------|
| TBL005 (طاولات/مراكز تكلفة) | نعم (`mat3am_sql_cache`) | 120 ث |
| MAT3AM_APP_USERS | نعم | 90 ث |
| TBL007 (قائمة الأصناف) | **لا** | — |
| جلسات/طلبات في snapshot | bulk اتصال واحد | — |

بعد انتهاء TTL أو `cold=1`، أول جلب TBL005 بطيء ثم التالي سريع (<50ms من الذاكرة).

### د) استعلامات ثقيلة

- `GET /api/products` — `SELECT` كامل TBL007 بدون `TOP`  
- بحث عملاء/أصناف — `LIKE '%نص%'` (صعب على الفهارس)  
- `_restaurant_table_display_names_for_ids` — قد يعيد `SELECT` كامل TBL005 عند IDs غير موجودة في الملف  
- وصفات costing — نمط N+1 على TBL007  

### هـ) Polling من الواجهة (يضاعف الحمل)

| المكوّن | الفترة | المسار |
|---------|--------|--------|
| `WaiterTablesPage` / `FloorPlanLive` | **15 ث** | `operational-snapshot` |
| `RestaurantDualBells` | **3.5 ث** | role-inbox |
| `DbConnectionBar` | **12 ث** | `ready?check_db=1` (+ ping) |
| `WaiterOrderPage` | **12 ث** | جلسات + مطبخ + طلبات |

مع اتصال بطيء، كل poll قد يفتح ODBC من جديد (حسب المسار).

### و) تجريب ODBC/TLS

`odbc_driver.py` → `pyodbc_connect_compat` يجرّب عدة drivers وخيارات TLS عند الفشل — ممتاز للتوافق، لكنه يطيل زمن **أول** اتصال فاشل.

---

## 2. كيف تختبر بدقة (خطوة بخطوة)

### المتطلبات

1. API يعمل: `run_api.bat` أو `python backend/api_server.py` → منفذ **2288**  
2. `config/settings.json` مضبوط (نفس بيئة الإنتاج إن أمكن)

### أ) قياس الخادم فقط (موصى به أولاً)

```powershell
cd "e:\XTRA_WEB\مطاعم"
python scripts/bench_db_latency.py --api http://127.0.0.1:2288
python scripts/bench_db_latency.py --api http://127.0.0.1:2288 --cold
python scripts/bench_db_latency.py --api http://127.0.0.1:2288 --repeat 3
```

أو من المتصفح / curl:

```text
GET http://127.0.0.1:2288/api/mat3am/perf-probe
GET http://127.0.0.1:2288/api/mat3am/perf-probe?cold=1
```

**اقرأ النتيجة:**

| المرحلة | معنى |
|---------|------|
| `odbc_connect_select1_close` | زمن الشبكة + TLS + تسجيل الدخول SQL |
| `odbc_connect_select1_close_repeat` | هل التكرار بنفس التكلفة؟ (لا يوجد pool) |
| `tbl005_fetch` vs `tbl005_fetch_cached` | فعالية كاش الطاولات |
| `sql_bulk_state` | جلسات+طلبات من `MAT3AM_RESTAURANT_STATE` |
| `operational_snapshot` | ما تحمله شريحات الطاولات كل 15 ث |
| `parallel_3x_connect_*` | محاكاة ضغط `loadAll` |
| `tbl007_full_row_scan_*` | حجم كتالوج الأصناف |

حقل `hints` في JSON يفسّر النتيجة تلقائياً.

### ب) قياس من المتصفح (UI → API)

1. افتح DevTools → **Network** → Disable cache  
2. سجّل دخول جرسون → افتح **طلب للطاولة**  
3. رتّب الطلبات حسب **Time**  
4. لكل طلب بطيء: انسخ URL وقارن مع `perf-probe` (هل نفس نوع الاتصال؟)

**توقّع:** أبطأ طلب غالباً `/api/products` ثم `/api/restaurant/tables` عند كاش بارد.

### ج) فصل «API بطيء» عن «SQL بطيء»

| الاختبار | إذا كان بطيئاً |
|----------|----------------|
| `/api/ping` سريع (<50ms) و `perf-probe` بطيء | المشكلة SQL/ODBC وليس FastAPI |
| `perf-probe` سريع و UI بطيء | تكرار طلبات / polling / حجم JSON في الواجهة |
| `tbl005_cached` سريع و `operational_snapshot` بطيء | حجم sessions/orders أو قراءة JSON كبيرة |

### د) إنتاج Railway

```powershell
python scripts/bench_db_latency.py --api https://YOUR-RAILWAY-URL
```

قارن `odbc_connect_*` محلياً مقابل السحابة — فرق كبير = شبعة وليس استعلام.

### هـ) حالة الكاش

```text
GET /api/mat3am/sql-cache/status
```

---

## 3. فرضيات الاختبار (للتأكيد بالأرقام)

| # | الفرضية | يؤكدها |
|---|---------|--------|
| 1 | التأخير في ODBC connect وليس منطق Python | `odbc_connect_*` > 1s و `/api/ping` صغير |
| 2 | الكاش يعمل | `tbl005_fetch` كبير و `tbl005_fetch_cached` < 100ms |
| 3 | الواجهة تضاعف الحمل | Network: 8–12 طلب متزامن عند فتح الطلب |
| 4 | كتالوج المنتجات ثقيل | `tbl007_full_row_scan_*` > 500 صف أو > 3s |
| 5 | Snapshot ثقيل | `operational_snapshot` > 3s |

---

## 4. تحسينات مقترحة (بعد القياس — لم تُنفَّذ هنا)

1. **Connection pool** خيطي لـ pyodbc (أو `aioodbc` + pool)  
2. **كاش TBL007** / pagination لـ `/api/products`  
3. توحيد `loadAll` → endpoint واحد أو `operational-snapshot` موسّع  
4. رفع `RestaurantDualBells` من 3.5s → 10–15s على الإنتاج  
5. `ready?check_db=1` أقل تكراراً في `DbConnectionBar` عندما SQL معروف متصل  
6. فهارس SQL على أعمدة البحث إن لزم (مع DBA)

---

## 5. سجل الجلسة

| UTC | ملاحظة |
|-----|--------|
| 2026-05-20 | إضافة `perf-probe` + `bench_db_latency.py` + توثيق الأسباب وخطة الاختبار |
| 2026-05-20 | القياس الفعلي على نسخة `api_server.py` الصحيحة تم على المنفذ `2290` لأن الخدمة الموجودة على `2288` كانت تعيد `404` لمسار `perf-probe` رغم أن `__whoami__` كان يشير لنفس الملف |
| 2026-05-20 | `warm`: ping=`159.4ms`، connect=`13.6ms + 8.8ms`، snapshot=`92.7ms`، `tbl007 scan=39.4ms` |
| 2026-05-20 | `cold`: ping=`127.6ms`، connect=`7.9ms + 8.6ms`، `tbl005_fetch=25.9ms`، `tbl005_fetch_cached=0ms`، snapshot=`107.6ms` |
| 2026-05-20 | قياس endpoints: `/api/products`=`261.8ms` بحجم ~`427774` bytes وعدد `1172` صنف؛ `/api/restaurant/tables`=`69.7ms` بحجم ~`13905` bytes وعدد `39` طاولة |
| 2026-05-20 | الاستنتاج الحالي: محلياً لا توجد مشكلة واضحة في الاتصال أو كاش `TBL005`؛ المرشح الأوضح للبطء الإدراكي هو تحميل `/api/products` كاملاً دفعة واحدة |
| 2026-05-20 | فحص Railway الحي أعاد `502 Application failed to respond` للصفحة نفسها ولـ `/__whoami__` و`/api/ping`، ما يرجّح أن الخدمة لا تكمل startup أو readiness وليست فقط بطيئة داخل request |
| 2026-05-20 | تم تعديل startup في `backend/api_server.py` لتأجيل `MAT3AM schema ensure` و`sql_cache warm` و`kids migrate` إلى background بعد بدء استقبال الطلبات، لتقليل خطر فشل readiness على Railway |
| 2026-05-20 | **المرحلة 2:** كاش `TBL007`/`TBL006` (TTL 300s، مرآة JSON)؛ `/api/products` و`/api/product-groups` من الذاكرة؛ `GET /api/restaurant/order-taker-catalog`؛ `WaiterOrderPage.loadAll` يستدعي catalog واحد بدل طلبين ODBC |
