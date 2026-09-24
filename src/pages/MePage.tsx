import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { PasswordModal } from "../components/PasswordModal";
import { APP_VERSION } from "../version";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}小时 ${m}分钟` : `${m}分钟`;
}

export default function MePage() {
  const navigate = useNavigate();
  const {
    isParentMode,
    toggleParentMode,
    todayWatchedSeconds,
    todayAudioSeconds,
    dailyLimitSeconds,
  } = useAppContext();
  const [showModal, setShowModal] = useState(false);
  const [modalErr, setModalErr] = useState("");

  const handleModeToggle = async () => {
    if (isParentMode) {
      await toggleParentMode();
      return;
    }
    const result = await toggleParentMode("");
    if (!result.success) {
      setModalErr("");
      setShowModal(true);
    }
  };

  const handlePasswordSubmit = async (pwd: string) => {
    const result = await toggleParentMode(pwd);
    if (result.success) {
      setShowModal(false);
      setModalErr("");
    } else {
      setModalErr(result.error ?? "密码不正确");
    }
  };

  return (
    <div>
      <header className="month-head">
        <div>
          <div className="kicker">{isParentMode ? "家长模式" : "儿童模式"}</div>
          <h1>我的</h1>
        </div>
      </header>

      <div className="card hero">
        <div className="k">今天已学</div>
        <div className="n">{formatSeconds(todayWatchedSeconds)}</div>
        <div className="hero-row">
          <span>上限 {formatSeconds(dailyLimitSeconds)}</span>
          {todayAudioSeconds > 0 && <span>音频 {formatSeconds(todayAudioSeconds)}</span>}
        </div>
      </div>

      <div className="card me-list">
        <button className="me-item" onClick={handleModeToggle}>
          <span>{isParentMode ? "切换到儿童模式" : "切换到家长模式"}</span>
          <small>{isParentMode ? "播放会计入学习" : "需要密码"}</small>
        </button>
        {isParentMode && (
          <>
            <button className="me-item" onClick={() => navigate("/settings")}>
              <span>设置</span>
              <small>时长、休息、密码</small>
            </button>
            <button className="me-item" onClick={() => navigate("/cleanup")}>
              <span>清理已学文件</span>
              <small>释放空间</small>
            </button>
          </>
        )}
      </div>

      <p className="hint">学习计划 v{APP_VERSION}</p>

      {showModal && (
        <PasswordModal
          title="切换到家长模式"
          error={modalErr}
          onConfirm={handlePasswordSubmit}
          onCancel={() => {
            setShowModal(false);
            setModalErr("");
          }}
        />
      )}
    </div>
  );
}
