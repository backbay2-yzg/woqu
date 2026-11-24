import React from 'react';
import { Plus } from 'lucide-react';
import type { DatabaseFull, Page, PropertySchema } from '@/types';
import { formatCellString } from './dbHelpers';

interface GalleryViewProps {
  schema: PropertySchema[];
  rows: Page[];
  cardSize?: 'small' | 'medium' | 'large';
  showProperties?: string[];
  relatedDatabases: Record<string, DatabaseFull>;
  readonly?: boolean;
  onOpenRow: (row: Page) => void;
  onCreateRow: () => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  schema,
  rows,
  cardSize = 'medium',
  showProperties,
  relatedDatabases,
  readonly,
  onOpenRow,
  onCreateRow,
}) => {
  const gridClass =
    cardSize === 'small'
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
      : cardSize === 'large'
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  const displayProps =
    showProperties && showProperties.length > 0
      ? schema.filter((p) => showProperties.includes(p.id))
      : schema.filter((p) => p.type !== 'title').slice(0, 4);

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {rows.map((row) => (
        <div
          key={row.id}
          onClick={() => onOpenRow(row)}
          className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden hover:shadow-lg transition cursor-pointer flex flex-col"
        >
          <div className="h-28 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/50 dark:from-zinc-800/80 dark:via-zinc-800 dark:to-zinc-900 p-3.5 overflow-hidden border-b border-slate-100 dark:border-zinc-800">
            {row.cover_url ? (
              <img src={row.cover_url} alt={row.title} className="w-full h-full object-cover rounded-lg" />
            ) : (
              <div className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-4 leading-relaxed">
                {row.plain_text || row.summary || '点击打开页面编辑详细内容...'}
              </div>
            )}
          </div>

          <div className="p-3.5 space-y-2 flex-1">
            <div className="font-semibold text-sm flex items-center gap-1.5 truncate">
              <span>{row.icon || '📄'}</span>
              <span className="truncate">{row.title || '无标题'}</span>
            </div>
            <div className="space-y-1">
              {displayProps.map((p) => {
                const text = formatCellString(row, p, schema, relatedDatabases);
                if (!text) return null;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400 truncate">{p.name}</span>
                    <span className="text-slate-700 dark:text-zinc-200 truncate">{text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {!readonly && (
        <button
          type="button"
          onClick={onCreateRow}
          className="min-h-44 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 flex flex-col items-center justify-center gap-2 text-xs text-slate-400 hover:text-blue-600 transition"
        >
          <Plus className="w-5 h-5" />
          <span>新建卡片</span>
        </button>
      )}
    </div>
  );
};
