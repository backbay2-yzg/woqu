import React, { useEffect, useState } from 'react';
import { BookTemplate, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { TemplateItem } from '@/types';

interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
}

export const TemplatesModal: React.FC<TemplatesModalProps> = ({ open, onClose }) => {
  const activePage = useAppStore((s) => s.activePage);
  const loadTree = useAppStore((s) => s.loadTree);
  const openPage = useAppStore((s) => s.openPage);

  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selected, setSelected] = useState<TemplateItem | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const list = await api.listTemplates();
    setTemplates(list);
    if (list.length > 0 && !selected) setSelected(list[0]);
  };

  useEffect(() => {
    if (open) {
      void load();
      setSaveName(activePage ? `${activePage.title} 模板` : '');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BookTemplate className="w-4 h-4 text-blue-600" />
            <span>页面模板中心</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          <div className="md:col-span-5 border-r border-slate-200 dark:border-zinc-800 p-3 overflow-y-auto space-y-1.5">
            {templates.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelected(t)}
                className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer border transition ${
                  selected?.id === t.id
                    ? 'border-blue-400 bg-blue-50/70 dark:bg-blue-950/30'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <span>{t.icon}</span>
                    <span className="truncate">{t.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{t.category}</div>
                </div>
                {!t.is_builtin && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api.deleteTemplate(t.id);
                      await load();
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="md:col-span-7 p-5 flex flex-col justify-between gap-4">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-bold">
                  <span>{selected.icon}</span>
                  <span>{selected.name}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                  {selected.description || '点击下方按钮从该模板快速创建新页面。'}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const created = await api.instantiateTemplate(selected.id, null);
                    await loadTree();
                    await openPage(created.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  使用此模板新建页面
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400">选择一个模板查看详情</div>
            )}

            {activePage && !activePage.is_database && (
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 p-3.5 space-y-2">
                <div className="text-xs font-semibold">将当前页存为自定义模板</div>
                <div className="flex gap-2">
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="模板名称..."
                    className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs outline-none"
                  />
                  <button
                    type="button"
                    disabled={saving || !saveName.trim()}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await api.saveAsTemplate({
                          page_id: activePage.id,
                          name: saveName.trim(),
                          category: '自定义',
                          icon: activePage.icon || '📄',
                        });
                        await load();
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
