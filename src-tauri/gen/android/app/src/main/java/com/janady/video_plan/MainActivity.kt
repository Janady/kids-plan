package com.janady.video_plan

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Match app's dark bg-gray-900 (#111827) so status bar blends in
    window.statusBarColor = Color.parseColor("#111827")
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = false

    requestStoragePermissions()
    requestAllFilesAccess()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // Keep the renderer important while hidden so HTML audio isn't deprioritized
    // the moment the screen turns off.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    }
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      applyStatusBarInset(webView, insets)
      insets
    }
    ViewCompat.requestApplyInsets(webView)
    // Tauri loads the page after this callback; re-apply once the document exists
    // so --android-sat isn't lost on the first navigation.
    webView.postDelayed({ ViewCompat.requestApplyInsets(webView) }, 400)
    webView.postDelayed({ ViewCompat.requestApplyInsets(webView) }, 1600)
  }

  // WryActivity.onPause() calls WebView.onPause(), which stops HTML media.
  // Resume immediately while background music is playing so locking the screen
  // doesn't cut the audio.
  override fun onPause() {
    super.onPause()
    if (BgPlaybackService.isRunning) {
      webView?.onResume()
    }
  }

  override fun onResume() {
    super.onResume()
    webView?.let { ViewCompat.requestApplyInsets(it) }
  }

  // targetSdk 35+ draws edge-to-edge, so HTML `top:0` sits under the status bar.
  // env(safe-area-inset-top) is unreliable in Android WebView; publish the
  // overlap as --android-sat for CSS to consume. When the WebView is already
  // laid out below the bar, overlap is 0 and we don't double-pad.
  private fun applyStatusBarInset(view: WebView, insets: WindowInsetsCompat) {
    val loc = IntArray(2)
    view.getLocationOnScreen(loc)
    val statusBarBottom = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
    val overlapPx = (statusBarBottom - loc[1]).coerceAtLeast(0)
    val density = view.resources.displayMetrics.density
    val sat = "${overlapPx / density}px"
    view.evaluateJavascript(
      "document.documentElement.style.setProperty('--android-sat','$sat')",
      null
    )
  }

  private fun requestStoragePermissions() {
    val permissions = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO)
          != PackageManager.PERMISSION_GRANTED) {
        permissions.add(Manifest.permission.READ_MEDIA_VIDEO)
      }
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
          != PackageManager.PERMISSION_GRANTED) {
        permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
      }
    } else {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
          != PackageManager.PERMISSION_GRANTED) {
        permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
      }
    }
    if (permissions.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 1001)
    }
  }

  // "All files access" (MANAGE_EXTERNAL_STORAGE) is a special permission that can't
  // be granted via the normal permission dialog — it needs the system settings page.
  // READ_MEDIA_* only allow reading; deleting files created by other apps requires
  // this. Without it, remove_file() fails with ENOENT ("entity not found").
  private fun requestAllFilesAccess() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        && !Environment.isExternalStorageManager()) {
      try {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
        intent.data = Uri.parse("package:$packageName")
        startActivity(intent)
      } catch (e: Exception) {
        // Fallback to the generic list if the per-app page isn't available
        try {
          startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        } catch (_: Exception) {}
      }
    }
  }
}
