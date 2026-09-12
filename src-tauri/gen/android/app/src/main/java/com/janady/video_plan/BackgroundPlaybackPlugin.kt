package com.janady.video_plan

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class StartPlaybackArgs {
    var title: String? = null
}

@TauriPlugin
class BackgroundPlaybackPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(StartPlaybackArgs::class.java)
        requestNotificationPermission()
        BgPlaybackService.start(activity, args.title ?: "背景音乐")
        invoke.resolve()
    }

    @Command
    fun stop(invoke: Invoke) {
        BgPlaybackService.stop(activity)
        invoke.resolve()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            1002
        )
    }
}
