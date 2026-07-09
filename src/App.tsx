import { Routes, Route } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { DailyLimitBanner } from "./components/DailyLimitBanner";
import { BreakOverlay } from "./components/BreakOverlay";
import HomePage from "./pages/HomePage";
import PlanPage from "./pages/PlanPage";
import PlayerPage from "./pages/PlayerPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <NavBar />
      <DailyLimitBanner />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/plan/:planId" element={<PlanPage />} />
          <Route path="/plan/:planId/video/:videoId" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
      <BreakOverlay />
    </div>
  );
}
