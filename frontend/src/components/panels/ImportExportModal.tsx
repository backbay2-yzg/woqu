import React, { useState } from 'react';
import { Archive, Download, FileCode2, FileText, Printer, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({ open, onClose }) => {
  const activePage = useAppStore((s) => s.activePage);
  const loadTree = useAppStore((s) => s.loadTree);
  const openPage = useAppStore((s) => s.openPage);
  const refreshActivePage = useAppStore((s) => s.refreshActivePage);

  const [busy, setBusy] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleImportMD = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy('md');
    setStatusMsg(null);
    try {
      const res = await api.importMarkdown(files);
      await loadTree();
      if (res.page_ids?.[0]) await openPage(res.page_ids[0]);
      setStatusMsg(`成功导入 ${res.pages_created} 篇 Markdown 文档！`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(null);
    }
  };

  const handleImportNotionZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('notion');
    setStatusMsg(null);
    try {
      const res = await api.importNotionZip(file);
      await loadTree();
      if (res.page_ids?.[0]) await openPage(res.page_ids[0]);
      setStatusMsg(
        `Notion 导入完成：新增 ${res.pages_created} 个页面、${res.databases_created} 个多维数据库、${res.assets_imported} 个附件！`,
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Notion Zip 导入失败');
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('还原整库备份将覆盖当前全部页面、多维表与附件数据，确认继续吗？')) return;
    setBusy('restore');
    setStatusMsg(null);
    try {
      await api.restoreBackup(file);
      await refreshActivePage();
      setStatusMsg('整库备份已成功还原！');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : '备份还原失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Archive className="w-4 h-4 text-blue-600" />
            <span>导入导出与整库备份</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-xs">
          {/* Export current page */}
          <section className="space-y-2.5">
            <div className="font-semibold text-slate-600 dark:text-zinc-300">导出当前文档</div>
            {activePage ? (
              <div className="grid grid-cols-3 gap-2.5">
                <a
                  href={`/api/v1/pages/${activePage.id}/export/markdown`}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-200 dark:border-zinc-700 hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition"
                >
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">导出 Markdown</span>
                </a>
                <a
                  href={`/api/v1/pages/${activePage.id}/export/html`}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-200 dark:border-zinc-700 hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition"
                >
                  <FileCode2 className="w-5 h-5 text-emerald-600" />
                  <span className="font-medium">导出独立 HTML</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    window.setTimeout(() => window.print(), 150);
                  }}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-200 dark:border-zinc-700 hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition"
                >
                  <Printer className="w-5 h-5 text-purple-600" />
                  <span className="font-medium">打印 / 导出 PDF</span>
                </button>
              </div>
            ) : (
              <div className="text-slate-400">当前未打开页面</div>
            )}
          </section>

          {/* Import */}
          <section className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-zinc-800">
            <div className="font-semibold text-slate-600 dark:text-zinc-300">导入外部笔记</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="cursor-pointer flex items-center gap-2.5 p-3 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-blue-400 transition">
                <Upload className="w-4 h-4 text-blue-600 shrink-0" />
                <div>
                  <div className="font-medium">{busy === 'md' ? '导入中...' : '导入 Markdown 文件'}</div>
                  <div className="text-[11px] text-slate-400">支持多选 .md 批量导入</div>
                </div>
                <input type="file" accept=".md,.markdown,text/markdown" multiple className="hidden" onChange={handleImportMD} />
              </label>

              <label className="cursor-pointer flex items-center gap-2.5 p-3 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-purple-400 transition">
                <Archive className="w-4 h-4 text-purple-600 shrink-0" />
                <div>
                  <div className="font-medium">{busy === 'notion' ? '解析中...' : '导入 Notion Zip 包'}</div>
                  <div className="text-[11px] text-slate-400">自动还原层级/CSV库/双链</div>
                </div>
                <input type="file" accept=".zip" className="hidden" onChange={handleImportNotionZip} />
              </label>
            </div>
          </section>

          {/* Full Backup */}
          <section className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-zinc-800">
            <div className="font-semibold text-slate-600 dark:text-zinc-300">整库数据备份与迁移（SQLite + 全部附件）</div>
            <div className="flex flex-wrap gap-2.5">
              <a
                href="/api/v1/backup/download"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:opacity-90"
              >
                <Download className="w-3.5 h-3.5" />
                下载整库热备份 (.zip)
              </a>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 font-medium">
                <Upload className="w-3.5 h-3.5" />
                <span>{busy === 'restore' ? '还原中...' : '从备份压缩包还原'}</span>
                <input type="file" accept=".zip" className="hidden" onChange={handleRestoreBackup} />
              </label>
            </div>
          </section>

          {statusMsg && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200 p-3">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
