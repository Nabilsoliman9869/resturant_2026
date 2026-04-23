# التهيئة الافتراضية — جداول MAT3AM + ملفات المطعم + Kids Area

## جداول SQL (دعم التطبيق)

تُنشأ/تُحدَّث عبر **`POST /api/dev/bootstrap`** أو سكربت **`backend/init_concreet_db.py`**.

تشمل: `MAT3AM_APP_USERS`, `MAT3AM_ERROR_LOG`, `MAT3AM_AUDIT_LOG`, أنماط فواتير المطعم، مخازن، وصفات، عروض، إلخ — انظر حقل `tables` في استجابة الـ bootstrap.

## بيانات TBL (حسابات، طاولات، أصناف…)

الحزمة المرجعية: **`config/tbl_seed_pack_v1.json`**

التطبيق: **`POST /api/dev/seed-default-data`** (UPSERT فقط على جداول موجودة مسبقاً).

لتوليد ملف مرشح من قاعدة عميل حقيقية:

```bat
cd backend
python tools/export_tbl_seed_from_db.py
```

يُنتج **`config/tbl_seed_pack_from_db.generated.json`** — راجعه ثم ادمجه أو استبدل الحزمة الرسمية بحذر.

## منطقة الأطفال (Kids Area)

- **لا توجد جداول SQL جديدة** لهذا المديول؛ التخزين في ملفات JSON.
- القالب المشحون مع المشروع: **`config/restaurant/kids_area_defaults.json`**
- عند أول تشغيل أو بعد bootstrap: نسخ إلى `kids_area_settings.json` وإنشاء `kids_area_sessions.json` و`kids_area_profiles.json` فارغين — **`_bootstrap_mat3am_runtime`** في `api_server.py`.

### واجهات REST (Kids Area)

مذكورة في استجابة **`POST /api/dev/bootstrap`** تحت المفتاح **`kidsAreaModule.apis`**.

## مستخدم افتراضي Kids

- تسجيل: **`kids`** / رمز **`123`** / دور **`kids_guard`** (إن كان `MAT3AM_APP_USERS` فارغاً عند التهيئة).

## بناء EXE

انظر **`docs/BUILD_EXE.md`** — `pyinstaller Mat3amPOS.spec` يضم مجلد **`config`** بالكامل (بما فيها القوالب أعلاه).
