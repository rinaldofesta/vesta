package com.cosmico.vesta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class VestaService : Service() {

    companion object {
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "vesta_service"
        const val ACTION_UPDATE_STATUS = "com.cosmico.vesta.UPDATE_STATUS"
        const val EXTRA_STATUS = "status"
    }

    // Whether we've already promoted ourselves to a foreground service. The first
    // onStartCommand MUST call startForeground (within a few seconds) or Android
    // crashes the process. A status-only intent can be the very first one the OS
    // delivers (e.g. a START_STICKY restart, or updateNotification racing the
    // initial start), so we must startForeground there too before notify().
    private var isForeground = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val status = intent?.getStringExtra(EXTRA_STATUS)

        if (!isForeground) {
            // Always go foreground on the first start, using the status as the
            // initial text if one was provided.
            startForegroundCompat(status ?: "Vesta is ready")
        } else if (status != null) {
            // Already foreground — just refresh the notification text.
            updateNotification(status)
        }

        return START_STICKY
    }

    private fun startForegroundCompat(status: String) {
        val notification = buildNotification(status)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        isForeground = true
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Vesta Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps Vesta's AI model loaded in memory"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(status: String): Notification {
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Vesta")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)

        // Tapping the notification reopens the app. Guard against a null launch
        // intent (some restricted profiles) so notification building never crashes.
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) {
            val pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.setContentIntent(pendingIntent)
        }

        return builder.build()
    }

    private fun updateNotification(status: String) {
        val notification = buildNotification(status)
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification)
    }
}
