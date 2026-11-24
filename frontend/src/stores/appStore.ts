import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  AIPromptTemplate,
  AuthStatus,
  DatabaseFull,
  Page,
  PageTreeItem,
} from '@/types';

export type RightPanelMode = 'none' | 'ai' | 'toc' | 'backlinks';

interface AppState {
  authStatus: AuthStatus | null;
  authLoading: boolean;
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  rightPanel: RightPanelMode;

  tree: PageTreeItem[];
  allPages: PageTreeItem[];
  activePage: Page | null;
  activeDatabase: DatabaseFull | null;
  relatedDatabases: Record<string, DatabaseFull>;
  promptTemplates: AIPromptTemplate[];
  activeHeadings: Array<{ id: string; text: string; level: number }>;

  // Modals
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  templatesOpen: boolean;
  clipperOpen: boolean;
  importExportOpen: boolean;
  trashOpen: boolean;
  versionsOpen: boolean;
  shareOpen: boolean;
  graphViewOpen: boolean;

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  setRightPanel: (mode: RightPanelMode) => void;
  setActiveHeadings: (headings: Array<{ id: string; text: string; level: number }>) => void;
  setModal: (
    modal:
      | 'commandPaletteOpen'
      | 'settingsOpen'
      | 'templatesOpen'
      | 'clipperOpen'
      | 'importExportOpen'
      | 'trashOpen'
      | 'versionsOpen'
      | 'shareOpen'
      | 'graphViewOpen',
    open: boolean,
  ) => void;

  checkAuth: () => Promise<AuthStatus>;
  setAuthStatus: (status: AuthStatus) => void;
  loadWorkspace: () => Promise<void>;
  loadTree: () => Promise<void>;
  loadPromptTemplates: () => Promise<void>;
  openPage: (pageId: string) => Promise<void>;
  refreshActivePage: () => Promise<void>;
  loadDatabaseFull: (dbId: string) => Promise<DatabaseFull | null>;
  createPage: (opts?: { parent_id?: string | null; title?: string; icon?: string }) => Promise<Page>;
  createDatabasePage: (opts?: { parent_page_id?: string | null; title?: string }) => Promise<DatabaseFull>;
  updateActivePageLocal: (patch: Partial<Page>) => void;
}

function getInitialTheme(): 'light' | 'dark' {
  const saved = typeof window !== 'undefined' ? window.localStorage.getItem('woqu-theme') : null;
  if (saved === 'dark' || saved === 'light') {
    applyThemeClass(saved);
    return saved;
  }
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = prefersDark ? 'dark' : 'light';
  applyThemeClass(theme);
  return theme;
}

function applyThemeClass(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  authStatus: null,
  authLoading: true,
  theme: getInitialTheme(),
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  rightPanel: 'none',

  tree: [],
  allPages: [],
  activePage: null,
  activeDatabase: null,
  relatedDatabases: {},
  promptTemplates: [],
  activeHeadings: [],

  commandPaletteOpen: false,
  settingsOpen: false,
  templatesOpen: false,
  clipperOpen: false,
  importExportOpen: false,
  trashOpen: false,
  versionsOpen: false,
  shareOpen: false,
  graphViewOpen: false,

  setTheme: (theme) => {
    applyThemeClass(theme);
    window.localStorage.setItem('woqu-theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setActiveHeadings: (activeHeadings) => set({ activeHeadings }),
  setModal: (modal, open) => set({ [modal]: open } as Partial<AppState>),

  checkAuth: async () => {
    set({ authLoading: true });
    try {
      const status = await api.authStatus();
      set({ authStatus: status, authLoading: false });
      return status;
    } catch {
      const fallback: AuthStatus = {
        initialized: false,
        authenticated: false,
        local_no_auth: false,
        workspace_name: '我趣文档',
        workspace_icon: '✨',
      };
      set({ authStatus: fallback, authLoading: false });
      return fallback;
    }
  },

  setAuthStatus: (authStatus) => set({ authStatus }),

  loadWorkspace: async () => {
    await Promise.all([get().loadTree(), get().loadPromptTemplates()]);
  },

  loadTree: async () => {
    const [tree, allPages] = await Promise.all([api.getPagesTree(), api.getAllPages()]);
    set({ tree, allPages });
  },

  loadPromptTemplates: async () => {
    try {
      const promptTemplates = await api.listPromptTemplates();
      set({ promptTemplates });
    } catch {
      // ignore
    }
  },

  openPage: async (pageId: string) => {
    const page = await api.getPage(pageId);
    set({ activePage: page, activeDatabase: null, graphViewOpen: false });

    if (page.is_database) {
      try {
        const dbFull = await api.getDatabaseByPage(page.id);
        set((st) => ({
          activeDatabase: dbFull,
          relatedDatabases: { ...st.relatedDatabases, [dbFull.database.id]: dbFull },
        }));
        // Preload related databases for rollup/relation labels
        for (const prop of dbFull.database.schema) {
          if (prop.type === 'relation' && prop.relation_database_id) {
            void get().loadDatabaseFull(prop.relation_database_id);
          }
        }
      } catch {
        // ignore
      }
    }
  },

  refreshActivePage: async () => {
    const active = get().activePage;
    await get().loadTree();
    if (active) {
      await get().openPage(active.id);
    }
  },

  loadDatabaseFull: async (dbId: string) => {
    try {
      const full = await api.getDatabaseFull(dbId);
      set((st) => ({
        relatedDatabases: { ...st.relatedDatabases, [dbId]: full },
        activeDatabase: st.activeDatabase?.database.id === dbId ? full : st.activeDatabase,
      }));
      return full;
    } catch {
      return null;
    }
  },

  createPage: async (opts) => {
    const p = await api.createPage({
      parent_id: opts?.parent_id ?? null,
      title: opts?.title ?? '无标题',
      icon: opts?.icon ?? '📄',
    });
    await get().loadTree();
    await get().openPage(p.id);
    return p;
  },

  createDatabasePage: async (opts) => {
    const full = await api.createDatabase({
      parent_page_id: opts?.parent_page_id ?? null,
      title: opts?.title ?? '未命名多维表',
      icon: '🗃️',
      is_inline: false,
    });
    await get().loadTree();
    if (full.database.page_id) {
      await get().openPage(full.database.page_id);
    }
    return full;
  },

  updateActivePageLocal: (patch) => {
    set((st) => ({
      activePage: st.activePage ? { ...st.activePage, ...patch } : null,
    }));
  },
}));
