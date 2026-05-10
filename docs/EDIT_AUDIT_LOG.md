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
