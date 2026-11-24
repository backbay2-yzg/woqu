import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CalendarDays,
  Filter,
  Kanban,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type {
  DatabaseFull,
  DatabaseViewType,
  Page,
  PropertyOption,
  PropertySchema,
  ViewFilterRule,
  ViewSortRule,
} from '@/types';
import { applyFiltersAndSorts } from './dbHelpers';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { CalendarView } from './CalendarView';
import { GalleryView } from './GalleryView';
import { PropertyEditorModal } from './PropertyEditorModal';
import { RowPeekDrawer } from './RowPeekDrawer';

interface DatabaseContainerProps {
  databaseId: string;
  initialData?: DatabaseFull;
  readonly?: boolean;
  onOpenPage?: (pageId: string) => void;
}

const VIEW_ICONS: Record<DatabaseViewType, React.ReactNode> = {
  table: <Table2 className="w-3.5 h-3.5" />,
  kanban: <Kanban className="w-3.5 h-3.5" />,
  calendar: <CalendarDays className="w-3.5 h-3.5" />,
  gallery: <LayoutGrid className="w-3.5 h-3.5" />,
};

export const DatabaseContainer: React.FC<DatabaseContainerProps> = ({
  databaseId,
  initialData,
  readonly = false,
  onOpenPage,
}) => {
  const relatedDatabases = useAppStore((s) => s.relatedDatabases);
  const loadDatabaseFull = useAppStore((s) => s.loadDatabaseFull);

  const [data, setData] = useState<DatabaseFull | null>(initialData || null);
  const [activeViewId, setActiveViewId] = useState<string>(initialData?.views[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [peekRowId, setPeekRowId] = useState<string | null>(null);
  const [autofillRunning, setAutofillRunning] = useState(false);

  const fetchDB = async () => {
    const full = await loadDatabaseFull(databaseId);
    if (full) {
      setData(full);
      if (!activeViewId && full.views.length > 0) {
        setActiveViewId(full.views[0].id);
      }
      for (const prop of full.database.schema) {
        if (prop.type === 'relation' && prop.relation_database_id && !relatedDatabases[prop.relation_database_id]) {
          void loadDatabaseFull(prop.relation_database_id);
        }
      }
    }
  };

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      if (initialData.views.length > 0) setActiveViewId(initialData.views[0].id);
      return;
    }
    void fetchDB();
  }, [databaseId, initialData]);

  const activeView = useMemo(
    () => data?.views.find((v) => v.id === activeViewId) || data?.views[0] || null,
    [data, activeViewId],
  );

  const processedRows = useMemo(() => {
    if (!data) return [];
    const cfg = activeView?.config || {};
    return applyFiltersAndSorts(
      data.rows,
      data.database.schema,
      cfg.filters || [],
      cfg.sorts || [],
      searchQuery,
      relatedDatabases,
    );
  }, [data, activeView, searchQuery, relatedDatabases]);

  if (!data) {
    return <div className="p-6 text-xs text-slate-400">正在加载多维数据库...</div>;
  }

  const { database, views, rows } = data;
  const peekRow = rows.find((r) => r.id === peekRowId) || null;
  const aiCols = database.schema.filter((p) => p.type === 'ai_autofill');

  const updateViewConfig = async (patch: Record<string, unknown>) => {
    if (!activeView || readonly) return;
    const nextConfig = { ...activeView.config, ...patch };
    const updated = await api.updateDatabaseView(database.id, activeView.id, { config: nextConfig });
    setData((prev) =>
      prev ? { ...prev, views: prev.views.map((v) => (v.id === updated.id ? updated : v)) } : null,
    );
  };

  const handleUpdateCell = async (
    rowId: string,
    propId: string,
    value: unknown,
    newSchemaOpt?: PropertyOption,
  ) => {
    if (readonly) return;
    if (newSchemaOpt) {
      const nextSchema = database.schema.map((p) =>
        p.id === propId ? { ...p, options: [...(p.options || []), newSchemaOpt] } : p,
      );
      await api.updateDatabaseSchema(database.id, nextSchema);
    }

    const titleProp = database.schema.find((p) => p.type === 'title');
    const titleVal = propId === titleProp?.id ? String(value || '无标题') : undefined;
    const updatedRow = await api.updateDatabaseRow(database.id, rowId, {
      title: titleVal,
      properties: { [propId]: value },
    });

    setData((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.id === rowId ? updatedRow : r)) } : null,
    );
    // Refresh if this was a relation change (to reflect synced two-way / rollups)
    const changedProp = database.schema.find((p) => p.id === propId);
    if (changedProp?.type === 'relation' && changedProp.relation_database_id) {
      void loadDatabaseFull(changedProp.relation_database_id);
    }
  };

  const handleCreateRow = async (initialProps?: Record<string, unknown>) => {
    if (readonly) return;
    const newRow = await api.createDatabaseRow(database.id, {
      title: '新记录',
      properties: initialProps || {},
    });
    setData((prev) => (prev ? { ...prev, rows: [...prev.rows, newRow] } : null));
    setPeekRowId(newRow.id);
  };

  const handleDeleteRow = async (rowId: string) => {
    if (readonly) return;
    await api.deleteDatabaseRow(database.id, rowId);
    setData((prev) => (prev ? { ...prev, rows: prev.rows.filter((r) => r.id !== rowId) } : null));
  };

  const handleSaveSchema = async (nextSchema: PropertySchema[]) => {
    const updatedMeta = await api.updateDatabaseSchema(database.id, nextSchema);
    setData((prev) => (prev ? { ...prev, database: updatedMeta } : null));
    for (const p of updatedMeta.schema) {
      if (p.type === 'relation' && p.relation_database_id) {
        void loadDatabaseFull(p.relation_database_id);
      }
    }
  };

  const handleCreateView = async (type: DatabaseViewType) => {
    const labels: Record<DatabaseViewType, string> = {
      table: '表格视图',
      kanban: '看板视图',
      calendar: '日历视图',
      gallery: '画廊视图',
    };
    const v = await api.createDatabaseView(database.id, { name: labels[type], type });
    setData((prev) => (prev ? { ...prev, views: [...prev.views, v] } : null));
    setActiveViewId(v.id);
    setAddViewOpen(false);
  };

  const handleDeleteView = async (viewId: string) => {
    if (views.length <= 1) return;
    await api.deleteDatabaseView(database.id, viewId);
    const remaining = views.filter((v) => v.id !== viewId);
    setData((prev) => (prev ? { ...prev, views: remaining } : null));
    if (activeViewId === viewId && remaining[0]) setActiveViewId(remaining[0].id);
  };

  const handleRefreshAutofill = async (rowId: string, propId: string) => {
    await api.autofillDatabase(database.id, propId, [rowId]);
    await fetchDB();
  };

  const handleBatchAutofill = async (propId: string) => {
    setAutofillRunning(true);
    try {
      await api.autofillDatabase(database.id, propId);
      await fetchDB();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI 填充失败');
    } finally {
      setAutofillRunning(false);
    }
  };

  const filters = activeView?.config?.filters || [];
  const sorts = activeView?.config?.sorts || [];

  return (
    <div className="space-y-3">
      {/* Header for inline DB */}
      {database.is_inline && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>{database.icon}</span>
            <span>{database.title}</span>
          </div>
        </div>
      )}

      {/* View Switcher & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-200 dark:border-zinc-800">
        <div className="flex items-center gap-1 flex-wrap">
          {views.map((v) => {
            const active = activeView?.id === v.id;
            return (
              <div key={v.id} className="flex items-center group">
                <button
                  type="button"
                  onClick={() => setActiveViewId(v.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    active
                      ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100'
                      : 'text-slate-500 hover:bg-slate-100/60 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {VIEW_ICONS[v.type]}
                  <span>{v.name}</span>
                </button>
                {!readonly && views.length > 1 && active && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteView(v.id)}
                    className="p-1 text-slate-400 hover:text-rose-500"
                    title="删除此视图"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {!readonly && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAddViewOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <Plus className="w-3.5 h-3.5" />
                视图
              </button>
              {addViewOpen && (
                <div className="absolute left-0 top-9 z-40 w-36 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-1 space-y-0.5 text-xs">
                  {(['table', 'kanban', 'calendar', 'gallery'] as DatabaseViewType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => void handleCreateView(t)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800"
                    >
                      {VIEW_ICONS[t]}
                      <span>{t === 'table' ? '表格' : t === 'kanban' ? '看板' : t === 'calendar' ? '日历' : '画廊'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="筛选记录..."
              className="w-32 focus:w-44 transition-all pl-7 pr-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent text-xs outline-none"
            />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setFilterOpen((v) => !v);
                setSortOpen(false);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition ${
                filters.length > 0
                  ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/50 text-blue-600'
                  : 'border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              筛选 {filters.length > 0 ? `(${filters.length})` : ''}
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-9 z-40 w-80 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3 space-y-2 text-xs">
                <div className="font-semibold text-slate-500">条件筛选</div>
                {filters.map((f, idx) => (
                  <div key={f.id} className="flex items-center gap-1">
                    <select
                      value={f.property_id}
                      onChange={(e) => {
                        const next = [...filters];
                        next[idx] = { ...f, property_id: e.target.value };
                        void updateViewConfig({ filters: next });
                      }}
                      className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1 max-w-24"
                    >
                      {database.schema.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={f.operator}
                      onChange={(e) => {
                        const next = [...filters];
                        next[idx] = { ...f, operator: e.target.value as ViewFilterRule['operator'] };
                        void updateViewConfig({ filters: next });
                      }}
                      className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1"
                    >
                      <option value="contains">包含</option>
                      <option value="equals">等于</option>
                      <option value="not_equals">不等于</option>
                      <option value="gt">大于</option>
                      <option value="lt">小于</option>
                      <option value="is_empty">为空</option>
                      <option value="is_not_empty">非空</option>
                      <option value="is_checked">已勾选</option>
                    </select>
                    {!['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(f.operator) && (
                      <input
                        value={f.value}
                        onChange={(e) => {
                          const next = [...filters];
                          next[idx] = { ...f, value: e.target.value };
                          void updateViewConfig({ filters: next });
                        }}
                        placeholder="值"
                        className="flex-1 min-w-0 rounded border border-slate-200 dark:border-zinc-700 bg-transparent px-1.5 py-1"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => void updateViewConfig({ filters: filters.filter((x) => x.id !== f.id) })}
                      className="p-1 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    void updateViewConfig({
                      filters: [
                        ...filters,
                        {
                          id: `flt_${Date.now()}`,
                          property_id: database.schema[0]?.id || '',
                          operator: 'contains',
                          value: '',
                        },
                      ],
                    })
                  }
                  className="text-blue-600 hover:underline"
                >
                  + 添加筛选条件
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setSortOpen((v) => !v);
                setFilterOpen(false);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition ${
                sorts.length > 0
                  ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/50 text-blue-600'
                  : 'border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              排序 {sorts.length > 0 ? `(${sorts.length})` : ''}
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-9 z-40 w-64 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-3 space-y-2 text-xs">
                <div className="font-semibold text-slate-500">排序规则</div>
                {sorts.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <select
                      value={s.property_id}
                      onChange={(e) => {
                        const next = [...sorts];
                        next[idx] = { ...s, property_id: e.target.value };
                        void updateViewConfig({ sorts: next });
                      }}
                      className="flex-1 rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1"
                    >
                      {database.schema.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={s.direction}
                      onChange={(e) => {
                        const next = [...sorts];
                        next[idx] = { ...s, direction: e.target.value as ViewSortRule['direction'] };
                        void updateViewConfig({ sorts: next });
                      }}
                      className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1"
                    >
                      <option value="asc">升序</option>
                      <option value="desc">降序</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void updateViewConfig({ sorts: sorts.filter((_, i) => i !== idx) })}
                      className="p-1 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    void updateViewConfig({
                      sorts: [...sorts, { property_id: database.schema[0]?.id || '', direction: 'asc' }],
                    })
                  }
                  className="text-blue-600 hover:underline"
                >
                  + 添加排序字段
                </button>
              </div>
            )}
          </div>

          {!readonly && aiCols.length > 0 && (
            <button
              type="button"
              disabled={autofillRunning}
              onClick={() => void handleBatchAutofill(aiCols[0].id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium"
            >
              <Sparkles className={`w-3.5 h-3.5 ${autofillRunning ? 'animate-spin' : ''}`} />
              {autofillRunning ? 'AI 填充中...' : `AI 填充 (${aiCols[0].name})`}
            </button>
          )}

          {!readonly && (
            <button
              type="button"
              onClick={() => setSchemaModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs"
            >
              <Settings2 className="w-3.5 h-3.5" />
              字段设置
            </button>
          )}

          {!readonly && (
            <button
              type="button"
              onClick={() => void handleCreateRow()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              新建
            </button>
          )}
        </div>
      </div>

      {/* View Body */}
      {activeView?.type === 'kanban' ? (
        <KanbanView
          schema={database.schema}
          rows={processedRows}
          groupByPropId={activeView.config?.group_by}
          relatedDatabases={relatedDatabases}
          readonly={readonly}
          onOpenRow={(r) => setPeekRowId(r.id)}
          onMoveRowGroup={(rowId, propId, newVal) => void handleUpdateCell(rowId, propId, newVal)}
          onCreateRowWithGroup={(propId, val) => void handleCreateRow({ [propId]: val })}
        />
      ) : activeView?.type === 'calendar' ? (
        <CalendarView
          schema={database.schema}
          rows={processedRows}
          datePropId={activeView.config?.date_property}
          readonly={readonly}
          onOpenRow={(r) => setPeekRowId(r.id)}
          onCreateRowWithDate={(propId, dateStr) => void handleCreateRow({ [propId]: dateStr })}
        />
      ) : activeView?.type === 'gallery' ? (
        <GalleryView
          schema={database.schema}
          rows={processedRows}
          cardSize={activeView.config?.card_size}
          showProperties={activeView.config?.show_properties}
          relatedDatabases={relatedDatabases}
          readonly={readonly}
          onOpenRow={(r) => setPeekRowId(r.id)}
          onCreateRow={() => void handleCreateRow()}
        />
      ) : (
        <TableView
          dbId={database.id}
          schema={database.schema}
          rows={processedRows}
          hiddenProps={activeView?.config?.hidden_properties}
          relatedDatabases={relatedDatabases}
          readonly={readonly}
          onOpenRow={(r) => setPeekRowId(r.id)}
          onUpdateCell={(rowId, propId, val, opt) => void handleUpdateCell(rowId, propId, val, opt)}
          onCreateRow={() => void handleCreateRow()}
          onDeleteRow={(rowId) => void handleDeleteRow(rowId)}
          onOpenSchemaModal={() => setSchemaModalOpen(true)}
          onRefreshAutofill={handleRefreshAutofill}
        />
      )}

      <PropertyEditorModal
        open={schemaModalOpen}
        database={database}
        sampleRow={rows[0]}
        onClose={() => setSchemaModalOpen(false)}
        onSaveSchema={handleSaveSchema}
      />

      <RowPeekDrawer
        dbId={database.id}
        row={peekRow}
        schema={database.schema}
        relatedDatabases={relatedDatabases}
        readonly={readonly}
        onClose={() => setPeekRowId(null)}
        onOpenFullPage={(pid) => onOpenPage?.(pid)}
        onUpdateCell={(rowId, propId, val, opt) => void handleUpdateCell(rowId, propId, val, opt)}
        onDeleteRow={(rowId) => void handleDeleteRow(rowId)}
        onRefreshAutofill={handleRefreshAutofill}
        onRowContentSaved={(updated) => {
          setData((prev) =>
            prev ? { ...prev, rows: prev.rows.map((r) => (r.id === updated.id ? updated : r)) } : null,
          );
        }}
      />
    </div>
  );
};
