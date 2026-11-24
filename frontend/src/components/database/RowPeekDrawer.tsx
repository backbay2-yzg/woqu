import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { DatabaseFull, Page, PropertyOption, PropertySchema, TipTapJSON } from '@/types';
import { BlockEditor } from '../editor/BlockEditor';
import { PropertyCell } from './PropertyCell';

interface RowPeekDrawerProps {
  dbId: string;
  row: Page | null;
  schema: PropertySchema[];
  relatedDatabases: Record<string, DatabaseFull>;
  readonly?: boolean;
  onClose: () => void;
  onOpenFullPage: (pageId: string) => void;
  onUpdateCell: (rowId: string, propId: string, value: unknown, newOpt?: PropertyOption) => void;
  onDeleteRow: (rowId: string) => void;
  onRefreshAutofill: (rowId: string, propId: string) => Promise<void>;
  onRowContentSaved?: (updated: Page) => void;
}

export const RowPeekDrawer: React.FC<RowPeekDrawerProps> = ({
  dbId,
  row,
  schema,
  relatedDatabases,
  readonly,
  onClose,
  onOpenFullPage,
  onUpdateCell,
  onDeleteRow,
  onRefreshAutofill,
  onRowContentSaved,
}) => {
  const allPages = useAppStore((s) => s.allPages);
  const promptTemplates = useAppStore((s) => s.promptTemplates);
  const [titleDraft, setTitleDraft] = useState(row?.title || '');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setTitleDraft(row?.title || '');
  }, [row?.id, row?.title]);

  if (!row) return null;

  const titleProp = schema.find((p) => p.type === 'title');

  const handleSaveContent = (json: TipTapJSON) => {
    if (readonly) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const updated = await api.updatePage(row.id, { content_json: json });
        onRowContentSaved?.(updated);
      } catch {
        // ignore transient save error
      }
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-full bg-white dark:bg-[#191919] border-l border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullPage(row.id);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              作为全页打开
            </button>
          </div>
          <div className="flex items-center gap-1">
            {!readonly && (
              <button
                type="button"
                onClick={() => {
                  onDeleteRow(row.id);
                  onClose();
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                title="删除此记录"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl">{row.icon || '📄'}</span>
            <input
              type="text"
              readOnly={readonly}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (!readonly && titleProp && titleDraft.trim() !== row.title) {
                  onUpdateCell(row.id, titleProp.id, titleDraft.trim() || '无标题');
                }
              }}
              className="flex-1 text-2xl font-bold bg-transparent outline-none"
              placeholder="无标题记录"
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/80">
            {schema
              .filter((p) => p.type !== 'title')
              .map((prop) => (
                <div key={prop.id} className="grid grid-cols-12 items-center px-3.5 py-2.5 gap-3">
                  <div className="col-span-4 text-xs font-medium text-slate-500 dark:text-zinc-400 truncate">
                    {prop.name}
                  </div>
                  <div className="col-span-8 min-w-0">
                    <PropertyCell
                      dbId={dbId}
                      row={row}
                      prop={prop}
                      schema={schema}
                      relatedDatabases={relatedDatabases}
                      readonly={readonly}
                      onUpdateCell={(propId, val, opt) => onUpdateCell(row.id, propId, val, opt)}
                      onRefreshAutofill={onRefreshAutofill}
                    />
                  </div>
                </div>
              ))}
          </div>

          <div className="border-t border-slate-200 dark:border-zinc-800 pt-5">
            <div className="text-xs font-medium text-slate-400 mb-3">记录详情正文</div>
            <BlockEditor
              key={row.id}
              pageId={row.id}
              initialContent={row.content_json}
              editable={!readonly}
              allPages={allPages}
              promptTemplates={promptTemplates}
              onChangeContent={handleSaveContent}
              onNavigatePage={(id) => {
                onClose();
                onOpenFullPage(id);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
