import type { LoopMode } from "../types";

interface Props {
  mode: LoopMode;
  size?: number;
  /** Accent color used for the icon. */
  activeColor?: string;
}

// Playback-mode icon in the style of mainstream music players:
//  - shuffle: crossing arrows (random playback)
//  - all:     repeat arrows (loop the whole list)
//  - track:   repeat arrows with a small "1" badge (repeat one)
export function LoopIcon({ mode, size = 20, activeColor = "#a78bfa" }: Props) {
  const color = activeColor;

  if (mode === "shuffle") {
    return (
      <span
        className="inline-flex items-center justify-center"
        style={{ width: size, height: size }}
        title="随机播放"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Shuffle: two crossing paths with arrowheads */}
          <path d="M16 3h5v5" />
          <path d="M4 20L21 3" />
          <path d="M21 16v5h-5" />
          <path d="M15 15l6 6" />
          <path d="M4 4l5 5" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      title={mode === "track" ? "单曲循环" : "列表循环"}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Repeat arrows loop */}
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>

      {/* "1" badge for single-track repeat */}
      {mode === "track" && (
        <span
          className="absolute inset-0 flex items-center justify-center font-bold"
          style={{ fontSize: size * 0.42, color: activeColor }}
        >
          1
        </span>
      )}
    </span>
  );
}
