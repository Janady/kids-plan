import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getDailyStats, getOverallStats, getTodayHourlyStats, getPlanTimeStats } from "../api/stats";
import { getTodayDistribution } from "../api/sessions";
import { listPlans } from "../api/plans";
import type { DayStat, OverallStats, Plan, DistributionSegment, PlanTimeStat, StatsRange } from "../types";

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

interface ChartBar {
  label: string;
  tooltip: string;
  seconds: number;
}

// day: today's 24 hours. week: this week Sun-Sat (the week containing today).
// month: the last 30 days ending today.
function buildBars(dataMap: Map<string, number>, hourlyStats: number[], mode: StatsRange): ChartBar[] {
  const today = new Date();

  if (mode === "day") {
    // Label every 3rd hour to avoid crowding 24 bars into one row
    return hourlyStats.map((seconds, hour) => ({
      label: hour % 3 === 0 ? `${hour}时` : "",
      tooltip: `${hour}:00-${hour + 1}:00`,
      seconds,
    }));
  }

  if (mode === "week") {
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const key = isoDate(d);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      return { label, tooltip: label, seconds: dataMap.get(key) ?? 0 };
    });
  }

  // month — last 30 days. Label every 5th day to avoid crowding 30 bars into one row.
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 29 + i);
    const key = isoDate(d);
    const tooltip = `${d.getMonth() + 1}/${d.getDate()}`;
    return { label: i % 5 === 0 ? tooltip : "", tooltip, seconds: dataMap.get(key) ?? 0 };
  });
}

function fmtBarLabel(s: number): string {
  if (s <= 0) return "";
  if (s < 3600) return `${Math.round(s / 60)}分`;
  const h = s / 3600;
  // Show one decimal only when it isn't a whole hour
  return Number.isInteger(h) ? `${h}时` : `${h.toFixed(1)}时`;
}

function BarChart({ bars }: { bars: ChartBar[] }) {
  const maxSec = Math.max(...bars.map((b) => b.seconds), 1);

  return (
    // Fixed inner-bar height (112px) drives layout; pt-5 leaves room for labels
    <div className="flex items-end gap-1 w-full pt-5">
      {bars.map((bar, i) => {
        const h = Math.round((bar.seconds / maxSec) * 112);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex items-end justify-center" style={{ height: 112 }}>
              <div
                className="w-full max-w-[28px] bg-sky-600 hover:bg-sky-500 rounded-t transition-all"
                style={{ height: h || 2 }}
                title={`${bar.tooltip}: ${fmtDuration(bar.seconds)}`}
              />
              {bar.seconds > 0 && (
                <div className="absolute -top-4 text-[9px] font-medium text-sky-300 whitespace-nowrap">
                  {fmtBarLabel(bar.seconds)}
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

// ─── Today's activity timeline ─────────────────────────────────────────────────

function TodayTimeline({ segments }: { segments: DistributionSegment[] }) {
  const dayStartMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const pctOfDay = (iso: string) =>
    Math.min(100, Math.max(0, ((new Date(iso).getTime() - dayStartMs) / DAY_MS) * 100));

  const hourMarks = [0, 6, 12, 18, 24];

  return (
    <div>
      <div className="relative h-6 bg-gray-900 rounded-lg overflow-hidden">
        {segments.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
            今天还没有观看记录
          </div>
        ) : (
          segments.map((seg, i) => {
            const left = pctOfDay(seg.start);
            const right = pctOfDay(seg.end);
            const width = Math.max(right - left, 0.3);
            return (
              <div
                key={i}
                title={`${new Date(seg.start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} - ${new Date(seg.end).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`}
                className="absolute top-0 h-full bg-sky-500 hover:bg-sky-400 transition-colors"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-gray-600">
        {hourMarks.map((h) => (
          <span key={h}>{h}:00</span>
        ))}
      </div>
    </div>
  );
}

// ─── Per-plan time list ─────────────────────────────────────────────────────────

function PlanTimeList({ stats }: { stats: PlanTimeStat[] }) {
  if (stats.length === 0) {
    return <p className="text-xs text-gray-600 py-2">暂无数据</p>;
  }
  const maxSec = Math.max(...stats.map((s) => s.seconds), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {stats.map((s) => (
        <div key={s.plan_id} className="flex items-center gap-3">
          <span className="text-sm text-gray-300 truncate w-24 shrink-0">{s.plan_name}</span>
          <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-600 rounded-full"
              style={{ width: `${Math.max((s.seconds / maxSec) * 100, 2)}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 w-16 text-right shrink-0">{fmtDuration(s.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const navigate = useNavigate();
  const [dailyStats, setDailyStats] = useState<DayStat[]>([]);
  const [hourlyStats, setHourlyStats] = useState<number[]>(Array(24).fill(0));
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [completedPlans, setCompletedPlans] = useState<Plan[]>([]);
  const [todaySegments, setTodaySegments] = useState<DistributionSegment[]>([]);
  const [planStats, setPlanStats] = useState<PlanTimeStat[]>([]);
  const [viewMode, setViewMode] = useState<StatsRange>("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getDailyStats(),
      getOverallStats(),
      listPlans(),
      getTodayDistribution(),
      getTodayHourlyStats(),
    ]).then(([daily, stats, plans, segments, hourly]) => {
      setDailyStats(daily);
      setOverall(stats);
      setCompletedPlans(plans.filter((p) => p.status === "completed"));
      setTodaySegments(segments);
      setHourlyStats(hourly);
      setLoading(false);
    });
  }, []);

  // Shared by the bar chart and the per-plan list, so both switch together.
  useEffect(() => {
    getPlanTimeStats(viewMode).then(setPlanStats);
  }, [viewMode]);

  const dataMap = new Map(dailyStats.map((d) => [d.date_key, d.total_seconds]));
  const bars = buildBars(dataMap, hourlyStats, viewMode);

  if (loading) return <div className="text-center text-gray-500 py-20">加载中…</div>;

  const rangeLabel = (m: StatsRange) => (m === "day" ? "日" : m === "week" ? "周" : "月");

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

      {/* Today's activity timeline */}
      <section className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">今日观看时段分布</h2>
        <TodayTimeline segments={todaySegments} />
      </section>

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
                {rangeLabel(m)}
              </button>
            ))}
          </div>
        </div>
        <BarChart bars={bars} />

        {/* Per-plan breakdown for the same range */}
        <div className="mt-6 pt-5 border-t border-gray-700">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            各计划用时（{viewMode === "day" ? "今日" : viewMode === "week" ? "近7天" : "近30天"}）
          </h3>
          <PlanTimeList stats={planStats} />
        </div>
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
