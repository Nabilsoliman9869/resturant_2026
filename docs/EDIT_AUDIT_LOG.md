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

### 069 — SQL→JSON: كاش TBL005 + لقطة تشغيل + مرآة `/data` — `UTC 2026-05-18T18:00:00Z` — ID `sql-cache-operational-snapshot`

- **`backend/mat3am_sql_cache.py`**: TTL لـ **TBL005** و**MAT3AM_APP_USERS**؛ مرآة **`config/restaurant/sql_mirror/*.json`** عند انقطاع SQL.
- **`backend/api_server.py`**: **`/api/restaurant/operational-snapshot`** (جلسات/طلبات bulk من **MAT3AM_RESTAURANT_STATE**)؛ **`_restaurant_sql_get_bulk`**؛ **`restaurant_get_tables`** عبر الكاش + **`dataSource`**؛ تسخين عند الإقلاع؛ **`/api/mat3am/sql-cache/status`**.
- **`src/lib/restaurantTableView.ts`**: fallback عند مخطط بلا طاولات.
- **`src/pages/WaiterTablesPage.tsx`**: تحميل عبر **operational-snapshot** مع fallback للمسارات الستة.

### 068 — Railway ↔ SQL قديم: ODBC 17 + OpenSSL legacy — `UTC 2026-05-18T12:00:00Z` — ID `sql-odbc17-seclevel0`

- **`Dockerfile`**: تثبيت **`msodbcsql17`** مع 18؛ **`OPENSSL_CONF`** بـ **`SECLEVEL=0`** + مزوّد **legacy** و**`MinProtocol = TLSv1`**.
- **`backend/odbc_driver.py`**: تفضيل Driver **17** ثم 18؛ **`pyodbc_connect_compat`** يجرّب كل السائقات وكل خيارات TLS؛ **`ODBC_BUILD=2026-05-18-odbc17-seclevel0`**.
- **`backend/api_server.py`**: رسالة SSL أوضح تعرض السائقات المثبتة/المُجرَّبة.

### 066 — استقرار API: ODBC غير حاجب + بروكسي وخطوة اتصال — `UTC 2026-05-16T06:30:00Z` — ID `api-sql-nonblocking-devconn`

- **`backend/api_server.py`**: **`test-connection`** و**`/api/ready?check_db=1`** و**`mat3am-schema-probe/ensure`** عبر **`run_in_threadpool`**؛ مهلة اختبار ODBC **6** ثوانٍ.
- **`vite.config.ts`**: **`timeout`/`proxyTimeout`** 120s لـ **`/__whoami__`** و**`/api`**.
- **`src/pages/DeveloperConnection.tsx`**: مؤشر حي **`/api/ping`** كل 3s؛ رسائل **`Failed to fetch`** أوضح؛ مهلة 25s لاختبار SQL؛ تعطيل أزرار الخطوة ١ إذا API غير حي.

### 070 — مخطط الصالة: رفع Railway + حفظ ذري موحّد — `UTC 2026-05-19T12:00:00Z` — ID `floor-plan-railway-sync`

- **`backend/api_server.py`**: **`_restaurant_persist_floor_plan`** (كتابة ذرية على **DATA_DIR**، مزامنة TBL005، **`meta`** مع sha256/tableCount في GET/PUT).
- **`src/components/FloorPlanEditor.tsx`**: رسالة حفظ تعرض المسار وعدد الطاولات + إعادة تحميل بعد الحفظ.
- **`scripts/push_floor_plan_to_railway.py`**: رفع المخطط المحلي عبر PUT (نفس محرّر الإعدادات).
- **`.gitignore`**: تتبع **`config/restaurant/floor_plan.json`** كمرجع؛ رفع الإنتاج: **39 طاولة**، **الطابق الرئيسي** 1400×920.

### 071 — تدفق الكابتن الموحّد (جوال) — `UTC 2026-05-19T18:00:00Z` — ID `captain-mobile-unified`

- **`src/lib/waiterCaptainMobile.ts`**: 4 تبويبات (طاولة / منيو / سلة / مرسل).
- **`src/pages/WaiterOrderPage.tsx`**: جوال ≤900px — نموذج واحد؛ شريط سفلي؛ شارة سلة؛ شريط ضيوف في المنيو؛ إزالة اختيار نموذج ١/٢.
- **`src/styles/operationalRoles.css`**: أنماط `.waiter-pos--ot-ui-captain`.
- **`src/lib/waiterOrderUiPrefs.ts`**, **`WaiterUiStylePrompt.tsx`**, **`AppShell.tsx`**: مقدمة واحدة للجرسون فقط.

### 072 — تبويب ضيوف + شريط أسماء ثابت — `UTC 2026-05-19T20:15:00Z` — ID `captain-guests-dock`

- **`src/lib/waiterCaptainMobile.ts`**: 5 تبويبات (`table | guests | menu | cart | sent`)؛ قسم «تعريف الضيوف» تحت `guests`؛ `CAPTAIN_DOCK_SEAT_ORDER` و`captainShowsGuestDock`.
- **`src/components/CaptainGuestDock.tsx`**: شريط جانبي ثابت (يسار RTL) للمقاعد ١–١٢ + ١٣ مشترك؛ الضغط → المنيو لسلة ذلك الضيف.
- **`src/pages/WaiterOrderPage.tsx`**: ربط Dock؛ صف أسماء أعلى المنيو؛ تبويب ضيوف يفتح لوحة التعريف.
- **`src/styles/operationalRoles.css`**: شبكة 5 أعمدة للشريط السفلي؛ أنماط Dock والشريط العلوي.
- **`WaiterUiStylePrompt.tsx`**: نص المقدمة يذكر التبويب الخامس والشريط الجانبي.

### 073 — تبويب رئيسية + شريط ضيوف مُسمّى فقط — `UTC 2026-05-19T21:30:00Z` — ID `captain-home-named-dock`

- **`src/lib/waiterCaptainMobile.ts`**: تبويب `home`؛ `captainDockSeatsFromLabels` (أسماء معرّفة + ١٣ فقط).
- **`src/components/CaptainHomeMenu.tsx`**: استلام المطبخ، شريحات الطاولات، العودة للطاولات، لوحة الصالة، بار.
- **`src/pages/WaiterOrderPage.tsx`**: ربط القائمة والشريط المُصفّى؛ إصلاح اختفاء «القائمة الرئيسية» من الشريط السفلي.
- **`src/styles/operationalRoles.css`**: 6 تبويبات مرنة؛ بطاقة الرئيسية.

### 074 — إزالة تكرار قوائم الجوال في AppShell — `UTC 2026-05-19T22:00:00Z` — ID `appshell-single-menu-fab`

- **`src/components/AppShell.tsx`**: حذف شريط الأيقونات الجانبي + زر الهامبرغر المكرر؛ زر عائم واحد «القائمة الرئيسية» يفتح السايدبار الكامل.
- **`src/styles/appShell.css`**: `.app-shell__menu-fab`؛ إخفاء `.app-shell__dock` على الجوال.

### 075 — تنقل جرسون موحّد من الدخول — `UTC 2026-05-20T08:00:00Z` — ID `waiter-nav-unified-flow`

- **`src/lib/waiterNav.ts`**: مسار البداية `tables`؛ عناصر قائمة واحدة (بدون «طلب للطاولة» من القائمة).
- **`src/context/AppMenuContext.tsx`**: فتح القائمة من شاشة الطلب (☰).
- **`src/components/AppShell.tsx`**: قائمة جانبية دائماً؛ زر عائم للصالة فقط؛ `AppMenuProvider`.
- **`src/lib/waiterCaptainMobile.ts`**: 5 تبويبات (حذف «رئيسية» المكررة).
- **`WaiterOrderPage.tsx`**: زر ☰ في الهيدر؛ إخفاء «انتقل إلى» على الجوال.
- **`WaiterUiStylePrompt.tsx`**: مقدمة تدفق 3 خطوات.
- **`roles.ts`**: بعد الدخول → `/app/waiter/tables`.

### 076 — توثيق الوضع النهائي + حفظ مرجعي كامل — `UTC 2026-05-20T14:30:00Z` — ID `doc-waiter-final-state`

- **`docs/WAITER_NAV_FINAL_STATE.md`**: مرجع ثابت — تدفق من `/login` إلى POS، جدول مسارات، قائمة واحدة (FAB/☰/سايدبار)، 5 تبويبات كابتن، فلتر `CaptainGuestDock`، مفاتيح `localStorage`/`sessionStorage`، خريطة ملفات، مخطط mermaid، إشارة إلى commit **`11016ce`**.
- **`README.md`**: إحالة إلى الوثيقة ضمن «ما تم تنفيذه».
- **ملاحظة تشغيل**: لا يُستأنف `order-taker` تلقائياً بعد المقدمة؛ نقطة البداية `WAITER_HUB_PATH` (`/app/waiter/tables`).

### 077 — تشخيص بطء SQL: perf-probe + سكربت قياس — `UTC 2026-05-20T16:00:00Z` — ID `perf-probe-db-latency`

- **`backend/api_server.py`**: `GET /api/mat3am/perf-probe` — قياس مراحل ODBC (اتصال، TBL005 بارد/دافئ، bulk state، operational-snapshot، محاكاة طلبات متوازية، حجم TBL007) مع `hints` تلقائية.
- **`scripts/bench_db_latency.py`**: تشغيل القياس من CLI ضد `http://127.0.0.1:2288` (خيارات `--cold`, `--repeat`, `--direct`).
- **`debug-db-latency-audit.md`**: أسباب ملحوظة مرتبة، جدول polling، خطة اختبار دقيقة (API + DevTools + Railway).

### 078 — Railway readiness: startup SQL في الخلفية — `UTC 2026-05-20T18:30:00Z` — ID `railway-bg-startup`

- **`backend/api_server.py`**: `_run_background_startup_task`؛ تأجيل `_ensure_mat3am_dev_schema` + `sql_cache warm` و`kids migrate` إلى threads بعد الإقلاع — لتفادي 502/`Application failed to respond` عندما SQL بعيد أو healthcheck قصير.
- **`railway.toml`**: healthcheck `/api/ping` (120s) — لا تغيير؛ التطبيق يجب أن يرد قبل انتهاء مهلة schema.
- **`debug-db-latency-audit.md`**: قياس محلي + ملاحظة 502 على Railway قبل النشر.

### 079 — كاش كتالوج TBL007/TBL006 + catalog مجمّع للطلب — `UTC 2026-05-20T20:00:00Z` — ID `cache-tbl007-order-catalog`

- **`backend/mat3am_sql_cache.py`**: `get_tbl007_catalog_rows`، `get_tbl006_group_rows`، TTL (`MAT3AM_TBL007_CACHE_TTL` / `MAT3AM_TBL006_CACHE_TTL` افتراضي 300s)، مرآة JSON، `invalidate_menu_catalog`، تسخين في `warm()`.
- **`backend/api_server.py`**: `/api/products` و`/api/product-groups` من الكاش؛ `GET /api/restaurant/order-taker-catalog`؛ إبطال الكاش عند إنشاء/تعديل صنف.
- **`src/pages/WaiterOrderPage.tsx`**: `loadAll` → طلب واحد `order-taker-catalog` بدل `products` + `product-groups`.

### 080 — استقرار Railway: ping/SPA async + workers — `UTC 2026-05-20T22:00:00Z` — ID `railway-threadpool-stability`

- **`backend/api_server.py`**: `/api/ping`، `/__whoami__`، مسارات SPA `/app/*` → `async`؛ `sql-cache/status` بدون ODBC افتراضياً (`?sqlProbe=1` اختياري).
- **`Dockerfile`**: `MAT3AM_UVICORN_WORKERS=2`.
- **`debug-db-latency-audit.md`**: شرح فرق `/api/ready` السريع vs timeout على ping من الخارج.

### 081 — سرعة التطبيق: bootstrap واحد + SWR + GZip — `UTC 2026-05-21T08:00:00Z` — ID `perf-bootstrap-swr-gzip`

- **`mat3am_sql_cache.py`**: stale-while-revalidate؛ `warm_catalog_only`؛ تسخين كتالوج مبكر.
- **`api_server.py`**: `GET /api/restaurant/order-taker-bootstrap` (طلب واحد)؛ GZipMiddleware؛ تسخين catalog عند الإقلاع.
- **`WaiterOrderPage.tsx`**: `loadAll` → bootstrap؛ القائمة اليومية تُحمَّل بالخلفية.
- **`RestaurantDualBells`**: poll 12s؛ **`DbConnectionBar`**: ready خفيف + فحص SQL كل 5 دورات.

### 082 — سياسة بيانات مرجعية: refresh API + كاش فقط + رسائل — `UTC 2026-05-19T12:00:00Z` — ID `ref-data-policy-082`

- **`backend/mat3am_sql_cache.py`**: `reference_cache_only_enabled`، `allow_live` في `_get_rows_cached`، `refresh_all_reference_data`.
- **`backend/api_server.py`**: `POST /api/mat3am/reference-data/refresh`، `GET .../status`؛ بحث/ترشيح أصناف من الكاش؛ `REFERENCE_DATA_SAVE_HINT_AR` في POST أصناف/مجموعات.
- **`src/components/ReferenceDataRefreshPanel.tsx`**, **`src/lib/referenceDataPolicy.ts`**: زر «تحديث بيانات النظام» للمدير/المطوّر.
- **`DeveloperConnection.tsx`**, **`MasterDataPage.tsx`**: دمج اللوحة + رسالة بعد حفظ صنف.
- **`docs/REFERENCE_DATA_POLICY.md`**: سياسة مرجعي vs تشغيلي.
- **`Dockerfile`**: `MAT3AM_REFERENCE_CACHE_ONLY=1`؛ poll تشغيلي 18s (`RESTAURANT_POLL_MS`, `RestaurantDualBells`).

### 083 — توحيد الدمج والتحويل والنقل الجزئي — `UTC 2026-07-17T02:54:43Z` — ID `tableflow-17b7f6804ed0`

- **`backend/api_server.py`**: تحويل الدمج إلى علاقة تشغيلية حية بين جلسة مصدر وهدف، دعم هدف فارغ أو مشغول مع تأكيد، فوترة مشتركة من الهدف، `merge-preview` وفك الدمج قبل الفوترة، تحويل كامل إلى هدف مشغول مع تنظيف المصدر، ونقل بنود/كميات جزئية بين الجلسات.
- **`src/pages/WaiterOrderPage.tsx`**: تحذيرات الهدف المشغول، إغلاق طلب الحساب على مصدر الدمج، مراجعة وفك الدمج مع إعادة توزيع المقاعد، وفصل ضيف أو بنود إلى طاولة فارغة/مشغولة.
- **`src/pages/WaiterTablesPage.tsx`**: شارات دمج حية متبادلة على شرائح المصدر والهدف بأسماء الطاولات.
- **`src/pages/settings/SystemPlaybookPage.tsx`** و**`docs/MAT3AM_WORKFLOW_AND_SETTINGS_GUIDE.md`**: توثيق قواعد الدمج والفك والتحويل وإعادة التوزيع.
- **التحقق**: نجاح `npm run build` و`python -m py_compile backend/api_server.py` واختباري smoke للدمج/الفك والنقل الجزئي/التحويل المشغول.

### 084 — استقرار الشرائح + شارة التحويل بأسماء المخطط — `UTC 2026-07-17T03:30:00Z` — ID `relchip-7a1c9e2f04b8`

- **`src/components/RestaurantDualBells.tsx`**: تثبيت قواعد inbox وثابت `POLL_MS=18s` مع `loadInFlightRef` لإيقاف عاصفة الاستطلاع التي كانت تُسقط الـ API (~كل 20 ثانية) وتُظهر HTTP 500 على الطاولات/الجلسات.
- **`backend/api_server.py`**: حل أسماء العرض عبر `linkedTableId` في مخطط الصالة؛ رفض GUID كاسم؛ شارات العلاقات تعرض `T10`/`T15` بدل المعرف.
- **`src/pages/WaiterTablesPage.tsx`**: نص خطأ التحميل يشير لسجلات الـ API محلياً بدل Railway فقط.

### 085 — منع ضياع جلسة هدف النقل الجزئي — `UTC 2026-07-17T03:45:00Z` — ID `moveheal-c8304e9a12f7`

- **`backend/api_server.py`**: منع قائمة جلسات محمّلة مسبقاً وقديمة من الكتابة فوق جلسة هدف أُنشئت بالتزامن، وإضافة إصلاح ذاتي لجلسة طلب تشغيلي يتيمة مع استعادة كابتن الجلسة المصدر.
- **`backend/api_server.py`**: فصل إجماليات البنود المنقولة نسبياً وتحديث `tableGuid/tableLabel` للهدف، بدلاً من نسخ إجمالي واسم الطاولة المصدر وإظهار القيمة نفسها على الشريحتين.
- **الحالة المصححة**: استعادة جلسة T30 للطلب المنقول وربطها بالكابتن؛ تختفي أزرار «تسكين» و«فتح الطلب وبدء الجلسة» بعد تحديث الشرائح.

### 086 — منع الفاتورة الصفرية وإكمال اعتماد CL/Guest — `UTC 2026-07-17T05:00:00Z` — ID `billguard-a41d7c8e9032`

- **`backend/api_server.py`**: منع إصدار أو تسديد فاتورة عادية تضم أصنافاً بلا سعر، مع رسالة تحدد الأصناف؛ إضافة مسارات طلب/استعلام اعتماد المدير لتسوية CL أو Guest وتنفيذ دفع الضيف بعد الاعتماد.
- **`src/components/CashierPayInvoiceModal.tsx`**: عرض تحذير واضح للأصناف الصفرية، إرسال هوية المستخدم الصحيحة في طلب الاعتماد، ومنع تنفيذ CL/Guest قبل وصول موافقة المدير.
- **التحقق**: نجاح `python -m py_compile` و`npm run build`؛ مسارات الاعتماد الجديدة ظاهرة في OpenAPI، وحارس التسديد الصفري يعيد HTTP 409 بدلاً من ترحيل الصفر.

### 087 — إعادة تسعير الفواتير الصفرية من تاريخ TBL023 — `UTC 2026-07-17T04:45:00Z` — ID `reprice-e8f2a1b4c907`

- **`backend/api_server.py`**: `_enrich_invoice_lines_from_menu` يستخدم EndUserPrice/AgentPrice ثم آخر سعر في TBL023؛ إضافة `_reprice_local_awaiting_invoice` و`POST …/reprice-awaiting` وإعادة تسعير تلقائية عند `GET …/by-id` للفواتير المنتظرة بإجمالي صفر.
- **`backend/api_server.py`**: `request-bill` يحل الأسعار قبل المنع، ويحسب الخدمة/الضريبة من سياسة POS عند غياب kitchenTotals.
- **التحقق**: فاتورة T100 رقم 39 أُعيد تسعيرها إلى 205 + 24.60 خدمة + 32.14 ضريبة = **261.74 ج.م**؛ مسارات اعتماد CL/Guest تعمل (لم تعد 404).

### 088 — تسوية Guest/CL بدون مبالغ + سداد جزئي — `UTC 2026-07-17T11:50:00Z` — ID `settle-mode-9c4e2a71b8f0`

- **`backend/api_server.py`**: إصلاح رفض Guest بـ «أدخل مبالغ التسديد»؛ دعم `remainderSettlement` لسداد جزئي + ترحيل المتبقي على حساب أو ضيافة بعد الاعتماد.
- **`src/components/CashierPayInvoiceModal.tsx`**: استبدال مربعات الاختيار بقائمة طرق تسوية واضحة (فوري / حساب كامل / ضيف كامل / جزئي+حساب / جزئي+ضيافة) مع ملخص المدفوع والمتبقي.
- **التحقق**: `mark-guest` لفاتورة 39 أعاد `paymentStatus=guest` بدون خطأ مبالغ التسديد.

### 089 — مسارات إعدادات SMTP — `UTC 2026-07-17T12:10:00Z` — ID `smtp-api-7d2e9f41a0c3`

- **`backend/api_server.py`**: إضافة `GET/PUT /api/settings/smtp` لحفظ وقراءة إعدادات البريد من `config/settings.json`، مع تصحيح تلقائي إذا وُضع عنوان البريد في خانة خادم SMTP (Gmail → `smtp.gmail.com`).
- **التحقق**: المسار لم يعد 404؛ الحفظ والقراءة يعملان على المنفذ 2288.

### 090 — تدقيق عناوين SMTP والشبكة المحلية — `UTC 2026-07-17T12:18:00Z` — ID `smtp-url-4b8d2f61c9a0`

- **`src/pages/DeveloperConnection.tsx`**: تحسين أسماء وإرشادات حقول SMTP، والتحقق من أن خادم SMTP ليس بريداً وأن روابط API/الواجهة تستخدم الصيغة والمنفذ الصحيحين.
- **`backend/api_server.py`**: رفض HTTPS مع عنوان IP مباشر دون شهادة TLS، ورفض المسارات والمنافذ الخاطئة وعنوان البريد في خانة خادم SMTP.
- **`config/settings.json`**: تصحيح روابط الشبكة إلى `http://192.168.1.10:2288` و`http://192.168.1.10:9999`.
- **التحقق**: رفض العناوين القديمة بـ HTTP 400، ونجاح حفظ وقراءة العناوين المحلية المصححة؛ نجاح بناء الواجهة و`py_compile`.

### 091 — حفظ بريد المستخدمين مع مؤشر واضح — `UTC 2026-07-17T13:20:00Z` — ID `user-email-save-a81c3f4e9021`

- **`backend/api_server.py`**: دعم حقل `Email` في إنشاء/تحديث `MAT3AM_APP_USERS` مع ضمان وجود العمود في المخطط وإبطال كاش المستخدمين بعد التحديث.
- **`src/pages/DeveloperUsers.tsx`**: زر حفظ البريد ينتظر نتيجة الـ API ويعرض حالات: برتقالي (تعديل)، رمادي (جارٍ)، أخضر (تم)، أحمر (فشل) مع نص توضيحي تحت الحقل.
- **التحقق**: `PATCH /api/auth/users/{id}` يعيد `userFieldsChanged: true` ويحفظ البريد فعلياً.

### 092 — إيميل المدير للتنبيهات وطلبات الاعتماد — `UTC 2026-07-17T17:36:00Z` — ID `email-mgr-ed1b6cb2eb2f`

- **`backend/api_server.py`**: ربط `_manager_approval_enqueue_inbox` بإرسال SMTP عبر `_role_inbox_notify_managers_async` (كانت طلبات الاعتماد تُحفظ في وارد الأدوار فقط دون بريد)؛ تمرير `tableId`/`sessionId` عند إنشاء تنبيه الكاشير؛ إضافة `POST /api/test-email` وسجل `email_delivery_log`.
- **التحقق**: اختبار SMTP أرسل بنجاح إلى `nabilfaragpro@gmail.com` و`omarnabilfaragpro@gmail.com`؛ تنبيه `call_manager` لـ T10 سجّل `sent=2 failed=0`.

### 093 — إصلاح نقل البنود T10→T150 (جلسة يتيمة + لافتة) — `UTC 2026-07-17T18:25:00Z` — ID `xfer-orphan-a7c4e91f2b60`

- **السبب من اللوج**: `move_items` الساعة `21:12:54` أنشأ جلسة هدف `84633d10…` وطلب `8feb774a…` (319 ج) ثم اختفت الجلسة بتعارض كتابة؛ الإصلاح التلقائي كان يتجاهل حالة `served`؛ شارات العلاقات كانت تستبعد `move_items`.
- **`backend/api_server.py`**: توسيع `_repair_orphan_active_order_sessions` ليشمل `served/ready/delivered` مع `movedAt`؛ التحقق بعد حفظ `move-items` من بقاء جلسة الهدف؛ إدراج `move_items` في `/table-relations/recent`.
- **`src/pages/WaiterTablesPage.tsx`**: شارة «محوّل إليها من …» / «نُقلت بنود إلى …».
- **التحقق**: استعادة جلسة T150 النشطة مع طلب مرتبط؛ علاقة T150←T10 تظهر كـ `move_items`.

### 094 — إظهار لافتة النقل داخل اللقطة التشغيلية — `UTC 2026-07-17T18:34:00Z` — ID `xfer-banner-f84c1d7a63e2`

- **السبب**: شاشة الطاولات تعتمد `/operational-snapshot` وتعود فور نجاحه، بينما اللقطة لم تكن تحتوي `relations`؛ لذلك لم تستخدم الواجهة نتيجة `/table-relations/recent` ولم تُرسم اللافتة رغم صحة العلاقة في الخادم.
- **`backend/api_server.py`**: تضمين أحدث علاقات الطاولات ضمن اللقطة التشغيلية.
- **`src/pages/WaiterTablesPage.tsx`** و**`src/styles/operationalRoles.css`**: نقل العلاقة إلى لافتة مستقلة كاملة العرض، وإضافة إطار بنفسجي مضيء وخلفية متدرجة للطاولة المستقبلة للبنود.
- **التحقق**: نجاح `py_compile` وبناء TypeScript/Vite؛ التحذيرات المقروءة قديمة وغير متعلقة بالتعديل.

### 095 — لافتات النقل مربوطة بالجلسة النشطة فقط — `UTC 2026-07-17T18:55:00Z` — ID `rel-active-9e2c4b71a8d0`

- **`backend/api_server.py`**: `/table-relations/recent` لم يعد يعرض آخر حركة تاريخية لأي طاولة؛ يشترط مطابقة `sessionId`/`targetSessionId` للجلسة النشطة اليوم على الطاولة (مع بقاء الدمج حياً من الجلسات).
- **التحقق**: علاقات T11/T100 التاريخية تختفي؛ T10↔T150 تبقى لأنها جلسة نشطة حالية.

### 096 — آخر وضع تشغيلي أثناء التنظيف — `UTC 2026-07-17T19:01:00Z` — ID `rel-clean-61b49e82d3a7`

- **السياسة المصححة**: تستمر لافتة آخر نقل/تحويل على الطاولة بعد مغادرة الجلسة فقط طوال حالة `dirty` أو `cleaning` لشرح سبب الفراغ للإدارة، وتختفي عند `ready`.
- **`backend/api_server.py`**: إضافة نطاق `cleaning_context` بشرط مطابقة آخر جلسة أو لحظة الانتقال المباشر للتنظيف (خمس دقائق)، مع منع أي سجل تاريخي على طاولة جاهزة.
- **`src/pages/WaiterTablesPage.tsx`**: صياغة لافتة السياق: «آخر وضع: … — بانتظار اكتمال التنظيف».
- **التحقق**: العلاقات الحالية تنقسم إلى `active_session` و`cleaning_context` وتُضمّن مطابقةً في اللقطة التشغيلية؛ نجاح `py_compile` وبناء Vite.

### 097 — دورة تحصيل إكسترا ومطابقة الشيفت — `UTC 2026-07-17T21:25:00Z` — ID `acctrec-7d3a94c2b18e`

- **`backend/api_server.py`**: توحيد التسديد في معاملة SQL تكتب `MAT3AM_INV_PAYMENT_LINE` و`TBL054` معاً، تثبيت حساب العميل وحساب الإيراد على `TBL022`، كتابة `CheckID01`، تشغيل `Prc008` والتحقق من توازن `TBL011/TBL012`؛ المالك/VIP/الضيف يُرحّلون على `AgentGuide` بلا حركة دفع.
- **`backend/api_server.py`**: إضافة نوع مستقل `kids` في `TBL020`، وإلزام إقفال كيدز بالسداد الكامل مع تمرير كل دفعاته إلى نفس دورة التحصيل والترحيل؛ إضافة تقرير `payment_reconciliation` لمقارنة السجل التشغيلي و`TBL054` والقيد.
- **`src/pages/settings/PaymentRoutingSettingsPage.tsx`**: توسيع إعدادات ربط التحصيل لتشمل حسابات الإيراد/الصندوق/البنك/الضريبة لكل نوع فاتورة مطعم، مع استمرار ربط كل وسيلة دفع بحساب `TBL004`.
- **`src/components/CashierPayInvoiceModal.tsx`**: إضافة اختيار صريح «فاتورة ضريبية» يرسل `CheckID01=0/1` في التسديد الفوري أو على الحساب أو الضيف.
- **التحقق**: نجاح `py_compile` وبناء TypeScript/Vite؛ اختبار مختلط 100 نقدي + 53.22 فيزا داخل Transaction ولّد صفين `TBL054` وقيداً من 6 بنود متوازناً (`273.22 = 273.22`) ثم تم `ROLLBACK` والتأكد من عدم بقاء أي أثر.

### 099 — لوحة الصالة + شرائح تصاعدية + تقرير يوم تشغيلي — `UTC 2026-07-18T11:00:00Z` — ID `hallday-4f8c2a91e6b0`

- **اليوم التشغيلي**: نافذة 10:00 → 04:00 (هوية حتى 10:00 التالي) في الواجهة والخادم؛ `_is_today_iso` يعتمدها للجلسات النشطة.
- **`src/lib/restaurantTableView.ts`**: ترتيب شرائح الطاولات تصاعدياً (الأصغر→الأكبر) داخل كل طابق وفي مسار API الاحتياطي.
- **`backend/api_server.py`**: `GET /api/restaurant/hall-day-report` و`/excel` — ملخص كباتن/طلبات/مرتجعات/اعتمادات/قيم + تخزين JSON تحت `config/restaurant/hall_day_reports/` وتصدير xlsx متعدد الأوراق.
- **`FloorPlanLive` / `FloorPlanSvgView`**: الطاولات أزرار تفتح تقرير اليوم؛ زر **مجمع** أعلى المخطط.
- **`WaiterTablesPage`**: زر **مجمع** + «تقرير اليوم» لكل شريحة؛ فلترة الطلبات/الجلسات بيوم تشغيلي.
- **التحقق**: `py_compile` و`tsc -b`؛ التقرير JSON يعيد بيانات اليوم؛ Excel 200 + ملف مخزّن.

### 100 — تقرير مرحلي لكل جلسة + تباين ألوان — `UTC 2026-07-18T11:20:00Z` — ID `hallui-8a3c1e70f2d4`

- **`HallDayReportPanel` + `hallDayReport.css`**: ألوان نص داكنة صريحة (`#0f172a`/`#1e293b`) ضد وراثة ثيم الشل الفاتح؛ ترتيب جديد: مراحل الجلسات ثم ملخصات ثم **التجميعات في الآخر**.
- **`backend/api_server.py`**: حقل `sessionBriefs` (ملخص كل جلسة + طلبات/مرتجعات/اعتمادات) وورقة Excel «الجلسات».
- **التحقق**: بناء الواجهة؛ إعادة هيكلة العرض حسب لقطة المستخدم.

### 101 — تقرير طاولة كفواتير جلسات + إجماليات — `UTC 2026-07-18T13:20:00Z` — ID `invsess-b7e4c91a0d52`

- **`backend/api_server.py`**: إثراء `sessionBriefs` بـ `itemLines` + `financials` (صافي/خدمة/ضريبة/إجمالي) من الطلبات أو الفاتورة عند توفرها؛ ورقة Excel «بنود الجلسات».
- **`HallDayReportPanel` + CSS**: عرض مرحلي شبيه بفاتورة الجرسون (تسكين/إنهاء/كابتن/أصناف/إجماليات) ثم **التجميعات** في الآخر.
- **التحقق**: `py_compile` / إعادة تشغيل API؛ تحديث الصفحة لرؤية الواجهة.

### 102 — تصحيح اتساق بنود الجلسة مع صافي الفاتورة — `UTC 2026-07-18T13:40:00Z` — ID `invfix-c4a8e2b19f70`

- **السبب**: تكرار الطلب بسبب قصّ `id` إلى 12 حرفاً + عرض بنود الطلبات مع إجماليات الفاتورة (120 ظاهر كسطرين).
- **`backend/api_server.py`**: إلغاء تكرار الطلبات، دمج الأسطر المتماثلة، وعند وجود فاتورة تُؤخذ البنود/الصافي/الخدمة/الضريبة من مصدر واحد متسق؛ التجميع من `sessionBriefs` بعد الإثراء.
- **التحقق**: لكل جلسة عينة `lineSum ≈ net`؛ مثال T24: طلب واحد وسطر واحد = 120.

### 103 — عمود PIN في مستخدمو التطبيق — `UTC 2026-07-18T14:10:00Z` — ID `pincol-a1d9f3e28c47`

- **`DeveloperUsers.tsx`**: عمود PIN ظاهر (حالة معيّن/غير معيّن + إدخال وحفظ مباشر) ضمن 6.4 مستخدمو التطبيق.
- **`backend/api_server.py`**: إرجاع `hasPin` في قائمة المستخدمين دون كشف الرقم.
- **التحقق**: الصفحة تعرض العمود الجديد بجانب البريد.

### 104 — تخطي اعتماد الكاشير إن وُجد اعتماد تسكين — `UTC 2026-07-19T12:20:00Z` — ID `seatappr-e6b2c91a4f08`

- **السياسة**: ضيف / مالك / VIP / آجل اعتُمدوا عند التسكين (`guestApprovedAt`) لا يُطلب لهم اعتماد فاتورة جديد عند الكاشير؛ مع احترام `maxInvoiceLimit`.
- **`backend/api_server.py`**: `_invoice_seating_covers_payment_approval` + `_invoice_payment_approval_satisfied`؛ تطبيقها على mark-guest / mark-on-account / ترحيل المتبقي وحالة/طلب الاعتماد؛ إثراء الفاتورة بـ `seatingCoversGuestPayment` / `seatingCoversOnAccount`.
- **`CashierPayInvoiceModal.tsx`**: تفعيل الأزرار مباشرة عند أعلام التسكين مع رسالة توضيحية.
- **التحقق**: `ast.parse` للخادم؛ واجهة تعتمد على الحقول المثراة.

### 105 — تزامن تلقائي للمحاور الثلاثة — `UTC 2026-07-20T13:05:00Z` — ID `syncaxes-ebfb5fec8ee4`

- **`.cursor/rules/sync-all-axes.mdc`**: سياسة إلزامية — بعد تعديلات جوهرية commit+push+Railway دون انتظار طلب المستخدم.
- **`scripts/sync_all_axes.ps1`**: commit منتجات فقط → push `main` → redeploy `resturant_2026` → إعادة تشغيل API 2288 عند تغيير backend.
- **`.cursor/rules/mat3am-context.mdc`**: إشارة للسكربت.

### 106 — إنهاء طاولات الدمج «منها» عند دفع الطاولة «إليها» — `UTC 2026-07-20T13:10:00Z` — ID `mergepay-a8c3f21b9e04`

- **`backend/api_server.py`**: `_restaurant_finalize_merged_source_sessions` + `_restaurant_close_session_cluster_after_payment` — عند تسديد/إغلاق الطاولة الهدف تُكمَل جلسات المصدر وتُطبَّق سياسة النظافة (dirty/cleaning) على طاولاتها أيضاً.

### 107 — تشيك «فاتورة ضريبية» عند الكاشير → ✓ أخضر — `UTC 2026-07-22T00:25:00Z` — ID `taxchk-7c2e9a41b0d8`

- **`src/components/CashierPayInvoiceModal.tsx`**: مربع اختيار فقط بعلامة ✓ خضراء بلا أي نص «ضريبية»؛ المنطق كما هو (`checkID01` → TBL022).

### 108 — لوحة الطاولات الحية: KPIs + جدول + نافذة تفتيش — `UTC 2026-07-26T12:20:00Z` — ID `hallive-c9e4a17b2f60`

- **`backend/api_server.py`**: إثراء `/api/restaurant/cashier/table-overview` بحقول اختيارية (عمر الجلسة، خمول، كابتن، قسم، دمج، مرتجعات معلّقة) دون كسر العملاء القدامى.
- **`src/components/CashierTableStripBoard.tsx`** + **`src/styles/hallLiveBoard.css`**: شريط KPIs، فلاتر، عرض جدول/بطاقات، وميض للطاولات العاجلة، ودرج تفاصيل سريع مع تسديد.
- **`src/pages/DashboardPage.tsx`**: إظهار اللوحة للمدير/المطوّر أيضاً (وليس الكاشير فقط).

### 109 — مركز الدليفري الموحّد (واتساب/منصات/تحويل طاولة) — `UTC 2026-07-27T18:00:00Z` — ID `delivhub-f3a91c82e7b4`

- **`backend/api_server.py`**: بحث عملاء ذكي؛ `delivery/intake` + مرفقات صور + `convert-to-delivery`؛ طابور دليفري مُثرى بالتذاكر.
- **`src/pages/DeliveryOpsHubPage.tsx`** + **`deliveryOpsHub.css`**: مركز عمليات موحّد (استقبال / تذاكر / تحويل / طابور).
- **`PosPlaceholder`**: استقبال query (agent/شحن/بدون ضريبة/تذكرة)؛ **`AppShell`/`App`**: مسار `delivery-hub` بدل تشتيت call-center + إدارة.

### 110 — إظهار كول سنتر وإدارة الدليفري للكاشير — `UTC 2026-07-27T18:30:00Z` — ID `cashdeliv-a81f3c09e2b7`

- **`src/components/AppShell.tsx`**: إعادة عنصري القائمة للكاشير: «كول سنتر (طلب دليفري)» و«إدارة الدليفري».
- **`src/App.tsx`**: مسار `delivery-management` تحت `/app/cashier` (يوجّه لمركز الدليفري / طابور التسليم)؛ الإبقاء على `call-center` و`delivery-hub`.

### 111 — دليل دورة عمل الدليفري والكول سنتر — `UTC 2026-07-27T19:05:00Z` — ID `delivpb-c4e82a91f0b3`

- **`docs/DELIVERY_CALL_CENTER_PLAYBOOK.md`**: دورة كاملة من الاستقبال حتى طابور التسليم (واتساب/هاتف/منصة/تحويل طاولة + كول سنتر + POS).
- **`docs/MAT3AM_WORKFLOW_AND_SETTINGS_GUIDE.md`**: قسم ملخص يربط بالدليل.
- **`docs/QA_SCENARIO_MATRIX.md`**: توضيح مسارات الكاشير لكول سنتر وإدارة الدليفري.

### 112 — لصق سكرين واتساب في استقبال الدليفري — `UTC 2026-07-27T19:30:00Z` — ID `wspaste-9d2e4b71a6c0`

- **`src/pages/DeliveryOpsHubPage.tsx`**: دعم `Ctrl+V` للصورة من الحافظة + سحب وإفلات + معاينة مصغّرة في تبويب الاستقبال.
- **`src/styles/deliveryOpsHub.css`**: منطقة لصق واضحة مع تلميح اختصار لوحة المفاتيح.
- **`docs/DELIVERY_CALL_CENTER_PLAYBOOK.md`**: تحديث سطر صورة المحادثة.

### 113 — لصق رابط خرائط جوجل لموقع التوصيل — `UTC 2026-07-27T19:40:00Z` — ID `mapspaste-e7c1a52b90d4`

- **`src/lib/mapsLink.ts`**: استخراج روابط `maps.app.goo.gl` / Google Maps من النص الملصوق.
- **`backend/api_server.py`**: حقل `mapsUrl` على التذكرة + `POST /api/restaurant/delivery/resolve-maps-url` لتوسيع الرابط واستخراج الإحداثيات.
- **`DeliveryOpsHubPage`**: منطقة لصق/ربط الموقع + زر فتح الخرائط على التذاكر.

### 114 — تحسينات مركز الدليفري + طلب مستقل — `UTC 2026-07-27T20:15:00Z` — ID `delivux-b6f8d02e41a9`

- **لصق صور**: زر «أرفق» فقط يفتح مستعرض الملفات؛ باقي المساحة للصق/سحب صور متعددة.
- **واجهة المركز**: عنوان بدون «مكان واحد» + أزرار ملونة للتبويبات والقنوات.
- **كاشير**: إخفاء «كول سنتر» من القائمة؛ الاعتماد على «إدارة الدليفري».
- **`DeliveryOrderPage` + `PosPlaceholder(deliveryOnly)`**: بعد الحفظ ينتقل لطلب دليفري مستقل (اسم/هاتف/عنوان/شحن في الفاتورة) دون تعديل شاشة جرسون الطاولات.

### 115 — دفع مسبق + شحن كخدمة/صنف — `UTC 2026-07-27T20:45:00Z` — ID `delivpay-3a9c7e14f8d2`

- **استقبال**: COD / مدفوع مسبقاً / عهدة جزئية + وسيلة المسبق.
- **الشحن**: وضع `service_item` (بند «خدمة توصيل / شحن» في الفاتورة) أو `fee` رسوم فقط.
- **`api_server`**: إنشاء صنف شحن عند الحاجة؛ ملاحظات فاتورة بالمسبق/المتبقي؛ توزيع دفعات المسبق على `paymentBreakdown`.
- **طلب الدليفري**: عرض المسبق والمتبقي؛ مزامنة بند الشحن في السلة للعرض.

### 116 — خدمات الشحن من TBL006/TBL007 — `UTC 2026-07-27T20:55:00Z` — ID `shipgrp-8f2c1a90d4e7`

- مجموعة رئيسية «خدمات الشحن» (أو الدليفري) في **TBL006** تُنشأ تلقائياً إن لزم.
- **`GET /api/restaurant/delivery/shipping-services`**: أصناف **TBL007** المرتبطة بـ GroupGuid للمجموعة.
- خانة الشحن في الاستقبال وطلب الدليفري قائمة اختيار من هذه الأصناف (سعر المنطقة).

### 117 — إصلاح إنشاء مجموعة الشحن (CardCode NOT NULL) — `UTC 2026-07-27T21:50:00Z` — ID `shipfix-c7e4b91a2d08`

- **`_ensure_delivery_shipping_group`**: إدراج TBL006 يتضمن **`CardCode`** (+ Security/MainGuide) لأن `oya_Mohandessin.TBL006.CardCode` لا يقبل NULL.
- التحقق: المجموعة «خدمات الشحن» تُنشأ وتُرجع عبر `/api/restaurant/delivery/shipping-services`.

### 118 — شاشة طلب التوصيل (جرسون-لايك) + بحث عميل + محببات TBL022/023 — `UTC 2026-07-27T22:30:00Z` — ID `delivord-a4f91c72e8b0`

- **`DeliveryOrderPage`**: إعادة بناء كاملة بدون إطار PosPlaceholder/«نقطة بيع» — منيو + سلة + شحن.
- بحث عميل **أعلى الشاشة** بأيقونة وخلفية مميزة؛ اختيار عميل يملأ الخانات.
- تبويب **الأصناف المحببة** عبر `GET /api/restaurant/delivery/customer-favorites` من TBL022+TBL023.
- بحث العملاء: تطابق OR لأجزاء الاسم + ترتيب بالدرجة؛ حفظ أوثق في `delivery-upsert`.
- مركز الدليفري: إزالة رابط «نقطة البيع»؛ أزرار «شاشة الطلب»؛ شريط بحث بارز.

### 119 — طلب التوصيل = WaiterOrderPage (جرسون الطلبات) — `UTC 2026-07-27T22:45:00Z` — ID `delivwait-e91b0c4a7f32`

- **تصحيح الفهم**: الشاشة المطلوبة هي **نقطة بيع جرسون الطلبات** نفسها (`WaiterOrderPage`) وليس شاشة POS موازية.
- `DeliveryOrderPage` غلاف رفيع → `embeddedChannel="delivery"`.
- مسار الدليفري: طاولة اصطناعية `DELIVERY`، بدون مقاعد/منيموم/عمليات طاولة، بحث عميل أعلى الواجهة، أصناف محببة، إرسال فاتورة دليفري.

### 120 — استقرار اتصال Railway SQL — `UTC 2026-07-28T08:05:00Z` — ID `railsql-b2e8d41f90a3`

- إعداد إنتاج: التحويل من `tokaido.proxy.rlwy.net` (بروكسي عام بطيء) إلى **`sqlserver2022docker.railway.internal:1433`** (شبكة Railway الخاصة).
- رفع مهلة `get_connection` إلى 10ث وتقصير cool-down بعد الفشل إلى 15ث لتقليل انقطاعات الواجهة.

### 121 — تعريف مناطق الدليفري والشحن وأسعارها (TBL007) — `UTC 2026-07-28T08:30:58Z` — ID `shipzones-be12eb30a4dc`

- **`backend/api_server.py`**: `POST/PUT /api/restaurant/delivery/shipping-zones` — إضافة/تعديل منطقة شحن تحت مجموعة «خدمات الشحن»، CardCode = آخر رقم TBL007+1، افتراضي `NotTaxable=1` مع خيار تطبيق الضريبة؛ قائمة الخدمات تُرجع CardCode وNotTaxable.
- **`src/pages/settings/DeliveryShippingZonesSettingsPage.tsx`**: نافذة إعدادات سريعة (قائمة + إضافة/تعديل/إيقاف) مع دعم `?prefill=`.
- **`SettingsLayout` + `App.tsx` + `GlobalSearchModal`**: بند «تعريف مناطق الدليفري والشحن وأسعارها» ومسارات المدير / مدير التشغيل / المطوّر.
- **`DeliveryOpsHubPage`**: عند كتابة منطقة غير موجودة → تأكيد الإضافة → الانتقال للإعدادات (أو إضافة سريعة للكاشير).

### 122 — إقفال شيفت الكاشير + اعتماد المدير — `UTC 2026-07-28T09:15:00Z` — ID `shiftclose-a8f31c92e4b0`

- إخفاء «نقطة البيع (بار / سفري)» من قائمة الكاشير.
- تبويب **اقفال الشيفت**: متحصلات نقدي/فيزا/إنستا + فئات 1–200 + إيصالات/إشعارات + خصم مصروفات/مشتريات + صافي تسليم.
- SQL: `MAT3AM_SHIFT_CLOSE` + `MAT3AM_SHIFT_CLOSE_LINE` + `MAT3AM_CASHIER_OUTFLOW` (revision 12).
- اعتماد المدير كنوع **جديد** `cashier_shift_close` دون حذف أو تعطيل أي اعتمادات سابقة؛ الرفض يعيد العمليات للقائمة، والاعتماد يصفّرها.
- التسديد يحفظ `paidBy` لربط الفاتورة بنفس اليوزر.



### 123 — جلسة دليفري بمبدئية + إلغاء جرسون من المسار — `UTC 2026-07-28T12:45:00Z` — ID `delivquote-f8c21a90e4b7`

- **ackend/api_server.py**: رقم تذكرة · حالات `draft_quote/quoted/kitchen/ready/out_for_delivery/delivered/settled` · `GET ticket` · `POST quote/activate/assign-driver/mark-delivered/settle` · تنبيه كاشير `delivery_ready` عند جاهزية المطبخ.
- **DeliveryOrderPage**: شاشة جلسة خفيفة (بدون WaiterOrderPage) — بحث عميل · محببات · فاتورة مبدئية · نسخ واتساب · تفعيل للمطبخ.
- **DeliveryOpsHubPage**: تسميات حالات · تكليف طيار · تسليم · تسوية نقد/فيزا · فتح جلسة الطلب.
- **deliveryOrderPage.css**: أنماط المبدئية والحالات والأزرار.


### 124 ? Delivery Arabic encoding repair ? `UTC 2026-07-28T19:37:35Z` ? ID `delivutf8-4e7c91a2`

- **src/pages/DeliveryOrderPage.tsx**: regenerated the complete delivery session page as UTF-8, restoring Arabic labels while retaining ticket hydration, customer lookup, modifiers, quote, activation, and locked states.
- **docs/DELIVERY_CALL_CENTER_PLAYBOOK.md**: restored Arabic sections 1?4 and clarified the quote-to-kitchen and delivery-queue workflow without Waiter POS.
- **scripts/repair_delivery_encoding.py**: ASCII-only Unicode-escape generator for repeatable safe rewrites.

### 124 — إكمال جلسة الدليفري (إضافات + طابور تتبع) — UTC 2026-07-28T20:10:00Z — ID delivcomp-c91e4a70b2f8

- **DeliveryOrderPage**: hydrate من query/تذكرة · بحث عميل · محببات · إضافات بروفايل الصنف · مبدئية/نسخ واتساب · تفعيل للمطبخ · قفل بعد التفعيل.
- **DeliveryOpsHubPage**: طابور جاهز/خرج للتسليم من التذاكر + KDS · تكليف طيار · تسليم · تسوية · إصلاح تسميات عربية.
- **DELIVERY_CALL_CENTER_PLAYBOOK**: دورة واتساب/كول سنتر/منصة/طاولة بدون Waiter POS.

### 125 — منع تكرار تذاكر الدليفري + إرسال المبدئية واتساب — UTC 2026-07-28T21:20:00Z — ID delivwa-a8f3c19e4b2d

- **api_server intake**: إعادة استخدام تذكرة مفتوحة لنفس الهاتف+القناة؛ إلغاء المسودات المكررة الأقدم؛ orceNew لإنشاء تذكرة جديدة.
- **DeliveryOrderPage**: زر «إرسال المبدئية واتساب» يفتح wa.me بنص العرض + نسخ للحافظة؛ بطاقة فاتورة مبدئية للتصوير اليدوي.
- **DeliveryOpsHubPage**: رسالة عند إعادة الاستخدام؛ اختصار نص المحادثة الطويل؛ خيار تذكرة جديدة إجبارياً.

### 126 — إصلاح تكرار الدليفري + واتساب (popup) — UTC 2026-07-28T21:40:00Z — ID delivwa2-b7e1d04c9a55

- **api_server**: دمج التذكرة المفتوحة لنفس الهاتف عبر كل القنوات (واتساب/هاتف) وإلغاء المكررات الأقدم.
- **DeliveryOrderPage**: فتح نافذة واتساب فوراً قبل await حتى لا يمنع المتصفح الإرسال؛ ثم توجيه wa.me بنص المبدئية.
- **DeliveryOpsHubPage**: زر إرسال المبدئية واتساب من قائمة التذاكر؛ إخفاء الملغاة/المسددة؛ quoteText على النوع.

### 127 — نسخ جدول المبدئية للصق في واتساب — UTC 2026-07-28T21:45:00Z — ID delivpaste-c2f8a1e09d44

- **api_server _delivery_build_quote_text**: جدول نصي بسيط (صنف|كمية|قيمة) جاهز للصق في واتساب.
- **DeliveryOrderPage**: الزر الأساسي «نسخ الجدول للصق في واتساب» + رسالة توجيهية؛ فتح wa.me اختياري.
- **DeliveryOpsHubPage**: «نسخ المبدئية للصق» من قائمة التذاكر بدل الاعتماد على فتح نافذة.

### 128 — استعادة مسارات المبدئية (quote/GET) — UTC 2026-07-28T22:05:00Z — ID delivquote-fix-9c4e2a81

- **السبب**: واجهة الحفظ/النسخ كانت تستدعي /quote وGET ticket وهما غير موجودين (404) فالحفظ لا يكتب شيئاً والنسخ يبدو بلا أثر.
- **api_server**: إضافة GET ticket + POST quote/activate/assign-driver/mark-delivered/settle.
- **DeliveryOrderPage**: توضيح الأزرار — «حفظ على التذكرة» / «حفظ المبدئية» / «نسخ الجدول للصق في واتساب».

### 129 — بوابة SMS للدفع (VF-Cash / ADIB) + ingest API — UTC 2026-07-28T22:25:00Z — ID smsgate-e7a1c92b4d08

- **android/SmsPaymentGateway**: تطبيق Kotlin يستقبل SMS من مرسلين قابلين للتعديل، يمنع التكرار، يعيد المحاولة، ويرسل JSON للـ API.
- **api_server**: POST /api/restaurant/payments/sms-ingest + GET .../sms-inbox + تنبيه كاشير payment_sms.
- **APK**: ndroid/SmsPaymentGateway/SmsPaymentGateway-debug.apk

### 130 — تحويل قراءة SMS الى محرك استدلال (heuristic) بدل مطابقة عبارات ثابتة — UTC 2026-07-29T21:30:00Z — ID smsinfer-4d90b7e1c236

- السبب: اول تحويل حقيقي وصل (20.00 ج، محفظة 01026669108) لكن المحوّل/الرصيد/التاريخ/رقم العملية لم تُقرأ لان الصياغة الفعلية مختلفة عن العبارات المتوقعة. الحل: قراءة تستنتج الحقول من بنية الرسالة بدل الاعتماد على نص محدد.
- SmsParser.kt (النسختان): اعادة كتابته كمحرك استدلال — تطبيع الارقام العربية، استخراج كل الارقام وتصنيفها حسب الشكل والسياق (مبلغ/رصيد/هاتف/رقم عملية)، استنتاج الاتجاه (incoming/debit/info) من كلمات دلالية، كشف مزوّد الخدمة، ودرجة ثقة confidence 0..100. يعمل حتى مع تغيّر صياغة الرسالة او مزوّد جديد.
- SmsIngest.kt (النسختان): ارسال kind وrefNo وconfidence ضمن الحمولة.
- api_server: تخزين kind/refNo/confidence، منع التكرار عبر refNo ايضاً، وقصر تنبيه الكاشير على kind == incoming مع ذكر المحوّل ورقم العملية.
- build.gradle.kts (النسختان): رفع الاصدار الى 1.3.0 (versionCode 4).

### 131 — استيراد رسائل الهاتف + محرك استنتاج على الخادم + تمييز الدعائي — UTC 2026-07-29T22:25:00Z — ID smsimport-7c1e5a92b048

- السبب: رسالتان حقيقيتان كشفتا ثغرتين — رسالة دعائية (كاش باك) أُرسلت للسيرفر بلا داعٍ، وتحويل صادر بصياغة انجليزية لم يُصنَّف. كذلك احتاج المستخدم قراءة الرسائل الموجودة مسبقاً على الهاتف.
- backend/sms_parse.py: وحدة جديدة تحمل نفس خوارزمية الاستنتاج بلغة بايثون، ليتوحّد التحليل على الخادم مهما كان اصدار التطبيق.
- api_server: اعادة التحليل على الخادم عند كل ingest مع رفض kind == promo، ومسار جديد POST /api/restaurant/payments/sms-reparse لاعادة تحليل الصفوف المخزّنة وحذف الدعائي.
- SmsParser (kotlin + python): اختيار المبلغ/الرصيد/رقم العملية بالقرب من الكلمة المفتاحية بدل ترتيب الظهور (كان الرصيد يلتقط «05» من التاريخ)، حدود على regex الهاتف (كان رقم حساب ADIB يُقرأ كهاتف)، افعال انجليزية للاتجاه (transferred to / received)، وتصنيف promo لما لا يترك اثر عملية.
- SmsIngest.kt: دالة importInbox تقرأ content://sms/inbox وتستورد التحويلات، وتخطّي الرسائل الدعائية، وبارامتر relaxSender.
- MainActivity + activity_main.xml: زر «استيراد الرسائل الموجودة على الهاتف» مع طلب اذن READ_SMS ورسالة واضحة عند رفض النظام للاذن.
- build.gradle.kts (النسختان): رفع الاصدار الى 1.4.0 (versionCode 5).

### 132 — ترشيح وربط تحويلات SMS بفواتير الدليفري — UTC 2026-07-30T10:15:00Z — ID paymatch-83e5c1a7d942

- **backend/api_server.py**: دفتر تخصيصات مستقل `payment_sms_allocations.json` يدعم علاقة many-to-many: عدة تحويلات لفاتورة واحدة، واستخدام جزء من التحويل مع إبقاء المتبقي لفاتورة أخرى. إضافة API للترشيحات، تأكيد تخصيص جزئي، وفك التخصيص؛ لا يحدث أي ربط تلقائي.
- **خوارزمية الترشيح**: ترتيب التحويلات الواردة حسب تطابق هاتف العميل، إكمال/تجزئة المبلغ المتبقي، الفرع، ودرجة الثقة، مع إبقاء التحويلات من أرقام مختلفة ظاهرة للمراجعة اليدوية.
- **تسوية الدليفري**: اختيار `digital/transfer` يتطلب اكتمال مبلغ الفاتورة من التخصيصات المؤكدة، وتُحفظ نسخة التخصيصات داخل التذكرة عند الإقفال.
- **DeliveryOrderPage.tsx + deliveryOrderPage.css**: جدول أسفل الفاتورة يعرض الإجمالي/المربوط/المتبقي، التحويلات المؤكدة، المرشحين وأسباب الترشيح، مبلغ ربط قابل للتعديل، فك الربط، ودعم تجميع عمليات متعددة.
- **DeliveryOpsHubPage.tsx**: إضافة المحفظة/التحويل إلى خيارات التسوية.
- **التحقق**: نجاح `npm run build` و`py_compile`، واختبار سيناريو فاتورة 2000 = تحويل 1500 + تخصيص 500 من تحويل 1000 مع بقاء 500 متاحاً.

### 133 — إصلاح المتبقي مع الدفع المسبق + استعادة عربي الواجهة — UTC 2026-07-30T10:55:00Z — ID paymatch-fix-c41a9e82

- **api_server**: `remainingDue = invoiceTotal - prepaidAmount - allocatedAmount` لمنع الازدواج؛ إضافة `prepaidAmount`/`coveredAmount` في ملخص الدفع؛ `clientRequestId` لمنع تكرار التخصيص؛ عند التسوية الرقمية يُسجَّل مبلغ التحويلات المربوطة، وعند النقد/الفيزا يُسجَّل المتبقي الحقيقي؛ `GET ticket` يعيد `payment`.
- **DeliveryOrderPage.tsx**: استعادة النصوص العربية التي فُقدت في الرفع السابق، وإظهار صف ملخص (فاتورة / مسبق / تحويلات / متبقي) مع `clientRequestId` عند الربط.
- **التحقق**: فاتورة 2000 + مسبق 500 + تحويل مربوط 1000 ⇒ متبقي 500؛ نجاح `npm run build`.

### 134 — اختيار مرئي وآمن لترشيح التحويل — UTC 2026-07-30T11:39:00Z — ID payselect-a713f29c

- **DeliveryOrderPage.tsx**: إضافة خانة اختيار واحدة للترشيح، وزر مستقل «تأكيد وربط المحدد» مع نافذة تأكيد؛ يُعلَّم التطابق الكامل آلياً فقط إذا كان مرشحاً وحيداً، بينما تظل المطابقات المتعددة بانتظار اختيار الكاشير.
- **api_server.py + DeliveryOrderPage.tsx**: إضافة تطابق اسم المحوّل مع اسم العميل (+15 نقطة)؛ إذا تعددت مطابقات الهاتف والمبلغ وكان تطابق الاسم وحيداً، يُعلَّم هذا السطر تلقائياً دون تنفيذ الربط.
- **deliveryOrderPage.css**: ألوان دلالية للصفوف والشارات: أخضر لتطابق الهاتف والمبلغ، أزرق لتطابق الهاتف، وأصفر للترشيح الجزئي؛ دعم واضح لشاشة الهاتف.
- **التحقق**: تذكرة فريد #5006 أظهرت أربع تحويلات 3000 متطابقة بدرجة 95، لذلك لم يُختر أيٌّ منها آلياً؛ نجاح `npm run build` وسلامة ترميز العربية.

### 135 — حزمة تعديلات التشغيل (1–4، تقسيم مخصص، 8–11) — UTC 2026-07-31T08:57:00Z — ID `ops-pack-6102e7a4`

- **تم 1 — إقفال الوردية:** `CashierShiftClosePage.tsx` + `GET …/shift-close/open` بمدى تاريخ `fromDate`/`toDate`.
- **تم 2 — إنهاء المطبخ بمسارين:** سياسة `deliverFromKitchenBy` مع خيار `none` («لا أحد») → مباشرة للطاولة؛ وإلا طابور المناولة. `finish-table` + إعدادات الأدوار + Kitchen/Runner.
- **تم 3 — اسم الكابتن على بطاقة المطبخ:** حفظ `captainName`/`captainUserId`/`captainLogin` وإثراء الطلبات من الجلسة.
- **تم 4 — خصم المدير + كوبون:** تطبيق ترويجات السيرفر في طلب الفاتورة والدفع؛ `apply-discount`؛ كوبون نسبة/مبلغ.
- **تقسيم مخصص:** وضع `split_custom` في `CashierPayInvoiceModal` مع قفل المجموع.
- **تم 8:** طاولات طلبت الحساب تبقى حمراء على شريط الكاشير وبطاقات الجرسون حتى الدفع.
- **تم 9:** فتح طاولة ضيف/مالك/VIP يتطلب موافقة مدير (بدون تجاوز فوري بـ agentGuid).
- **تم 10:** نقل الأصناف بين الطاولات للمدير فقط (API + واجهة الجرسون).
- **تم 11:** إيصال حراري إنجليزي افتراضياً مع تبديل عربي في مودال الدفع.
- **الملفات الرئيسية:** `backend/api_server.py`، صفحات Kitchen/Runner/Waiter/CashierShiftClose، `CashierPayInvoiceModal`، `CashierTableStripBoard`، إعدادات Ops/Workflow/Promotions، `posPromotions.ts`، `workflowSettingsModel.ts`، `operationalRoles.css`.

### 136 — قارئ بطاقات لتسليم الجهاز المشترك + فلتر مصدر تحويلات الدليفري — UTC 2026-07-31T10:05:00Z — ID `card-handover-a91c2e`

- **إعدادات نقطة البيع:** خيار ثالث «جهاز مشترك — قارئ بطاقات» (`cardReaderHandoverEnabled`) بجانب المستقل وPIN/Ctrl؛ عمود SQL `CardReaderHandoverEnabled`.
- **التقاط المسح:** `cardSwipeCapture.ts` يسمع أرقاماً سريعة + Enter (keyboard wedge) بدون حقل ظاهر؛ المطابقة عبر `pin-verify` على PIN كل المستخدمين (رقم الكارد = PIN).
- **السلوك:** بطاقة النشط → لا تغيير؛ بطاقة آخر → تأكيد «جلسة نشطة للكابتن…» مع تنبيه السلة غير المرسلة ثم تبديل الجلسة؛ الشاشة المقفولة → فتح بحساب صاحب البطاقة. Ctrl+0/1 يبقى احتياطاً. إصلاح بحث PIN في الـ overlay بدون تقييد بـ login الحالي.
- **WaiterOrderPage:** تسجيل dirty للسلة + تصفير السلة عند `mat3am:terminal-user-switched`.
- **دليفري (سابق محلي):** فلاتر مصدر الترشيح فودافون كاش / أديب / أخرى على `DeliveryOrderPage`.
- **الملفات:** `TerminalLockContext.tsx`، `PinOverlay.tsx`، `SharedTerminalSettingsPage.tsx`، `api_server.py`، `cardSwipeCapture.ts`، `terminalDirtyGuard.ts`، `WaiterOrderPage.tsx`، `DeliveryOrderPage.tsx`، `deliveryOrderPage.css`.

### 137 — اعتماد المدير بالكارد فوق جلسة الكابتن + إخفاء ترحيب الويتر — UTC 2026-08-01T20:15:00Z — ID `mgr-card-appr-c7e2a1`

- **كارت المدير على نقطة الكباتن:** مع تفعيل قارئ البطاقات، مسح بطاقة مدير/مدير تشغيل/مطوّر يفتح لوحة موافقات فوق جلسة الكابتن **بدون** `login`/تبديل مستخدم؛ كروت الكباتن تبقى كما هي (نفس النشط=تجاهل، كابتن آخر=تسليم).
- **`ManagerCardApprovalOverlay`:** عرض المعلّق، اعتماد/رفض فردي، «اعتماد الكل الآمن» (قرار recommended بدون حد أقصى وبدون اختيار بدائل متعددة)؛ `reviewedBy` من صاحب الكارد.
- أثناء اللوحة: مسح كابتن آخر لا يبدّل الجلسة؛ مسح مدير يحدّث هوية المعتمِد.
- **إخفاء** نافذة «مرحباً جارسون الطلبات» من `AppShell`؛ إزالة تصفير علامة المقدمة عند login.
- **الملفات:** `TerminalLockContext.tsx`، `ManagerCardApprovalOverlay.tsx`، `AppShell.tsx`، `SharedTerminalSettingsPage.tsx`، `AuthContext.tsx`.

### 138 — تليجرام نبض التشغيل (تقرير المالك/المدير) — UTC 2026-08-01T22:30:00Z — ID `tg-ops-pulse-9f2a1c`

- **`backend/telegram_ops_pulse.py`:** بناء نص تقرير من لقطة التشغيل + تذاكر الدليفري + الموافقات المعلّقة؛ إرسال Bot API؛ أوامر `التقرير`/`/report`؛ جدولة كل N دقيقة مع ساعات صمت.
- **`api_server.py`:** إعدادات `GET/PUT /api/settings/telegram-ops-pulse`، `POST …/send-now`، `GET …/preview`، worker خلفية عند startup (poll + schedule). التخزين: `config/restaurant/telegram_ops_pulse.json`.
- **واجهة:** صفحة إعدادات `TelegramOpsPulseSettingsPage` + مسار الإعدادات للمدير/مدير التشغيل/المطوّر.
- لا يغيّر بيانات التشغيل — قراءة فقط + إشعار تليجرام.

### 139 — تقرير تليجرام مرتب + صورة شبكة الطاولات + أوامر أقسام — UTC 2026-08-01T23:15:00Z — ID `tg-ops-v2-b4e8d1`

- تقرير HTML مقسّم (صالة/مطبخ/دليفري/كباتن/موافقات) مع أوامر: التقرير، صالة، مطبخ، دليفري، /help.
- صورة PNG لشبكة الطاولات ملوّنة حسب الحالة (Pillow) تُرفق مع التقرير/الصالة؛ إعداد `attachHallImage`.
- إعدادات الواجهة: مدة الجدولة بأزرار جاهزة (15–120 د)، توضيح أن الطلب اليدوي يعمل خارج المواعيد وساعات الصمت.
- `requirements.txt`: إضافة pillow.

### 140 — بدء يوم عمل جديد (تصفير تشغيلي) + إصلاح عدّ الجلسات في تليجرام — UTC 2026-08-01T23:35:00Z — ID `ops-day-reset-a7c3e2`

- **`POST /api/restaurant/ops-day-reset`:** مسح الجلسات/الطلبات/الموافقات/التنبيهات/الوارد/التحويلات/المرتجعات/الدليفري، وإرجاع الطاولات لجاهزة (مع تأكيد `RESET_DAY`). الفواتير اختيارية.
- **واجهة:** `OpsDayResetPage` + رابط في إعدادات المدير/مدير التشغيل/المطوّر.
- **`telegram_ops_pulse.py`:** عدّ الجلسات النشطة عبر `status=active` فقط (كانت الجلسات المكتملة بدون `closedAt` تُحسب نشطة بالخطأ).

### 141 — ترخيص EXE برقم لمرة واحدة + شاشة حقوق وهواتف — UTC 2026-08-02T00:50:00Z — ID `exe-license-gate-c91f2a`

- **`mat3am_license.py` / `mat3am_license_gate.py`:** مفاتيح `M3AM-…` موقّعة HMAC، ربط بالجهاز، شاشة إقلاع (حقوق الشركة + هواتف + تفعيل).
- **`mat3am_exe_entry.py`:** لا يشغّل الخادم قبل نجاح الترخيص (وضع EXE).
- **مولّد داخلي:** `scripts/mat3am_license_generator.py` + `build_license_generator.bat` وسجل `license_ledger.json`.
- **حرق أونلاين:** `POST /api/license/activate` + `GET /api/license/status`؛ إعدادات الهوية في `config/license_branding.json`.
- **توثيق:** `docs/LICENSE_EXE.md`؛ تحديث `docs/BUILD_EXE.md`.

### 142 — صلاحية زمنية للرخصة + هوية سير كونسلت — UTC 2026-08-02T01:40:00Z — ID `lic-duration-sirconsult`

- أنواع مدة: تجريبي 1ش، ربع 3، نصف 6، سنوي 12، سنتان 24، دائم، مخصص؛ الانتهاء يُحسب من تاريخ التفعيل ويوقف التشغيل بعده.
- تحديث `license_branding.json` باسم سير كونسلت وأرقام الهواتف الرسمية.
- مولّد الرخص يعرض اختيار نوع الصلاحية؛ شاشة الإقلاع تعرض تاريخ الانتهاء.

### 143 — إصلاح سقوط EXE المرخّص (uvicorn isatty) — UTC 2026-08-05T07:42:28Z — ID `exe-stdio-005a65c9ca5f`

- **`backend/mat3am_exe_entry.py`:** تعويض `sys.stdout`/`sys.stderr` عند `None` (بناء `console=False`) بكائن يدعم `isatty()`، وتشغيل uvicorn بـ `use_colors=False` لمنع `ValueError: Unable to configure formatter 'default'`.

### 144 — إصلاح FK_TBL023_TBL007 عند حفظ أوامر EXE — UTC 2026-08-05T13:05:00Z — ID `exe-fk023-7c4e9a12b0d1`

- **`backend/api_server.py`:** قبل INSERT بنود `TBL023` يُضمن وجود `ProductGuide` في `TBL007` (مطابقة بالاسم بعد إزالة لاحقة المقعد، ثم إنشاء صنف تلقائي في مجموعة «أصناف POS تلقائي») لمنع سقوط حفظ فاتورة العميل على EXE.

### 145 — محاسبة مالك بالمقاعد + حساب جزئي + خصم مرة واحدة — UTC 2026-08-08T08:40:00Z — ID `owner-seats-bill-a8f31c2e`

- **`backend/api_server.py`:** `ownerSeatNos` / `seatBillingOverrides` عند تطبيق Owner/VIP؛ طلب حساب بمقاعد مختارة (`billSeatNos`/`partialBill`) مع سياسة لكل دفعة؛ فوترة بنود وليس الطلب كله؛ خصم SQL من الإجمالي قبل الخصم مرة واحدة.
- **`WaiterTablesPage.tsx`:** اختيار مقاعد المالك عند تطبيق VIP.
- **`WaiterOrderPage.tsx`:** اختيار مقاعد لطلب الحساب المنفصل؛ `kitchenTotals` قبل خصم المالك.
- **`CashierPayInvoiceModal.tsx`:** افتراضي عدم إغلاق الجلسة بعد تسديد شيك واحد.
- توثيق: `docs/DELIVERY_AXES_PACKAGE.md`.

### 146 — طلب الحساب إلزامياً على مستوى الكرسي — UTC 2026-08-08T09:25:00Z — ID `seat-bill-level-f6a2c91d`

- **`WaiterOrderPage.tsx`:** طلب الحساب يشترط اختيار كرسي؛ افتراض المقعد الحالي؛ شيك لكل كرسي محدد؛ استبعاد البنود المفوترة (`finalInvoiceId`)؛ مراجعة الحساب للمقاعد المحددة فقط.
- **`api_server.py`:** تفعيل سبليت المقعد افتراضياً؛ `billSeatNos` يفرض حساباً جزئياً على مستوى الكرسي.
- **`CaptainBillReviewModal.tsx`:** تسمية «حساب على مستوى الكرسي».

### 147 — تعليمات المدير (كليك يمين على الطاولة) — UTC 2026-08-08T10:10:00Z — ID `mgr-ctx-menu-b7e4a1c2`

- **`ManagerTableInstructionsMenu.tsx`:** قائمة سياق موحّدة «تعليمات المدير».
- **`WaiterTablesPage.tsx`:** يمين على شريحة الطاولة (مدير/تشغيل/مطوّر) → فتح نقطة بيع جرسون الطلبات، تحويل كابتن، تقارير، تنظيف، Reset.
- **`CashierTableStripBoard.tsx`:** نفس القائمة من اللوحة الحية → فتح `order-taker` للطاولة.

### 148 — طبقات المدير + شيكات الطاولة + قراءة المطبخ — UTC 2026-08-08T11:40:00Z — ID `mgr-layers-checks-kds-c8d2e91a`

- **`api_server.py`:** `table_id` على `invoices-local`؛ `POST …/manager-amend` لتصحيح أصناف/أسعار/طريقة دفع مع تدقيق.
- **`ManagerTableChecksModal.tsx`:** شيكات الطاولة (عرض/فتح/طباعة/تصحيح).
- **`WaiterTablesPage` / `CashierTableStripBoard` / `WaiterOrderPage`:** تعليمات مدير على طاولة + كرسي + صنف السلة.
- **`KitchenPage` + `operationalRoles.css`:** بطاقة مطبخ أوضح (طاولة كبيرة، كمية بارزة، حالة واحدة).

### 149 — اختيار كرسي ظاهر عند طلب الحساب — UTC 2026-08-08T12:40:00Z — ID `bill-seat-picker-ui-d4a91e02`

- **`WaiterOrderPage.tsx`:** شريط كراسي غير مفوترة في الهيدر؛ نافذة اختيار كرسي عند «طلب الحساب»؛ دبل-كليك على كرسي يطلب حسابه مباشرة.

### 150 — تباين خطوط النوافذ الزجاجية + مساحة POS — UTC 2026-08-08T12:55:00Z — ID `glass-modal-contrast-a7c4e91f`

- **`operationalRoles.css`:** نوافذ منبثقة كبيرة بخلفية شفافة فاتحة وخط داكن `#0f172a`؛ قائمة سياق المدير `.mgr-ctx-menu`؛ منع وراثة ألوان الهيدر الداكن داخل الزجاج.
- **`WaiterOrderPage.tsx`:** زر مضغوط «كراسي (n)» بدل شريط يأكل الهيدر؛ إصلاح تباين نصوص/شيبس نافذة الضيوف.
- **`CaptainBillReviewModal` / `ManagerTableChecksModal` / `ManagerTableInstructionsMenu`:** زجاج شفاف كبير فوق نقطة البيع.
- **`WaiterTablesPage.tsx`:** تلميح «يمين على الطاولة» بلون واضح على خلفية كهرمانية.

### 151 — عدم إغلاق الطاولة بعد سداد كرسي واحد — UTC 2026-08-08T13:05:00Z — ID `seat-pay-keep-session-b3e91a04`

- **`api_server.py`:** منطق `_restaurant_should_close_session_after_settlement` — لا يُغلق بعد `mark-paid` / on-account / guest لمجرد انعدام فواتير معلّقة؛ يحترم `partialBillingAt` والبنود غير المفوترة. طلب حساب مقعد يضبط `partialBillingAt` حتى بلا بنود أخرى.
- **`CashierPayInvoiceModal.tsx`:** توضيح خيار إغلاق الطاولة؛ افتراضي يبقى مفتوحاً لباقي الكراسي.

### 152 — اختيارات طلب الحساب + مطبخ مهذّب + تقرير طاولة — UTC 2026-08-09T09:10:00Z — ID `bill-modes-kds-hall-c91e4a22`

- **`WaiterOrderPage.tsx`:** أنماط طلب الحساب (شيك لكل كرسي / مالك منفصل+باقي مجمّع / المحدد مجمّعاً)؛ طباعة كل الشيكات بالترتيب؛ إرسال `kitchenNotes`/`modifiers` منفصلة للمطبخ؛ قراءة `ownerSeatNos`.
- **`KitchenPage` + `kitchenTicketDisplay.ts` + CSS:** عرض بند المطبخ كإطار موحّد بأسطر (رئيسي / جانبي / طهي / ملاحظة).
- **`api_server.py`:** إصلاح `_iso_to_local_dt` لـ UTC؛ مطابقة GUID↔T11 في تقرير الصالة؛ جلسات بنشاط داخل النافذة؛ الحفاظ على ملاحظات/إضافات في `_kds_normalize_item`.

### 153 — شيك إنجليزي بإطار + رقم طاولة/كرسي/اسم — UTC 2026-08-09T10:20:00Z — ID `receipt-en-frame-e8c21a90`

- **`CashierPayInvoiceModal.tsx`:** قالب طباعة بإطار عام وأقسام مميزة؛ `Table No.` بدل GUID؛ `Chair No.` و`Name` عند التوفر؛ أقسام Items/Totals/Payment.
- **`api_server.py`:** إثراء `tableLabel`/`tableNumber` دون إرجاع GUID كاسم طاولة.
- **`WaiterOrderPage.tsx`:** تمرير رقم/اسم الطاولة عند طباعة شيك الكابتن.

### 154 — طلب أصناف منيو المطعم من شاشة الكيدز — UTC 2026-08-22T10:50:00Z — ID `kids-menu-order-a8f31c`

- **`KidsAreaPage.tsx`:** زر «طلب من منيو المطعم» + بحث أصناف وإضافتها لتذكرة الطفل (كاشير/حارس).
- **`POST /api/kids/tickets/{id}/add-line`:** `sendToKitchen` لفرض بند مطبخ من منيو المطعم + `fireNow` لإرسال فوري للـ KDS باسم الطفل.

### 155 — تقارير إيراد/مصروفات الفترة + دليفري من شاشة الكابتن — UTC 2026-08-24T01:55:00Z — ID `period-finance-dlv-b7e2a1`

- **`GET /api/reports/period-finance`:** إيراد بدون/مع ضريبة عن من→إلى؛ فلاتر طاولة/كابتن/صنف/قناة؛ شريحة كيدز ودليفري؛ مصروفات صندوق + عمومية غير مباشرة ومقابلة الربح.
- **`PeriodFinanceReportsPage`:** واجهة التقارير تحت المسار `period-finance` (محاسب/مدير/مطوّر).
- **دليفري بدون طاولة صالة:** زر «طلب دليفري» في شريحات الكابتن + بند قائمة الجرسون → `delivery-order` (جلسة افتراضية `delivery:{invoice}` وليس حجز طاولة).
