import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getDailyStats, getOverallStats } from "../api/stats";
import { listPlans } from "../api/plans";
import type { DayStat, OverallStats, Plan } from "../types";

function fmtDuration(s: number): string {
  if (s === 0) return "0 分钟";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

function Heatmap({ dataMap }: { dataMap: Map<string, number> }) {
  // Show last 15 weeks × 7 days = 105 days
  const today = new Date();
  // Build columns: each column = one week, rows = Mon..Sun
  const cols: Date[][] = [];
  for (let w = 14; w >= 0; w--) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - (w * 7 + (6 - d) + (6 - today.getDay())));
      week.push(date);
    }
    cols.push(week);
  }

  const dayLabels = ["一", "二", "三", "四", "五", "六", "日"];

  const color = (s: number) => {
    if (s === 0) return "#1f2937";
    if (s < 900) return "#0c4a6e";
    if (s < 1800) return "#075985";
    if (s < 3600) return "#0369a1";
    return "#0ea5e9";
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-1 min-w-max">
        {/* Day labels */}
        <div className="flex flex-col gap-1 mr-1">
          <div className="h-4" />
          {dayLabels.map((l) => (
            <div key={l} className="h-4 flex items-center text-[10px] text-gray-600 w-4 justify-center">
              {l}
            </div>
          ))}
        </div>

        {/* Week columns */}
        {cols.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {/* Month label on first day of month */}
            <div className="h-4 text-[10px] text-gray-600 text-center">
              {week[0].getDate() <= 7 ? (week[0].getMonth() + 1) + "月" : ""}
            </div>
            {week.map((date, di) => {
              const key = isoDate(date);
              const secs = dataMap.get(key) ?? 0;
              const isFuture = date > today;
              return (
                <div
                  key={di}
                  title={`${fmtDate(date)}: ${fmtDuration(secs)}`}
                  className="w-4 h-4 rounded-sm transition-all hover:scale-125"
                  style={{ background: isFuture ? "#111827" : color(secs), opacity: isFuture ? 0.3 : 1 }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-600">
        <span>少</span>
        {[0, 900, 1800, 3600, 7200].map((s) => (
          <div key={s} className="w-3 h-3 rounded-sm" style={{ background: color(s) }} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

// ─── Bar chart ───────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";

interface ChartBar {
  label: string;
  seconds: number;
}

function buildBars(dataMap: Map<string, number>, mode: ViewMode): ChartBar[] {
  const today = new Date();

  if (mode === "day") {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - 13 + i);
      const key = isoDate(d);
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, seconds: dataMap.get(key) ?? 0 };
    });
  }

  if (mode === "week") {
    return Array.from({ length: 8 }, (_, i) => {
      let total = 0;
      const startD = new Date(today);
      startD.setDate(today.getDate() - (7 - i) * 7 + (7 - today.getDay()));
      for (let d = 0; d < 7; d++) {
        const date = new Date(startD);
        date.setDate(startD.getDate() - d);
        total += dataMap.get(isoDate(date)) ?? 0;
      }
      const weekEnd = new Date(startD);
      return { label: `${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`, seconds: total };
    });
  }

  // month
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    let total = 0;
    for (const [key, val] of dataMap) {
      if (key.startsWith(`${y}-${String(mo).padStart(2, "0")}`)) total += val;
    }
    return { label: `${mo}月`, seconds: total };
  });
}

function BarChart({ bars }: { bars: ChartBar[] }) {
  const maxSec = Math.max(...bars.map((b) => b.seconds), 1);

  return (
    <div className="flex items-end gap-1 h-32 w-full">
      {bars.map((bar, i) => {
        const h = Math.round((bar.seconds / maxSec) * 112);
        const hrs = (bar.seconds / 3600).toFixed(1);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex items-end justify-center" style={{ height: 112 }}>
              <div
                className="w-full max-w-[28px] bg-sky-600 hover:bg-sky-500 rounded-t transition-all"
                style={{ height: h || 2 }}
                title={`${bar.label}: ${fmtDuration(bar.seconds)}`}
              />
              {bar.seconds > 0 && (
                <div className="absolute -top-5 text-[9px] text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {hrs}h
                </div>
              )}
            </div>
            <span className="text-[9px] text-gray-600 whitespace-nowrap">{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const navigate = useNavigate();
  const [dailyStats, setDailyStats] = useState<DayStat[]>([]);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [completedPlans, setCompletedPlans] = useState<Plan[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getDailyStats(), getOverallStats(), listPlans()]).then(
      ([daily, stats, plans]) => {
        setDailyStats(daily);
        setOverall(stats);
        setCompletedPlans(plans.filter((p) => p.status === "completed"));
        setLoading(false);
      }
    );
  }, []);

  const dataMap = new Map(dailyStats.map((d) => [d.date_key, d.total_seconds]));
  const bars = buildBars(dataMap, viewMode);

  if (loading) return <div className="text-center text-gray-500 py-20">加载中…</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/")} className="text-gray-400 hover:text-gray-200 text-sm transition-colors">
          ← 返回
        </button>
        <h1 className="text-2xl font-bold text-gray-100">学习统计</h1>
      </div>

      {/* Summary cards */}
      {overall && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "累计学习时长", value: fmtDuration(overall.total_seconds), icon: "⏱️" },
            { label: "看过的视频", value: `${overall.videos_watched} 个`, icon: "🎬" },
            { label: "完成的计划", value: `${overall.plans_completed} 个`, icon: "✅" },
            { label: "学习天数", value: `${overall.active_days} 天`, icon: "📅" },
          ].map((c) => (
            <div key={c.label} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="text-2xl mb-2">{c.icon}</div>
              <div className="text-lg font-bold text-gray-100">{c.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bar chart */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-300">学习时长</h2>
          <div className="flex gap-1">
            {(["day", "week", "month"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  viewMode === m
                    ? "bg-sky-700 text-sky-200"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {m === "day" ? "日" : m === "week" ? "周" : "月"}
              </button>
            ))}
          </div>
        </div>
        <BarChart bars={bars} />
      </section>

      {/* Heatmap */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">学习日历</h2>
        <Heatmap dataMap={dataMap} />
      </section>

      {/* Completed plans */}
      {completedPlans.length > 0 && (
        <section className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">已完成计划 🎓</h2>
          <div className="flex flex-col gap-2">
            {completedPlans.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/plan/${p.id}`)}
                className="flex items-center gap-3 px-4 py-3 bg-green-900/20 border border-green-800/30 rounded-lg cursor-pointer hover:border-green-700/50 transition-colors"
              >
                <span className="text-green-500">✓</span>
                <span className="flex-1 text-sm text-gray-200">{p.name}</span>
                <span className="text-xs text-gray-500">{p.video_count} 集</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
