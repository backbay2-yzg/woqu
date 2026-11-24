import type { Page, PropertySchema } from '@/types';
import { parseFormula, type ASTNode } from './parser';

export type FormulaValue = unknown;

export interface FormulaEvalResult {
  value: FormulaValue;
  error?: string;
  formatted: string;
}

export interface FormulaContext {
  row: Page;
  schema: PropertySchema[];
  allDatabases?: Record<string, { schema: PropertySchema[]; rows: Page[] }>;
  resolveRollup?: (prop: PropertySchema) => unknown;
  visiting?: Set<string>;
}

class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function toBool(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatISODate(v);
  if (Array.isArray(v)) return v.map(toStr).join(', ');
  return String(v);
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const str = toStr(v).trim();
  if (!str) return new Date(NaN);
  // Handle YYYY-MM-DD cleanly in local time without UTC day shift
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoDateOnly) {
    return new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]));
  }
  return new Date(str);
}

function formatISODate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDatePattern(d: Date, pattern: string): string {
  if (Number.isNaN(d.getTime())) return '';
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const mShort = String(d.getMonth() + 1);
  const day = String(d.getDate()).padStart(2, '0');
  const dayShort = String(d.getDate());
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return pattern
    .replace(/YYYY/g, y)
    .replace(/MM/g, m)
    .replace(/M/g, mShort)
    .replace(/DD/g, day)
    .replace(/D/g, dayShort)
    .replace(/HH/g, hh)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss);
}

function isEmptyVal(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function formatFormulaValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return formatISODate(v);
  if (Array.isArray(v)) return v.map(formatFormulaValue).join(', ');
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#DIV/0!';
    return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  }
  return String(v);
}

function resolvePropValue(propKey: string, ctx: FormulaContext): unknown {
  const prop = ctx.schema.find((p) => p.name === propKey || p.id === propKey);
  if (!prop) {
    if (propKey === 'title' || propKey === '名称') return ctx.row.title;
    if (propKey === 'created_at') return ctx.row.created_at;
    if (propKey === 'updated_at') return ctx.row.updated_at;
    return undefined;
  }

  if (prop.type === 'title') {
    return (ctx.row.properties[prop.id] as string) || ctx.row.title;
  }
  if (prop.type === 'created_time') return ctx.row.created_at;
  if (prop.type === 'updated_time') return ctx.row.updated_at;

  if (prop.type === 'rollup' && ctx.resolveRollup) {
    return ctx.resolveRollup(prop);
  }

  if (prop.type === 'formula') {
    const visiting = ctx.visiting ?? new Set<string>();
    if (visiting.has(prop.id)) {
      throw new FormulaError('#CYCLE!');
    }
    visiting.add(prop.id);
    try {
      const res = evaluateFormula(prop.formula_expression || '', { ...ctx, visiting });
      if (res.error) throw new FormulaError(res.error);
      return res.value;
    } finally {
      visiting.delete(prop.id);
    }
  }

  return ctx.row.properties[prop.id];
}

function evalNode(node: ASTNode, ctx: FormulaContext): FormulaValue {
  switch (node.kind) {
    case 'Literal':
      return node.value;

    case 'Ident': {
      if (node.name === 'pi' || node.name === 'PI') return Math.PI;
      if (node.name === 'e' || node.name === 'E') return Math.E;
      return resolvePropValue(node.name, ctx);
    }

    case 'Unary': {
      const val = evalNode(node.arg, ctx);
      if (node.op === '!') return !toBool(val);
      if (node.op === '-') return -toNum(val);
      if (node.op === '+') return +toNum(val);
      return val;
    }

    case 'Binary': {
      if (node.op === '&&') {
        const l = evalNode(node.left, ctx);
        return toBool(l) ? toBool(evalNode(node.right, ctx)) : false;
      }
      if (node.op === '||') {
        const l = evalNode(node.left, ctx);
        return toBool(l) ? true : toBool(evalNode(node.right, ctx));
      }

      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);

      switch (node.op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') {
            return toStr(l) + toStr(r);
          }
          return toNum(l) + toNum(r);
        case '-':
          return toNum(l) - toNum(r);
        case '*':
          return toNum(l) * toNum(r);
        case '/': {
          const denom = toNum(r);
          if (denom === 0) throw new FormulaError('#DIV/0!');
          return toNum(l) / denom;
        }
        case '%': {
          const denom = toNum(r);
          if (denom === 0) throw new FormulaError('#DIV/0!');
          return toNum(l) % denom;
        }
        case '==':
          return l === r || toStr(l) === toStr(r);
        case '!=':
          return l !== r && toStr(l) !== toStr(r);
        case '>':
          return typeof l === 'string' && typeof r === 'string' ? l > r : toNum(l) > toNum(r);
        case '>=':
          return typeof l === 'string' && typeof r === 'string' ? l >= r : toNum(l) >= toNum(r);
        case '<':
          return typeof l === 'string' && typeof r === 'string' ? l < r : toNum(l) < toNum(r);
        case '<=':
          return typeof l === 'string' && typeof r === 'string' ? l <= r : toNum(l) <= toNum(r);
      }
      return null;
    }

    case 'Ternary': {
      const c = evalNode(node.cond, ctx);
      return toBool(c) ? evalNode(node.thenBranch, ctx) : evalNode(node.elseBranch, ctx);
    }

    case 'Call':
      return evalCall(node.callee, node.args, ctx);
  }
}

function evalCall(name: string, args: ASTNode[], ctx: FormulaContext): FormulaValue {
  const fn = name.trim();

  // Short-circuiting functions
  if (fn === 'if') {
    const cond = args[0] ? toBool(evalNode(args[0], ctx)) : false;
    return cond ? (args[1] ? evalNode(args[1], ctx) : true) : args[2] ? evalNode(args[2], ctx) : false;
  }
  if (fn === 'ifs') {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (toBool(evalNode(args[i], ctx))) {
        return evalNode(args[i + 1], ctx);
      }
    }
    if (args.length % 2 === 1) {
      return evalNode(args[args.length - 1], ctx);
    }
    return '';
  }
  if (fn === 'and') {
    return args.every((a) => toBool(evalNode(a, ctx)));
  }
  if (fn === 'or') {
    return args.some((a) => toBool(evalNode(a, ctx)));
  }

  const vals = args.map((a) => evalNode(a, ctx));

  switch (fn) {
    case 'prop':
      return resolvePropValue(toStr(vals[0]), ctx);
    case 'not':
      return !toBool(vals[0]);
    case 'empty':
      return isEmptyVal(vals[0]);
    case 'coalesce':
      for (const v of vals) {
        if (!isEmptyVal(v)) return v;
      }
      return '';

    // String functions
    case 'concat':
      return vals.map(toStr).join('');
    case 'join': {
      const sep = toStr(vals[0]);
      if (Array.isArray(vals[1])) return vals[1].map(toStr).join(sep);
      return vals.slice(1).map(toStr).join(sep);
    }
    case 'contains':
      if (Array.isArray(vals[0])) return vals[0].map(toStr).includes(toStr(vals[1]));
      return toStr(vals[0]).includes(toStr(vals[1]));
    case 'length':
      if (Array.isArray(vals[0])) return vals[0].length;
      return toStr(vals[0]).length;
    case 'slice':
    case 'substring': {
      const s = toStr(vals[0]);
      const start = toNum(vals[1]);
      const end = vals.length > 2 ? toNum(vals[2]) : undefined;
      return Array.isArray(vals[0]) ? vals[0].slice(start, end) : s.slice(start, end);
    }
    case 'lower':
      return toStr(vals[0]).toLowerCase();
    case 'upper':
      return toStr(vals[0]).toUpperCase();
    case 'trim':
      return toStr(vals[0]).trim();
    case 'replace':
      return toStr(vals[0]).replace(new RegExp(toStr(vals[1])), toStr(vals[2]));
    case 'replaceAll':
      return toStr(vals[0]).split(toStr(vals[1])).join(toStr(vals[2]));
    case 'split':
      return toStr(vals[0]).split(toStr(vals[1]));
    case 'test':
      return new RegExp(toStr(vals[1])).test(toStr(vals[0]));
    case 'format':
      return formatFormulaValue(vals[0]);

    // Number functions
    case 'round': {
      const n = toNum(vals[0]);
      const digits = vals.length > 1 ? toNum(vals[1]) : 0;
      const factor = Math.pow(10, digits);
      return Math.round(n * factor) / factor;
    }
    case 'floor':
      return Math.floor(toNum(vals[0]));
    case 'ceil':
      return Math.ceil(toNum(vals[0]));
    case 'abs':
      return Math.abs(toNum(vals[0]));
    case 'sqrt':
      return Math.sqrt(toNum(vals[0]));
    case 'pow':
      return Math.pow(toNum(vals[0]), toNum(vals[1]));
    case 'mod': {
      const d = toNum(vals[1]);
      if (d === 0) throw new FormulaError('#DIV/0!');
      return toNum(vals[0]) % d;
    }
    case 'min': {
      const nums = flattenValues(vals).map(toNum);
      return nums.length ? Math.min(...nums) : 0;
    }
    case 'max': {
      const nums = flattenValues(vals).map(toNum);
      return nums.length ? Math.max(...nums) : 0;
    }
    case 'sum': {
      const nums = flattenValues(vals).map(toNum);
      return nums.reduce((a, b) => a + b, 0);
    }
    case 'avg': {
      const nums = flattenValues(vals).map(toNum);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    case 'toNumber':
      return toNum(vals[0]);

    // Date functions
    case 'now':
      return new Date();
    case 'today': {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    case 'parseDate':
      return toDate(vals[0]);
    case 'timestamp': {
      const d = toDate(vals[0]);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    }
    case 'year':
      return toDate(vals[0]).getFullYear();
    case 'month':
      return toDate(vals[0]).getMonth() + 1;
    case 'date':
      return toDate(vals[0]).getDate();
    case 'day':
      return toDate(vals[0]).getDay();
    case 'formatDate': {
      const d = toDate(vals[0]);
      const pat = toStr(vals[1]) || 'YYYY-MM-DD';
      return formatDatePattern(d, pat);
    }
    case 'dateAdd':
      return shiftDate(toDate(vals[0]), toNum(vals[1]), toStr(vals[2]));
    case 'dateSubtract':
      return shiftDate(toDate(vals[0]), -toNum(vals[1]), toStr(vals[2]));
    case 'dateBetween': {
      const d1 = toDate(vals[0]);
      const d2 = toDate(vals[1]);
      if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
      const unit = toStr(vals[2]) || 'days';
      const diffMs = d1.getTime() - d2.getTime();
      switch (unit) {
        case 'years':
          return d1.getFullYear() - d2.getFullYear();
        case 'months':
          return (d1.getFullYear() - d2.getFullYear()) * 12 + (d1.getMonth() - d2.getMonth());
        case 'weeks':
          return Math.trunc(diffMs / (7 * 86400 * 1000));
        case 'hours':
          return Math.trunc(diffMs / (3600 * 1000));
        case 'minutes':
          return Math.trunc(diffMs / (60 * 1000));
        case 'seconds':
          return Math.trunc(diffMs / 1000);
        default:
          return Math.trunc(diffMs / 86400000);
      }
    }

    // List functions
    case 'count':
      return Array.isArray(vals[0]) ? vals[0].length : isEmptyVal(vals[0]) ? 0 : 1;
    case 'unique': {
      const arr = Array.isArray(vals[0]) ? vals[0] : [vals[0]];
      return Array.from(new Set(arr));
    }
    case 'flat':
      return flattenValues(vals);
    case 'first':
      return Array.isArray(vals[0]) ? vals[0][0] : vals[0];
    case 'last':
      return Array.isArray(vals[0]) ? vals[0][vals[0].length - 1] : vals[0];
    case 'includes':
      return Array.isArray(vals[0]) ? vals[0].includes(vals[1]) : toStr(vals[0]).includes(toStr(vals[1]));

    default:
      throw new FormulaError(`#ERR: 未知函数 ${fn}`);
  }
}

function flattenValues(vals: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) out.push(...flattenValues(v));
    else if (v !== undefined && v !== null && v !== '') out.push(v);
  }
  return out;
}

function shiftDate(base: Date, amount: number, unit: string): Date {
  const d = new Date(base.getTime());
  if (Number.isNaN(d.getTime())) return d;
  switch (unit) {
    case 'years':
      d.setFullYear(d.getFullYear() + amount);
      break;
    case 'months':
      d.setMonth(d.getMonth() + amount);
      break;
    case 'weeks':
      d.setDate(d.getDate() + amount * 7);
      break;
    case 'hours':
      d.setHours(d.getHours() + amount);
      break;
    case 'minutes':
      d.setMinutes(d.getMinutes() + amount);
      break;
    default:
      d.setDate(d.getDate() + amount);
  }
  return d;
}

export function evaluateFormula(expression: string, ctx: FormulaContext): FormulaEvalResult {
  if (!expression || !expression.trim()) {
    return { value: '', formatted: '' };
  }
  try {
    const ast = parseFormula(expression);
    const val = evalNode(ast, ctx);
    return {
      value: val,
      formatted: formatFormulaValue(val),
    };
  } catch (err) {
    if (err instanceof FormulaError) {
      return { value: err.code, error: err.code, formatted: err.code };
    }
    const msg = err instanceof Error ? `#ERR: ${err.message}` : '#ERR';
    return { value: msg, error: msg, formatted: msg };
  }
}

export const FORMULA_FUNCTION_DOCS = [
  { name: 'prop("字段名")', desc: '读取当前行指定字段的值' },
  { name: 'if(条件, 真值, 假值)', desc: '条件分支判断' },
  { name: 'ifs(条件1, 值1, 条件2, 值2, ...)', desc: '多条件顺序判断' },
  { name: 'empty(值) / coalesce(a, b)', desc: '判空或取首个非空值' },
  { name: 'concat(a, b, ...) / join(分隔符, 列表)', desc: '字符串拼接' },
  { name: 'contains(文本, 子串) / replace(文本, 正则, 替换)', desc: '文本匹配与替换' },
  { name: 'round(数字, 位数) / sum(...) / avg(...)', desc: '数学与统计函数' },
  { name: 'today() / now() / dateBetween(日期1, 日期2, "days")', desc: '日期差与当前时间' },
  { name: 'dateAdd(日期, 数量, "days") / formatDate(日期, "YYYY-MM-DD")', desc: '日期加减与格式化' },
];
