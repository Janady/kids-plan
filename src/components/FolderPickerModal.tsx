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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-gray-100">选择视频文件夹</h2>
          <p className="text-xs text-sky-400 mt-1 truncate">📂 {pathLabel}</p>
        </div>

        {/* Directory list */}
        <div ref={listRef} className="flex-1 overflow-y-auto max-h-72">
          {canGoUp && (
            <button
              onClick={goUp}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-400 hover:bg-gray-800 focus:bg-gray-800 focus:outline-none border-b border-gray-800/50 transition-colors"
            >
              <span className="text-lg">↑</span>
              <span>上级目录</span>
            </button>
          )}

          {loading && (
            <div className="py-8 text-center text-sm text-gray-500">加载中…</div>
          )}

          {error && (
            <div className="py-6 px-5 text-sm text-red-400 text-center">
              {error.includes("Permission") || error.includes("permission")
                ? "没有访问权限，请先开启「所有文件访问权限」"
                : `无法打开：${error}`}
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-500">此目录为空</div>
          )}

          {!loading &&
            entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => setCurrentPath(entry.path)}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-200 hover:bg-gray-800 focus:bg-gray-800 focus:outline-none transition-colors"
              >
                <span className="text-base shrink-0">📁</span>
                <span className="truncate text-left">{entry.name}</span>
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            取消
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            选择此文件夹
          </button>
        </div>
      </div>
    </div>
  );
}
