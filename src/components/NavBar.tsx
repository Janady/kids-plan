import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppContext } from "../context/AppContext";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function PasswordModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (pwd: string) => void;
  onCancel: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-80 shadow-xl">
        <h2 className="text-base font-semibold text-gray-100 mb-1">切换到家长模式</h2>
        <p className="text-xs text-gray-500 mb-4">请输入家长密码</p>
        <input
          type="password"
          autoFocus
          value={pwd}
          onChange={(e) => { setPwd(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && onConfirm(pwd)}
          placeholder="密码"
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 outline-none focus:border-sky-500 mb-2"
        />
        {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onConfirm(pwd)}
            className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors"
          >
            确认
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function NavBar() {
  const { todayWatchedSeconds, dailyLimitSeconds, isParentMode, toggleParentMode } =
    useAppContext();
  const pct = Math.min(100, Math.round((todayWatchedSeconds / dailyLimitSeconds) * 100));
  const location = useLocation();
  const [showModal, setShowModal] = useState(false);

  const handleModeToggle = async () => {
    if (isParentMode) {
      await toggleParentMode();
    } else {
      // Check if password is set — if modal needed, show it; otherwise toggle directly
      const result = await toggleParentMode("");
      if (!result.success) {
        setShowModal(true);
      }
    }
  };

  const handlePasswordSubmit = async (pwd: string) => {
    const result = await toggleParentMode(pwd);
    if (result.success) {
      setShowModal(false);
    }
    // If failed, modal stays open with error visible via result
  };

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={`text-sm hover:text-sky-400 transition-colors ${
        location.pathname === to ? "text-sky-400" : "text-gray-400"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      {/* Parent mode banner */}
      {isParentMode && (
        <div className="bg-amber-900/60 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 text-center">
          家长模式 · 播放不记录学习进度
        </div>
      )}

      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-5">
        <Link
          to="/"
          className={`font-semibold text-base hover:text-sky-400 transition-colors ${
            location.pathname === "/" ? "text-sky-400" : "text-gray-200"
          }`}
        >
          学习计划
        </Link>

        {navLink("/stats", "统计")}
        {isParentMode && navLink("/settings", "设置")}

        <div className="ml-auto flex items-center gap-3">
          {/* Mode toggle */}
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

          {/* Daily progress */}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="text-xs">
              {formatSeconds(todayWatchedSeconds)}/{formatSeconds(dailyLimitSeconds)}
            </span>
            <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-sky-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </nav>

      {showModal && (
        <PasswordModal
          onConfirm={handlePasswordSubmit}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}
