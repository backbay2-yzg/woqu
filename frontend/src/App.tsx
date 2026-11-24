import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  History,
  Link2,
  ListOrdered,
  Maximize2,
  Menu,
  Minimize2,
  Share2,
  Sparkles,
  Star,
  Tag,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { TipTapJSON } from '@/types';
import { AuthPages } from './components/auth/AuthPages';
import { PublicSharePage } from './components/public/PublicSharePage';
import { Sidebar } from './components/layout/Sidebar';
import { BlockEditor } from './components/editor/BlockEditor';
import { AiSummaryCard } from './components/editor/AiSummaryCard';
import { DatabaseContainer } from './components/database/DatabaseContainer';
import { AiSidebar } from './components/ai/AiSidebar';
import { TocPanel } from './components/panels/TocPanel';
import { BacklinksPanel } from './components/panels/BacklinksPanel';
import { VersionHistoryModal } from './components/panels/VersionHistoryModal';
import { CommandPalette } from './components/panels/CommandPalette';
import { GraphView } from './components/panels/GraphView';
import { TemplatesModal } from './components/panels/TemplatesModal';
import { WebClipperModal } from './components/panels/WebClipperModal';
import { ShareModal } from './components/panels/ShareModal';
import { ImportExportModal } from './components/panels/ImportExportModal';
import { TrashModal } from './components/panels/TrashModal';
import { SettingsModal } from './components/panels/SettingsModal';

const PAGE_ICONS = ['📄', '📝', '🚀', '💡', '📚', '🧠', '✅', '📋', '🔥', '🌟', '🛠️', '🎯'];

const WorkspaceView: React.FC = () => {
  const { pageId } = useParams();
  const navigate = useNavigate();

  const authStatus = useAppStore((s) => s.authStatus);
  const authLoading = useAppStore((s) => s.authLoading);
  const checkAuth = useAppStore((s) => s.checkAuth);
  const loadWorkspace = useAppStore((s) => s.loadWorkspace);
  const loadTree = useAppStore((s) => s.loadTree);
  const openPage = useAppStore((s) => s.openPage);
  const tree = useAppStore((s) => s.tree);
  const allPages = useAppStore((s) => s.allPages);
  const activePage = useAppStore((s) => s.activePage);
  const activeDatabase = useAppStore((s) => s.activeDatabase);
  const promptTemplates = useAppStore((s) => s.promptTemplates);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const rightPanel = useAppStore((s) => s.rightPanel);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const setActiveHeadings = useAppStore((s) => s.setActiveHeadings);
  const updateActivePageLocal = useAppStore((s) => s.updateActivePageLocal);
  const createPage = useAppStore((s) => s.createPage);
  const refreshActivePage = useAppStore((s) => s.refreshActivePage);

  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const templatesOpen = useAppStore((s) => s.templatesOpen);
  const clipperOpen = useAppStore((s) => s.clipperOpen);
  const importExportOpen = useAppStore((s) => s.importExportOpen);
  const trashOpen = useAppStore((s) => s.trashOpen);
  const versionsOpen = useAppStore((s) => s.versionsOpen);
  const shareOpen = useAppStore((s) => s.shareOpen);
  const graphViewOpen = useAppStore((s) => s.graphViewOpen);
  const setModal = useAppStore((s) => s.setModal);

  const [titleDraft, setTitleDraft] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    if (authStatus?.initialized && authStatus?.authenticated) {
      void loadWorkspace();
    }
  }, [authStatus?.initialized, authStatus?.authenticated]);

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    if (pageId) {
      if (activePage?.id !== pageId) {
        void openPage(pageId);
      }
    } else if (tree.length > 0 && !activePage) {
      const target = tree.find((t) => t.is_favorite) || tree[0];
      if (target) {
        navigate(`/p/${target.id}`, { replace: true });
      }
    }
  }, [pageId, tree, authStatus?.authenticated]);

  useEffect(() => {
    setTitleDraft(activePage?.title || '');
    setIconPickerOpen(false);
  }, [activePage?.id, activePage?.title]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModal('commandPaletteOpen', !commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen]);

  if (authLoading || !authStatus) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">正在加载工作区...</div>;
  }

  if (!authStatus.initialized || !authStatus.authenticated) {
    return <AuthPages status={authStatus} />;
  }

  const handleNavigatePage = (id: string) => {
    setModal('graphViewOpen', false);
    navigate(`/p/${id}`);
  };

  const scheduleUpdate = (patch: Record<string, unknown>, refreshSidebar = false) => {
    if (!activePage) return;
    const pid = activePage.id;
    setSaveState('saving');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await api.updatePage(pid, patch);
        setSaveState('saved');
        if (refreshSidebar) await loadTree();
      } catch {
        setSaveState('saved');
      }
    }, 450);
  };

  const toggleFavorite = async () => {
    if (!activePage) return;
    const next = !activePage.is_favorite;
    updateActivePageLocal({ is_favorite: next });
    await api.updatePage(activePage.id, { is_favorite: next });
    await loadTree();
  };

  const toggleFullWidth = async () => {
    if (!activePage) return;
    const next = !activePage.is_full_width;
    updateActivePageLocal({ is_full_width: next });
    await api.updatePage(activePage.id, { is_full_width: next });
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-[#191919] text-slate-900 dark:text-[#e6e6e4]">
      <Sidebar onNavigatePage={handleNavigatePage} />

      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Top Bar */}
        <header className="no-print h-12 shrink-0 px-3 sm:px-4 border-b border-slate-200/80 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                title="展开侧边栏"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            {activePage && !graphViewOpen && (
              <div className="flex items-center gap-1.5 text-xs font-medium truncate">
                <span>{activePage.icon || (activePage.is_database ? '🗃️' : '📄')}</span>
                <span className="truncate">{activePage.title}</span>
                <span className="hidden sm:inline text-[11px] text-slate-400 ml-2">
                  {saveState === 'saving' ? '正在保存...' : '已保存'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {activePage && !graphViewOpen && (
              <>
                <button
                  type="button"
                  onClick={() => void toggleFavorite()}
                  title="收藏页面"
                  className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 ${
                    activePage.is_favorite ? 'text-amber-500' : 'text-slate-400'
                  }`}
                >
                  <Star className={`w-4 h-4 ${activePage.is_favorite ? 'fill-amber-500' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleFullWidth()}
                  title={activePage.is_full_width ? '切换标准阅读宽度' : '切换宽屏画布'}
                  className="hidden sm:inline-flex p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                >
                  {activePage.is_full_width ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setModal('versionsOpen', true)}
                  title="历史版本与快照"
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setModal('shareOpen', true)}
                  title="公开只读分享"
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setModal('importExportOpen', true)}
                  title="导出 Markdown / HTML / PDF"
                  className="hidden sm:inline-flex p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                >
                  <Archive className="w-4 h-4" />
                </button>

                <div className="h-4 w-px bg-slate-200 dark:bg-zinc-700 mx-1" />

                <button
                  type="button"
                  onClick={() => setRightPanel(rightPanel === 'toc' ? 'none' : 'toc')}
                  className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition ${
                    rightPanel === 'toc'
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                  title="大纲目录"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>大纲</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanel(rightPanel === 'backlinks' ? 'none' : 'backlinks')}
                  className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition ${
                    rightPanel === 'backlinks'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                  title="反向链接"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>反链</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setRightPanel(rightPanel === 'ai' ? 'none' : 'ai')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                rightPanel === 'ai'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 助手</span>
            </button>
          </div>
        </header>

        {/* Main Body + Right Panel */}
        <div className="flex-1 min-h-0 flex">
          {graphViewOpen ? (
            <GraphView
              onNavigatePage={handleNavigatePage}
              onClose={() => setModal('graphViewOpen', false)}
            />
          ) : !activePage ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="text-4xl">✨</div>
              <div className="text-base font-semibold">选择左侧页面，或新建一篇文档开始创作</div>
              <button
                type="button"
                onClick={async () => {
                  const p = await createPage();
                  handleNavigatePage(p.id);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                新建第一篇文档
              </button>
            </div>
          ) : (
            <main className="flex-1 min-w-0 overflow-y-auto print-container">
              <div
                className={`mx-auto px-6 sm:px-14 py-8 sm:py-12 transition-all ${
                  activePage.is_full_width || activePage.is_database ? 'max-w-6xl' : 'max-w-3xl'
                }`}
              >
                {/* Page Header: Icon + Title + Tags */}
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 relative">
                    <button
                      type="button"
                      onClick={() => setIconPickerOpen((v) => !v)}
                      className="text-4xl hover:scale-110 transition select-none"
                      title="切换页面图标"
                    >
                      {activePage.icon || (activePage.is_database ? '🗃️' : '📄')}
                    </button>
                    {iconPickerOpen && (
                      <div className="no-print absolute left-0 top-12 z-30 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-2 flex flex-wrap gap-1 w-52">
                        {PAGE_ICONS.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={async () => {
                              updateActivePageLocal({ icon: ic });
                              setIconPickerOpen(false);
                              await api.updatePage(activePage.id, { icon: ic });
                              await loadTree();
                            }}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-lg"
                          >
                            {ic}
                          </button>
                        ))}
                      </div>
                    )}

                    <input
                      value={titleDraft}
                      onChange={(e) => {
                        setTitleDraft(e.target.value);
                        updateActivePageLocal({ title: e.target.value });
                        scheduleUpdate({ title: e.target.value }, true);
                      }}
                      placeholder="无标题"
                      className="flex-1 text-3xl sm:text-4xl font-bold bg-transparent outline-none"
                    />
                  </div>

                  {/* Tags bar */}
                  {!activePage.is_database && (
                    <div className="no-print flex flex-wrap items-center gap-1.5 text-xs">
                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                      {(activePage.tags || []).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                        >
                          #{t}
                          <button
                            type="button"
                            onClick={() => {
                              const next = activePage.tags.filter((x) => x !== t);
                              updateActivePageLocal({ tags: next });
                              scheduleUpdate({ tags: next });
                            }}
                            className="text-slate-400 hover:text-rose-500 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTag.trim()) {
                            const tag = newTag.trim();
                            if (!activePage.tags.includes(tag)) {
                              const next = [...activePage.tags, tag];
                              updateActivePageLocal({ tags: next });
                              scheduleUpdate({ tags: next });
                            }
                            setNewTag('');
                          }
                        }}
                        placeholder="+ 添加标签"
                        className="w-24 bg-transparent outline-none text-slate-500 placeholder:text-slate-300 dark:placeholder:text-zinc-600"
                      />
                    </div>
                  )}
                </div>

                {activePage.is_database && activeDatabase ? (
                  <DatabaseContainer
                    databaseId={activeDatabase.database.id}
                    initialData={activeDatabase}
                    onOpenPage={handleNavigatePage}
                  />
                ) : (
                  <>
                    <AiSummaryCard
                      pageId={activePage.id}
                      initialSummary={activePage.summary}
                      onSavedSummary={(sum) => updateActivePageLocal({ summary: sum })}
                      onInsertCallout={async (sumText) => {
                        const cur = activePage.content_json;
                        const nextDoc: TipTapJSON = {
                          type: 'doc',
                          content: [
                            {
                              type: 'callout',
                              attrs: { icon: '✨', color: 'purple' },
                              content: [{ type: 'paragraph', content: [{ type: 'text', text: sumText }] }],
                            },
                            ...(cur.content || []),
                          ],
                        };
                        await api.updatePage(activePage.id, { content_json: nextDoc });
                        await openPage(activePage.id);
                      }}
                    />

                    <BlockEditor
                      key={activePage.id}
                      pageId={activePage.id}
                      initialContent={activePage.content_json}
                      editable
                      allPages={allPages}
                      promptTemplates={promptTemplates}
                      onChangeContent={(json) => {
                        updateActivePageLocal({ content_json: json });
                        scheduleUpdate({ content_json: json });
                      }}
                      onNavigatePage={handleNavigatePage}
                      onHeadingsChange={setActiveHeadings}
                      renderInlineDatabase={(dbId, ro) => (
                        <DatabaseContainer databaseId={dbId} readonly={ro} onOpenPage={handleNavigatePage} />
                      )}
                    />
                  </>
                )}
              </div>
            </main>
          )}

          {/* Right Slide-out Panels */}
          {rightPanel !== 'none' && (
            <div className="no-print fixed md:static right-0 inset-y-0 top-12 md:top-0 z-30 w-80 sm:w-96 shrink-0 h-[calc(100%-3rem)] md:h-full">
              {rightPanel === 'ai' && (
                <AiSidebar onClose={() => setRightPanel('none')} onNavigatePage={handleNavigatePage} />
              )}
              {rightPanel === 'toc' && <TocPanel onClose={() => setRightPanel('none')} />}
              {rightPanel === 'backlinks' && activePage && (
                <BacklinksPanel
                  pageId={activePage.id}
                  onClose={() => setRightPanel('none')}
                  onNavigatePage={handleNavigatePage}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Global Modals */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setModal('commandPaletteOpen', false)}
        onNavigatePage={handleNavigatePage}
      />
      {activePage && (
        <>
          <VersionHistoryModal
            open={versionsOpen}
            pageId={activePage.id}
            onClose={() => setModal('versionsOpen', false)}
            onRestored={refreshActivePage}
          />
          <ShareModal
            open={shareOpen}
            pageId={activePage.id}
            pageTitle={activePage.title}
            onClose={() => setModal('shareOpen', false)}
          />
        </>
      )}
      <TemplatesModal open={templatesOpen} onClose={() => setModal('templatesOpen', false)} />
      <WebClipperModal open={clipperOpen} onClose={() => setModal('clipperOpen', false)} />
      <ImportExportModal open={importExportOpen} onClose={() => setModal('importExportOpen', false)} />
      <TrashModal open={trashOpen} onClose={() => setModal('trashOpen', false)} />
      <SettingsModal open={settingsOpen} onClose={() => setModal('settingsOpen', false)} />
    </div>
  );
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-[#191919] text-slate-800 dark:text-zinc-100">
          <div className="max-w-lg w-full rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-6 space-y-3">
            <div className="text-base font-bold text-rose-600 dark:text-rose-400">页面渲染发生异常</div>
            <pre className="text-xs whitespace-pre-wrap break-all bg-white dark:bg-zinc-900 p-3 rounded-xl border border-rose-100 dark:border-zinc-800">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/share/:token" element={<PublicSharePage />} />
          <Route path="/p/:pageId" element={<WorkspaceView />} />
          <Route path="*" element={<WorkspaceView />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
