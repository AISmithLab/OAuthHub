package expo.modules.httpserver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the OAuthHub HTTP server process alive
 * when the user switches to a demo app (or any other app).
 *
 * Without this service, Android would eventually kill the OAuthHub process
 * when it's in the background, breaking the localhost IPC channel that
 * demo apps use to communicate with the runtime.
 *
 * Shows a low-priority persistent notification: "Protecting your data".
 */
class HttpServerForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "oauthub_server"
        const val NOTIFICATION_ID = 19876  // matches our HTTP port
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()

        // Tapping the notification opens the OAuthHub app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        } else null

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("OAuthHub")
            .setContentText("Protecting your data")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
            .build()

        // Android 14+ requires foregroundServiceType in startForeground call
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "OAuthHub Server",
            NotificationManager.IMPORTANCE_LOW   // no sound, minimal visual
        ).apply {
            description = "Keeps OAuthHub running to handle data requests from apps"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        super.onDestroy()
        android.util.Log.i("OAuthHub", "Foreground service stopped")
    }
}
