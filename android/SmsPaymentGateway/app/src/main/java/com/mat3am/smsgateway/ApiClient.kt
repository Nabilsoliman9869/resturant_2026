package com.mat3am.smsgateway

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object ApiClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val json = "application/json; charset=utf-8".toMediaType()

    fun post(url: String, apiKey: String, body: String): Pair<Boolean, String> {
        val req = Request.Builder()
            .url(url)
            .addHeader("Content-Type", "application/json")
            .addHeader("X-Api-Key", apiKey)
            .addHeader("Authorization", "Bearer $apiKey")
            .post(body.toRequestBody(json))
            .build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            return resp.isSuccessful to (if (text.isBlank()) "HTTP ${resp.code}" else text.take(400))
        }
    }
}
