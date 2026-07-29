# بوابة SMS للدفع (Mat3am)

تطبيق أندرويد بسيط يستقبل رسائل المحافظ/البنوك ويرسلها لـ API المطعم.

## المرسلون الافتراضيون
- `VF-Cash`
- `ADIB EGYPT`

## الإعداد على الموبايل
1. ثبّت APK
2. امنح صلاحية SMS
3. راجع عنوان API و API Key
4. أضف مرسلين إضافيين سطراً سطراً

## بناء APK
```bat
gradlew.bat assembleDebug
```
الملف: `app/build/outputs/apk/debug/app-debug.apk`
