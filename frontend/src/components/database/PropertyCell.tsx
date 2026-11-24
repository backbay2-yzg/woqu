import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, Plus, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { evaluateFormula } from '@/lib/formula';
import { computeRollup } from '@/lib/rollup';
import { useAppStore } from '@/stores/appStore';
import type { DatabaseFull, Page, PropertyOption, PropertySchema } from '@/types';
import { buildRelatedDBMap, getOptionColorClass } from './dbHelpers';

interface PropertyCellProps {
  dbId: string;
  row: Page;
  prop: PropertySchema;
  schema: PropertySchema[];
  relatedDatabases: Record<string, DatabaseFull>;
  readonly?: boolean;
  onUpdateCell: (propId: string, value: unknown, newSchemaOption?: PropertyOption) => void;
  onOpenRow?: () => void;
  onRefreshAutofill?: (rowId: string, propId: string) => Promise<void>;
}

export const PropertyCell: React.FC<PropertyCellProps> = ({
  row,
  prop,
  schema,
  relatedDatabases,
  readonly,
  onUpdateCell,
  onOpenRow,
  onRefreshAutofill,
}) => {
  const loadDatabaseFull = useAppStore((s) => s.loadDatabaseFull);
  const value = prop.type === 'title' ? (row.properties[prop.id] as string) || row.title : row.properties[prop.id];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newOptText, setNewOptText] = useState('');
  const [autofilling, setAutofilling] = useState(false);

  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);

  useEffect(() => {
    if (prop.type === 'relation' && prop.relation_database_id && !relatedDatabases[prop.relation_database_id]) {
      void loadDatabaseFull(prop.relation_database_id);
    }
  }, [prop.type, prop.relation_database_id, relatedDatabases, loadDatabaseFull]);

  if (prop.type === 'title') {
    return (
      <div className="flex items-center justify-between gap-2 group min-w-0">
        {editing && !readonly ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() !== String(value ?? '')) {
                onUpdateCell(prop.id, draft.trim() || '无标题');
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditing(false);
                onUpdateCell(prop.id, draft.trim() || '无标题');
              }
            }}
            className="w-full bg-white dark:bg-zinc-900 border border-blue-400 rounded px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => (onOpenRow ? onOpenRow() : !readonly && setEditing(true))}
              className="text-sm font-medium text-left truncate hover:text-blue-600 dark:hover:text-blue-400 transition"
            >
              <span className="mr-1.5">{row.icon || '📄'}</span>
              {String(value || '无标题')}
            </button>
            {onOpenRow && (
              <button
                type="button"
                onClick={onOpenRow}
                className="opacity-0 group-hover:opacity-100 shrink-0 px-1.5 py-0.5 rounded text-[10px] border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-500 hover:text-slate-800 dark:hover:text-zinc-100 transition"
              >
                打开
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (prop.type === 'checkbox') {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        disabled={readonly}
        onClick={() => onUpdateCell(prop.id, !checked)}
        className={`w-5 h-5 rounded border flex items-center justify-center transition ${
          checked
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'border-slate-300 dark:border-zinc-600 hover:border-blue-400'
        }`}
      >
        {checked && <Check className="w-3.5 h-3.5" />}
      </button>
    );
  }

  if (prop.type === 'formula') {
    const relMap = buildRelatedDBMap(relatedDatabases);
    const res = evaluateFormula(prop.formula_expression || '', {
      row,
      schema,
      allDatabases: relMap,
      resolveRollup: (rp) => computeRollup(row, rp, schema, relMap).raw,
    });
    return (
      <span
        className={`text-xs font-mono px-1.5 py-0.5 rounded ${
          res.error
            ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300'
            : 'text-slate-700 dark:text-zinc-200'
        }`}
      >
        {res.formatted || '—'}
      </span>
    );
  }

  if (prop.type === 'rollup') {
    const res = computeRollup(row, prop, schema, buildRelatedDBMap(relatedDatabases));
    return <span className="text-xs font-medium text-slate-700 dark:text-zinc-200">{res.formatted}</span>;
  }

  if (prop.type === 'created_time' || prop.type === 'updated_time') {
    const raw = prop.type === 'created_time' ? row.created_at : row.updated_at;
    return <span className="text-xs text-slate-400">{raw ? raw.slice(0, 16).replace('T', ' ') : '—'}</span>;
  }

  if (prop.type === 'select' || prop.type === 'multi_select') {
    const isMulti = prop.type === 'multi_select';
    const selected: string[] = isMulti
      ? Array.isArray(value)
        ? (value as string[])
        : []
      : value
        ? [String(value)]
        : [];
    const options = prop.options || [];

    return (
      <div className="relative">
        <div
          onClick={() => !readonly && setDropdownOpen((v) => !v)}
          className="flex flex-wrap items-center gap-1 min-h-6 cursor-pointer"
        >
          {selected.length === 0 && <span className="text-xs text-slate-300 dark:text-zinc-600">—</span>}
          {selected.map((s) => {
            const opt = options.find((o) => o.name === s);
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getOptionColorClass(opt?.color)}`}
              >
                {s}
              </span>
            );
          })}
        </div>

        {dropdownOpen && !readonly && (
          <div className="absolute left-0 top-7 z-40 w-48 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-2 space-y-1.5">
            <div className="max-h-40 overflow-y-auto space-y-1">
              {options.map((opt) => {
                const active = selected.includes(opt.name);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (isMulti) {
                        const next = active
                          ? selected.filter((x) => x !== opt.name)
                          : [...selected, opt.name];
                        onUpdateCell(prop.id, next);
                      } else {
                        onUpdateCell(prop.id, active ? '' : opt.name);
                        setDropdownOpen(false);
                      }
                    }}
                    className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs"
                  >
                    <span className={`px-2 py-0.5 rounded-full ${getOptionColorClass(opt.color)}`}>{opt.name}</span>
                    {active && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 pt-1 border-t border-slate-100 dark:border-zinc-800">
              <input
                value={newOptText}
                onChange={(e) => setNewOptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newOptText.trim()) {
                    const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan'];
                    const newOpt: PropertyOption = {
                      id: `opt_${Date.now()}`,
                      name: newOptText.trim(),
                      color: colors[options.length % colors.length],
                    };
                    onUpdateCell(prop.id, isMulti ? [...selected, newOpt.name] : newOpt.name, newOpt);
                    setNewOptText('');
                    if (!isMulti) setDropdownOpen(false);
                  }
                }}
                placeholder="新增选项..."
                className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-slate-200 dark:border-zinc-700 bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => setDropdownOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (prop.type === 'relation') {
    const linkedIDs = Array.isArray(value) ? (value as string[]) : [];
    const targetDB = prop.relation_database_id ? relatedDatabases[prop.relation_database_id] : undefined;
    const targetRows = targetDB?.rows || [];

    return (
      <div className="relative">
        <div
          onClick={() => !readonly && setDropdownOpen((v) => !v)}
          className="flex flex-wrap items-center gap-1 min-h-6 cursor-pointer"
        >
          {linkedIDs.length === 0 && <span className="text-xs text-slate-300 dark:text-zinc-600">+ 关联</span>}
          {linkedIDs.map((id) => {
            const matched = targetRows.find((r) => r.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-zinc-800 text-xs font-medium border border-slate-200 dark:border-zinc-700"
              >
                <span>📄</span>
                <span className="truncate max-w-28">{matched?.title || id.slice(0, 6)}</span>
              </span>
            );
          })}
        </div>

        {dropdownOpen && !readonly && (
          <div className="absolute left-0 top-7 z-40 w-56 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-2 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>关联：{targetDB?.database.title || '目标库'}</span>
              <button type="button" onClick={() => setDropdownOpen(false)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {targetRows.length === 0 ? (
                <div className="text-xs text-slate-400 p-2 text-center">目标库暂无记录</div>
              ) : (
                targetRows.map((tr) => {
                  const active = linkedIDs.includes(tr.id);
                  return (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? linkedIDs.filter((x) => x !== tr.id)
                          : [...linkedIDs, tr.id];
                        onUpdateCell(prop.id, next);
                      }}
                      className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs text-left"
                    >
                      <span className="truncate">{tr.title}</span>
                      {active && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (prop.type === 'ai_autofill') {
    const str = value == null ? '' : String(value);
    return (
      <div className="flex items-center justify-between gap-2 group">
        <span className="text-xs text-slate-700 dark:text-zinc-200 line-clamp-2 flex-1">
          {str || <span className="text-slate-300 dark:text-zinc-600">待生成</span>}
        </span>
        {!readonly && onRefreshAutofill && (
          <button
            type="button"
            disabled={autofilling}
            onClick={async () => {
              setAutofilling(true);
              try {
                await onRefreshAutofill(row.id, prop.id);
              } finally {
                setAutofilling(false);
              }
            }}
            title="AI 生成此单元格"
            className="opacity-70 group-hover:opacity-100 p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 text-purple-600 dark:text-purple-300 shrink-0"
          >
            <Sparkles className={`w-3.5 h-3.5 ${autofilling ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
    );
  }

  if (prop.type === 'date') {
    return (
      <input
        type="date"
        disabled={readonly}
        value={draft ? draft.slice(0, 10) : ''}
        onChange={(e) => {
          setDraft(e.target.value);
          onUpdateCell(prop.id, e.target.value);
        }}
        className="bg-transparent text-xs text-slate-700 dark:text-zinc-200 outline-none cursor-pointer"
      />
    );
  }

  if (prop.type === 'files') {
    const urlStr = typeof value === 'string' ? value : '';
    return (
      <div className="flex items-center gap-1.5">
        {urlStr ? (
          <a
            href={urlStr}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline truncate max-w-32"
          >
            查看附件
          </a>
        ) : (
          <span className="text-xs text-slate-300 dark:text-zinc-600">—</span>
        )}
        {!readonly && (
          <label className="cursor-pointer p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400">
            <Plus className="w-3 h-3" />
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const uploaded = await api.uploadAsset(f, row.id);
                onUpdateCell(prop.id, uploaded.url);
              }}
            />
          </label>
        )}
      </div>
    );
  }

  if (prop.type === 'number') {
    const numDisplay =
      value === null || value === undefined || value === ''
        ? '—'
        : prop.number_format === 'currency'
          ? `¥${Number(value).toLocaleString()}`
          : prop.number_format === 'percent'
            ? `${value}%`
            : String(value);
    return editing && !readonly ? (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onUpdateCell(prop.id, draft === '' ? null : Number(draft));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false);
            onUpdateCell(prop.id, draft === '' ? null : Number(draft));
          }
        }}
        className="w-24 rounded border border-blue-400 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-xs outline-none"
      />
    ) : (
      <div
        onClick={() => !readonly && setEditing(true)}
        className="text-xs text-slate-700 dark:text-zinc-200 cursor-text min-h-5 flex items-center"
      >
        {numDisplay}
      </div>
    );
  }

  // Default: text, url, email, phone, person
  return editing && !readonly ? (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        onUpdateCell(prop.id, draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setEditing(false);
          onUpdateCell(prop.id, draft);
        }
      }}
      className="w-full rounded border border-blue-400 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-xs outline-none"
    />
  ) : (
    <div
      onClick={() => !readonly && setEditing(true)}
      className="text-xs text-slate-700 dark:text-zinc-200 cursor-text min-h-5 flex items-center gap-1 truncate"
    >
      {prop.type === 'url' && draft ? (
        <a
          href={draft.startsWith('http') ? draft : `https://${draft}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 truncate"
        >
          <span className="truncate">{draft}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      ) : (
        <span className="truncate">{draft || <span className="text-slate-300 dark:text-zinc-600">—</span>}</span>
      )}
    </div>
  );
};
