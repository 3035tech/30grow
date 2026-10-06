'use client';

import { SelectField } from '../../_components/SelectField';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { AdminCreateButton, AdminPageHeader, PanelSubNav, S } from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { CopyableLink } from '../../_components/CopyableLink';
import { DisclosureToggle } from '../../_components/CollapsibleBlock';
import { climateMeanLevel, buildClimateTrendChart, climateSurveyAnchorDate } from '../../../lib/people/climate-viz';
import { C } from '../../../lib/theme';
import { CLIMATE_QUESTION_KIND, CLIMATE_SURVEY_STATUS } from '../../../lib/domain-status.js';
import { MeterBar } from '../../_components/MeterBar';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { RichTextView } from '../../_components/RichTextView';
import { SegmentedControl } from '../../_components/SegmentedControl';
import { InlineCallout } from '../../_components/InlineCallout';

function dateLocale(locale) {
  return localeHtmlLang(locale);
}

function formatClimateDate(raw, locale) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(locale), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatClimateSurveyWhen(survey, locale) {
  if (!survey) return '';
  const open = formatClimateDate(survey.opensAt || climateSurveyAnchorDate(survey), locale);
  const close = formatClimateDate(survey.closesAt, locale);
  if (open && close && survey.closesAt) {
    return t(locale, 'panel.climate.dateRange', { from: open, to: close });
  }
  if (open) return t(locale, 'panel.climate.dateOpened', { d: open });
  return '';
}

const CLIMATE_DETAIL_SECTIONS = Object.freeze(['overview', 'distribution', 'questionnaire']);

function normalizeClimateDetailSection(value, status) {
  if (CLIMATE_DETAIL_SECTIONS.includes(value)) return value;
  return status === CLIMATE_SURVEY_STATUS.DRAFT ? 'questionnaire' : 'overview';
}

const TONE_BAR = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-ink-muted',
};

const TONE_BG = {
  success: 'bg-success/10 border-success/25',
  warning: 'bg-warning/10 border-warning/25',
  danger: 'bg-danger/10 border-danger/25',
  info: 'bg-ink/[0.04] border-ink/12',
};

const TONE_STROKE = {
  success: C.success,
  warning: C.warning,
  danger: C.danger,
  info: C.info,
};

function climateSurveyStatusTone(status) {
  if (status === CLIMATE_SURVEY_STATUS.OPEN) return 'success';
  if (status === CLIMATE_SURVEY_STATUS.CLOSED) return 'info';
  if (status === CLIMATE_SURVEY_STATUS.ARCHIVED) return 'neutral';
  return 'neutral';
}

function ClimateStatusChip({ status, locale }) {
  const key = [
    CLIMATE_SURVEY_STATUS.DRAFT,
    CLIMATE_SURVEY_STATUS.OPEN,
    CLIMATE_SURVEY_STATUS.CLOSED,
    CLIMATE_SURVEY_STATUS.ARCHIVED,
  ].includes(status)
    ? status
    : CLIMATE_SURVEY_STATUS.DRAFT;
  return (
    <StatusToneChip tone={climateSurveyStatusTone(key)}>
      {t(locale, `panel.climate.status.${key}`)}
    </StatusToneChip>
  );
}

/** Satisfaction meter — score + semantic bar (1–5 default). */
function ClimateMeanMeter({
  mean,
  scaleMin = 1,
  scaleMax = 5,
  locale,
  size = 'md',
  showLabel = true,
}) {
  const level = climateMeanLevel(mean, scaleMin, scaleMax);
  if (mean == null || !level) return null;
  const barClass = TONE_BAR[level.tone] || TONE_BAR.info;
  const textClass = TONE_TEXT[level.tone] || TONE_TEXT.info;
  const compact = size === 'sm';
  return (
    <div className={cn('w-full', compact ? 'mt-1' : 'mt-2')}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        {showLabel ? (
          <span className={cn('font-mono text-2xs', textClass)}>
            {t(locale, `panel.climate.level.${level.level}`)}
          </span>
        ) : (
          <span />
        )}
        <span className="font-mono text-2xs text-ink-faint">
          {t(locale, 'panel.climate.scaleRange', { min: scaleMin, max: scaleMax })}
        </span>
      </div>
      <MeterBar
        percent={level.pct}
        height={compact ? 8 : 10}
        className="rounded-full"
        trackClassName="bg-ink/10"
        toneClass={cn('rounded-full', barClass)}
        aria-label={t(locale, `panel.climate.level.${level.level}`)}
      />
    </div>
  );
}

function ClimateTrendChart({ surveys, locale }) {
  const chart = buildClimateTrendChart(surveys, { width: 480, height: 140 });
  if (!chart) {
    return (
      <p className={cn(S.faint, 'm-0 text-sm')}>{t(locale, 'panel.climate.trendNeedMore')}</p>
    );
  }
  const { points, path, areaPath, w, h, pad, guides, scaleMin, scaleMax } = chart;
  const last = points[points.length - 1];
  const first = points[0];
  const delta = last && first ? Math.round((last.mean - first.mean) * 10) / 10 : null;

  return (
    <div className="rounded-control border border-ink/10 bg-canvas/50 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-ui text-sm text-ink">{t(locale, 'panel.climate.trendTitle')}</span>
        {delta != null ? (
          <span
            className={cn(
              'font-mono text-sm',
              delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-ink-muted'
            )}
          >
            {t(locale, 'panel.climate.trendDelta', {
              n: delta > 0 ? `+${delta}` : String(delta),
            })}
          </span>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full max-h-40"
        role="img"
        aria-label={t(locale, 'panel.climate.trendAria')}
      >
        {guides.map((g) => (
          <g key={g.value}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={g.y}
              y2={g.y}
              stroke="currentColor"
              className="text-ink/10"
              strokeWidth="1"
            />
            <text
              x={pad.left - 6}
              y={g.y + 3}
              textAnchor="end"
              className="fill-ink-faint"
              style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            >
              {g.value}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="currentColor" className="text-brand-500/10" />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-brand-600"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) => (
          <g key={p.surveyId}>
            <circle
              cx={p.x}
              cy={p.y}
              r="5"
              fill={TONE_STROKE[p.tone] || TONE_STROKE.info}
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              x={p.x}
              y={h - 6}
              textAnchor="middle"
              className="fill-ink-muted"
              style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            >
              {formatClimateDate(p.at, locale) || (p.title || '—').slice(0, 10)}
            </text>
            <title>{`${p.title}${p.at ? ` · ${formatClimateDate(p.at, locale)}` : ''}: ${p.mean}`}</title>
          </g>
        ))}
        <text
          x={pad.left - 6}
          y={pad.top + 4}
          textAnchor="end"
          className="fill-ink-faint"
          style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
        >
          {scaleMax}
        </text>
        <text
          x={pad.left - 6}
          y={pad.top + (h - pad.top - pad.bottom) + 3}
          textAnchor="end"
          className="fill-ink-faint"
          style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
        >
          {scaleMin}
        </text>
      </svg>
      <p className={cn(S.faint, 'm-0 mt-2')}>{t(locale, 'panel.climate.trendHint')}</p>
    </div>
  );
}

/** Side-by-side bars — only when 2+ campaigns have means. */
function ClimateCompareBars({ surveys, locale }) {
  const rows = [...(surveys || [])]
    .filter((s) => s?.overallMean != null)
    .reverse();
  if (rows.length < 2) return null;
  return (
    <div className="mt-3">
      <div className="mb-2 font-ui text-sm text-ink">{t(locale, 'panel.climate.compareBarsTitle')}</div>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((s) => {
          const level = climateMeanLevel(s.overallMean, 1, 5);
          const pct = level?.pct ?? 0;
          return (
            <li
              key={s.surveyId}
              className="flex flex-col gap-2 rounded-control border border-ink/10 bg-canvas/40 px-3 py-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-ui text-xs text-ink" title={s.title}>
                  {s.title}
                </span>
                <span className="shrink-0 font-display text-lg font-semibold text-ink">{s.overallMean}</span>
              </div>
              <MeterBar
                percent={Math.max(6, pct)}
                height={8}
                toneClass={cn('rounded-full', TONE_BAR[level?.tone] || TONE_BAR.info)}
                trackClassName="bg-ink/10"
                className="rounded-full"
              />
              <span className="font-mono text-2xs text-ink-faint">
                {formatClimateDate(climateSurveyAnchorDate(s), locale) || '—'}
                {s.deltaVsPrevious != null
                  ? ` · ${t(locale, 'panel.climate.deltaVsPrev', {
                      n: s.deltaVsPrevious > 0 ? `+${s.deltaVsPrevious}` : String(s.deltaVsPrevious),
                    })}`
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OverallScoreHero({ mean, locale, responseCount, minResponses }) {
  const level = climateMeanLevel(mean, 1, 5);
  if (mean == null || !level) return null;
  return (
    <div className={cn('rounded-card border px-4 py-4', TONE_BG[level.tone] || TONE_BG.info)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xs uppercase tracking-wider text-ink-muted">
            {t(locale, 'panel.climate.satisfactionTitle')}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold leading-none text-ink">{mean}</span>
            <span className="font-mono text-sm text-ink-faint">/ 5</span>
          </div>
          <div className={cn('mt-2 font-mono text-xs', TONE_TEXT[level.tone])}>
            {t(locale, `panel.climate.level.${level.level}`)}
          </div>
        </div>
        <div className="min-w-[140px] flex-1 text-right font-mono text-2xs text-ink-muted">
          {t(locale, 'panel.climate.rCount', { n: responseCount || 0 })}
          {minResponses ? (
            <div className="mt-0.5 text-ink-faint">
              {t(locale, 'panel.climate.minForMeans', { n: minResponses })}
            </div>
          ) : null}
        </div>
      </div>
      <ClimateMeanMeter mean={mean} locale={locale} showLabel={false} />
      <p className={cn(S.faint, 'm-0 mt-2')}>{t(locale, 'panel.climate.levelHint')}</p>
    </div>
  );
}

/**
 * Climate surveys — list first, detail second; comparison only with 2+ unlocked means.
 */
export function ClimateTab({ locale, isAdmin, companies = [], section, navigateDashboard }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [aggregate, setAggregate] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [inviteUrls, setInviteUrls] = useState([]);
  const [companyId, setCompanyId] = useState(companies[0]?.id || '');

  // Se a lista de empresas mudar (admin trocando escopo) e o companyId
  // atual não existir mais, ressincronizar com o primeiro disponível.
  useEffect(() => {
    if (!isAdmin) return;
    const ids = new Set((companies || []).map((c) => String(c?.id)));
    if (companyId && !ids.has(String(companyId))) {
      setCompanyId(companies[0]?.id || '');
    }
  }, [companies, companyId, isAdmin]);
  const [minResponses, setMinResponses] = useState(5);
  const [showCompare, setShowCompare] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [detailSection, setDetailSection] = useState('overview');
  const [listFilter, setListFilter] = useState('active'); // active | archived | all

  const companyQs =
    isAdmin && companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';

  const listQs = useMemo(() => {
    const params = new URLSearchParams();
    if (isAdmin && companyId) params.set('companyId', String(companyId));
    if (listFilter === 'archived') params.set('status', CLIMATE_SURVEY_STATUS.ARCHIVED);
    if (listFilter === 'all') params.set('includeArchived', '1');
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [companyId, isAdmin, listFilter]);

  const meanBySurveyId = useMemo(() => {
    const map = new Map();
    for (const s of benchmark?.surveys || []) {
      if (s?.surveyId != null && s.overallMean != null) {
        map.set(Number(s.surveyId), s);
      }
    }
    return map;
  }, [benchmark]);

  const compareReady = useMemo(() => {
    const withMean = (benchmark?.surveys || []).filter((s) => s?.overallMean != null);
    return withMean.length >= 2;
  }, [benchmark]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bq = companyQs ? `${companyQs}&benchmark=1` : '?benchmark=1';
      const benchmarkPromise = fetch(`/api/admin/climate-surveys${bq}`)
        .then(async (br) => (br.ok ? br.json().catch(() => null) : null))
        .catch(() => null);
      const res = await fetch(`/api/admin/climate-surveys${listQs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'load');
      const next = Array.isArray(data.items) ? data.items : [];
      setItems(next);
      if (data.minResponses != null) setMinResponses(Number(data.minResponses) || 5);
      const bd = await benchmarkPromise;
      if (bd) setBenchmark(bd);
      return next;
    } catch (e) {
      toast(e?.message || t(locale, 'panel.climate.loadError'), 'error');
      setItems([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [companyQs, listQs, locale, toast]);

  const loadDetail = useCallback(
    async (id) => {
      setBusy(true);
      setInviteUrls([]);
      setAggregate(null);
      try {
        const aggregatePromise = fetch(
          `/api/admin/climate-surveys/${encodeURIComponent(id)}?aggregate=1`
        )
          .then(async (ag) => (ag.ok ? ag.json().catch(() => ({})) : null))
          .catch(() => null);
        const res = await fetch(`/api/admin/climate-surveys/${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'load');
        setSelectedId(id);
        setDetail(data.survey);
        setShowQuestions(data.survey?.status === CLIMATE_SURVEY_STATUS.DRAFT);
        const agData = await aggregatePromise;
        if (agData) setAggregate(agData);
      } catch {
        toast(t(locale, 'panel.climate.loadError'), 'error');
      } finally {
        setBusy(false);
      }
    },
    [locale, toast]
  );

  useEffect(() => {
    if (!detail) return;
    setDetailSection(normalizeClimateDetailSection(section, detail.status));
  }, [detail?.id, detail?.status, section]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await load();
      if (cancelled) return;
      setSelectedId((cur) => {
        const stillThere = cur && next.some((s) => String(s.id) === String(cur));
        if (stillThere) return cur;
        const first = next[0]?.id || null;
        if (first) {
          queueMicrotask(() => {
            if (!cancelled) loadDetail(first);
          });
        } else {
          setDetail(null);
          setAggregate(null);
        }
        return first;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [load, loadDetail]);

  const patch = async (id, body) => {
    const res = await fetch(`/api/admin/climate-surveys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'patch');
    return data;
  };

  const createSurvey = async () => {
    const fields = [
      {
        key: 'title',
        label: t(locale, 'panel.climate.titleLabel'),
        placeholder: t(locale, 'panel.climate.titlePh'),
        required: true,
      },
      {
        key: 'description',
        label: t(locale, 'panel.climate.descLabel'),
        type: 'richText',
        minHeight: 100,
        placeholder: t(locale, 'panel.climate.descPh'),
      },
    ];
    if (isAdmin && companies.length) {
      fields.unshift({
        key: 'companyId',
        type: 'select',
        label: t(locale, 'panel.climate.companyLabel'),
        options: companies.map((c) => ({ value: String(c.id), label: c.name || c.id })),
        defaultValue: String(companyId || companies[0]?.id || ''),
        required: true,
      });
    }
    const values = await promptForm({
      title: t(locale, 'panel.climate.createTitle'),
      confirmLabel: t(locale, 'panel.climate.createConfirm'),
      fields,
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/climate-surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          companyId: values.companyId || companyId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'create');
      toast(t(locale, 'panel.climate.created'), 'ok');
      if (values.companyId) setCompanyId(values.companyId);
      await load();
      if (data.survey?.id) await loadDetail(data.survey.id);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, { status });
      setDetail(data.survey);
      toast(t(locale, 'panel.climate.statusUpdated'), 'ok');
      await load();
      if (status === CLIMATE_SURVEY_STATUS.OPEN) {
        try {
          const inv = await patch(selectedId, { createInvite: true });
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          if (inv?.invite?.token) {
            setInviteUrls([`${origin}/clima/${inv.invite.token}`]);
            toast(t(locale, 'panel.climate.inviteOk'), 'ok');
          }
        } catch {
          /* open succeeded; invite is optional follow-up */
        }
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const createInvite = async () => {
    if (!selectedId) return;
    if (detail?.status !== CLIMATE_SURVEY_STATUS.OPEN) {
      toast(t(locale, 'panel.climate.needOpen'), 'info');
      return;
    }
    setBusy(true);
    try {
      const data = await patch(selectedId, { createInvite: true });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setInviteUrls([`${origin}/clima/${data.invite.token}`]);
      toast(t(locale, 'panel.climate.inviteOk'), 'ok');
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const createInviteBatch = async () => {
    if (!selectedId || detail?.status !== CLIMATE_SURVEY_STATUS.OPEN) {
      toast(t(locale, 'panel.climate.needOpen'), 'info');
      return;
    }
    const values = await promptForm({
      title: t(locale, 'panel.climate.batchTitle'),
      confirmLabel: t(locale, 'panel.climate.batchConfirm'),
      fields: [
        {
          key: 'count',
          label: t(locale, 'panel.climate.batchCount'),
          placeholder: '10',
          defaultValue: '5',
          required: true,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, {
        createInviteBatch: true,
        count: Number(values.count) || 5,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setInviteUrls((data.invites || []).map((i) => `${origin}/clima/${i.token}`));
      toast(t(locale, 'panel.climate.batchOk', { n: data.invites?.length || 0 }), 'ok');
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const emailInvites = async () => {
    if (!selectedId || detail?.status !== CLIMATE_SURVEY_STATUS.OPEN) {
      toast(t(locale, 'panel.climate.needOpen'), 'info');
      return;
    }
    const values = await promptForm({
      title: t(locale, 'panel.climate.emailTitle'),
      confirmLabel: t(locale, 'panel.climate.emailConfirm'),
      fields: [
        {
          key: 'emails',
          label: t(locale, 'panel.climate.emailList'),
          placeholder: t(locale, 'panel.climate.emailPh'),
          required: true,
        },
      ],
    });
    if (!values) return;
    const emails = String(values.emails || '')
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      const data = await patch(selectedId, {
        emailInvites: true,
        emails,
        locale,
        appOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      toast(t(locale, 'panel.climate.emailOk', { n: data.sent || 0 }), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addQuestion = async () => {
    if (!selectedId) return;
    const values = await promptForm({
      title: t(locale, 'panel.climate.addQuestionTitle'),
      message: t(locale, 'panel.climate.addQuestionHint'),
      confirmLabel: t(locale, 'panel.climate.addQuestionConfirm'),
      fields: [
        {
          key: 'kind',
          type: 'select',
          label: t(locale, 'panel.climate.questionKindLabel'),
          defaultValue: CLIMATE_QUESTION_KIND.LIKERT,
          help: t(locale, 'panel.climate.questionKindHelp'),
          options: [
            { value: CLIMATE_QUESTION_KIND.LIKERT, label: t(locale, 'panel.climate.questionKind.likert') },
            { value: CLIMATE_QUESTION_KIND.ENPS, label: t(locale, 'panel.climate.questionKind.enps') },
            { value: CLIMATE_QUESTION_KIND.TEXT, label: t(locale, 'panel.climate.questionKind.text') },
          ],
        },
        {
          key: 'prompt',
          label: t(locale, 'panel.climate.questionLabel'),
          placeholder: t(locale, 'panel.climate.questionPh'),
          required: true,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, {
        addQuestion: { prompt: values.prompt, questionKind: values.kind || CLIMATE_QUESTION_KIND.LIKERT },
      });
      setDetail(data.survey);
      setShowQuestions(true);
      toast(t(locale, 'panel.climate.questionSaved'), 'ok');
      await load();
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const editQuestion = async (q) => {
    if (!selectedId) return;
    const values = await promptForm({
      title: t(locale, 'panel.climate.editQuestionTitle'),
      confirmLabel: t(locale, 'panel.climate.saveQuestion'),
      fields: [
        {
          key: 'prompt',
          label: t(locale, 'panel.climate.questionLabel'),
          defaultValue: q.prompt,
          required: true,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, {
        updateQuestion: { id: q.id, prompt: values.prompt },
      });
      setDetail(data.survey);
      toast(t(locale, 'panel.climate.questionSaved'), 'ok');
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const deactivateQuestion = async (q) => {
    if (!selectedId) return;
    const ok = await confirm({
      message: t(locale, 'panel.climate.deactivateQuestionConfirm'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, {
        updateQuestion: { id: q.id, active: false },
      });
      setDetail(data.survey);
      toast(t(locale, 'panel.climate.questionSaved'), 'ok');
      await load();
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeSurvey = async () => {
    if (!selectedId) return;
    const ok = await confirm({
      message: t(locale, 'panel.climate.deleteConfirm'),
      danger: true,
      confirmLabel: t(locale, 'panel.climate.deleteBtn'),
    });
    if (!ok) return;
    const archivedId = selectedId;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/climate-surveys/${encodeURIComponent(archivedId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'delete');
      }
      toast(t(locale, 'panel.climate.deleted'), 'ok');
      setListFilter('archived');
      await loadDetail(archivedId);
    } catch {
      toast(t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const versionSurvey = async () => {
    if (!selectedId) return;
    const ok = await confirm({
      message: t(locale, 'panel.climate.versionConfirm'),
      confirmLabel: t(locale, 'panel.climate.versionConfirmBtn'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await patch(selectedId, { version: true });
      toast(t(locale, 'panel.climate.versionOk'), 'ok');
      setListFilter('active');
      if (data.survey?.id) await loadDetail(data.survey.id);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.climate.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const questionsEditable = detail?.questionsEditable === true
    || detail?.status === CLIMATE_SURVEY_STATUS.DRAFT;
  const canVersion = detail
    && (detail.status === CLIMATE_SURVEY_STATUS.OPEN
      || detail.status === CLIMATE_SURVEY_STATUS.CLOSED
      || detail.status === CLIMATE_SURVEY_STATUS.ARCHIVED);

  const min = aggregate?.minResponses || minResponses || 5;
  const resp = aggregate?.responseCount ?? detail?.responseCount ?? 0;
  const unlockPct = Math.min(100, Math.round((resp / min) * 100));

  return (
    <div className={S.stack}>
      <AdminPageHeader
        title={t(locale, 'panel.climate.pageTitle')}
        subtitle={t(locale, 'panel.climate.pageHint')}
        actions={
          <AdminCreateButton
            label={t(locale, 'panel.climate.createBtn')}
            onClick={createSurvey}
            disabled={busy}
          />
        }
      />

      {isAdmin && companies.length > 0 ? (
        <label className={cn(S.label, 'mb-0 flex max-w-xs flex-col gap-1')}>
          {t(locale, 'panel.climate.companyLabel')}
          <SelectField
            className={S.select}
            value={String(companyId || '')}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setSelectedId(null);
              setDetail(null);
              setAggregate(null);
              setShowCompare(false);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </SelectField>
        </label>
      ) : null}

      <div className="mb-3">
        <SegmentedControl
          aria-label={t(locale, 'panel.climate.listFilterAria')}
          size="sm"
          value={listFilter}
          onChange={setListFilter}
          options={[
            { id: 'active', label: t(locale, 'panel.climate.listFilter.active') },
            { id: 'archived', label: t(locale, 'panel.climate.listFilter.archived') },
            { id: 'all', label: t(locale, 'panel.climate.listFilter.all') },
          ]}
        />
      </div>

      {loading ? (
        <AppLoading variant="panel" />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            listFilter === 'archived'
              ? t(locale, 'panel.climate.emptyArchivedTitle')
              : listFilter === 'all'
                ? t(locale, 'panel.climate.emptyAllTitle')
                : t(locale, 'panel.climate.emptyTitle')
          }
          message={
            listFilter === 'archived'
              ? t(locale, 'panel.climate.emptyArchivedHint')
              : listFilter === 'all'
                ? t(locale, 'panel.climate.emptyAllHint')
                : t(locale, 'panel.climate.emptyHint')
          }
          actionLabel={listFilter === 'archived' ? undefined : t(locale, 'panel.climate.createBtn')}
          onAction={listFilter === 'archived' ? undefined : createSurvey}
          actionDisabled={busy}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
            <div>
              <div className="mb-2 font-mono text-2xs uppercase tracking-wider text-ink-faint">
                {t(locale, 'panel.climate.listHeading', { n: items.length })}
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((s) => {
                  const listResp = Number(s.responseCount) || 0;
                  const listMin = minResponses || 5;
                  const listPct = Math.min(100, Math.round((listResp / listMin) * 100));
                  const bm = meanBySurveyId.get(Number(s.id));
                  const selected = selectedId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => loadDetail(s.id)}
                        className={cn(
                          'w-full cursor-pointer rounded-card border px-3.5 py-3 text-left transition-colors',
                          selected
                            ? 'border-brand-500/45 bg-brand-500/[0.07] shadow-sm'
                            : 'border-ink/12 bg-surface hover:border-ink/25'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 font-ui text-sm font-medium text-ink">{s.title}</div>
                          <ClimateStatusChip status={s.status} locale={locale} />
                        </div>
                        <div className={cn(S.faint, 'mt-1.5')}>
                          {t(locale, 'panel.climate.qCount', { n: s.questionCount || 0 })}
                          {' · '}
                          {t(locale, 'panel.climate.rCount', { n: listResp })}
                        </div>
                        {formatClimateSurveyWhen(s, locale) ? (
                          <div className="mt-0.5 font-mono text-2xs text-ink-faint">
                            {formatClimateSurveyWhen(s, locale)}
                          </div>
                        ) : null}
                        {bm?.overallMean != null ? (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="font-display text-lg font-semibold text-ink">{bm.overallMean}</span>
                            <div className="min-w-0 flex-1">
                              <ClimateMeanMeter
                                mean={bm.overallMean}
                                locale={locale}
                                size="sm"
                                showLabel={false}
                              />
                            </div>
                          </div>
                        ) : s.status === CLIMATE_SURVEY_STATUS.OPEN || s.status === CLIMATE_SURVEY_STATUS.CLOSED ? (
                          <div className="mt-2">
                            <div className="mb-0.5 font-mono text-2xs text-ink-faint">
                              {t(locale, 'panel.climate.responseProgress', { n: listResp, min: listMin })}
                            </div>
                            <MeterBar
                              percent={listPct}
                              height={6}
                              className="rounded-full"
                              trackClassName="bg-ink/10"
                              toneClass={cn(
                                'rounded-full',
                                listResp >= listMin ? 'bg-success' : 'bg-info'
                              )}
                              aria-label={t(locale, 'panel.climate.responseProgress', {
                                n: listResp,
                                min: listMin,
                              })}
                            />
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className={cn(S.card, 'min-h-[280px] p-5 sm:p-6')}>
              {!detail ? (
                <div className="flex min-h-[200px] flex-col items-center justify-center px-4 text-center">
                  <p className={cn(S.muted, 'm-0 max-w-sm text-sm')}>{t(locale, 'panel.climate.pickHint')}</p>
                </div>
              ) : (
                <ContentEnter animKey={String(selectedId || detail.id)} className="flex flex-col gap-5">
                  <header className="border-b border-ink/10 pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <ClimateStatusChip status={detail.status} locale={locale} />
                          {detail.sourceSurveyId ? (
                            <span className="font-mono text-2xs text-ink-faint">
                              {t(locale, 'panel.climate.versionOf', { id: detail.sourceSurveyId })}
                            </span>
                          ) : null}
                          {formatClimateSurveyWhen(detail, locale) ? (
                            <span className="font-mono text-2xs text-ink-faint">
                              {formatClimateSurveyWhen(detail, locale)}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="m-0 font-ui text-2xl font-semibold leading-tight text-ink">{detail.title}</h3>
                        {detail.description ? (
                          <RichTextView
                            html={detail.description}
                            className={cn(S.muted, 'mt-2 text-sm')}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {detailSection === 'questionnaire' && detail.status === CLIMATE_SURVEY_STATUS.DRAFT ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnPrimary}
                          onClick={() => setStatus(CLIMATE_SURVEY_STATUS.OPEN)}
                        >
                          {t(locale, 'panel.climate.openBtn')}
                        </button>
                      ) : null}
                      {detailSection === 'overview' && detail.status === CLIMATE_SURVEY_STATUS.ARCHIVED ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnPrimary}
                          onClick={versionSurvey}
                        >
                          {t(locale, 'panel.climate.versionBtn')}
                        </button>
                      ) : null}
                      {detailSection === 'distribution' && detail.status === CLIMATE_SURVEY_STATUS.OPEN ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnPrimary}
                          onClick={createInvite}
                        >
                          {t(locale, 'panel.climate.inviteBtn')}
                        </button>
                      ) : null}
                      {detailSection === 'overview' && detail.status === CLIMATE_SURVEY_STATUS.OPEN ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnGhost}
                          onClick={() => setStatus(CLIMATE_SURVEY_STATUS.CLOSED)}
                        >
                          {t(locale, 'panel.climate.closeBtn')}
                        </button>
                      ) : null}
                      {detailSection === 'distribution' && detail.status === CLIMATE_SURVEY_STATUS.OPEN ? (
                        <>
                          <button type="button" disabled={busy} className={S.btnGhost} onClick={createInviteBatch}>
                            {t(locale, 'panel.climate.batchBtn')}
                          </button>
                          <button type="button" disabled={busy} className={S.btnGhost} onClick={emailInvites}>
                            {t(locale, 'panel.climate.emailBtn')}
                          </button>
                        </>
                      ) : null}
                      {detailSection === 'questionnaire' && questionsEditable ? (
                        <AdminCreateButton variant="secondary" label={t(locale, 'panel.climate.addQuestionBtn')} onClick={addQuestion} disabled={busy} />
                      ) : null}
                      {detailSection === 'overview' && canVersion && detail.status !== CLIMATE_SURVEY_STATUS.ARCHIVED ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={!questionsEditable ? S.btnBrandSoft : S.btnGhost}
                          onClick={versionSurvey}
                        >
                          {t(locale, 'panel.climate.versionBtn')}
                        </button>
                      ) : null}
                      {detailSection === 'overview' && detail.status !== CLIMATE_SURVEY_STATUS.ARCHIVED ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={cn(S.btnGhost, 'text-danger')}
                          onClick={removeSurvey}
                        >
                          {t(locale, 'panel.climate.deleteBtn')}
                        </button>
                      ) : null}
                    </div>
                  </header>

                  <PanelSubNav
                    ariaLabel={t(locale, 'panel.climate.detailTabsAria')}
                    active={detailSection}
                    onChange={(nextSection) => {
                      const next = normalizeClimateDetailSection(nextSection, detail.status);
                      setDetailSection(next);
                      navigateDashboard?.({ tab: 'climate', climateSection: next, scroll: false, clientOnly: true });
                    }}
                    tabs={[
                      { id: 'overview', label: t(locale, 'panel.climate.detailTabOverview') },
                      { id: 'distribution', label: t(locale, 'panel.climate.detailTabDistribution'), badge: detail.inviteStats?.pending || undefined },
                      { id: 'questionnaire', label: t(locale, 'panel.climate.detailTabQuestionnaire'), badge: detail.questions?.length || undefined },
                    ]}
                  />

                  {detail.status === CLIMATE_SURVEY_STATUS.ARCHIVED ? (
                    <InlineCallout tone="neutral">
                      {t(locale, 'panel.climate.archivedHint')}
                    </InlineCallout>
                  ) : detailSection === 'questionnaire' && !questionsEditable ? (
                    <InlineCallout tone="info">
                      {t(locale, 'panel.climate.questionsLocked')}
                    </InlineCallout>
                  ) : null}

                  {detailSection === 'distribution' && detail.inviteStats && detail.inviteStats.total > 0 ? (
                    <p className={cn(S.faint, 'm-0')}>
                      {t(locale, 'panel.climate.inviteStats', {
                        total: detail.inviteStats.total || 0,
                        used: detail.inviteStats.used || 0,
                        pending: detail.inviteStats.pending || 0,
                      })}
                    </p>
                  ) : null}

                  {detailSection === 'distribution' && detail.status === CLIMATE_SURVEY_STATUS.OPEN && inviteUrls.length === 0 ? (
                    <div className="rounded-card border border-brand-500/25 bg-brand-500/[0.06] px-4 py-3">
                      <p className={cn(S.muted, 'm-0 text-sm')}>{t(locale, 'panel.climate.invitePrimaryHint')}</p>
                    </div>
                  ) : null}

                  {detailSection === 'distribution' && inviteUrls.length > 0 ? (
                    <section>
                      <h4 className="m-0 mb-2 font-ui text-sm font-medium text-ink">
                        {t(locale, 'panel.climate.inviteLink')}
                      </h4>
                      <div className="rounded-card border border-brand-500/30 bg-brand-500/[0.06] px-3 py-3">
                        {inviteUrls.slice(0, 20).map((url) => (
                          <CopyableLink key={url} url={url} locale={locale} />
                        ))}
                        {inviteUrls.length > 20 ? (
                          <p className={cn(S.faint, 'm-0 mt-2')}>
                            {t(locale, 'panel.climate.batchMore', { n: inviteUrls.length - 20 })}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {detailSection === 'overview' && (detail.status === CLIMATE_SURVEY_STATUS.OPEN || detail.status === CLIMATE_SURVEY_STATUS.CLOSED) ? (
                    aggregate?.overallMean != null ? (
                      <OverallScoreHero
                        mean={aggregate.overallMean}
                        locale={locale}
                        responseCount={resp}
                        minResponses={min}
                      />
                    ) : (
                      <div className="rounded-card border border-ink/12 bg-canvas/50 px-4 py-4">
                        <div className="font-ui text-sm text-ink">{t(locale, 'panel.climate.waitingMeansTitle')}</div>
                        {aggregate?.suppressed ? (
                          <p className={cn(S.muted, 'm-0 mt-1 text-sm')}>
                            {t(locale, 'panel.climate.aggregateSuppressed', {
                              n: resp,
                              min,
                            })}
                          </p>
                        ) : (
                          <p className={cn(S.muted, 'm-0 mt-1 text-sm')}>
                            {t(locale, 'panel.climate.responseProgress', { n: resp, min })}
                          </p>
                        )}
                        <MeterBar
                          percent={unlockPct}
                          height={8}
                          className="mt-3 rounded-full"
                          trackClassName="bg-ink/10"
                          toneClass={cn('rounded-full', resp >= min ? 'bg-success' : 'bg-info')}
                          aria-label={t(locale, 'panel.climate.responseProgress', { n: resp, min })}
                        />
                      </div>
                    )
                  ) : null}

                  {detailSection === 'overview' && aggregate?.byQuestion?.length && !aggregate.suppressed ? (
                    <section>
                      <h4 className="m-0 mb-3 font-ui text-sm font-medium text-ink">
                        {t(locale, 'panel.climate.aggregate')}
                      </h4>
                      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                        {aggregate.byQuestion.map((row) => {
                          const scaleMax = Number(row.scaleMax) || 5;
                          const scaleMin = Number(row.scaleMin) || 1;
                          const isText =
                            String(row.questionKind || '').toLowerCase() === CLIMATE_QUESTION_KIND.TEXT ||
                            (row.mean == null && row.enpsScore == null);
                          const isEnps = String(row.questionKind || '').toLowerCase() === CLIMATE_QUESTION_KIND.ENPS;
                          return (
                            <li
                              key={row.questionId}
                              className="rounded-control border border-ink/10 bg-surface px-3.5 py-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <span className="min-w-0 flex-1 text-sm leading-snug text-ink">
                                  {row.prompt}
                                  {isEnps ? (
                                    <span className="mt-1 block font-mono text-2xs text-ink-faint">
                                      {t(locale, 'panel.climate.enpsQuestionHint')}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 font-ui text-xl tabular-nums text-ink">
                                  {isEnps
                                    ? row.enpsScore != null
                                      ? row.enpsScore
                                      : '—'
                                    : row.mean != null
                                      ? row.mean
                                      : '—'}
                                </span>
                              </div>
                              {row.mean != null ? (
                                <ClimateMeanMeter
                                  mean={row.mean}
                                  scaleMin={scaleMin}
                                  scaleMax={scaleMax}
                                  locale={locale}
                                  size="sm"
                                />
                              ) : isEnps && row.enpsScore != null ? (
                                <p className={cn(S.faint, 'm-0 mt-1.5')}>
                                  {t(locale, 'panel.climate.enpsScoreHint', { n: row.responses || 0 })}
                                </p>
                              ) : (
                                <p className={cn(S.faint, 'm-0 mt-1.5')}>
                                  {isText
                                    ? t(locale, 'panel.climate.questionKind.text')
                                    : t(locale, 'panel.climate.noResponses')}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}

                  {detailSection === 'overview' && aggregate?.textByQuestion?.length && !aggregate.suppressed ? (
                    <section>
                      <h4 className="m-0 mb-1 font-ui text-sm font-medium text-ink">
                        {t(locale, 'panel.climate.textAnswersTitle')}
                      </h4>
                      <p className={cn(S.faint, 'm-0 mb-3')}>{t(locale, 'panel.climate.textAnswersHint')}</p>
                      {aggregate.themes?.length ? (
                        <div className="mb-3 rounded-control border border-ink/10 bg-canvas/50 px-3 py-2.5">
                          <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-ink-muted">
                            {t(locale, 'panel.climate.themesTitle')}
                          </div>
                          <p className={cn(S.faint, 'm-0 mb-2')}>{t(locale, 'panel.climate.themesHint')}</p>
                          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                            {aggregate.themes.map((th) => (
                              <li key={th.key} className="text-xs leading-snug text-ink-muted">
                                <span className="font-medium text-ink">
                                  {t(locale, `panel.climate.theme.${th.key}`)}
                                </span>
                                <span className="font-mono text-ink-faint"> · {th.count}</span>
                                {th.sample ? (
                                  <span className="mt-0.5 block text-2xs italic text-ink-faint">
                                    “{th.sample}”
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {aggregate.textByQuestion.map((block) => (
                          <li key={block.questionId} className="rounded-control border border-ink/10 px-3.5 py-3">
                            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-sm text-ink">{block.prompt}</span>
                              <span className="font-mono text-2xs text-ink-faint">
                                {t(locale, 'panel.climate.textAnswersCount', { n: block.responses || 0 })}
                              </span>
                            </div>
                            {(block.answers || []).length ? (
                              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                                {block.answers.map((ans, i) => (
                                  <li
                                    key={`${block.questionId}-${i}`}
                                    className="rounded-control border border-ink/8 bg-canvas/60 px-3 py-2 text-sm leading-relaxed text-ink-muted"
                                  >
                                    {ans}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className={cn(S.muted, 'm-0 text-sm')}>{t(locale, 'panel.climate.noResponses')}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {detailSection === 'questionnaire' ? <section className="border-t border-ink/10 pt-4">
                    <button
                      type="button"
                      className={cn(S.btnGhost, 'w-full justify-between sm:w-auto')}
                      onClick={() => setShowQuestions((v) => !v)}
                      aria-expanded={showQuestions}
                    >
                      <span>
                        {t(locale, 'panel.climate.questions')}
                        <span className="ml-1.5 font-mono text-ink-faint">
                          ({(detail.questions || []).length})
                        </span>
                      </span>
                      <DisclosureToggle locale={locale} open={showQuestions} />
                    </button>
                    {showQuestions ? (
                      <ul className="mt-3 m-0 flex list-none flex-col gap-2 p-0">
                        {(detail.questions || []).map((q, idx) => (
                          <li
                            key={q.id}
                            className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-ink/10 px-3 py-2.5 text-sm"
                          >
                            <span className="min-w-0 flex-1 text-ink-muted">
                              <span className="mr-1.5 font-mono text-ink-faint">{idx + 1}.</span>
                              <span className="mr-2 inline-block rounded border border-ink/10 px-1.5 py-0.5 font-mono text-2xs text-ink-faint">
                                {t(
                                  locale,
                                  `panel.climate.questionKind.${
                                    (() => {
                                      const k = String(q.questionKind || '').toLowerCase();
                                      if (k === CLIMATE_QUESTION_KIND.TEXT) return CLIMATE_QUESTION_KIND.TEXT;
                                      if (k === CLIMATE_QUESTION_KIND.ENPS) return CLIMATE_QUESTION_KIND.ENPS;
                                      return CLIMATE_QUESTION_KIND.LIKERT;
                                    })()
                                  }`
                                )}
                              </span>
                              {q.prompt}
                            </span>
                            {questionsEditable ? (
                              <span className="flex gap-1">
                                <button
                                  type="button"
                                  className={S.btnGhost}
                                  disabled={busy}
                                  onClick={() => editQuestion(q)}
                                >
                                  {t(locale, 'panel.climate.editQuestionBtn')}
                                </button>
                                <button
                                  type="button"
                                  className={cn(S.btnGhost, 'text-danger')}
                                  disabled={busy}
                                  onClick={() => deactivateQuestion(q)}
                                >
                                  {t(locale, 'panel.climate.deactivateQuestionBtn')}
                                </button>
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section> : null}
                </ContentEnter>
              )}
            </div>
          </div>

          {compareReady ? (
            <div className={cn(S.cardTight)}>
              <button
                type="button"
                className={cn(S.btnGhost, 'w-full justify-between')}
                onClick={() => setShowCompare((v) => !v)}
                aria-expanded={showCompare}
              >
                <span className="text-left font-ui text-sm text-ink">
                  {t(locale, 'panel.climate.benchmarkTitle')}
                </span>
                <DisclosureToggle locale={locale} open={showCompare} />
              </button>
              {showCompare ? (
                <div className="mt-4">
                  <p className={cn(S.muted, 'm-0 mb-3 text-sm')}>
                    {t(locale, 'panel.climate.benchmarkHint', { n: benchmark.minResponses })}
                  </p>
                  <ClimateTrendChart surveys={benchmark.surveys} locale={locale} />
                  <ClimateCompareBars surveys={benchmark.surveys} locale={locale} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
