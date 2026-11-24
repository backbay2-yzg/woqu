import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  Sparkles,
  Strikethrough,
  Underline,
  Send,
} from 'lucide-react';
import type { AIPromptTemplate } from '@/types';

export interface SelectionSnapshot {
  from: number;
  to: number;
  text: string;
}

interface BubbleToolbarProps {
  editor: Editor;
  promptTemplates: AIPromptTemplate[];
  onRunAiPrompt: (
    title: string,
    systemPrompt: string,
    userPrompt: string,
    selection?: SelectionSnapshot,
  ) => void;
}

interface ToolbarPosition extends SelectionSnapshot {
  top: number;
  left: number;
}

export const BubbleToolbar: React.FC<BubbleToolbarProps> = ({
  editor,
  promptTemplates,
  onRunAiPrompt,
}) => {
  const [pos, setPos] = useState<ToolbarPosition | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const aiMenuOpenRef = useRef(aiMenuOpen);
  aiMenuOpenRef.current = aiMenuOpen;
  const linkInputOpenRef = useRef(linkInputOpen);
  linkInputOpenRef.current = linkInputOpen;

  const syncSelection = useCallback(() => {
    if (editor.isDestroyed || !editor.isEditable) {
      setPos(null);
      return;
    }

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      if (!aiMenuOpenRef.current && !linkInputOpenRef.current) {
        setPos(null);
      }
      return;
    }

    const text = editor.state.doc.textBetween(from, to, '\n');
    if (!text.trim()) {
      if (!aiMenuOpenRef.current && !linkInputOpenRef.current) {
        setPos(null);
      }
      return;
    }

    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const midX = (start.left + end.right) / 2;
      const minTop = Math.min(start.top, end.top);
      const maxBottom = Math.max(start.bottom, end.bottom);

      const safeLeft = Math.min(Math.max(175, midX), window.innerWidth - 175);
      const safeTop = minTop > 56 ? minTop - 46 : Math.min(maxBottom + 8, window.innerHeight - 56);

      setPos({
        from,
        to,
        text,
        top: safeTop,
        left: safeLeft,
      });
    } catch {
      // ignore transient view coordinates while updating
    }
  }, [editor]);

  useEffect(() => {
    syncSelection();
    editor.on('selectionUpdate', syncSelection);
    editor.on('transaction', syncSelection);
    window.addEventListener('scroll', syncSelection, true);
    window.addEventListener('resize', syncSelection);

    return () => {
      editor.off('selectionUpdate', syncSelection);
      editor.off('transaction', syncSelection);
      window.removeEventListener('scroll', syncSelection, true);
      window.removeEventListener('resize', syncSelection);
    };
  }, [editor, syncSelection]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (toolbarRef.current && target && toolbarRef.current.contains(target)) {
        return;
      }
      setAiMenuOpen(false);
      setLinkInputOpen(false);
      if (editor.isDestroyed || editor.state.selection.empty) {
        setPos(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAiMenuOpen(false);
        setLinkInputOpen(false);
        setPos(null);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor]);

  if (!pos || !editor.isEditable || typeof document === 'undefined') {
    return null;
  }

  const snapshot: SelectionSnapshot = { from: pos.from, to: pos.to, text: pos.text };

  const handleApplyLink = () => {
    const chain = editor.chain().focus().setTextSelection({ from: pos.from, to: pos.to });
    if (!linkUrl.trim()) {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href: linkUrl.trim() }).run();
    }
    setLinkInputOpen(false);
    setLinkUrl('');
  };

  return createPortal(
    <div
      ref={toolbarRef}
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
      className="no-print fixed z-40"
    >
      <div className="relative flex items-center gap-0.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl px-1.5 py-1">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setAiMenuOpen((v) => !v);
            setLinkInputOpen(false);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/60 dark:to-indigo-950/60 text-purple-700 dark:text-purple-300 hover:from-purple-100 hover:to-indigo-100 transition mr-1 whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI 优化
        </button>

        <div className="h-4 w-px bg-slate-200 dark:bg-zinc-700 mx-0.5" />

        <ToolBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="加粗"
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="斜体"
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="下划线"
        >
          <Underline className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="删除线"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="行内代码"
        >
          <Code className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          title="高亮背景"
        >
          <Highlighter className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('link')}
          onClick={() => {
            setLinkUrl((editor.getAttributes('link').href as string) || '');
            setLinkInputOpen((v) => !v);
            setAiMenuOpen(false);
          }}
          title="超链接"
        >
          <Link2 className="w-3.5 h-3.5" />
        </ToolBtn>

        {linkInputOpen && (
          <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-2 flex gap-1.5">
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyLink()}
              placeholder="输入链接 https://..."
              className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-2.5 py-1 text-xs outline-none"
            />
            <button
              type="button"
              onClick={handleApplyLink}
              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs"
            >
              确定
            </button>
          </div>
        )}

        {aiMenuOpen && (
          <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-2 space-y-1.5">
            <div className="flex gap-1.5 pb-1.5 border-b border-slate-100 dark:border-zinc-800">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customPrompt.trim()) {
                    setAiMenuOpen(false);
                    setPos(null);
                    onRunAiPrompt(customPrompt.trim(), '', customPrompt.trim(), snapshot);
                    setCustomPrompt('');
                  }
                }}
                placeholder="自定义指令（如：改成小红书风格）..."
                className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 px-2.5 py-1 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!customPrompt.trim()) return;
                  setAiMenuOpen(false);
                  setPos(null);
                  onRunAiPrompt(customPrompt.trim(), '', customPrompt.trim(), snapshot);
                  setCustomPrompt('');
                }}
                className="p-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {promptTemplates.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAiMenuOpen(false);
                    setPos(null);
                    onRunAiPrompt(pt.name, pt.system_prompt, pt.user_prompt_template, snapshot);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs hover:bg-purple-50 dark:hover:bg-purple-950/40 text-slate-700 dark:text-zinc-200 transition"
                >
                  <span>{pt.icon}</span>
                  <span className="flex-1 truncate">{pt.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

const ToolBtn: React.FC<{
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault();
      onClick();
    }}
    title={title}
    className={`p-1.5 rounded-lg transition ${
      active
        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
        : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
    }`}
  >
    {children}
  </button>
);
