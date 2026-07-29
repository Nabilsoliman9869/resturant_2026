package com.mat3am.smsgateway

import java.util.Locale
import java.util.regex.Pattern

data class ParsedSms(
    val provider: String,
    val kind: String,            // incoming | debit | info | promo
    val amount: Double?,
    val fromPhone: String?,
    val fromName: String?,
    val walletOrAccount: String?,
    val balance: Double?,
    val smsAt: String?,
    val refNo: String?,
    val confidence: Int          // 0..100 تقدير جودة الاستنتاج
)

/**
 * محرك استنتاج لرسائل المحافظ/البنوك.
 * لا يعتمد على صياغة ثابتة، بل يحلل الرسالة عموماً:
 *  - يستخرج كل الأرقام ويصنّفها (مبلغ / رصيد / هاتف / رقم عملية) حسب شكلها وقربها من كلمة مفتاحية.
 *  - يستنتج الاتجاه (وارد/صادر) من أفعال دلالية عربية وإنجليزية.
 *  - يميّز الرسائل الدعائية التي لا تترك أثر عملية (لا رصيد ولا رقم عملية).
 * فيبقى يعمل حتى لو غيّرت الشركة نص الرسالة.
 */
object SmsParser {

    private val creditWords = listOf(
        "استلام", "استلمت", "استلمنا", "اضيف", "أضيف", "اضافة", "إضافة", "اضيفت",
        "دائن", "وردك", "حولت لك", "حوّل لك", "حول لك",
        "received", "credited", "deposited", "transferred from", "added to your"
    )
    private val debitWords = listOf(
        "خصم", "شحن", "سحب", "دفعت", "مدين", "تم تحويل", "تحويل مبلغ", "حولت الى", "حولت إلى",
        "debited", "withdrawn", "transferred to", "sent to", "paid to", "purchase"
    )
    private val currencyWords = listOf("جنيه", "جنيها", "جنيهاً", "ج.م", "egp", "le", "pound", "ج")
    private val balanceWords = listOf("رصيد", "الرصيد", "balance", "bal")
    private val amountWords = listOf("مبلغ", "استلام", "اضافة", "إضافة", "amount", "amt")
    private val refWords = listOf(
        "العملية", "عملية", "المعامل", "معامل", "مرجع", "المرجع",
        "transaction", "trans", "ref", "reference", "txn"
    )
    private val walletWords = listOf("محفظت", "حساب", "wallet", "account")
    private val fromWords = listOf("من")

    private val nameRe = Pattern.compile("""(?:ب[إا]سم|باسم|name[:\s])\s*([^\n0-9]{3,60}?)\s*(?:على|رقم|\.|,|\n|$)""", Pattern.CASE_INSENSITIVE)
    private val timeRe = Pattern.compile("""([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM|ص|م)?)""", Pattern.CASE_INSENSITIVE)
    private val dateRe = Pattern.compile("""([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})""")
    private val numRe = Pattern.compile("""[0-9]+(?:[.,][0-9]+)?""")
    // حدود الأرقام تمنع التقاط «هاتف» من داخل رقم حساب أطول.
    private val phoneRe = Pattern.compile("""(?<![0-9])(?:\+?20)?0?1[0125][0-9]{8}(?![0-9])""")

    private data class Tok(
        val value: String,
        val digits: String,
        val hasDecimal: Boolean,
        val start: Int,
        val end: Int
    )

    private data class PhoneTok(val phone: String, val start: Int, val end: Int)

    private fun normalizeDigits(input: String): String {
        val sb = StringBuilder(input.length)
        for (ch in input) {
            sb.append(
                when (ch) {
                    in '\u0660'..'\u0669' -> ('0' + (ch - '\u0660'))   // ٠-٩
                    in '\u06F0'..'\u06F9' -> ('0' + (ch - '\u06F0'))   // ۰-۹ فارسي
                    '\u066B' -> '.'                                        // فاصلة عشرية عربية
                    '\u066C' -> ','                                        // فاصل آلاف عربي
                    else -> ch
                }
            )
        }
        return sb.toString()
    }

    private fun contextOf(body: String, start: Int, end: Int, radius: Int = 22): String {
        val a = (start - radius).coerceAtLeast(0)
        val b = (end + radius).coerceAtMost(body.length)
        return body.substring(a, b).lowercase(Locale.ROOT)
    }

    private fun containsAny(hay: String, words: List<String>): Boolean {
        val h = hay.lowercase(Locale.ROOT)
        return words.any { h.contains(it) }
    }

    private fun keywordSpans(lowerBody: String, words: List<String>): List<IntArray> {
        val spans = ArrayList<IntArray>()
        for (w in words) {
            var from = 0
            while (true) {
                val i = lowerBody.indexOf(w, from)
                if (i < 0) break
                spans.add(intArrayOf(i, i + w.length))
                from = i + 1
            }
        }
        return spans
    }

    /** أقرب عنصر يلي الكلمة المفتاحية؛ ما يسبقها يُعاقَب بشدة. */
    private fun <T> nearestAfter(
        items: List<T>,
        spans: List<IntArray>,
        maxDist: Int = 40,
        startOf: (T) -> Int,
        endOf: (T) -> Int
    ): T? {
        var best: T? = null
        var bestDist = Int.MAX_VALUE
        for (item in items) {
            for (span in spans) {
                val dist = when {
                    startOf(item) >= span[1] -> startOf(item) - span[1]
                    endOf(item) <= span[0] -> (span[0] - endOf(item)) + 500
                    else -> continue
                }
                if (dist <= maxDist && dist < bestDist) {
                    best = item
                    bestDist = dist
                }
            }
        }
        return best
    }

    private fun toMoney(raw: String): Double? = raw.replace(",", "").toDoubleOrNull()

    private fun normPhone(raw: String): String {
        var p = raw.filter { it.isDigit() }
        if (p.startsWith("20")) p = p.substring(2)
        if (!p.startsWith("0")) p = "0$p"
        return p
    }

    fun providerFor(sender: String, body: String): String {
        val s = sender.lowercase(Locale.ROOT)
        val b = body.lowercase(Locale.ROOT)
        return when {
            s.contains("vf-cash") || s.contains("v cash") || s.contains("vodafone") ||
                b.contains("محفظت") || b.contains("فودافون كاش") || b.contains("vodafone cash") -> "vodafone_cash"
            s.contains("adib") || b.contains("adib") || b.contains("حسابك") -> "bank_adib"
            s.contains("orange") -> "orange_cash"
            s.contains("etisalat") || s.contains("we ") -> "we_pay"
            s.contains("instapay") || b.contains("instapay") -> "instapay"
            else -> "sms_unknown"
        }
    }

    fun parse(sender: String, rawBody: String): ParsedSms {
        val body = normalizeDigits(rawBody)
        val lower = body.lowercase(Locale.ROOT)

        // 1) الاتجاه من الأفعال الدلالية (عربي/إنجليزي)
        val credit = creditWords.count { lower.contains(it) }
        val debit = debitWords.count { lower.contains(it) }
        val direction = when {
            credit > 0 && credit >= debit -> "incoming"
            debit > 0 -> "debit"
            else -> "info"
        }

        // 2) كل الأرقام
        val toks = ArrayList<Tok>()
        run {
            val m = numRe.matcher(body)
            while (m.find()) {
                val v = m.group()
                toks.add(Tok(v, v.filter { it.isDigit() }, v.contains('.') || v.contains(','), m.start(), m.end()))
            }
        }

        // 3) الهواتف
        val phones = ArrayList<PhoneTok>()
        run {
            val m = phoneRe.matcher(body)
            while (m.find()) {
                phones.add(PhoneTok(normPhone(m.group()), m.start(), m.end()))
            }
        }

        fun isPhoneTok(t: Tok): Boolean {
            val d = t.digits
            return d.length in 10..12 && (
                d.startsWith("01") || d.startsWith("2010") || d.startsWith("2011") ||
                    d.startsWith("2012") || d.startsWith("2015")
                )
        }

        // 4) المبلغ والرصيد: أرقام «نقدية» يُختار منها الأقرب لكلمة مفتاحية
        val moneyToks = toks.filter { t ->
            !isPhoneTok(t) && (
                t.hasDecimal ||
                    containsAny(contextOf(body, t.start, t.end), currencyWords) ||
                    t.digits.length <= 6
                )
        }
        val balanceTok = nearestAfter(moneyToks, keywordSpans(lower, balanceWords), 40, { it.start }, { it.end })
        val amountCandidates = moneyToks.filter { it !== balanceTok }
        val amountTok = nearestAfter(amountCandidates, keywordSpans(lower, amountWords), 40, { it.start }, { it.end })
            ?: amountCandidates.firstOrNull()

        val amount = amountTok?.let { toMoney(it.value) }
        val balance = balanceTok?.let { toMoney(it.value) }

        // 5) رقم العملية يُقبل فقط بوجود كلمة مفتاحية صريحة، حتى لا يُخلط برقم الحساب
        val refCandidates = toks.filter { t ->
            !t.hasDecimal && !isPhoneTok(t) && t.digits.length >= 9 &&
                t !== amountTok && t !== balanceTok
        }
        val refTok = nearestAfter(refCandidates, keywordSpans(lower, refWords), 40, { it.start }, { it.end })
        val refNo = refTok?.digits

        // 6) المحفظة/الحساب ثم هاتف المُحوِّل
        val walletSpans = keywordSpans(lower, walletWords)
        val walletPhone = nearestAfter(phones, walletSpans, 40, { it.start }, { it.end })
        val walletOrAccount = walletPhone?.phone ?: run {
            val cand = toks.filter { t ->
                !isPhoneTok(t) && t.digits.length in 6..24 &&
                    t !== amountTok && t !== balanceTok && t !== refTok
            }
            nearestAfter(cand, walletSpans, 40, { it.start }, { it.end })?.digits
        }

        val fromPhone = nearestAfter(phones, keywordSpans(lower, fromWords), 12, { it.start }, { it.end })?.phone
            ?: phones.firstOrNull { walletPhone == null || it.start != walletPhone.start }?.phone

        // 7) الاسم
        val nameM = nameRe.matcher(body)
        val fromName = if (nameM.find()) nameM.group(1)?.trim()?.ifBlank { null } else null

        // 8) التاريخ/الوقت
        val timeM = timeRe.matcher(body)
        val time = if (timeM.find()) timeM.group(1)?.trim() else null
        val dateM = dateRe.matcher(body)
        val date = if (dateM.find()) dateM.group(1)?.trim() else null
        val smsAt = listOfNotNull(time, date).joinToString(" ").ifBlank { null }

        // 9) النوع النهائي: العملية الحقيقية تترك أثراً (رصيد أو رقم عملية أو فعل صريح).
        //    الرسائل الدعائية لا تترك أثراً فتُصنَّف promo ولا تُرسل للسيرفر.
        val hasTxnEvidence = balance != null || refNo != null
        val kind = when {
            direction != "info" -> direction
            hasTxnEvidence -> "info"
            else -> "promo"
        }

        // 10) درجة الثقة
        var conf = 0
        if (amount != null) conf += 45
        if (kind == "incoming") conf += 20 else if (kind == "debit") conf += 5
        if (fromPhone != null || walletOrAccount != null) conf += 20
        if (refNo != null) conf += 15
        if (kind == "promo") conf = 0
        conf = conf.coerceAtMost(100)

        return ParsedSms(
            provider = providerFor(sender, body),
            kind = kind,
            amount = amount,
            fromPhone = fromPhone,
            fromName = fromName,
            walletOrAccount = walletOrAccount,
            balance = balance,
            smsAt = smsAt,
            refNo = refNo,
            confidence = conf
        )
    }
}
