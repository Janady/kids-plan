import { KeyboardEvent, ReactNode, useRef } from "react";

interface Props {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  tabIndex?: number;
}

export function FocusableCard({ children, onClick, className = "", tabIndex = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>('[tabindex="0"]')
      ).filter((el) => !el.hasAttribute("disabled"));
      const idx = focusables.indexOf(ref.current as HTMLElement);
      if (idx === -1) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        focusables[idx + 1]?.focus();
      } else {
        focusables[idx - 1]?.focus();
      }
    }
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer select-none ${className}`}
    >
      {children}
    </div>
  );
}
