package com.mat3am.smsgateway

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * مسار بديل عن صلاحية SMS المقيّدة:
 * يقرأ إشعار الرسالة الواردة (عنوان المرسل + النص) ويرسله للـ API.
 */
class PaymentNotifListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        // تجاهل إشعارات تطبيقنا
        if (sbn.packageName == packageName) return
        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim().orEmpty()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.joinToString("\n") { it?.toString().orEmpty() }
            ?.trim()
            .orEmpty()
        val body = when {
            big.isNotBlank() -> big
            lines.isNotBlank() -> lines
            else -> text
        }
        if (body.isBlank()) return

        val prefs = Prefs(this)
        if (!prefs.enabled) return

        // المرسل غالباً عنوان الإشعار (VF-Cash / ADIB EGYPT)
        var sender = title
        if (sender.isBlank()) {
            // بعض تطبيقات الرسائل تضع المرسل أول سطر
            sender = body.lineSequence().firstOrNull()?.trim().orEmpty()
        }
        if (!SmsIngest.isAllowed(prefs, sender) && !SmsIngest.looksLikePaymentSms(body)) {
            return
        }
        if (!SmsIngest.isAllowed(prefs, sender) && SmsIngest.looksLikePaymentSms(body)) {
            // حاول تخمين المرسل من القائمة إن النص يشبه تحويل
            sender = SmsIngest.guessSenderFromBody(prefs, body) ?: sender
            if (!SmsIngest.isAllowed(prefs, sender)) {
                Log.i(TAG, "payment-like body but sender unknown title=[$title]")
                return
            }
        }

        Log.i(TAG, "notif pkg=${sbn.packageName} sender=[$sender] len=${body.length}")
        val whenMs = if (sbn.postTime > 0) sbn.postTime else System.currentTimeMillis()
        CoroutineScope(Dispatchers.IO).launch {
            SmsIngest.handleIncoming(applicationContext, sender, body, whenMs)
        }
    }

    companion object {
        private const val TAG = "SmsGatewayNotif"
    }
}
