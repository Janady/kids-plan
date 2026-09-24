import { NavLink, useLocation } from "react-router-dom";
import { useAppContext } from "../context/AppContext";

export function BottomNav() {
  const { pathname } = useLocation();
  const { bgIsPlaying } = useAppContext();
  const onPlans = pathname === "/plans" || pathname.startsWith("/plan/");
  const onListen = pathname === "/listen" || pathname === "/background-audio";
  const onMe =
    pathname === "/me" ||
    pathname === "/settings" ||
    pathname === "/cleanup";

  return (
    <nav className="tabbar">
      <NavLink to="/" end className={({ isActive }) => `tab ${isActive ? "on" : ""}`}>
        <span className="tab-ico">今</span>
        今天
      </NavLink>
      <NavLink to="/plans" className={`tab ${onPlans ? "on" : ""}`}>
        <span className="tab-ico">册</span>
        计划
      </NavLink>
      <NavLink to="/listen" className={`tab-add ${onListen ? "on" : ""} ${bgIsPlaying ? "playing" : ""}`}>
        <span className="tab-add-btn">
          {bgIsPlaying && <span className="tab-add-disc" aria-hidden />}
          <span className="tab-add-mark">{bgIsPlaying ? "♪" : "听"}</span>
        </span>
        {bgIsPlaying ? "播放中" : "听"}
      </NavLink>
      <NavLink to="/stats" className={({ isActive }) => `tab ${isActive ? "on" : ""}`}>
        <span className="tab-ico">析</span>
        统计
      </NavLink>
      <NavLink to="/me" className={`tab ${onMe ? "on" : ""}`}>
        <span className="tab-ico">我</span>
        我的
      </NavLink>
    </nav>
  );
}
