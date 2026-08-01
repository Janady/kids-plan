import { useEffect, useState } from "react";
import { discoverRenderers, startCast } from "../api/cast";
import type { CastQueueItem, RendererInfo } from "../types";

interface Props {
  queue: CastQueueItem[];
  onCancel: () => void;
  onStarted: () => void;
}

export function CastDevicePickerModal({ queue, onCancel, onStarted }: Props) {
  const [renderers, setRenderers] = useState<RendererInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const search = () => {
    setLoading(true);
    setError(null);
    discoverRenderers()
      .then((res) => {
        if (res.length === 1) {
          // Only one device — skip the picker and start immediately.
          handleSelect(res[0]);
          return;
        }
        setRenderers(res);
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  };

  useEffect(search, []);

  const handleSelect = async (renderer: RendererInfo) => {
    setStarting(true);
    setError(null);
    try {
      await startCast(renderer.name, renderer.location, queue);
      onStarted();
    } catch (e) {
      setError(String(e));
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 pt-5 pb-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-gray-100">投屏到电视/投影仪</h2>
          <p className="text-xs text-gray-500 mt-1">今日任务共 {queue.length} 个视频，将按顺序播放</p>
        </div>

        <div className="flex-1 overflow-y-auto max-h-72">
          {loading && (
            <div className="py-8 text-center text-sm text-gray-500">正在搜索局域网设备…</div>
          )}

          {!loading && error && (
            <div className="py-6 px-5 text-sm text-red-400 text-center">{error}</div>
          )}

          {!loading && !error && renderers.length === 0 && (
            <div className="py-8 px-5 text-center text-sm text-gray-500">
              未发现可投屏设备，请确认电视/投影仪与本机在同一 Wi-Fi 下并已开启 DLNA
            </div>
          )}

          {!loading &&
            renderers.map((renderer) => (
              <button
                key={renderer.id}
                disabled={starting}
                onClick={() => handleSelect(renderer)}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-gray-200 hover:bg-gray-800 focus:bg-gray-800 focus:outline-none transition-colors disabled:opacity-50"
              >
                <span className="text-base shrink-0">📺</span>
                <span className="truncate text-left flex-1">{renderer.name}</span>
                {starting && <span className="text-xs text-gray-500 shrink-0">连接中…</span>}
              </button>
            ))}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={onCancel}
            disabled={starting}
            className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={search}
            disabled={loading || starting}
            className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
          >
            重新搜索
          </button>
        </div>
      </div>
    </div>
  );
}
