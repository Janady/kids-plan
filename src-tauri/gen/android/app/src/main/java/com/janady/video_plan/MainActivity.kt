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
    requestAllFilesAccess()
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
