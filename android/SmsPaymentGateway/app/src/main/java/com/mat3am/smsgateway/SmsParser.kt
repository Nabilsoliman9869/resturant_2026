package com.mat3am.smsgateway

import java.util.Locale
import java.util.regex.Pattern

data class ParsedSms(
    val provider: String,
    val kind: String,            // incoming | debit | info
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
 * محرك استدلال لرسائل المحافظ/البنوك.
 * لا يعتمد على صياغة ثابتة، بل يحلل الرسالة عموماً:
 *  - يستخرج كل الأرقام ويصنّفها (مبلغ / رصيد / هاتف / رقم عملية) حسب شكلها وسياقها.
 *  - يستنتج الاتجاه (وارد/صادر) من كلمات دلالية.
 * فيبقى يعمل حتى لو غيّرت الشركة نص الرسالة.
 */
object SmsParser {

    private val creditWords = listOf(
        "استلام", "استلمت", "استلمنا", "اضيف", "أضيف", "اضافة", "إضافة", "اضيفت",
        "دائن", "وردك", "حولت لك", "حوّل لك", "received", "credited", "deposit", "credit"
    )
    private val debitWords = listOf(
        "خصم", "شحن", "سحب", "دفعت", "دفع", "مدين",
        "debited", "withdraw", "withdrawn", "sent", "purchase", "payment of"
    )
    private val currencyWords = listOf("جنيه", "جنيها", "جنيهاً", "ج.م", "egp", "le", "pound", "ج")
    private val balanceWords = listOf("رصيد", "الرصيد", "balance", "bal")
    private val amountWords = listOf("مبلغ", "استلام", "اضافة", "إضافة", "amount", "amt")
    private val refWords = listOf("العملية", "عملية", "المعامل", "معامل", "مرجع", "المرجع", "transaction", "trans", "ref", "reference", "txn")
    private val walletWords = listOf("محفظت", "حساب", "wallet", "account")

    private val nameRe = Pattern.compile("""(?:ب[إا]سم|باسم|name[:\s])\s*([^\n0-9]{3,60}?)\s*(?:على|رقم|\.|,|\n|$)""", Pattern.CASE_INSENSITIVE)
    private val timeRe = Pattern.compile("""([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM|ص|م)?)""", Pattern.CASE_INSENSITIVE)
    private val dateRe = Pattern.compile("""([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})""")
    private val numRe = Pattern.compile("""[0-9]+(?:[.,][0-9]+)?""")
    private val phoneRe = Pattern.compile("""(?:\+?20)?0?1[0125][0-9]{8}""")

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

    private fun ctx(body: String, start: Int, end: Int, radius: Int = 22): String {
        val a = (start - radius).coerceAtLeast(0)
        val b = (end + radius).coerceAtMost(body.length)
        return body.substring(a, b).lowercase(Locale.ROOT)
    }

    private fun containsAny(hay: String, words: List<String>): Boolean {
        val h = hay.lowercase(Locale.ROOT)
        return words.any { h.contains(it) }
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

        // 1) الاتجاه
        val credit = creditWords.count { lower.contains(it) }
        val debit = debitWords.count { lower.contains(it) }
        val kind = when {
            credit > 0 && credit >= debit -> "incoming"
            debit > 0 -> "debit"
            else -> "info"
        }

        // 2) استخراج كل الأرقام مع سياقها وتصنيفها
        data class Tok(val value: String, val start: Int, val end: Int, val hasDecimal: Boolean, val context: String)
        val toks = ArrayList<Tok>()
        run {
            val m = numRe.matcher(body)
            while (m.find()) {
                val v = m.group()
                toks.add(Tok(v, m.start(), m.end(), v.contains('.') || v.contains(','), ctx(body, m.start(), m.end())))
            }
        }

        // 3) الهواتف (11 خانة تبدأ 010/011/012/015)
        val phones = ArrayList<Pair<String, String>>() // normalized -> context
        run {
            val m = phoneRe.matcher(body)
            while (m.find()) {
                phones.add(normPhone(m.group()) to ctx(body, m.start(), m.end()))
            }
        }

        fun isPhoneToken(t: Tok): Boolean {
            val d = t.value.filter { it.isDigit() }
            return d.length in 10..12 && (d.startsWith("01") || d.startsWith("2010") || d.startsWith("2011") || d.startsWith("2012") || d.startsWith("2015"))
        }

        // 4) المبالغ: أرقام «نقدية» (بها كسر عشري أو بجانبها كلمة عملة أو قصيرة ≤6 خانات)
        val moneyToks = toks.filter { t ->
            !isPhoneToken(t) && (
                t.hasDecimal ||
                    containsAny(t.context, currencyWords) ||
                    t.value.filter { it.isDigit() }.length <= 6
                )
        }
        val balanceTok = moneyToks.firstOrNull { containsAny(it.context, balanceWords) }
        val amountCandidates = moneyToks.filter { it !== balanceTok }
        val amountTok = amountCandidates.firstOrNull { containsAny(it.context, amountWords) }
            ?: amountCandidates.firstOrNull()

        val amount = amountTok?.let { toMoney(it.value) }
        val balance = balanceTok?.let { toMoney(it.value) }

        // 5) رقم العملية: أطول رقم صحيح ≥9 خانات ليس هاتفاً وليس المبلغ، ويفضَّل ما سياقه «عملية/مرجع»
        val refCandidates = toks.filter { t ->
            !t.hasDecimal && !isPhoneToken(t) && t.value.filter { it.isDigit() }.length >= 9 &&
                t !== amountTok && t !== balanceTok
        }
        val refTok = refCandidates.firstOrNull { containsAny(it.context, refWords) }
            ?: refCandidates.maxByOrNull { it.value.length }
        val refNo = refTok?.value?.filter { it.isDigit() }

        // 6) الهاتف المُحوِّل والمحفظة/الحساب
        val fromPhone = phones.firstOrNull { it.second.contains("من") }?.first
            ?: phones.firstOrNull { !containsAny(it.second, walletWords) }?.first
        val walletOrAccount = phones.firstOrNull { containsAny(it.second, walletWords) }?.first
            ?: run {
                // حساب بنكي غير هاتفي: رقم ≥6 خانات بسياق «حساب»
                toks.firstOrNull { !isPhoneToken(it) && containsAny(it.context, walletWords) && it.value.filter { c -> c.isDigit() }.length in 6..24 }?.value
            }

        // 7) الاسم
        val nameM = nameRe.matcher(body)
        val fromName = if (nameM.find()) nameM.group(1)?.trim()?.ifBlank { null } else null

        // 8) التاريخ/الوقت
        val timeM = timeRe.matcher(body)
        val time = if (timeM.find()) timeM.group(1)?.trim() else null
        val dateM = dateRe.matcher(body)
        val date = if (dateM.find()) dateM.group(1)?.trim() else null
        val smsAt = listOfNotNull(time, date).joinToString(" ").ifBlank { null }

        // 9) درجة الثقة
        var conf = 0
        if (amount != null) conf += 45
        if (kind == "incoming") conf += 20 else if (kind == "debit") conf += 5
        if (fromPhone != null || walletOrAccount != null) conf += 20
        if (refNo != null) conf += 15
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
