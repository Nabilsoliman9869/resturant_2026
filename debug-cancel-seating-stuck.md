# Debug Session: cancel-seating-stuck
- **Status**: [OPEN]
- **Issue**: زر إلغاء التسكين لا يغيّر شيئًا؛ تبقى الطاولة مشغولة وتبقى عبارة فوات أوان التسكين ويظل ارتباط الكابتن ظاهرًا.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-cancel-seating-stuck.ndjson

## Reproduction Steps
1. فتح `http://localhost:9999/app/waiter/tables`.
2. اختيار طاولة عليها `فوات أوان التسكين` ولا تحتوي طلبات.
3. الضغط على `إلغاء التسكين`.
4. ملاحظة أن البطاقة تبقى كما هي دون أثر واضح.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | الضغط لا يرسل طلب `POST /no-order-watch` من الواجهة أصلًا | High | Low | Pending |
| B | الطلب يخرج لكن الخادم يرفضه بـ `409/403/400` والسبب لا يظهر للمستخدم بوضوح | High | Low | Pending |
| C | الطلب ينجح لكن إعادة التحميل تقرأ جلسة `active` من مصدر آخر فتعيد نفس الحالة | High | Med | Pending |
| D | `sessionId` المرسل من البطاقة لا يطابق الجلسة الفعلية للطاولة | Med | Med | Pending |
| E | polling أو `operational-snapshot` يعيد state قديم بعد نجاح الإلغاء ويغطي النتيجة | Med | Med | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
