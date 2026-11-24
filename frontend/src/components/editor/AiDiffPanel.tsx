import React, { useMemo } from 'react';
import { Check, CornerDownLeft, RefreshCw, Sparkles, X } from 'lucide-react';

interface DiffToken {
  type: 'same' | 'del' | 'add';
  text: string;
}

// Simple token-level LCS diff suitable for Chinese characters and English words
function computeDiff(orig: string, next: string): DiffToken[] {
  const splitTokens = (s: string) => s.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9_]+|\s+|./g) || [];
  const a = splitTokens(orig);
  const b = splitTokens(next);

  // Guard huge inputs from O(N*M) matrix memory
  if (a.length * b.length > 60000) {
    return [
      { type: 'del', text: orig },
      { type: 'add', text: next },
    ];
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      tokens.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: 'del', text: a[i] });
      i++;
    } else {
      tokens.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) tokens.push({ type: 'del', text: a[i++] });
  while (j < n) tokens.push({ type: 'add', text: b[j++] });
  return tokens;
}

interface AiDiffPanelProps {
  title: string;
  originalText: string;
  generatedText: string;
  streaming: boolean;
  error?: string | null;
  onReplace: () => void;
  onInsertBelow: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export const AiDiffPanel: React.FC<AiDiffPanelProps> = ({
  title,
  originalText,
  generatedText,
  streaming,
  error,
  onReplace,
  onInsertBelow,
  onRetry,
  onDiscard,
}) => {
  const diffTokens = useMemo(() => {
    if (!originalText) return [];
    return computeDiff(originalText, generatedText);
  }, [originalText, generatedText]);

  return (
    <div className="my-3 rounded-xl border border-purple-200 dark:border-purple-800/70 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/50 dark:to-indigo-950/40 border-b border-purple-100 dark:border-purple-800/50">
        <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-300">
          <Sparkles className={`w-3.5 h-3.5 ${streaming ? 'animate-spin' : ''}`} />
          <span>{title}</span>
          {streaming && <span className="text-[11px] font-normal opacity-80">正在生成...</span>}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-slate-400"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3.5 space-y-2.5 max-h-72 overflow-y-auto text-sm leading-relaxed">
        {error ? (
          <div className="text-rose-600 dark:text-rose-400 text-xs bg-rose-50 dark:bg-rose-950/40 rounded-lg p-2.5">
            {error}
          </div>
        ) : (
          <>
            {originalText && !streaming && (
              <div className="rounded-lg bg-slate-50 dark:bg-zinc-800/50 p-2.5 text-xs leading-relaxed">
                <div className="text-[11px] text-slate-400 mb-1">修改对比 (Diff 预览)：</div>
                <div className="whitespace-pre-wrap">
                  {diffTokens.map((tok, i) => {
                    if (tok.type === 'del') {
                      return (
                        <span
                          key={i}
                          className="bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 line-through px-0.5 rounded"
                        >
                          {tok.text}
                        </span>
                      );
                    }
                    if (tok.type === 'add') {
                      return (
                        <span
                          key={i}
                          className="bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 px-0.5 rounded font-medium"
                        >
                          {tok.text}
                        </span>
                      );
                    }
                    return <span key={i}>{tok.text}</span>;
                  })}
                </div>
              </div>
            )}

            <div className="whitespace-pre-wrap text-slate-800 dark:text-zinc-100">
              {generatedText || (streaming ? '思考中...' : '')}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-3.5 py-2 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/80">
        {originalText && (
          <button
            type="button"
            disabled={streaming || !generatedText}
            onClick={onReplace}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium transition"
          >
            <Check className="w-3.5 h-3.5" />
            替换选中
          </button>
        )}
        <button
          type="button"
          disabled={streaming || !generatedText}
          onClick={onInsertBelow}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
          插入下方
        </button>
        <button
          type="button"
          disabled={streaming}
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs transition"
        >
          <RefreshCw className="w-3 h-3" />
          重新生成
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition"
        >
          丢弃
        </button>
      </div>
    </div>
  );
};
