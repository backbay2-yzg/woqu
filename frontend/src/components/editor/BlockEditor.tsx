import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Range } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Sparkles, X } from 'lucide-react';

import { api, streamSSE } from '@/lib/api';
import type { AIPromptTemplate, PageTreeItem, TipTapJSON } from '@/types';
import { UniqueBlockId } from './UniqueBlockId';
import {
  BookmarkExtension,
  CalloutExtension,
  ColumnExtension,
  ColumnsExtension,
  CustomCodeBlockExtension,
  FileBlockExtension,
  MathBlockExtension,
  MathInlineExtension,
  ToggleExtension,
  createInlineDatabaseExtension,
  createPageMentionExtension,
} from './nodes/CustomNodes';
import { createSlashCommandExtension, type SlashHelpers } from './SlashCommand';
import { createPageMentionSuggestion } from './PageMentionSuggestion';
import { BubbleToolbar, type SelectionSnapshot } from './BubbleToolbar';
import { AiDiffPanel } from './AiDiffPanel';
import { DragHandle } from './DragHandle';

export interface BlockEditorProps {
  pageId: string;
  initialContent: TipTapJSON;
  editable?: boolean;
  allPages?: PageTreeItem[];
  promptTemplates?: AIPromptTemplate[];
  onChangeContent?: (json: TipTapJSON) => void;
  onNavigatePage?: (pageId: string) => void;
  onHeadingsChange?: (headings: Array<{ id: string; text: string; level: number }>) => void;
  onTriggerSummarize?: () => void;
  renderInlineDatabase?: (databaseId: string, readonly: boolean) => React.ReactNode;
}

interface AiPreviewState {
  title: string;
  originalText: string;
  generatedText: string;
  streaming: boolean;
  error: string | null;
  range: { from: number; to: number };
  lastPrompt: { sys: string; user: string; context: string };
}

export const BlockEditor: React.FC<BlockEditorProps> = ({
  pageId,
  initialContent,
  editable = true,
  allPages = [],
  promptTemplates = [],
  onChangeContent,
  onNavigatePage,
  onHeadingsChange,
  onTriggerSummarize,
  renderInlineDatabase,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingInsertRangeRef = useRef<Range | null>(null);

  const allPagesRef = useRef(allPages);
  allPagesRef.current = allPages;

  const onNavigateRef = useRef(onNavigatePage);
  onNavigateRef.current = onNavigatePage;

  const onChangeRef = useRef(onChangeContent);
  onChangeRef.current = onChangeContent;

  const onHeadingsRef = useRef(onHeadingsChange);
  onHeadingsRef.current = onHeadingsChange;

  const onSummarizeRef = useRef(onTriggerSummarize);
  onSummarizeRef.current = onTriggerSummarize;

  const renderInlineDBRef = useRef(renderInlineDatabase);
  renderInlineDBRef.current = renderInlineDatabase;

  const [aiPreview, setAiPreview] = useState<AiPreviewState | null>(null);
  const [slashPromptOpen, setSlashPromptOpen] = useState<{ range: Range } | null>(null);
  const [slashPromptInput, setSlashPromptInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const helpersRef = useRef<SlashHelpers>({
    onTriggerSlashAI: () => {},
    onTriggerSummarize: () => onSummarizeRef.current?.(),
    onUploadImage: () => {},
    onUploadFile: () => {},
    onInsertInlineDatabase: () => {},
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? '标题...' : '输入文字，按 / 唤起命令面板或 [[ 引用页面...',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({ HTMLAttributes: { class: 'rounded-lg max-w-full my-3 shadow-sm' } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-600 dark:text-blue-400 underline' } }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      UniqueBlockId,
      CalloutExtension,
      ToggleExtension,
      ColumnExtension,
      ColumnsExtension,
      CustomCodeBlockExtension,
      MathBlockExtension,
      MathInlineExtension,
      BookmarkExtension,
      FileBlockExtension,
      createPageMentionExtension((id) => onNavigateRef.current?.(id)),
      createInlineDatabaseExtension((dbId, ro) =>
        renderInlineDBRef.current ? renderInlineDBRef.current(dbId, ro) : null,
      ),
      createSlashCommandExtension(() => helpersRef.current),
      createPageMentionSuggestion(() => allPagesRef.current),
    ],
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: initialContent,
      editable,
      onUpdate: ({ editor: ed }) => {
        onChangeRef.current?.(ed.getJSON() as TipTapJSON);
        extractAndEmitHeadings(ed);
      },
      onCreate: ({ editor: ed }) => {
        extractAndEmitHeadings(ed);
      },
    },
    [pageId, editable],
  );

  const extractAndEmitHeadings = (ed: NonNullable<typeof editor>) => {
    if (!onHeadingsRef.current) return;
    const headings: Array<{ id: string; text: string; level: number }> = [];
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'heading') {
        const text = node.textContent.trim();
        if (text) {
          headings.push({
            id: (node.attrs.blockId as string) || `h-${headings.length}`,
            text,
            level: (node.attrs.level as number) || 1,
          });
        }
      }
    });
    onHeadingsRef.current(headings);
  };

  useEffect(() => {
    if (!editor) return;
    helpersRef.current = {
      onTriggerSlashAI: (mode, range) => {
        if (mode === 'continue') {
          editor.chain().focus().deleteRange(range).run();
          const beforeText = editor.state.doc.textBetween(
            Math.max(0, range.from - 1500),
            range.from,
            '\n',
          );
          void runAIStream(
            'AI 智能续写',
            '',
            '请根据上文语境，自然流畅地续写下一段内容，风格与前文保持一致。',
            '',
            beforeText,
            { from: range.from, to: range.from },
          );
        } else {
          setSlashPromptOpen({ range });
          setSlashPromptInput('');
        }
      },
      onTriggerSummarize: () => onSummarizeRef.current?.(),
      onUploadImage: (range) => {
        pendingInsertRangeRef.current = range;
        imageInputRef.current?.click();
      },
      onUploadFile: (range) => {
        pendingInsertRangeRef.current = range;
        fileInputRef.current?.click();
      },
      onInsertInlineDatabase: async (range) => {
        editor.chain().focus().deleteRange(range).run();
        try {
          const full = await api.createDatabase({
            page_id: pageId,
            title: '内嵌多维表格',
            icon: '🗃️',
            is_inline: true,
          });
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'inlineDatabase',
              attrs: { databaseId: full.database.id, title: full.database.title },
            })
            .run();
        } catch (err) {
          console.error('Failed to create inline database', err);
        }
      },
    };
  }, [editor, pageId]);

  const runAIStream = async (
    title: string,
    systemPrompt: string,
    userPrompt: string,
    selection: string,
    contextText: string,
    range: { from: number; to: number },
  ) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setAiPreview({
      title,
      originalText: selection,
      generatedText: '',
      streaming: true,
      error: null,
      range,
      lastPrompt: { sys: systemPrompt, user: userPrompt, context: contextText },
    });

    let acc = '';
    try {
      await streamSSE(
        '/api/v1/ai/stream',
        {
          task: 'writing',
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          selection,
          context: contextText,
        },
        {
          signal: ctrl.signal,
          onEvent: (evt, data) => {
            if (evt === 'delta' && data && typeof data === 'object' && 'text' in data) {
              acc += String((data as { text: string }).text);
              setAiPreview((prev) => (prev ? { ...prev, generatedText: acc } : null));
            } else if (evt === 'done') {
              setAiPreview((prev) => (prev ? { ...prev, streaming: false } : null));
            } else if (evt === 'error' && data && typeof data === 'object' && 'error' in data) {
              setAiPreview((prev) =>
                prev
                  ? { ...prev, streaming: false, error: String((data as { error: string }).error) }
                  : null,
              );
            }
          },
        },
      );
      setAiPreview((prev) => (prev ? { ...prev, streaming: false } : null));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setAiPreview((prev) =>
        prev
          ? {
              ...prev,
              streaming: false,
              error: err instanceof Error ? err.message : 'AI 调用失败',
            }
          : null,
      );
    }
  };

  const handleUploadPicked = async (e: React.ChangeEvent<HTMLInputElement>, isImage: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const range = pendingInsertRangeRef.current;
    pendingInsertRangeRef.current = null;
    try {
      const asset = await api.uploadAsset(file, pageId);
      const chain = editor.chain().focus();
      if (range) chain.deleteRange(range);
      if (isImage) {
        chain.setImage({ src: asset.url, alt: asset.filename }).run();
      } else {
        chain
          .insertContent({
            type: 'fileBlock',
            attrs: {
              url: asset.url,
              name: asset.filename,
              size: asset.size_bytes,
              mimeType: asset.mime_type,
            },
          })
          .run();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '上传失败');
    }
  };

  const handleRunBubbleAI = (
    title: string,
    sysPrompt: string,
    userPrompt: string,
    snapshot?: SelectionSnapshot,
  ) => {
    if (!editor) return;
    const from = snapshot?.from ?? editor.state.selection.from;
    const to = snapshot?.to ?? editor.state.selection.to;
    const selectedText = snapshot?.text ?? editor.state.doc.textBetween(from, to, '\n');
    if (!selectedText.trim()) return;
    void runAIStream(title, sysPrompt, userPrompt, selectedText, '', { from, to });
  };

  const handleSlashPromptSubmit = () => {
    if (!editor || !slashPromptOpen || !slashPromptInput.trim()) return;
    const { range } = slashPromptOpen;
    const prompt = slashPromptInput.trim();
    setSlashPromptOpen(null);
    editor.chain().focus().deleteRange(range).run();
    const context = editor.state.doc.textBetween(Math.max(0, range.from - 1200), range.from, '\n');
    void runAIStream('AI 创作助手', '', prompt, '', context, { from: range.from, to: range.from });
  };

  if (!editor) return null;

  return (
    <div ref={containerRef} className="woqu-editor relative">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadPicked(e, true)}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void handleUploadPicked(e, false)}
      />

      <DragHandle
        editor={editor}
        pageId={pageId}
        containerRef={containerRef}
        onAskAI={(blockText) => {
          const pos = editor.state.selection.to;
          void runAIStream(
            'AI 优化段落',
            '',
            '请润色并优化这段文字的表达，使之更加清晰专业。',
            blockText,
            '',
            { from: pos, to: pos },
          );
        }}
      />

      {editable && (
        <BubbleToolbar
          editor={editor}
          promptTemplates={promptTemplates}
          onRunAiPrompt={handleRunBubbleAI}
        />
      )}

      {slashPromptOpen && (
        <div className="my-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/30 p-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
          <input
            autoFocus
            type="text"
            value={slashPromptInput}
            onChange={(e) => setSlashPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSlashPromptSubmit();
              if (e.key === 'Escape') setSlashPromptOpen(null);
            }}
            placeholder="告诉 AI 要写什么（例如：写一份产品季度复盘大纲）..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="button"
            onClick={handleSlashPromptSubmit}
            className="px-3 py-1 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700"
          >
            生成
          </button>
          <button
            type="button"
            onClick={() => setSlashPromptOpen(null)}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />

      {aiPreview && (
        <AiDiffPanel
          title={aiPreview.title}
          originalText={aiPreview.originalText}
          generatedText={aiPreview.generatedText}
          streaming={aiPreview.streaming}
          error={aiPreview.error}
          onReplace={() => {
            if (!aiPreview.generatedText) return;
            editor
              .chain()
              .focus()
              .insertContentAt(aiPreview.range, aiPreview.generatedText)
              .run();
            setAiPreview(null);
          }}
          onInsertBelow={() => {
            if (!aiPreview.generatedText) return;
            const at = aiPreview.range.to;
            editor
              .chain()
              .focus()
              .insertContentAt(at, '\n' + aiPreview.generatedText)
              .run();
            setAiPreview(null);
          }}
          onRetry={() => {
            void runAIStream(
              aiPreview.title,
              aiPreview.lastPrompt.sys,
              aiPreview.lastPrompt.user,
              aiPreview.originalText,
              aiPreview.lastPrompt.context,
              aiPreview.range,
            );
          }}
          onDiscard={() => {
            abortRef.current?.abort();
            setAiPreview(null);
          }}
        />
      )}
    </div>
  );
};
