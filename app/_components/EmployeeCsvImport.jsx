'use client';

import { useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';

const key = name => `panel.team.csvImport.${name}`;
const template = '\uFEFFnome_completo,email_corporativo,data_admissao,email_pessoal\r\n';

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([template], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'colaboradores-modelo.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function EmployeeCsvImport({ open, onClose, companyId, locale, onImported }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const request = async (mode, content) => {
    const response = await fetch('/api/admin/employees/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: Number(companyId), mode, csv: content, locale }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  const chooseFile = async event => {
    const file = event.target.files?.[0];
    const id = ++requestId.current;
    setPreview(null); setResult(null); setError(''); setCsv('');
    if (!file) return;
    if (file.size > 64 * 1024) { setError(t(locale, key('CSV_SIZE'))); return; }
    setBusy(true);
    try {
      const content = await file.text();
      if (id !== requestId.current) return;
      const { data } = await request('preview', content);
      if (id !== requestId.current) return;
      if (!data.ok) { setError(t(locale, key(data.error || 'failed'))); return; }
      setCsv(content);
      setPreview(data.preview);
    } catch {
      if (id === requestId.current) setError(t(locale, key('failed')));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!csv || !preview?.canImport || busy) return;
    setBusy(true); setError('');
    try {
      const { response, data } = await request('import', csv);
      if (!response.ok || !data.ok) {
        if (data.preview) setPreview(data.preview);
        setError(t(locale, key(data.retryPreview ? 'changed' : data.preview ? 'recheck' : data.error || 'failed')));
        return;
      }
      setResult(data);
      setCsv('');
      onImported?.();
    } catch {
      setError(t(locale, key('failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminRichFormDrawer
      open={open}
      title={t(locale, key('title'))}
      locale={locale}
      maxWidth="880px"
      onClose={onClose}
      busy={busy}
      protectChanges={false}
      footer={<>
        <button type="button" className={S.btnGhost} onClick={onClose} disabled={busy}>{t(locale, key(result ? 'done' : 'cancel'))}</button>
        {!result ? <button type="button" className={S.btnPrimary} onClick={confirmImport} disabled={busy || !preview?.canImport}>
          {busy ? t(locale, key('working')) : t(locale, key('confirm'))}
        </button> : null}
      </>}
    >
      <p className="mt-0 text-sm text-ink-muted">{t(locale, key('hint'))}</p>
      <button type="button" className={S.btnGhost} onClick={downloadTemplate}>{t(locale, key('template'))}</button>
      <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="employee-csv-file">{t(locale, key('file'))}</label>
      <input id="employee-csv-file" type="file" accept=".csv,text/csv" onChange={chooseFile} disabled={busy || Boolean(result)} className="mt-2 block w-full text-sm" />
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {result ? <p role="status" className="mt-5 text-sm text-success">{t(locale, key('success'), { n: result.total })}</p> : null}
      {preview ? <div className="mt-5" aria-live="polite">
        <p className="text-sm font-semibold">{t(locale, key('summary'), { n: preview.total, errors: preview.invalid })}</p>
        {preview.capacity.exceeded ? <p role="alert" className="text-sm text-danger">{t(locale, key('capacity'), { active: preview.capacity.active, limit: preview.capacity.limit })}</p> : null}
        <div className="max-h-80 overflow-auto rounded-control border border-ink/10">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-surface"><tr>
              <th className="p-2">{t(locale, key('line'))}</th><th className="p-2">{t(locale, key('name'))}</th>
              <th className="p-2">{t(locale, key('corporate'))}</th><th className="p-2">{t(locale, key('date'))}</th>
              <th className="p-2">{t(locale, key('personal'))}</th><th className="p-2">{t(locale, key('issues'))}</th>
            </tr></thead>
            <tbody>{preview.rows.map(row => <tr key={row.line} className="border-t border-ink/10 align-top">
              <td className="p-2 tabular-nums">{row.line}</td><td className="p-2">{row.fullName}</td>
              <td className="p-2 break-all">{row.email}</td><td className="p-2">{row.startDate}</td>
              <td className="p-2 break-all">{row.personalEmail || '—'}</td>
              <td className="p-2 text-danger">{row.errors.length ? row.errors.map(code => t(locale, key(code))).join('; ') : t(locale, key('ready'))}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div> : null}
    </AdminRichFormDrawer>
  );
}
