import { useEffect, useState } from "react";
import {
  bindPlanTag, createTag, deleteTag, listTags, unbindPlanTag, updateTag,
} from "../api/tags";
import type { Plan, Tag } from "../types";

export const TAG_COLORS = [
  "#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#fb923c", "#e879f9",
  "#22d3ee",
];

export function uniqueTags(plans: Plan[]): Tag[] {
  const map = new Map<number, Tag>();
  for (const plan of plans) {
    for (const tag of plan.tags ?? []) map.set(tag.id, tag);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export function parseTagIdsParam(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function planMatchesTags(plan: Plan | undefined, selectedIds: number[]): boolean {
  if (selectedIds.length === 0) return true;
  if (!plan) return false;
  const ids = new Set((plan.tags ?? []).map((t) => t.id));
  return selectedIds.some((id) => ids.has(id));
}

export function TagChip({
  tag,
  selected,
  onClick,
  onRemove,
}: {
  tag: Tag;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const muted = selected === false;
  const className = `inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
    onClick ? "cursor-pointer" : ""
  } ${muted ? "opacity-50 hover:opacity-80" : ""}`;
  const style = {
    backgroundColor: `${tag.color}22`,
    color: tag.color,
    borderColor: `${tag.color}${selected === false ? "40" : "80"}`,
  };

  const inner = (
    <>
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="text-[10px] leading-none opacity-70 hover:opacity-100"
          title="取消绑定"
        >
          ×
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} style={style} title={tag.name}>
        {inner}
      </button>
    );
  }
  return (
    <span className={className} style={style} title={tag.name}>
      {inner}
    </span>
  );
}

export function TagFilterBar({
  tags,
  selectedIds,
  onChange,
}: {
  tags: Tag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  if (tags.length === 0) return null;

  const toggle = (id: number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-4">
      <span className="text-xs text-gray-500 shrink-0">标签</span>
      <button
        type="button"
        onClick={() => onChange([])}
        className={`px-2 py-0.5 rounded-full text-[11px] border transition-all ${
          selectedIds.length === 0
            ? "bg-sky-900/40 text-sky-300 border-sky-700"
            : "bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-500"
        }`}
      >
        全部
      </button>
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          selected={selectedIds.includes(tag.id)}
          onClick={() => toggle(tag.id)}
        />
      ))}
    </div>
  );
}

function ColorDots({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-4 h-4 rounded-full border transition-all ${
            value === c ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"
          }`}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  );
}

export function TagEditor({
  planId,
  boundTags,
  editable,
  onChange,
}: {
  planId: number;
  boundTags: Tag[];
  editable: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boundIds = new Set(boundTags.map((t) => t.id));

  const refreshAll = async () => {
    setAllTags(await listTags());
  };

  useEffect(() => {
    if (expanded) {
      refreshAll().catch((e) => setError(String(e)));
    }
  }, [expanded]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
      if (expanded) await refreshAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      const tag = await createTag(name, newColor);
      await bindPlanTag(planId, tag.id);
      setNewName("");
      setNewColor(TAG_COLORS[(allTags.length + 1) % TAG_COLORS.length]);
    });
  };

  const handleSaveEdit = async () => {
    if (editingId == null) return;
    const name = editName.trim();
    if (!name) return;
    await run(async () => {
      await updateTag(editingId, name, editColor);
      setEditingId(null);
    });
  };

  if (!editable && boundTags.length === 0) return null;

  return (
    <div className="mt-3 mb-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {boundTags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            onRemove={editable ? () => { run(() => unbindPlanTag(planId, tag.id)); } : undefined}
          />
        ))}
        {editable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="px-2 py-0.5 rounded-full text-[11px] border border-dashed border-gray-600 text-gray-400 hover:border-sky-600 hover:text-sky-300 transition-colors"
          >
            {expanded ? "收起" : boundTags.length > 0 ? "管理标签" : "+ 添加标签"}
          </button>
        )}
      </div>

      {editable && expanded && (
        <div className="mt-2 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg space-y-3">
          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="space-y-1.5">
            <div className="text-[10px] text-gray-500">点击标签绑定到此计划，可编辑或删除全局标签</div>
            {allTags.length === 0 && (
              <p className="text-xs text-gray-500">还没有标签，先在下方新建</p>
            )}
            {allTags.map((tag) => {
              const bound = boundIds.has(tag.id);
              if (editingId === tag.id) {
                return (
                  <div key={tag.id} className="flex items-center gap-2 flex-wrap px-2 py-1.5 bg-gray-900/60 rounded-lg">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); }}
                      maxLength={20}
                      autoFocus
                      className="flex-1 min-w-[6rem] bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500"
                    />
                    <ColorDots value={editColor} onChange={setEditColor} />
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={busy}
                      className="text-[10px] px-2 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-[10px] px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                    >
                      取消
                    </button>
                  </div>
                );
              }
              return (
                <div key={tag.id} className="flex items-center gap-2 px-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => bound ? unbindPlanTag(planId, tag.id) : bindPlanTag(planId, tag.id))}
                    className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-all ${
                      bound
                        ? "bg-gray-700/60 border-gray-500"
                        : "bg-gray-900/30 border-gray-800 hover:border-gray-600"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-xs text-gray-200 truncate">{tag.name}</span>
                    {bound && <span className="ml-auto text-[10px] text-sky-400 shrink-0">已绑定</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditName(tag.name);
                      setEditColor(tag.color);
                      setError(null);
                    }}
                    className="text-[10px] px-1.5 py-1 text-gray-400 hover:text-gray-200"
                    title="修改"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`删除标签「${tag.name}」？所有计划上的此标签都会被移除。`)) return;
                      run(async () => {
                        await deleteTag(tag.id);
                        if (editingId === tag.id) setEditingId(null);
                      });
                    }}
                    className="text-[10px] px-1.5 py-1 text-red-400/80 hover:text-red-300"
                    title="删除"
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-gray-700/60 space-y-2">
            <div className="text-[10px] text-gray-500">新建标签并绑定到此计划</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                maxLength={20}
                placeholder="标签名"
                className="flex-1 min-w-[8rem] bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy || !newName.trim()}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
              >
                添加
              </button>
            </div>
            <ColorDots value={newColor} onChange={setNewColor} />
          </div>
        </div>
      )}
    </div>
  );
}
