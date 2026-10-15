'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { t, localeHtmlLang } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { AppLoading, ContentEnter } from './AppLoading';
import { CandidateProfileImport } from './CandidateProfileImport';
import { CopyableLink } from './CopyableLink';

/**
 * B-2706 — CV upload, suggestions, remove (Team drawer / vacancy candidate card).
 */
export function CandidateCvBlock({
  candidateId,
  locale = 'pt-BR',
  onApplied,
  embedded = false,
}) {
  const { confirm, promptForm, toast, notice } = useAppFeedback();
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cv, setCv] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [suggestions, setSuggestions] = useState({});
  const [candidateFields, setCandidateFields] = useState({});

  const load = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/cv`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setSummary(data.professionalSummary || null);
      setCv(data.cv || null);
      setSuggestions(data.suggestions || {});
      setCandidateFields(data.candidateFields || {});
    } catch (e) {
      setLoadError(true);
      setCv(null);
      setSuggestions({});
    } finally {
      setLoading(false);
    }
  }, [candidateId, locale]);

  useEffect(() => {
    load();
  }, [load]);

  const showError = async (message) => {
    await notice({
      title: t(locale, 'panel.common.errorTitle'),
      message: String(message || t(locale, 'panel.common.error')),
      tone: 'error',
    });
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/cv`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setCv(data.cv || null);
      setSuggestions(data.suggestions || {});
      toast(t(locale, 'recruiting.cvUploadOk'));
      await load();
    } catch (e) {
      await showError(e?.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeCv = async () => {
    const ok = await confirm({
      title: t(locale, 'recruiting.cvRemoveTitle'),
      message: t(locale, 'recruiting.cvRemoveConfirm'),
      confirmLabel: t(locale, 'panel.admin.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/cv`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setCv(null);
      setSuggestions({});
      toast(t(locale, 'recruiting.cvRemoveOk'));
    } catch (e) {
      await showError(e?.message);
    } finally {
      setUploading(false);
    }
  };

  const suggestionEntries = Object.entries(suggestions || {}).filter(([, v]) => v);

  const applySuggestions = async () => {
    if (!suggestionEntries.length) return;
    const fields = suggestionEntries.map(([key, value]) => ({
      name: key,
      type: 'text',
      label: t(locale, `recruiting.cvField.${key}`),
      defaultValue: value,
      required: false,
    }));
    const values = await promptForm({
      title: t(locale, 'recruiting.cvApplySuggestionsTitle'),
      message: t(locale, 'recruiting.cvApplySuggestionsHint'),
      fields,
      confirmLabel: t(locale, 'recruiting.cvApplySuggestionsConfirm'),
    });
    if (!values) return;

    const patch = {};
    for (const [key, val] of Object.entries(values)) {
      if (val != null && String(val).trim() !== '') patch[key === 'fullName' ? 'fullName' : key] = String(val).trim();
    }
    if (!Object.keys(patch).length) return;

    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.cvApplyOk'));
      onApplied?.(data);
      await load();
    } catch (e) {
      await showError(e?.message);
    }
  };

  const wrapClass = embedded
    ? 'rounded-control border border-ink/12 bg-ink/[0.02] p-3.5'
    : cn(S.cardShell, 'p-3.5');

  return (
    <div className={wrapClass}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn(S.cardSection, 'mb-0 block')}>{t(locale, 'recruiting.cvTitle')}</span>
        {loading ? <AppLoading locale={locale} variant="inline" /> : null}
      </div>
      <p className="mb-3 mt-0 text-xs leading-snug text-ink-muted">{t(locale, 'recruiting.cvAiHint')}</p>

      {loadError ? <p role="alert" className="text-sm text-danger">{t(locale, 'recruiting.cvAiReadFailed')} <button type="button" onClick={load} className={S.btnGhost}>{t(locale, 'panel.common.retry')}</button></p> : null}
      {summary ? <section className="mb-4 border-l-2 border-brand-500/40 pl-3"><h3 className="mb-2 text-sm font-semibold">{t(locale, 'recruiting.cvAiSummary')}</h3><p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">{summary}</p></section> : null}
      {!loading && !loadError ? (
        <ContentEnter>
          {cv?.hasCv ? (
            <div className="mb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {cv.cvUrl ? (
                  <CopyableLink url={cv.cvUrl} label={t(locale, 'recruiting.cvOpenPdf')} compact locale={locale} />
                ) : null}
                {cv.cvUpdatedAt ? (
                  <span className="font-mono text-2xs text-ink-faint">
                    {t(locale, 'recruiting.cvUpdatedAt', {
                      date: new Date(cv.cvUpdatedAt).toLocaleString(localeHtmlLang(locale)),
                    })}
                  </span>
                ) : null}
                {cv.textLength > 0 ? (
                  <span className="font-mono text-2xs text-ink-faint">
                    {t(locale, 'recruiting.cvTextChars', { n: cv.textLength })}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <CandidateProfileImport key={candidateId} candidateId={candidateId} locale={locale} disabled={uploading} onApplied={async data => { await load(); onApplied?.(data); }} />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className={cn(S.btnBrandSoft, 'min-h-touch')}
                >
                  {uploading ? t(locale, 'recruiting.cvUploading') : t(locale, 'recruiting.cvReplace')}
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={removeCv}
                  className={cn(S.btnGhost, 'min-h-touch text-danger')}
                >
                  {t(locale, 'recruiting.cvRemove')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-3 space-y-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className={cn(S.btnPrimary, 'min-h-touch')}
              >
                {uploading ? t(locale, 'recruiting.cvUploading') : t(locale, 'recruiting.cvUpload')}
              </button>
              <p className="m-0 text-xs text-ink-muted">{t(locale, 'recruiting.cvEmptyHint')}</p>
            </div>
          )}

          {suggestionEntries.length > 0 ? (
            <div className="rounded-control border border-info/25 bg-info/5 p-3">
              <p className="mb-2 mt-0 text-xs font-medium text-ink">{t(locale, 'recruiting.cvSuggestionsTitle')}</p>
              <ul className="mb-3 list-none space-y-1 p-0">
                {suggestionEntries.map(([key, value]) => (
                  <li key={key} className="font-mono text-2xs text-ink-muted">
                    <span className="text-ink-label">{t(locale, `recruiting.cvField.${key}`)}:</span>{' '}
                    {String(value)}
                    {candidateFields[key] && candidateFields[key] !== value ? (
                      <span className="ml-1 text-ink-faint">
                        ({t(locale, 'recruiting.cvCurrentValue')}: {candidateFields[key]})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={applySuggestions} className={cn(S.btnBrandSoft, 'min-h-touch')}>
                {t(locale, 'recruiting.cvApplySuggestions')}
              </button>
            </div>
          ) : cv?.hasCv ? (
            <p className="m-0 text-2xs text-ink-faint">{t(locale, 'recruiting.cvNoSuggestions')}</p>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => uploadFile(e.target.files?.[0])}
            aria-label={t(locale, 'recruiting.cvUploadAria')}
          />
        </ContentEnter>
      ) : null}
    </div>
  );
}
