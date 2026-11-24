import React, { useEffect, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { BacklinkItem } from '@/types';

interface BacklinksPanelProps {
  pageId: string;
  onClose: () => void;
  onNavigatePage: (pageId: string) => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  pageId,
  onClose,
  onNavigatePage,
}) => {
  const [items, setItems] = useState<BacklinkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getBacklinks(pageId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [pageId]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#202020] border-l border-slate-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Link2 className="w-4 h-4 text-emerald-600" />
          <span>反向链接 ({items.length})</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="text-xs text-slate-400 text-center py-8">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-8 leading-relaxed">
            暂无其他页面通过 <code>[[</code> 链接到当前页面
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.source_page_id}
              type="button"
              onClick={() => onNavigatePage(item.source_page_id)}
              className="w-full text-left rounded-xl border border-slate-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700 p-3 space-y-1 transition"
            >
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <span>{item.icon || '📄'}</span>
                <span className="truncate">{item.title}</span>
              </div>
              {item.excerpt && (
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-3">
                  {item.excerpt}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
