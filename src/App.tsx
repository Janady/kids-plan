import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DailyLimitBanner } from "./components/DailyLimitBanner";
import { BreakOverlay } from "./components/BreakOverlay";
import { BackgroundAudioPlayer } from "./components/BackgroundAudioPlayer";
import { CastStatusBar } from "./components/CastStatusBar";
import { BottomNav } from "./components/BottomNav";
import HomePage from "./pages/HomePage";
import PlansPage from "./pages/PlansPage";
import PlanPage from "./pages/PlanPage";
import PlayerPage from "./pages/PlayerPage";
import DocumentViewerPage from "./pages/DocumentViewerPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";
import BackgroundAudioPage from "./pages/BackgroundAudioPage";
import CleanupPage from "./pages/CleanupPage";
import BlankPracticePage from "./pages/BlankPracticePage";
import MePage from "./pages/MePage";
import { usePlatform } from "./hooks/usePlatform";
import { useAppContext } from "./context/AppContext";
import { setPing } from "./ui/toast";

function StoragePermissionBanner() {
  const { isAndroid } = usePlatform();
  const [needsPermission, setNeedsPermission] = useState(false);

  useEffect(() => {
    if (!isAndroid) return;
    invoke<boolean>("check_storage_accessible").then((ok) => {
      if (!ok) setNeedsPermission(true);
    });
  }, [isAndroid]);

  if (!needsPermission) return null;

  return (
    <div className="banner perm">
      需要「所有文件访问权限」才能扫描视频文件夹。请前往 设置 › 应用 › 特殊应用访问权限 › 所有文件访问权限 开启。
    </div>
  );
}

function isOverlayPath(pathname: string) {
  return (
    /^\/plan\/[^/]+\/video\//.test(pathname) ||
    /^\/plan\/[^/]+\/document\//.test(pathname) ||
    /^\/plan\/[^/]+\/blank-practice/.test(pathname)
  );
}

export default function App() {
  const { isTV, isRail } = usePlatform();
  const { isBreakRequired, isBedtime, isParentMode } = useAppContext();
  const location = useLocation();
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);

  useEffect(() => {
    setPing((text) => {
      setToast(text);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(""), 1600);
    });
    return () => setPing(null);
  }, []);

  const onPlayerPage = /^\/plan\/[^/]+\/video\//.test(location.pathname);
  const overlayActive = isBreakRequired || isBedtime;
  const showBgEngine = !onPlayerPage || overlayActive;
  const hideChrome = isOverlayPath(location.pathname);

  return (
    <div className={`app${isTV ? " is-tv" : ""}${isRail ? " is-rail" : ""}`}>
      {!hideChrome && (
        <div className="safe-top">
          <StoragePermissionBanner />
          {isParentMode && <div className="banner parent">家长模式 · 播放不记录学习进度</div>}
          <DailyLimitBanner />
          <CastStatusBar />
        </div>
      )}
      <div className={hideChrome ? "workspace workspace-full" : "workspace"}>
        {!hideChrome && <BottomNav />}
        <main className={hideChrome ? "stage-full" : "stage"}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/plan/:planId" element={<PlanPage />} />
            <Route path="/plan/:planId/video/:videoId" element={<PlayerPage />} />
            <Route path="/plan/:planId/document/:videoId" element={<DocumentViewerPage />} />
            <Route path="/plan/:planId/blank-practice" element={<BlankPracticePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/listen" element={<BackgroundAudioPage />} />
            <Route path="/background-audio" element={<Navigate to="/listen" replace />} />
            <Route path="/cleanup" element={<CleanupPage />} />
            <Route path="/me" element={<MePage />} />
          </Routes>
        </main>
      </div>
      <BreakOverlay />
      {showBgEngine && <BackgroundAudioPlayer />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
