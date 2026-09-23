package com.janady.video_plan

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import java.io.File

// Foreground media service that actually plays audio via MediaPlayer.
// HTML <audio> inside the WebView is paused by Chromium on many tablets as
// soon as the screen turns off; a PARTIAL_WAKE_LOCK alone does not prevent
// that. Playing from this service keeps sound going through sleep.
class BgPlaybackService : Service(), AudioManager.OnAudioFocusChangeListener {
    companion object {
        const val CHANNEL_ID = "bg_playback"
        const val NOTIF_ID = 42
        const val ACTION_TOGGLE = "com.janady.video_plan.bg.TOGGLE"
        const val ACTION_NEXT = "com.janady.video_plan.bg.NEXT"
        const val ACTION_PREV = "com.janady.video_plan.bg.PREV"
        const val ACTION_STOP = "com.janady.video_plan.bg.STOP"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_PATH = "path"
        private const val EXTRA_LOOP = "loopTrack"
        private const val WAKELOCK_TIMEOUT_MS = 8 * 60 * 60 * 1000L

        @Volatile
        var isRunning = false
            private set

        fun start(context: Context, title: String, path: String, loopTrack: Boolean) {
            isRunning = true
            val intent = Intent(context, BgPlaybackService::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_PATH, path)
                .putExtra(EXTRA_LOOP, loopTrack)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            isRunning = false
            context.stopService(Intent(context, BgPlaybackService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var mediaSession: MediaSessionCompat? = null
    private var mediaPlayer: MediaPlayer? = null
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null
    private var currentTitle: String = "背景音乐"
    private var currentPath: String = ""
    private var loopTrack: Boolean = false
    private var pausedByFocus = false
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        createChannel()
        audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        mediaSession = MediaSessionCompat(this, "videoplan.bgplayback").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() { toggle(forcePlay = true) }
                override fun onPause() { toggle(forcePlay = false) }
                override fun onSkipToNext() { emit("next") }
                override fun onSkipToPrevious() { emit("prev") }
                override fun onStop() { Companion.stop(this@BgPlaybackService) }
            })
            isActive = true
        }
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "videoplan:bgplayback").apply {
            setReferenceCounted(false)
            acquire(WAKELOCK_TIMEOUT_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> toggle()
            ACTION_NEXT -> emit("next")
            ACTION_PREV -> emit("prev")
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val title = intent?.getStringExtra(EXTRA_TITLE)
                val path = intent?.getStringExtra(EXTRA_PATH)
                if (!title.isNullOrBlank()) currentTitle = title
                loopTrack = intent?.getBooleanExtra(EXTRA_LOOP, false) ?: false
                if (!path.isNullOrBlank()) playPath(path)
            }
        }
        promoteForeground()
        isRunning = true
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        abandonFocus()
        releasePlayer()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        if (wakeLock?.isHeld == true) wakeLock?.release()
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                pausedByFocus = false
                pausePlayer()
                emit("pause")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (isPlayerPlaying()) {
                    pausedByFocus = true
                    pausePlayer()
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (pausedByFocus) {
                    pausedByFocus = false
                    startPlayer()
                }
            }
        }
    }

    private fun playPath(path: String) {
        if (path == currentPath && isPlayerPlaying()) {
            mediaPlayer?.isLooping = loopTrack
            updateSession(playing = true)
            promoteForeground()
            return
        }
        currentPath = path
        pausedByFocus = false
        releasePlayer()
        val player = MediaPlayer()
        mediaPlayer = player
        try {
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                player.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
            }
            player.isLooping = loopTrack
            setPlayerDataSource(player, path)
            player.setOnPreparedListener {
                requestFocus()
                it.start()
                updateSession(playing = true)
                promoteForeground()
            }
            player.setOnCompletionListener {
                if (!loopTrack) emit("ended")
            }
            player.setOnErrorListener { _, _, _ ->
                emit("ended")
                true
            }
            player.prepareAsync()
        } catch (_: Exception) {
            releasePlayer()
            emit("ended")
        }
    }

    private fun setPlayerDataSource(player: MediaPlayer, path: String) {
        val file = File(path)
        if (file.exists()) {
            player.setDataSource(file.absolutePath)
        } else {
            player.setDataSource(this, Uri.parse(path))
        }
    }

    private fun isPlayerPlaying(): Boolean {
        return try { mediaPlayer?.isPlaying == true } catch (_: Exception) { false }
    }

    private fun toggle(forcePlay: Boolean? = null) {
        val playing = isPlayerPlaying()
        val shouldPlay = forcePlay ?: !playing
        if (shouldPlay) {
            pausedByFocus = false
            startPlayer()
            emit("play")
        } else {
            pausedByFocus = false
            pausePlayer()
            emit("pause")
        }
    }

    private fun startPlayer() {
        requestFocus()
        try {
            if (mediaPlayer?.isPlaying == false) mediaPlayer?.start()
        } catch (_: Exception) {}
        updateSession(playing = true)
        promoteForeground()
    }

    private fun pausePlayer() {
        try {
            if (mediaPlayer?.isPlaying == true) mediaPlayer?.pause()
        } catch (_: Exception) {}
        updateSession(playing = false)
        promoteForeground()
    }

    private fun releasePlayer() {
        try {
            mediaPlayer?.reset()
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
    }

    private fun requestFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(this)
                .build()
                .also { focusRequest = it }
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun abandonFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(this)
        }
    }

    private fun emit(event: String) {
        mainHandler.post {
            BackgroundPlaybackPlugin.emit(event)
            MainActivity.dispatchBgEvent(event)
        }
    }

    private fun updateSession(playing: Boolean) {
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        mediaSession?.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_STOP
                )
                .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f)
                .build()
        )
        mediaSession?.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "背景音乐")
                .build()
        )
    }

    private fun promoteForeground() {
        val playing = isPlayerPlaying()
        updateSession(playing)
        val notification = buildNotification(currentTitle, playing)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIF_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIF_ID, notification)
            }
        } catch (_: Exception) {
            // Notification permission can be missing on API 33+; keep playing anyway.
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "背景音乐播放",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "锁屏后继续播放背景音乐"
            setShowBadge(false)
        }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    private fun actionIntent(action: String): PendingIntent {
        val intent = Intent(this, BgPlaybackService::class.java).setAction(action)
        return PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildNotification(title: String, playing: Boolean): Notification {
        val launch = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val toggleLabel = if (playing) "暂停" else "继续"
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("背景音乐")
            .setContentText(title)
            .setSmallIcon(R.drawable.ic_bg_playback)
            .setOngoing(true)
            .setContentIntent(launch)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_media_previous, "上一首", actionIntent(ACTION_PREV))
            .addAction(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                toggleLabel,
                actionIntent(ACTION_TOGGLE)
            )
            .addAction(android.R.drawable.ic_media_next, "下一首", actionIntent(ACTION_NEXT))
        mediaSession?.let { session ->
            builder.setStyle(
                MediaNotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        }
        return builder.build()
    }
}
