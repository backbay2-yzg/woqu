import React, { useEffect, useState } from 'react';
import { Database, FilePlus, Moon, Network, Search, Sun, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { SearchResult } from '@/types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigatePage: (pageId: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onNavigatePage }) => {
  const allPages = useAppStore((s) => s.allPages);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const createPage = useAppStore((s) => s.createPage);
  const createDatabasePage = useAppStore((s) => s.createDatabasePage);
  const setModal = useAppStore((s) => s.setModal);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchPages(q, 15);
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-start justify-center pt-[12vh] p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-zinc-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页面标题、正文或关键词（支持中文全文 + 向量语义检索）..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-2">
          {query.trim() ? (
            loading ? (
              <div className="p-6 text-center text-xs text-slate-400">正在搜索知识库...</div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">未找到匹配结果</div>
            ) : (
              <div className="space-y-1">
                <div className="px-2.5 py-1 text-[11px] text-slate-400 font-medium">搜索结果</div>
                {results.map((r) => (
                  <button
                    key={r.page_id}
                    type="button"
                    onClick={() => {
                      onNavigatePage(r.page_id);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition space-y-0.5"
                  >
                    <div className="text-sm font-medium flex items-center gap-2">
                      <span>{r.icon || '📄'}</span>
                      <span className="truncate">{r.title}</span>
                    </div>
                    {r.snippet && (
                      <div className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 pl-6">
                        {r.snippet}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : (
            <>
              <div className="space-y-0.5">
                <div className="px-2.5 py-1 text-[11px] text-slate-400 font-medium">快捷操作</div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    void createPage();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  <FilePlus className="w-4 h-4 text-blue-500" />
                  <span>新建空白文档页面</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    void createDatabasePage();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  <Database className="w-4 h-4 text-emerald-500" />
                  <span>新建多维数据库</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setModal('graphViewOpen', true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  <Network className="w-4 h-4 text-purple-500" />
                  <span>打开知识图谱视图</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleTheme();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />}
                  <span>切换{theme === 'dark' ? '浅色' : '深色'}主题</span>
                </button>
              </div>

              {allPages.length > 0 && (
                <div className="space-y-0.5 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <div className="px-2.5 py-1 text-[11px] text-slate-400 font-medium">最近编辑</div>
                  {allPages.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onNavigatePage(p.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
                    >
                      <span>{p.icon || (p.is_database ? '🗃️' : '📄')}</span>
                      <span className="truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
