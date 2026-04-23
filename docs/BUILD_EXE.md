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

مخرجات Vite تُكتب إلى **`ui/restaurant/`** (نفس ما يخدمه الـ API وما تُدخله PyInstaller من مجلد `ui`). مجلد `dist/` لم يعد مخرج البناء الافتراضي — لا تعتمد على ملفات قديمة هناك للـ EXE.

## خيار PyInstaller (Mat3amPOS.exe)

من جذر المشروع (بعد `pip install pyinstaller pyodbc uvicorn fastapi`):

```bat
pyinstaller Mat3amPOS.spec --noconfirm
```

الناتج: `dist\Mat3amPOS.exe` — يضم `ui` و`config` و`docs` كما في `Mat3amPOS.spec`.

## الخيار 3 — تطبيق سطح مكتب (Electron / Tauri)

1. ثبّت [Electron](https://www.electronjs.org/) أو [Tauri](https://tauri.app/) في المشروع.
2. اربط نافذة `BrowserWindow` بـ `http://localhost:5290` بعد تشغيل الخلفية (أو افتح `dist/index.html` عبر `file://` مع خادم ثابت صغير يشغّل API من `backend/`).
3. استخدم `electron-builder` لإخراج `.exe` — اجمع في الحزمة مجلدي `backend` و`dist` و`ui` حسب الحاجة.

> التدفق النقدي يُحمّل من خادمك المحلي: `/modules/cashflow/index.html` (ليس Nuit).
