# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── WebView video fullscreen ──────────────────────────────────────────────────
# The WebView decides whether the <video> fullscreen button is enabled by
# reflecting on whether WebChromeClient overrides onShowCustomView/onHideCustomView.
# In release builds R8 renames/strips these "unused" overrides, so the fullscreen
# button turns grey (disabled). Keep our custom WebChromeClient and its methods
# intact. (debug builds aren't minified, which is why fullscreen worked there.)
-keep class com.janady.video_plan.RustWebChromeClient { *; }
-keepclassmembers class * extends android.webkit.WebChromeClient {
  public void onShowCustomView(...);
  public void onHideCustomView();
}
-keep class * extends android.webkit.WebChromeClient { *; }
-keep class * extends android.webkit.WebViewClient { *; }