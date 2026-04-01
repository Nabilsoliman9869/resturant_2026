# نسخ احتياطي ولقطات استقرار (مطاعم)

## لماذا؟

المشروع مركّب (واجهة + API + ملفات إعداد). أي إعادة هيكلة للقوائم أو المسارات يجب أن تسبقها **لقطة يمكن الرجوع إليها**.

## الطريقة الموصى بها: Git + وسوم + bundle

1. ثبّت [Git for Windows](https://git-scm.com/download/win) إن لم يكن مثبتاً.
2. من جذر `مطاعم` شغّل **`backup_checkpoint.bat`**.
   - يُنشئ مجلداً بجانب الأب: `مطاعم-checkpoints\`
   - ملف: `mat3am-YYYYMMDD-HHmmss.bundle` (يحمل تاريخ الـ commits والوسوم)
   - وسم: `checkpoint-YYYYMMDD-HHmmss`

### استعادة من الـ bundle (مثال)

```text
mkdir مطاعم-restored
cd مطاعم-restored
git clone ..\مطاعم-checkpoints\mat3am-20260401-120000.bundle .
```

### الرجوع لوسم داخل نفس المجلد

```text
git checkout checkpoint-20260401-120000
```

(للعمل على فرع جديد بدل detached HEAD: `git switch -c fix-from-checkpoint checkpoint-...`)

## نسخة يدوية سريعة (ZIP)

- انسخ مجلد `مطاعم` بالكامل إلى قرص آخر أو سحابة.
- لتقليل الحجم يمكن استبعاد `node_modules` و`dist` ثم تشغيل `npm install` بعد الاستعادة.

## ملاحظة

ملف `.env` **مستثنى** من Git (`.gitignore`) حتى لا تُرفع كلمات سر. احتفظ بنسخة آمنة من `.env` مع نسخك الاحتياطي الخاص.
