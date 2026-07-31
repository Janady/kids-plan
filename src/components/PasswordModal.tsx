import { useState } from "react";

export function PasswordModal({
  title = "验证家长密码",
  subtitle = "请输入家长密码",
  error,
  onConfirm,
  onCancel,
}: {
  title?: string;
  subtitle?: string;
  error?: string;
  onConfirm: (pwd: string) => void;
  onCancel: () => void;
}) {
  const [pwd, setPwd] = useState("");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-80 shadow-xl">
        <h2 className="text-base font-semibold text-gray-100 mb-1">{title}</h2>
        <p className="text-xs text-gray-500 mb-4">{subtitle}</p>
        <input
          type="password"
          autoFocus
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirm(pwd)}
          placeholder="密码"
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 outline-none focus:border-sky-500 mb-2"
        />
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
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
