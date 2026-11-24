import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Page, PropertySchema } from '@/types';

interface CalendarViewProps {
  schema: PropertySchema[];
  rows: Page[];
  datePropId?: string;
  readonly?: boolean;
  onOpenRow: (row: Page) => void;
  onCreateRowWithDate: (propId: string, dateISO: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  schema,
  rows,
  datePropId,
  readonly,
  onOpenRow,
  onCreateRowWithDate,
}) => {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const dateProp =
    schema.find((p) => p.id === datePropId) || schema.find((p) => p.type === 'date');

  if (!dateProp) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-700 p-8 text-center text-xs text-slate-400">
        当前数据库暂无「日期」字段，请先在字段管理中添加。
      </div>
    );
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDayWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ dateStr: string; day: number; inMonth: boolean }> = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = firstDayWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevDate = new Date(year, month - 1, d);
    cells.push({ dateStr: fmtISO(prevDate), day: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: fmtISO(new Date(year, month, d)), day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const d = cells.length - (firstDayWeek + daysInMonth) + 1;
    cells.push({ dateStr: fmtISO(new Date(year, month + 1, d)), day: d, inMonth: false });
  }

  const todayStr = fmtISO(new Date());

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800">
        <div className="text-sm font-semibold">
          {year} 年 {month + 1} 月
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            className="px-2.5 py-1 rounded-lg text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            今天
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-200 dark:border-zinc-800 text-xs text-slate-400 text-center py-1.5 bg-slate-50/70 dark:bg-zinc-900/60">
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-zinc-800">
        {cells.map((c) => {
          const dayRows = rows.filter((r) => {
            const v = r.properties[dateProp.id];
            return typeof v === 'string' && v.slice(0, 10) === c.dateStr;
          });
          const isToday = c.dateStr === todayStr;

          return (
            <div
              key={c.dateStr}
              className={`min-h-24 p-1.5 group flex flex-col gap-1 ${
                c.inMonth ? '' : 'bg-slate-50/40 dark:bg-zinc-950/30 opacity-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-blue-600 text-white font-semibold' : 'text-slate-500'
                  }`}
                >
                  {c.day}
                </span>
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => onCreateRowWithDate(dateProp.id, c.dateStr)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-400"
                    title="在该日期新建记录"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {dayRows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenRow(r)}
                    className="w-full text-left px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200 text-[11px] truncate hover:bg-blue-100 dark:hover:bg-blue-900/60 transition"
                  >
                    {r.icon || '📄'} {r.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
