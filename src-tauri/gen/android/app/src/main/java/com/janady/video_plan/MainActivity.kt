package com.janady.video_plan

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Match app's dark bg-gray-900 (#111827) so status bar blends in
    window.statusBarColor = Color.parseColor("#111827")
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = false

    requestStoragePermissions()
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
}
