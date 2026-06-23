package com.cosmico.vesta

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*

class VestaServiceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "VestaServiceModule"

    @ReactMethod
    fun startService(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, VestaService::class.java)
            ContextCompat.startForegroundService(reactApplicationContext, intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("START_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopService(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, VestaService::class.java)
            reactApplicationContext.stopService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateNotification(status: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, VestaService::class.java).apply {
                action = VestaService.ACTION_UPDATE_STATUS
                putExtra(VestaService.EXTRA_STATUS, status)
            }
            // Use startForegroundService so that if the OS had killed the service,
            // this re-delivery still promotes it to foreground (the service calls
            // startForeground on its first onStartCommand). Plain startService here
            // would throw on Android 8+ when the app is backgrounded.
            ContextCompat.startForegroundService(reactApplicationContext, intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UPDATE_NOTIFICATION_ERROR", e.message, e)
        }
    }
}
