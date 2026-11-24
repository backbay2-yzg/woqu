import React, { useEffect, useState } from 'react';
import { History, Plus, RotateCcw, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { PageVersion } from '@/types';
import { BlockEditor } from '../editor/BlockEditor';

interface VersionHistoryModalProps {
  open: boolean;
  pageId: string;
  onClose: () => void;
  onRestored: () => Promise<void>;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  open,
  pageId,
  onClose,
  onRestored,
}) => {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [restoring, setRestoring] = useState(false);

  const load = async () => {
    const list = await api.listVersions(pageId);
    setVersions(list);
    if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
  };

  useEffect(() => {
    if (open && pageId) void load();
  }, [open, pageId]);

  if (!open) return null;

  const selected = versions.find((v) => v.id === selectedId) || versions[0];

  const sourceBadge = (src: string) => {
    switch (src) {
      case 'pre_ai':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
      case 'manual':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400';
    }
  };

  const sourceLabel = (src: string) => {
    switch (src) {
      case 'pre_ai':
        return 'AI修改前快照';
      case 'manual':
        return '手动快照';
      case 'pre_restore':
        return '回滚前备份';
      default:
        return '自动保存';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[82vh] rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="w-4 h-4 text-blue-600" />
            <span>页面历史版本与快照</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await api.createVersion(pageId, '手动保存快照');
                await load();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Plus className="w-3.5 h-3.5" />
              保存当前快照
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          <div className="md:col-span-4 border-r border-slate-200 dark:border-zinc-800 overflow-y-auto p-3 space-y-1.5">
            {versions.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-8">暂无历史版本</div>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition space-y-1 ${
                    selected?.id === v.id
                      ? 'border-blue-400 bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceBadge(v.source)}`}>
                      {sourceLabel(v.source)}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {v.created_at.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                  <div className="text-xs font-medium truncate">{v.title}</div>
                  {v.note && <div className="text-[11px] text-slate-400 truncate">{v.note}</div>}
                </button>
              ))
            )}
          </div>

          <div className="md:col-span-8 flex flex-col min-h-0">
            {selected ? (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50">
                  <div className="text-sm font-semibold truncate">{selected.title}</div>
                  <button
                    type="button"
                    disabled={restoring}
                    onClick={async () => {
                      setRestoring(true);
                      try {
                        await api.restoreVersion(pageId, selected.id);
                        await onRestored();
                        onClose();
                      } finally {
                        setRestoring(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {restoring ? '恢复中...' : '一键恢复到此版本'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <BlockEditor
                    key={selected.id}
                    pageId={selected.id}
                    initialContent={selected.content_json}
                    editable={false}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                选择左侧历史快照预览内容
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
