package com.janady.video_plan

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class OpenDocumentArgs {
  lateinit var filePath: String
}

@TauriPlugin
class DocumentOpenerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openDocument(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenDocumentArgs::class.java)
            val file = File(args.filePath)
            if (!file.exists()) {
                invoke.reject("File does not exist: ${args.filePath}")
                return
            }

            // Android 7.0+ blocks sharing a raw file:// path with another app's
            // Intent (FileUriExposedException) — FileProvider mints a content://
            // URI backed by the <paths> grants declared in file_paths.xml instead.
            val contentUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )

            val mimeType = when (file.extension.lowercase()) {
                "pdf" -> "application/pdf"
                "doc" -> "application/msword"
                "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                "xls" -> "application/vnd.ms-excel"
                "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                "ppt" -> "application/vnd.ms-powerpoint"
                "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                "txt" -> "text/plain"
                "jpg", "jpeg" -> "image/jpeg"
                "png" -> "image/png"
                "gif" -> "image/gif"
                "webp" -> "image/webp"
                else -> "*/*"
            }

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: ActivityNotFoundException) {
            invoke.reject("No app found to open this file")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Failed to open document")
        }
    }
}
