import React, { useState } from 'react';
import {
  Archive,
  BookOpen,
  BookTemplate,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FilePlus,
  Globe,
  LogOut,
  Moon,
  Network,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { PageTreeItem } from '@/types';

interface SidebarProps {
  onNavigatePage: (pageId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onNavigatePage }) => {
  const authStatus = useAppStore((s) => s.authStatus);
  const setAuthStatus = useAppStore((s) => s.setAuthStatus);
  const tree = useAppStore((s) => s.tree);
  const activePage = useAppStore((s) => s.activePage);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const createPage = useAppStore((s) => s.createPage);
  const createDatabasePage = useAppStore((s) => s.createDatabasePage);
  const loadTree = useAppStore((s) => s.loadTree);
  const setModal = useAppStore((s) => s.setModal);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);

  if (!sidebarOpen) return null;

  const favorites = tree.filter((p) => p.is_favorite);
  const childrenByParent = tree.reduce<Record<string, PageTreeItem[]>>((acc, item) => {
    const key = item.parent_id || '__root__';
    (acc[key] ||= []).push(item);
    return acc;
  }, {});

  const handleCreateChild = async (e: React.MouseEvent, parentId: string) => {
    e.stopPropagation();
    setExpanded((p) => ({ ...p, [parentId]: true }));
    const created = await createPage({ parent_id: parentId, title: '无标题', icon: '📄' });
    onNavigatePage(created.id);
  };

  const handleDropInto = async (targetParentId: string | null) => {
    if (!draggedId || draggedId === targetParentId) return;
    setDraggedId(null);
    const siblings = childrenByParent[targetParentId || '__root__'] || [];
    const maxPos = siblings.reduce((m, s) => Math.max(m, s.position), 0);
    try {
      await api.movePage(draggedId, targetParentId, maxPos + 1000);
      await loadTree();
      if (targetParentId) setExpanded((p) => ({ ...p, [targetParentId]: true }));
    } catch {
      // ignore cycle move error
    }
  };

  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => {
    const list = childrenByParent[parentId || '__root__'] || [];
    if (list.length === 0) return null;
    return list.map((item) => {
      const kids = childrenByParent[item.id] || [];
      const hasKids = kids.length > 0;
      const isOpen = Boolean(expanded[item.id]);
      const isActive = activePage?.id === item.id;

      return (
        <div key={item.id}>
          <div
            draggable
            onDragStart={(e) => {
              setDraggedId(item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.stopPropagation();
              void handleDropInto(item.id);
            }}
            onClick={() => {
              onNavigatePage(item.id);
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={`group flex items-center justify-between gap-1 pr-1.5 py-1.5 rounded-lg text-xs cursor-pointer transition ${
              isActive
                ? 'bg-slate-200/80 dark:bg-zinc-800 font-semibold text-slate-900 dark:text-zinc-100'
                : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-200/50 dark:hover:bg-zinc-800/60'
            }`}
          >
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
                }}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 hover:bg-black/5 dark:hover:bg-white/10 ${
                  hasKids ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
                }`}
              >
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              <span className="shrink-0">{item.icon || (item.is_database ? '🗃️' : '📄')}</span>
              <span className="truncate">{item.title || '无标题'}</span>
            </div>

            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => void handleCreateChild(e, item.id)}
                title="新建子页面"
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const dup = await api.duplicatePage(item.id);
                  await loadTree();
                  onNavigatePage(dup.id);
                }}
                title="复制页面"
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.deletePage(item.id);
                  await loadTree();
                }}
                title="移入回收站"
                className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {isOpen && renderBranch(item.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={() => setSidebarOpen(false)}
        className="md:hidden fixed inset-0 z-30 bg-black/40"
      />
      <aside className="no-print fixed md:static inset-y-0 left-0 z-40 w-64 shrink-0 h-full flex flex-col bg-[#f7f7f5] dark:bg-[#202020] border-r border-slate-200 dark:border-zinc-800 select-none">
        {/* Workspace Header */}
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200/70 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{authStatus?.workspace_icon || '✨'}</span>
            <span className="text-sm font-bold truncate">{authStatus?.workspace_name || '我趣文档'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-zinc-800 text-slate-500"
              title="切换浅/深主题"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-zinc-800 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search & Quick Actions */}
        <div className="p-2.5 space-y-1">
          <button
            type="button"
            onClick={() => setModal('commandPaletteOpen', true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-700/80 text-xs text-slate-500 hover:border-blue-400 transition"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              <span>搜索知识库...</span>
            </span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800">⌘K</kbd>
          </button>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              type="button"
              onClick={async () => {
                const p = await createPage();
                onNavigatePage(p.id);
              }}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition"
            >
              <FilePlus className="w-3.5 h-3.5" />
              新建页面
            </button>
            <button
              type="button"
              onClick={async () => {
                const full = await createDatabasePage();
                if (full.database.page_id) onNavigatePage(full.database.page_id);
              }}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-medium transition"
            >
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              多维表
            </button>
          </div>
        </div>

        {/* Scrollable Trees */}
        <div
          className="flex-1 overflow-y-auto px-2 pb-4 space-y-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => void handleDropInto(null)}
        >
          {favorites.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Star className="w-3 h-3 text-amber-500" />
                收藏夹
              </div>
              <div className="space-y-0.5">
                {favorites.map((item) => (
                  <button
                    key={`fav-${item.id}`}
                    type="button"
                    onClick={() => onNavigatePage(item.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition ${
                      activePage?.id === item.id
                        ? 'bg-slate-200/80 dark:bg-zinc-800 font-semibold'
                        : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-200/50 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <span>{item.icon || (item.is_database ? '🗃️' : '📄')}</span>
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
              <span>全部页面</span>
            </div>
            <div className="space-y-0.5">{renderBranch(null, 0)}</div>
          </div>
        </div>

        {/* Bottom Utility Links */}
        <div className="p-2 border-t border-slate-200/80 dark:border-zinc-800 space-y-0.5 text-xs">
          <button
            type="button"
            onClick={() => setModal('graphViewOpen', true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <Network className="w-4 h-4 text-purple-500" />
            <span>双向链接图谱</span>
          </button>
          <button
            type="button"
            onClick={() => setModal('templatesOpen', true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <BookTemplate className="w-4 h-4 text-blue-500" />
            <span>页面模板中心</span>
          </button>
          <button
            type="button"
            onClick={() => setModal('clipperOpen', true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <Globe className="w-4 h-4 text-sky-500" />
            <span>网页智能剪藏</span>
          </button>
          <button
            type="button"
            onClick={() => setModal('importExportOpen', true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <Archive className="w-4 h-4 text-emerald-500" />
            <span>导入导出与备份</span>
          </button>
          <button
            type="button"
            onClick={() => setModal('trashOpen', true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <Trash2 className="w-4 h-4 text-rose-500" />
            <span>回收站</span>
          </button>
          <a
            href="/guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
          >
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <span>使用文档</span>
          </a>
          <div className="flex items-center gap-1 pt-1 mt-1 border-t border-slate-200/60 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setModal('settingsOpen', true)}
              className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
            >
              <Settings className="w-4 h-4" />
              <span>系统与 AI 设置</span>
            </button>
            {!authStatus?.local_no_auth && (
              <button
                type="button"
                onClick={async () => {
                  await api.authLogout();
                  if (authStatus) setAuthStatus({ ...authStatus, authenticated: false });
                }}
                title="退出登录"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200/60 dark:hover:bg-zinc-800"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
