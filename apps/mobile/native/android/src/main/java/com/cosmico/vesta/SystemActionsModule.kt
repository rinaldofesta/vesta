package com.cosmico.vesta

import android.content.Intent
import android.provider.AlarmClock
import android.provider.CalendarContract
import com.facebook.react.bridge.*
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeParseException

class SystemActionsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SystemActionsModule"

    private fun parseToMillis(dateStr: String): Long {
        return try {
            // Try timezone-aware format first (e.g., 2026-03-10T15:00:00+01:00)
            ZonedDateTime.parse(dateStr).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            // Fall back to local datetime (e.g., 2026-03-10T15:00:00)
            LocalDateTime.parse(dateStr)
                .atZone(ZoneId.systemDefault())
                .toInstant()
                .toEpochMilli()
        }
    }

    @ReactMethod
    fun setAlarm(hours: Int, minutes: Int, label: String, date: String, promise: Promise) {
        try {
            // NOTE: Android's AlarmClock.ACTION_SET_ALARM does NOT support scheduling on
            // specific future dates. The `date` parameter is accepted but ignored in MVP.
            // Alarms are always set for the next occurrence of the given time.
            // For future-dated alarms, AlarmManager would be needed (Fase 2 scope).
            val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hours)
                putExtra(AlarmClock.EXTRA_MINUTES, minutes)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                if (label.isNotEmpty()) {
                    putExtra(AlarmClock.EXTRA_MESSAGE, label)
                }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SET_ALARM_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createCalendarEvent(title: String, start: String, end: String, location: String, promise: Promise) {
        try {
            val startMillis = parseToMillis(start)
            val endMillis = if (end.isNotEmpty()) {
                parseToMillis(end)
            } else {
                startMillis + 3600000 // default 1 hour duration
            }

            val intent = Intent(Intent.ACTION_INSERT).apply {
                data = CalendarContract.Events.CONTENT_URI
                putExtra(CalendarContract.Events.TITLE, title)
                putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMillis)
                putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
                if (location.isNotEmpty()) {
                    putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: DateTimeParseException) {
            promise.reject("CREATE_EVENT_ERROR", "Invalid date format: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("CREATE_EVENT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setReminder(text: String, datetime: String, promise: Promise) {
        try {
            val millis = parseToMillis(datetime)

            val intent = Intent(Intent.ACTION_INSERT).apply {
                data = CalendarContract.Events.CONTENT_URI
                putExtra(CalendarContract.Events.TITLE, text)
                putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, millis)
                putExtra(CalendarContract.EXTRA_EVENT_END_TIME, millis + 900000) // 15min
                putExtra(CalendarContract.Events.HAS_ALARM, 1)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: DateTimeParseException) {
            promise.reject("SET_REMINDER_ERROR", "Invalid datetime format: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("SET_REMINDER_ERROR", e.message, e)
        }
    }
}
