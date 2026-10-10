package com.janady.video_plan

import android.app.Activity
import android.os.PowerManager
import android.view.WindowManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class KeepAwakeArgs {
    var enabled: Boolean? = false
}

// The Screen Wake Lock API inside Android WebView is a no-op on many tablets,
// so the display still times out during a cast. Once it does, the OS freezes
// this process and the LAN server stops feeding the TV. The window flag keeps
// the screen on; the partial wake lock keeps the CPU running if the power
// button is pressed anyway.
@TauriPlugin
class CastWakePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setKeepAwake(invoke: Invoke) {
        val args = invoke.parseArgs(KeepAwakeArgs::class.java)
        setEnabled(activity, args.enabled == true)
        invoke.resolve()
    }

    companion object {
        private const val TIMEOUT_MS = 8 * 60 * 60 * 1000L

        @Volatile
        private var enabled = false
        private var wakeLock: PowerManager.WakeLock? = null

        fun setEnabled(activity: Activity, on: Boolean) {
            enabled = on
            activity.runOnUiThread { apply(activity) }
        }

        fun reapply(activity: Activity) {
            if (!enabled) return
            activity.runOnUiThread { apply(activity) }
        }

        fun releaseLock() {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            wakeLock = null
        }

        private fun apply(activity: Activity) {
            if (activity.isDestroyed) return
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                if (wakeLock?.isHeld != true) {
                    val pm = activity.getSystemService(Activity.POWER_SERVICE) as PowerManager
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "videoplan:cast").apply {
                        setReferenceCounted(false)
                        acquire(TIMEOUT_MS)
                    }
                }
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                releaseLock()
            }
        }
    }
}
