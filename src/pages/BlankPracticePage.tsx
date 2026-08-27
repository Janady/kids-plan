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
      <div className="flex items-center justify-center py-32 text-gray-500">加载中…</div>
    );
  }

  const totalSeconds = minutes * 60;
  const pct = totalSeconds > 0 ? Math.min(100, ((totalSeconds - remaining) / totalSeconds) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-emerald-950 flex flex-col items-center justify-center text-emerald-100 z-[45]">
      <button
        onClick={() => navigate("/")}
        className="absolute top-4 left-4 text-emerald-400 hover:text-emerald-200 text-sm transition-colors"
      >
        ← 返回
      </button>

      <p className="text-emerald-400 text-lg mb-2">📝 空白练习</p>
      <div className="text-7xl font-mono font-bold mb-6 tabular-nums">{formatClock(remaining)}</div>

      <div className="w-64 h-1.5 bg-emerald-900/60 rounded-full overflow-hidden mb-8">
        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center gap-4">
        {running ? (
          <button
            onClick={() => setRunning(false)}
            className="px-6 py-3 bg-emerald-800 hover:bg-emerald-700 rounded-lg text-white font-medium transition-colors"
          >
            暂停
          </button>
        ) : (
          <button
            onClick={() => setRunning(true)}
            disabled={remaining <= 0 || completing}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
          >
            继续
          </button>
        )}
      </div>
    </div>
  );
}
