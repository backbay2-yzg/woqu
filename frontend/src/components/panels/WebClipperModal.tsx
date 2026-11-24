import React, { useState } from 'react';
import { Globe, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

interface WebClipperModalProps {
  open: boolean;
  onClose: () => void;
}

export const WebClipperModal: React.FC<WebClipperModalProps> = ({ open, onClose }) => {
  const loadTree = useAppStore((s) => s.loadTree);
  const openPage = useAppStore((s) => s.openPage);

  const [url, setUrl] = useState('');
  const [withAI, setWithAI] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleClip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.clipURL({ url: url.trim(), with_ai_summary: withAI });
      await loadTree();
      await openPage(res.page.id);
      if (res.ai_warning) alert(res.ai_warning);
      setUrl('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网页剪藏失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="w-4 h-4 text-sky-500" />
            <span>网页智能剪藏</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleClip} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">文章或网页地址 (URL)</label>
            <input
              autoFocus
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent px-3.5 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={withAI} onChange={(e) => setWithAI(e.target.checked)} />
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>剪藏后顺手使用 AI 生成核心摘要与行动项</span>
          </label>

          {error && (
            <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded-lg p-2.5">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
            >
              {loading ? '正在抓取并转换...' : '立即剪藏'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
