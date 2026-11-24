import React from 'react';
import { ListOrdered, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

interface TocPanelProps {
  onClose: () => void;
}

export const TocPanel: React.FC<TocPanelProps> = ({ onClose }) => {
  const headings = useAppStore((s) => s.activeHeadings);

  const scrollToHeading = (id: string) => {
    const el = document.querySelector(`[data-block-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#202020] border-l border-slate-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <ListOrdered className="w-4 h-4 text-blue-600" />
          <span>文档大纲 (TOC)</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {headings.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-8">
            当前页面暂无 H1 / H2 / H3 标题
          </div>
        ) : (
          headings.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => scrollToHeading(h.id)}
              style={{ paddingLeft: `${(h.level - 1) * 14 + 8}px` }}
              className="w-full text-left py-1.5 pr-2 rounded-lg text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 truncate transition"
            >
              {h.text}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
