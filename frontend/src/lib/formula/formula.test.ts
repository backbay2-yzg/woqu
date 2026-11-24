import { describe, it, expect } from 'vitest';
import type { Page, PropertySchema } from '@/types';
import { evaluateFormula, validateFormula } from './index';
import { computeRollup } from '../rollup';

const sampleSchema: PropertySchema[] = [
  { id: 'prop_title', name: '名称', type: 'title' },
  { id: 'prop_price', name: '单价', type: 'number' },
  { id: 'prop_qty', name: '数量', type: 'number' },
  { id: 'prop_total', name: '总价', type: 'formula', formula_expression: 'prop("单价") * prop("数量")' },
  { id: 'prop_tax', name: '含税价', type: 'formula', formula_expression: 'round(prop("总价") * 1.13, 2)' },
  { id: 'prop_cyc_a', name: '循环A', type: 'formula', formula_expression: 'prop("循环B") + 1' },
  { id: 'prop_cyc_b', name: '循环B', type: 'formula', formula_expression: 'prop("循环A") + 1' },
  { id: 'prop_date', name: '开始日期', type: 'date' },
  { id: 'prop_end', name: '结束日期', type: 'date' },
  { id: 'prop_status', name: '状态', type: 'select' },
  { id: 'prop_tags', name: '标签', type: 'multi_select' },
  { id: 'prop_done', name: '已完成', type: 'checkbox' },
];

const sampleRow: Page = {
  id: 'row-1',
  parent_id: null,
  database_id: 'db-1',
  title: 'MacBook Pro 开发机',
  icon: '💻',
  cover_url: '',
  is_database: false,
  content_json: { type: 'doc', content: [] },
  plain_text: '',
  summary: '',
  tags: [],
  properties: {
    prop_title: 'MacBook Pro 开发机',
    prop_price: 12999,
    prop_qty: 2,
    prop_date: '2026-11-01',
    prop_end: '2026-11-16',
    prop_status: '进行中',
    prop_tags: ['硬件', '研发'],
    prop_done: false,
  },
  position: 1000,
  is_favorite: false,
  is_full_width: false,
  is_trashed: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-23T00:00:00Z',
};

function evalExpr(expr: string) {
  return evaluateFormula(expr, { row: sampleRow, schema: sampleSchema });
}

describe('AST Formula Engine', () => {
  it('evaluates arithmetic and operator precedence', () => {
    expect(evalExpr('1 + 2 * 3 - 4 / 2').value).toBe(5);
    expect(evalExpr('(1 + 2) * (3 + 4)').value).toBe(21);
    expect(evalExpr('-5 + 12 % 5').value).toBe(-3);
    expect(evalExpr('pow(2, 10)').value).toBe(1024);
    expect(evalExpr('sqrt(81)').value).toBe(9);
  });

  it('guards division and modulo by zero', () => {
    expect(evalExpr('10 / 0').error).toBe('#DIV/0!');
    expect(evalExpr('10 % 0').error).toBe('#DIV/0!');
  });

  it('evaluates chained formulas and detects cycles', () => {
    expect(evalExpr('prop("总价")').value).toBe(25998);
    expect(evalExpr('prop("含税价")').value).toBe(29377.74);
    expect(evalExpr('prop("循环A")').error).toBe('#CYCLE!');
  });

  it('evaluates logic, ternary, if, ifs, and, or, not, empty, coalesce', () => {
    expect(evalExpr('prop("数量") >= 2 ? "批量" : "单买"').value).toBe('批量');
    expect(evalExpr('if(prop("已完成"), "OK", "Pending")').value).toBe('Pending');
    expect(
      evalExpr('ifs(prop("总价") > 50000, "S", prop("总价") > 20000, "A", "B")').value,
    ).toBe('A');
    expect(evalExpr('and(prop("数量") > 1, not(prop("已完成")))').value).toBe(true);
    expect(evalExpr('or(false, prop("状态") == "进行中")').value).toBe(true);
    expect(evalExpr('empty("") && !empty(prop("标签"))').value).toBe(true);
    expect(evalExpr('coalesce("", null, "兜底值")').value).toBe('兜底值');
  });

  it('evaluates string functions', () => {
    expect(evalExpr('concat("产品：", prop("名称"))').value).toBe('产品：MacBook Pro 开发机');
    expect(evalExpr('join(" / ", prop("标签"))').value).toBe('硬件 / 研发');
    expect(evalExpr('contains(prop("名称"), "MacBook")').value).toBe(true);
    expect(evalExpr('lower(trim("  Hello WORLD  "))').value).toBe('hello world');
    expect(evalExpr('upper("woqu")').value).toBe('WOQU');
    expect(evalExpr('replaceAll("a-b-c", "-", "_")').value).toBe('a_b_c');
    expect(evalExpr('replace("abc123", "\\\\d+", "X")').value).toBe('abcX');
    expect(evalExpr('length(split("a,b,c", ","))').value).toBe(3);
    expect(evalExpr('substring("abcdef", 1, 4)').value).toBe('bcd');
    expect(evalExpr('test("user@woqu.app", "^.+@.+\\\\..+$")').value).toBe(true);
  });

  it('evaluates numeric aggregation functions', () => {
    expect(evalExpr('round(3.14159, 3)').value).toBe(3.142);
    expect(evalExpr('floor(3.9) + ceil(3.1) + abs(-5)').value).toBe(12);
    expect(evalExpr('sum(10, 20, prop("数量"))').value).toBe(32);
    expect(evalExpr('avg(10, 20, 30)').value).toBe(20);
    expect(evalExpr('min(5, 2, 9) + max(5, 2, 9)').value).toBe(11);
    expect(evalExpr('toNumber("42.5") * 2').value).toBe(85);
  });

  it('evaluates date functions accurately', () => {
    expect(evalExpr('dateBetween(prop("结束日期"), prop("开始日期"), "days")').value).toBe(15);
    expect(evalExpr('formatDate(dateAdd(prop("开始日期"), 5, "days"), "YYYY-MM-DD")').value).toBe('2026-11-06');
    expect(evalExpr('formatDate(dateSubtract(prop("结束日期"), 1, "months"), "YYYY/M/D")').value).toBe('2026/10/16');
    expect(evalExpr('year(prop("开始日期"))').value).toBe(2026);
    expect(evalExpr('month(prop("开始日期"))').value).toBe(11);
    expect(evalExpr('date(prop("开始日期"))').value).toBe(1);
    expect(evalExpr('formatDate(today(), "YYYY")').value).toBe(String(new Date().getFullYear()));
  });

  it('evaluates list functions', () => {
    expect(evalExpr('count(prop("标签"))').value).toBe(2);
    expect(evalExpr('first(prop("标签"))').value).toBe('硬件');
    expect(evalExpr('last(prop("标签"))').value).toBe('研发');
    expect(evalExpr('includes(prop("标签"), "研发")').value).toBe(true);
    expect(evalExpr('length(unique(split("a,b,a,c", ",")))').value).toBe(3);
  });

  it('validates syntax errors cleanly without throwing', () => {
    expect(validateFormula('if(1 > 0, "a", "b")')).toBeNull();
    expect(validateFormula('if(1 > 0, "unclosed)')).not.toBeNull();
    expect(evalExpr('unknownFunc(1)').error).toContain('#ERR');
  });
});

describe('Rollup Engine', () => {
  it('computes numeric and count aggregations across related rows', () => {
    const taskSchema: PropertySchema[] = [
      { id: 't_title', name: '任务', type: 'title' },
      { id: 't_hours', name: '工时', type: 'number' },
    ];
    const taskRows: Page[] = [
      { ...sampleRow, id: 't1', title: 'T1', properties: { t_hours: 4 } },
      { ...sampleRow, id: 't2', title: 'T2', properties: { t_hours: 8 } },
      { ...sampleRow, id: 't3', title: 'T3', properties: { t_hours: 10 } },
    ];
    const projSchema: PropertySchema[] = [
      { id: 'p_rel', name: '任务列表', type: 'relation', relation_database_id: 'db-tasks' },
      {
        id: 'p_sum',
        name: '总工时',
        type: 'rollup',
        rollup_relation_id: 'p_rel',
        rollup_target_prop_id: 't_hours',
        rollup_aggregation: 'sum',
      },
      {
        id: 'p_med',
        name: '中位数',
        type: 'rollup',
        rollup_relation_id: 'p_rel',
        rollup_target_prop_id: 't_hours',
        rollup_aggregation: 'median',
      },
    ];
    const projRow: Page = {
      ...sampleRow,
      id: 'p1',
      properties: { p_rel: ['t1', 't2', 't3'] },
    };
    const dbs = { 'db-tasks': { schema: taskSchema, rows: taskRows } };

    expect(computeRollup(projRow, projSchema[1], projSchema, dbs).raw).toBe(22);
    expect(computeRollup(projRow, projSchema[2], projSchema, dbs).raw).toBe(8);
  });
});
