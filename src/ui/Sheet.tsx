import { useEffect } from "react";

export function Sheet({
  title,
  closeLabel = "关闭",
  onClose,
  children,
  variant = "sheet",
}: {
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "sheet" | "dialog";
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isDialog = variant === "dialog";

  return (
    <div className={`sheet-mask${isDialog ? " center" : ""}`} onClick={onClose}>
      <div className={`sheet ${isDialog ? "dialog" : "full"}`} onClick={(event) => event.stopPropagation()}>
        {!isDialog && <div className="grab" />}
        <div className="sheet-head">
          <button type="button" onClick={onClose}>{closeLabel}</button>
          <h2>{title}</h2>
          <span />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
