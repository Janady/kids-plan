import { useState, useEffect, useRef } from "react";
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

function fmtHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}小时`);
  if (h > 0 || m > 0) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join("");
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
    if (s === 0) return "#f3e2c8";
    if (s < 900) return "#c8efd8";
    if (s < 1800) return "#7ed9a8";
    if (s < 3600) return "#3dbf7a";
    return "#2a9a5e";
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-1 min-w-max">
        {/* Day labels */}
        <div className="flex flex-col gap-1 mr-1">
          <div className="h-4" />
          {dayLabels.map((l) => (
            <div key={l} className="h-4 flex items-center text-[10px] text-mute w-4 justify-center">
              {l}
            </div>
          ))}
        </div>

        {/* Week columns */}
        {cols.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {/* Month label on first day of month */}
            <div className="h-4 text-[10px] text-mute text-center">
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
                  style={{ background: isFuture ? "#fff4e5" : color(secs), opacity: isFuture ? 0.3 : 1 }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-mute">
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
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - 6 + i);
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
                className="w-full max-w-[28px] rounded-t transition-all"
                style={{ background: "var(--accent)", height: h || 2 }}
                title={`${bar.tooltip}: ${fmtDuration(bar.seconds)}`}
              />
              {bar.seconds > 0 && (
                <div className="absolute -top-4 text-[9px] font-medium text-accent whitespace-nowrap">
                  {fmtBarLabel(bar.seconds)}
                </div>
              )}
            </div>
            <span className="text-[9px] text-mute whitespace-nowrap">{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Today's activity summary ─────────────────────────────────────────────────

function TodaySummary({ segments, dateKey, onDateChange }: {
  segments: DistributionSegment[];
  dateKey: string;
  onDateChange: (next: string) => void;
}) {
  const totalSeconds = segments.reduce((sum, seg) => sum + seg.seconds, 0);

  const todayKey = isoDate(new Date());
  const shiftDate = (deltaDays: number) => {
    const d = new Date(dateKey + "T00:00:00");
    d.setDate(d.getDate() + deltaDays);
    onDateChange(isoDate(d));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-semibold text-ink">
          {dateKey === todayKey ? "今日" : dateKey} 总时长 {fmtHMS(totalSeconds)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="text-mute text-sm px-2 py-1 rounded"
          >
            ‹
          </button>
          <input
            type="date"
            value={dateKey}
            max={todayKey}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="field-input h-9 text-sm"
          />
          <button
            onClick={() => shiftDate(1)}
            disabled={dateKey >= todayKey}
            className="text-mute text-sm px-2 py-1 rounded disabled:opacity-30"
          >
            ›
          </button>
          {dateKey !== todayKey && (
            <button
              onClick={() => onDateChange(todayKey)}
              className="text-accent text-xs px-2 py-1 rounded"
            >
              今天
            </button>
          )}
        </div>
      </div>

      {segments.length === 0 ? (
        <div className="text-sm text-mute py-2">
          {dateKey === todayKey ? "今天还没有观看记录" : "这一天没有观看记录"}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-2">
          {segments.map((seg, i) => {
            const start = new Date(seg.start);
            const end = new Date(seg.end);
            const startTime = start.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
            const endTime = end.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

            return (
              <div key={i} className="flex items-center gap-3 text-sm text-ink">
                <span className="font-mono">{startTime} - {endTime}</span>
                <span className="text-mute">({fmtHMS(seg.seconds)})</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Per-plan time list ─────────────────────────────────────────────────────────

function PlanTimeList({ stats }: { stats: PlanTimeStat[] }) {
  if (stats.length === 0) {
    return <p className="text-xs text-mute py-2">暂无数据</p>;
  }
  const maxSec = Math.max(...stats.map((s) => s.seconds), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {stats.map((s) => (
        <div key={s.plan_id} className="flex items-center gap-3">
          <span className="text-sm text-ink truncate w-24 shrink-0">{s.plan_name}</span>
          <div className="flex-1 progress sky">
            <span style={{ width: `${Math.max((s.seconds / maxSec) * 100, 2)}%` }} />
          </div>
          <span className="text-xs text-mute w-16 text-right shrink-0">{fmtDuration(s.seconds)}</span>
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
  const [segmentsDateKey, setSegmentsDateKey] = useState(() => isoDate(new Date()));
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

  // Refetch the segment list whenever the selected date changes. Skips the
  // very first run, since the initial-load effect above already fetched today.
  const segmentsMountedRef = useRef(false);
  useEffect(() => {
    if (!segmentsMountedRef.current) {
      segmentsMountedRef.current = true;
      return;
    }
    getTodayDistribution(segmentsDateKey).then(setTodaySegments);
  }, [segmentsDateKey]);

  // Shared by the bar chart and the per-plan list, so both switch together.
  useEffect(() => {
    getPlanTimeStats(viewMode).then(setPlanStats);
  }, [viewMode]);

  const dataMap = new Map(dailyStats.map((d) => [d.date_key, d.total_seconds]));
  const bars = buildBars(dataMap, hourlyStats, viewMode);

  if (loading) return <div className="empty">加载中…</div>;

  const rangeLabel = (m: StatsRange) => (m === "day" ? "日" : m === "week" ? "周" : "月");

  return (
    <div>
      <header className="month-head">
        <div>
          <div className="kicker">看一看学得怎么样</div>
          <h1>统计</h1>
        </div>
      </header>

      {overall && (
        <div className="stat-grid">
          <div className="card stat">
            <div className="k">累计学习</div>
            <div className="n">{fmtDuration(overall.total_seconds)}</div>
          </div>
          <div className="card stat">
            <div className="k">看过的视频</div>
            <div className="n">{overall.videos_watched} 个</div>
          </div>
          <div className="card stat">
            <div className="k">完成的计划</div>
            <div className="n">{overall.plans_completed} 个</div>
          </div>
          <div className="card stat">
            <div className="k">学习天数</div>
            <div className="n">{overall.active_days} 天</div>
          </div>
        </div>
      )}

      <div className="section-title">观看时段</div>
      <section className="card mb-5" style={{ padding: 16 }}>
        <TodaySummary segments={todaySegments} dateKey={segmentsDateKey} onDateChange={setSegmentsDateKey} />
      </section>

      <div className="section-title">
        <span>学习时长</span>
      </div>
      <section className="card mb-5" style={{ padding: 16 }}>
        <div className="seg seg3 mb-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {(["day", "week", "month"] as const).map((m) => (
            <button key={m} className={viewMode === m ? "on" : ""} onClick={() => setViewMode(m)}>
              {rangeLabel(m)}
            </button>
          ))}
        </div>
        <BarChart bars={bars} />
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            各计划用时（{viewMode === "day" ? "今日" : viewMode === "week" ? "近7天" : "近30天"}）
          </div>
          <PlanTimeList stats={planStats} />
        </div>
      </section>

      <div className="section-title">学习日历</div>
      <section className="card mb-5" style={{ padding: 16 }}>
        <Heatmap dataMap={dataMap} />
      </section>

      {completedPlans.length > 0 && (
        <>
          <div className="section-title">已完成计划</div>
          <div className="card">
            {completedPlans.map((p) => (
              <button key={p.id} className="acc" onClick={() => navigate(`/plan/${p.id}`)}>
                <span className="acc-ico" style={{ background: "var(--good-bg)", color: "#2a7a4e" }}>
                  ✓
                </span>
                <span className="acc-main">
                  <b>{p.name}</b>
                  <small>{p.video_count} 集</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
