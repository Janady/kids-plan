# 观看时长/连续观看重构：watch_sessions → watch_ticks

## 目标

用"3秒心跳 tick"取代当前"play→pause 才一次性 flush 一整段"的记录方式：
- 今日时长 = 当天所有 tick 数 × 3（含尾段特殊处理）
- 连续观看 = 把 tick 按时间间隔分段，取"当前未被打断的最后一段"的 tick 数 × 3，与阈值比较，完全在后端计算，不再依赖前端 localStorage 时间戳
- 新增"今日时间分布图"：把间隔很小的连续 tick 合并成色块，在 StatsPage 或 HomePage 展示今日观看时间段分布
- `watch_sessions` 表整体废弃，替换为 `watch_ticks`；旧数据做一次性迁移（按 seconds_watched 展开成等间隔 tick，尽量贴近 started_at~ended_at 区间）

## 数据库改动 (`src-tauri/migrations/007_watch_ticks.sql`)

```sql
CREATE TABLE watch_ticks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id  INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    date_key  TEXT NOT NULL,
    tick_at   TEXT NOT NULL  -- ISO 8601 UTC 时间戳，播放时刻
);

CREATE INDEX idx_ticks_date  ON watch_ticks(date_key);
CREATE INDEX idx_ticks_video ON watch_ticks(video_id);
CREATE INDEX idx_ticks_time  ON watch_ticks(tick_at);

-- 迁移旧数据：每条 watch_session 按 3 秒一个 tick 展开，均匀分布在 started_at~ended_at 之间
-- 用 SQLite recursive CTE 生成 tick 序列（每条 session 生成 seconds_watched/3 个整数索引，再用 julianday 插值算时间戳）
INSERT INTO watch_ticks (video_id, date_key, tick_at)
SELECT
  ws.video_id,
  ws.date_key,
  datetime(
    julianday(ws.started_at) +
    (julianday(ws.ended_at) - julianday(ws.started_at)) *
      (CAST(n.value AS REAL) / MAX(ws.seconds_watched / 3, 1))
  )
FROM watch_sessions ws
JOIN (
  WITH RECURSIVE seq(value) AS (
    SELECT 0 UNION ALL SELECT value + 1 FROM seq WHERE value < 1200 -- 覆盖单段最长1小时(1200*3s)
  )
  SELECT value FROM seq
) n ON n.value < MAX(ws.seconds_watched / 3, 1);

DROP TABLE watch_sessions;
```

说明：
- 迁移生成的旧 tick 是"均匀插值"的近似值，不是真实播放心跳，仅用于保留历史总时长和分布图的大致形状（用户已认可这个折中）。
- 索引上限 1200（对应 3600 秒/3）足够覆盖绝大多数单段时长；极端超长段（>1小时不中断）会被截断，可接受。

## 后端改动 (`src-tauri/src/commands/sessions.rs`)

删除 `WatchSessionInput` / `record_watch_session`，新增：

```rust
#[tauri::command]
pub async fn record_watch_tick(state: State<'_, AppState>, video_id: i64) -> Result<(), String> {
    let now = Utc::now();
    sqlx::query("INSERT INTO watch_ticks (video_id, date_key, tick_at) VALUES (?, ?, ?)")
        .bind(video_id)
        .bind(now.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .bind(now.to_rfc3339())
        .execute(&state.db).await...
}
```

- `get_today_watched_seconds` / `get_today_audio_seconds` / `check_daily_limit`：把 `SUM(seconds_watched)` 改成 `COUNT(*) * 3`，JOIN 条件不变（仍按 `media_type` 过滤）。
- 新增 `get_continuous_watch_seconds(rest_gap_seconds: i64) -> i64`：
  - 查当天所有 `watch_ticks`（不分 video_id，因为连续观看是"持续用眼"）按 `tick_at` DESC 排序
  - 从最新一条开始向前扫描，只要相邻两条间隔 ≤ `rest_gap_seconds` 就累加，遇到超过 `rest_gap_seconds` 的间隔就停止
  - 返回累加的 tick 数 × 3；如果最新一条 tick 本身距"现在"已经超过 `rest_gap_seconds`，直接返回 0（说明已经在休息，连续计时已断）
  - `rest_gap_seconds` 作为参数传入，从前端读取 settings 里的新配置项（见下）
- 新增 `get_today_distribution() -> Vec<(String, String)>`：返回当天按"tick 间隔 ≤ 4秒"合并后的时间段列表 `[(start_iso, end_iso), ...]`，用于分布图。合并逻辑在 SQL 里做有点复杂，用 Rust 遍历一次当天全部 tick（按时间排序）更直接：连续 tick 间隔 ≤ 4s 就延长当前段，否则开新段。
- `stats.rs` 的 `get_daily_stats` / `get_overall_stats`：`SUM(seconds_watched)` 改成 `COUNT(*) * 3`，表名 `watch_sessions` → `watch_ticks`，`COUNT(DISTINCT video_id)` 不变。

## Settings 新增配置项

- `rest_gap_seconds`（新）：判定"连续观看被打断"的间隔阈值，替代前端硬编码的 5 分钟。默认给 300（5分钟），单位仍按分钟展示在 UI，存秒。
  - SettingsPage 里"护眼休息提醒"区块加一个"暂停多久算中断"输入框
- 沿用现有 `max_continuous_minutes`、`break_duration_minutes`、`daily_limit_seconds`

## 前端改动

**`src/hooks/useWatchSession.ts`** 重写为心跳模式：
- `startSession()`：立即调用一次 `record_watch_tick`，然后 `setInterval(..., 3000)` 每 3 秒 tick 一次
- `pauseSession()` / `endSession()`：`clearInterval`，不再有"尾段计算"逻辑——因为每个 tick 已经代表"确认看了3秒"，中途暂停时最后不足3秒的部分本来就还没产生 tick，天然被丢弃，不需要额外的 `<3秒不计入` 判断
- 移除 `sessionStartRef` 的时间差计算，改为 `intervalRef`
- `refreshTodayTotal()` 仍在每次 tick 后可选调用，但改成每次 tick 后调用一次即可（不用等 pause）——这样"今日已看时长"能实时增长而不是等暂停才更新

**`src/api/sessions.ts`**：
- 替换 `recordWatchSession` → `recordWatchTick(videoId: number)`
- 新增 `getContinuousWatchSeconds(restGapSeconds: number)`、`getTodayDistribution()`

**`src/context/AppProvider.tsx`** 连续观看逻辑迁移到后端驱动：
- 删除 `continuousStartRef` / `pauseResetTimerRef` / localStorage `continuousStart` 相关的全部逻辑（`notifyVideoPlay`/`notifyVideoPause` 不再需要维护起始时间戳）
- 改为：播放期间用一个 1 秒 `setInterval` 定期调用 `getContinuousWatchSeconds(restGapSeconds)` 查询后端，返回值 ≥ `maxContinuousSeconds` 就触发 `isBreakRequired`
  - 注意频率：1秒查一次 SQLite 本地查询，量级很小（当天 tick 最多几千条），可接受；也可以放宽到每 3 秒查一次和 tick 频率对齐，减少查询次数
- `notifyVideoPlay`/`notifyVideoPause` 简化为只负责"是否需要启动/停止那个 1秒轮询定时器"，不再自己算 elapsed
- 新增 `restGapSeconds` state，从 settings 读取/保存（`saveBreakSettings` 增加一个参数）
- `AppContext.tsx` 接口同步增加 `restGapSeconds`、更新 `saveBreakSettings` 签名

**`src/pages/SettingsPage.tsx`**：护眼休息区块新增"暂停多久算中断"输入框，绑定 `restGapSeconds`

**`src/pages/StatsPage.tsx`** 或 **`src/pages/HomePage.tsx`** 新增今日时间分布图：
- 简单实现：一条 24 小时的横向时间轴（0:00-24:00），用色块标出 `getTodayDistribution()` 返回的每个时间段
- 放在 StatsPage 顶部（因为这是"统计"性质的展示，HomePage 已经很拥挤）

**类型定义 (`src/types/index.ts`)**：
- 删除 `WatchSessionInput`
- 新增 `DistributionSegment { start: string; end: string }`（或直接用 tuple）

## lib.rs invoke_handler

移除 `record_watch_session`，新增 `record_watch_tick`、`get_continuous_watch_seconds`、`get_today_distribution`

## 验证计划

1. `cargo build`（src-tauri）确认 Rust 编译通过，migration SQL 语法正确（用 sqlx 的 offline check 或直接跑一次本地 db 文件验证 migration 能跑通）
2. `bun run build` / `tsc --noEmit` 确认前端类型检查通过
3. 手动跑一次 Tauri dev，播放一个视频验证：
   - tick 是否按 3 秒稳定发出（今日时长应平滑增长而不是等暂停才跳一大段）
   - 暂停超过 `rest_gap_seconds` 后再播放，连续观看计时是否重新从 0 开始，而不是继续累加暂停前的量
   - 暂停时间小于 `rest_gap_seconds` 时，连续观看是否正确累加两段播放时间（而不是像现在这样把暂停的墙钟时间也算进去）
   - 达到 `maxContinuousSeconds` 后是否正确触发强制休息
4. 清理迁移过程中产生的任何临时验证数据/脚本

## 风险与取舍（已与用户确认）

- 旧 `watch_sessions` 历史数据通过均匀插值转换为近似 tick，分布图对历史数据不完全真实，但总时长统计保持准确。
- 连续观看轮询查询 SQLite 频率从"纯前端内存计算"变为"每秒一次真实 DB 查询"，增加了少量 IO，但换来了正确性（不再受墙钟时间污染）和可配置的中断阈值。
