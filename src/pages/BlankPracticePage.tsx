import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { getTodaySchedule, completeBlankPractice } from "../api/schedule";

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function BlankPracticePage() {
  const { planId } = useParams<{ planId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(planId);

  const minutesParam = searchParams.get("minutes");
  const [minutes, setMinutes] = useState<number | null>(minutesParam ? Number(minutesParam) : null);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  // Fall back to today's schedule when minutes isn't in the URL.
  useEffect(() => {
    if (minutes !== null) return;
    getTodaySchedule().then((schedule) => {
      const item = schedule.find((s) => s.plan_id === id);
      if (item?.blank_practice) setMinutes(item.blank_practice.minutes);
    });
  }, [minutes, id]);

  useEffect(() => {
    if (minutes !== null) setRemaining(minutes * 60);
  }, [minutes]);

  // Starts on its own once the duration is known — no manual "开始" step.
  useEffect(() => {
    if (minutes !== null && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setRunning(true);
    }
  }, [minutes]);

  const handleComplete = useCallback(async () => {
    if (completing || minutes === null) return;
    setCompleting(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
    try {
      await completeBlankPractice(id, minutes);
      navigate("/");
    } finally {
      setCompleting(false);
    }
  }, [completing, minutes, id, navigate]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          handleComplete();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, handleComplete]);

  if (minutes === null) {
    return (
      <div className="study"><div className="empty">加载中…</div></div>
    );
  }

  const totalSeconds = minutes * 60;
  const pct = totalSeconds > 0 ? Math.min(100, ((totalSeconds - remaining) / totalSeconds) * 100) : 0;

  return (
    <div className="study items-center justify-center" style={{ background: "#14301f", color: "#e6f7ee" }}>
      <button
        onClick={() => navigate("/")}
        className="absolute top-4 left-4 text-sm opacity-80"
      >
        ← 返回
      </button>

      <p className="text-lg mb-2" style={{ color: "#7ed9a8" }}>📝 空白练习</p>
      <div className="text-7xl font-mono font-bold mb-6 tabular-nums">{formatClock(remaining)}</div>

      <div className="w-64 h-1.5 rounded-full overflow-hidden mb-8" style={{ background: "rgba(61,191,122,0.25)" }}>
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: "var(--leaf)" }} />
      </div>

      <div className="flex items-center gap-4">
        {running ? (
          <button onClick={() => setRunning(false)} className="primary">
            暂停
          </button>
        ) : (
          <button
            onClick={() => setRunning(true)}
            disabled={remaining <= 0 || completing}
            className="primary disabled:opacity-50"
          >
            继续
          </button>
        )}
      </div>
    </div>
  );
}
