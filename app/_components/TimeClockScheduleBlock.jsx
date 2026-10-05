'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { COMPANY_WORKDAYS, WEEKDAYS } from '../../lib/domain-status.js';
import { localIsoToday } from '../../lib/time-clock-format.js';
import { S, AdminDeleteButton } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { CollapsibleBlock } from './CollapsibleBlock';
import { useAppFeedback } from './AppFeedback';
import { StatusToneChip } from './StatusToneChip';

const KS = 'panel.timeClockSchedule';
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
/** 2023-01-01 was a Sunday: index 0–6 maps to Sunday–Saturday. */
const SUNDAY_ANCHOR = Date.UTC(2023, 0, 1, 12);

export function weekdayShort(i, locale) {
  const d = new Date(SUNDAY_ANCHOR + i * 86400000);
  const w = d.toLocaleDateString(localeHtmlLang(locale), { weekday: 'short', timeZone: 'UTC' }).replace(/\.$/, '');
  return `${w.charAt(0).toLocaleUpperCase()}${w.slice(1)}`;
}

function dateLabel(iso, locale) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(localeHtmlLang(locale), { timeZone: 'UTC' });
}

function scheduleText(s, locale) {
  const parts = [`${s.workdayStart}–${s.workdayEnd}`];
  if (s.breakStart && s.breakEnd) parts.push(t(locale, `${KS}.breakRange`, { start: s.breakStart, end: s.breakEnd }));
  else if (s.breakMinutes) parts.push(t(locale, `${KS}.breakMinutes`, { n: s.breakMinutes }));
  parts.push((s.weekdays || COMPANY_WORKDAYS).map((d) => weekdayShort(d, locale)).join(', '));
  return parts.join(' · ');
}

function currentVersion(items, today) {
  return (items || []).find((r) => r.validFrom <= today) || null;
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

/**
 * Ponto › espelho: effective-dated work schedule of one employee. Without a version the
 * company schedule applies; a version can also return to it from a date.
 */
export function TimeClockScheduleBlock({ locale = 'pt-BR', companyId, candidateId, onChanged }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/time-clock/people/${candidateId}/schedule`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await requestJson(`${base}?${new URLSearchParams({ companyId: String(companyId) })}`));
    } catch (e) {
      toast(e?.message || t(locale, `${KS}.loadError`), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [base, companyId, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = localIsoToday();
  const company = data?.companySchedule || null;
  const current = currentVersion(data?.items, today);
  const effective = current && !current.followsCompany ? current : company;
  const ownSchedule = Boolean(current && !current.followsCompany);

  const afterSave = async (msgKey) => {
    toast(t(locale, msgKey), 'ok');
    await load();
    onChanged?.();
  };

  const edit = async () => {
    const seed = effective || {};
    const hmField = (key, row, required) => ({
      key,
      row,
      type: 'text',
      label: t(locale, `${KS}.${key}`),
      placeholder: 'HH:MM',
      defaultValue: seed[key] || '',
      showWhen: (v) => !v.followsCompany,
      validate: (v, all) => {
        if (all.followsCompany) return null;
        const s = String(v || '').trim();
        if (!s) return required ? t(locale, `${KS}.timeRequired`) : null;
        return HM_RE.test(s) ? null : t(locale, `${KS}.timeInvalid`);
      },
    });
    await promptForm({
      title: t(locale, `${KS}.editTitle`),
      message: t(locale, `${KS}.editMessage`),
      confirmLabel: t(locale, `${KS}.save`),
      fields: [
        { key: 'validFrom', type: 'date', label: t(locale, `${KS}.validFrom`), required: true, defaultValue: today },
        {
          key: 'followsCompany',
          type: 'boolean',
          label: t(locale, `${KS}.followsCompany`),
          help: company ? t(locale, `${KS}.followsCompanyHelp`, { schedule: scheduleText(company, locale) }) : undefined,
          defaultValue: false,
        },
        hmField('workdayStart', 'wd', true),
        hmField('workdayEnd', 'wd', true),
        hmField('breakStart', 'br', false),
        hmField('breakEnd', 'br', false),
        {
          key: 'weekdays',
          type: 'checkboxGroup',
          label: t(locale, `${KS}.weekdays`),
          defaultValue: (seed.weekdays || COMPANY_WORKDAYS).map(String),
          options: WEEKDAYS.map((d) => ({ value: String(d), label: weekdayShort(d, locale) })),
          showWhen: (v) => !v.followsCompany,
          validate: (v, all) => (all.followsCompany || (Array.isArray(v) && v.length) ? null : t(locale, `${KS}.weekdaysRequired`)),
        },
      ],
      submit: async (values) => {
        const follows = Boolean(values.followsCompany);
        await requestJson(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            validFrom: values.validFrom,
            followsCompany: follows,
            ...(follows
              ? {}
              : {
                  workdayStart: String(values.workdayStart || '').trim(),
                  workdayEnd: String(values.workdayEnd || '').trim(),
                  breakStart: String(values.breakStart || '').trim() || null,
                  breakEnd: String(values.breakEnd || '').trim() || null,
                  weekdays: (values.weekdays || []).map(Number),
                }),
          }),
        });
        await afterSave(`${KS}.saved`);
      },
    });
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: t(locale, `${KS}.deleteTitle`),
      message: t(locale, `${KS}.deleteMessage`, { date: dateLabel(row.validFrom, locale) }),
      confirmLabel: t(locale, `${KS}.deleteConfirm`),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await requestJson(`${base}?${new URLSearchParams({ companyId: String(companyId), id: String(row.id) })}`, { method: 'DELETE' });
      await afterSave(`${KS}.deleted`);
    } catch (e) {
      toast(e?.message || t(locale, `${KS}.saveError`), 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];

  return (
    <CollapsibleBlock
      locale={locale}
      title={t(locale, `${KS}.title`)}
      count={items.length || null}
      variant="card"
    >
      {loading && !data ? (
        <AppLoading variant="panel" />
      ) : !data ? (
        <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KS}.loadError`)}</p>
      ) : (
        <ContentEnter animKey={`schedule|${candidateId}|${items.length}|${current?.id || 0}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusToneChip tone={ownSchedule ? 'info' : 'neutral'}>
                  {t(locale, ownSchedule ? `${KS}.sourceEmployee` : `${KS}.sourceCompany`)}
                </StatusToneChip>
                {effective ? <span className="font-mono text-sm tabular-nums text-ink">{scheduleText(effective, locale)}</span> : null}
              </div>
              <p className={cn(S.muted, 'm-0 mt-1 max-w-[62ch] text-prose')}>{t(locale, `${KS}.intro`)}</p>
            </div>
            <button
              type="button"
              className={cn(S.btnBrandSoft, 'min-h-touch shrink-0 text-sm')}
              disabled={busy}
              onClick={() => void edit()}
            >
              {t(locale, `${KS}.editBtn`)}
            </button>
          </div>

          {items.length ? (
            <div className="mt-4">
              <p className={cn(S.label, 'mb-2')}>{t(locale, `${KS}.historyTitle`)}</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {items.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-2 rounded-control border border-ink/10 px-3 py-2"
                  >
                    <span className="font-ui text-sm text-ink">
                      {t(locale, `${KS}.fromDate`, { date: dateLabel(row.validFrom, locale) })}
                    </span>
                    <span className={cn(S.faint, 'font-mono tabular-nums')}>
                      {row.followsCompany ? t(locale, `${KS}.followsCompanyShort`) : scheduleText(row, locale)}
                    </span>
                    {row.id === current?.id ? (
                      <StatusToneChip tone="success">{t(locale, `${KS}.current`)}</StatusToneChip>
                    ) : row.validFrom > today ? (
                      <StatusToneChip tone="info">{t(locale, `${KS}.upcoming`)}</StatusToneChip>
                    ) : null}
                    <div className="ml-auto">
                      <AdminDeleteButton
                        label={t(locale, `${KS}.deleteAria`, { date: dateLabel(row.validFrom, locale) })}
                        disabled={busy}
                        onClick={() => void remove(row)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
