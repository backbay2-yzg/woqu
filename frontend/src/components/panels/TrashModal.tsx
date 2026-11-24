import React, { useEffect, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Page } from '@/types';

interface TrashModalProps {
  open: boolean;
  onClose: () => void;
}

export const TrashModal: React.FC<TrashModalProps> = ({ open, onClose }) => {
  const loadTree = useAppStore((s) => s.loadTree);
  const openPage = useAppStore((s) => s.openPage);
  const [items, setItems] = useState<Page[]>([]);

  const load = async () => {
    const list = await api.getTrashPages();
    setItems(list);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Trash2 className="w-4 h-4 text-rose-500" />
            <span>回收站 ({items.length})</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {items.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-12">回收站为空</div>
          ) : (
            items.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-slate-100 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium flex items-center gap-1.5 truncate">
                    <span>{p.icon || '📄'}</span>
                    <span className="truncate">{p.title}</span>
                  </div>
                  {p.trashed_at && (
                    <div className="text-[10px] text-slate-400">
                      删除于 {p.trashed_at.slice(0, 16).replace('T', ' ')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await api.restorePage(p.id);
                      await loadTree();
                      await load();
                      await openPage(p.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 text-xs hover:bg-blue-100"
                  >
                    <RotateCcw className="w-3 h-3" />
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`确认彻底删除《${p.title}》？此操作不可撤销。`)) return;
                      await api.permanentDeletePage(p.id);
                      await load();
                    }}
                    className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs"
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
