import React from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { DatabaseFull, Page, PropertySchema } from '@/types';
import { formatCellString, getOptionColorClass } from './dbHelpers';

interface KanbanViewProps {
  schema: PropertySchema[];
  rows: Page[];
  groupByPropId?: string;
  relatedDatabases: Record<string, DatabaseFull>;
  readonly?: boolean;
  onOpenRow: (row: Page) => void;
  onMoveRowGroup: (rowId: string, propId: string, newValue: unknown) => void;
  onCreateRowWithGroup: (propId: string, groupValue: unknown) => void;
}

const UNGROUPED = '__ungrouped__';

export const KanbanView: React.FC<KanbanViewProps> = ({
  schema,
  rows,
  groupByPropId,
  relatedDatabases,
  readonly,
  onOpenRow,
  onMoveRowGroup,
  onCreateRowWithGroup,
}) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const groupProp =
    schema.find((p) => p.id === groupByPropId) ||
    schema.find((p) => p.type === 'select' || p.type === 'checkbox');

  if (!groupProp) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-700 p-8 text-center text-xs text-slate-400">
        当前数据库暂无可用于看板分组的「单选」或「复选框」字段，请先在字段管理中添加。
      </div>
    );
  }

  const columns: Array<{ key: string; label: string; color?: string; rawVal: unknown }> =
    groupProp.type === 'checkbox'
      ? [
          { key: 'false', label: '未完成', color: 'gray', rawVal: false },
          { key: 'true', label: '已完成', color: 'green', rawVal: true },
        ]
      : [
          ...(groupProp.options || []).map((o) => ({
            key: o.name,
            label: o.name,
            color: o.color,
            rawVal: o.name,
          })),
          { key: UNGROUPED, label: '未分类', color: 'gray', rawVal: '' },
        ];

  const getRowGroupKey = (r: Page) => {
    const val = r.properties[groupProp.id];
    if (groupProp.type === 'checkbox') return val ? 'true' : 'false';
    const str = val ? String(val) : '';
    return str && columns.some((c) => c.key === str) ? str : UNGROUPED;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (readonly) return;
    const { active, over } = event;
    if (!over) return;
    const rowId = String(active.id);
    const targetKey = String(over.id);
    const col = columns.find((c) => c.key === targetKey);
    if (!col) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row || getRowGroupKey(row) === targetKey) return;
    onMoveRowGroup(rowId, groupProp.id, col.rawVal);
  };

  const previewProps = schema.filter((p) => p.type !== 'title' && p.id !== groupProp.id).slice(0, 3);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3.5 overflow-x-auto pb-3">
        {columns.map((col) => {
          const colRows = rows.filter((r) => getRowGroupKey(r) === col.key);
          return (
            <KanbanColumn
              key={col.key}
              colKey={col.key}
              label={col.label}
              color={col.color}
              count={colRows.length}
              readonly={readonly}
              onCreate={() => onCreateRowWithGroup(groupProp.id, col.rawVal)}
            >
              {colRows.map((row) => (
                <KanbanCard
                  key={row.id}
                  row={row}
                  readonly={readonly}
                  previewProps={previewProps}
                  schema={schema}
                  relatedDatabases={relatedDatabases}
                  onOpen={() => onOpenRow(row)}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>
    </DndContext>
  );
};

const KanbanColumn: React.FC<{
  colKey: string;
  label: string;
  color?: string;
  count: number;
  readonly?: boolean;
  onCreate: () => void;
  children: React.ReactNode;
}> = ({ colKey, label, color, count, readonly, onCreate, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-xl p-2.5 flex flex-col gap-2 border transition ${
        isOver
          ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700'
          : 'bg-slate-50/80 dark:bg-zinc-900/60 border-slate-200/70 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-center justify-between px-1 py-0.5">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getOptionColorClass(color)}`}>
            {label}
          </span>
          <span className="text-xs text-slate-400">{count}</span>
        </div>
        {!readonly && (
          <button
            type="button"
            onClick={onCreate}
            className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-zinc-800 text-slate-400"
            title="在此分组新增卡片"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-2 min-h-16">{children}</div>
    </div>
  );
};

const KanbanCard: React.FC<{
  row: Page;
  readonly?: boolean;
  previewProps: PropertySchema[];
  schema: PropertySchema[];
  relatedDatabases: Record<string, DatabaseFull>;
  onOpen: () => void;
}> = ({ row, readonly, previewProps, schema, relatedDatabases, onOpen }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    disabled: readonly,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={`rounded-xl border border-slate-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 p-3 shadow-xs hover:shadow-md cursor-pointer transition space-y-2 ${
        isDragging ? 'opacity-60 ring-2 ring-blue-500 z-30' : ''
      }`}
    >
      <div className="text-sm font-medium flex items-start gap-1.5">
        <span>{row.icon || '📄'}</span>
        <span className="line-clamp-2">{row.title || '无标题'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {previewProps.map((p) => {
          const text = formatCellString(row, p, schema, relatedDatabases);
          if (!text) return null;
          return (
            <span
              key={p.id}
              className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-[11px] text-slate-600 dark:text-zinc-300 truncate max-w-full"
            >
              {p.name}: {text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
