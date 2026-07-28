import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { deleteBackgroundTrack } from "../api/plans";
import { useAppContext } from "../context/AppContext";

export default function BackgroundAudioPage() {
  const navigate = useNavigate();
  const {
    isParentMode, bgAudioPlans, bgRefreshPlans, bgSetTrack,
    bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying, bgSetFullscreen,
  } = useAppContext();
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => { bgRefreshPlans(); }, [bgRefreshPlans]);

  const handleDelete = async (videoId: number) => {
    if (!confirm("确认将此音频从背景音乐中移除？（重新扫描后可恢复）")) return;
    setDeleting(videoId);
    try {
      await deleteBackgroundTrack(videoId);
      await bgRefreshPlans();
    } finally {
      setDeleting(null);
    }
  };

  const totalTracks = bgAudioPlans.reduce((s, p) => s + p.tracks.length, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/")} className="text-gray-400 hover:text-gray-200 text-sm transition-colors">
          ← 返回
        </button>
        <h1 className="text-xl font-bold text-gray-100">背景音乐管理</h1>
        {totalTracks > 0 && (
          <span className="text-sm text-gray-500">共 {totalTracks} 首</span>
        )}
      </div>

      {bgAudioPlans.length === 0 && (
        <div className="text-center text-gray-500 py-20">
          <p className="text-3xl mb-3">🎶</p>
          <p className="text-gray-400 mb-1">还没有背景音乐</p>
          <p className="text-sm text-gray-600 mb-4">
            在计划页面的音频 Tab 中，勾选「同时作为背景音乐」即可加入
          </p>
          <button
            onClick={() => navigate("/")}
            className="text-sky-400 text-sm hover:text-sky-300 transition-colors"
          >
            返回首页 →
          </button>
        </div>
      )}

      <div className="space-y-6">
        {bgAudioPlans.map((plan) => (
          <div key={plan.id}>
            <div
              onClick={() => navigate(`/plan/${plan.id}`)}
              className="flex items-center gap-2 mb-2 cursor-pointer group"
            >
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider group-hover:text-purple-300 transition-colors">
                🎶 {plan.name}
              </span>
              <span className="text-[10px] text-gray-600">{plan.tracks.length} 首</span>
              <span className="text-[10px] text-gray-700 group-hover:text-gray-500 transition-colors ml-1">→</span>
            </div>

            <div className="space-y-1">
              {plan.tracks.map((track, idx) => {
                const isCurrentlyPlaying =
                  bgCurrentPlanId === plan.id && bgCurrentTrackIdx === idx;

                return (
                  <div
                    key={track.id}
                    onClick={() => { bgSetTrack(plan.id, idx); bgSetFullscreen(true); }}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-all ${
                      isCurrentlyPlaying
                        ? "border-purple-700/60 bg-purple-900/20"
                        : "border-gray-700/50 bg-gray-800/60 hover:border-gray-600"
                    }`}
                  >
                    <span
                      className={`text-sm shrink-0 ${
                        isCurrentlyPlaying && bgIsPlaying ? "text-purple-400" : "text-gray-500"
                      }`}
                    >
                      {isCurrentlyPlaying && bgIsPlaying ? "♪" : "▶"}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${isCurrentlyPlaying ? "text-purple-300" : "text-gray-200"}`}>
                        {track.title}
                      </div>
                    </div>

                    {track.play_count_30d > 0 && (
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {track.play_count_30d}次/30天
                      </span>
                    )}

                    {isParentMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(track.id); }}
                        disabled={deleting === track.id}
                        className="text-xs text-red-400/60 hover:text-red-400 disabled:opacity-40 transition-colors shrink-0 px-1"
                        title="移除"
                      >
                        {deleting === track.id ? "…" : "🗑️"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
