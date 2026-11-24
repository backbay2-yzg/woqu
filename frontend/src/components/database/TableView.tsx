import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DatabaseFull, Page, PropertyOption, PropertySchema } from '@/types';
import { PropertyCell } from './PropertyCell';
import { resolveCellValue } from './dbHelpers';

interface TableViewProps {
  dbId: string;
  schema: PropertySchema[];
  rows: Page[];
  hiddenProps?: string[];
  relatedDatabases: Record<string, DatabaseFull>;
  readonly?: boolean;
  onOpenRow: (row: Page) => void;
  onUpdateCell: (rowId: string, propId: string, value: unknown, newOpt?: PropertyOption) => void;
  onCreateRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onOpenSchemaModal: () => void;
  onRefreshAutofill: (rowId: string, propId: string) => Promise<void>;
}

type AggKind = 'none' | 'count' | 'filled' | 'sum' | 'avg';

export const TableView: React.FC<TableViewProps> = ({
  dbId,
  schema,
  rows,
  hiddenProps = [],
  relatedDatabases,
  readonly,
  onOpenRow,
  onUpdateCell,
  onCreateRow,
  onDeleteRow,
  onOpenSchemaModal,
  onRefreshAutofill,
}) => {
  const [colAggs, setColAggs] = useState<Record<string, AggKind>>({});
  const visibleSchema = schema.filter((p) => p.type === 'title' || !hiddenProps.includes(p.id));

  const calcAgg = (prop: PropertySchema, kind: AggKind) => {
    if (!kind || kind === 'none') return '';
    if (kind === 'count') return `计数 ${rows.length}`;
    const vals = rows.map((r) => resolveCellValue(r, prop, schema, relatedDatabases));
    const filled = vals.filter((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (kind === 'filled') return `非空 ${filled.length}`;
    const nums = filled.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return '—';
    const sum = nums.reduce((a, b) => a + b, 0);
    if (kind === 'sum') return `合计 ${Number(sum.toFixed(2))}`;
    if (kind === 'avg') return `均值 ${Number((sum / nums.length).toFixed(2))}`;
    return '';
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-x-auto bg-white dark:bg-zinc-900/30">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/80 text-xs text-slate-500 dark:text-zinc-400">
            {visibleSchema.map((prop) => (
              <th
                key={prop.id}
                style={{ minWidth: prop.width || 150 }}
                className="px-3 py-2 font-medium border-r border-slate-200/70 dark:border-zinc-800/70 whitespace-nowrap"
              >
                {prop.name}
              </th>
            ))}
            {!readonly && (
              <th className="w-24 px-2 py-2 text-center font-normal">
                <button
                  type="button"
                  onClick={onOpenSchemaModal}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600"
                >
                  <Plus className="w-3.5 h-3.5" />
                  字段
                </button>
              </th>
            )}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/80">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-zinc-800/30 group">
              {visibleSchema.map((prop) => (
                <td
                  key={prop.id}
                  className="px-3 py-2 border-r border-slate-100 dark:border-zinc-800/60 align-middle"
                >
                  <PropertyCell
                    dbId={dbId}
                    row={row}
                    prop={prop}
                    schema={schema}
                    relatedDatabases={relatedDatabases}
                    readonly={readonly}
                    onUpdateCell={(propId, val, opt) => onUpdateCell(row.id, propId, val, opt)}
                    onOpenRow={prop.type === 'title' ? () => onOpenRow(row) : undefined}
                    onRefreshAutofill={onRefreshAutofill}
                  />
                </td>
              ))}
              {!readonly && (
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => onDeleteRow(row.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition"
                    title="删除记录"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}

          {!readonly && (
            <tr>
              <td colSpan={visibleSchema.length + 1} className="px-3 py-2">
                <button
                  type="button"
                  onClick={onCreateRow}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-600 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建记录
                </button>
              </td>
            </tr>
          )}
        </tbody>

        <tfoot>
          <tr className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 text-[11px] text-slate-400">
            {visibleSchema.map((prop, idx) => {
              const kind = colAggs[prop.id] || (idx === 0 ? 'count' : 'none');
              return (
                <td key={prop.id} className="px-3 py-1.5 border-r border-slate-100 dark:border-zinc-800/60">
                  <div className="flex items-center justify-between gap-1">
                    <span>{calcAgg(prop, kind)}</span>
                    <select
                      value={kind}
                      onChange={(e) => setColAggs((p) => ({ ...p, [prop.id]: e.target.value as AggKind }))}
                      className="bg-transparent outline-none text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <option value="none">计算</option>
                      <option value="count">计数</option>
                      <option value="filled">非空</option>
                      <option value="sum">求和</option>
                      <option value="avg">均值</option>
                    </select>
                  </div>
                </td>
              );
            })}
            {!readonly && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
