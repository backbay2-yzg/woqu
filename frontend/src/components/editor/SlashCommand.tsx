import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

const slashCommandPluginKey = new PluginKey('slashCommandSuggestion');
import {
  CheckSquare,
  Code2,
  Columns2,
  Columns3,
  Database,
  FileUp,
  GitBranch,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Lightbulb,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Pilcrow,
  Quote,
  Sigma,
  Sparkles,
  Table,
  Wand2,
} from 'lucide-react';

export interface SlashItem {
  id: string;
  title: string;
  subtitle: string;
  group: string;
  keywords: string[];
  icon: React.ReactNode;
  action: (ctx: { editor: Editor; range: Range; helpers: SlashHelpers }) => void;
}

export interface SlashHelpers {
  onTriggerSlashAI: (mode: 'continue' | 'outline' | 'custom', range: Range) => void;
  onTriggerSummarize: () => void;
  onUploadImage: (range: Range) => void;
  onUploadFile: (range: Range) => void;
  onInsertInlineDatabase: (range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'ai_continue',
    title: 'AI 智能续写',
    subtitle: '根据当前上下文继续写作',
    group: 'AI 写作助手',
    keywords: ['ai', 'continue', 'xuxie', '写作', '续写'],
    icon: <Sparkles className="w-4 h-4 text-purple-500" />,
    action: ({ helpers, range }) => helpers.onTriggerSlashAI('continue', range),
  },
  {
    id: 'ai_outline',
    title: 'AI 生成大纲 / 草稿',
    subtitle: '输入主题由 AI 生成结构化内容',
    group: 'AI 写作助手',
    keywords: ['ai', 'outline', 'draft', 'dagang', '大纲', '生成'],
    icon: <Wand2 className="w-4 h-4 text-purple-500" />,
    action: ({ helpers, range }) => helpers.onTriggerSlashAI('custom', range),
  },
  {
    id: 'ai_summary',
    title: 'AI 生成全文摘要与待办',
    subtitle: '总结当前文档并提炼行动项',
    group: 'AI 写作助手',
    keywords: ['ai', 'summary', 'zhaiyao', '摘要', '总结'],
    icon: <Sparkles className="w-4 h-4 text-indigo-500" />,
    action: ({ editor, range, helpers }) => {
      editor.chain().focus().deleteRange(range).run();
      helpers.onTriggerSummarize();
    },
  },
  {
    id: 'paragraph',
    title: '正文段落',
    subtitle: '普通文字段落',
    group: '基础块',
    keywords: ['text', 'paragraph', 'p', '正文', '段落'],
    icon: <Pilcrow className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: 'h1',
    title: '一级标题 H1',
    subtitle: '大号章节标题',
    group: '基础块',
    keywords: ['h1', 'heading1', 'biaoti', '一级标题'],
    icon: <Heading1 className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '二级标题 H2',
    subtitle: '中号小节标题',
    group: '基础块',
    keywords: ['h2', 'heading2', 'biaoti', '二级标题'],
    icon: <Heading2 className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '三级标题 H3',
    subtitle: '小号子标题',
    group: '基础块',
    keywords: ['h3', 'heading3', 'biaoti', '三级标题'],
    icon: <Heading3 className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: '无序列表',
    subtitle: '项目符号清单',
    group: '基础块',
    keywords: ['ul', 'bullet', 'list', 'liebiao', '无序列表'],
    icon: <List className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: '有序列表',
    subtitle: '带编号的列表',
    group: '基础块',
    keywords: ['ol', 'ordered', 'number', 'youxu', '有序列表'],
    icon: <ListOrdered className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: '待办清单 (To-do)',
    subtitle: '可勾选的任务列表',
    group: '基础块',
    keywords: ['todo', 'task', 'check', 'daiban', '待办'],
    icon: <CheckSquare className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: '引用块',
    subtitle: '突出显示引用或摘录',
    group: '基础块',
    keywords: ['quote', 'blockquote', 'yinyong', '引用'],
    icon: <Quote className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'hr',
    title: '分割线',
    subtitle: '视觉分隔线',
    group: '基础块',
    keywords: ['hr', 'divider', 'line', 'fengexian', '分割线'],
    icon: <Minus className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'callout',
    title: '柔色提示块 (Callout)',
    subtitle: 'Wolai 风格高亮信息框',
    group: '高级排版',
    keywords: ['callout', 'tip', 'note', 'tishi', '提示块', '高亮'],
    icon: <Lightbulb className="w-4 h-4 text-amber-500" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: { icon: '💡', color: 'blue' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'toggle',
    title: '折叠块 (Toggle)',
    subtitle: '可展开和收起的详情块',
    group: '高级排版',
    keywords: ['toggle', 'collapse', 'zhedie', '折叠'],
    icon: <ListTree className="w-4 h-4" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'toggle',
          attrs: { summary: '点击展开内容', open: true },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'columns2',
    title: '两栏分栏布局',
    subtitle: '左右并排的两列内容容器',
    group: '高级排版',
    keywords: ['col', 'columns', '2col', 'fenlan', '分栏', '两栏'],
    icon: <Columns2 className="w-4 h-4" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'columns',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    id: 'columns3',
    title: '三栏分栏布局',
    subtitle: '三列并排内容容器',
    group: '高级排版',
    keywords: ['col3', 'columns3', 'sanlan', '三栏'],
    icon: <Columns3 className="w-4 h-4" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'columns',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    id: 'table',
    title: '普通表格',
    subtitle: '插入 3×3 文档表格',
    group: '高级排版',
    keywords: ['table', 'biaoge', '表格'],
    icon: <Table className="w-4 h-4" />,
    action: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'code',
    title: '代码块',
    subtitle: '支持语法高亮与一键复制',
    group: '高级排版',
    keywords: ['code', 'codeblock', 'daima', '代码'],
    icon: <Code2 className="w-4 h-4" />,
    action: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'mermaid',
    title: 'Mermaid 流程图',
    subtitle: '文本编写流程图/时序图并实时渲染',
    group: '高级排版',
    keywords: ['mermaid', 'diagram', 'chart', 'liuchengtu', '流程图'],
    icon: <GitBranch className="w-4 h-4 text-emerald-500" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart LR\n  A[开始] --> B[处理]\n  B --> C[完成]' }],
        })
        .run(),
  },
  {
    id: 'math',
    title: 'LaTeX 数学公式块',
    subtitle: 'KaTeX 块级数学公式渲染',
    group: '高级排版',
    keywords: ['math', 'latex', 'katex', 'gongshi', '公式'],
    icon: <Sigma className="w-4 h-4" />,
    action: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mathBlock', attrs: { latex: '\\sum_{i=1}^n x_i = S' } })
        .run(),
  },
  {
    id: 'image',
    title: '上传图片',
    subtitle: '从本地上传图片到当前文档',
    group: '媒体与嵌入',
    keywords: ['image', 'img', 'tupian', '图片'],
    icon: <ImagePlus className="w-4 h-4 text-sky-500" />,
    action: ({ helpers, range }) => helpers.onUploadImage(range),
  },
  {
    id: 'file',
    title: '上传文件附件',
    subtitle: 'PDF / 压缩包 / 任意文档附件',
    group: '媒体与嵌入',
    keywords: ['file', 'upload', 'attachment', 'fujian', '文件', '附件'],
    icon: <FileUp className="w-4 h-4 text-sky-500" />,
    action: ({ helpers, range }) => helpers.onUploadFile(range),
  },
  {
    id: 'bookmark',
    title: '网页书签卡片',
    subtitle: '嵌入外部 URL 书签预览卡片',
    group: '媒体与嵌入',
    keywords: ['bookmark', 'link', 'url', 'shuqian', '书签'],
    icon: <Globe className="w-4 h-4 text-sky-500" />,
    action: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'bookmark' }).run(),
  },
  {
    id: 'inline_db',
    title: '内嵌多维数据库',
    subtitle: '在当前文档中直接嵌入表格/看板/日历视图',
    group: '多维数据库',
    keywords: ['database', 'db', 'kanban', 'table', 'shujuku', '多维表', '数据库', '看板'],
    icon: <Database className="w-4 h-4 text-blue-600" />,
    action: ({ helpers, range }) => helpers.onInsertInlineDatabase(range),
  },
];

interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  rect: DOMRect | null;
}

interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuProps>(({ items, command, rect }, ref) => {
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

  const top = Math.min(rect.bottom + 6, window.innerHeight - 360);
  const left = Math.min(rect.left, window.innerWidth - 320);

  const grouped = items.reduce<Record<string, Array<{ item: SlashItem; idx: number }>>>((acc, item, idx) => {
    (acc[item.group] ||= []).push({ item, idx });
    return acc;
  }, {});

  return (
    <div
      style={{ top: Math.max(12, top), left: Math.max(12, left) }}
      className="fixed z-50 w-76 max-h-88 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-1.5"
    >
      {items.length === 0 ? (
        <div className="px-3 py-4 text-xs text-slate-400 text-center">未找到匹配的块命令</div>
      ) : (
        Object.entries(grouped).map(([group, entries]) => (
          <div key={group} className="mb-1.5 last:mb-0">
            <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 dark:text-zinc-500">
              {group}
            </div>
            {entries.map(({ item, idx }) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  command(item);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition ${
                  idx === selectedIndex
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200'
                    : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200'
                }`}
              >
                <div className="w-7 h-7 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{item.title}</div>
                  <div className="text-[11px] text-slate-400 dark:text-zinc-500 truncate">{item.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
});

SlashMenuList.displayName = 'SlashMenuList';

export function createSlashCommandExtension(getHelpers: () => SlashHelpers) {
  return Extension.create({
    name: 'slashCommand',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          items: ({ query }: { query: string }) => {
            const q = query.trim().toLowerCase();
            if (!q) return SLASH_ITEMS;
            return SLASH_ITEMS.filter(
              (it) =>
                it.title.toLowerCase().includes(q) ||
                it.subtitle.toLowerCase().includes(q) ||
                it.keywords.some((k) => k.toLowerCase().includes(q)),
            );
          },
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
            props.action({ editor, range, helpers: getHelpers() });
          },
          render: () => {
            let component: ReactRenderer<SlashMenuHandle> | null = null;
            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashMenuList, {
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
        } satisfies Partial<SuggestionOptions<SlashItem>>,
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          pluginKey: slashCommandPluginKey,
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
