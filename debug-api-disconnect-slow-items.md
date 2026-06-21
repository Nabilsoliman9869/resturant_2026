# Debug Session: api-disconnect-slow-items
- **Status**: [OPEN]
- **Issue**: انقطاع متكرر في API على `2288` مع بطء نسبي في ظهور الأصناف داخل شاشة الطلب.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-api-disconnect-slow-items.ndjson

## Reproduction Steps
1. فتح الواجهة على `9999`.
2. الدخول إلى شاشة الطلب أو تنفيذ إرسال طلب.
3. ظهور رسالة `لا يوجد اتصال بخادم API` أو تأخر واضح في ظهور الأصناف.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | خادم `api_server.py` يتوقف أو لا يبقى مستمعًا على `2288` بسبب طريقة التشغيل الحالية | High | Low | Pending |
| B | الواجهة تبني عنوان API أو تطبق fallback شبكيًا بشكل خاطئ بعد إعادة التحميل | Med | Med | Pending |
| C | شاشة الطلب تنتظر bootstrap أو عدة requests بطيئة قبل إظهار الأصناف | High | Med | Pending |
| D | هناك استثناء runtime داخل endpoint مرتبط بالطلب يؤدي إلى انطباع انقطاع رغم أن الخادم قائم | Med | Med | Pending |
| E | يوجد تعارض بين أكثر من عملية تشغيل محلية أو نسخة قديمة يسبب عدم استقرار المنافذ `2288/9999` | High | Low | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
