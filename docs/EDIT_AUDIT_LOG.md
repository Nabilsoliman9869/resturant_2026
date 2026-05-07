# سجل توثيق تعديلات الوكيل / Agent edit audit log

كل **دفعة تعديلات جوهرية** (مسارات، منطق، API، أو أكثر من ملف مترابط) تُدوَّن هنا قبل أو بعد الانتهاء مباشرة، حتى لا تضيع نقطة المرجع.

| الحقل | المعنى |
|--------|--------|
| **UTC** | وقت التنفيذ بتوقيق عالمي (ISO 8601). |
| **ID** | مُعرّف قصير غير متكرر لتتبّع المنطقة أو الرسائل. |
| **الملفات** | قائمة أوصاف موجزة لما تغيّر. |

---

## مدخلات

### 001 — تنشيط السجل وقاعدة العمل — `UTC 2026-05-06T23:45:08Z` — ID `init-6f4e1a463970`

- إنشاء `docs/EDIT_AUDIT_LOG.md` وتوحيد الشكل (`UTC` + `ID`).
- إضافة قاعدة Cursor `.cursor/rules/edit-audit-log.mdc`: الوكيل يُكمل هذا السجل بعد التعديلات الجوهرية.

### 002 — هامش عمود «التصنيف — الفئة» بالشريط العلوي — `UTC 2026-05-06T23:45:34Z` — ID `marg-c2802ad51be9`

- `src/styles/operationalRoles.css`: لبطاقة `.waiter-pos__topbar > .waiter-pos__top-card--categories` استخدام `margin-inline-start: clamp(18px, 2.8vw, 36px)` و`box-sizing: border-box` دون تغيير `gridColumn` في TSX.

### 003 — ملاحظات مودال الإضافات + إزالة إعدادات مكررة — `UTC 2026-05-06T12:30:00Z` — ID `addon-notes-appshell-deup`

- `src/pages/WaiterOrderPage.tsx`: حقل **ملاحظات** (`textarea`) في مودال الإضافات مربوط بـ `addonPickerNotes`.
- `src/components/AppShell.tsx`: حذف بند **`إعدادات النظام`** المكرر (نفس مسار `settings`) لدوري المدير والمطوّر؛ توحيد تسمية بند المطوّر إلى **إعدادات التشغيل** ليتوافق مع المدير.

### 004 — وارد الأدوار + إصلاح دمج الإعدادات + المينيموم تشارج في الجرسون — `UTC 2026-05-07T04:05:00Z` — ID `role-inbox-ops-merge-mincharge`

- `backend/api_server.py`: **`GET`** و**`PATCH …/dismiss`** لمساري `/api/restaurant/cashier/role-inbox` و`/api/restaurant/role-inbox`، تخزين `role_inbox.json`، وفَنْدَة تنبيهات `POST cashier/alerts` بـ **`targetRoles`**؛ إصلاح **`_restaurant_write_ops`** و**`_restaurant_normalize_ops`** لقبول القيمة **`0`** الرقمية (كانت تُعتبر فارغة بسبب `0 or ""`).
- `src/pages/WaiterOrderPage.tsx`: طبقة **حد أدنى للطاولة** (كل طاولة أو الافتراضي من الإعدادات) على صافي الأصناف قبل الخدمة/الضريبة، مع رسالة فرق؛ جلب **`tableDefaultMinimumCharge`** ضمن **`loadAll`**.
- `src/pages/settings/MinimumChargeSettingsPage.tsx`: السماح بالتعديل لدور **مطوّر** أيضاً.
