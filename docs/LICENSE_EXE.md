# ترخيص Mat3amPOS — شرح مبسّط

## بالجملة

1. من المولّد تختار **مدة الصلاحية** وتولّد رقماً.
2. تعطي العميل **EXE + الرقم**.
3. العميل يدخل الرقم مرة واحدة → البرنامج يشتغل حتى تاريخ الانتهاء.
4. بعد انتهاء المدة يتوقف ويطلب تجديداً.

## مدد جاهزة في المولّد

| النوع | المدة |
|--------|--------|
| تجريبي | شهر |
| ربع سنوي | 3 أشهر |
| نصف سنوي | 6 أشهر |
| سنوي | 12 شهراً |
| سنتان | 24 شهراً |
| دائم | بلا انتهاء |
| مخصص | أي عدد أشهر تحدده |

## بيانات الشركة على شاشة البداية

- **سير كونسلت لتكنولوجيا المعلومات والاستشارات المالية ش.م.م**
- هاتف: `02 2268200` · `01026669107` · `01026669108` · `01103165060` · `01103165070`

تعديلها من: `config/license_branding.json` ثم إعادة بناء EXE.

## أوامر سريعة

```bat
build_license_generator.bat
```

```bat
python scripts\mat3am_license_generator.py --count 1 --plan trial --customer "تجربة"
python scripts\mat3am_license_generator.py --count 1 --plan quarter --customer "عميل"
python scripts\mat3am_license_generator.py --count 1 --plan year --customer "عميل"
python scripts\mat3am_license_generator.py --count 1 --plan custom --months 9 --customer "عرض"
```

ثم ابنِ النسخة:

```bat
build_exe.bat
```

الناتج: `dist\Mat3amPOS.exe`

## ملاحظة

- الرقم لـ **جهاز واحد**.
- أول تفعيل يحتاج إنترنت (حرق على السيرفر).
- التطوير المحلي (`run_api`) لا يطلب رخصة.
