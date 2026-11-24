import type { Page, PropertySchema } from '@/types';
import { evaluateFormula } from './formula';

export type RollupAggregation =
  | 'count_all'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'avg'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'show_original'
  | 'show_unique';

export interface RollupResult {
  raw: unknown;
  formatted: string;
}

export function computeRollup(
  row: Page,
  prop: PropertySchema,
  schema: PropertySchema[],
  relatedDatabases: Record<string, { schema: PropertySchema[]; rows: Page[] }>,
): RollupResult {
  const relProp = schema.find((p) => p.id === prop.rollup_relation_id);
  if (!relProp || !relProp.relation_database_id) {
    return { raw: null, formatted: '—' };
  }

  const targetDB = relatedDatabases[relProp.relation_database_id];
  if (!targetDB) {
    return { raw: null, formatted: '—' };
  }

  const linkedIDs = Array.isArray(row.properties[relProp.id])
    ? (row.properties[relProp.id] as string[])
    : [];

  const linkedRows = targetDB.rows.filter((r) => linkedIDs.includes(r.id));
  const agg = (prop.rollup_aggregation || 'count_all') as RollupAggregation;

  if (agg === 'count_all') {
    return { raw: linkedRows.length, formatted: String(linkedRows.length) };
  }

  const targetProp = targetDB.schema.find((p) => p.id === prop.rollup_target_prop_id);
  const values = linkedRows.map((lr) => {
    if (!targetProp) return lr.title;
    if (targetProp.type === 'title') return (lr.properties[targetProp.id] as string) || lr.title;
    if (targetProp.type === 'formula') {
      return evaluateFormula(targetProp.formula_expression || '', {
        row: lr,
        schema: targetDB.schema,
        allDatabases: relatedDatabases,
      }).value;
    }
    return lr.properties[targetProp.id];
  });

  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
  const total = values.length;

  switch (agg) {
    case 'count_values':
      return { raw: nonEmpty.length, formatted: String(nonEmpty.length) };
    case 'count_empty': {
      const emptyCount = total - nonEmpty.length;
      return { raw: emptyCount, formatted: String(emptyCount) };
    }
    case 'count_unique': {
      const uniq = new Set(nonEmpty.map((v) => JSON.stringify(v)));
      return { raw: uniq.size, formatted: String(uniq.size) };
    }
    case 'percent_empty': {
      const pct = total === 0 ? 0 : Math.round(((total - nonEmpty.length) / total) * 100);
      return { raw: pct, formatted: `${pct}%` };
    }
    case 'percent_not_empty': {
      const pct = total === 0 ? 0 : Math.round((nonEmpty.length / total) * 100);
      return { raw: pct, formatted: `${pct}%` };
    }
    case 'sum': {
      const sum = nonEmpty.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
      return { raw: sum, formatted: formatNum(sum) };
    }
    case 'avg': {
      const nums = nonEmpty.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
      if (nums.length === 0) return { raw: 0, formatted: '0' };
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { raw: avg, formatted: formatNum(avg) };
    }
    case 'median': {
      const nums = nonEmpty.map((v) => Number(v)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      if (nums.length === 0) return { raw: 0, formatted: '0' };
      const mid = Math.floor(nums.length / 2);
      const med = nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
      return { raw: med, formatted: formatNum(med) };
    }
    case 'min': {
      const nums = nonEmpty.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
      if (nums.length === 0) return { raw: null, formatted: '—' };
      const m = Math.min(...nums);
      return { raw: m, formatted: formatNum(m) };
    }
    case 'max': {
      const nums = nonEmpty.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
      if (nums.length === 0) return { raw: null, formatted: '—' };
      const m = Math.max(...nums);
      return { raw: m, formatted: formatNum(m) };
    }
    case 'range': {
      const nums = nonEmpty.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
      if (nums.length === 0) return { raw: 0, formatted: '0' };
      const r = Math.max(...nums) - Math.min(...nums);
      return { raw: r, formatted: formatNum(r) };
    }
    case 'show_unique': {
      const uniq = Array.from(new Set(nonEmpty.flatMap((v) => (Array.isArray(v) ? v : [v])).map(String)));
      return { raw: uniq, formatted: uniq.join(', ') || '—' };
    }
    case 'show_original':
    default: {
      const list = nonEmpty.flatMap((v) => (Array.isArray(v) ? v : [v])).map(String);
      return { raw: list, formatted: list.join(', ') || '—' };
    }
  }
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

export const ROLLUP_AGGREGATION_OPTIONS: Array<{ value: RollupAggregation; label: string }> = [
  { value: 'count_all', label: '计数 (全部关联项)' },
  { value: 'count_values', label: '计数 (非空值)' },
  { value: 'count_unique', label: '计数 (去重)' },
  { value: 'count_empty', label: '计数 (空值)' },
  { value: 'percent_not_empty', label: '非空百分比' },
  { value: 'percent_empty', label: '空值百分比' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均值' },
  { value: 'median', label: '中位数' },
  { value: 'min', label: '最小值' },
  { value: 'max', label: '最大值' },
  { value: 'range', label: '极差 (最大 - 最小)' },
  { value: 'show_original', label: '显示全部原始值' },
  { value: 'show_unique', label: '显示去重值' },
];
