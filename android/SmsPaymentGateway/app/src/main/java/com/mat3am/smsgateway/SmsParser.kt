package com.mat3am.smsgateway

import java.util.Locale
import java.util.regex.Pattern

data class ParsedSms(
    val provider: String,
    val amount: Double?,
    val fromPhone: String?,
    val fromName: String?,
    val walletOrAccount: String?,
    val balance: Double?,
    val smsAt: String?
)

object SmsParser {
    private val amountRe = Pattern.compile(
        """(?:تم استلام مبلغ|تم إضافة)\s*(?:EGP\s*)?([0-9]+(?:[.,][0-9]+)?)""",
        Pattern.CASE_INSENSITIVE
    )
    private val fromPhoneRe = Pattern.compile("""من\s*(0?1[0-9]{9})""")
    private val nameRe = Pattern.compile("""بإسم\s+([A-Za-z0-9 ._-]{3,80})""")
    private val walletRe = Pattern.compile("""محفظتك\s*(0?1[0-9]{9})""")
    private val accountRe = Pattern.compile("""حسابك رقم\s*([0-9]{6,20})""")
    private val balanceRe = Pattern.compile("""رصيد(?:ك|كم)?\s*(?:الحالي|الحالى)?\s*([0-9]+(?:[.,][0-9]+)?)""")
    private val dateVf = Pattern.compile("""بتاريخ\s*([0-9: ]{4,20}\s*[0-9-]{6,12})""")
    private val dateAdib = Pattern.compile("""فى\s*([0-9: ]{4,20}\s*[0-9/]{8,12}\s*(?:AM|PM)?)""")

    fun providerFor(sender: String, body: String): String {
        val s = sender.lowercase(Locale.ROOT)
        val b = body
        return when {
            s.contains("vf-cash") || s.contains("v cash") || s.contains("vodafone") || b.contains("محفظتك") -> "vodafone_cash"
            s.contains("adib") || b.contains("ADIB") || b.contains("الى حسابك") -> "bank_adib"
            else -> "sms_unknown"
        }
    }

    fun parse(sender: String, body: String): ParsedSms {
        val provider = providerFor(sender, body)
        fun g(p: Pattern): String? {
            val m = p.matcher(body)
            return if (m.find()) m.group(1)?.trim() else null
        }
        fun money(raw: String?): Double? = raw?.replace(",", "")?.toDoubleOrNull()
        return ParsedSms(
            provider = provider,
            amount = money(g(amountRe)),
            fromPhone = g(fromPhoneRe),
            fromName = g(nameRe),
            walletOrAccount = g(walletRe) ?: g(accountRe),
            balance = money(g(balanceRe)),
            smsAt = g(dateVf) ?: g(dateAdib)
        )
    }
}
