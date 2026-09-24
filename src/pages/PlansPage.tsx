import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { addPlan, listPlans } from "../api/plans";
import { getSetting } from "../api/settings";
import { useAppContext } from "../context/AppContext";
import { useCastListRefresh } from "../hooks/useCastListRefresh";
import { usePlatform } from "../hooks/usePlatform";
import { FolderPickerModal } from "../components/FolderPickerModal";
import { PlanCard } from "../components/PlanCard";
import { parseTagIdsParam, planMatchesTags, TagFilterBar, uniqueTags } from "../components/Tags";
import { ping } from "../ui/toast";
import type { Plan } from "../types";

const PAGE_SIZE = 6;

export default function PlansPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isParentMode } = useAppContext();
  const { isAndroid } = usePlatform();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [scanRoot, setScanRoot] = useState<string>("");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedTagIds = parseTagIdsParam(searchParams.get("tags"));

  useEffect(() => {
    getSetting("scan_root_dir").then((v) => {
      if (v) setScanRoot(v);
    });
  }, []);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      setPlans(await listPlans());
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  const refreshCastLists = useCallback(() => loadData({ silent: true }), [loadData]);
  useCastListRefresh(refreshCastLists);

  const filterTags = uniqueTags(plans);
  const filteredPlans = selectedTagIds.length === 0 ? plans : plans.filter((p) => planMatchesTags(p, selectedTagIds));
  const totalPages = Math.max(1, Math.ceil(filteredPlans.length / PAGE_SIZE));
  const currentPage = loading ? page : Math.min(page, totalPages);
  const pagePlans = filteredPlans.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (loading || page === currentPage) return;
    const next: Record<string, string> = {};
    if (currentPage > 1) next.page = String(currentPage);
    if (selectedTagIds.length > 0) next.tags = selectedTagIds.join(",");
    setSearchParams(next, { replace: true });
  }, [loading, page, currentPage, selectedTagIds, setSearchParams]);

  const doAddPlan = async (folderPath: string) => {
    setAdding(true);
    setAddError(null);
    try {
      const report = await addPlan(folderPath);
      const parts = [`发现 ${report.found} 个媒体文件`, `新增 ${report.added} 个`];
      if (report.skipped > 0) {
        const names = report.skipped_names.slice(0, 5).join("、");
        const more = report.skipped_names.length < report.skipped ? " 等" : "";
        parts.push(`${report.skipped} 个已被其它计划收录（${names}${more}）`);
      }
      ping(parts.join("，"));
      navigate(`/plan/${report.plan.id}`, { state: { scanNotice: parts.join("，") } });
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleAddPlan = async () => {
    if (isAndroid) {
      setShowFolderPicker(true);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: scanRoot || undefined,
      });
      if (selected) await doAddPlan(String(selected));
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const setParams = (nextPage: number, tagIds: number[]) => {
    const next: Record<string, string> = {};
    if (nextPage > 1) next.page = String(nextPage);
    if (tagIds.length > 0) next.tags = tagIds.join(",");
    setSearchParams(next);
  };

  const goPage = (next: number) => {
    setParams(next, selectedTagIds);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      {showFolderPicker && (
        <FolderPickerModal
          initialPath={scanRoot || undefined}
          onSelect={(path) => {
            setShowFolderPicker(false);
            doAddPlan(path);
          }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}

      <header className="month-head">
        <div>
          <div className="kicker">
            {plans.length > 0
              ? `共 ${plans.length} 个${selectedTagIds.length > 0 ? ` · 筛选出 ${filteredPlans.length} 个` : ""}`
              : "添加文件夹后即可开始"}
          </div>
          <h1>计划</h1>
        </div>
        <button className="text-btn" onClick={handleAddPlan} disabled={adding}>
          {adding ? "选择中…" : "添加"}
        </button>
      </header>

      {addError && <p className="warn mb-3">{addError}</p>}

      {!loading && filterTags.length > 0 && (
        <TagFilterBar tags={filterTags} selectedIds={selectedTagIds} onChange={(ids) => setParams(1, ids)} />
      )}

      {loading && <div className="empty">加载中…</div>}

      {!loading && plans.length === 0 && (
        <div className="card empty">
          <p className="text-3xl mb-3">📋</p>
          <p className="font-semibold text-ink mb-1">还没有学习计划</p>
          <p className="hint" style={{ paddingTop: 8 }}>
            选择一个视频或音频文件夹，添加后会进入配置页
          </p>
          <button className="primary" onClick={handleAddPlan} disabled={adding}>
            {adding ? "选择中…" : "添加计划"}
          </button>
        </div>
      )}

      {!loading && plans.length > 0 && filteredPlans.length === 0 && (
        <div className="card empty">
          <p className="font-semibold text-ink mb-1">没有带该标签的计划</p>
          <p className="hint" style={{ paddingTop: 8 }}>
            试试其它标签，或点「全部」查看所有计划
          </p>
        </div>
      )}

      {!loading && pagePlans.length > 0 && (
        <div className="flex flex-col gap-3">
          {pagePlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button className="text-btn" onClick={() => goPage(currentPage - 1)} disabled={currentPage <= 1}>
            上一页
          </button>
          <span className="text-sm text-mute">
            {currentPage} / {totalPages}
          </span>
          <button className="text-btn" onClick={() => goPage(currentPage + 1)} disabled={currentPage >= totalPages}>
            下一页
          </button>
        </div>
      )}

      {!isParentMode && plans.length > 0 && (
        <p className="hint">儿童模式可点开已学内容。配置计划请切换到家长模式。</p>
      )}
    </div>
  );
}
