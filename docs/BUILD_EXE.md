# بناء ملف تشغيل (.exe)

## نسخة مستقلة (مجلد `مطاعم`)

كل ما يلزم التشغيل موجود داخل **هذا المجلد**: `backend/` (FastAPI)، `ui/modules/cashflow/`، `config/`، وواجهة React في الجذر. لا حاجة لنسخ `XTRA_WEB\backend` من الخارج عند نقل المشروع أو بناء EXE.

## الخيار 1 — تشغيل سريع (موصى به)

- `run_full_stack.bat` — خادم API من `backend\` + `npm run dev`
- أو `run_api.bat` للخادم فقط، و`run.bat` للواجهة فقط

## الخيار 2 — تجميع واجهة ثابتة + فتح المتصفح

```bat
cd مطاعم
npm install
npm run build
```

النتيجة في `dist/`. يمكن نشرها على IIS أو فتح `dist/index.html` عبر خادم ثابت.

## الخيار 3 — تطبيق سطح مكتب (.exe)

1. ثبّت [Electron](https://www.electronjs.org/) أو [Tauri](https://tauri.app/) في المشروع.
2. اربط نافذة `BrowserWindow` بـ `http://localhost:5290` بعد تشغيل الخلفية (أو افتح `dist/index.html` عبر `file://` مع خادم ثابت صغير يشغّل API من `backend/`).
3. استخدم `electron-builder` لإخراج `.exe` — اجمع في الحزمة مجلدي `backend` و`dist` و`ui` حسب الحاجة.

> التدفق النقدي يُحمّل من خادمك المحلي: `/modules/cashflow/index.html` (ليس Nuit).
