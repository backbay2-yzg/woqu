import { evaluateFormula } from '@/lib/formula';
import { computeRollup } from '@/lib/rollup';
import type { DatabaseFull, Page, PropertySchema, ViewFilterRule, ViewSortRule } from '@/types';

export const OPTION_COLORS: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
  yellow: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300',
  red: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-950/70 dark:text-pink-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/70 dark:text-cyan-300',
};

export function getOptionColorClass(color?: string): string {
  return OPTION_COLORS[color || 'gray'] || OPTION_COLORS.gray;
}

export function buildRelatedDBMap(relatedDatabases: Record<string, DatabaseFull>) {
  const map: Record<string, { schema: PropertySchema[]; rows: Page[] }> = {};
  for (const [id, full] of Object.entries(relatedDatabases)) {
    map[id] = { schema: full.database.schema, rows: full.rows };
  }
  return map;
}

export function resolveCellValue(
  row: Page,
  prop: PropertySchema,
  schema: PropertySchema[],
  relatedDatabases: Record<string, DatabaseFull>,
): unknown {
  if (prop.type === 'title') {
    return (row.properties[prop.id] as string) || row.title;
  }
  if (prop.type === 'created_time') return row.created_at;
  if (prop.type === 'updated_time') return row.updated_at;

  const relMap = buildRelatedDBMap(relatedDatabases);

  if (prop.type === 'rollup') {
    return computeRollup(row, prop, schema, relMap).raw;
  }
  if (prop.type === 'formula') {
    return evaluateFormula(prop.formula_expression || '', {
      row,
      schema,
      allDatabases: relMap,
      resolveRollup: (rp) => computeRollup(row, rp, schema, relMap).raw,
    }).value;
  }
  return row.properties[prop.id];
}

export function formatCellString(
  row: Page,
  prop: PropertySchema,
  schema: PropertySchema[],
  relatedDatabases: Record<string, DatabaseFull>,
): string {
  const val = resolveCellValue(row, prop, schema, relatedDatabases);
  if (val === null || val === undefined || val === '') return '';
  if (prop.type === 'checkbox') return val ? 'true' : 'false';
  if (prop.type === 'rollup') {
    return computeRollup(row, prop, schema, buildRelatedDBMap(relatedDatabases)).formatted;
  }
  if (prop.type === 'formula') {
    const relMap = buildRelatedDBMap(relatedDatabases);
    return evaluateFormula(prop.formula_expression || '', {
      row,
      schema,
      allDatabases: relMap,
      resolveRollup: (rp) => computeRollup(row, rp, schema, relMap).raw,
    }).formatted;
  }
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export function applyFiltersAndSorts(
  rows: Page[],
  schema: PropertySchema[],
  filters: ViewFilterRule[] = [],
  sorts: ViewSortRule[] = [],
  searchQuery: string,
  relatedDatabases: Record<string, DatabaseFull>,
): Page[] {
  const q = searchQuery.trim().toLowerCase();

  let filtered = rows.filter((row) => {
    if (q) {
      const titleHit = row.title.toLowerCase().includes(q);
      const propsHit = schema.some((p) =>
        formatCellString(row, p, schema, relatedDatabases).toLowerCase().includes(q),
      );
      if (!titleHit && !propsHit) return false;
    }

    for (const f of filters) {
      const prop = schema.find((p) => p.id === f.property_id);
      if (!prop) continue;
      const rawVal = resolveCellValue(row, prop, schema, relatedDatabases);
      const strVal = formatCellString(row, prop, schema, relatedDatabases).toLowerCase();
      const target = (f.value || '').toLowerCase();

      switch (f.operator) {
        case 'is_empty':
          if (rawVal !== null && rawVal !== undefined && rawVal !== '' && !(Array.isArray(rawVal) && rawVal.length === 0)) {
            return false;
          }
          break;
        case 'is_not_empty':
          if (rawVal === null || rawVal === undefined || rawVal === '' || (Array.isArray(rawVal) && rawVal.length === 0)) {
            return false;
          }
          break;
        case 'is_checked':
          if (!rawVal) return false;
          break;
        case 'is_not_checked':
          if (rawVal) return false;
          break;
        case 'equals':
          if (strVal !== target) return false;
          break;
        case 'not_equals':
          if (strVal === target) return false;
          break;
        case 'contains':
          if (!strVal.includes(target)) return false;
          break;
        case 'not_contains':
          if (strVal.includes(target)) return false;
          break;
        case 'gt':
          if (!(Number(rawVal) > Number(f.value))) return false;
          break;
        case 'lt':
          if (!(Number(rawVal) < Number(f.value))) return false;
          break;
        case 'gte':
          if (!(Number(rawVal) >= Number(f.value))) return false;
          break;
        case 'lte':
          if (!(Number(rawVal) <= Number(f.value))) return false;
          break;
      }
    }
    return true;
  });

  if (sorts.length > 0) {
    filtered = [...filtered].sort((a, b) => {
      for (const s of sorts) {
        const prop = schema.find((p) => p.id === s.property_id);
        if (!prop) continue;
        const va = resolveCellValue(a, prop, schema, relatedDatabases);
        const vb = resolveCellValue(b, prop, schema, relatedDatabases);

        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'zh-CN');
        }
        if (cmp !== 0) {
          return s.direction === 'desc' ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  return filtered;
}
