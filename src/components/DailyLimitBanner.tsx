import { useAppContext } from "../context/AppContext";

export function DailyLimitBanner() {
  const { isLimitExceeded, todayWatchedSeconds, dailyLimitSeconds } = useAppContext();
  if (!isLimitExceeded) return null;

  const overBy = todayWatchedSeconds - dailyLimitSeconds;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m} 分钟` : `${s} 秒`;
  };

  return <div className="banner limit">今日学习时长已达上限（超出 {fmt(overBy)}），视频已全部锁定。明天再来吧！</div>;
}
