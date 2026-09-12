import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import { PasswordModal } from "./PasswordModal";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function NavBar() {
  const { todayWatchedSeconds, todayAudioSeconds, dailyLimitSeconds, isParentMode, toggleParentMode } =
    useAppContext();
  const pct = Math.min(100, Math.round((todayWatchedSeconds / dailyLimitSeconds) * 100));
  const location = useLocation();
  const [showModal, setShowModal] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const { isTV, isAndroid } = usePlatform();
  const showProgress = !isAndroid || isTV;

  const handleModeToggle = async () => {
    if (isParentMode) {
      await toggleParentMode();
    } else {
      const result = await toggleParentMode("");
      if (!result.success) {
        setModalErr("");
        setShowModal(true);
      }
    }
  };

  const handlePasswordSubmit = async (pwd: string) => {
    const result = await toggleParentMode(pwd);
    if (result.success) {
      setShowModal(false);
      setModalErr("");
    } else {
      setModalErr(result.error ?? "密码不正确");
    }
  };

  const navLink = (to: string, label: string, active = location.pathname === to) => (
    <Link
      to={to}
      className={`text-sm hover:text-sky-400 transition-colors ${
        active ? "text-sky-400" : "text-gray-400"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className={!isTV ? "bg-gray-900" : undefined} style={!isTV ? { paddingTop: "var(--android-sat, env(safe-area-inset-top))" } : undefined}>
      {isParentMode && (
        <div className="bg-amber-900/60 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 text-center">
          家长模式 · 播放不记录学习进度
        </div>
      )}

      <nav className={`bg-gray-900 border-gray-800 px-4 flex items-center gap-5 ${
        isTV
          ? "fixed bottom-0 left-0 right-0 z-40 border-t py-4 text-base"
          : "border-b py-2.5"
      }`}>
        <Link
          to="/"
          className={`font-semibold text-base hover:text-sky-400 transition-colors ${
            location.pathname === "/" ? "text-sky-400" : "text-gray-200"
          }`}
        >
          学习计划
        </Link>

        {navLink(
          "/plans",
          "计划",
          location.pathname === "/plans" || location.pathname.startsWith("/plan/"),
        )}
        {navLink("/stats", "统计")}
        {isParentMode && navLink("/cleanup", "清理")}
        {isParentMode && navLink("/settings", "设置")}

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleModeToggle}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${
              isParentMode
                ? "border-amber-600 text-amber-400 hover:bg-amber-900/30"
                : "border-gray-600 text-gray-400 hover:border-gray-400"
            }`}
          >
            {isParentMode ? "👨 家长模式" : "👶 儿童模式"}
          </button>

          {showProgress && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs leading-none">
                  {formatSeconds(todayWatchedSeconds)}/{formatSeconds(dailyLimitSeconds)}
                </span>
                {todayAudioSeconds > 0 && (
                  <span className="text-[10px] text-purple-400 leading-none">
                    🎵 {formatSeconds(todayAudioSeconds)}
                  </span>
                )}
              </div>
              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-sky-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </nav>
      </div>

      {showModal && (
        <PasswordModal
          title="切换到家长模式"
          error={modalErr}
          onConfirm={handlePasswordSubmit}
          onCancel={() => { setShowModal(false); setModalErr(""); }}
        />
      )}
    </>
  );
}
