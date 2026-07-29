package com.mat3am.smsgateway

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.mat3am.smsgateway.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs

    private val readSmsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                runImport()
            } else {
                binding.statusText.text =
                    "تعذّر منح إذن قراءة الرسائل. أندرويد يحجب هذا الإذن للتطبيقات المثبّتة خارج المتجر. " +
                    "الاستقبال اللحظي عبر وصول الإشعارات يظل يعمل."
                Toast.makeText(this, "إذن قراءة الرسائل مرفوض", Toast.LENGTH_LONG).show()
            }
        }

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
            Toast.makeText(
                this,
                "فعّل مفتاح «بوابة SMS للدفع» في شاشة وصول الإشعارات",
                Toast.LENGTH_LONG
            ).show()
        }

        binding.importBtn.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED) {
                runImport()
            } else {
                readSmsLauncher.launch(Manifest.permission.READ_SMS)
            }
        }

        binding.testBtn.setOnClickListener {
            lifecycleScope.launch {
                SmsIngest.handleIncoming(
                    this@MainActivity,
                    "VF-Cash",
                    "تم استلام مبلغ 1.00 جنيه من 01000000000 المسجل بإسم TEST على رقم محفظتك 01000000000 بتاريخ 00:00 29-07-26. رصيدك الحالي 1.00 جنيه"
                )
                Toast.makeText(this@MainActivity, "تم إرسال اختبار للسيرفر — راجع السجل", Toast.LENGTH_LONG).show()
                refreshLog()
            }
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

    private fun runImport() {
        binding.statusText.text = "جارٍ قراءة صندوق الرسائل…"
        lifecycleScope.launch {
            val res = SmsIngest.importInbox(this@MainActivity)
            binding.statusText.text = when {
                res.scanned < 0 -> "تعذّر فتح صندوق الرسائل على هذا الجهاز."
                res.accepted == 0 -> "فُحصت ${res.scanned} رسالة ولم يُعثر على تحويلات مالية مطابقة."
                else -> "فُحصت ${res.scanned} رسالة، واستُوردت ${res.accepted} عملية وأُرسلت للسيرفر."
            }
            refreshLog()
        }
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
        val want = cn.flattenToString()
        return flat.split(":").any { raw ->
            val parsed = ComponentName.unflattenFromString(raw)
            parsed == cn ||
                raw.equals(want, ignoreCase = true) ||
                (raw.contains(packageName, ignoreCase = true) && raw.contains("PaymentNotifListener", ignoreCase = true))
        }
    }

    private fun updateStatus() {
        binding.statusText.text = if (isNotificationAccessEnabled()) {
            "جاهز: وصول قراءة الإشعارات مفعّل — انتظر إشعار رسالة VF-Cash / ADIB"
        } else {
            "غير مفعّل. الشاشة المطلوبة اسمها وصول إلى الإشعارات / Notification access — وليس إشعارات التطبيق. اضغط الزر الأخضر وفعّل بوابة SMS للدفع."
        }
    }

    private fun refreshLog() {
        lifecycleScope.launch {
            val rows = AppDb.get(this@MainActivity).sms().recent()
            val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.US)
            binding.logText.text = if (rows.isEmpty()) {
                "لا رسائل بعد."
            } else {
                rows.joinToString("\n\n") { r ->
                    val t = fmt.format(Date(r.receivedAt))
                    "[$t] ${r.status.uppercase()}\n${r.sender}\n${r.body.take(160)}\n${r.lastError ?: ""}"
                }
            }
        }
    }
}
