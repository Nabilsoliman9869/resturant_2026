# ترخيص Mat3amPOS.exe — رقم لمرة واحدة

## الفكرة

1. الشركة تولّد أرقام رخصة من **مولّد الشفرات** (داخلي).
2. العميل يشغّل `Mat3amPOS.exe` → تظهر شاشة **حفظ الحقوق + الهواتف**.
3. يدخل الرقم مرة واحدة → يُربط بالجهاز ويُحرق على السيرفر → لا يعمل على جهاز ثانٍ بنفس الرقم.
4. التشغيل التالي: شاشة حقوق قصيرة ثم فتح البرنامج مباشرة.

صيغة الرقم: `M3AM-XXXX-XXXX-XXXX-XXXX`

## للشركة — قبل شحن أي EXE

### 1) اضبط بيانات الشركة والهواتف

عدّل `config/license_branding.json`:

- `companyNameAr` / `companyNameEn`
- `phones` / `whatsapp` / `email`
- `requireOnlineBurn`: `true` = لا تفعيل بدون إنترنت وحرق على السيرفر (موصى به)
- `activationServerUrl`: عنوان Railway (الافتراضي مضبوط)

### 2) أنشئ سر التوقيع (مرة واحدة)

```bat
python scripts\mat3am_license_generator.py --count 1 --customer "اختبار"
```

ينشئ تلقائياً (إن لم يوجد):

- `config/mat3am_license_secret.txt` ← **لا يُرفع لـ GitHub**
- `config/license_ledger.json` ← سجل الأرقام الصادرة

**مهم:** نفس السر يجب أن يكون:

1. داخل حزمة EXE عند البناء (`config/` يُضمَّن في PyInstaller).
2. على Railway كمتغير بيئة: `MAT3AM_LICENSE_SECRET=<نفس المحتوى>`  
   حتى يقبل خادم الحرق المفاتيح.

### 3) ولّد أرقام للعملاء

واجهة رسومية:

```bat
python scripts\mat3am_license_generator.py
```

أو سطر أوامر:

```bat
python scripts\mat3am_license_generator.py --count 5 --batch A --customer "مطعم النخيل"
```

أعطِ العميل **رقماً واحداً لكل جهاز**.

### 4) ابنِ EXE الشامل

```bat
build_exe.bat
```

الناتج: `dist\Mat3amPOS.exe` (+ نسخة مرقّمة).

## للعميل

1. ثبّت/انسخ EXE (ومثبّت ODBC إن لزم).
2. شغّل البرنامج → أدخل رقم الرخصة.
3. يلزم إنترنت في أول تفعيل إن كان `requireOnlineBurn=true`.
4. بعدها يعمل حتى بدون إنترنت (الملف المحلي `%LOCALAPPDATA%\Mat3amPOS\license.dat`).

## تطوير محلي (بدون رخصة)

التشغيل من المصدر (`run_api.bat` / Vite) **لا يطلب رخصة**.

لتجربة البوابة محلياً:

```bat
set MAT3AM_REQUIRE_LICENSE=1
python backend\mat3am_exe_entry.py
```

لتخطي الرخصة في EXE للاختبار الداخلي فقط:

```bat
set MAT3AM_SKIP_LICENSE=1
```

## نقل رخصة لجهاز جديد

1. احذف السجل المحروق من السيرفر (`config/license_burns.json` على بيئة التشغيل / Railway volume) للـ `keyHash` المطلوب — أو أصدر رقماً جديداً.
2. على الجهاز القديم احذف `%LOCALAPPDATA%\Mat3amPOS\license.dat`.

## ملفات لا تُرفع

- `config/mat3am_license_secret.txt`
- `config/license_ledger.json`
- `config/license_burns.json`
