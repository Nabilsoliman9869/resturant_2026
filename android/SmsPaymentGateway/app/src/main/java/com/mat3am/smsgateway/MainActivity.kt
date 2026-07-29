package com.mat3am.smsgateway

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val ok = result.entries.all { it.value }
        binding.statusText.text = if (ok) "صلاحيات SMS ممنوحة" else "يلزم منح صلاحية قراءة/استقبال SMS"
        refreshLog()
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
            requestSmsPermissions()
            refreshLog()
        }

        binding.retryBtn.setOnClickListener {
            lifecycleScope.launch {
                SmsIngest.flushPending(this@MainActivity)
                Toast.makeText(this@MainActivity, "تمت محاولة الإرسال", Toast.LENGTH_SHORT).show()
                refreshLog()
            }
        }

        requestSmsPermissions()
        refreshLog()
    }

    private fun requestSmsPermissions() {
        val needed = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS
        )
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
        else binding.statusText.text = "جاهز — المرسلون: VF-Cash / ADIB EGYPT"
    }

    private fun refreshLog() {
        lifecycleScope.launch {
            val rows = AppDb.get(this@MainActivity).sms().recent()
            val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.US)
            binding.logText.text = if (rows.isEmpty()) {
                "لا رسائل بعد. انتظر SMS من VF-Cash أو ADIB EGYPT."
            } else {
                rows.joinToString("\n\n") { r ->
                    val t = fmt.format(Date(r.receivedAt))
                    "[$t] ${r.status.uppercase()}\n${r.sender}\n${r.body.take(160)}\n${r.lastError ?: ""}"
                }
            }
        }
    }
}
