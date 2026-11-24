import React, { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { Copy, GripVertical, Link2, Plus, Sparkles, Trash2 } from 'lucide-react';

interface DragHandleProps {
  editor: Editor;
  pageId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAskAI?: (blockText: string) => void;
}

export const DragHandle: React.FC<DragHandleProps> = ({
  editor,
  pageId,
  containerRef,
  onAskAI,
}) => {
  const [posInfo, setPosInfo] = useState<{ top: number; pmPos: number; blockId: string; text: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const draggedPosRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor.isEditable) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (menuOpen || editor.isDestroyed || !editor.isEditable) return;
      const pmEl = container.querySelector('.ProseMirror') as HTMLElement | null;
      if (!pmEl) return;

      const children = Array.from(pmEl.children) as HTMLElement[];
      const containerRect = container.getBoundingClientRect();

      let matched: HTMLElement | null = null;
      for (const ch of children) {
        const r = ch.getBoundingClientRect();
        if (e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
          matched = ch;
          break;
        }
      }

      if (!matched) {
        return;
      }

      try {
        const pmPos = editor.view.posAtDOM(matched, 0);
        const resolved = editor.state.doc.resolve(pmPos);
        const topPos = resolved.depth >= 1 ? resolved.before(1) : pmPos;
        const node = editor.state.doc.nodeAt(topPos);
        const r = matched.getBoundingClientRect();
        setPosInfo({
          top: r.top - containerRect.top + 3,
          pmPos: topPos,
          blockId: (node?.attrs?.blockId as string) || '',
          text: matched.innerText || '',
        });
      } catch {
        // ignore transient DOM sync
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      if (menuOpen) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && related.closest('[data-block-gutter="true"]')) return;
      setPosInfo(null);
    };

    const handleDropOnEditor = (e: DragEvent) => {
      const fromPos = draggedPosRef.current;
      draggedPosRef.current = null;
      if (fromPos === null || editor.isDestroyed) return;
      const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!coords) return;
      e.preventDefault();

      try {
        const { state, dispatch } = editor.view;
        const node = state.doc.nodeAt(fromPos);
        if (!node) return;
        const resolvedTarget = state.doc.resolve(coords.pos);
        const targetPos = resolvedTarget.depth >= 1 ? resolvedTarget.before(1) : coords.pos;
        if (targetPos === fromPos || targetPos === fromPos + node.nodeSize) return;

        let tr = state.tr;
        const slice = node.toJSON();
        if (targetPos > fromPos) {
          tr = tr.insert(targetPos, state.schema.nodeFromJSON(slice));
          tr = tr.delete(fromPos, fromPos + node.nodeSize);
        } else {
          tr = tr.delete(fromPos, fromPos + node.nodeSize);
          tr = tr.insert(targetPos, state.schema.nodeFromJSON(slice));
        }
        dispatch(tr);
      } catch {
        // ignore invalid drop
      }
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('drop', handleDropOnEditor);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('drop', handleDropOnEditor);
    };
  }, [editor, containerRef, menuOpen]);

  if (!posInfo || !editor.isEditable) return null;

  const insertBlockBelow = () => {
    const node = editor.state.doc.nodeAt(posInfo.pmPos);
    const insertAt = posInfo.pmPos + (node ? node.nodeSize : 1);
    editor
      .chain()
      .focus()
      .insertContentAt(insertAt, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .run();
    setMenuOpen(false);
  };

  const duplicateBlock = () => {
    const node = editor.state.doc.nodeAt(posInfo.pmPos);
    if (!node) return;
    const json = node.toJSON();
    if (json.attrs) delete json.attrs.blockId;
    editor.chain().focus().insertContentAt(posInfo.pmPos + node.nodeSize, json).run();
    setMenuOpen(false);
  };

  const deleteBlock = () => {
    const node = editor.state.doc.nodeAt(posInfo.pmPos);
    if (!node) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: posInfo.pmPos, to: posInfo.pmPos + node.nodeSize })
      .run();
    setMenuOpen(false);
    setPosInfo(null);
  };

  const copyBlockLink = () => {
    const url = `${window.location.origin}/p/${pageId}#block-${posInfo.blockId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => {
      setCopiedLink(false);
      setMenuOpen(false);
    }, 800);
  };

  const convertBlock = (kind: 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'todo') => {
    const tr = editor.state.tr;
    tr.setSelection(NodeSelection.create(editor.state.doc, posInfo.pmPos));
    editor.view.dispatch(tr);
    const chain = editor.chain().focus();
    if (kind === 'paragraph') chain.setParagraph().run();
    else if (kind === 'h1') chain.setHeading({ level: 1 }).run();
    else if (kind === 'h2') chain.setHeading({ level: 2 }).run();
    else if (kind === 'h3') chain.setHeading({ level: 3 }).run();
    else if (kind === 'bullet') chain.toggleBulletList().run();
    else if (kind === 'todo') chain.toggleTaskList().run();
    setMenuOpen(false);
  };

  return (
    <div
      data-block-gutter="true"
      style={{ top: posInfo.top }}
      className="no-print hidden md:flex items-center gap-0.5 absolute -left-12 z-20 select-none"
    >
      <button
        type="button"
        onClick={insertBlockBelow}
        title="在下方插入块 (支持 / 命令)"
        className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <div className="relative">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            draggedPosRef.current = posInfo.pmPos;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', posInfo.blockId);
          }}
          onClick={() => setMenuOpen((v) => !v)}
          title="拖拽排序或点击打开块操作菜单"
          className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute left-0 top-6 z-40 w-48 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-1.5 text-xs space-y-0.5">
            <div className="px-2 py-1 text-[10px] font-semibold text-slate-400">转换为</div>
            <div className="grid grid-cols-3 gap-1 px-1 pb-1.5 border-b border-slate-100 dark:border-zinc-800">
              {[
                { k: 'paragraph' as const, l: '正文' },
                { k: 'h1' as const, l: 'H1' },
                { k: 'h2' as const, l: 'H2' },
                { k: 'h3' as const, l: 'H3' },
                { k: 'bullet' as const, l: '列表' },
                { k: 'todo' as const, l: '待办' },
              ].map((b) => (
                <button
                  key={b.k}
                  type="button"
                  onClick={() => convertBlock(b.k)}
                  className="px-1.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-center font-medium"
                >
                  {b.l}
                </button>
              ))}
            </div>
            {onAskAI && posInfo.text.trim() && (
              <button
                type="button"
                onClick={() => {
                  onAskAI(posInfo.text);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950/40 text-purple-600 dark:text-purple-300"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>让 AI 优化该块</span>
              </button>
            )}
            <button
              type="button"
              onClick={duplicateBlock}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制块</span>
            </button>
            <button
              type="button"
              onClick={copyBlockLink}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{copiedLink ? '已复制链接！' : '复制块锚点链接'}</span>
            </button>
            <button
              type="button"
              onClick={deleteBlock}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除块</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
