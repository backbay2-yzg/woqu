import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import type { PageTreeItem } from '@/types';

const pageMentionPluginKey = new PluginKey('pageMentionSuggestion');

interface MentionListProps {
  items: PageTreeItem[];
  command: (item: PageTreeItem) => void;
  rect: DOMRect | null;
}

interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const PageMentionList = forwardRef<MentionListHandle, MentionListProps>(({ items, command, rect }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!rect) return null;

  const top = Math.min(rect.bottom + 6, window.innerHeight - 280);
  const left = Math.min(rect.left, window.innerWidth - 280);

  return (
    <div
      style={{ top: Math.max(12, top), left: Math.max(12, left) }}
      className="fixed z-50 w-68 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-1.5"
    >
      <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">引用其他页面 (双向链接)</div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-xs text-slate-400 text-center">无匹配页面</div>
      ) : (
        items.slice(0, 12).map((p, idx) => (
          <button
            key={p.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              command(p);
            }}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition ${
              idx === selectedIndex
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200'
                : 'hover:bg-slate-100 dark:hover:bg-zinc-800'
            }`}
          >
            <span>{p.icon || (p.is_database ? '🗃️' : '📄')}</span>
            <span className="truncate font-medium">{p.title || '无标题'}</span>
          </button>
        ))
      )}
    </div>
  );
});

PageMentionList.displayName = 'PageMentionList';

export function createPageMentionSuggestion(getPages: () => PageTreeItem[]) {
  return Extension.create({
    name: 'pageMentionSuggestion',

    addProseMirrorPlugins() {
      return [
        Suggestion({
          pluginKey: pageMentionPluginKey,
          editor: this.editor,
          char: '[[',
          allowSpaces: true,
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            const list = getPages();
            if (!q) return list.slice(0, 12);
            return list.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 12);
          },
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: PageTreeItem }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                {
                  type: 'pageMention',
                  attrs: { id: props.id, label: props.title || '无标题' },
                },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: () => {
            let component: ReactRenderer<MentionListHandle> | null = null;
            return {
              onStart: (props) => {
                component = new ReactRenderer(PageMentionList, {
                  props: {
                    items: props.items,
                    command: props.command,
                    rect: props.clientRect?.() ?? null,
                  },
                  editor: props.editor,
                });
                document.body.appendChild(component.element);
              },
              onUpdate: (props) => {
                component?.updateProps({
                  items: props.items,
                  command: props.command,
                  rect: props.clientRect?.() ?? null,
                });
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  component?.element.remove();
                  component?.destroy();
                  component = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                component?.element.remove();
                component?.destroy();
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
