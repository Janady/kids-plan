import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppContext } from "../context/AppContext";
import { getSetting, setSetting } from "../api/settings";
import { usePlatform } from "../hooks/usePlatform";
import { FolderPickerModal } from "../components/FolderPickerModal";
import { APP_VERSION } from "../version";
import type { BlockedTimeRange } from "../types";

function fmtSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function NumberInput({ value, onChange, min = 1, max = 999, unit }: {
  value: string; onChange: (v: string) => void; min?: number; max?: number; unit: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-center text-gray-100 focus:border-sky-500 outline-none" />
      <span className="text-gray-400 text-sm">{unit}</span>
    </div>
  );
}

function SaveBtn({ saved, onClick, label = "保存" }: { saved: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${saved ? "bg-green-700 text-green-200" : "bg-sky-600 hover:bg-sky-500 text-white"}`}>
      {saved ? "已保存 ✓" : label}
    </button>
  );
}

export default function SettingsPage() {
  const { isParentMode, dailyLimitSeconds, setDailyLimit, maxContinuousSeconds,
    breakDurationSeconds, restGapSeconds, blockedRanges, saveBreakSettings,
    isDailyLimitSkippedToday, setSkipDailyLimitToday } = useAppContext();

  const [dHours, setDHours] = useState(String(Math.floor(dailyLimitSeconds / 3600)));
  const [dMins, setDMins] = useState(String(Math.floor((dailyLimitSeconds % 3600) / 60)));
  const [maxContMin, setMaxContMin] = useState(String(Math.round(maxContinuousSeconds / 60)));
  const [breakDurMin, setBreakDurMin] = useState(String(Math.round(breakDurationSeconds / 60)));
  const [restGapMin, setRestGapMin] = useState(String(Math.round(restGapSeconds / 60)));
  const [ranges, setRanges] = useState<BlockedTimeRange[]>(blockedRanges);
  const [newStart, setNewStart] = useState("22:00");
  const [newEnd, setNewEnd] = useState("07:00");
  const [savedLimit, setSavedLimit] = useState(false);
  const [savedBreak, setSavedBreak] = useState(false);

  // Password
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");

  // Scan root directory — new plans start from here
  const { isAndroid } = usePlatform();
  const [scanRoot, setScanRoot] = useState("");
  const [showRootPicker, setShowRootPicker] = useState(false);
  const [savedRoot, setSavedRoot] = useState(false);

  useEffect(() => {
    getSetting("scan_root_dir").then((v) => { if (v) setScanRoot(v); });
  }, []);

  if (!isParentMode) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-4xl mb-4">🔒</p>
        <p className="text-gray-400 text-lg mb-1">设置页面仅家长可见</p>
        <p className="text-gray-600 text-sm">请通过导航栏切换到家长模式</p>
      </div>
    );
  }

  const handleSaveLimit = async () => {
    const total = parseInt(dHours || "0", 10) * 3600 + parseInt(dMins || "0", 10) * 60;
    if (total <= 0) return;
    await setDailyLimit(total);
    setSavedLimit(true);
    setTimeout(() => setSavedLimit(false), 2000);
  };

  const handleSaveBreak = async () => {
    const maxMin = parseInt(maxContMin || "45", 10);
    const breakMin = parseInt(breakDurMin || "5", 10);
    const restGap = parseInt(restGapMin || "5", 10);
    if (maxMin <= 0 || breakMin <= 0 || restGap <= 0) return;
    await saveBreakSettings(maxMin, breakMin, restGap, ranges);
    setSavedBreak(true);
    setTimeout(() => setSavedBreak(false), 2000);
  };

  const saveRoot = async (path: string) => {
    setScanRoot(path);
    await setSetting("scan_root_dir", path);
    setSavedRoot(true);
    setTimeout(() => setSavedRoot(false), 2000);
  };

  const handlePickRoot = async () => {
    if (isAndroid) { setShowRootPicker(true); return; }
    const selected = await open({ directory: true, multiple: false, defaultPath: scanRoot || undefined });
    if (selected) await saveRoot(String(selected));
  };

  const handleClearRoot = async () => {
    setScanRoot("");
    await setSetting("scan_root_dir", "");
  };

  const handleSavePassword = async () => {
    const stored = await getSetting("parent_password") ?? "";
    if (stored !== "" && stored !== oldPwd) {
      setPwdMsg("原密码不正确");
      return;
    }
    await setSetting("parent_password", newPwd);
    setOldPwd(""); setNewPwd("");
    setPwdMsg(newPwd === "" ? "密码已清除" : "密码已设置");
    setTimeout(() => setPwdMsg(""), 2500);
  };

  return (
    <div className="max-w-lg space-y-6">
      {showRootPicker && (
        <FolderPickerModal
          initialPath={scanRoot || undefined}
          onSelect={(path) => { setShowRootPicker(false); saveRoot(path); }}
          onCancel={() => setShowRootPicker(false)}
        />
      )}

      <h1 className="text-2xl font-bold text-gray-100">设置</h1>

      {/* Scan root directory */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">视频根目录</h2>
        <p className="text-xs text-gray-500 mb-4">
          设置后，新增计划时会从这个目录开始选择，不必每次从头找。
        </p>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 truncate">
            {scanRoot || <span className="text-gray-600">未设置（默认从根目录选起）</span>}
          </div>
          {scanRoot && (
            <button onClick={handleClearRoot} className="shrink-0 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors">
              清除
            </button>
          )}
        </div>
        <button
          onClick={handlePickRoot}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${savedRoot ? "bg-green-700 text-green-200" : "bg-sky-600 hover:bg-sky-500 text-white"}`}
        >
          {savedRoot ? "已保存 ✓" : "选择目录"}
        </button>
      </section>

      {/* Daily limit */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">每日学习时长上限</h2>
        <p className="text-xs text-gray-500 mb-4">当前：{fmtSec(dailyLimitSeconds)}。超过后视频全部锁定。</p>
        <div className="flex items-center gap-4 mb-4">
          <NumberInput value={dHours} onChange={setDHours} min={0} max={23} unit="小时" />
          <NumberInput value={dMins} onChange={setDMins} min={0} max={59} unit="分钟" />
        </div>
        <SaveBtn saved={savedLimit} onClick={handleSaveLimit} />

        <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-300">今日跳过时长限制</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {isDailyLimitSkippedToday
                ? "已开启，今天不会锁定（时长仍会记录）"
                : "特殊情况可临时开启，如周末观影，仅当天有效"}
            </p>
          </div>
          <button
            onClick={() => setSkipDailyLimitToday(!isDailyLimitSkippedToday)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isDailyLimitSkippedToday
                ? "bg-green-700 text-green-200"
                : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
          >
            {isDailyLimitSkippedToday ? "已开启 ✓" : "开启"}
          </button>
        </div>
      </section>

      {/* Break */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">护眼休息提醒</h2>
        <p className="text-xs text-gray-500 mb-4">连续学习超时后，强制弹出休息提醒。</p>
        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">最大连续学习时长</span>
            <NumberInput value={maxContMin} onChange={setMaxContMin} min={5} max={300} unit="分钟" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">强制休息时长</span>
            <NumberInput value={breakDurMin} onChange={setBreakDurMin} min={1} max={60} unit="分钟" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">暂停多久算中断连续观看</span>
            <NumberInput value={restGapMin} onChange={setRestGapMin} min={1} max={60} unit="分钟" />
          </div>
        </div>
        <SaveBtn saved={savedBreak} onClick={handleSaveBreak} />
      </section>

      {/* Blocked times */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">禁止观看时间段</h2>
        <p className="text-xs text-gray-500 mb-4">如 22:00–07:00，期间弹出就寝提醒。</p>
        <div className="space-y-2 mb-4">
          {ranges.length === 0 ? (
            <p className="text-xs text-gray-600 py-1">暂未设置</p>
          ) : (
            ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-700/50 rounded-lg">
                <span className="text-sm text-gray-300 font-mono">{r.start} — {r.end}</span>
                <button onClick={() => setRanges((p) => p.filter((_, j) => j !== i))} className="ml-auto text-xs text-red-400 hover:text-red-300">删除</button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)}
            className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-sky-500" />
          <span className="text-gray-500 text-sm">至</span>
          <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
            className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-sky-500" />
          <button onClick={() => newStart && newEnd && setRanges((p) => [...p, { start: newStart, end: newEnd }])}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">+ 添加</button>
        </div>
        <SaveBtn saved={savedBreak} onClick={handleSaveBreak} label="保存时间段" />
      </section>

      {/* Parent password */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">家长密码</h2>
        <p className="text-xs text-gray-500 mb-4">设置后，切换到家长模式需要验证密码。留空则无需密码。</p>
        <div className="space-y-2 mb-4">
          <input type="password" placeholder="原密码（首次设置可留空）" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 outline-none focus:border-sky-500" />
          <input type="password" placeholder="新密码（留空则清除密码）" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 outline-none focus:border-sky-500" />
        </div>
        {pwdMsg && <p className={`text-xs mb-3 ${pwdMsg.includes("不正确") ? "text-red-400" : "text-green-400"}`}>{pwdMsg}</p>}
        <button onClick={handleSavePassword} className="px-5 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors">
          {newPwd === "" ? "清除密码" : "设置密码"}
        </button>
      </section>

      {/* Version info — for debugging which build is installed */}
      <div className="text-center text-xs text-gray-600 pt-2">
        版本 v{APP_VERSION}
      </div>
    </div>
  );
}
