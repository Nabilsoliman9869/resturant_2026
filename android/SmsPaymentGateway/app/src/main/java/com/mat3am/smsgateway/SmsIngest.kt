package com.mat3am.smsgateway

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.security.MessageDigest

object SmsIngest {
    private const val TAG = "SmsGateway"

    fun dedupeKey(sender: String, body: String, receivedAt: Long): String {
        val raw = "$sender|$body|${receivedAt / 60000}"
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(raw.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun isAllowed(prefs: Prefs, sender: String): Boolean {
        val s = sender.trim().lowercase()
        if (s.isEmpty()) return false
        return prefs.allowedSenders().any { allowed ->
            s == allowed || s.contains(allowed) || allowed.contains(s)
        }
    }

    suspend fun handleIncoming(ctx: Context, sender: String, body: String, receivedAt: Long = System.currentTimeMillis()) {
        val prefs = Prefs(ctx)
        if (!prefs.enabled) {
            Log.i(TAG, "disabled, skip")
            return
        }
        if (!isAllowed(prefs, sender)) {
            Log.i(TAG, "sender not allowed: $sender")
            return
        }
        val parsed = SmsParser.parse(sender, body)
        val key = dedupeKey(sender, body, receivedAt)
        val payload = JSONObject()
            .put("sender", sender)
            .put("body", body)
            .put("receivedAt", receivedAt)
            .put("branchId", prefs.branchId)
            .put("deviceId", prefs.deviceId)
            .put("provider", parsed.provider)
            .put("kind", parsed.kind)
            .put("amount", parsed.amount)
            .put("fromPhone", parsed.fromPhone)
            .put("fromName", parsed.fromName)
            .put("walletOrAccount", parsed.walletOrAccount)
            .put("balance", parsed.balance)
            .put("smsAt", parsed.smsAt)
            .put("refNo", parsed.refNo)
            .put("confidence", parsed.confidence)
            .put("dedupeKey", key)
            .toString()

        val dao = AppDb.get(ctx).sms()
        val inserted = dao.insertIgnore(
            SmsEventEntity(
                dedupeKey = key,
                sender = sender,
                body = body,
                receivedAt = receivedAt,
                status = "pending",
                payloadJson = payload
            )
        )
        if (inserted == -1L) {
            Log.i(TAG, "duplicate ignored")
            return
        }
        enqueueRetry(ctx)
        flushPending(ctx)
    }


    fun looksLikePaymentSms(body: String): Boolean {
        val b = body
        return b.contains("تم استلام مبلغ") ||
            b.contains("تم إضافة") ||
            b.contains("EGP") && b.contains("حسابك") ||
            b.contains("الى حسابك") ||
            b.contains("إلى حسابك")
    }

    fun guessSenderFromBody(prefs: Prefs, body: String): String? {
        val b = body.lowercase()
        val allowed = prefs.allowedSendersRaw.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
        return when {
            b.contains("فودافون") || b.contains("محفظتك") || b.contains("vf") ->
                allowed.firstOrNull { it.contains("VF", ignoreCase = true) || it.contains("cash", ignoreCase = true) || it.contains("vodafone", ignoreCase = true) }
            b.contains("adib") || b.contains("حسابك رقم") ->
                allowed.firstOrNull { it.contains("ADIB", ignoreCase = true) }
            else -> null
        }
    }

    fun enqueueRetry(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<SmsRetryWorker>().build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("sms_retry", ExistingWorkPolicy.KEEP, req)
    }

    suspend fun flushPending(ctx: Context) {
        val prefs = Prefs(ctx)
        val dao = AppDb.get(ctx).sms()
        for (row in dao.pending()) {
            try {
                val (ok, msg) = ApiClient.post(prefs.apiUrl, prefs.apiKey, row.payloadJson)
                if (ok) dao.mark(row.dedupeKey, "sent", null)
                else dao.mark(row.dedupeKey, "failed", msg)
            } catch (e: Exception) {
                dao.mark(row.dedupeKey, "failed", e.message)
            }
        }
    }
}

class SmsRetryWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
            SmsIngest.flushPending(applicationContext)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
