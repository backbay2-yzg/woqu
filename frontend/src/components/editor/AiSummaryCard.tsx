import React, { useState } from 'react';
import { ChevronDown, ChevronRight, PlusCircle, RefreshCw, Sparkles } from 'lucide-react';
import { streamSSE } from '@/lib/api';

interface AiSummaryCardProps {
  pageId: string;
  initialSummary: string;
  readonly?: boolean;
  onSavedSummary: (summary: string) => void;
  onInsertCallout?: (summaryText: string) => void;
}

export const AiSummaryCard: React.FC<AiSummaryCardProps> = ({
  pageId,
  initialSummary,
  readonly,
  onSavedSummary,
  onInsertCallout,
}) => {
  const [summary, setSummary] = useState(initialSummary);
  const [expanded, setExpanded] = useState(Boolean(initialSummary));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setSummary(initialSummary);
    if (initialSummary) setExpanded(true);
  }, [pageId, initialSummary]);

  const handleGenerate = async () => {
    setExpanded(true);
    setGenerating(true);
    setError(null);
    setSummary('');
    let acc = '';
    try {
      await streamSSE(
        '/api/v1/ai/summarize',
        { page_id: pageId, save: true },
        {
          onEvent: (evt, data) => {
            if (evt === 'delta' && data && typeof data === 'object' && 'text' in data) {
              acc += String((data as { text: string }).text);
              setSummary(acc);
            } else if (evt === 'done' && data && typeof data === 'object' && 'summary' in data) {
              const fin = String((data as { summary: string }).summary);
              setSummary(fin);
              onSavedSummary(fin);
            } else if (evt === 'error' && data && typeof data === 'object' && 'error' in data) {
              setError(String((data as { error: string }).error));
            }
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成摘要失败');
    } finally {
      setGenerating(false);
    }
  };

  if (readonly && !summary) return null;

  return (
    <div className="my-4 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-white dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-zinc-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 文档摘要与待办提炼</span>
        </button>

        {!readonly && (
          <div className="flex items-center gap-2">
            {summary && onInsertCallout && !generating && (
              <button
                type="button"
                onClick={() => onInsertCallout(summary)}
                className="no-print inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/40 transition"
              >
                <PlusCircle className="w-3 h-3" />
                插入正文
              </button>
            )}
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-medium transition"
            >
              <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
              {generating ? '提炼中...' : summary ? '重新生成' : '一键生成摘要'}
            </button>
          </div>
        )}
      </div>

      {expanded && (summary || error || generating) && (
        <div className="px-4 pb-3.5 pt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-200 border-t border-indigo-100/80 dark:border-indigo-900/40 whitespace-pre-wrap">
          {error ? (
            <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
          ) : (
            summary || '正在阅读文档并提炼要点...'
          )}
        </div>
      )}
    </div>
  );
};
