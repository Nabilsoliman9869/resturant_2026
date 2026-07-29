package com.mat3am.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (msgs.isEmpty()) return
        val sender = msgs[0].originatingAddress ?: ""
        val body = msgs.joinToString(separator = "") { it.messageBody ?: "" }
        Log.d("SmsGateway", "SMS from=[$sender] bodyLen=${body.length}")
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                SmsIngest.handleIncoming(context.applicationContext, sender, body)
            } finally {
                pending.finish()
            }
        }
    }
}
