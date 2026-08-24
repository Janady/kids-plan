import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NavBar } from "./components/NavBar";
import { DailyLimitBanner } from "./components/DailyLimitBanner";
import { BreakOverlay } from "./components/BreakOverlay";
import { BackgroundAudioPlayer } from "./components/BackgroundAudioPlayer";
import { BgFullscreenPlayer } from "./components/BgFullscreenPlayer";
import { CastStatusBar } from "./components/CastStatusBar";
import HomePage from "./pages/HomePage";
import PlansPage from "./pages/PlansPage";
import PlanPage from "./pages/PlanPage";
import PlayerPage from "./pages/PlayerPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";
import BackgroundAudioPage from "./pages/BackgroundAudioPage";
import CleanupPage from "./pages/CleanupPage";
import { usePlatform } from "./hooks/usePlatform";
import { useAppContext } from "./context/AppContext";

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
    <div className="bg-amber-900/80 border-b border-amber-700 px-4 py-3 text-sm text-amber-200 text-center">
      需要"所有文件访问权限"才能扫描视频文件夹。
      请前往 <strong>设置 › 应用 › 特殊应用访问权限 › 所有文件访问权限</strong> 开启。
    </div>
  );
}

export default function App() {
  const { isTV } = usePlatform();
  const { bgAudioPlans, isBreakRequired, isBedtime } = useAppContext();
  const location = useLocation();
  // On the video player page we don't show the background-audio bar (the video
  // has its own audio); PlayerPage stops any background playback on entry.
  // Exception: if a break/bedtime overlay is showing (can happen while still on
  // the player route), background music should still play — BackgroundAudioPlayer
  // owns the only <audio> element that actually produces sound, so it must stay
  // mounted whenever the overlay's music controls are visible.
  const onPlayerPage = /^\/plan\/[^/]+\/video\//.test(location.pathname);
  const overlayActive = isBreakRequired || isBedtime;
  const showBgPlayer = !onPlayerPage || overlayActive;
  const hasBgAudio = bgAudioPlans.length > 0 && showBgPlayer;

  return (
    <div className={`min-h-screen bg-gray-950 text-gray-100 flex flex-col${isTV ? " px-[5vw] py-[3vh]" : ""}`}>
      <NavBar />
      <StoragePermissionBanner />
      <DailyLimitBanner />
      <CastStatusBar />
      <main className={`flex-1 container mx-auto px-4 py-4 max-w-6xl${isTV ? " pb-20" : hasBgAudio ? " pb-16" : ""}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plan/:planId" element={<PlanPage />} />
          <Route path="/plan/:planId/video/:videoId" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/background-audio" element={<BackgroundAudioPage />} />
          <Route path="/cleanup" element={<CleanupPage />} />
        </Routes>
      </main>
      <BreakOverlay />
      {showBgPlayer && <BackgroundAudioPlayer />}
      <BgFullscreenPlayer />
    </div>
  );
}
