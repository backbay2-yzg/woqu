import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { evaluateFormula, FORMULA_FUNCTION_DOCS, validateFormula } from '@/lib/formula';
import { ROLLUP_AGGREGATION_OPTIONS } from '@/lib/rollup';
import type { DatabaseMeta, Page, PropertySchema, PropertyType } from '@/types';

const PROPERTY_TYPE_OPTIONS: Array<{ value: PropertyType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '单选' },
  { value: 'multi_select', label: '多选' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '复选框' },
  { value: 'url', label: '网址 URL' },
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '电话' },
  { value: 'person', label: '负责人' },
  { value: 'files', label: '附件' },
  { value: 'relation', label: '关联 (Relation)' },
  { value: 'rollup', label: '汇总 (Rollup)' },
  { value: 'formula', label: '公式 (Formula)' },
  { value: 'ai_autofill', label: 'AI 自动生成' },
  { value: 'created_time', label: '创建时间' },
  { value: 'updated_time', label: '更新时间' },
];

interface PropertyEditorModalProps {
  open: boolean;
  database: DatabaseMeta;
  sampleRow?: Page;
  onClose: () => void;
  onSaveSchema: (nextSchema: PropertySchema[]) => Promise<void>;
}

export const PropertyEditorModal: React.FC<PropertyEditorModalProps> = ({
  open,
  database,
  sampleRow,
  onClose,
  onSaveSchema,
}) => {
  const [schema, setSchema] = useState<PropertySchema[]>(database.schema);
  const [selectedId, setSelectedId] = useState<string>(database.schema[0]?.id || '');
  const [allDBs, setAllDBs] = useState<DatabaseMeta[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchema(database.schema);
    setSelectedId(database.schema[0]?.id || '');
    api.listDatabases().then(setAllDBs).catch(() => {});
  }, [open, database]);

  if (!open) return null;

  const activeProp = schema.find((p) => p.id === selectedId);
  const updateProp = (patch: Partial<PropertySchema>) => {
    setSchema((prev) => prev.map((p) => (p.id === selectedId ? { ...p, ...patch } : p)));
  };

  const addProperty = () => {
    const id = `prop_${Date.now().toString(36)}`;
    const next: PropertySchema = {
      id,
      name: `新字段 ${schema.length}`,
      type: 'text',
      width: 150,
    };
    setSchema((prev) => [...prev, next]);
    setSelectedId(id);
  };

  const removeProperty = (id: string) => {
    const next = schema.filter((p) => p.id !== id);
    setSchema(next);
    if (selectedId === id) setSelectedId(next[0]?.id || '');
  };

  const relationProps = schema.filter((p) => p.type === 'relation');
  const selectedRelation = relationProps.find((p) => p.id === activeProp?.rollup_relation_id);
  const targetDBForRollup = allDBs.find((d) => d.id === selectedRelation?.relation_database_id);

  const formulaErr =
    activeProp?.type === 'formula' && activeProp.formula_expression
      ? validateFormula(activeProp.formula_expression)
      : null;

  const formulaPreview =
    activeProp?.type === 'formula' && activeProp.formula_expression && sampleRow && !formulaErr
      ? evaluateFormula(activeProp.formula_expression, { row: sampleRow, schema }).formatted
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <h3 className="font-semibold text-sm">字段结构管理 — {database.title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
          {/* Left column list */}
          <div className="md:col-span-4 border-r border-slate-200 dark:border-zinc-800 p-3 overflow-y-auto space-y-1 bg-slate-50/50 dark:bg-zinc-950/30">
            {schema.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer transition ${
                  p.id === selectedId
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200 font-medium'
                    : 'hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="truncate">
                  <span>{p.name}</span>
                  <span className="ml-1.5 text-[10px] text-slate-400">({p.type})</span>
                </div>
                {p.type !== 'title' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProperty(p.id);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addProperty}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mt-2 rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Plus className="w-3.5 h-3.5" />
              添加新字段
            </button>
          </div>

          {/* Right config panel */}
          <div className="md:col-span-8 p-5 overflow-y-auto space-y-4">
            {!activeProp ? (
              <div className="text-xs text-slate-400">选择一个字段以编辑属性</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">字段名称</label>
                    <input
                      value={activeProp.name}
                      onChange={(e) => updateProp({ name: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">字段类型</label>
                    <select
                      disabled={activeProp.type === 'title'}
                      value={activeProp.type}
                      onChange={(e) => updateProp({ type: e.target.value as PropertyType })}
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none"
                    >
                      {activeProp.type === 'title' ? (
                        <option value="title">标题 (主列)</option>
                      ) : (
                        PROPERTY_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {activeProp.type === 'number' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">数字格式</label>
                    <select
                      value={activeProp.number_format || 'number'}
                      onChange={(e) => updateProp({ number_format: e.target.value })}
                      className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
                    >
                      <option value="number">纯数字</option>
                      <option value="currency">人民币 ¥</option>
                      <option value="percent">百分比 %</option>
                    </select>
                  </div>
                )}

                {(activeProp.type === 'select' || activeProp.type === 'multi_select') && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-500">预设选项</label>
                    {(activeProp.options || []).map((opt, idx) => (
                      <div key={opt.id} className="flex items-center gap-2">
                        <input
                          value={opt.name}
                          onChange={(e) => {
                            const next = [...(activeProp.options || [])];
                            next[idx] = { ...opt, name: e.target.value };
                            updateProp({ options: next });
                          }}
                          className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent px-2.5 py-1 text-xs"
                        />
                        <select
                          value={opt.color}
                          onChange={(e) => {
                            const next = [...(activeProp.options || [])];
                            next[idx] = { ...opt, color: e.target.value };
                            updateProp({ options: next });
                          }}
                          className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
                        >
                          {['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'cyan'].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            updateProp({ options: (activeProp.options || []).filter((o) => o.id !== opt.id) })
                          }
                          className="p-1 text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateProp({
                          options: [
                            ...(activeProp.options || []),
                            { id: `opt_${Date.now()}`, name: '新选项', color: 'blue' },
                          ],
                        })
                      }
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + 添加选项
                    </button>
                  </div>
                )}

                {activeProp.type === 'relation' && (
                  <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-zinc-800/40 p-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">关联目标数据库</label>
                      <select
                        value={activeProp.relation_database_id || ''}
                        onChange={(e) => updateProp({ relation_database_id: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
                      >
                        <option value="">请选择目标数据库...</option>
                        {allDBs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.icon} {d.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(activeProp.is_two_way)}
                        onChange={(e) => updateProp({ is_two_way: e.target.checked })}
                      />
                      <span>开启双向关联（自动在目标库同步生成反向关联列并保持联动）</span>
                    </label>
                  </div>
                )}

                {activeProp.type === 'rollup' && (
                  <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-zinc-800/40 p-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">1. 选择关联列</label>
                      <select
                        value={activeProp.rollup_relation_id || ''}
                        onChange={(e) => updateProp({ rollup_relation_id: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
                      >
                        <option value="">请选择已有的 Relation 字段...</option>
                        {relationProps.map((rp) => (
                          <option key={rp.id} value={rp.id}>
                            {rp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">2. 目标库字段</label>
                      <select
                        value={activeProp.rollup_target_prop_id || ''}
                        onChange={(e) => updateProp({ rollup_target_prop_id: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
                      >
                        <option value="">请选择目标数据库字段...</option>
                        {(targetDBForRollup?.schema || []).map((tp) => (
                          <option key={tp.id} value={tp.id}>
                            {tp.name} ({tp.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">3. 汇总计算方式</label>
                      <select
                        value={activeProp.rollup_aggregation || 'count_all'}
                        onChange={(e) => updateProp({ rollup_aggregation: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
                      >
                        {ROLLUP_AGGREGATION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {activeProp.type === 'formula' && (
                  <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-zinc-800/40 p-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">公式表达式</label>
                      <textarea
                        rows={3}
                        value={activeProp.formula_expression || ''}
                        onChange={(e) => updateProp({ formula_expression: e.target.value })}
                        placeholder='例如：if(prop("状态") == "已完成", "✅ 已交付", concat("剩余 ", dateBetween(prop("日期"), today(), "days"), " 天"))'
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 font-mono text-xs outline-none"
                      />
                      {formulaErr && <div className="text-xs text-rose-500 mt-1">{formulaErr}</div>}
                      {formulaPreview !== null && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          首行实时预览：<span className="font-mono">{formulaPreview || '(空)'}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[11px] font-medium text-slate-400 mb-1">点击插入字段引用：</div>
                      <div className="flex flex-wrap gap-1">
                        {schema
                          .filter((p) => p.id !== activeProp.id)
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() =>
                                updateProp({
                                  formula_expression: `${activeProp.formula_expression || ''}prop("${p.name}")`,
                                })
                              }
                              className="px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-[11px] hover:border-blue-400"
                            >
                              {p.name}
                            </button>
                          ))}
                      </div>
                    </div>

                    <div className="space-y-1 max-h-32 overflow-y-auto border-t border-slate-200 dark:border-zinc-700 pt-2">
                      {FORMULA_FUNCTION_DOCS.map((doc) => (
                        <div key={doc.name} className="flex justify-between gap-2 text-[11px]">
                          <code className="text-blue-600 dark:text-blue-400">{doc.name}</code>
                          <span className="text-slate-400 text-right">{doc.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeProp.type === 'ai_autofill' && (
                  <div className="space-y-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 p-3.5 border border-purple-200/70 dark:border-purple-900/50">
                    <div>
                      <label className="block text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">
                        AI 生成指令 (Prompt)
                      </label>
                      <textarea
                        rows={3}
                        value={activeProp.ai_prompt || ''}
                        onChange={(e) => updateProp({ ai_prompt: e.target.value })}
                        placeholder="例如：根据标题和正文内容，用一句话提炼关键结论或行动项"
                        className="w-full rounded-lg border border-purple-200 dark:border-purple-800 bg-white dark:bg-zinc-900 p-2.5 text-xs outline-none"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-1.5">引用的上下文列：</div>
                      <div className="flex flex-wrap gap-2">
                        {schema
                          .filter((p) => p.id !== activeProp.id)
                          .map((p) => {
                            const checked = (activeProp.ai_source_prop_ids || []).includes(p.id);
                            return (
                              <label key={p.id} className="inline-flex items-center gap-1 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const cur = activeProp.ai_source_prop_ids || [];
                                    updateProp({
                                      ai_source_prop_ids: e.target.checked
                                        ? [...cur, p.id]
                                        : cur.filter((x) => x !== p.id),
                                    });
                                  }}
                                />
                                <span>{p.name}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSaveSchema(schema);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium"
          >
            {saving ? '保存中...' : '保存字段配置'}
          </button>
        </div>
      </div>
    </div>
  );
};
