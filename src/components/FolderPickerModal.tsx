import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DirEntry {
  name: string;
  path: string;
}

interface Props {
  onSelect: (path: string) => void;
  onCancel: () => void;
  initialPath?: string;
}

const ROOT = "/storage/emulated/0";

export function FolderPickerModal({ onSelect, onCancel, initialPath }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath || ROOT);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<DirEntry[]>("list_dir", { path: currentPath })
      .then((res) => { setEntries(res); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [currentPath]);

  const goUp = () => {
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    setCurrentPath(parent);
  };

  const canGoUp = currentPath !== "/" && currentPath !== "";

  // Abbreviated path display: show last 2 segments
  const pathLabel = currentPath
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ") || "/";

  return (
    <div className="sheet-mask center" style={{ position: "fixed", zIndex: 50 }} onClick={onCancel}>
      <div className="sheet dialog" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "80%", display: "flex" }}>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold">选择视频文件夹</h2>
          <p className="text-xs text-accent mt-1 truncate">📂 {pathLabel}</p>
        </div>

        {/* Directory list */}
        <div ref={listRef} className="flex-1 overflow-y-auto max-h-72">
          {canGoUp && (
            <button
              onClick={goUp}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-mute"
            >
              <span className="text-lg">↑</span>
              <span>上级目录</span>
            </button>
          )}

          {loading && (
            <div className="py-8 text-center text-sm text-mute">加载中…</div>
          )}

          {error && (
            <div className="py-6 px-5 text-sm text-berry text-center">
              {error.includes("Permission") || error.includes("permission")
                ? "没有访问权限，请先开启「所有文件访问权限」"
                : `无法打开：${error}`}
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="py-8 text-center text-sm text-mute">此目录为空</div>
          )}

          {!loading &&
            entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => setCurrentPath(entry.path)}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-ink"
              >
                <span className="text-base shrink-0">📁</span>
                <span className="truncate text-left">{entry.name}</span>
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-3">
          <button onClick={onCancel} className="flex-1 text-btn">
            取消
          </button>
          <button onClick={() => onSelect(currentPath)} className="flex-1 primary">
            选择此文件夹
          </button>
        </div>
      </div>
    </div>
  );
}
