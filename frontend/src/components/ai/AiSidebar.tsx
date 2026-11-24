import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  History,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { api, streamSSE } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { AIConversation, AIMessage, Citation, PendingAction } from '@/types';

interface AiSidebarProps {
  onClose: () => void;
  onNavigatePage: (pageId: string) => void;
}

export const AiSidebar: React.FC<AiSidebarProps> = ({ onClose, onNavigatePage }) => {
  const activePage = useAppStore((s) => s.activePage);
  const refreshActivePage = useAppStore((s) => s.refreshActivePage);

  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [scopeType, setScopeType] = useState<'current_page' | 'folder' | 'all'>('all');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [liveCitations, setLiveCitations] = useState<Citation[]>([]);
  const [liveActions, setLiveActions] = useState<PendingAction[]>([]);
  const [toolStatus, setToolStatus] = useState<string>('');
  const [showConvList, setShowConvList] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveAssistantText, liveActions]);

  const loadConversations = async () => {
    try {
      const list = await api.listConversations();
      setConversations(list);
      if (list.length > 0) {
        setActiveConvId(list[0].id);
        const msgs = await api.listMessages(list[0].id);
        setMessages(msgs);
      }
    } catch {
      // ignore
    }
  };

  const handleSelectConv = async (id: string) => {
    setActiveConvId(id);
    setShowConvList(false);
    const msgs = await api.listMessages(id);
    setMessages(msgs);
  };

  const handleNewConv = async () => {
    const conv = await api.createConversation({
      title: '新对话',
      scope_type: scopeType,
      scope_target_id: activePage?.id || null,
    });
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
    setShowConvList(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    let convId = activeConvId;
    if (!convId) {
      const conv = await api.createConversation({
        title: text.slice(0, 20),
        scope_type: scopeType,
        scope_target_id: activePage?.id || null,
      });
      setConversations((prev) => [conv, ...prev]);
      convId = conv.id;
      setActiveConvId(conv.id);
    }

    const tempUserMsg: AIMessage = {
      id: `local-${Date.now()}`,
      conversation_id: convId,
      role: 'user',
      content: text,
      citations: [],
      pending_actions: [],
      action_status: 'none',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setInput('');
    setStreaming(true);
    setLiveAssistantText('');
    setLiveCitations([]);
    setLiveActions([]);
    setToolStatus('');

    let acc = '';
    try {
      await streamSSE(
        `/api/v1/ai/conversations/${convId}/messages`,
        {
          content: text,
          scope_type: scopeType,
          scope_target_id: activePage?.id || '',
        },
        {
          onEvent: (evt, data) => {
            if (evt === 'citations' && Array.isArray(data)) {
              setLiveCitations(data as Citation[]);
            } else if (evt === 'tool_status' && data && typeof data === 'object') {
              const lbl = (data as { label?: string }).label || '调用工具中';
              setToolStatus(`正在${lbl}...`);
            } else if (evt === 'delta' && data && typeof data === 'object' && 'text' in data) {
              setToolStatus('');
              acc += String((data as { text: string }).text);
              setLiveAssistantText(acc);
            } else if (evt === 'pending_actions' && Array.isArray(data)) {
              setLiveActions(data as PendingAction[]);
            } else if (evt === 'done' && data && typeof data === 'object') {
              const saved = data as AIMessage;
              setMessages((prev) => [...prev, saved]);
              setLiveAssistantText('');
              setLiveCitations([]);
              setLiveActions([]);
              setToolStatus('');
              void api.listConversations().then(setConversations).catch(() => {});
            } else if (evt === 'error' && data && typeof data === 'object' && 'error' in data) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `err-${Date.now()}`,
                  conversation_id: convId,
                  role: 'assistant',
                  content: `⚠️ ${String((data as { error: string }).error)}`,
                  citations: [],
                  pending_actions: [],
                  action_status: 'none',
                  created_at: new Date().toISOString(),
                },
              ]);
            }
          },
        },
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversation_id: convId,
          role: 'assistant',
          content: `⚠️ ${err instanceof Error ? err.message : '对话请求失败'}`,
          citations: [],
          pending_actions: [],
          action_status: 'none',
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setStreaming(false);
      setToolStatus('');
      setLiveAssistantText('');
    }
  };

  const handleConfirm = async (msgId: string, actionId: string) => {
    try {
      const res = await api.confirmAction(activeConvId, msgId, actionId);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message : m)));
      await refreshActivePage();
    } catch (err) {
      alert(err instanceof Error ? err.message : '执行操作失败');
    }
  };

  const handleReject = async (msgId: string, actionId: string) => {
    try {
      const res = await api.rejectAction(activeConvId, msgId, actionId);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message : m)));
    } catch {
      // ignore
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#202020] border-l border-slate-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span>AI 知识库 Agent</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowConvList((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
            title="历史对话"
          >
            <History className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleNewConv()}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
            title="新建对话"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* History drawer */}
      {showConvList && (
        <div className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 max-h-56 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-xs text-slate-400 p-2 text-center">暂无历史对话</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => void handleSelectConv(c.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                  c.id === activeConvId
                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-200'
                    : 'hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="truncate flex-1">{c.title}</span>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.deleteConversation(c.id);
                    const next = conversations.filter((x) => x.id !== c.id);
                    setConversations(next);
                    if (activeConvId === c.id) {
                      setActiveConvId(next[0]?.id || '');
                      setMessages([]);
                    }
                  }}
                  className="p-1 text-slate-400 hover:text-rose-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Scope Bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 text-[11px]">
        <span className="text-slate-400 mr-1">检索范围:</span>
        {(
          [
            { k: 'current_page', l: '当前页' },
            { k: 'folder', l: '当前目录' },
            { k: 'all', l: '全部知识库' },
          ] as const
        ).map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => setScopeType(s.k)}
            className={`px-2 py-0.5 rounded-full transition ${
              scopeType === s.k
                ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-200 font-medium'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
            }`}
          >
            {s.l}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="py-8 px-2 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-2xl bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center text-purple-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs font-medium text-slate-600 dark:text-zinc-300">
              问我任何知识库问题，或让我帮你整理文档与任务
            </div>
            <div className="space-y-1.5 text-[11px]">
              {[
                '帮我总结当前页面的核心重点和待办',
                '根据全库笔记整理一份本周进展报告并新建页面',
                '把当前页面的行动项添加到项目任务看板数据库',
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setInput(q)}
                  className="block w-full text-left px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 hover:border-purple-300 dark:hover:border-purple-700 text-slate-500 dark:text-zinc-400 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            onNavigatePage={onNavigatePage}
            onConfirm={(actionId) => void handleConfirm(m.id, actionId)}
            onReject={(actionId) => void handleReject(m.id, actionId)}
          />
        ))}

        {streaming && (
          <div className="space-y-2">
            {liveCitations.length > 0 && (
              <CitationPills citations={liveCitations} onNavigatePage={onNavigatePage} />
            )}
            {toolStatus && (
              <div className="text-[11px] text-purple-600 dark:text-purple-300 flex items-center gap-1.5 animate-pulse">
                <Sparkles className="w-3 h-3" />
                <span>{toolStatus}</span>
              </div>
            )}
            {liveAssistantText && (
              <div className="rounded-xl bg-slate-50 dark:bg-zinc-800/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {liveAssistantText}
              </div>
            )}
            {liveActions.map((act) => (
              <ActionCard key={act.id} action={act} disabled />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-200 dark:border-zinc-800">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900 px-3 py-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="提问知识库或下达 Agent 任务 (Enter 发送)..."
            className="flex-1 bg-transparent text-xs outline-none resize-none leading-relaxed"
          />
          <button
            type="button"
            disabled={streaming || !input.trim()}
            onClick={() => void handleSend()}
            className="p-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white transition shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{
  msg: AIMessage;
  onNavigatePage: (pageId: string) => void;
  onConfirm: (actionId: string) => void;
  onReject: (actionId: string) => void;
}> = ({ msg, onNavigatePage, onConfirm, onReject }) => {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 text-white px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {msg.citations && msg.citations.length > 0 && (
        <CitationPills citations={msg.citations} onNavigatePage={onNavigatePage} />
      )}
      {msg.content && (
        <div className="rounded-xl bg-slate-50 dark:bg-zinc-800/60 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-zinc-100">
          {msg.content}
        </div>
      )}
      {msg.pending_actions?.map((act) => (
        <ActionCard
          key={act.id}
          action={act}
          onConfirm={() => onConfirm(act.id)}
          onReject={() => onReject(act.id)}
          onNavigateResult={(id) => onNavigatePage(id)}
        />
      ))}
    </div>
  );
};

const CitationPills: React.FC<{
  citations: Citation[];
  onNavigatePage: (pageId: string) => void;
}> = ({ citations, onNavigatePage }) => (
  <div className="flex flex-wrap gap-1">
    {citations.map((c) => (
      <button
        key={`${c.index}-${c.page_id}`}
        type="button"
        onClick={() => onNavigatePage(c.page_id)}
        title={c.snippet}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200/70 dark:border-blue-800/60 text-[11px] text-blue-700 dark:text-blue-300 hover:underline"
      >
        <span>[{c.index}]</span>
        <FileText className="w-2.5 h-2.5" />
        <span className="truncate max-w-32">{c.page_title}</span>
      </button>
    ))}
  </div>
);

const ActionCard: React.FC<{
  action: PendingAction;
  disabled?: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
  onNavigateResult?: (pageId: string) => void;
}> = ({ action, disabled, onConfirm, onReject, onNavigateResult }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-amber-900 dark:text-amber-200">{action.description}</div>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
            action.status === 'executed'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : action.status === 'rejected'
                ? 'bg-slate-200 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400'
                : action.status === 'failed'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-200/70 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
          }`}
        >
          {action.status === 'executed'
            ? '已执行'
            : action.status === 'rejected'
              ? '已取消'
              : action.status === 'failed'
                ? '失败'
                : '待确认'}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-slate-500 hover:underline"
      >
        {expanded ? '收起变更详情' : '查看变更预览'}
      </button>

      {expanded && (
        <pre className="rounded-lg bg-white/80 dark:bg-zinc-900 p-2 text-[11px] overflow-x-auto max-h-40 whitespace-pre-wrap">
          {JSON.stringify(action.args, null, 2)}
        </pre>
      )}

      {action.result_note && (
        <div className="text-[11px] text-slate-600 dark:text-zinc-300 flex items-center justify-between">
          <span>{action.result_note}</span>
          {action.result_id && onNavigateResult && (
            <button
              type="button"
              onClick={() => onNavigateResult(action.result_id!)}
              className="text-blue-600 hover:underline"
            >
              前往查看
            </button>
          )}
        </div>
      )}

      {action.status === 'pending' && !disabled && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            确认执行
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-[11px]"
          >
            <XCircle className="w-3.5 h-3.5" />
            取消
          </button>
        </div>
      )}
    </div>
  );
};
