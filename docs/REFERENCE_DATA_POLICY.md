# سياسة البيانات المرجعية (مطاعم)

## الهدف

تقليل فتح اتصالات ODBC المتكررة من Railway إلى SQL Server (~10–20 ثانية/طلب) مع إبقاء التشغيل اليومي (جلسات، طلبات، مطبخ) **حياً** من SQL/JSON.

## ما يُعتبر «مرجعياً»

| المصدر | محتوى | كاش | مرآة JSON |
|--------|--------|-----|-----------|
| TBL007 | أصناف/أسعار | `MAT3AM_TBL007_CACHE_TTL` (افتراضي 300s) | `config/restaurant/sql_mirror/tbl007.json` |
| TBL006 | مجموعات أصناف | `MAT3AM_TBL006_CACHE_TTL` | `tbl006.json` |
| TBL005 | مراكز تكلفة / طاولات | `MAT3AM_TBL005_CACHE_TTL` | `tbl005.json` |
| MAT3AM_APP_USERS | دخول/أدوار | `MAT3AM_USERS_CACHE_TTL` (90s) | `app_users.json` |

## ما يبقى تشغيلياً (بدون تثبيت يومي كامل)

- `table_sessions`, `orders`, `kitchen`, صناديق الوارد، تنبيهات الطاولات
- `operational-snapshot` — يجمع حالة اليوم + طاولات من كاش TBL005

## قراءة GET المرجعية

- `/api/products`, `/api/product-groups`, بحث الأصناف، `picks-under-price`, `order-taker-catalog` / `bootstrap` — من `mat3am_sql_cache` فقط.
- عند `MAT3AM_REFERENCE_CACHE_ONLY=1` (افتراضي في Docker/Railway): لا يُفتح ODBC في الخلفية عند انتهاء TTL؛ يُعاد الكاش القديم أو المرآة.
- التسخين عند الإقلاع: `warm_catalog_only()` في thread خلفي.

## بعد تعديل تعريف في SQL

1. POST يكتب في SQL ويستدعي `invalidate_menu_catalog()` (أصناف/مجموعات).
2. الواجهة تعرض: **«تم الحفظ… سيظهر بعد تحديث بيانات النظام»**.
3. المدير/المطوّر: **«تحديث بيانات النظام الآن»** → `POST /api/mat3am/reference-data/refresh` مع `mat3amActor`.

## API

| Method | Path | وصف |
|--------|------|-----|
| GET | `/api/mat3am/reference-data/status` | حالة الكاش + `referenceCacheOnly` |
| POST | `/api/mat3am/reference-data/refresh` | إعادة بناء 005/006/007 (+ users اختياري) — مدير/مطوّر |
| GET | `/api/mat3am/sql-cache/status` | تشخيص (بدون ODBC افتراضياً) |

## الواجهة

- **مطوّر:** `اتصال القاعدة` → لوحة «بيانات النظام المرجعية»
- **مدير/تعريفات:** `MasterDataPage` → نفس اللوحة (بدون خيار المستخدمين افتراضياً)

## متغيرات البيئة

| متغير | افتراضي | معنى |
|--------|---------|------|
| `MAT3AM_REFERENCE_CACHE_ONLY` | `1` في Docker | منع ODBC على GET المرجعية عند miss/TTL |
| `MAT3AM_TBL007_CACHE_TTL` | 300 | ثوانٍ |
| `MAT3AM_TBL006_CACHE_TTL` | 300 | ثوانٍ |
| `MAT3AM_TBL005_CACHE_TTL` | 120 | ثوانٍ |
| `MAT3AM_USERS_CACHE_TTL` | 90 | ثوانٍ |

## الاستطلاع (polling)

- شاشات التشغيل: `RESTAURANT_POLL_MS` = 18s (`operational-snapshot`)
- أجراس الوارد: 18s (متناسق)
- لا يُدمج مع الكتالوج — الكتالوج يُحمَّل مرة عبر `order-taker-bootstrap`

## مراجع كود

- `backend/mat3am_sql_cache.py` — SWR، `refresh_all_reference_data`
- `backend/api_server.py` — مسارات المنتجات + refresh
- `src/lib/referenceDataPolicy.ts` — رسائل عربية موحّدة
