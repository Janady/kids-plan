import { KeyboardEvent, ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  tabIndex?: number;
}

export function FocusableCard({ children, onClick, className = "", tabIndex = 0 }: Props) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
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
