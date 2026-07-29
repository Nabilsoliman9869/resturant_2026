package com.mat3am.smsgateway

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.mat3am.smsgateway.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        binding.apiUrl.setText(prefs.apiUrl)
        binding.apiKey.setText(prefs.apiKey)
        binding.branchId.setText(prefs.branchId)
        binding.deviceId.setText(prefs.deviceId)
        binding.allowedSenders.setText(prefs.allowedSendersRaw)
        binding.enabledSwitch.isChecked = prefs.enabled

        binding.saveBtn.setOnClickListener {
            prefs.apiUrl = binding.apiUrl.text?.toString().orEmpty()
            prefs.apiKey = binding.apiKey.text?.toString().orEmpty()
            prefs.branchId = binding.branchId.text?.toString().orEmpty()
            prefs.deviceId = binding.deviceId.text?.toString().orEmpty()
            prefs.allowedSendersRaw = binding.allowedSenders.text?.toString().orEmpty()
            prefs.enabled = binding.enabledSwitch.isChecked
            Toast.makeText(this, "تم الحفظ", Toast.LENGTH_SHORT).show()
            updateStatus()
            refreshLog()
        }

        binding.notifBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            Toast.makeText(this, "فعّل «بوابة SMS للدفع» من قائمة وصول الإشعارات", Toast.LENGTH_LONG).show()
        }

        binding.retryBtn.setOnClickListener {
            lifecycleScope.launch {
                SmsIngest.flushPending(this@MainActivity)
                Toast.makeText(this@MainActivity, "تمت محاولة الإرسال", Toast.LENGTH_SHORT).show()
                refreshLog()
            }
        }

        updateStatus()
        refreshLog()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
        refreshLog()
    }

    private fun isNotificationAccessEnabled(): Boolean {
        val cn = ComponentName(this, PaymentNotifListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        if (TextUtils.isEmpty(flat)) return false
        return flat.split(":").any {
            ComponentName.unflattenFromString(it)?.flattenToString() == cn.flattenToString()
                || it.contains(packageName)
        }
    }

    private fun updateStatus() {
        binding.statusText.text = if (isNotificationAccessEnabled()) {
            "جاهز عبر الإشعارات — انتظر رسالة VF-Cash / ADIB EGYPT"
        } else {
            "مطلوب: تفعيل وصول الإشعارات (الزر بالأسفل) — أندرويد يمنع صلاحية SMS لهذا النوع من التطبيقات"
        }
    }

    private fun refreshLog() {
        lifecycleScope.launch {
            val rows = AppDb.get(this@MainActivity).sms().recent()
            val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.US)
            binding.logText.text = if (rows.isEmpty()) {
                "لا رسائل بعد. فعّل وصول الإشعارات ثم أعد تجربة التحويل."
            } else {
                rows.joinToString("\n\n") { r ->
                    val t = fmt.format(Date(r.receivedAt))
                    "[$t] ${r.status.uppercase()}\n${r.sender}\n${r.body.take(160)}\n${r.lastError ?: ""}"
                }
            }
        }
    }
}
