import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { addPlan, listPlans } from "../api/plans";
import { getSetting } from "../api/settings";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import { FolderPickerModal } from "../components/FolderPickerModal";
import { PlanCard } from "../components/PlanCard";
import { parseTagIdsParam, planMatchesTags, TagFilterBar, uniqueTags } from "../components/Tags";
import type { Plan } from "../types";

const PAGE_SIZE = 6;

export default function PlansPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isParentMode } = useAppContext();
  const { isTV, isAndroid } = usePlatform();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [scanRoot, setScanRoot] = useState<string>("");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedTagIds = parseTagIdsParam(searchParams.get("tags"));

  useEffect(() => {
    getSetting("scan_root_dir").then((v) => { if (v) setScanRoot(v); });
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await listPlans());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filterTags = uniqueTags(plans);
  const filteredPlans = selectedTagIds.length === 0
    ? plans
    : plans.filter((p) => planMatchesTags(p, selectedTagIds));
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

  const handleTagFilter = (ids: number[]) => {
    setParams(1, ids);
  };

  return (
    <div>
      {showFolderPicker && (
        <FolderPickerModal
          initialPath={scanRoot || undefined}
          onSelect={(path) => { setShowFolderPicker(false); doAddPlan(path); }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">全部计划</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {plans.length > 0
              ? `共 ${plans.length} 个计划${selectedTagIds.length > 0 ? ` · 筛选出 ${filteredPlans.length} 个` : ""}${isParentMode ? "" : " · 可点开已学内容"}`
              : "添加文件夹后即可开始配置"}
          </p>
        </div>
        <button
          onClick={handleAddPlan}
          disabled={adding}
          className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 rounded-lg text-sm transition-colors"
        >
          {adding ? "选择中…" : "+ 添加计划"}
        </button>
      </div>

      {addError && (
        <div className="mb-4 px-4 py-3 bg-red-900/50 border border-red-700 rounded-lg text-sm text-red-300">
          {addError}
        </div>
      )}

      {!loading && filterTags.length > 0 && (
        <TagFilterBar tags={filterTags} selectedIds={selectedTagIds} onChange={handleTagFilter} />
      )}

      {loading && (
        <div className="text-center text-gray-500 py-16">加载中…</div>
      )}

      {!loading && plans.length === 0 && (
        <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-gray-300 font-medium mb-1">还没有学习计划</p>
          <p className="text-sm text-gray-500 mb-4">选择一个视频或音频文件夹，添加后会进入配置页</p>
          <button
            onClick={handleAddPlan}
            disabled={adding}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {adding ? "选择中…" : "+ 添加计划"}
          </button>
        </div>
      )}

      {!loading && plans.length > 0 && filteredPlans.length === 0 && (
        <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-300 font-medium mb-1">没有带该标签的计划</p>
          <p className="text-sm text-gray-500">试试其它标签，或点「全部」查看所有计划</p>
        </div>
      )}

      {!loading && pagePlans.length > 0 && (
        <div className={`grid gap-4 ${isTV ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2"}`}>
          {pagePlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => goPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
          >
            上一页
          </button>
          <span className="text-sm text-gray-400">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => goPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
