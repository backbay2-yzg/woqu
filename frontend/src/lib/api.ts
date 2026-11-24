import type {
  AIConversation,
  AIMessage,
  AIPromptTemplate,
  AIProvider,
  AIRouting,
  AuthStatus,
  BacklinkItem,
  DatabaseFull,
  DatabaseMeta,
  DatabaseView,
  GraphData,
  Page,
  PageTreeItem,
  PageVersion,
  PendingAction,
  PropertySchema,
  PublicShare,
  PublicSharePayload,
  SearchResult,
  TemplateItem,
} from '@/types';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore non-json error
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export interface SSECallbacks {
  onEvent: (event: string, data: unknown) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

export async function streamSSE(url: string, body: unknown, cb: SSECallbacks): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: cb.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `流式请求失败 (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) msg = errData.error;
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawBlock = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      let evtName = 'message';
      const dataLines: string[] = [];
      for (const line of rawBlock.split('\n')) {
        if (line.startsWith('event:')) {
          evtName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length > 0) {
        const joined = dataLines.join('\n');
        try {
          cb.onEvent(evtName, JSON.parse(joined));
        } catch {
          cb.onEvent(evtName, joined);
        }
      }
    }
  }
}

export const api = {
  // Auth & Settings
  authStatus: () => request<AuthStatus>('/api/v1/auth/status'),
  authSetup: (data: {
    password: string;
    workspace_name: string;
    workspace_icon: string;
    local_no_auth: boolean;
  }) => request<AuthStatus>('/api/v1/auth/setup', { method: 'POST', body: JSON.stringify(data) }),
  authLogin: (password: string) =>
    request<AuthStatus>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  authLogout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
  getSettings: () => request<{ status: AuthStatus; settings: Record<string, string> }>('/api/v1/settings'),
  updateSettings: (data: {
    workspace_name?: string;
    workspace_icon?: string;
    local_no_auth?: boolean;
    password_for_disable?: string;
    settings?: Record<string, string>;
  }) =>
    request<{ status: AuthStatus; settings: Record<string, string> }>('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Pages
  getPagesTree: () => request<PageTreeItem[]>('/api/v1/pages/tree'),
  getAllPages: () => request<PageTreeItem[]>('/api/v1/pages/all'),
  getTrashPages: () => request<Page[]>('/api/v1/pages/trash'),
  createPage: (data: Partial<Page> & { parent_id?: string | null }) =>
    request<Page>('/api/v1/pages', { method: 'POST', body: JSON.stringify(data) }),
  getPage: (id: string) => request<Page>(`/api/v1/pages/${id}`),
  updatePage: (id: string, data: Record<string, unknown>) =>
    request<Page>(`/api/v1/pages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  movePage: (id: string, parent_id: string | null, position: number) =>
    request<{ ok: boolean }>(`/api/v1/pages/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parent_id, position }),
    }),
  duplicatePage: (id: string) => request<Page>(`/api/v1/pages/${id}/duplicate`, { method: 'POST' }),
  deletePage: (id: string) => request<{ ok: boolean }>(`/api/v1/pages/${id}`, { method: 'DELETE' }),
  restorePage: (id: string) => request<Page>(`/api/v1/pages/${id}/restore`, { method: 'POST' }),
  permanentDeletePage: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/pages/${id}/permanent`, { method: 'DELETE' }),

  // Versions & Links & Graph
  listVersions: (pageId: string) => request<PageVersion[]>(`/api/v1/pages/${pageId}/versions`),
  createVersion: (pageId: string, note: string) =>
    request<PageVersion>(`/api/v1/pages/${pageId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  restoreVersion: (pageId: string, versionId: string) =>
    request<Page>(`/api/v1/pages/${pageId}/versions/${versionId}/restore`, { method: 'POST' }),
  getBacklinks: (pageId: string) => request<BacklinkItem[]>(`/api/v1/pages/${pageId}/backlinks`),
  getGraph: () => request<GraphData>('/api/v1/graph'),

  // Databases
  listDatabases: () => request<DatabaseMeta[]>('/api/v1/databases'),
  createDatabase: (data: {
    title: string;
    icon?: string;
    description?: string;
    parent_page_id?: string | null;
    page_id?: string | null;
    is_inline?: boolean;
  }) => request<DatabaseFull>('/api/v1/databases', { method: 'POST', body: JSON.stringify(data) }),
  getDatabaseByPage: (pageId: string) => request<DatabaseFull>(`/api/v1/databases/by-page/${pageId}`),
  getDatabaseFull: (dbId: string) => request<DatabaseFull>(`/api/v1/databases/${dbId}`),
  updateDatabaseMeta: (dbId: string, data: { title?: string; icon?: string; description?: string }) =>
    request<DatabaseMeta>(`/api/v1/databases/${dbId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateDatabaseSchema: (dbId: string, schema: PropertySchema[]) =>
    request<DatabaseMeta>(`/api/v1/databases/${dbId}/schema`, {
      method: 'PUT',
      body: JSON.stringify({ schema }),
    }),
  createDatabaseView: (dbId: string, data: { name: string; type: string; config?: Record<string, unknown> }) =>
    request<DatabaseView>(`/api/v1/databases/${dbId}/views`, { method: 'POST', body: JSON.stringify(data) }),
  updateDatabaseView: (dbId: string, viewId: string, data: { name?: string; type?: string; config?: unknown }) =>
    request<DatabaseView>(`/api/v1/databases/${dbId}/views/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteDatabaseView: (dbId: string, viewId: string) =>
    request<{ ok: boolean }>(`/api/v1/databases/${dbId}/views/${viewId}`, { method: 'DELETE' }),
  createDatabaseRow: (dbId: string, data: { title: string; properties?: Record<string, unknown> }) =>
    request<Page>(`/api/v1/databases/${dbId}/rows`, { method: 'POST', body: JSON.stringify(data) }),
  updateDatabaseRow: (dbId: string, rowId: string, data: { title?: string; properties?: Record<string, unknown> }) =>
    request<Page>(`/api/v1/databases/${dbId}/rows/${rowId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteDatabaseRow: (dbId: string, rowId: string) =>
    request<{ ok: boolean }>(`/api/v1/databases/${dbId}/rows/${rowId}`, { method: 'DELETE' }),
  autofillDatabase: (dbId: string, property_id: string, row_ids?: string[]) =>
    request<{ updated: number }>(`/api/v1/databases/${dbId}/autofill`, {
      method: 'POST',
      body: JSON.stringify({ property_id, row_ids }),
    }),

  // Search
  searchPages: (q: string, limit = 20) =>
    request<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  reindexSearch: () => request<{ ok: boolean; vectors_indexed: number }>('/api/v1/search/reindex', { method: 'POST' }),

  // AI
  listProviders: () => request<AIProvider[]>('/api/v1/ai/providers'),
  createProvider: (data: {
    name: string;
    provider_type: string;
    base_url: string;
    api_key?: string;
    models: string[];
    is_enabled?: boolean;
  }) => request<AIProvider>('/api/v1/ai/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id: string, data: Record<string, unknown>) =>
    request<AIProvider>(`/api/v1/ai/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProvider: (id: string) => request<{ ok: boolean }>(`/api/v1/ai/providers/${id}`, { method: 'DELETE' }),
  testProvider: (id: string, model?: string) =>
    request<{ ok: boolean; reply: string; latency_ms: number }>(`/api/v1/ai/providers/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  getRouting: () => request<AIRouting>('/api/v1/ai/routing'),
  saveRouting: (routing: AIRouting) =>
    request<AIRouting>('/api/v1/ai/routing', { method: 'PUT', body: JSON.stringify(routing) }),
  listPromptTemplates: () => request<AIPromptTemplate[]>('/api/v1/ai/prompts'),
  createPromptTemplate: (data: {
    name: string;
    category?: string;
    icon?: string;
    system_prompt?: string;
    user_prompt_template: string;
  }) => request<AIPromptTemplate>('/api/v1/ai/prompts', { method: 'POST', body: JSON.stringify(data) }),
  deletePromptTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/ai/prompts/${id}`, { method: 'DELETE' }),

  // Agent Conversations
  listConversations: () => request<AIConversation[]>('/api/v1/ai/conversations'),
  createConversation: (data: { title?: string; scope_type?: string; scope_target_id?: string | null }) =>
    request<AIConversation>('/api/v1/ai/conversations', { method: 'POST', body: JSON.stringify(data) }),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/ai/conversations/${id}`, { method: 'DELETE' }),
  listMessages: (convId: string) => request<AIMessage[]>(`/api/v1/ai/conversations/${convId}/messages`),
  confirmAction: (convId: string, msgId: string, actionId: string) =>
    request<{ message: AIMessage; action: PendingAction }>(
      `/api/v1/ai/conversations/${convId}/messages/${msgId}/actions/${actionId}/confirm`,
      { method: 'POST' },
    ),
  rejectAction: (convId: string, msgId: string, actionId: string) =>
    request<{ message: AIMessage }>(
      `/api/v1/ai/conversations/${convId}/messages/${msgId}/actions/${actionId}/reject`,
      { method: 'POST' },
    ),

  // Templates
  listTemplates: () => request<TemplateItem[]>('/api/v1/templates'),
  saveAsTemplate: (data: { page_id: string; name: string; category?: string; icon?: string; description?: string }) =>
    request<TemplateItem>('/api/v1/templates/from-page', { method: 'POST', body: JSON.stringify(data) }),
  instantiateTemplate: (templateId: string, parent_id?: string | null) =>
    request<Page>(`/api/v1/templates/${templateId}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ parent_id }),
    }),
  deleteTemplate: (id: string) => request<{ ok: boolean }>(`/api/v1/templates/${id}`, { method: 'DELETE' }),

  // Shares
  getPageShare: (pageId: string) => request<{ share: PublicShare | null }>(`/api/v1/pages/${pageId}/share`),
  putPageShare: (
    pageId: string,
    data: { password?: string; clear_password?: boolean; expires_at?: string | null; is_active: boolean },
  ) => request<{ share: PublicShare }>(`/api/v1/pages/${pageId}/share`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePageShare: (pageId: string) =>
    request<{ ok: boolean }>(`/api/v1/pages/${pageId}/share`, { method: 'DELETE' }),
  getPublicShare: (token: string) => request<PublicSharePayload>(`/api/v1/public/share/${token}`),
  verifyPublicShare: (token: string, password: string) =>
    request<PublicSharePayload>(`/api/v1/public/share/${token}/verify`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // Web Clipper
  clipURL: (data: { url: string; parent_id?: string | null; with_ai_summary: boolean }) =>
    request<{ page: Page; ai_warning?: string }>('/api/v1/clip', { method: 'POST', body: JSON.stringify(data) }),

  // Import / Upload / Restore
  uploadAsset: (file: File, pageId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (pageId) fd.append('page_id', pageId);
    return request<{ id: string; url: string; filename: string; mime_type: string; size_bytes: number }>(
      '/api/v1/assets/upload',
      { method: 'POST', body: fd },
    );
  },
  importMarkdown: (files: File[], parentId?: string | null) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (parentId) fd.append('parent_id', parentId);
    return request<{ pages_created: number; page_ids: string[] }>('/api/v1/import/markdown', {
      method: 'POST',
      body: fd,
    });
  },
  importNotionZip: (file: File, parentId?: string | null) => {
    const fd = new FormData();
    fd.append('file', file);
    if (parentId) fd.append('parent_id', parentId);
    return request<{ pages_created: number; databases_created: number; assets_imported: number; page_ids: string[] }>(
      '/api/v1/import/notion-zip',
      { method: 'POST', body: fd },
    );
  },
  restoreBackup: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ ok: boolean }>('/api/v1/backup/restore', { method: 'POST', body: fd });
  },
};
