package com.mat3am.smsgateway

import android.content.Context

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)

    var apiUrl: String
        get() = sp.getString("apiUrl", DEFAULT_API) ?: DEFAULT_API
        set(v) = sp.edit().putString("apiUrl", v.trim()).apply()

    var apiKey: String
        get() = sp.getString("apiKey", "mat3am-sms-local") ?: "mat3am-sms-local"
        set(v) = sp.edit().putString("apiKey", v.trim()).apply()

    var branchId: String
        get() = sp.getString("branchId", "main") ?: "main"
        set(v) = sp.edit().putString("branchId", v.trim()).apply()

    var deviceId: String
        get() = sp.getString("deviceId", "phone-1") ?: "phone-1"
        set(v) = sp.edit().putString("deviceId", v.trim()).apply()

    var enabled: Boolean
        get() = sp.getBoolean("enabled", true)
        set(v) = sp.edit().putBoolean("enabled", v).apply()

    var allowedSendersRaw: String
        get() = sp.getString("allowedSenders", DEFAULT_SENDERS) ?: DEFAULT_SENDERS
        set(v) = sp.edit().putString("allowedSenders", v).apply()

    fun allowedSenders(): Set<String> =
        allowedSendersRaw
            .lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { it.lowercase() }
            .toSet()

    companion object {
        const val DEFAULT_API = "https://resturant2026-production.up.railway.app/api/restaurant/payments/sms-ingest"
        const val DEFAULT_SENDERS = "VF-Cash\nADIB EGYPT\nV cash\nVodafone"
    }
}
