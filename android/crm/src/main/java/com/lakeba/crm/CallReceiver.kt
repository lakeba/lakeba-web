package com.lakeba.crm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.app.Notification

/**
 * After a phone call of more than half a minute: a notification "How did the call go?" that opens the CRM's
 * voice note. Only that a call started and ended is used: not the number, not the call itself. Switched off
 * in the app's settings (the "after_calls" preference).
 */
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val prefs = context.getSharedPreferences("crm", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("after_calls", true)) return
        when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
            TelephonyManager.EXTRA_STATE_OFFHOOK -> prefs.edit().putLong("call_started", System.currentTimeMillis()).apply()
            TelephonyManager.EXTRA_STATE_IDLE -> {
                val started = prefs.getLong("call_started", 0L)
                prefs.edit().remove("call_started").apply()
                if (started > 0 && System.currentTimeMillis() - started > 30_000) ask(context)
            }
        }
    }

    private fun ask(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("after_call", "After a call", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Asks how a call went, to update your deals with a voice note."
        })
        val open = Intent(context, MainActivity::class.java).apply {
            putExtra("path", "/admin/crm/voice?after_call=1")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(context, "after_call")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("How did the call go?")
            .setContentText("Tap and say it in 20 seconds: your deal is updated.")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try { nm.notify(1, n) } catch (_: SecurityException) { /* notifications not allowed */ }
    }
}
