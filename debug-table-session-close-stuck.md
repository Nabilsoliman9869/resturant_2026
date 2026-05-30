# Debug Session: table-session-close-stuck
- **Status**: [OPEN]
- **Issue**: بعد `إنهاء التسكين` تبقى الطاولة مشغولة وتعود عبارة `أنت الكابتن` وتستمر مدة `فوات أوان التسكين`، ما يوحي بأن إغلاق الجلسة أو تحديث حالة الطاولة لا يُحفَظ أو لا ينعكس.
- **Debug Server**: Pending
- **Log File**: `.dbg/trae-debug-log-table-session-close-stuck.ndjson`

## Reproduction Steps
1. فتح شاشة شريحات الطاولات.
2. اختيار طاولة متأخرة في no-order watch مثل `T12`.
3. تنفيذ `إنهاء التسكين` أو `إرجاع جاهزة`.
4. ملاحظة أن البطاقة قد تعود بحالة `مشغولة` و`أنت الكابتن` ومدة الفوات.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | endpoint الخاص بـ `no-order-watch` يستقبل الطلب لكن `_restaurant_complete_session_internal` لا يحدّث الجلسة فعليًا إلى `completed` | High | Med | Pending |
| B | الجلسة تُغلق لكن `restaurant_update_table_status` لا يحفظ حالة الطاولة الجديدة أو يفشل على table id المرتبط | High | Med | Pending |
| C | الحفظ يتم محليًا لكن الواجهة تعيد ربط الطاولة بجلسة active أخرى أو stale mapping بعد reload | Med | Med | Pending |
| D | هناك mismatch بين `label` مثل `T12` و `linkedTableId` الحقيقي، فيُغلق سجل وتبقى طاولة أخرى معروضة | Med | Low | Pending |
| E | الطلب نفسه لا يصل أصلًا إلى API أو يفشل مبكرًا، فتظل البيانات كما هي في الملفات المحلية | High | Low | Pending |
