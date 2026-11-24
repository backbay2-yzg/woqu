import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Moon, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { DatabaseFull, PublicSharePayload } from '@/types';
import { BlockEditor } from '../editor/BlockEditor';
import { DatabaseContainer } from '../database/DatabaseContainer';
import { AiSummaryCard } from '../editor/AiSummaryCard';

export const PublicSharePage: React.FC = () => {
  const { token = '' } = useParams();
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getPublicShare(token)
      .then(setPayload)
      .catch((err) => setError(err instanceof Error ? err.message : '链接无效或已过期'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.verifyPublicShare(token, password);
      setPayload(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码不正确');
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">正在加载分享页面...</div>;
  }

  if (error && !payload) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 p-8 text-center space-y-2 max-w-md">
          <div className="text-3xl">🔒</div>
          <div className="text-base font-semibold">无法访问分享页面</div>
          <div className="text-xs text-slate-500">{error}</div>
        </div>
      </div>
    );
  }

  if (payload?.needs_password) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#191919]">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-6 space-y-4"
        >
          <div className="text-center space-y-1">
            <div className="text-2xl">{payload.icon || '📄'}</div>
            <h1 className="text-base font-bold">{payload.title || '受保护的分享文档'}</h1>
            <p className="text-xs text-slate-400">请输入访问密码查看内容</p>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码..."
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent pl-9 pr-3 py-2 text-sm outline-none"
            />
          </div>
          {error && <div className="text-xs text-rose-500">{error}</div>}
          <button
            type="submit"
            className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
          >
            解锁查看
          </button>
        </form>
      </div>
    );
  }

  const page = payload?.page;
  if (!page) return null;

  const inlineMap = new Map<string, DatabaseFull>();
  for (const d of payload.inline_databases || []) {
    inlineMap.set(d.database.id, d);
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#191919]">
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3 border-b border-slate-200/80 dark:border-zinc-800 bg-white/85 dark:bg-[#191919]/85 backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-medium truncate">
          <span>{page.icon || '📄'}</span>
          <span className="truncate">{page.title}</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-[10px] text-slate-500">
            只读公开分享
          </span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className={`${page.is_full_width ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-6 py-10 space-y-6`}>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <span>{page.icon}</span>
          <span>{page.title}</span>
        </h1>

        {page.summary && (
          <AiSummaryCard
            pageId={page.id}
            initialSummary={page.summary}
            readonly
            onSavedSummary={() => {}}
          />
        )}

        {page.is_database && payload.database ? (
          <DatabaseContainer databaseId={payload.database.database.id} initialData={payload.database} readonly />
        ) : (
          <BlockEditor
            key={page.id}
            pageId={page.id}
            initialContent={page.content_json}
            editable={false}
            renderInlineDatabase={(dbId) => {
              const initDB = inlineMap.get(dbId);
              return initDB ? <DatabaseContainer databaseId={dbId} initialData={initDB} readonly /> : null;
            }}
          />
        )}
      </main>
    </div>
  );
};
