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

### 005 — إكمال Owner/VIP: تغذية TBL016 + محرر قوالب الإعدادات — `UTC 2026-05-07T11:30:00Z` — ID `ownervip-tbl016-templates`

- `backend/api_server.py`: إضافة مسار **`POST /api/agents/owners-vip/create`** لإنشاء عميل داخل مجموعة **`owners&vip`** (ضمان وجود المجموعة في `TBL015` + إنشاء صف `TBL016` بحساب افتراضي من `TBL004`) لدعم دروب داون Owner/VIP.
- `src/pages/settings/RestaurantOpsSettingsPage.tsx`: إضافة قسم **عملاء owners&vip** (عرض + إضافة عميل) وقسم **قوالب Owner/VIP** (محرر `vipOwnerTemplatesJson` مع اختيار العميل من المجموعة) لتفادي “سلوك قراءة خاطئ” بسبب نقص صفوف `TBL016` أو نقص القوالب.

### 006 — إعادة Owner/VIP لصفحة “دورة العمل والأدوار” — `UTC 2026-05-07T14:25:00Z` — ID `ownervip-back-to-workflow`

- `src/pages/settings/WorkflowRolesSettingsPage.tsx`: إعادة قسم **تعريف مالك/شخص مهم** داخل صفحة **دورة العمل والأدوار** (إضافة عملاء owners&vip + محرر قوالب `vipOwnerTemplatesJson` مع حفظ مستقل)، حتى لا تضيع نافذة الإدخال التي تعتمدون عليها.

### 007 — قراءة اسم المالك من TBL016 في دروب داون شريحة الطاولة — `UTC 2026-05-07T18:35:00Z` — ID `tblcard-vip-owner-name-lookup`

- `src/pages/WaiterTablesPage.tsx`: داخل `loadTables` نجلب الآن `GET /api/agents/by-group-name?group_name=owners%26vip` بالتوازي مع باقي الطلبات، ونبني `Map<CardGuide, AgentName>`. عند بناء صفوف `vipTemplates`، يُحفظ `agentGuid` ويُختار اسم العرض كالتالي: `label` المُدخل ← اسم العميل من TBL016 ← الكلمة العامة `Owner/VIP`. يحلّ شكوى «الدروب داون لا يقرأ من جدول العملاء — ملاك» حين يُترك label فارغاً ويُربط القالب بعميل من TBL016.
- نوع `VipTemplate` يحوي الآن `agentGuid: string`، وأُضيف نوع `OwnersVipAgent` وحالة `ownersVipAgents` لتمكين توسعات لاحقة (اختيار مالك مباشر).

### 008 — ترقيع: نقل جلب عملاء owners&vip خارج حلقة استطلاع شريحة الطاولة — `UTC 2026-05-07T18:42:00Z` — ID `tblcard-ownersvip-fetch-once`

- `src/pages/WaiterTablesPage.tsx`: نداء `GET /api/agents/by-group-name` نُقل من `loadTables` (التي تُعاد كل 7 ثوانٍ) إلى `useEffect` مستقل يعمل **مرة واحدة عند تركيب الصفحة**، لأنه نداء قاعدة بيانات قد يستغرق ~6 ثوانٍ ويسبّب تجمّد البطاقة وظهور وكأن الأزرار «اختفت». بناء اسم خيار الدروب داون انتقل إلى وقت العرض (لا أثناء التحميل).

### 009 — إصلاح RangeError في safeFetch + موحَّد networkErrorResponse — `UTC 2026-05-07T20:05:00Z` — ID `safefetch-range-error-fix`

- `src/lib/safeFetch.ts`: إزالة `new Response("", { status: 0, statusText: "NETWORK" })` لأن معيار Web يرفض status خارج 200–599 ويُلقي `RangeError: Failed to construct 'Response': The status provided (0) is outside the range [200, 599]` عند أيّ فشل شبكة لحظي. أُستبدل بكائن duck-typed يحاكي واجهة `Response` (`ok:false, status:0, statusText, text(), json()`) عبر دالة جديدة مُصدَّرة `networkErrorResponse()`.
- `src/components/DbConnectionBar.tsx`: استبدال موضعَي `new Response("", { status: 0 })` بنداء `networkErrorResponse()` لتفادي نفس الخطأ (موضعا parseConnectionCfg في حالة فشل rCfg).
- يحلّ الشكوى «عدم استقرار في الاتصال بالخادم» التي ظهرت عند تحديث القائمة في الشريط العلوي والاستطلاع الدوري للخدمة.

### 010 — عملاء ملاك مباشرة في شريحة الطاولة + فحص اتصال يدوي — `UTC 2026-05-07T20:15:00Z` — ID `vip-agent-direct-probe`

- `backend/api_server.py`: مسار **`PATCH …/billing-profile`** يقبل الآن **`vipAgentGuid`** (أو `vipOwnerAgentGuid`) مع التحقق من أن العميل نشط في مجموعة **`owners&vip`** عبر `TBL015`/`TBL016`، وبناء **`billingProfile`** بمصدر **`vip_owner_agent`** (افتراضيات الإعدادات + اسم العميل من القاعدة).
- `src/pages/WaiterTablesPage.tsx`: مجموعة خيارات **`عملاء ملاك (من القاعدة TBL016)`** في دروب داون Owner/VIP بقيمة **`__agent__:<GUID>`** مع **`applyVipBilling`**؛ دعم عرض الجلسة المرتبطة بـ **`vip_owner_agent`**؛ توضيح **`title`** لدروب داون التنبيه أنه ليس قائمة عملاء.
- `src/components/DbConnectionBar.tsx`: زر **«فحص»** يطبع زمن الاستجابة و**HTTP** لعدة مسارات (`ping`، `ready`، `ready?check_db=1`، `settings/connection`، `agents/by-group-name`) لتمييز انقطاع الشبكة عن بطء الخادم أو الواجهة.

### 011 — عدم تكرار عميل الملاك بين «قوالب» و«عملاء ملاك» — `UTC 2026-05-07T20:25:00Z` — ID `vip-dropdown-dedupe`

- `src/pages/WaiterTablesPage.tsx`: حقل `activeVipTemplates` + `templateLinkedAgentGuids` + `ownersVipAgentsDeduped` — أي `CardGuide` مربوط بقالب نشط (`agentGuid`) يُزال من قائمة **«عملاء ملاك (غير مكرّرين في القوالب)»** حتى لا يظهر نفس الشخص مرتين. تبسيط تسمية مجموعة القوالب إلى **«قوالب»**.

### 012 — حذف قوالب VIP الفارغة من دروب داون شريحة الطاولة — `UTC 2026-05-07T20:45:00Z` — ID `vip-empty-template-hide`

- `src/pages/WaiterTablesPage.tsx`: شرط ظهور القالب في `activeVipTemplates` صار: مفعّل **و** له `label` أو `agentGuid`. صفوف الإعدادات المسوّدة (بلا اسم وبلا عميل) كانت تظهر تحت «قوالب» بنص «Owner/VIP» العام رغم أن الخادم يرفض تطبيقها — أُسقطت من العرض.

### 013 — رفع سقف عملاء owners&vip — `UTC 2026-05-07T20:55:00Z` — ID `ownersvip-no-top-limit`

- `backend/api_server.py`: في `GET /api/agents/by-group-name` حُذف `TOP 200` ليُعيد **كل عملاء** المجموعة (ترتيب ABC حسب `AgentName`، استبعاد المُعطَّل والمورّد الافتراضي). الردّ يحوي الآن `count` للوضوح.

### 014 — تثبيت زر «تطبيق» داخل صف Owner/VIP في الشريحة — `UTC 2026-05-07T21:10:00Z` — ID `tblcard-apply-button-fixed-width`

- `src/pages/WaiterTablesPage.tsx`: تغيير صف Owner/VIP من `gridTemplateColumns: "1fr auto"` إلى `"minmax(0,1fr) 86px"`؛ إضافة `minWidth: 0` للـ `<select>` لمنعه من فرض عرض داخلي يطرد الزر خارج البطاقة. اختصار نص الزر إلى **«تطبيق»** (الـ `title` يحوي السياق الكامل) ليبقى مرئياً مع توسّع عناوين optgroups.

### 016 — اسم عميل المالك يُختار تلقائياً في POS عند تطبيق Owner/VIP — `UTC 2026-05-07T21:55:00Z` — ID `pos-vip-agent-auto-select`

- `src/pages/WaiterOrderPage.tsx`: نوع `SessionBillingProfile` يحوي الآن `vipAgentGuid?: string`. أُضيف `useEffect` يراقب `sessionBillingProfile`؛ عند سياسة نشطة بمعرّف عميل، يُحدَّث `selectedAgentGuid` ليطابق `vipAgentGuid` بدلاً من «عميل نقدي». يحقّق طلب «اسم العميل في الفاتورة يصبح اسم عميل المالك مباشرة».
- خلفية شريحة الطاولة تتلوّن تلقائياً بالكهرماني عبر class **`waiter-tblcard--owner`** الموجودة سابقاً في `operationalRoles.css`، بمجرد أن يصل `vipOwnerLabel` من رد الخادم بعد ضغط زر «تطبيق» Owner/VIP. لا تعديل CSS مطلوب.

### 015 — التسكين من الشريحة ينشئ الجلسة (لا يحتاج جلسة موجودة) — `UTC 2026-05-07T21:25:00Z` — ID `tblcard-claim-creates-session`

- `src/pages/WaiterTablesPage.tsx`: دالة **`claimCaptain`** أصبحت تتقبّل `{ tableId, sessionId? }`. عند غياب الجلسة تُرسل **`POST /api/restaurant/table-sessions`** بـ `mat3amActor` و`assignOrderTaker:true`؛ الخادم يُنشئ الجلسة ويُسكِّن المُرسِل تلقائياً (`_restaurant_assign_captain_from_actor_if_needed` تقبل أدوار `waiter|host|manager|developer`). عند وجود جلسة يبقى مسار `/claim-order-taker` كما هو.
- شرط تعطيل الزر بات: انشغال + طاولة غير جاهزة + (قفل الكابتن نشط على شخص آخر بلا صلاحية تجاوز). أُزيل شرط `!sidStr` فيُمكن للجرسون «بدء التسكين» مباشرة من الشريحة.
- نصّ الزر يتغيّر بالحالة: «أنت الكابتن ✓» / «تسكين كابتن» (بجلسة) / «ابدأ التسكين» (بلا جلسة)، مع `title` يفسّر كل حالة.
- يحلّ شكوى «زر التسكين غير نشط» في تدفّق الجرسون عندما لا يفتح أحد الجلسة قبله، وفق السياسة: التسكين من الشريحة هو الفعل الأول الذي يحجز الطاولة على المُسكِّن.

### 017 — طلب تحويل الكابتن + قبول زميل بنفس الجدولة — `UTC 2026-05-08T00:15:00Z` — ID `captain-transfer-peer-inbox`

- `backend/api_server.py`: إنشاء تخزين **`captain_transfer_requests`** مع **`POST /api/restaurant/table-sessions/{id}/request-captain-transfer`** (الكابتن الحالي فقط؛ يستخرج من **`MAT3AM_APP_USERS`** + **`MAT3AM_USER_ROLE_SCHEDULE`** زملاء بنفس **الدور الفعّال لليوم** عبر **`_resolve_effective_role_code`**)، وإنشاء عنصر وارد **`captain_transfer_request`** في **`role_inbox`** مع **`targetUserIds`**. مسارا **`POST /captain-transfer-requests/{id}/accept`** و**`/cancel`**؛ **`GET …/role-inbox`** يقبل **`userId`** لتصفية عناصر موجّهة لمستخدم محدّد وتمرير **`transferRequestId`**/**`sessionId`** في العناصر.
- `src/components/RestaurantDualBells.tsx` + `AppShell.tsx`: تمرير **`userId`** و**`mat3amActor`** إلى استطلاع الوارد؛ زر **«قبول التحويل»** لنوع **`captain_transfer_request`**.
- `src/pages/WaiterTablesPage.tsx`: زر **«طلب تحويل»** للجرسون/الاستقبال عندما يكون المستخدم هو الكابتن على الجلسة النشطة.

### 018 — إعادة حد الطاولة للافتراضي + ترشيح أصناف ضمن فرق المينيموم — `UTC 2026-05-08T17:45:00Z` — ID `mincharge-reset-gap-picks`

- `backend/api_server.py`: **`_restaurant_clear_table_minimum_charge_override`** يزيل `minimumCharge` المخصّص من ملف الطاولات؛ يُستدعى عند إنشاء **جلسة جديدة** (`POST /table-sessions` فرع الإنشاء فقط، وليس عند إعادة استخدام جلسة نشطة اليوم). عند **`PATCH …/tables/{id}/status`** وحالة **`ready`** يُزال الحد المخصّص تلقائياً مع انتهاء التنظيف. مسار جديد **`GET /api/products/picks-under-price`** يعيد أصنافاً من **TBL007** بـ `AgentPrice <= max_price` مرتبة تصاعدياً بالسعر.
- `src/pages/WaiterOrderPage.tsx`: لوحة **بدائل ضمن فرق المينيموم** تحت ملخص الفاتورة عند وجود فرق؛ أزرار تضيف صنفاً مباشرة للسلة (`pushCartLineForProduct`) بدون غرامة منفصلة — الصافي يرتفع بأصناف حقيقية. استخدام **`safeFetch`** لجلب الاقتراحات؛ الإخفاء عند طلب الحساب أو قفل الكابتن.
- `src/pages/WaiterTablesPage.tsx`: مسودة حقل المينيموم على الشريحة تُحدَّث من الخادم في كل **`loadTables`** حتى يظهر صفر/افتراضي فور مسح التخصيص من الخلفية.

### 019 — ظهور رسائل «إرسال الطلب» للمطبخ عند الضغط — `UTC 2026-05-09T11:05:00Z` — ID `pos-kitchen-send-feedback-banner`

- `src/pages/WaiterOrderPage.tsx`: كانت حالة **`msg`** تُعرض أسفل عمود الملخص بخط صغير جداً فيبدو أن زر **«إرسال الطلب»** لا يفعل شيئاً عند رفض الإرسال (لا جلسة، قفل مسند، طاولة غير جاهزة، فشل الشبكة، إلخ). أُضيف شريط تنبيه **`role="alert"`** أسفل شرائط الكابتن مباشرةً بحجم خط مقروء؛ **`POST /api/restaurant/invoices`** يمر عبر **`safeFetch`**؛ نص الزر أثناء الإرسال **«جاري الإرسال…»** مع **`opacity`/`cursor`** أوضح عند التعطيل.

### 020 — إصلاح شاشة بيضاء على المسارات العميقة (Vite base) — `UTC 2026-05-09T12:15:00Z` — ID `vite-base-absolute-deep-routes`

- `vite.config.ts`: تغيير **`base: "./"`** إلى **`base: "/"`**. مع base نسبي، عند فتح **`/app/waiter/order-taker`** (مسار React Router عميق) كان `<script src="./assets/index-...js">` يتحوّل إلى **`/app/waiter/assets/index-...js`** فيلتقطه catch-all لـ `api_server` ويردّ **`index.html`** بـ Content-Type `text/html` بدل `application/javascript` ⇒ يرفض المتصفح تنفيذه ⇒ **شاشة بيضاء** بلا أخطاء واضحة. base مطلق يحل المشكلة لأن المتصفح يطلب الأصول من جذر الموقع دائماً.

### 023 — إصلاح «فشل الحفظ — أرسل mat3amActor» في إرسال طلب الجرسون للمطبخ — `UTC 2026-05-10T09:00:00Z` — ID `waiter-order-send-mat3am-actor`

- المشكلة: عند الضغط على «إرسال» في `WaiterOrderPage` لطلب طاولة، يُردّ من الخادم: **`{"detail":"أرسل مع الطلب mat3amActor (المستخدم الحالي) لتفعيل قفل الكابتن."}`** فيظهر للمستخدم «فشل الحفظ: Error: …». السبب: body الـ `POST /api/restaurant/invoices` كان لا يحوي حقل `mat3amActor`، فدالة `_restaurant_assert_order_taker_may_use_session` تعجز عن التحقق من ملكية الكابتن وترفض العملية.
- الإصلاح في `src/pages/WaiterOrderPage.tsx`: إضافة `mat3amActor: buildMat3amActor(user)` ضمن body الإرسال (موجود فعلاً في زر «تسكين كابتن» وكان مفقوداً هنا فقط).
- بدون هذا الحقل: قفل الكابتن يفشل لكل المستخدمين عدا (manager/developer)، لأن السياسة هي «التحقق من المستخدم قبل أي طلب على الجلسة».

- **آلية الاحتساب**: سعر الدقيقة في الباقة = مجموع `AgentPrice` لبنود المدة (`Custom5 ≠ '55555'`) ÷ مجموع `Hieght3` لتلك البنود. الفرق الخام بالدقائق بين «الآن» و`exitExpectedAt`، يُطرح **5 دقائق مهلة سماح**، ثم يُقرَّب لأعلى **`ceil`** لأقرب 5 دقائق. القيمة = `billable_minutes × rate_per_min`.
- **`backend/api_server.py`**:
  - **`_kids_compute_overtime(ticket)`** يُرجع `{applicable, billableMinutes, rawMinutes, charge, ratePerMinute, packageMinutes, packageTimePrice, refProductGuide, refName, exempt, alreadyApplied}` — يعمل على البيانات المحفوظة في التذكرة دون استعلام DB إضافي. يرفض الاحتساب تلقائياً لو `packageMinutes ≤ 0` أو `packageTimePrice ≤ 0` (سلامة بيانات الباقة).
  - **`_kids_enrich_ticket(t)`** يضيف لقطة `overtime` لكل تذكرة قبل الإرجاع — يُرصِّعها `GET /tickets` و`GET /tickets/{id}` بدون تعديل القرص.
  - **`_kids_apply_overtime_to_invoice(cur, conn, ticket)`** يضيف سطر `TBL023` بـ `ProductGuide = نفس بطاقة بند المدة الأصلي` (الحفاظ على «كمية = 1»)، `Quantity=1`، `UnitPrice = القيمة المحسوبة`، `Notes = "وقت إضافي N د (اسم البند)"`. ثم يحدّث `ticket.lines` محلياً (مع `isOvertime=true`) ويختم `overtimeAppliedAt/MinutesApplied/ChargeApplied` لمنع التكرار.
  - **`POST /api/kids/tickets/{id}/exempt-overtime`** — متاح فقط لـ `mat3amActor.role ∈ {manager, developer}`؛ يضع `overtimeExempt=true` + `exemptAt/By/Reason`. مرفوض لو سبق تطبيق الإضافي.
  - **`POST /api/kids/tickets/{id}/settle`** عُدِّل ليستدعي `_kids_apply_overtime_to_invoice` **قبل** احتساب الإجمالي والإقفال — السطر يصبح جزءاً من فاتورة `TBL022` المغلقة. يعيد `overtimeApplied: {minutes, charge}` للواجهة.
  - ثوابت: `KIDS_OVERTIME_TOLERANCE_MIN = 5`، `KIDS_OVERTIME_ROUND_STEP_MIN = 5`.
- **`src/pages/KidsAreaPage.tsx`**:
  - مؤقت داخلي `setInterval(30s)` لإعادة رسم العدّادات بدون انتظار polling السبع ثوانٍ.
  - شارة **`kids__ot`** على بطاقة الشريحة: `«⏱ تجاوز 30 د ⇐ سيُضاف 25.00 ج.م عند الإقفال»` (لون كهرماني)، `«⏱ معفى من الوقت الإضافي ✓»` (أخضر)، أو `«⏱ أُضيف للفاتورة: …»` (سيان) بعد التطبيق.
  - مودال التفاصيل: شارة overtime مفصّلة (دقائق خام، مهلة، معدل، قيمة)، شبكة 4 أعمدة (قبل الإضافي / وقت إضافي / مدفوع / متبقي)، زر «✓ إعفاء الوقت الإضافي» يظهر فقط للمدير/المطوّر إذا `overtime.applicable === true`.
  - حوار التسوية يعرض «سيُضاف وقت إضافي N د = X ج.م» قبل تأكيد الدفعة الأخيرة، ورسالة النجاح تذكر الإضافي إن وُجد.
- **متطلب البيانات**: لتفعيل الاحتساب يجب أن يكون لبند المدة في `TBL007` قيم `Hieght3 > 0` (دقائق) و`AgentPrice > 0`. البنود المطبخية تُعلَّم بـ `Custom5 = '55555'` ولا تدخل في حساب سعر الدقيقة.

### 021 — وحدة Kids Area v2: نقطة بيع كاشير + شريحة فاتورة مفتوحة + هرم باقات هرمي — `UTC 2026-05-09T20:10:00Z` — ID `kids-area-v2-cashier-pos-open-invoice`

- `backend/api_server.py` — وحدة جديدة كاملة:
  - **ثوابت + bootstrap**: `KIDS_ROOT_LATIN_NAME = "Kids Area Services"` (TBL006 جذر)، `KIDS_KITCHEN_MARKER = "55555"` (`TBL007.Custom5`)، `KIDS_AGENT_GROUP_NAME = "kids_area_customers"` (TBL015) + عميل افتراضي **«Kids Area»** (TBL016) + مركز كلفة (TBL005). إن لم توجد الجذر/مجموعات/أصناف الافتراضية تُنشأ تلقائياً (idempotent).
  - **هرم القراءة `_kids_load_packages_from_db`**: يقرأ TBL006 sub-groups تحت الجذر كباقات، وكل sub-group ⇒ منتجاتها من TBL007 مع `Custom5` لتمييز بنود المطبخ و`Hieght3` لمدة الباقة بالدقائق و`AgentPrice/EndUserPrice` للسعر.
  - **مسارات جديدة**: `GET /api/kids/packages` (قراءة + bootstrap)، `POST /api/kids/packages` (إنشاء باقة فرعية + بنودها)، `GET /api/kids/tickets[/{id}]`، `POST /api/kids/tickets` (يفتح TBL022 مفتوحة `Paid=0, LockRelations=0` + TBL023 لكل بند الباقة + DownPayment + `BillNotes2..5` + `CustomerName=child`)، `POST /tickets/{id}/fire-kitchen` (يطلق pending kitchen lines إلى **`_kds_upsert_table_order`** بنفس آلية طاولات JSON ⇒ يظهر فوراً في شاشة المطبخ)، `POST /tickets/{id}/add-line` (يضيف صنفاً للفاتورة المفتوحة + يحدّث TBL023)، `POST /tickets/{id}/payment` (دفعة جزئية)، `POST /tickets/{id}/settle` (تسوية + `UPDATE TBL022 SET Paid=1, LockRelations=1, DownPayment=<نهائي>`)، `POST /tickets/{id}/note` (ملاحظة/تنبيه على الشريحة).
  - **التخزين**: `config/restaurant/kids_tickets.json` و`kids_payments.json` لتفاصيل التذاكر والدفعات (إلى جانب الفاتورة الحقيقية في القاعدة).
- `src/pages/KidsAreaPage.tsx` — استبدال كامل (v2) موحّد بحسب الدور:
  - **كاشير**: زر «تذكرة جديدة» يفتح حواراً بشبكة باقات، اختيار → بيانات الطفل/الوالد/هاتف/عمر/ملاحظات/قيمة الحجز → `POST /tickets`. أزرار **+ بند إضافي**، **دفعة جزئية**، **تسوية وإقفال** على بطاقة التذكرة.
  - **kids_guard** (موبيل): يرى نفس الشرائح، يضغط **«اطلب الوجبة الآن»** لإطلاق وجبات الباقة المعلّقة للمطبخ، **+ ملاحظة/+ تنبيه**.
  - شرائح التذاكر: عدّاد المتبقي حتى الخروج المتوقع (يُحسب من `entryAt + packageMinutes`)، تحذير عند تجاوز الوقت، إجمالي/مدفوع/متبقّي، مؤشر **«N وجبة بانتظار إرسال للمطبخ»**.
- نُقطة وصول: `/app/cashier/kids-area`، `/app/manager/kids-area` (منوي لاحقاً)، `/app/kids-guard/kids-area` — كلها صفحة واحدة تتفاعل مع `useAuth().user.role`.

### 024 — Kids Area v3: تخزين SQL مشترك + reserved/start + عدّاد تنازلي + تنبيهات (وجبة + استدعاء) + إعدادات الباقات — UTC 2026-05-10T17:30:00Z — ID kids-area-v3-sql-reserved-countdown-alerts

**المشكلات التي يحلّها هذا القيد** (مذكورة من المستخدم):
1. تذاكر الكيدز كانت محفوظة في JSON محلي ⇒ لا تظهر بين الأجهزة. الحل: ترحيل التخزين إلى **MAT3AM_KIDS_TICKETS** و **MAT3AM_KIDS_TICKET_LINES** + هجرة لمرة واحدة من kids_tickets.json.
2. الوقت لم يُحسب لأن TBL007.Hieght3 كان 0 — وكان الوقت يبدأ من لحظة الحجز. الحل: زر **«🟢 بدء الجلسة»** (state machine: 
eserved → active → closed) يضع ActualStartAt فعلياً، و**ExitExpectedAt = ActualStartAt + PackageMinutesSnapshot**؛ والشريحة تعرض **عدّاد تنازلي حيّ كل ثانية**.
3. لا توجد صفحة لإضافة/تعديل الباقات. الحل: **/manager/settings/kids-area-packages** (متاحة كذلك للمطوّر) تُتيح CRUD كاملاً عبر TBL006/TBL007.
4. تنبيه طلب الوجبة عند نصف الوقت + تنبيه استدعاء قبل 10 د من النهاية.
5. الفاتورة TBL022/023 لم تُعد تُنشأ عند الحجز — تُنشأ **فقط عند الإقفال** (مع **DownPayment = إجمالي ما قُبض**)، ودفعة الحجز تظل **أمانة** حتى ذلك الوقت.

**الباك إند — ackend/api_server.py**:
- DDL داخل **_ensure_mat3am_dev_schema**: جدولان جديدان مع فهارس على Status/CreatedAt/ActualStartAt/FinalInvoiceCardGuide وTicketId (lines).
- Helpers: _kids_db_load_tickets/load_ticket/create_ticket(payload, lines)/start_ticket/add_line/update_kitchen_lines/set_payments_json/set_notes_alerts/set_overtime_exempt/close_ticket، مع _kids_db_row_to_ticket/row_to_line لتوحيد بنية النتائج (camelCase) المتوقعة من الواجهة.
- هجرة لمرة واحدة في startup: **_kids_db_migrate_from_json_once** ينقل التذاكر القديمة من kids_tickets.json (تُحفظ كـ closed) ثم يُعيد تسمية الملف بإضافة .migrated.bak لتجنّب تكرار الهجرة.
- _kids_enrich_ticket(t) أصبح يضيف:
  - **countdown**: { applicable, totalSeconds, remainingSeconds, elapsedSeconds, elapsedRatio }
  - **halfwayMealAlert**: { active, pendingMeals } (active إذا elapsedRatio ≥ 0.50 وعدد وجبات pending > 0).
  - **endingSoonAlert**: { active, minutesLeft } (active إذا متبقّي ≤ 10 د و > 0).
  - **overtime** (محتفظ به كما في 022).
- Endpoints جديدة/مُعدّلة:
  - POST /api/kids/tickets: ينشئ تذكرة بحالة 
eserved ويسجّل PaidAtBooking كأمانة في PaymentsJson — **لا فاتورة TBL022 الآن**.
  - POST /api/kids/tickets/{id}/start: ينقل 
eserved → active ويحدّد ActualStartAt وExitExpectedAt.
  - POST /api/kids/tickets/{id}/fire-kitchen: يطلق فقط بنود IsKitchen=1 AND KitchenStatus IN (NULL,'pending') لشاشة المطبخ ويضع KitchenStatus='sent'.
  - POST /api/kids/tickets/{id}/add-line / /payment / /note / /exempt-overtime: نُقلت كلها لاستخدام جدولي SQL.
  - POST /api/kids/tickets/{id}/settle: عند ctive يضيف بند الوقت الإضافي إن استحق (نفس صيغة 022)؛ ثم **هنا فقط** يُنشئ TBL022/023 موحّدة عبر _kids_create_open_invoice بـ DownPayment = paid_total + amountPaid، ثم _kids_settle_invoice_close لإقفالها فوراً، ثم يحفظ FinalInvoiceCardGuide/FinalBillNumber/FinalTotal/PaidTotal على التذكرة وينقلها إلى closed.
  - GET /api/kids/tickets?status=open يجمع 
eserved + active.
  - **PUT/DELETE/POST items** على /api/kids/packages/... لإدارة الباقات والبنود من صفحة الإعدادات (DELETE الباقة يخفي بنودها فقط بـ NotActive=1 ولا يُحذف من TBL007).

**الواجهة — src/pages/KidsAreaPage.tsx** (إعادة كتابة كاملة):
- نوع KTicket يدعم status: reserved | active | closed، ctualStartAt، paidAtBooking، countdown، halfwayMealAlert، endingSoonAlert.
- loadTickets() يجلب ?status=open. مؤقت محلي setInterval(1s) يحدّث العرض فقط (الأرقام التنازلية)؛ polling السبع ثوانٍ يبقى للسيرفر.
- شريحة **محجوزة** (لون بنفسجي): تُظهر «دفعة الحجز (أمانة)» + وقت الحجز + زر كبير **«🟢 بدء الجلسة»** يستدعي /start.
- شريحة **نشطة** (لون سيان): عدّاد كبير HH:MM:SS + شريط تقدّم + شارات نابضة kids__pill--meal (نصف الوقت لطلب الوجبة) وkids__pill--call (10د قبل النهاية لاستدعاء الطفل) + إجمالي/مدفوع/متبقّي + شارة overtime.
- computeLiveCountdown() يحسب الـ drift من lastSyncMs ⇒ يضمن دقة العدّاد بدون انتظار polling.

**صفحة الإعدادات الجديدة — src/pages/settings/KidsAreaPackagesSettingsPage.tsx**:
- بطاقة «＋ باقة جديدة» بإدخال البنود مباشرة (اسم/سعر/دقائق/مطبخ).
- لكل باقة قائمة بنودها مع أزرار: تسمية الباقة، ＋ بند، حذف الباقة، تعديل بند، إخفاء بند.
- مرتبطة بـ App.tsx على مساري **/app/manager/settings/kids-area-packages** و**/app/developer/settings/kids-area-packages**، ومعروضة في **SettingsLayout** ضمن قسم «التشغيل».

**ملاحظات تشغيلية**:
- بدون قيمة Hieght3 > 0 لبنود المدة، الباقة تُعرض في الواجهة بشارة تحذير أحمر «مدّة الباقة 0 — حدّد TBL007.Hieght3 لبند المدة»، ولا يُسمح ببدء الجلسة (/start يرفض بـ 409).
- الفاتورة المالية الحقيقية (TBL022/TBL023) لا تُولَد إلا في الإقفال، ضامنةً عدم تشويش تقارير الفترة بفواتير «معلّقة».
- الجدولان الجديدان يُنشآن تلقائياً عند startup (idempotent IF OBJECT_ID IS NULL).

### 025 — Shared Terminal Mode + Mandatory PIN Overlay — `UTC 2026-05-10T20:35:00Z` — ID `feat-shared-terminal-pin-a1b2c3`

**القاعدة الجديدة (DDL ضمن `_ensure_mat3am_dev_schema`):**
- **MAT3AM_TERMINAL_SETTINGS** (StateKey='global' سطر واحد): SharedTerminalEnabled, IdleLockMinutes, LockAfter{Save/Edit/Send/Delete/Discount/Return}, MaxAttemptsBeforeLockout, LockoutSeconds, TokenTtlSeconds, UpdatedAt, UpdatedBy.
- **MAT3AM_TERMINAL_PIN_AUDIT**: AtUtc, TerminalId, AttemptedLogin, OldUserId, NewUserId, ActionType (pin_ok/pin_fail/locked), Reason (mandatory_pin_overlay/idle/after_save…), ClientIp, UserAgent + فهرس على AtUtc وعلى (TerminalId, AtUtc).
- **MAT3AM_TERMINAL_LOCKOUT**: TerminalId PK, FailedAttempts, LockedUntilUtc, LastAttemptAt — لاحتساب القفل بعد 3 محاولات.

**مساعدات الباك-إند الجديدة في `backend/api_server.py`:**
- `_terminal_settings_load/save` (camelCase + قيود min/max على المدد).
- `_terminal_token_sign/verify` بصيغة `b64url(payload).b64url(hmac_sha256)` بسرّ من `MAT3AM_TERMINAL_TOKEN_SECRET` (أو يُولَّد لكل تشغيل) — payload: { uid, login, name, role, tid, iat, exp }.
- `_terminal_pin_compare` يقبل النص الخام (للنظام الحالي) أو sha256-hex، فلا يكسر مستخدمين قائمين.
- `_terminal_resolve_user_by_pin(cur, pin, login_hint?)` يبحث في `MAT3AM_APP_USERS WHERE IsActive=1`.
- `_terminal_pin_audit` و`_terminal_get_lockout/_record_failure/_clear_lockout` و`_terminal_get_settings_cached`.
- **`_terminal_require_user(actor)`**: gateway مركزي — يعيد actor كما هو إذا الوضع مُعطَّل، ويرفع 401 إذا مُفعَّل بدون terminalToken صالح.

**Endpoints جديدة:**
- `GET /api/settings/shared-terminal` و`PUT …` (قراءة/حفظ الإعدادات + إجراء `lockTerminal` فوري عند تفعيل الوضع).
- `POST /api/terminal/pin-verify` (body: pin, terminalId, login?, reason?, oldUserId?) — يُصدر terminalToken + ttl، يحدث lockout، يُسجِّل في الـAudit. يرفع 429 مع عدّ الثواني المتبقية عند القفل.
- `GET /api/terminal/sensitive-routes` لعرض المسارات المؤمَّنة في صفحة الإعدادات.
- `GET /api/terminal/audit?limit&terminalId?` لعرض سجل التدقيق.

**ربط `_terminal_require_user` على المسارات الحسّاسة:**
- `POST /api/restaurant/invoices` (إرسال طلب طاولة).
- `POST /api/restaurant/table-sessions` (تسكين/فتح جلسة).
- `PATCH /api/restaurant/tables/{id}/minimum-charge` (تعديل ميني موم).
- `POST /api/kids/tickets` و`/start`و`/fire-kitchen`و`/payment`و`/settle`و`/exempt-overtime`.

**الواجهة:**
- **`src/lib/terminalSession.ts`** (جديد): `getTerminalId()` (يُحفظ في localStorage)، `setTerminalToken/getTerminalToken/clearTerminalToken/getTerminalUserId` — token في الذاكرة فقط (window.__mat3amTerminalToken).
- **`src/lib/mat3amActor.ts`**: توسعة `buildMat3amActor(user)` ليُلحق `terminalId` و`terminalToken` تلقائياً ⇒ كل callsite قائم يدعم الوضع الجديد بلا تعديل.
- **`src/context/TerminalLockContext.tsx`** (جديد): `TerminalLockProvider` يقرأ الإعدادات، يدير حالة `locked/reason/failedAttempts/lockoutUntilEpoch`، مؤقّت خمول، listeners لأحداث الإدخال (mousedown/keydown/touchstart/wheel/visibilitychange)، وملك واجهات `lockTerminal(reason)` و`triggerLock("save"|"edit"|"send"|"delete"|"discount"|"return")` و`unlockWithPin(pin, login?)`.
- **`src/components/PinOverlay.tsx`** (جديد): مودال كامل الشاشة بـ blur + dark filter، حقل PIN ممنوع تجاوزه بـ Tab/Esc، عدّاد تنازلي للقفل، يعرض المحاولات الفاشلة، زر «خروج كامل» بدلاً من «إلغاء» (لا يفك القفل).
- **`src/components/AppShell.tsx`**: يلفّ كل المحتوى بـ `<TerminalLockProvider>` ويُركّب `<PinOverlay />` عالميّاً.
- **`src/pages/settings/SharedTerminalSettingsPage.tsx`** (جديد): صفحة «إعدادات تشغيل نقطة البيع» — اختيار النمط (مستقل/مشترك)، مفاتيح المحفّزات الستة، حقول رقمية (دقائق الخمول، عدد المحاولات، ثواني القفل، TTL الرمز)، عرض المسارات المؤمَّنة، جدول آخر 50 سجلّاً تدقيقياً.
- **`src/pages/settings/SettingsLayout.tsx`**: بند جديد ضمن قسم «التشغيل»: «إعدادات تشغيل نقطة البيع».
- **`src/App.tsx`**: تسجيل المسار `pos-shared-terminal` لكل من `/app/manager/settings/...` و`/app/developer/settings/...`.
- **`src/pages/WaiterOrderPage.tsx`**: استدعاء `terminalLock.triggerLock("send")` عقب نجاح إرسال الطلب للمطبخ ⇒ يُظهر الـ overlay فوراً عند تفعيل الوضع.

**سياسة الأمان:**
- الباك-إند هو مرجع الحماية: حتى لو فشل الفرونت في إظهار الـ overlay، أي طلب على مسار حسّاس بدون `terminalToken` صالح يرفض بـ 401.
- الـ token موقَّع HMAC-SHA256 محلياً ولا يُحفظ في القرص؛ يبقى في ذاكرة التبويب فقط (يُمسَح عند تحديث الصفحة فيُطلب PIN جديد).
- Lockout: بعد `maxAttemptsBeforeLockout` محاولات فاشلة يُغلق الجهاز `lockoutSeconds` ثانية (يُحدَّد في صف `MAT3AM_TERMINAL_LOCKOUT`).
- التحقق من PIN يقبل النص الصريح المخزَّن حالياً في `MAT3AM_APP_USERS.PinHash` كما يقبل sha256-hex لمستخدمين مهيّأين بهاش حقيقي مستقبلاً.

### 026 — Hybrid Mode v2 (Sliding Window + Inline Step-Up + Auto Hard-Logout + User Switch) — `UTC 2026-05-10T21:30:00Z` — ID `feat-shared-terminal-hybrid-d4e5f6`

**الهدف**: استبدال نمط «قفل بعد كل عملية» (الذي يُسبّب احتكاكاً عالياً + اعتياداً ميكانيكياً على «نعم») بسيناريو أذكى:
- العمليات الروتينية (إرسال، حفظ) ⇒ **لا تقفل**، فقط تجدّد عدّاد الخمول (Sliding Window).
- العمليات الخطرة (خصم، مرتجع، حذف بند، تعديل ميني-موم، …) ⇒ **PIN فوري داخل الزر** (Step-Up Authentication).
- الإهمال الطويل ⇒ **خروج كامل تلقائي** (Hard Logout) يُعيد التطبيق لشاشة تسجيل الدخول.
- PIN لمستخدم مختلف ⇒ **تبديل الجلسة تلقائياً** للمستخدم الجديد عبر `auth.login(newUser)`.

**القاعدة (ALTER TABLE idempotent على `MAT3AM_TERMINAL_SETTINGS`):**
- `SlidingRefreshAfterAction BIT NOT NULL DEFAULT 1` ⇒ النمط الافتراضي الجديد هو الهجين.
- `HardLogoutMinutes INT NOT NULL DEFAULT 10` ⇒ زمن الإهمال الذي يستدعي خروجاً كاملاً.
- `StepUpForDangerOps BIT NOT NULL DEFAULT 1` ⇒ تفعيل نموذج PIN داخل أزرار العمليات الخطرة.

**الباك-إند (`backend/api_server.py`):**
- `TERMINAL_SETTINGS_DEFAULTS`: تحوّل `lockAfter*` إلى False افتراضياً، `idleLockMinutes=2`، إضافة الحقول الجديدة الثلاثة.
- `_terminal_settings_load`: يقرأ الحقول الجديدة في استعلام منفصل (try/except) حتى لا يكسر القراءة قبل تنفيذ ALTER.
- `_terminal_settings_save`: يحفظ الحقول الجديدة بـ UPDATE منفصل (try/except للتسامح).
- رد `POST /api/terminal/pin-verify` يُرجع الآن `slidingRefreshAfterAction` و`hardLogoutMinutes` و`stepUpForDangerOps` في كائن `settings`.

**الواجهة (3 ملفات جديدة + 4 معدّلة):**

`src/context/TerminalLockContext.tsx` (إعادة كتابة):
- نوع `TerminalSettings` يضم الحقول الستة الجديدة.
- `triggerLock(trigger)` صار ذكياً: في النمط الهجين يجدّد المؤقت بدلاً من القفل.
- مؤقّت `hardLogoutTimerRef` مستقل ⇒ يستدعي `auth.logout()` بعد `hardLogoutMinutes` من الإهمال.
- `lastTokenIssuedAtRef` ⇒ لتتبع «حداثة» الـ token.
- `stepUp(pin, opts)` جديد: PIN فوري لعملية بعينها، يقبل `skipIfRecent` و`freshSeconds` (افتراضي 60s) لتفادي إعادة الطلب لو الـ PIN حديث جدّاً.
- `isTokenFresh(freshSeconds)` ⇒ يفحص ما إذا كان الـ token الحالي أحدث من `freshSeconds`.
- `maybeSwitchUser(j)` ⇒ يستدعى داخل `consumeToken` ⇒ لو user.id من الرد ≠ user.id الحالي ⇒ `auth.login(newUser)` تلقائياً.

`src/components/InlinePinConfirm.tsx` (جديد):
- مكوّن زر يلفّ عملية خطرة. ثلاث حالات داخلية:
  1. الوضع المشترك مغلق ⇒ زر عادي يستدعي `onConfirm` مباشرة.
  2. الـ token «طازج» (آخر pin منذ < freshSeconds) ⇒ زر عادي بدون PIN، مع tooltip يُوضح ذلك.
  3. خلاف ذلك ⇒ ضغطة الزر تكشف حقل PIN صغير + تأكيد + إلغاء (Esc/زر).
- ينادي `lock.stepUp(pin, { reason })` ⇒ سجل تدقيق يُسجَّل بـ `step_up:<reason>`.
- يدعم variants (`danger`/`warn`/`primary`).

`src/pages/settings/SharedTerminalSettingsPage.tsx` (إعادة كتابة كاملة):
- قسم «طريقة استخدام نقطة البيع»: راديو مستقل/مشترك.
- قسم «نمط القفل»: راديو **هجين منزلق ★** (موصى به) / **قفل بعد كل عملية (كلاسيكي)**.
- قسم «إعدادات النمط الهجين»: نافذة الخمول، خروج كامل، حداثة Token، تشغيل Step-Up.
- قسم «نمط كلاسيكي»: نفس مفاتيح `lockAfter*` السابقة.
- قسم «سياسة محاولات PIN»: max attempts + lockout seconds.
- يستخدم `getApiBase()` بدلاً من المسارات النسبية ⇒ يعمل على Vite dev (9999) وعلى exe (file://).

`src/pages/WaiterTablesPage.tsx`:
- استيراد `InlinePinConfirm`.
- زر «حفظ» على الميني-موم في بطاقة الطاولة ⇒ مستبدَل بـ `<InlinePinConfirm reason="minimum_charge_override" variant="warn">`.
- `saveMinimumCharge` صار يُمرّر `mat3amActor: buildMat3amActor(user)` (كان مفقوداً ⇒ الباك-إند كان يرفض في الوضع المشترك).

`src/components/PinOverlay.tsx`:
- إضافة `hard_logout` لـ `REASON_LABEL` للتعامل الصحيح مع نوع `LockReason` الموسّع.

**حدود/قرارات:**
- الـ Hard-Logout يستدعي `auth.logout()` ⇒ المستخدم يُعاد لشاشة تسجيل الدخول الكلاسيكية ⇒ لا «معجزة استمرار»، فقط بداية نظيفة.
- `freshSeconds` افتراضي 60 ⇒ لو الجرسون ضغط 5 أزرار خصم خلال دقيقة، يُطلب PIN واحد فقط في أوّلها.
- `triggerLock("send")` في `WaiterOrderPage` لا يحتاج تعديل ⇒ يفرّع داخلياً حسب النمط (هجين: تجديد فقط، كلاسيكي: قفل).
- لم يُربط بعدُ `InlinePinConfirm` على «حذف بند مرسل للمطبخ»/«مرتجع»/«إقفال جلسة» ⇒ متروك لجولة لاحقة (الباك-إند يحمي بالفعل).

**الفحوص الأربعة (كلها خضراء):**
- Backend `py_compile` ⇒ exit 0.
- ReadLints على 6 ملفات (Context/Inline/Overlay/Settings/Tables/Order) ⇒ لا أخطاء.
- `tsc -b` ⇒ نجح.
- `vite build` ⇒ نجح (تحذير حجم chunk فقط).

**سيناريو اختبار للمستخدم النهائي:**
- اذهب إلى **إعدادات → التشغيل → إعدادات تشغيل نقطة البيع**.
- اختر «جهاز مشترك» + «هجين منزلق ★» + اضبط نافذة الخمول 1د، خروج كامل 5د.
- احفظ ⇒ يظهر overlay يطلب PIN.
- ادخل PIN صحيح ⇒ يفتح. اذهب لـ «الطاولات» وافتح بطاقة طاولة.
- اضغط زر «حفظ» على الميني-موم ⇒ يكشف حقل PIN (لأن الـ token > 60s أم لا — حسب التوقيت).
- ادخل PIN ⇒ يحفظ ويختفي حقل PIN. كرّر خلال 60 ثانية ⇒ ينفذ مباشرة بلا PIN (token طازج).
- اترك الجهاز دقيقة بدون لمس ⇒ overlay يظهر.
- اترك 5 دقائق بدون لمس ⇒ خروج كامل، شاشة تسجيل الدخول تظهر.
- ادخل PIN لمستخدم مختلف من الـ overlay ⇒ يفتح ويبدّل اسم المستخدم في الشريط الجانبي تلقائياً.

**التحقق (الفحوص الأربعة كلها خضراء):**
- Backend syntax: `python -m py_compile backend/api_server.py` — exit 0.
- Frontend lints (ReadLints) — لا أخطاء.
- TypeScript build (`tsc -b`) ضمن `npm run build` — نجح.
- Vite build — نجح؛ تحذير حجم chunk فقط (ليس خطأ).

**نقاط متروكة لجولة لاحقة (موثَّقة كـ TODO):**
- `triggerLock("save")` لم يُربط بعدُ في `WaiterTablesPage` (تسكين/تعديل) ولا في صفحات الإعدادات الأخرى ولا في صفحة Kids؛ لكن **حماية الباك-إند تكفي وحدها** لرفض أي طلب بلا PIN. تجربة المستخدم ستتحسّن بإضافة الاستدعاءات لاحقاً.
- لا ربط بعد لمحفّز `delete/discount/return` في صفحات الكاشير المتقدّمة — هي أيضاً محمية إن مرّت عبر مسارات الفواتير/المرتجعات الموجودة في القاعدة (تحتاج جولة لاحقة لربطها صراحة).
- الـ secret التوقيعي يُولَّد عشوائياً عند تشغيل البروسس إن لم يُضبط `MAT3AM_TERMINAL_TOKEN_SECRET` ⇒ كل إعادة تشغيل تُبطل tokens سابقة (سلوك آمن لكن يستحسن ضبط متغير دائم في الإنتاج).
- `MAT3AM_APP_USERS.PinHash` لا يزال نصّاً صريحاً لمستخدمين قدامى؛ خطة الترحيل لإجبار sha256 ستكون في إصدار لاحق.

### 027 — نقطة مرجعية Git + Tag + لقطة ZIP محلية — `UTC 2026-05-10T22:45:00Z` — ID `checkpoint-2026-05-11`

- **Commit** `f8e07a8` ثم تكميل توثيق `a386e5a` على الفرع `dev-next-baseline-2026-05-05`.
- **Tag** `mat3am-checkpoint-2026-05-11` — دفع إلى `origin` مع الفرع.
- **`docs/CHECKPOINT_2026-05-11.md`**: ملخص ما وصل إليه المشروع، أوامر الرجوع للخلف، إشارة إلى مسار الموبايل القادم، بدون تنفيذ كود جديد للموبايل بعد.
- **`backups/mat3am-snapshot-2026-05-11-src-backend-docs.zip`**: أرشيف محلي لمجلدات `src` + `backend` + `docs` (مجلد `backups/` في `.gitignore`).

### 028 — جلسة 1 موبايل: شريحات الطاولات responsive (CSS فقط) — `UTC 2026-05-10T23:15:00Z` — ID `mobile-s1-waiter-tables-css`

- **`src/styles/operationalRoles.css`**:
  - شبكة الطاولات: عمود واحد عند `max-width: 720px` بدلاً من عمودين ضيقين على الجوال.
  - `@media (max-width: 768px)` لـ `.role-op.waiter-pos`: هوامش آمنة، تقليل حشوة المحتوى، شريط أدوات عمودي، زر تحديث بعرض كامل، أهداف لمس ≥44px، رأس الصفحة أخف، بطاقة الطاولة: صف أزرار عمودي، زر المطالبة بعرض كامل، شبكة الماليات ثلاثية → عمود واحد، تنبيه سريع + إرسال متكدسان، `safe-area` للشقوق.
- **بدون** تعديل `WaiterTablesPage.tsx` أو API.

### 029 — بطاقات الطاولات: إزالة زرّ داخل زر (validateDOMNesting) — `UTC 2026-05-11T07:35:00Z` — ID `fix-waiter-card-nested-btn`

- **`src/pages/WaiterTablesPage.tsx`**: استبدال الغلاف الخارجي لبطاقة الطاولة من `<button>` إلى `<div>` مع نفس منطق النقر (`openOrderTakerForTable`)؛ إيقاف انتشار النقر من «تقرير سريع» ومن صف التذييل؛ `aria-label` للبطاقة — يزيل تحذير React في الكونسول ويصحّح HTML.

### 030 — سايدبار AppShell قابل للطي (حافة + تخزين) — `UTC 2026-05-11T17:50:00Z` — ID `appshell-sidebar-rail`

- **`src/components/AppShell.tsx`**: `sidebarOpen` + مفتاح `mat3am_shell_sidebar`؛ ≤960px سايدبار ثابت مع خلفية تعتيم؛ تبويب حافة (‹) لفتح وزر › لطي؛ إغلاق بعد اختيار رابط على الشاشة الضيقة.
- **`src/styles/appShell.css`**: أنماط الغلاف والسكة والسايدبار والخلفية.
- **`src/pages/WaiterTablesPage.tsx`**: نوع حدث `showTableReport` → `HTMLElement` ليتوافق مع `onContextMenu` على بطاقة `div`.

### 031 — تمرير أفقي لمجموعات التصنيف (شريط جرسون) — `UTC 2026-05-11T18:15:00Z` — ID `waiter-cats-hscroll`

- **`src/styles/operationalRoles.css`**: بطاقة التصنيفات في الشريط العلوي `overflow-x: auto`؛ حاوية `.waiter-pos__cats-inbar` داخلها `overflow-x: auto`؛ عند `max-width: 900px` صف `flex` nowrap + أزرار بعرض ~90px لتمكين السحب أفقياً (شبكة `1fr` كانت تمنع التمرير).

### 032 — إصلاح تمدد أزرار التصنيف عمودياً (جوال) — `UTC 2026-05-11T18:40:00Z` — ID `waiter-cats-hscroll-fix`

- **`src/styles/operationalRoles.css`**: استبدال `align-items: stretch` بـ `flex-start`، حدّ ارتفاع الشريط العلوي والتصنيفات على الجوال، أبعاد ثابتة للأزرار + `cat-wrap` بـ `height: auto`، اختصار نص التسمية بـ `-webkit-line-clamp` لتفادي الأعمدة الطويلة.

### 033 — شريط أسفل الجوال: «إرسال الطلب» ظاهر دائماً — `UTC 2026-05-11T19:05:00Z` — ID `waiter-mb-sendbar`

- **`src/pages/WaiterOrderPage.tsx`**: منطقة `waiter-pos__mb-sendbar` تحت البحث — ملخص السلة + نفس زر الإرسال.
- **`src/styles/operationalRoles.css`**: شريط `fixed` أسفل الشاشة عند `max-width: 900px` + `padding-bottom` للمحتوى حتى لا يُحجب آخر البطاقات.

### 034 — تجربة جوال «طلب للطاولة»: عمود واحد ترتيب مهام + رأس مبسّط — `UTC 2026-05-11T19:35:00Z` — ID `waiter-mobile-task-flow`

- **`src/pages/WaiterOrderPage.tsx`**: صنف جذر `waiter-pos--order-taker` + غلافات `waiter-pos__hdr-*` لحقول الرأس.
- **`src/styles/operationalRoles.css`**: الشريط العلوي يصبح عمودياً بترتيب: الطاولة ← التصنيف ← السلة ← المقاعد ← الإجماليات ← انتقل/خيارات؛ إخفاء إرسال مكرر من لوحة السلة (يبقى الشريط السفلي + قائمة السلفية)، ضبط بحث sticky، شبكة منتجات أوضح للمس، رأس جوال بدون عنوان مطلق يغطي الشاشة وإخفاء سطر حقوق على الجوال.

### 036 — شريط أقسام جوال داخل «طلب للطاولة» (بدون التصنيف) — `UTC 2026-05-11T20:25:00Z` — ID `waiter-ot-section-rail`

- **`src/pages/WaiterOrderPage.tsx`**: `WAITER_OT_RAIL_SECTIONS` + `<nav class="waiter-pos__ot-rail">` بأزرار `scrollIntoView` إلى معرفات الأقسام الثابتة (طاولة، قيد، توزيع، مرسل، حساب، خيارات، بحث، أصناف) — **استثناء** بطاقة «التصنيف - الفئة» من الشريط كما طُلب؛ معرفات `waiter-ot-sec-*` و`waiter-pos__ot-scroll-target` على الأهداف.
- **`src/styles/operationalRoles.css`**: إظهار الشريط عند `max-width: 900px` فقط، تموضع `fixed` على `inline-end` فوق شريط الإرسال، `scroll-margin-top`، هامش `main` و`mb-sendbar` حتى لا يتداخل المحتوى مع الشريط.

### 037 — توضيح توزيع المقاعد واسم الضيف على الشيك — `UTC 2026-05-11T21:05:00Z` — ID `waiter-seat-copy-clarity`

- **`src/pages/WaiterOrderPage.tsx`**: تلميح نصي تحت أوضاع التوزيع؛ أزرار **حسب المقعد (١–١٢)** / **طلب عام (بدون مقعد)**؛ عرض افتراضي **مقعد N** و**١٣ — مشترك**؛ عناوين مساعدة و`placeholder` أوضح؛ نص مقعد ١٣ السفلي وشرح السبليت في خيارات الطاولة؛ مودال الإضافات يعرض «مقعد» بدل «كرسي» حيث ينطبق.
- **`src/styles/operationalRoles.css`**: صنف `.waiter-pos__seat-panel-hint` لتنسيق التلميح.

### 038 — إصلاح اختفاء صفوف المقاعد على الجوال — `UTC 2026-05-11T21:35:00Z` — ID `waiter-seatpanel-mobile-height`

- **`src/styles/operationalRoles.css`**: داخل `@media (max-width: 900px)` — رفع `max-height` لبطاقة `seatpanel`، سقف ارتفاع للتلميح مع تمرير، و`min-height` + `flex` لمنطقة `.waiter-pos__seat-list-scroll--in-topbar` حتى لا تنهار إلى ارتفاع صفر بعد التلميح الطويل.

### 041 — ترتيب شريط «طلب للطاولة» الأيسر حسب منطق الجرسون — `UTC 2026-05-11T23:15:00Z` — ID `waiter-ot-rail-order`

- **`src/pages/WaiterOrderPage.tsx`**: إعادة ترتيب `WAITER_OT_RAIL_SECTIONS` (شريط `waiter-pos__ot-rail` داخل الصفحة فقط): طاولة → توزيع → فئات → بحث → أصناف → قيد → مرسل → حساب → خيارات؛ توضيح تعليق أنه **ليس** سايدبار التطبيق العام.

### 042 — جوال: طيّ «قائمة الضيوف» بعد تأكيد الضيف + توست + سكربت التدفق — `UTC 2026-05-11T23:42:30Z` — ID `waiter-ot-seat-flow-mob`

- **`src/pages/WaiterOrderPage.tsx`**: بعد ✓/«الفئات»/Enter في وضع ضيق — `afterSeatNameConfirmGoCategories` يطوي لوحة المقاعد وينتقل للفئات؛ زر الشريط «قائمة الضيوف» يعيد فتح اللوحة؛ توست قصير فوق شريط الإرسال مع إغلاق؛ ضغط صف مقعد يعيد فتح اللوحة على الجوال؛ رسائل التدفق أقصر.
- **`src/styles/operationalRoles.css`**: `.waiter-pos__seatpanel--mob-collapsed`، `.waiter-pos__seatpanel-mob-expand`، `.waiter-pos__ot-flow-toast` (ثابت فوق الشريط السفلي مع هامش الشريط الجانبي).

### 046 — جوال: شريط أقسام الطلب أوضح + تكبير (لمس أو زر +) + dock — `UTC 2026-05-12T04:05:00Z` — ID `mobile-nav-touch-zoom`

- **`src/pages/WaiterOrderPage.tsx`**: زر **+ / −** أعلى الشريط لتثبيت التوسيع؛ صنف `waiter-pos--ot-rail-expanded` = لمس أو تثبيت؛ إنهاء اللمس على `window` بفقاعة (تجنّب إلغاء التكبير قبل الرسم)؛ تسميات أقصر على الأزرار (`طاولات`، `ضيوف`) مع `title` كامل.
- **`src/styles/operationalRoles.css`**: عرض/خط أكبر افتراضاً؛ `expanded` بـ`!important` للعرض؛ `.waiter-pos__ot-rail__pin`؛ `z-index` أعلى للشريط.
- **`src/components/AppShell.tsx`** + **`src/styles/appShell.css`**: تكبير `app-shell__dock` عند اللمس (شاشات الطاولات وغير order-taker) كما سبق.

### 045 — عودة جرسون الموبايل من «طلب للطاولة» إلى قائمة الطاولات — `UTC 2026-05-12T02:10:00Z` — ID `waiter-order-exit-tables`

- **`src/pages/WaiterOrderPage.tsx`**: مسار خروج موحّد `orderTakerExitPath` (جرسون → `/app/waiter/tables`، مدير/مطوّر → `captain-tables`، تضمين دليفري → لوحة الكاشير إن وُجد `backTo`)؛ الرأس يستخدم `backTo` دائماً بدل `onBack` المشروط الذي كان يُلغي الرجوع عند تمرير `backTo` فارغ؛ زر شريط جوال **«الطاولات»** أول الشريط للعودة.
- **`src/styles/operationalRoles.css`**: زر رجوع أوضح على الجوال + `.waiter-pos__ot-rail__btn--home`.

### 044 — تسجيل دخول: إلغاء انتظار ping الطويل + توضيح dev ولمحة waiter/123 — `UTC 2026-05-12T01:05:00Z` — ID `login-no-post-ping-block`

- **`src/pages/LoginPage.tsx`**: بعد نجاح `POST /api/auth/login` يتم الدخول والتوجيه فوراً (كان ينتظر حتى ١٢ ثانية لـ`/api/ping` فيُعلّق على «جاري التحقق…»)؛ زر التجربة أصبح نصّه **«دخول تجريبي (حساب dev)»** مع `title` يوضح أنه ليس جرسوناً؛ تلميح افتراضي **waiter / 123**.

### 043 — جوال: «قائمة الضيوف» + تبويبات الضيوف في الشريط (سلّة = مقعد) — `UTC 2026-05-12T00:15:00Z` — ID `waiter-ot-rail-guest-tabs`

- **`src/pages/WaiterOrderPage.tsx`**: إعادة تسمية قسم التوزيع للمستخدم إلى **قائمة الضيوف** (عنوان البطاقة في وضع حسب المقعد، وزر الشريط، و`title` المقطع)؛ بعد «قائمة الضيوف» في الشريط على الجوال + حسب المقعد تُدرَج أزرار **١→١٢ ثم ١٣ مشترك** تعرض اسم الضيف أو «مقعد N»؛ اللمس يفعّل `selectedSeat`، يطوي لوحة الأسماء، وينتقل للفئات؛ تمييز المقعد النشط.
- **`src/styles/operationalRoles.css`**: صنف `waiter-pos--ot-rail-guests` على الجذر لتوسيع هامش المحتوى والشريط قليلاً؛ `.waiter-pos__ot-rail__btn--guest` و`--active`.

### 035 — شريط أيقونات جانبي للجوال (بدون تغيير سطح المكتب) — `UTC 2026-05-11T19:10:00Z` — ID `appshell-mobile-dock-rail`

- **`src/components/AppShell.tsx`**: `isNavItemActive` + `NavDockGlyph` (SVG مضمّن لكل مفتاح مسار شائع)؛ عند العرض الضيق وظهور كروم السايدبار: شريط `.app-shell__dock` بأيقونات لكل بند القائمة + زر «قائمة» يفتح السايدبار (حساب، DB، خروج)؛ إخفاء الشريط عند فتح السايدبار؛ زر حافة `‹` يبقى للشاشات الأوسع عند طي السايدبار؛ `paddingInlineStart` على `<main>` عند ظهور الشريط.
- **`src/styles/appShell.css`**: تموضع الشريط الثابت على بداية السطر (`inline-start`)، تمرير عمودي، أهداف لمس ~44px، تمييز الرابط النشط.

### 047 — رفع GitHub + نسخة exe محلية Mat3amPOS021 — `UTC 2026-05-12T12:50:00Z` — ID `gitpush-mat3am021`

- **`git push`** الفرع `dev-next-baseline-2026-05-05` → `origin` (`Nabilsoliman9869/resturant_2026`) عند commit **`52e9d82`** (جرسون/AppShell/تسجيل/CSS + `config/restaurant` المتتبَّع + `appShell.css`).
- **`dist/Mat3amPOS021.exe`**: نسخ محلي من `dist/Mat3amPOS.exe` (مجلد `dist/` في `.gitignore` ولا يُرفع). لم يُشغَّل `scripts/prepare_mat3am_exe_build.py` لعدم توفر `python`/`py` في PATH على الجهاز.

### 048 — جوال: تعريف ضيوف أولاً، شريط مقاعد مُصفّى، بحث طاولة، جدولة يومية اختيارية — `UTC 2026-05-12T14:20:00Z` — ID `mobile-ot-guests-schedule-jump`

- **`backend/api_server.py`**: `_user_has_role_schedule_covering_today` + مفتاح **`enforceRoleScheduleForShift`** في `restaurant_ops`؛ عند التفعيل يرفض `POST /api/auth/login` أدوار الصالة (`waiter`/`host`/`server`/`speed_order`) بدون صف جدولة يغطي اليوم برسالة **«أنت لست ضمن فريق العمل اليوم»**؛ تعطيل افتراضي؛ عطل استعلام الجدولة لا يُسقِط الدخول (`True` عند خطأ SQL).
- **`src/pages/settings/RestaurantOpsSettingsPage.tsx`**: بطاقة **الوردية وجدولة الأدوار** + حفظ المفتاح.
- **`src/pages/WaiterOrderPage.tsx`**: ترتيب شريط الجوال يضع **تعريف ضيوف** بعد **طاولات**؛ أزرار المقاعد في الشريط = **المقاعد المُسمّاة فقط + ١٣ مشترك**؛ زر **أصناف** يمرّر العرض على **البحث** ثم الشبكة؛ تكبير لمس الشريط يبقى ~300ms بعد رفع الإصبع.
- **`src/pages/WaiterTablesPage.tsx`**: حقل **انتقال سريع** + زر **انتقل** + `scrollIntoView` ووميض على الشريحة.
- **`src/components/AppShell.tsx`** + **`src/styles/appShell.css`**: تأخير إطفاء تكبير الـ dock بعد اللمس؛ أيقونات أكبر عند التوسيع.
- **`src/styles/operationalRoles.css`**: أدوات شريط الطاولات، وميض الانتقال، وتكبير أوضح لشريط أقسام الطلب.

### 049 — إصلاح قراءة «إلزام الجدولة»: دمج ملف ops فوق SQL — `UTC 2026-05-12T15:05:00Z` — ID `enforce-schedule-read-merge`

- **`backend/api_server.py`**: `_restaurant_read_ops_storage` يطبّق **`restaurant_ops_settings.json` بعد SQL**؛ تسجيل الدخول يقرأ `enforceRoleScheduleForShift` من هذا الدمج؛ مقارنة الجدولة بـ **`CAST(ValidFrom/ValidTo AS DATE)`**.
- **`src/pages/settings/RestaurantOpsSettingsPage.tsx`**: ملاحظة أن **إعادة تشغيل الـ API ليست شرطاً** بعد الحفظ.

### 050 — إلزام الجدولة: توحيد «اليوم» مع الواجهة (localDate + SYSDATETIME) — `UTC 2026-05-12T15:40:00Z` — ID `schedule-today-local-align`

- **`backend/api_server.py`**: فحص الجدولة ودور الدخول الفعّال يستخدمان **`localDate` / `calendarDate` / `clientToday`** من جسم تسجيل الدخول عند توفرها؛ وإلا **`CAST(SYSDATETIME() AS DATE)`** (وقت خادم SQL المحلي) بدل **`SYSUTCDATETIME()`** (UTC) الذي كان يُبقي أسامة «ضمن الجدولة» بعد انتهاء اليوم في الواجهة؛ `_user_has_role_schedule_covering_today` عند خطأ SQL ترجع **False** بدل السماح للجميع.
- **`src/pages/LoginPage.tsx`**: إرسال **`localDate`** بنفس منطق صفحة الجدولة (تقويم المتصفح المحلي).

### 051 — إلزام الوردية: رأس التاريخ + الدور الأساسي + تطبيع اسم الدخول — `UTC 2026-05-12T16:15:00Z` — ID `shift-enforce-header-base-role`

- **`backend/api_server.py`**: `_login_calendar_iso_from_request` (JSON + **`X-Mat3am-Local-Date`**)، و**`_enforce_role_schedule_shift_active()`** (يشمل **`MAT3AM_ENFORCE_SHIFT=1`** للاختبار السريع)؛ الإلزام يُطبَّق إن كان **الدور الأساسي أو الفعّال** من أدوار الصالة؛ مطابقة **`LoginName`** بدون حساسية لحالة الأحرف.
- **`src/pages/LoginPage.tsx`**: إرسال رأس **`X-Mat3am-Local-Date`** مع **`localDate`**.

### 052 — جوال: عرض قوائم `<select>` (عرض كامل + خط 16px) — `UTC 2026-05-12T20:10:00Z` — ID `mob-select-width-16px`

- **`src/styles/operationalRoles.css`**: `.waiter-pos__select` — إزالة سقف **`max-width: 200px`** لصالح **`max-width: 100%`** و**`min-width: 0`** و**`width: 100%`**؛ `.waiter-tblcard__alert-select` — **`min-width: 0`** و**`max-width: 100%`**؛ في `@media (max-width: 768px)` زيادة **`font-size: max(16px, 0.9rem)`** لـ `.waiter-pos__select` لتقليل تكبير iOS وتحسين قراءة الخيار.
- **`src/index.css`**: قاعدة عامة **`@media (max-width: 768px)`** لـ **`select`** (عرض كامل للحاوية، **`min-height: 44px`**, **`font-size: max(16px, 1em)`**).

### 053 — إصلاح قصّ قائمة تحويل/دمج داخل «خيارات الطاولات» (overflow) — `UTC 2026-05-12T21:05:00Z` — ID `ot-select-overflow-navopts`

- **`src/pages/WaiterOrderPage.tsx`**: استبدال **`waiter-pos__dropdown-wrap`** حول حقول **تحويل/دمج** بـ **`waiter-pos__field-stack`** (لا `max-height` ولا `overflow:auto` على الحاوية).
- **`src/styles/operationalRoles.css`**: تعريف **`.waiter-pos__field-stack`**؛ **`navopts`** على الجوال (`max-width:900px`) بدون **`max-height`/`overflow-y:auto`**؛ **`navopts:has(.waiter-pos__field-stack:focus-within)`** + **`topbar:has(...)`** لرفع **`overflow-y`** عند فتح القائمة على الشاشات الواسعة.

### 054 — تحويل/دمج: بحث + أزرار بدل `<select>` — `UTC 2026-05-12T22:15:00Z` — ID `ot-transfer-merge-search-pick`

- **`src/pages/WaiterOrderPage.tsx`**: **`transferPickQuery`** / **`mergePickQuery`** + **`matchesTablePickQuery`**؛ قائمة مرشّحين حتى 60 طاولة؛ اختيار بضغطة صف؛ **تنفيذ التحويل** / **تنفيذ الدمج**؛ مسح الاختيار والاستعلام بعد نجاح العملية.
- **`src/styles/operationalRoles.css`**: أصناف **`.waiter-pos__table-pick-*`** و**`.waiter-pos__table-move-block`** لحقل البحث والقائمة القابلة للتمرير داخل الصندوق.

### 055 — تحويل/دمج: طاولات فارغة + دمج بنفس الكابتن + API — `UTC 2026-05-12T23:20:00Z` — ID `ot-move-empty-same-captain`

- **`src/pages/WaiterOrderPage.tsx`**: **`tablesMoveCatalog`** (كل الطاولات من المخطط) و**`sessionByTableRef`** من الجلسات النشطة؛ التحويل يعرض **طاولات بلا جلسة** (ويستبعد متسخة/تنظيف)؛ الدمج يعرض طاولات **لها جلسة لنفس `captainGate`**؛ تحديث الخريطة كل 12 ثانية مع الاستطلاع؛ **`mat3amActor`** في PATCH/merge؛ **`loadAll()`** بعد نجاح النقل.
- **`backend/api_server.py`**: **`PATCH …/table-sessions`** — رفض النقل إن وُجدت جلسة نشطة أخرى على طاولة الهدف؛ تعبئة **مسند الطلب** من **`mat3amActor`** إن كانت الجلسة بلا كابتن؛ **`POST …/merge`** — رفض الدمج إن اختلف **كابتن** المصدر والهدف عند وجود كابتن على المصدر.

### 056 — إصلاح الدمج: مطابقة tableId + وراثة كابتن الهدف — `UTC 2026-05-13T00:05:00Z` — ID `merge-tableid-captain-inherit`

- **`backend/api_server.py`**: **`_restaurant_table_ids_equal`** لمطابقة **`tableId`** مع **`targetTableId`** (GUID) في **`POST …/merge`** وفي فحص التحويل؛ عند الدمج إن كانت جلسة **الهدف بلا `captainUserId`** يُنسَخ المسند من **المصدر**؛ رفض الدمج فقط عند تعارض كابتنين **غير فارغين**.
- **`src/pages/WaiterOrderPage.tsx`**: **`mat3amGuidNormEq`** لعرض أهداف الدمج؛ السماح بجلسات الهدف **بلا كابتن** عندما المستخدم مسند (`captainGate`).

### 057 — دمج/فراغ الطاولة: فهرس الجلسة تحت مرجع المخطط (T14 vs GUID) — `UTC 2026-05-13T00:35:00Z` — ID `session-map-catalog-tableid`

- **`src/pages/WaiterOrderPage.tsx`**: **`restaurantTableIdsEqual`** + **`buildSessionByTableRef(sess, catalog)`** — بعد الفهرسة بـ `session.tableId` يُربط كل صف مخطط بنفس الجلسة إن تطابقت المعرفات؛ يُحدَّث الاستطلاع كل 12 ثانية بمرور **`tablesMoveCatalog`** حتى يعمل الدمج بعد التحميل.

### 058 — بحث الدمج: `t14`/`14` + رسالتان (لا أهداف / لا نتائج بحث) — `UTC 2026-05-13T01:00:00Z` — ID `merge-search-t14-messages`

- **`src/pages/WaiterOrderPage.tsx`**: **`matchesTablePickQuery`** يدعم **`t14`/`14`** مع **`t.number`** وحدود رقم في الاسم؛ **`mergePickBase`** منفصل؛ رسالتان للفراغ؛ **`tablesMoveCatalog`** لعرض اسم المختار في التحويل/الدمج.

### 059 — تحويل/دمج: قائمة فقط بعد «بحث» أو Enter — `UTC 2026-05-13T02:45:00Z` — ID `table-pick-explicit-search`

- **`src/pages/WaiterOrderPage.tsx`**: **`transferSearchResults`** / **`mergeSearchResults`** (`null` قبل التشغيل)؛ **`runTransferTableSearch`** / **`runMergeTableSearch`**؛ صف حقل + زر **«بحث»**؛ لا تُعرض الطاولات تحت الحقل حتى البحث؛ إعادة تعيين النتائج والاختيار عند تغيير الاستعلام أو **`selectedTableId`**.
- **`src/styles/operationalRoles.css`**: **`.waiter-pos__table-pick-search-row`**، **`.waiter-pos__table-pick-search-btn`**، **`.waiter-pos__table-pick-hint`**.

### 060 — معاينة واجهة الجرسون Style 1/2 للعرض على الفريق — `UTC 2026-05-15T12:00:00Z` — ID `waiter-ui-preview-lab`

- **`src/lab/waiterUiPreview/`**: صفحة معاينة ببيانات وهمية، تبديل Style 1 (كلاسيك) / Style 2 (سهل)، حقل ملاحظات + نسخ.
- **`src/styles/waiterUiEase.css`**: تخطيط Style 2 (تبويبات، فئات أفقية، شبكة بطاقات، شريط إرسال).
- **`src/App.tsx`**: مسار **`/preview/waiter-order-ui`** بدون تسجيل دخول.

### 061 — مقارنة نماذج Stitch (HTML) مع طلب للطاولة الإنتاجي — `UTC 2026-05-15T14:30:00Z` — ID `stitch-html-gap-notes`

- **`docs/design-reference/STITCH_HTML_VS_WAITER_ORDER_PAGE.txt`**: فجوات المسميات (شريط الأقسام، البحث، المودال، سبْليت، مقعد ١٣) مقابل **`WaiterOrderPage.tsx`**؛ توجيه استخدام HTML كمرجع بصري مع تصحيح النصوص قبل دمج Style 2.

### 062 — تحديث مقارنة Stitch بعد النسخة الثانية من HTML — `UTC 2026-05-15T16:00:00Z` — ID `stitch-html-revision-2`

- **`docs/design-reference/STITCH_HTML_VS_WAITER_ORDER_PAGE.txt`**: قسم **مراجعة ثانية** — تقييم التحسينات (معرفات الشريط، نصوص المقعد، placeholder، سبْليت الطويل في النموذج ج) وبقاء الفجوات (تحويل/دمج كاملين، سبْليت النموذج أ، أزرار غير موجودة في النموذج ج، توحيد «إرسال الطلب»).

### 063 — مراجعة ثالثة لنماذج Stitch (دُفعة HTML جديدة) — `UTC 2026-05-15T18:00:00Z` — ID `stitch-html-revision-3`

- **`docs/design-reference/STITCH_HTML_VS_WAITER_ORDER_PAGE.txt`**: قسم **مراجعة ثالثة** — الكلاسيك (تحويل/دمج منفصلان، مودال محسّن، تعارض محتمل بين زر «إرسال الطلب» وزر «مرسل» بالشريط)؛ التبويبي (أسماء ضيوف لكل مقعد، سبْليت كامل، قيد، خيارات موسعة)؛ الدرج (طلب الحساب، إرسال الطلب) وبقيّة «تحويل أصناف» / «طباعة فاتورة».

### 064 — سياسة التصاميم المرشحة vs الفجوات التقنية — `UTC 2026-05-15T19:00:00Z` — ID `design-mocks-internal-policy`

- **`docs/design-reference/STITCH_HTML_VS_WAITER_ORDER_PAGE.txt`**: فقرة **سياسة الاستخدام** أعلى الملف + مسؤولية التطوير — المرشحات لمظهر/توزيع فقط؛ حسم الفروقات عند دمج React؛ الملف مذكرة داخلية وليس قائمة إلزامية على جهة التصميم.

### 065 — «نموذج ٢»: تنقّل جوال بتبويبات سفلية بديل الشريط الجانبي — `UTC 2026-05-15T22:00:00Z` — ID `waiter-ot-ui-tabs-model2`

- **`src/pages/WaiterOrderPage.tsx`**: تفضيل **`classic` \| `tabs`** على الجوال فقط (`narrowOtViewport`)؛ تخزين **`localStorage`** (`mat3am_order_taker_ui_v1`)؛ معامل **`?orderUi=tabs|classic`** يُطبَّق ثم يُزال من عنوان الصفحة؛ **`onOtRailRowActivate`** موحّد بين الشريط والتبويبات؛ شريط **`waiter-pos__ot-tabbar`** بديل DOM للشريط الجانبي عند **`tabs`**؛ قائمة هيدر «تنقّل الجوال».
- **`src/styles/operationalRoles.css`**: مُعدّل **`waiter-pos--ot-ui-tabs`** — إزالة هامش المحتوى الخاص بالشريط، رفع **`mb-sendbar`** و**`ot-flow-toast`** فوق الشريط السفلي، **`padding-bottom`** إضافي للمحتوى، أنماط أزرار التبويب.

### 067 — نقطة أساس قبل خدمات الإنتاج: مرتجعات ضيف + ستايل جرسون + منيو يومي — `UTC 2026-05-17T02:30:00Z` — ID `feat-guest-return-waiter-ui-baseline`

- **`backend/api_server.py`**: مسارات **`guest-return-reasons`** / **`guest-returns`** (GET/POST/PATCH)؛ **`VERIFY_SCHEMA_REVISION=11`** و**`FEATURE_GUEST_RETURNS=1`** في **`/__whoami__`**.
- **`src/components/GuestReturnRequestModal.tsx`**, **`GuestReturnsManagerPage.tsx`**, **`guestReturnCatalog.ts`**, **`guestReturnApi.ts`**: مسار مرتجع الضيف (جرسون → مدير) مع لقطة بنود ثابتة وشاشة نجاح بعد POST.
- **`src/lib/waiterOrderUiPrefs.ts`**, **`WaiterUiStylePrompt.tsx`**, **`AppShell.tsx`**, **`AuthContext.tsx`**: اختيار ستايل ١/٢ بعد كل دخول (تجريبي)؛ حفظ **`mat3am_order_taker_ui_v1`** و**`mat3am_waiter_last_path_v1`**؛ فتح آخر مسار للجرسون.
- **`src/pages/WaiterOrderPage.tsx`**: القائمة اليومية + Out of Stock؛ عرض بنود الطلبات المُرسلة؛ نموذج ٢ (تبويبات).
- **`run_api.bat`**: توجيه التحقق من **`FEATURE_GUEST_RETURNS`** عند إعادة تشغيل API.

### 066 — استقرار API: ODBC غير حاجب + بروكسي وخطوة اتصال — `UTC 2026-05-16T06:30:00Z` — ID `api-sql-nonblocking-devconn`

- **`backend/api_server.py`**: **`test-connection`** و**`/api/ready?check_db=1`** و**`mat3am-schema-probe/ensure`** عبر **`run_in_threadpool`**؛ مهلة اختبار ODBC **6** ثوانٍ.
- **`vite.config.ts`**: **`timeout`/`proxyTimeout`** 120s لـ **`/__whoami__`** و**`/api`**.
- **`src/pages/DeveloperConnection.tsx`**: مؤشر حي **`/api/ping`** كل 3s؛ رسائل **`Failed to fetch`** أوضح؛ مهلة 25s لاختبار SQL؛ تعطيل أزرار الخطوة ١ إذا API غير حي.
