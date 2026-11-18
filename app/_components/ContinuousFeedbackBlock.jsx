'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { EmptyState } from './EmptyState';
import { FormField } from './FormField';
import { EntitySearchSelect } from './EntitySearchSelect';
import { CopyableLink } from './CopyableLink';
import { StatusToneChip } from './StatusToneChip';
import { useAppFeedback } from './AppFeedback';
import { CollapsibleBlock } from './CollapsibleBlock';
import { FEEDBACK_REQUEST_STATUS } from '../../lib/domain-status';

/**
 * B-3010 manager surface: list + request feedback about this person.
 */
export function ContinuousFeedbackBlock({
  locale = 'pt-BR',
  companyId,
  candidateId,
  subjectName = '',
}) {
  const { toast, promptForm } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !candidateId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        subjectCandidateId: String(candidateId),
      });
      const res = await fetch(`/api/admin/feedback?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.feedback.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, candidateId, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const createRequest = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.feedback.requestTitle'),
      fields: [
        {
          key: 'toCandidateId',
          label: t(locale, 'panel.feedback.toLabel'),
          type: 'entitySearch',
          searchUrl: `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`,
          required: true,
        },
        {
          key: 'prompt',
          label: t(locale, 'panel.feedback.promptLabel'),
          type: 'textarea',
          maxLength: 500,
          placeholder: t(locale, 'panel.feedback.promptPh'),
        },
      ],
    });
    if (!values?.toCandidateId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          fromCandidateId: Number(candidateId),
          toCandidateId: Number(values.toCandidateId),
          subjectCandidateId: Number(candidateId),
          prompt: values.prompt || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'create');
      toast(t(locale, 'panel.feedback.created'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.feedback.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!companyId || !candidateId) return null;

  const answered = items.filter((i) => i.status === FEEDBACK_REQUEST_STATUS.ANSWERED);
  const pending = items.filter((i) => i.status === FEEDBACK_REQUEST_STATUS.PENDING);
  const sortedItems = [...pending, ...items.filter((i) => i.status !== FEEDBACK_REQUEST_STATUS.PENDING)];

  return (
    <CollapsibleBlock
      locale={locale}
      title={t(locale, 'panel.feedback.title')}
      count={!loading ? items.length || null : null}
      defaultOpen={pending.length > 0}
      variant="card"
      collapsedHint={
        pending.length
          ? t(locale, 'panel.feedback.pendingHint', { n: pending.length })
          : answered.length
            ? t(locale, 'panel.feedback.answeredHint', { n: answered.length })
            : t(locale, 'panel.feedback.hint')
      }
    >
      {loading ? (
        <AppLoading variant="panel" />
      ) : (
        <ContentEnter animKey={`fb|${candidateId}|${items.length}`}>
          <p className={cn(S.muted, 'mb-3 text-xs')}>
            {t(locale, 'panel.feedback.hintNamed', {
              name: subjectName || t(locale, 'panel.common.notApplicable'),
            })}
          </p>
          <button
            type="button"
            className={cn(S.btnBrandSoft, 'mb-3 min-h-touch')}
            disabled={busy}
            onClick={() => void createRequest()}
          >
            {busy ? t(locale, 'panel.feedback.submitting') : t(locale, 'panel.feedback.requestCta')}
          </button>
          {sortedItems.length === 0 ? (
            <EmptyState title={t(locale, 'panel.feedback.empty')} />
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {sortedItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-control border border-ink/12 bg-canvas px-3 py-2.5"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusToneChip
                      tone={
                        item.status === FEEDBACK_REQUEST_STATUS.ANSWERED
                          ? 'success'
                          : item.status === FEEDBACK_REQUEST_STATUS.PENDING
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(locale, `panel.feedback.status.${item.status}`)}
                    </StatusToneChip>
                    <span className={cn(S.faint)}>
                      {t(locale, 'panel.feedback.toMeta', {
                        name: item.toName || t(locale, 'panel.common.notApplicable'),
                      })}
                    </span>
                    {item.status === FEEDBACK_REQUEST_STATUS.PENDING && item.publicPath ? (
                      <CopyableLink href={item.publicPath} locale={locale} iconOnly />
                    ) : null}
                  </div>
                  {item.prompt ? (
                    <p className={cn(S.muted, 'm-0 text-prose')}>{item.prompt}</p>
                  ) : null}
                  {item.responseText ? (
                    <p className={cn(S.cardTitle, 'mb-0 mt-1.5 whitespace-pre-wrap text-prose')}>
                      {item.responseText}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}

/**
 * Employee hub: inbox to answer + ask a peer.
 */
export function EmployeeFeedbackSection({ locale = 'pt-BR', onBadge }) {
  const { toast } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState([]);
  const [aboutMe, setAboutMe] = useState([]);
  const [requestedByMe, setRequestedByMe] = useState([]);
  const [toId, setToId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const onBadgeRef = useRef(onBadge);
  onBadgeRef.current = onBadge;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/feedback');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      const inboxItems = Array.isArray(data.inbox) ? data.inbox : [];
      setInbox(inboxItems);
      setAboutMe(Array.isArray(data.aboutMe) ? data.aboutMe : []);
      setRequestedByMe(Array.isArray(data.requestedByMe) ? data.requestedByMe : []);
      onBadgeRef.current?.(inboxItems.length);
    } catch {
      setInbox([]);
      setAboutMe([]);
      setRequestedByMe([]);
      onBadgeRef.current?.(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = async () => {
    if (!toId) {
      toast(t(locale, 'panel.feedback.toRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/employee/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toCandidateId: Number(toId), prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'create');
      toast(t(locale, 'panel.feedback.created'), 'ok');
      setToId('');
      setPrompt('');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.feedback.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const answer = async (id) => {
    const text = String(answerDrafts[id] || '').trim();
    if (text.length < 5) {
      toast(t(locale, 'panel.feedback.responseShort'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/employee/feedback/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseText: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'answer');
      toast(t(locale, 'panel.feedback.answered'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.feedback.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AppLoading variant="panel" />;

  return (
    <ContentEnter animKey={`empfb|${inbox.length}|${aboutMe.length}`}>
      <div className="space-y-4">
        <div>
          <h3 className={cn(S.cardSection, 'mb-2')}>{t(locale, 'employeeHome.feedbackInbox')}</h3>
          {inbox.length === 0 ? (
            <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, 'employeeHome.feedbackInboxEmpty')}</p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {inbox.map((item) => (
                <li
                  key={item.id}
                  className="rounded-control border border-warning/25 bg-warning/[0.04] px-3 py-2.5"
                >
                  <p className={cn(S.cardTitle, 'm-0')}>
                    {t(locale, 'employeeHome.feedbackAbout', {
                      name: item.subjectName || t(locale, 'panel.common.notApplicable'),
                    })}
                  </p>
                  {item.prompt ? (
                    <p className={cn(S.muted, 'mt-1 text-prose')}>{item.prompt}</p>
                  ) : null}
                  <FormField label={t(locale, 'panel.feedback.responseLabel')} className="mt-2">
                    <textarea
                      className={cn(S.input, 'min-h-[80px]')}
                      maxLength={1000}
                      value={answerDrafts[item.id] || ''}
                      onChange={(e) =>
                        setAnswerDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                  </FormField>
                  <button
                    type="button"
                    className={cn(S.btnPrimary, 'mt-2 min-h-touch')}
                    disabled={busy}
                    onClick={() => void answer(item.id)}
                  >
                    {t(locale, 'panel.feedback.answerCta')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CollapsibleBlock
          locale={locale}
          title={t(locale, 'employeeHome.feedbackAsk')}
          defaultOpen={false}
          variant="card"
          collapsedHint={t(locale, 'panel.feedback.askHint')}
        >
          <FormField label={t(locale, 'panel.feedback.toLabel')}>
            <EntitySearchSelect
              value={toId}
              onChange={(id) => setToId(id ? String(id) : '')}
              searchUrl="/api/employee/colleagues"
              locale={locale}
              placeholder={t(locale, 'panel.feedback.toSearch')}
              aria-label={t(locale, 'panel.feedback.toLabel')}
            />
          </FormField>
          <FormField label={t(locale, 'panel.feedback.promptLabel')} className="mt-2">
            <textarea
              className={cn(S.input, 'min-h-[64px]')}
              maxLength={500}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t(locale, 'panel.feedback.promptPh')}
            />
          </FormField>
          <button
            type="button"
            className={cn(S.btnBrandSoft, 'mt-2 min-h-touch')}
            disabled={busy}
            onClick={() => void ask()}
          >
            {t(locale, 'panel.feedback.requestCta')}
          </button>
        </CollapsibleBlock>

        <CollapsibleBlock
          locale={locale}
          title={t(locale, 'employeeHome.feedbackRequestedHistory')}
          count={requestedByMe.length || null}
          defaultOpen={false}
          variant="card"
        >
          {requestedByMe.length === 0 ? (
            <p className={cn(S.muted, 'm-0 text-prose')}>
              {t(locale, 'employeeHome.feedbackRequestedHistoryEmpty')}
            </p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {requestedByMe.map((item) => (
                <li
                  key={item.id}
                  className="rounded-control border border-ink/12 bg-canvas px-3 py-2.5"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusToneChip
                      tone={
                        item.status === FEEDBACK_REQUEST_STATUS.ANSWERED
                          ? 'success'
                          : item.status === FEEDBACK_REQUEST_STATUS.PENDING
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(locale, `panel.feedback.status.${item.status}`)}
                    </StatusToneChip>
                    <span className={cn(S.faint)}>
                      {t(locale, 'employeeHome.feedbackRequestedTo', {
                        name: item.toName || t(locale, 'panel.common.notApplicable'),
                      })}
                    </span>
                    {item.createdAt ? (
                      <time className={cn(S.faint)} dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleDateString(locale)}
                      </time>
                    ) : null}
                    {item.status === FEEDBACK_REQUEST_STATUS.PENDING && item.publicPath ? (
                      <CopyableLink href={item.publicPath} locale={locale} iconOnly />
                    ) : null}
                  </div>
                  {item.prompt ? (
                    <p className={cn(S.muted, 'm-0 text-prose')}>{item.prompt}</p>
                  ) : null}
                  {item.responseText ? (
                    <p className={cn(S.cardTitle, 'mb-0 mt-1.5 whitespace-pre-wrap text-prose')}>
                      {item.responseText}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleBlock>

        {aboutMe.filter((i) => i.status === FEEDBACK_REQUEST_STATUS.ANSWERED).length > 0 ? (
          <CollapsibleBlock
            locale={locale}
            title={t(locale, 'employeeHome.feedbackReceived')}
            count={
              aboutMe.filter((i) => i.status === FEEDBACK_REQUEST_STATUS.ANSWERED).length
            }
            defaultOpen={false}
            variant="card"
          >
            <ul className="m-0 list-none space-y-2 p-0">
              {aboutMe
                .filter((i) => i.status === FEEDBACK_REQUEST_STATUS.ANSWERED)
                .map((item) => (
                  <li
                    key={item.id}
                    className="rounded-control border border-ink/12 bg-canvas px-3 py-2"
                  >
                    <p className={cn(S.faint, 'm-0')}>
                      {t(locale, 'panel.feedback.fromMeta', {
                        name: item.toName || t(locale, 'panel.common.notApplicable'),
                      })}
                    </p>
                    <p className={cn(S.muted, 'mb-0 mt-1 whitespace-pre-wrap text-prose')}>
                      {item.responseText}
                    </p>
                  </li>
                ))}
            </ul>
          </CollapsibleBlock>
        ) : null}
      </div>
    </ContentEnter>
  );
}
