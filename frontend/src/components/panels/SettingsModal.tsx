import React, { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Palette,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { AIModelTarget, AIProvider, AIRouting } from '@/types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'security' | 'ai_models' | 'prompts';

const PRESETS = [
  { name: 'DeepSeek', type: 'openai_compatible', url: 'https://api.deepseek.com/v1', models: 'deepseek-chat, deepseek-reasoner' },
  { name: 'OpenAI', type: 'openai_compatible', url: 'https://api.openai.com/v1', models: 'gpt-4o-mini, gpt-4o, text-embedding-3-small' },
  { name: '通义千问 (DashScope)', type: 'openai_compatible', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: 'qwen-plus, qwen-max, text-embedding-v3' },
  { name: '硅基流动 SiliconFlow', type: 'openai_compatible', url: 'https://api.siliconflow.cn/v1', models: 'Qwen/Qwen2.5-72B-Instruct, BAAI/bge-m3' },
  { name: '本地 Ollama', type: 'openai_compatible', url: 'http://localhost:11434/v1', models: 'qwen2.5:7b, nomic-embed-text' },
  { name: 'Anthropic Claude', type: 'anthropic', url: 'https://api.anthropic.com', models: 'claude-3-7-sonnet-latest, claude-3-5-haiku-latest' },
  { name: 'Google Gemini', type: 'gemini', url: 'https://generativelanguage.googleapis.com', models: 'gemini-2.5-flash, gemini-2.5-pro, text-embedding-004' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const authStatus = useAppStore((s) => s.authStatus);
  const setAuthStatus = useAppStore((s) => s.setAuthStatus);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const promptTemplates = useAppStore((s) => s.promptTemplates);
  const loadPromptTemplates = useAppStore((s) => s.loadPromptTemplates);

  const [tab, setTab] = useState<SettingsTab>('ai_models');
  const [wsName, setWsName] = useState(authStatus?.workspace_name || '我趣文档');
  const [wsIcon, setWsIcon] = useState(authStatus?.workspace_icon || '✨');
  const [localNoAuth, setLocalNoAuth] = useState(Boolean(authStatus?.local_no_auth));
  const [disablePass, setDisablePass] = useState('');
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');

  // AI Providers & Routing
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [routing, setRouting] = useState<AIRouting>({});
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<'openai_compatible' | 'anthropic' | 'gemini'>('openai_compatible');
  const [pUrl, setPUrl] = useState('https://api.openai.com/v1');
  const [pKey, setPKey] = useState('');
  const [pModels, setPModels] = useState('gpt-4o-mini');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

  // Prompt templates
  const [ptName, setPtName] = useState('');
  const [ptSys, setPtSys] = useState('');
  const [ptUser, setPtUser] = useState('请按要求处理以下文本：\n\n{{selection}}');
  const [msg, setMsg] = useState<string | null>(null);

  const loadAI = async () => {
    try {
      const [provs, rt] = await Promise.all([api.listProviders(), api.getRouting()]);
      setProviders(provs);
      setRouting(rt || {});
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!open) return;
    setWsName(authStatus?.workspace_name || '我趣文档');
    setWsIcon(authStatus?.workspace_icon || '✨');
    setLocalNoAuth(Boolean(authStatus?.local_no_auth));
    setMsg(null);
    setTestResult(null);
    void loadAI();
  }, [open, authStatus]);

  if (!open) return null;

  const allModelChoices: Array<{ providerId: string; label: string; model: string }> = [];
  for (const p of providers) {
    if (!p.is_enabled) continue;
    for (const m of p.models) {
      allModelChoices.push({ providerId: p.id, label: `${p.name} / ${m}`, model: m });
    }
  }

  const encodeTarget = (t?: AIModelTarget | null) => (t ? `${t.provider_id}::${t.model}` : '');
  const decodeTarget = (v: string): AIModelTarget | null => {
    if (!v) return null;
    const [provider_id, ...rest] = v.split('::');
    return { provider_id, model: rest.join('::') };
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[85vh] rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="w-4 h-4 text-blue-600" />
            <span>工作区与 AI 模型中心设置</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          {/* Nav */}
          <div className="md:col-span-3 border-r border-slate-200 dark:border-zinc-800 p-3 space-y-1 bg-slate-50/50 dark:bg-zinc-950/30 text-xs">
            {(
              [
                { id: 'ai_models', label: 'AI 模型中心', icon: <Bot className="w-4 h-4" /> },
                { id: 'prompts', label: 'AI 快捷指令库', icon: <Wand2 className="w-4 h-4" /> },
                { id: 'general', label: '外观与工作区', icon: <Palette className="w-4 h-4" /> },
                { id: 'security', label: '密码与安全', icon: <KeyRound className="w-4 h-4" /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setMsg(null);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition ${
                  tab === item.id
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200'
                    : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="md:col-span-9 p-6 overflow-y-auto space-y-6 text-xs">
            {msg && (
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200 px-3.5 py-2.5">
                {msg}
              </div>
            )}

            {tab === 'general' && (
              <div className="space-y-5 max-w-md">
                <div>
                  <label className="block font-medium text-slate-500 mb-1.5">界面主题</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={`px-4 py-2 rounded-xl border ${
                        theme === 'light'
                          ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                          : 'border-slate-200 dark:border-zinc-700'
                      }`}
                    >
                      ☀️ 浅色清透
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={`px-4 py-2 rounded-xl border ${
                        theme === 'dark'
                          ? 'border-blue-500 bg-blue-950/60 text-blue-300 font-medium'
                          : 'border-slate-200 dark:border-zinc-700'
                      }`}
                    >
                      🌙 深色护眼
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block font-medium text-slate-500 mb-1">图标</label>
                    <input
                      value={wsIcon}
                      onChange={(e) => setWsIcon(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-center text-base"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block font-medium text-slate-500 mb-1">工作区名称</label>
                    <input
                      value={wsName}
                      onChange={(e) => setWsName(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.updateSettings({ workspace_name: wsName, workspace_icon: wsIcon });
                    setAuthStatus(res.status);
                    setMsg('工作区设置已更新');
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  保存外观设置
                </button>
              </div>
            )}

            {tab === 'security' && (
              <div className="space-y-6 max-w-md">
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3">
                  <div className="font-semibold">本机免登录模式</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localNoAuth}
                      onChange={(e) => setLocalNoAuth(e.target.checked)}
                    />
                    <span>开启免登录直接进入工作区（仅建议本机 localhost 个人使用）</span>
                  </label>
                  {!localNoAuth && (
                    <input
                      type="password"
                      value={disablePass}
                      onChange={(e) => setDisablePass(e.target.value)}
                      placeholder="若此前未设置密码，请输入至少 4 位新密码..."
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5"
                    />
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await api.updateSettings({
                          local_no_auth: localNoAuth,
                          password_for_disable: disablePass,
                        });
                        setAuthStatus(res.status);
                        setMsg('安全模式已更新');
                      } catch (err) {
                        setMsg(err instanceof Error ? err.message : '更新失败');
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium"
                  >
                    应用安全模式
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3">
                  <div className="font-semibold">修改登录密码</div>
                  <input
                    type="password"
                    value={curPass}
                    onChange={(e) => setCurPass(e.target.value)}
                    placeholder="当前密码（首次未设密码可留空）"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5"
                  />
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder="新密码（至少 4 位）"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.changePassword(curPass, newPass);
                        setCurPass('');
                        setNewPass('');
                        setMsg('密码修改成功');
                      } catch (err) {
                        setMsg(err instanceof Error ? err.message : '修改密码失败');
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                  >
                    更新密码
                  </button>
                </div>
              </div>
            )}

            {tab === 'ai_models' && (
              <div className="space-y-6">
                {/* Existing providers */}
                <div className="space-y-2.5">
                  <div className="font-semibold text-sm">已配置模型提供商 ({providers.length})</div>
                  {providers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-700 p-4 text-slate-400">
                      尚未添加大模型提供商，请在下方选择预设快速接入。
                    </div>
                  ) : (
                    providers.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="font-semibold flex items-center gap-2">
                            <span>{p.name}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-[10px] font-normal">
                              {p.provider_type}
                            </span>
                            {p.has_api_key && (
                              <span className="text-[10px] font-mono text-emerald-600">{p.api_key_masked}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {p.base_url} · 模型: {p.models.join(', ')}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={testingId === p.id}
                            onClick={async () => {
                              setTestingId(p.id);
                              setTestResult(null);
                              try {
                                const r = await api.testProvider(p.id, p.models[0]);
                                setTestResult(`✅ ${p.name} 连通成功 (${r.latency_ms}ms): ${r.reply}`);
                              } catch (err) {
                                setTestResult(`❌ ${p.name} 测试失败: ${err instanceof Error ? err.message : '错误'}`);
                              } finally {
                                setTestingId(null);
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800"
                          >
                            {testingId === p.id ? '测试中...' : '测试连接'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.deleteProvider(p.id);
                              await loadAI();
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {testResult && (
                    <div className="rounded-xl bg-slate-100 dark:bg-zinc-800 px-3 py-2 text-xs">{testResult}</div>
                  )}
                </div>

                {/* Add new provider */}
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3 bg-slate-50/40 dark:bg-zinc-950/30">
                  <div className="font-semibold">添加模型提供商（支持加密存储 API Key）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((pre) => (
                      <button
                        key={pre.name}
                        type="button"
                        onClick={() => {
                          setPName(pre.name);
                          setPType(pre.type as 'openai_compatible' | 'anthropic' | 'gemini');
                          setPUrl(pre.url);
                          setPModels(pre.models);
                        }}
                        className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-400 text-[11px]"
                      >
                        + {pre.name}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-500 mb-1">显示名称</label>
                      <input
                        value={pName}
                        onChange={(e) => setPName(e.target.value)}
                        placeholder="如 DeepSeek"
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">协议类型</label>
                      <select
                        value={pType}
                        onChange={(e) => setPType(e.target.value as 'openai_compatible' | 'anthropic' | 'gemini')}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                      >
                        <option value="openai_compatible">OpenAI 兼容 (DeepSeek/通义/Ollama等)</option>
                        <option value="anthropic">Anthropic Claude 原生</option>
                        <option value="gemini">Google Gemini 原生</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">Base URL</label>
                      <input
                        value={pUrl}
                        onChange={(e) => setPUrl(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">API Key（本地 Ollama 可留空）</label>
                      <input
                        type="password"
                        value={pKey}
                        onChange={(e) => setPKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">模型列表（英文逗号分隔）</label>
                    <input
                      value={pModels}
                      onChange={(e) => setPModels(e.target.value)}
                      placeholder="deepseek-chat, gpt-4o-mini"
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!pName.trim()) return;
                      const modelsArr = pModels
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      await api.createProvider({
                        name: pName.trim(),
                        provider_type: pType,
                        base_url: pUrl.trim(),
                        api_key: pKey.trim(),
                        models: modelsArr,
                      });
                      setPName('');
                      setPKey('');
                      await loadAI();
                      setMsg('模型提供商已加密保存');
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    保存提供商
                  </button>
                </div>

                {/* Task Routing */}
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">按任务路由模型</div>
                    <button
                      type="button"
                      disabled={reindexing}
                      onClick={async () => {
                        setReindexing(true);
                        try {
                          const r = await api.reindexSearch();
                          setMsg(`全库检索索引重建完成，已处理 ${r.vectors_indexed} 个向量分块`);
                        } catch (err) {
                          setMsg(err instanceof Error ? err.message : '索引重建失败（若未配置 Embedding 模型可忽略）');
                        } finally {
                          setReindexing(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800"
                    >
                      <RefreshCw className={`w-3 h-3 ${reindexing ? 'animate-spin' : ''}`} />
                      重建全库向量索引
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        { key: 'chat', label: 'RAG 知识库对话 & Agent' },
                        { key: 'writing', label: '划词润色 / 斜杠 AI 写作' },
                        { key: 'summary', label: '页面摘要 & 待办提取' },
                        { key: 'autofill', label: '多维表 AI 自动填充' },
                        { key: 'embedding', label: '向量 Embedding 模型（可选）' },
                      ] as const
                    ).map((slot) => (
                      <div key={slot.key}>
                        <label className="block text-slate-500 mb-1">{slot.label}</label>
                        <select
                          value={encodeTarget(routing[slot.key])}
                          onChange={(e) =>
                            setRouting((prev) => ({ ...prev, [slot.key]: decodeTarget(e.target.value) }))
                          }
                          className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
                        >
                          <option value="">自动回退 / 未指定</option>
                          {allModelChoices.map((c) => (
                            <option key={`${c.providerId}::${c.model}`} value={`${c.providerId}::${c.model}`}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.saveRouting(routing);
                      setMsg('任务模型路由已保存');
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    保存模型路由
                  </button>
                </div>
              </div>
            )}

            {tab === 'prompts' && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="font-semibold text-sm">内置与自定义 AI 快捷指令 ({promptTemplates.length})</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {promptTemplates.map((pt) => (
                      <div
                        key={pt.id}
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-1.5">
                            <span>{pt.icon}</span>
                            <span>{pt.name}</span>
                            {pt.is_builtin && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-400">
                                内置
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                            {pt.system_prompt || pt.user_prompt_template}
                          </div>
                        </div>
                        {!pt.is_builtin && (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.deletePromptTemplate(pt.id);
                              await loadPromptTemplates();
                            }}
                            className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3 bg-slate-50/40 dark:bg-zinc-950/30">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    新增自定义 Prompt 模板（在划词菜单中直接调用）
                  </div>
                  <input
                    value={ptName}
                    onChange={(e) => setPtName(e.target.value)}
                    placeholder="指令名称，例如：转换为周报亮点"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                  />
                  <input
                    value={ptSys}
                    onChange={(e) => setPtSys(e.target.value)}
                    placeholder="系统人设指令（可选）"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5"
                  />
                  <textarea
                    rows={3}
                    value={ptUser}
                    onChange={(e) => setPtUser(e.target.value)}
                    placeholder="Prompt 内容（使用 {{selection}} 占位选中文本）"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!ptName.trim() || !ptUser.trim()) return;
                      await api.createPromptTemplate({
                        name: ptName.trim(),
                        category: 'custom',
                        icon: '⚡',
                        system_prompt: ptSys.trim(),
                        user_prompt_template: ptUser.trim(),
                      });
                      setPtName('');
                      setPtSys('');
                      await loadPromptTemplates();
                      setMsg('自定义 Prompt 已添加');
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-medium"
                  >
                    添加指令
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
