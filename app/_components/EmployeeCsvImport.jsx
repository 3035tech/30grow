'use client';
import { useState } from 'react';
import { t } from '../../lib/i18n';
import { EMPLOYEE_CSV_MAX_BYTES } from '../../lib/employee-csv';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { InlineCallout } from './InlineCallout';

const TEMPLATE = 'nome_completo,email_corporativo,data_admissao,email_pessoal\r\n';
export function EmployeeCsvImport({ companyId, locale, onClose, onImported }) {
  const [csv, setCsv] = useState('');
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
  return <section className={S.card} aria-label={copy('title')}>
    <div className="flex items-center justify-between gap-3"><h2 className={S.sectionTitle}>{copy(done ? 'result' : 'title')}</h2><button type="button" className={S.btnGhost} disabled={busy} onClick={onClose}>{copy('close')}</button></div>
    <p className={S.muted}>{copy(done ? 'noInvites' : 'intro')}</p>
    {!done ? <div className="flex flex-wrap items-center gap-3">
      <a className={S.btnGhost} href={`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + TEMPLATE)}`} download="colaboradores.csv">{copy('template')}</a>
      <label>{copy('choose')}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; setRows([]); setError(''); setCsv('');
        if (!file) return;
        if (file.size > EMPLOYEE_CSV_MAX_BYTES) { setError(copy('CSV_TOO_LARGE')); return; }
        try { setCsv(await file.text()); } catch { setError(copy('CSV_INVALID')); }
      }} /></label>
      <button type="button" className={S.btnGhost} disabled={busy || !csv} onClick={() => review()}>{copy('preview')}</button>
    </div> : null}
    {error ? <InlineCallout tone="danger" role="alert">{error}</InlineCallout> : null}
    {rows.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['#', copy('name'), copy('email'), copy('date'), copy('status')].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.row}><td className="p-2">{row.row}</td><td className="p-2">{row.fullName}</td><td className="p-2 break-all">{row.email}</td><td className="p-2">{row.startDate}</td><td className="p-2">{row.errors.length ? row.errors.map(copy).join(' ') : row.candidateId ? <>{copy('created')}{sent.includes(row.candidateId) ? <p>{t(locale, 'employeeInvite.pending')}</p> : <label className="ml-2"><input type="checkbox" disabled={busy} checked={selected.includes(row.candidateId)} onChange={event => setSelected(current => event.target.checked ? [...current, row.candidateId] : current.filter(id => id !== row.candidateId))} /> {copy('select')}</label>}</> : copy('ready')}</td></tr>)}</tbody></table></div> : null}
    {!done && rows.some(row => !row.errors.length) ? <button type="button" className={S.btnPrimary} disabled={busy} onClick={() => review(true)}>{copy('confirm')}</button> : null}
    {done && selected.length ? <button type="button" className={S.btnPrimary} disabled={busy} onClick={send}>{copy('sendSelected')} ({selected.length})</button> : null}
    {busy ? <p role="status">{copy('loading')}</p> : null}
  </section>;
}
