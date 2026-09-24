import { useState } from "react";
import { Sheet } from "../ui/Sheet";

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
    <Sheet title={title} onClose={onCancel} variant="dialog" closeLabel="取消">
      <p className="hint" style={{ paddingTop: 0 }}>
        {subtitle}
      </p>
      <input
        type="password"
        autoFocus
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onConfirm(pwd)}
        placeholder="密码"
        className="field-input mb-3"
      />
      {error && <p className="warn mb-2">{error}</p>}
      <button className="primary block" onClick={() => onConfirm(pwd)}>
        确认
      </button>
    </Sheet>
  );
}
