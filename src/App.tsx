import { Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NavBar } from "./components/NavBar";
import { DailyLimitBanner } from "./components/DailyLimitBanner";
import { BreakOverlay } from "./components/BreakOverlay";
import { BackgroundAudioPlayer } from "./components/BackgroundAudioPlayer";
import { BgFullscreenPlayer } from "./components/BgFullscreenPlayer";
import HomePage from "./pages/HomePage";
import PlanPage from "./pages/PlanPage";
import PlayerPage from "./pages/PlayerPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";
import BackgroundAudioPage from "./pages/BackgroundAudioPage";
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
  const { bgAudioPlans } = useAppContext();
  const hasBgAudio = bgAudioPlans.length > 0;

  return (
    <div className={`min-h-screen bg-gray-950 text-gray-100 flex flex-col${isTV ? " px-[5vw] py-[3vh]" : ""}`}>
      <NavBar />
      <StoragePermissionBanner />
      <DailyLimitBanner />
      <main className={`flex-1 container mx-auto px-4 py-4 max-w-6xl${isTV ? " pb-20" : hasBgAudio ? " pb-16" : ""}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/plan/:planId" element={<PlanPage />} />
          <Route path="/plan/:planId/video/:videoId" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/background-audio" element={<BackgroundAudioPage />} />
        </Routes>
      </main>
      <BreakOverlay />
      <BackgroundAudioPlayer />
      <BgFullscreenPlayer />
    </div>
  );
}
