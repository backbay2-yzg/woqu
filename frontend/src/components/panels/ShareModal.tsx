import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Lock, Share2, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { PublicShare } from '@/types';

interface ShareModalProps {
  open: boolean;
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ open, pageId, pageTitle, onClose }) => {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api.getPageShare(pageId);
      setShare(res.share);
      if (res.share) {
        setIsActive(res.share.is_active);
        setExpiresAt(res.share.expires_at ? res.share.expires_at.slice(0, 10) : '');
      } else {
        setIsActive(true);
        setExpiresAt('');
      }
      setPassword('');
      setClearPassword(false);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open && pageId) void load();
  }, [open, pageId]);

  if (!open) return null;

  const shareURL = share ? `${window.location.origin}/share/${share.token}` : '';

  const handleSave = async () => {
    setSaving(true);
    try {
      const expISO = expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null;
      const res = await api.putPageShare(pageId, {
        password: password.trim(),
        clear_password: clearPassword,
        expires_at: expISO,
        is_active: isActive,
      });
      setShare(res.share);
      setPassword('');
      setClearPassword(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    await api.deletePageShare(pageId);
    setShare(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold truncate">
            <Share2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate">公开只读分享 — {pageTitle}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {share ? (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
                  <Globe className="w-3.5 h-3.5" />
                  {share.is_active ? '分享已开启' : '分享已暂停'}
                </span>
                <span className="text-slate-400">累计访问 {share.view_count} 次</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  readOnly
                  value={shareURL}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(shareURL);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <a
                  href={shareURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100"
                  title="在新标签页预览"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ) : (
            <div className="text-slate-500 dark:text-zinc-400 leading-relaxed">
              开启后将生成独立的只读公开网址，对方无需登录即可阅读此文档（及其中嵌入的多维表视图）。
            </div>
          )}

          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-medium">启用公开链接访问</span>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4"
              />
            </label>

            <div>
              <label className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-zinc-300 mb-1">
                <Lock className="w-3.5 h-3.5" />
                访问密码（留空则无需密码）
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setClearPassword(false);
                }}
                placeholder={share?.has_password ? '已设置密码（输入新密码可覆盖）' : '设置访问密码...'}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 outline-none"
              />
              {share?.has_password && (
                <label className="inline-flex items-center gap-1.5 mt-1.5 text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearPassword}
                    onChange={(e) => setClearPassword(e.target.checked)}
                  />
                  <span>清除已有访问密码</span>
                </label>
              )}
            </div>

            <div>
              <label className="block font-medium text-slate-600 dark:text-zinc-300 mb-1">
                过期日期（可选）
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800">
            {share ? (
              <button
                type="button"
                onClick={() => void handleRevoke()}
                className="inline-flex items-center gap-1 text-rose-600 hover:underline"
              >
                <Trash2 className="w-3.5 h-3.5" />
                彻底撤销分享链接
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium"
            >
              {saving ? '保存中...' : share ? '更新分享设置' : '生成公开分享链接'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
