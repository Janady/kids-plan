import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
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

function NumberInput({
  value,
  onChange,
  min = 1,
  max = 999,
  unit,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 field-input text-center"
      />
      <span className="text-mute text-sm">{unit}</span>
    </div>
  );
}

function SaveBtn({ saved, onClick, label = "保存" }: { saved: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="primary">
      {saved ? "已保存 ✓" : label}
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const {
    isParentMode,
    dailyLimitSeconds,
    setDailyLimit,
    maxContinuousSeconds,
    breakDurationSeconds,
    restGapSeconds,
    blockedRanges,
    saveBreakSettings,
    isDailyLimitSkippedToday,
    setSkipDailyLimitToday,
    allowSkipPlayback,
    setAllowSkipPlayback,
  } = useAppContext();

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
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const { isAndroid } = usePlatform();
  const [scanRoot, setScanRoot] = useState("");
  const [showRootPicker, setShowRootPicker] = useState(false);
  const [savedRoot, setSavedRoot] = useState(false);

  useEffect(() => {
    getSetting("scan_root_dir").then((v) => {
      if (v) setScanRoot(v);
    });
  }, []);

  if (!isParentMode) {
    return (
      <div className="card empty">
        <p className="text-4xl mb-4">🔒</p>
        <p className="font-semibold text-ink mb-1">设置页面仅家长可见</p>
        <p className="hint">请到「我的」切换到家长模式</p>
        <button className="primary" onClick={() => navigate("/me")}>
          去我的
        </button>
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
    if (isAndroid) {
      setShowRootPicker(true);
      return;
    }
    const selected = await open({ directory: true, multiple: false, defaultPath: scanRoot || undefined });
    if (selected) await saveRoot(String(selected));
  };

  const handleClearRoot = async () => {
    setScanRoot("");
    await setSetting("scan_root_dir", "");
  };

  const handleSavePassword = async () => {
    const stored = (await getSetting("parent_password")) ?? "";
    if (stored !== "" && stored !== oldPwd) {
      setPwdMsg("原密码不正确");
      return;
    }
    await setSetting("parent_password", newPwd);
    setOldPwd("");
    setNewPwd("");
    setPwdMsg(newPwd === "" ? "密码已清除" : "密码已设置");
    setTimeout(() => setPwdMsg(""), 2500);
  };

  return (
    <div className="space-y-4">
      {showRootPicker && (
        <FolderPickerModal
          initialPath={scanRoot || undefined}
          onSelect={(path) => {
            setShowRootPicker(false);
            saveRoot(path);
          }}
          onCancel={() => setShowRootPicker(false)}
        />
      )}

      <header className="month-head">
        <div>
          <button className="kicker" onClick={() => navigate("/me")}>
            ← 我的
          </button>
          <h1>设置</h1>
        </div>
      </header>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">视频根目录</h2>
        <p className="hint" style={{ padding: "0 0 12px" }}>
          设置后，新增计划时会从这个目录开始选择。
        </p>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 field-input flex items-center text-sm truncate">
            {scanRoot || <span className="text-mute">未设置</span>}
          </div>
          {scanRoot && (
            <button onClick={handleClearRoot} className="ghost-btn">
              清除
            </button>
          )}
        </div>
        <SaveBtn saved={savedRoot} onClick={handlePickRoot} label="选择目录" />
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">每日学习时长上限</h2>
        <p className="hint" style={{ padding: "0 0 12px" }}>
          当前：{fmtSec(dailyLimitSeconds)}。超过后视频全部锁定。
        </p>
        <div className="flex items-center gap-4 mb-4">
          <NumberInput value={dHours} onChange={setDHours} min={0} max={23} unit="小时" />
          <NumberInput value={dMins} onChange={setDMins} min={0} max={59} unit="分钟" />
        </div>
        <SaveBtn saved={savedLimit} onClick={handleSaveLimit} />
        <div className="mt-4 pt-4 flex items-center justify-between gap-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div>
            <p className="text-sm">今日跳过时长限制</p>
            <p className="hint" style={{ padding: "4px 0 0" }}>
              {isDailyLimitSkippedToday ? "已开启，今天不会锁定（时长仍会记录）" : "特殊情况可临时开启，仅当天有效"}
            </p>
          </div>
          <button
            onClick={() => setSkipDailyLimitToday(!isDailyLimitSkippedToday)}
            className={isDailyLimitSkippedToday ? "primary" : "text-btn"}
          >
            {isDailyLimitSkippedToday ? "已开启 ✓" : "开启"}
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">护眼休息提醒</h2>
        <p className="hint" style={{ padding: "0 0 12px" }}>
          连续学习超时后，强制弹出休息提醒。
        </p>
        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">最大连续学习时长</span>
            <NumberInput value={maxContMin} onChange={setMaxContMin} min={5} max={300} unit="分钟" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">强制休息时长</span>
            <NumberInput value={breakDurMin} onChange={setBreakDurMin} min={1} max={60} unit="分钟" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">暂停多久算中断连续观看</span>
            <NumberInput value={restGapMin} onChange={setRestGapMin} min={1} max={60} unit="分钟" />
          </div>
        </div>
        <SaveBtn saved={savedBreak} onClick={handleSaveBreak} />
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">跳过播放</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">允许跳过播放</p>
            <p className="hint" style={{ padding: "4px 0 0" }}>
              {allowSkipPlayback
                ? "关闭后：播放页不能拖动进度条快进，「完成本集」按钮隐藏，首页不显示「之前已看过」"
                : "已关闭，孩子必须完整看完才能标记完成"}
            </p>
          </div>
          <button
            onClick={() => setAllowSkipPlayback(!allowSkipPlayback)}
            className={allowSkipPlayback ? "primary" : "text-btn"}
          >
            {allowSkipPlayback ? "已开启 ✓" : "已关闭"}
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">禁止观看时间段</h2>
        <p className="hint" style={{ padding: "0 0 12px" }}>
          如 22:00–07:00，期间弹出就寝提醒。
        </p>
        <div className="space-y-2 mb-4">
          {ranges.length === 0 ? (
            <p className="text-xs text-mute py-1">暂未设置</p>
          ) : (
            ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-chip">
                <span className="text-sm font-mono">
                  {r.start} — {r.end}
                </span>
                <button onClick={() => setRanges((p) => p.filter((_, j) => j !== i))} className="ml-auto text-xs text-berry">
                  删除
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="field-input w-auto" />
          <span className="text-mute text-sm">至</span>
          <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="field-input w-auto" />
          <button
            onClick={() => newStart && newEnd && setRanges((p) => [...p, { start: newStart, end: newEnd }])}
            className="text-btn"
          >
            + 添加
          </button>
        </div>
        <SaveBtn saved={savedBreak} onClick={handleSaveBreak} label="保存时间段" />
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2 className="text-sm font-semibold mb-1">家长密码</h2>
        <p className="hint" style={{ padding: "0 0 12px" }}>
          设置后，切换到家长模式需要验证密码。留空则无需密码。
        </p>
        <div className="space-y-2 mb-4">
          <input
            type="password"
            placeholder="原密码（首次设置可留空）"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            className="field-input"
          />
          <input
            type="password"
            placeholder="新密码（留空则清除密码）"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="field-input"
          />
        </div>
        {pwdMsg && <p className={`text-xs mb-3 ${pwdMsg.includes("不正确") ? "text-berry" : "text-leaf"}`}>{pwdMsg}</p>}
        <button onClick={handleSavePassword} className="primary">
          {newPwd === "" ? "清除密码" : "设置密码"}
        </button>
      </section>

      <div className="text-center text-xs text-mute pt-2">版本 v{APP_VERSION}</div>
    </div>
  );
}
