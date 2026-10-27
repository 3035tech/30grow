'use client';

import { t } from '../../../lib/i18n';
import { htmlToPlainText } from '../../../lib/sanitize-html';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AppLoading } from '../../_components/AppLoading';
import {
  buildVacancyDescriptionTemplate,
  isVacancyDescriptionSparse,
} from '../../../lib/recruiting/vacancy-description-template';
import { descAssistBtnClass } from './vacancy-admin-shared';

/**
 * Template estruturado + IA (criar base se vazio / melhorar se já houver texto).
 */
export function VacancyDescriptionAssistBar({
  locale,
  busy,
  title,
  descriptionHtml,
  employmentType,
  salaryMin,
  salaryMax,
  vacancyId = null,
  onApplyDescription,
  onBusyChange,
}) {
  const { toast, notice, confirm } = useAppFeedback();
  const sparse = isVacancyDescriptionSparse(descriptionHtml);
  const titleOk = Boolean(String(title || '').trim());

  const insertTemplate = async () => {
    const next = buildVacancyDescriptionTemplate(locale);
    if (!sparse && htmlToPlainText(descriptionHtml || '').trim()) {
      const ok = await confirm({
        title: t(locale, 'recruiting.descTemplateOverwriteTitle'),
        message: t(locale, 'recruiting.descTemplateOverwriteMsg'),
        confirmLabel: t(locale, 'recruiting.descTemplateInsert'),
        danger: true,
      });
      if (!ok) return;
    }
    onApplyDescription(next);
    toast(t(locale, 'recruiting.descTemplateInserted'), 'ok');
  };

  const runAi = async () => {
    if (!titleOk || busy) return;
    onBusyChange(true);
    try {
      const url = vacancyId
        ? `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/assist-ai`
        : '/api/admin/vacancies/assist-ai';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'vacancyDescription',
          title,
          employmentType: employmentType || null,
          salaryMin,
          salaryMax,
          description: descriptionHtml || '',
          mode: 'auto',
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode
            ? t(locale, `errors.${data.errorCode}`)
            : data?.error || t(locale, 'recruiting.descAiFailed')
        );
      }
      if (data.description) onApplyDescription(String(data.description));
      const doneKey =
        data.mode === 'improve' ? 'recruiting.descAiImprovedDone' : 'recruiting.descAiCreatedDone';
      toast(t(locale, doneKey), 'ok');
    } catch (e) {
      await notice({
        title: t(locale, 'panel.common.errorTitle'),
        message: e?.message || t(locale, 'recruiting.descAiFailed'),
        tone: 'error',
      });
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={insertTemplate}
          title={t(locale, 'recruiting.descTemplateHelp')}
          aria-label={t(locale, 'recruiting.descTemplateInsert')}
          className={descAssistBtnClass({ disabled: busy })}
        >
          {t(locale, 'recruiting.descTemplateInsert')}
        </button>
        <button
          type="button"
          disabled={busy || !titleOk}
          onClick={runAi}
          title={
            sparse
              ? t(locale, 'recruiting.descAiCreateHelp')
              : t(locale, 'recruiting.descAiImproveHelp')
          }
          aria-busy={busy || undefined}
          aria-label={
            busy
              ? t(locale, 'recruiting.descAiWorking')
              : sparse
                ? t(locale, 'recruiting.descAiCreate')
                : t(locale, 'recruiting.descAiImprove')
          }
          className={descAssistBtnClass({ primary: true, disabled: busy || !titleOk, busy })}
        >
          {busy ? (
            <AppLoading locale={locale} variant="button" label={t(locale, 'recruiting.descAiWorking')} />
          ) : sparse ? (
            t(locale, 'recruiting.descAiCreate')
          ) : (
            t(locale, 'recruiting.descAiImprove')
          )}
        </button>
      </div>
      {busy ? (
        <AppLoading
          locale={locale}
          variant="banner"
          label={t(locale, 'recruiting.descAiWorkingHint')}
        />
      ) : (
        <p className="mb-0 mt-1.5 text-2xs leading-[1.4] text-ink-faint">
          {t(locale, 'recruiting.descAssistHint')}
        </p>
      )}
    </div>
  );
}
