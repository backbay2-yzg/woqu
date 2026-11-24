import React, { useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { AuthStatus } from '@/types';

interface AuthPagesProps {
  status: AuthStatus;
}

export const AuthPages: React.FC<AuthPagesProps> = ({ status }) => {
  const setAuthStatus = useAppStore((s) => s.setAuthStatus);

  const [workspaceName, setWorkspaceName] = useState('我趣知识库');
  const [workspaceIcon, setWorkspaceIcon] = useState('✨');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localNoAuth, setLocalNoAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!localNoAuth) {
      if (password.length < 4) {
        setError('密码长度至少为 4 位');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    setLoading(true);
    try {
      const next = await api.authSetup({
        password,
        workspace_name: workspaceName,
        workspace_icon: workspaceIcon,
        local_no_auth: localNoAuth,
      });
      setAuthStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const next = await api.authLogin(password);
      setAuthStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/40 dark:from-[#161616] dark:via-[#1b1b1d] dark:to-[#191919] p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl p-7 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-2xl">
            {status.initialized ? status.workspace_icon : '✨'}
          </div>
          <h1 className="text-xl font-bold">
            {status.initialized ? status.workspace_name : '欢迎初始化「我趣文档 Woqu」'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            {status.initialized
              ? '输入工作区管理密码解锁你的私有知识库'
              : '自托管私有化知识库 · 多维数据库 · AI 智能写作'}
          </p>
        </div>

        {!status.initialized ? (
          <form onSubmit={handleSetup} className="space-y-4 text-xs">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">图标</label>
                <input
                  value={workspaceIcon}
                  onChange={(e) => setWorkspaceIcon(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-center text-base outline-none"
                />
              </div>
              <div className="col-span-3">
                <label className="block text-slate-500 mb-1">工作区名称</label>
                <input
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-800 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localNoAuth}
                onChange={(e) => setLocalNoAuth(e.target.checked)}
              />
              <span>本机免登录模式（适合纯本地 localhost 个人使用，可随时在设置中改回密码登录）</span>
            </label>

            {!localNoAuth && (
              <>
                <div>
                  <label className="block text-slate-500 mb-1">设置访问密码</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 4 位密码"
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent px-3.5 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">确认访问密码</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent px-3.5 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}

            {error && <div className="text-rose-600 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? '正在初始化...' : '创建并进入工作区'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-500 mb-1.5">登录密码</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  autoFocus
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码..."
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent pl-10 pr-4 py-2.5 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {error && <div className="text-rose-600 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              {loading ? '验证中...' : '解锁工作区'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
