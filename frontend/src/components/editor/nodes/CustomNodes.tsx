import React, { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import katex from 'katex';
import mermaid from 'mermaid';
import {
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  FileIcon,
  Globe,
  Sigma,
  Sparkles,
  Code2,
  Eye,
} from 'lucide-react';

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

const lowlight = createLowlight(common);

export const CALLOUT_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  blue: { bg: 'bg-blue-50/90 dark:bg-blue-950/35', border: 'border-blue-200 dark:border-blue-800/60', label: '蓝' },
  gray: { bg: 'bg-slate-100/90 dark:bg-zinc-800/60', border: 'border-slate-200 dark:border-zinc-700', label: '灰' },
  green: { bg: 'bg-emerald-50/90 dark:bg-emerald-950/35', border: 'border-emerald-200 dark:border-emerald-800/60', label: '绿' },
  yellow: { bg: 'bg-amber-50/90 dark:bg-amber-950/35', border: 'border-amber-200 dark:border-amber-800/60', label: '黄' },
  orange: { bg: 'bg-orange-50/90 dark:bg-orange-950/35', border: 'border-orange-200 dark:border-orange-800/60', label: '橙' },
  red: { bg: 'bg-rose-50/90 dark:bg-rose-950/35', border: 'border-rose-200 dark:border-rose-800/60', label: '红' },
  purple: { bg: 'bg-purple-50/90 dark:bg-purple-950/35', border: 'border-purple-200 dark:border-purple-800/60', label: '紫' },
  pink: { bg: 'bg-pink-50/90 dark:bg-pink-950/35', border: 'border-pink-200 dark:border-pink-800/60', label: '粉' },
};

const CALLOUT_ICONS = ['💡', '📌', '⚠️', '✅', '🔥', '🚀', '💬', '✨'];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const color = (node.attrs.color as string) || 'blue';
  const icon = (node.attrs.icon as string) || '💡';
  const style = CALLOUT_COLORS[color] || CALLOUT_COLORS.blue;
  const [showPicker, setShowPicker] = useState(false);

  return (
    <NodeViewWrapper
      className={`my-2 rounded-lg border px-4 py-3 flex items-start gap-3 relative ${style.bg} ${style.border}`}
    >
      <div className="relative select-none" contentEditable={false}>
        <button
          type="button"
          onClick={() => editor.isEditable && setShowPicker((v) => !v)}
          className="text-xl leading-none p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
          title="切换图标与背景色"
        >
          {icon}
        </button>
        {showPicker && editor.isEditable && (
          <div className="absolute left-0 top-9 z-30 w-56 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-2.5 space-y-2">
            <div className="flex flex-wrap gap-1">
              {CALLOUT_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => {
                    updateAttributes({ icon: ic });
                    setShowPicker(false);
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-base"
                >
                  {ic}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100 dark:border-zinc-800">
              {Object.entries(CALLOUT_COLORS).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    updateAttributes({ color: key });
                    setShowPicker(false);
                  }}
                  className={`w-6 h-6 rounded-full border ${c.bg} ${c.border} ${
                    color === key ? 'ring-2 ring-blue-500' : ''
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

export const CalloutExtension = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      icon: { default: '💡' },
      color: { default: 'blue' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const open = node.attrs.open !== false;
  const summary = (node.attrs.summary as string) || '';

  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-slate-200/80 dark:border-zinc-700/70 bg-slate-50/40 dark:bg-zinc-800/30 px-3 py-2">
      <div className="flex items-center gap-1.5" contentEditable={false}>
        <button
          type="button"
          onClick={() => updateAttributes({ open: !open })}
          className="p-0.5 rounded hover:bg-slate-200/70 dark:hover:bg-zinc-700 transition text-slate-500"
        >
          <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <input
          type="text"
          value={summary}
          readOnly={!editor.isEditable}
          placeholder="折叠标题（点击输入）..."
          onChange={(e) => updateAttributes({ summary: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
        />
      </div>
      {open && (
        <div className="pl-6 pt-1.5">
          <NodeViewContent />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ToggleExtension = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      summary: { default: '点击展开详情' },
      open: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});

export const ColumnExtension = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
        class: 'flex-1 min-w-0 rounded-lg border border-dashed border-slate-200/70 dark:border-zinc-700/60 p-2.5',
      }),
      0,
    ];
  },
});

export const ColumnsExtension = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'columns',
        class: 'my-3 grid grid-cols-1 md:grid-flow-col md:auto-cols-fr gap-3',
      }),
      0,
    ];
  },
});

const CODE_LANGUAGES = [
  { value: '', label: '自动 / Plain' },
  { value: 'mermaid', label: 'Mermaid 图表' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'go', label: 'Go' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Shell / Bash' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'markdown', label: 'Markdown' },
];

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = (node.attrs.language as string) || '';
  const codeText = node.textContent;
  const [copied, setCopied] = useState(false);
  const [showMermaidCode, setShowMermaidCode] = useState(false);
  const [mermaidSvg, setMermaidSvg] = useState<string>('');
  const [mermaidErr, setMermaidErr] = useState<string>('');
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (language !== 'mermaid') return;
    let active = true;
    const render = async () => {
      try {
        const res = await mermaid.render(idRef.current, codeText || 'flowchart LR\nA-->B');
        if (active) {
          setMermaidSvg(res.svg);
          setMermaidErr('');
        }
      } catch (err) {
        if (active) {
          setMermaidErr(err instanceof Error ? err.message : 'Mermaid 语法错误');
        }
      }
    };
    const timer = setTimeout(render, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [language, codeText]);

  const copyCode = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper className="my-3 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-[#1e2430] text-slate-100">
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-[#151a23] text-xs text-slate-400 border-b border-slate-700/60"
        contentEditable={false}
      >
        <select
          value={language}
          disabled={!editor.isEditable}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="bg-transparent text-slate-300 outline-none cursor-pointer"
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value} className="bg-zinc-900 text-slate-100">
              {l.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {language === 'mermaid' && (
            <button
              type="button"
              onClick={() => setShowMermaidCode((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              {showMermaidCode ? <Eye className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}
              {showMermaidCode ? '只看图' : '编辑源码'}
            </button>
          )}
          <button
            type="button"
            onClick={copyCode}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      {language === 'mermaid' && !showMermaidCode && (
        <div
          className="p-4 bg-white dark:bg-zinc-900 text-slate-900 dark:text-slate-100 overflow-x-auto flex justify-center"
          contentEditable={false}
          onDoubleClick={() => editor.isEditable && setShowMermaidCode(true)}
          title="双击编辑 Mermaid 源码"
        >
          {mermaidErr ? (
            <div className="text-xs text-rose-500 font-mono">{mermaidErr}</div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
          )}
        </div>
      )}

      <pre className={language === 'mermaid' && !showMermaidCode ? 'hidden' : 'p-3.5 m-0 text-sm overflow-x-auto'}>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const CustomCodeBlockExtension = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });

function MathBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);

  let html = '';
  let errMsg = '';
  try {
    html = katex.renderToString(latex || 'E = mc^2', { displayMode: true, throwOnError: false });
  } catch (e) {
    errMsg = e instanceof Error ? e.message : 'LaTeX 错误';
  }

  return (
    <NodeViewWrapper className="my-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-800/40 p-3">
      {editing && editor.isEditable ? (
        <div className="space-y-2" contentEditable={false}>
          <textarea
            value={latex}
            onChange={(e) => updateAttributes({ latex: e.target.value })}
            rows={3}
            placeholder="输入 LaTeX 公式，例如 \sum_{i=1}^n x_i^2"
            className="w-full rounded border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 p-2 font-mono text-sm outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
            >
              完成
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => editor.isEditable && setEditing(true)}
          className="cursor-pointer text-center py-1 overflow-x-auto"
          contentEditable={false}
          title={editor.isEditable ? '点击编辑 LaTeX 公式' : undefined}
        >
          {errMsg ? (
            <span className="text-rose-500 text-xs">{errMsg}</span>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { latex: { default: 'E = mc^2' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mathBlock' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },
});

function MathInlineView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || 'x^2';
  const [editing, setEditing] = useState(false);
  const html = katex.renderToString(latex, { displayMode: false, throwOnError: false });

  return (
    <NodeViewWrapper as="span" className="inline-flex items-center mx-0.5 align-baseline">
      {editing && editor.isEditable ? (
        <input
          autoFocus
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
          className="px-1.5 py-0.5 text-xs font-mono border border-blue-400 rounded bg-white dark:bg-zinc-900 outline-none"
        />
      ) : (
        <span
          onClick={() => editor.isEditable && setEditing(true)}
          className="px-1 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 cursor-pointer"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const MathInlineExtension = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: 'a^2 + b^2 = c^2' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mathInline' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },
});

export function createPageMentionExtension(onNavigatePage?: (pageId: string) => void) {
  return Node.create({
    name: 'pageMention',
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes() {
      return {
        id: { default: '' },
        label: { default: '无标题页面' },
        blockId: { default: '' },
      };
    },
    parseHTML() {
      return [{ tag: 'span[data-type="pageMention"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'pageMention' })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(({ node }: NodeViewProps) => {
        const id = node.attrs.id as string;
        const label = (node.attrs.label as string) || '关联页面';
        return (
          <NodeViewWrapper as="span" className="inline-block mx-0.5 align-baseline">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (id && onNavigatePage) onNavigatePage(id);
              }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 text-sm hover:underline cursor-pointer"
            >
              <span>📄</span>
              <span>{label}</span>
            </button>
          </NodeViewWrapper>
        );
      });
    },
  });
}

function BookmarkView({ node, updateAttributes, editor }: NodeViewProps) {
  const url = (node.attrs.url as string) || '';
  const title = (node.attrs.title as string) || url || '网页书签';
  const desc = (node.attrs.description as string) || '';
  const [editing, setEditing] = useState(!url);
  const [draftUrl, setDraftUrl] = useState(url);

  if (editing && editor.isEditable) {
    return (
      <NodeViewWrapper className="my-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/50 p-3" contentEditable={false}>
        <div className="flex gap-2">
          <input
            type="url"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="输入网页链接 https://..."
            className="flex-1 rounded-lg border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (!draftUrl.trim()) return;
              updateAttributes({ url: draftUrl.trim(), title: draftUrl.trim() });
              setEditing(false);
            }}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
          >
            确定
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        contentEditable={false}
        className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/40 hover:bg-slate-50 dark:hover:bg-zinc-800/80 px-4 py-3 transition no-underline group"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{title}</div>
          {desc && <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{desc}</div>}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1 truncate">
            <Globe className="w-3 h-3 shrink-0" />
            <span className="truncate">{url}</span>
          </div>
        </div>
        <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-blue-500 shrink-0" />
      </a>
    </NodeViewWrapper>
  );
}

export const BookmarkExtension = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});

export const FileBlockExtension = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' },
      name: { default: '附件' },
      size: { default: 0 },
      mimeType: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="fileBlock"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'fileBlock' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(({ node }: NodeViewProps) => {
      const url = (node.attrs.url as string) || '';
      const name = (node.attrs.name as string) || '附件';
      const size = Number(node.attrs.size) || 0;
      const kb = size > 0 ? `${(size / 1024).toFixed(1)} KB` : '';
      return (
        <NodeViewWrapper className="my-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            contentEditable={false}
            className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-800/40 hover:bg-slate-100 dark:hover:bg-zinc-800 px-3.5 py-2.5 transition"
          >
            <FileIcon className="w-5 h-5 text-blue-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{name}</div>
              {kb && <div className="text-xs text-slate-400">{kb}</div>}
            </div>
            <span className="text-xs text-blue-600 dark:text-blue-400">下载</span>
          </a>
        </NodeViewWrapper>
      );
    });
  },
});

export function createInlineDatabaseExtension(
  renderDatabase: (databaseId: string, readonly: boolean) => React.ReactNode,
) {
  return Node.create({
    name: 'inlineDatabase',
    group: 'block',
    atom: true,
    addAttributes() {
      return {
        databaseId: { default: '' },
        title: { default: '内嵌多维数据库' },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="inlineDatabase"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'inlineDatabase' })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(({ node, editor }: NodeViewProps) => {
        const databaseId = (node.attrs.databaseId as string) || '';
        return (
          <NodeViewWrapper
            className="my-4 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/50 p-3 overflow-hidden"
            contentEditable={false}
          >
            {databaseId ? (
              renderDatabase(databaseId, !editor.isEditable)
            ) : (
              <div className="text-xs text-slate-400 p-4 text-center flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" />
                正在初始化多维数据库...
              </div>
            )}
          </NodeViewWrapper>
        );
      });
    },
  });
}

export { Sigma };
