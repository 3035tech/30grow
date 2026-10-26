'use client';
import { useId, useState } from 'react';
import { t } from '../../lib/i18n';
import { EMPLOYEE_CSV_MAX_BYTES } from '../../lib/employee-csv';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { cn } from '../../lib/cn';
import { StatusToneChip } from './StatusToneChip';
import { InlineCallout } from './InlineCallout';

const TEMPLATE = 'nome_completo,email_corporativo,data_admissao,email_pessoal\r\n';
export function EmployeeCsvTemplateLink({ locale }) {
  return <a className={S.btnGhost} href={`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + TEMPLATE)}`} download="colaboradores.csv">{t(locale, 'employeeCsv.template')}</a>;
}

export function EmployeeCsvImport({ companyId, locale, onClose, onImported }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const titleId = useId();
  const helpId = useId();
  const [rows, setRows] = useState([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [sent, setSent] = useState([]);
  const { confirm } = useAppFeedback();
  const copy = key => t(locale, `employeeCsv.${key}`);
  const review = async (commit = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (commit && !await confirm({ title: copy('title'), message: `${copy('confirm')} (${rows.filter(row => !row.errors.length).length})\n\n${copy('intro')}`, preferCancel: true, confirmLabel: copy('confirm') })) return;
      const response = await fetch('/api/admin/employees/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, locale, csv, confirm: commit }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorCode?.startsWith('CSV_') ? copy(data.errorCode) : data.error || t(locale, 'panel.common.error'));
      setRows(data.rows || []); setDone(commit);
      if (commit) { setCsv(''); onImported?.(); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (busy || !selected.length) return;
    setBusy(true); setError('');
    try {
      const targets = rows.filter(row => selected.includes(row.candidateId) && !sent.includes(row.candidateId));
      if (!targets.length) return;
      const response = await fetch('/api/admin/employees/invite-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, locale, fullName: targets[0].fullName, email: targets[0].email }) });
      const preview = await response.json();
      if (!response.ok) throw new Error(preview.error || t(locale, 'panel.common.error'));
      if (!await confirm({ title: t(locale, 'employeeInvite.preview'), message: `${copy('confirmInvites')}\n\n${targets.map(row => row.email).join('\n')}\n\n${preview.subject}\n\n${preview.text}`, preferCancel: true, confirmLabel: copy('sendSelected') })) return;
      for (const row of targets) {
        const response = await fetch(`/api/admin/candidates/${row.candidateId}/employee-access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, locale }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
        setSent(current => [...current, row.candidateId]);
        setSelected(current => current.filter(id => id !== row.candidateId));
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const validCount = rows.filter(row => !row.errors.length).length;
  const errorCount = rows.length - validCount;
  const createdCount = rows.filter(row => row.candidateId).length;
  const working = busy || reading;
  const stage = done ? 2 : rows.length ? 1 : 0;
  const chooseFile = async event => {
    const file = event.target.files?.[0];
    setRows([]); setError(''); setCsv(''); setFileName(file?.name || '');
    if (!file) return;
    if (file.size > EMPLOYEE_CSV_MAX_BYTES) { setError(copy('CSV_TOO_LARGE')); return; }
    setReading(true);
    try { setCsv(await file.text()); }
    catch { setError(copy('CSV_INVALID')); }
    finally { setReading(false); }
  };

  return (
    <section className={S.card} aria-labelledby={titleId} aria-busy={working}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className={cn(S.sectionTitle, 'm-0')}>{copy(done ? 'result' : 'title')}</h2>
          <p className={cn(S.muted, 'mb-0 mt-2 max-w-[68ch]')}>{copy(done ? 'noInvites' : 'prepareHelp')}</p>
        </div>
        <button type="button" className={cn(S.btnGhost, 'shrink-0')} disabled={working} onClick={onClose}>{copy('close')}</button>
      </header>

      <ol className="my-5 flex list-none flex-wrap gap-x-6 gap-y-2 border-b border-line p-0 pb-4 text-sm" aria-label={copy('title')}>
        {['prepare', 'check', 'finish'].map((key, index) => (
          <li key={key} aria-current={stage === index ? 'step' : undefined} className={cn('flex items-center gap-2', stage === index ? 'font-semibold text-ink' : 'text-ink-muted')}>
            <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-xs', stage === index ? 'border-action bg-action text-action-ink' : 'border-line')}>{index + 1}</span>
            {copy(key)}
          </li>
        ))}
      </ol>

      {!done ? (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="m-0 text-sm font-medium text-ink">{copy('requiredFields')}</p>
            <p className={cn(S.muted, 'mb-3 mt-1 text-sm')}>{copy('optionalField')}</p>
            <EmployeeCsvTemplateLink locale={locale} />
          </div>
          <div className="min-w-0 rounded-control border border-dashed border-ink/20 bg-canvas/60 p-4">
            <label className={cn(S.btnGhost, 'relative inline-flex cursor-pointer focus-within:ring-2 focus-within:ring-brand-500/40', working && 'pointer-events-none opacity-50')}>
              {copy('choose')}
              <input className="sr-only" type="file" accept=".csv,text/csv" aria-describedby={helpId} disabled={working} onChange={chooseFile} />
            </label>
            <p className="mb-1 mt-3 break-words text-sm text-ink" aria-live="polite">{fileName || copy('emptyFile')}</p>
            <p id={helpId} className={cn(S.faint, 'm-0 text-sm')}>{copy('fileHelp')}</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-4"><InlineCallout tone="danger" role="alert">{error}</InlineCallout></div> : null}
      {rows.length ? (
        <>
          <div className="mb-3 mt-5 flex flex-wrap gap-2" role="status">
            <StatusToneChip tone="success">{t(locale, `employeeCsv.${done ? 'createdCount' : 'validCount'}`, { count: done ? createdCount : validCount })}</StatusToneChip>
            {errorCount ? <StatusToneChip tone="warning">{t(locale, 'employeeCsv.errorCount', { count: errorCount })}</StatusToneChip> : null}
          </div>
          {errorCount && !done ? <p className={cn(S.muted, 'mb-4 max-w-[75ch] text-sm')}>{copy('fixHelp')}</p> : null}
          <div className="overflow-x-auto rounded-control border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{copy(done ? 'result' : 'check')}</caption>
              <thead className="border-b border-line bg-canvas/80 text-ink-muted">
                <tr>{['#', copy('name'), copy('email'), copy('date'), copy('status')].map(label => <th scope="col" key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(row => (
                  <tr key={row.row} className={row.errors.length ? 'bg-warning/[0.04]' : undefined}>
                    <th scope="row" className="px-3 py-3 align-top font-normal text-ink-muted">{row.row}</th>
                    <td className="min-w-[140px] px-3 py-3 align-top font-medium text-ink">{row.fullName}</td>
                    <td className="min-w-[180px] break-all px-3 py-3 align-top text-ink-muted">{row.email}</td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-ink-muted">{row.startDate}</td>
                    <td className="min-w-[220px] px-3 py-3 align-top">
                      {row.errors.length ? <><StatusToneChip tone="warning">{copy('errors')}</StatusToneChip><ul className="mb-0 mt-2 list-disc space-y-1 pl-4 text-sm text-ink-muted">{row.errors.map(code => <li key={code}>{copy(code)}</li>)}</ul></> : row.candidateId ? (
                        <div className="flex flex-col items-start gap-2">
                          <StatusToneChip tone="success">{copy('created')}</StatusToneChip>
                          {sent.includes(row.candidateId) ? <span className="text-sm text-ink-muted">{t(locale, 'employeeInvite.pending')}</span> : (
                            <label className="flex min-h-touch cursor-pointer items-center gap-2 text-sm text-ink">
                              <input type="checkbox" disabled={working} checked={selected.includes(row.candidateId)} aria-label={`${copy('select')}: ${row.fullName}`} onChange={event => setSelected(current => event.target.checked ? [...current, row.candidateId] : current.filter(id => id !== row.candidateId))} />
                              {copy('select')}
                            </label>
                          )}
                        </div>
                      ) : <StatusToneChip tone="success">{copy('ready')}</StatusToneChip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className={cn(S.faint, 'm-0 max-w-[60ch] text-sm')} role={working ? 'status' : undefined}>{working ? copy('loading') : copy('noAutomaticInvites')}</p>
        <div className="flex flex-wrap gap-2">
          {!done ? <button type="button" className={rows.length ? S.btnGhost : S.btnPrimary} disabled={working || !csv} onClick={() => review()}>{copy('preview')}</button> : null}
          {!done && validCount > 0 ? <button type="button" className={S.btnPrimary} disabled={working} onClick={() => review(true)}>{copy('confirm')} ({validCount})</button> : null}
          {done && selected.length > 0 ? <button type="button" className={S.btnPrimary} disabled={working} onClick={send}>{copy('sendSelected')} ({selected.length})</button> : null}
        </div>
      </footer>
    </section>
  );
}
