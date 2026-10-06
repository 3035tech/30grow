'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, t as i18nT, localeHtmlLang } from '../../../lib/i18n';
import {
  PAGE_SIZE_OPTIONS,
  parseVacanciesPagination,
  parseVacanciesSort,
} from '../../../lib/assessment-filters';
import {
  clientSortNextDir,
  PanelSubNav,
  S,
  AdminCreateButton,
  AdminEditButton,
  AdminActionsCell,
  AdminActionsTh,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminTh,
  AdminViewButton,
  SortableTh,
} from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { InlineCallout } from '../../_components/InlineCallout';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { MeterBar } from '../../_components/MeterBar';
import { RowActionsMenu } from '../../_components/RowActionsMenu';
import { IconActionTip } from '../../_components/IconActionTip';
import { VacancyInterviewCandidates } from '../VacancyInterviewCandidates';
import { VacancyClientReportBlock } from '../VacancyClientReportBlock';
import {
  AdminRichFormDrawer,
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
} from '../../_components/AdminRichFormDrawer';
import { salaryToCentsDigits, stripSalary } from '../../../lib/br-masks';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { employmentTypeLabelKey } from '../../../lib/vacancy-employment-type';
import { VACANCY_LIST_FILTER, VACANCY_STATUS, normalizeVacancyListFilter } from '../../../lib/domain-status.js';
import { formatWorkplaceLabel } from '../../../lib/vacancy-workplace';
import { DateField } from '../../_components/DateField';
import { publicVacancyPath } from '../../../lib/public-job-url';
import { formatPublicVacancyDate } from '../../../lib/public-vacancy-lifecycle';
import { formatVacancySalaryRange, toDatetimeLocalValue } from '../vacancies/vacancy-admin-shared';
import { VacancyFormFields } from '../vacancies/VacancyFormFields';
import { VacancyInviteByEmail } from '../vacancies/VacancyInviteByEmail';
import { VacancyInvitesBlock } from '../vacancies/VacancyInvitesBlock';
import { VacancyWhatsAppShareButton } from '../vacancies/VacancyWhatsAppShareButton';
import { VacancyRubricEditor } from '../vacancies/VacancyRubricEditor';
import { VacancyFitRankingBlock } from '../vacancies/VacancyFitRankingBlock';
import { VacancyFunnelAnalyticsBlock } from '../vacancies/VacancyFunnelAnalyticsBlock';
import { VacancyReferralBlock } from '../vacancies/VacancyReferralBlock';
import { VacancyKanbanBlock } from '../vacancies/VacancyKanbanBlock';
import { PipelineStagesEditor } from '../vacancies/PipelineStagesEditor';
import { PipelineTemplatesManager } from '../vacancies/PipelineTemplatesManager';
import { CopyableLink } from '../../_components/CopyableLink';
import { fieldInputClass } from '../../_components/form-control-styles';
import { RECRUITING_UX_EVENT } from '../../../lib/recruiting-ux-events';
import { VacancyDescriptionHtml } from '../vacancies/VacancyDescriptionHtml';
import { Icon } from '../../_components/Icon';


const VACANCY_LIST_FILTER_OPTIONS = [
  [VACANCY_LIST_FILTER.ALL, 'ui.vacanciesAdminTab.statusAll'],
  [VACANCY_LIST_FILTER.OPEN, 'ui.vacanciesAdminTab.statusOpen'],
  [VACANCY_LIST_FILTER.CLOSED, 'ui.vacanciesAdminTab.statusClosed'],
  [VACANCY_LIST_FILTER.ATTENTION, 'ui.vacanciesAdminTab.statusAttention'],
];

const FIELD = `${fieldInputClass} w-full font-mono text-prose`;
const META = S.cardMuted;
const META_FAINT = S.faint;
const VACANCY_DETAIL_SECTIONS = Object.freeze([
  'pipeline',
  'candidates',
  'information',
  'distribution',
  'settings',
]);

function VacancyMetaItem({ label, value, warning = false }) {
  return (
    <div className="min-w-0 rounded-control border border-ink/8 bg-surface/55 px-3 py-2">
      <span className="block font-ui text-prose normal-case tracking-normal text-ink/75">{label}</span>
      <span data-vacancy-meta-value className={cn('mt-1 block break-words text-prose text-ink', warning && 'text-amber-800 dark:text-warning')}>{value}</span>
    </div>
  );
}

function getVacancyLinkState(expiresAt, locale) {
  const date = expiresAt ? new Date(expiresAt) : null;
  const timestamp = date?.getTime();
  const expired = Number.isFinite(timestamp) && timestamp <= Date.now();
  return {
    date: Number.isFinite(timestamp) ? date : null,
    expired,
    label: expired
      ? (i18nT(locale, 'ui.vacanciesAdminTab.expired'))
      : (i18nT(locale, 'ui.vacanciesAdminTab.active')),
  };
}

function normalizeVacancyDetailSection(value) {
  const legacy = {
    fit: 'candidates',
    analytics: 'pipeline',
    referral: 'distribution',
    report: 'distribution',
    config: 'settings',
  };
  if (legacy[value]) return legacy[value];
  return VACANCY_DETAIL_SECTIONS.includes(value) ? value : 'pipeline';
}

function vacancyEditDraft(v = {}) {
  return {
    id: v.id,
    companyId: v.companyId ?? null,
    title: v.title ?? '',
    slug: v.slug ?? '',
    status: v.status ?? VACANCY_STATUS.OPEN,
    positionsCount: String(v.positionsCount ?? 1),
    targetDate: v.targetDate ? String(v.targetDate).slice(0, 10) : '',
    description: v.description ?? '',
    employmentType: v.employmentType ?? '',
    workplaceModality: v.workplaceModality ?? '',
    workplaceState: v.workplaceState ?? '',
    workplaceCity: v.workplaceCity ?? '',
    salaryMin: salaryToCentsDigits(v.salaryMin),
    salaryMax: salaryToCentsDigits(v.salaryMax),
    clientReportShowSalary: Boolean(v.clientReportShowSalary),
    publicPageEnabled: Boolean(v.publicPageEnabled),
    publicAllowIndex: Boolean(v.publicAllowIndex),
    publicShowCompanyInfo: Boolean(v.publicShowCompanyInfo),
    publicShowSalary: Boolean(v.publicShowSalary),
    jobRoleId: v.jobRoleId != null ? String(v.jobRoleId) : '',
    companySlug: v.companySlug || '',
  };
}

export { VacancyInviteByEmail };

export function VacanciesAdminTab({ isAdmin, navigateDashboard, locale = 'pt-BR' }) {
  const { confirm, notice, promptForm, toast } = useAppFeedback();
  const urlParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [vacancies, setVacancies] = useState([]);
  const [vacLoaded, setVacLoaded] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [invitesRefresh, setInvitesRefresh] = useState(0);
  const [pipelineRefresh, setPipelineRefresh] = useState(0);
  const [linkExpiryEdit, setLinkExpiryEdit] = useState(null);
  const [editingVacancy, setEditingVacancy] = useState(null);
  const [editingVacancyBaseline, setEditingVacancyBaseline] = useState('');
  const [detailVacancy, setDetailVacancy] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSection, setDetailSection] = useState(() =>
    normalizeVacancyDetailSection(urlParams.get('vacancySection'))
  );

  const vacancyDetailId = String(urlParams.get('vacancyDetail') || '').trim();
  const isDetailView = Boolean(vacancyDetailId);

  const { page: vacPage, pageSize: vacPageSize } = parseVacanciesPagination(
    Object.fromEntries(urlParams.entries())
  );
  const vacSortSt = parseVacanciesSort(Object.fromEntries(urlParams.entries()), { isAdmin });
  const vacFilterFromUrl = String(urlParams.get('vacancy') || 'all');
  const companyFilterFromUrl = String(urlParams.get('company') || 'all');
  const vacQFromUrl = String(urlParams.get('vacanciesQ') || '').trim();
  const vacStatusFromUrl = normalizeVacancyListFilter(urlParams.get('vacanciesStatus'));
  const [vacSearchDraft, setVacSearchDraft] = useState(vacQFromUrl);
  const [vacSummary, setVacSummary] = useState(null);
  const [vacTotal, setVacTotal] = useState(0);
  const [vacTotalPages, setVacTotalPages] = useState(1);

  // Auto-limpa msg após 3s; cancela timer anterior a cada nova msg e ao desmontar
  // (evita setState em componente desmontado quando o gestor troca de aba/vaga).
  const msgTimerRef = useRef(null);
  const createFromNavigationHandledRef = useRef(false);
  useEffect(() => {
    if (urlParams.get('create') !== '1' || createFromNavigationHandledRef.current) return;
    createFromNavigationHandledRef.current = true;
    setEditingVacancy(null);
    setShowCreate(true);
  }, [urlParams]);
  useEffect(() => () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
  }, []);
  const showMsg = useCallback((text) => {
    setMsg(text);
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setMsg(''), 3000);
  }, []);

  const handlePipelineStagesChange = useCallback(() => {
    setPipelineRefresh((current) => current + 1);
  }, []);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState(VACANCY_STATUS.OPEN);
  const [positionsCount, setPositionsCount] = useState('1');
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  const [descAiBusy, setDescAiBusy] = useState(false);
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [workplaceModality, setWorkplaceModality] = useState('');
  const [workplaceState, setWorkplaceState] = useState('');
  const [workplaceCity, setWorkplaceCity] = useState('');
  const [clientReportShowSalary, setClientReportShowSalary] = useState(false);
  const [publicPageEnabled, setPublicPageEnabled] = useState(false);
  const [publicAllowIndex, setPublicAllowIndex] = useState(true);
  const [publicShowCompanyInfo, setPublicShowCompanyInfo] = useState(false);
  const [publicShowSalary, setPublicShowSalary] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [jobRoleId, setJobRoleId] = useState('');
  const [jobRoles, setJobRoles] = useState([]);
  const [pipelineTemplates, setPipelineTemplates] = useState([]);
  const [pipelineTemplateId, setPipelineTemplateId] = useState('');
  const [pipelineTemplatesLoading, setPipelineTemplatesLoading] = useState(false);
  const [pipelineTemplatesError, setPipelineTemplatesError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const createOpenedAtRef = useRef(null);
  const pipelineTemplateLoadRef = useRef(0);
  const vacancyListLoadRef = useRef(0);

  const trackRecruitingUx = useCallback((event, extra = {}) => {
    const body = { event, ...extra };
    if (isAdmin && companyId) body.companyId = Number(companyId);
    void fetch('/api/admin/recruiting-ux-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }, [companyId, isAdmin]);

  const openCreate = useCallback(() => {
    setEditingVacancy(null);
    setError('');
    setShowCreate(true);
    createOpenedAtRef.current = Date.now();
    trackRecruitingUx(RECRUITING_UX_EVENT.VACANCY_CREATE_OPENED);
  }, [trackRecruitingUx]);

  const closeCreate = useCallback((trackCancel = true) => {
    if (trackCancel && showCreate && createOpenedAtRef.current) {
      trackRecruitingUx(RECRUITING_UX_EVENT.VACANCY_CREATE_CANCELLED, {
        elapsedMs: Date.now() - createOpenedAtRef.current,
      });
    }
    createOpenedAtRef.current = null;
    setShowCreate(false);
    if (urlParams.get('create') === '1') {
      navigateDashboard({ tab: 'vacancies', create: null, scroll: false });
    }
  }, [navigateDashboard, showCreate, trackRecruitingUx, urlParams]);

  useEffect(() => {
    if (!showCreate || createOpenedAtRef.current) return;
    createOpenedAtRef.current = Date.now();
    trackRecruitingUx(RECRUITING_UX_EVENT.VACANCY_CREATE_OPENED);
  }, [showCreate, trackRecruitingUx]);

  useEffect(() => {
    if (!showCreate || (!title.trim() && !description.trim())) return () => {};
    const preventAccidentalLeave = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalLeave);
    return () => window.removeEventListener('beforeunload', preventAccidentalLeave);
  }, [description, showCreate, title]);

  const appUrl =
    (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';

  const pushVacanciesSort = (column) => {
    const cur = parseVacanciesSort(Object.fromEntries(urlParams.entries()), { isAdmin });
    const nextDir = clientSortNextDir(column, cur.sort, cur.dir);
    navigateDashboard({
      vacanciesSort: column,
      vacanciesSortDir: nextDir,
      vacanciesPage: 1,
      tab: 'vacancies',
    });
  };

  const loadVacancies = async () => {
    vacancyListLoadRef.current += 1;
    const requestId = vacancyListLoadRef.current;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        page: String(vacPage),
        pageSize: String(vacPageSize),
        sort: vacSortSt.sort,
        sortDir: vacSortSt.dir,
      });
      if (vacFilterFromUrl && vacFilterFromUrl !== 'all') qs.set('vacancy', vacFilterFromUrl);
      if (vacQFromUrl) qs.set('q', vacQFromUrl);
      if (vacStatusFromUrl !== VACANCY_LIST_FILTER.ALL) qs.set('status', vacStatusFromUrl);
      if (isAdmin && companyFilterFromUrl && companyFilterFromUrl !== 'all') {
        qs.set('company', companyFilterFromUrl);
      }
      const res = await fetch(`/api/admin/vacancies?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (requestId !== vacancyListLoadRef.current) return;
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.loadVacanciesFailed'));
      const rows = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      setVacancies(rows);
      setVacSummary(data?.summary || null);
      const total = typeof data?.total === 'number' ? data.total : rows.length;
      const tpg = typeof data?.totalPages === 'number'
        ? data.totalPages
        : Math.max(1, Math.ceil(total / vacPageSize));
      setVacTotal(total);
      setVacTotalPages(tpg);
    } catch (e) {
      if (requestId !== vacancyListLoadRef.current) return;
      setError((e instanceof TypeError ? '' : e?.message) || t(locale, 'recruiting.loadVacanciesFailed'));
    } finally {
      if (requestId === vacancyListLoadRef.current) {
        setVacLoaded(true);
        setLoading(false);
      }
    }
  };

  const loadCompanies = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/companies?forSelect=1');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.loadCompaniesFailed'));
      setCompanies(Array.isArray(data) ? data : []);
      if (!companyId && Array.isArray(data) && data.length) {
        const fromFilter =
          companyFilterFromUrl !== 'all' &&
          data.some((c) => String(c.id) === companyFilterFromUrl)
            ? companyFilterFromUrl
            : String(data[0].id);
        setCompanyId(fromFilter);
      }
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const loadJobRoles = async (cid) => {
    try {
      const qs = cid ? `?companyId=${encodeURIComponent(cid)}` : '';
      const res = await fetch(`/api/admin/job-roles${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setJobRoles(data.roles || []);
    } catch (e) {
      console.error('[VacanciesTab] Load job roles error:', e);
    }
  };

  const loadPipelineTemplates = async (cid = companyId) => {
    pipelineTemplateLoadRef.current += 1;
    const requestId = pipelineTemplateLoadRef.current;
    setPipelineTemplatesLoading(true);
    setPipelineTemplatesError('');
    try {
      const qs = isAdmin && cid ? `?companyId=${encodeURIComponent(cid)}` : '';
      const res = await fetch(`/api/admin/pipeline-templates${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.pipelineTemplates.loadFailed'));
      if (requestId !== pipelineTemplateLoadRef.current) return;
      const items = Array.isArray(data.templates) ? data.templates : [];
      setPipelineTemplates(items);
      setPipelineTemplateId((current) => {
        if (items.some((item) => String(item.id) === String(current))) return current;
        const preferred = items.find((item) => item.isDefault) || items[0];
        return preferred ? String(preferred.id) : '';
      });
    } catch (e) {
      console.error('[VacanciesTab] Load pipeline templates error:', e);
      if (requestId === pipelineTemplateLoadRef.current) {
        setPipelineTemplates([]);
        setPipelineTemplateId('');
        setPipelineTemplatesError(e?.message || t(locale, 'panel.pipelineTemplates.loadFailed'));
      }
    } finally {
      if (requestId === pipelineTemplateLoadRef.current) setPipelineTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (isDetailView) return;
    loadVacancies();
  }, [vacPage, vacPageSize, vacSortSt.sort, vacSortSt.dir, vacFilterFromUrl, companyFilterFromUrl, vacQFromUrl, vacStatusFromUrl, isDetailView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setVacSearchDraft(vacQFromUrl);
  }, [vacQFromUrl]);

  const vacSearchNavRef = useRef({ navigate: navigateDashboard, q: vacQFromUrl });
  vacSearchNavRef.current = { navigate: navigateDashboard, q: vacQFromUrl };

  useEffect(() => {
    const next = vacSearchDraft.trim();
    if (next === vacQFromUrl) return undefined;
    const timer = window.setTimeout(() => {
      const latest = vacSearchNavRef.current;
      if (next === latest.q) return;
      latest.navigate({ tab: 'vacancies', vacanciesQ: next || null, vacanciesPage: 1, scroll: false });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [vacSearchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCompanies();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAdmin) {
      if (companyId) loadJobRoles(companyId);
      return;
    }
    loadJobRoles();
  }, [companyId, isAdmin]);

  useEffect(() => {
    if (isAdmin && !companyId) return;
    loadPipelineTemplates(companyId);
  }, [companyId, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin) return;
    if (companyFilterFromUrl !== 'all') setCompanyId(companyFilterFromUrl);
  }, [companyFilterFromUrl, isAdmin]);

  const loadVacancyDetail = async (id) => {
    setDetailLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.loadVacancyFailed'));
      setDetailVacancy(data);
    } catch (e) {
      setDetailVacancy(null);
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!vacancyDetailId) {
      setDetailVacancy(null);
      return;
    }
    loadVacancyDetail(vacancyDetailId);
  }, [vacancyDetailId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDetailSection(normalizeVacancyDetailSection(urlParams.get('vacancySection')));
  }, [urlParams]);

  const openVacancyDetail = (id, section = 'pipeline') => {
    navigateDashboard({ tab: 'vacancies', vacancyDetail: String(id), vacancySection: section });
  };

  const listFiltered = Boolean(vacQFromUrl) || vacStatusFromUrl !== VACANCY_LIST_FILTER.ALL;
  const attentionCount = Number(vacSummary?.[VACANCY_LIST_FILTER.ATTENTION]) || 0;
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const pushVacanciesStatus = (next) => {
    navigateDashboard({
      tab: 'vacancies',
      vacanciesStatus: next && next !== VACANCY_LIST_FILTER.ALL ? next : null,
      vacanciesPage: 1,
      scroll: false,
    });
  };

  const clearVacancyListFilters = () => {
    setVacSearchDraft('');
    navigateDashboard({ tab: 'vacancies', vacanciesQ: null, vacanciesStatus: null, vacanciesPage: 1, scroll: false });
  };

  const backToVacanciesList = () => {
    setDetailVacancy(null);
    setLinkExpiryEdit(null);
    setEditingVacancy(null);
    navigateDashboard({ tab: 'vacancies', vacancyDetail: '', vacancySection: null });
  };

  const createVacancy = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const body = {
        title: title.trim(), status, slug: slug.trim() || undefined,
        positionsCount: parseInt(positionsCount, 10) || 1,
        targetDate: targetDate || null,
        description,
        employmentType,
        workplaceModality,
        workplaceState,
        workplaceCity,
        salaryMin: stripSalary(salaryMin),
        salaryMax: stripSalary(salaryMax),
        clientReportShowSalary,
        publicPageEnabled,
        publicAllowIndex,
        publicShowCompanyInfo,
        publicShowSalary,
        jobRoleId: jobRoleId ? parseInt(jobRoleId, 10) : null,
        pipelineTemplateId: pipelineTemplateId ? parseInt(pipelineTemplateId, 10) : null,
      };
      if (isAdmin) body.companyId = companyId ? parseInt(companyId, 10) : null;
      const res = await fetch('/api/admin/vacancies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.createVacancyFailed'));
      setTitle(''); setSlug(''); setStatus(VACANCY_STATUS.OPEN); setPositionsCount('1'); setTargetDate('');
      setDescription(''); setEmploymentType(''); setWorkplaceModality(''); setWorkplaceState(''); setWorkplaceCity('');
      setSalaryMin(''); setSalaryMax(''); setClientReportShowSalary(false);
      setPublicPageEnabled(false); setPublicAllowIndex(true);
      setPublicShowCompanyInfo(false); setPublicShowSalary(false);
      setJobRoleId('');
      const defaultTemplate = pipelineTemplates.find((item) => item.isDefault) || pipelineTemplates[0];
      setPipelineTemplateId(defaultTemplate ? String(defaultTemplate.id) : '');
      trackRecruitingUx(RECRUITING_UX_EVENT.VACANCY_CREATE_COMPLETED, {
        vacancyId: data?.id || data?.vacancy?.id,
        templateId: pipelineTemplateId ? Number(pipelineTemplateId) : undefined,
        elapsedMs: createOpenedAtRef.current ? Date.now() - createOpenedAtRef.current : undefined,
      });
      closeCreate(false);
      await loadVacancies();
      showMsg(t(locale, 'recruiting.vacancyCreated'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentPipelineAsTemplate = async () => {
    if (!detailVacancy?.id) return;
    const values = await promptForm({
      title: t(locale, 'panel.pipelineTemplates.saveTitle'),
      message: t(locale, 'panel.pipelineTemplates.saveHint'),
      confirmLabel: t(locale, 'panel.pipelineTemplates.saveAction'),
      fields: [
        {
          key: 'name',
          label: t(locale, 'panel.pipelineTemplates.nameLabel'),
          placeholder: t(locale, 'panel.pipelineTemplates.namePlaceholder'),
          required: true,
          maxLength: 80,
        },
        {
          key: 'isDefault',
          type: 'boolean',
          label: t(locale, 'panel.pipelineTemplates.defaultLabel'),
          defaultValue: false,
        },
      ],
    });
    if (!values?.name?.trim()) return;
    setLoading(true);
    try {
      const body = {
        vacancyId: detailVacancy.id,
        name: values.name.trim(),
        isDefault: values.isDefault === true,
      };
      if (isAdmin && detailVacancy.companyId) body.companyId = detailVacancy.companyId;
      const res = await fetch('/api/admin/pipeline-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.pipelineTemplates.saveFailed'));
      await loadPipelineTemplates(detailVacancy.companyId);
      toast(t(locale, 'panel.pipelineTemplates.saved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const rotateLink = async (vacancyId) => {
    setLoading(true);
    setError('');
    setMsg('');
    setLinkExpiryEdit((cur) => (cur?.vacancyId === vacancyId ? null : cur));
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.rotateLinkFailed'));
      if (isDetailView) await loadVacancyDetail(vacancyId);
      else await loadVacancies();
      showMsg(t(locale, 'recruiting.linkRotated'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const saveLinkExpiry = async () => {
    if (!linkExpiryEdit?.vacancyId) return;
    const parsed = new Date(linkExpiryEdit.value);
    if (Number.isNaN(parsed.getTime())) {
      setError(t(locale, 'recruiting.invalidExpiry'));
      return;
    }
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(linkExpiryEdit.vacancyId)}/link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: parsed.toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.updateExpiryFailed'));
      setLinkExpiryEdit(null);
      if (isDetailView) await loadVacancyDetail(linkExpiryEdit.vacancyId);
      else await loadVacancies();
      showMsg(t(locale, 'recruiting.expiryUpdated'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const setVacancyStatus = async (vacancyId, nextStatus) => {
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.updateVacancyFailed'));
      if (isDetailView) await loadVacancyDetail(vacancyId);
      else await loadVacancies();
      showMsg(t(locale, 'recruiting.vacancyUpdated'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const editVacancy = (v) => {
    if (!v?.id) return;
    setError('');
    setShowCreate(false);
    if (v.companyId) loadJobRoles(v.companyId);
    const next = vacancyEditDraft(v);
    setEditingVacancy(next);
    setEditingVacancyBaseline(JSON.stringify(next));
  };

  const closeVacancyEditor = async () => {
    if (!editingVacancy) return;
    const dirty = editingVacancyBaseline && JSON.stringify(editingVacancy) !== editingVacancyBaseline;
    if (dirty) {
      const ok = await confirm({
        message: t(locale, 'recruiting.closeVacancyEditorConfirm'),
        confirmLabel: t(locale, 'recruiting.closeVacancyEditorConfirmLabel'),
      });
      if (!ok) return;
    }
    setEditingVacancy(null);
    setEditingVacancyBaseline('');
  };

  const cloneVacancyAction = async (v) => {
    if (!v?.id) return;
    const ok = await confirm({
      title: t(locale, 'recruiting.cloneVacancyConfirmTitle'),
      message: t(locale, 'recruiting.cloneVacancyConfirmBody', { title: v.title || '' }),
      confirmLabel: t(locale, 'recruiting.cloneVacancy'),
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(v.id)}/clone`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.cloneVacancyDone', { title: data.title || '' }), 'ok');
      openVacancyDetail(data.id);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const saveVacancyEdit = async () => {
    if (!editingVacancy || loading) return;
    const {
      id,
      title,
      slug,
      status,
      positionsCount,
      targetDate,
      description,
      employmentType,
      workplaceModality,
      workplaceState,
      workplaceCity,
      salaryMin,
      salaryMax,
      clientReportShowSalary,
      publicPageEnabled,
      publicAllowIndex,
      publicShowCompanyInfo,
      publicShowSalary,
      jobRoleId: editJobRoleId,
    } = editingVacancy;
    if (!title.trim()) { setError(t(locale, 'recruiting.titleRequired')); return; }
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim() || undefined,
          status,
          positionsCount: parseInt(positionsCount, 10) || 1,
          targetDate: targetDate || null,
          description,
          employmentType,
          workplaceModality,
          workplaceState,
          workplaceCity,
          salaryMin: stripSalary(salaryMin),
          salaryMax: stripSalary(salaryMax),
          clientReportShowSalary: Boolean(clientReportShowSalary),
          publicPageEnabled: Boolean(publicPageEnabled),
          publicAllowIndex: Boolean(publicAllowIndex),
          publicShowCompanyInfo: Boolean(publicShowCompanyInfo),
          publicShowSalary: Boolean(publicShowSalary),
          jobRoleId: editJobRoleId ? parseInt(editJobRoleId, 10) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.updateVacancyFailed'));
      setEditingVacancy(null);
      setEditingVacancyBaseline('');
      if (isDetailView) await loadVacancyDetail(id);
      else await loadVacancies();
      showMsg(t(locale, 'recruiting.vacancyUpdated'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const archiveVacancy = async (vacancyId, title) => {
    const ok = await confirm({
      message: t(locale, 'recruiting.archiveConfirm', { title }),
      danger: true,
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.archiveVacancyFailed'));
      if (isDetailView) {
        backToVacanciesList();
      } else {
        await loadVacancies();
      }
      showMsg(t(locale, 'recruiting.vacancyArchived'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const createFormSetters = {
    title: setTitle,
    slug: setSlug,
    status: setStatus,
    positionsCount: setPositionsCount,
    targetDate: setTargetDate,
    description: setDescription,
    employmentType: setEmploymentType,
    salaryMin: setSalaryMin,
    salaryMax: setSalaryMax,
    workplaceModality: setWorkplaceModality,
    workplaceState: setWorkplaceState,
    workplaceCity: setWorkplaceCity,
    publicPageEnabled: setPublicPageEnabled,
    publicAllowIndex: setPublicAllowIndex,
    publicShowCompanyInfo: setPublicShowCompanyInfo,
    publicShowSalary: setPublicShowSalary,
    companyId: setCompanyId,
    jobRoleId: setJobRoleId,
    pipelineTemplateId: setPipelineTemplateId,
  };
  const patchCreateForm = (patch) => {
    Object.entries(patch).forEach(([key, value]) => createFormSetters[key]?.(value));
    if (patch.pipelineTemplateId) {
      trackRecruitingUx(RECRUITING_UX_EVENT.PIPELINE_TEMPLATE_SELECTED, { templateId: Number(patch.pipelineTemplateId) });
    }
  };
  const createFormValues = {
    title, slug, status, positionsCount, targetDate, description, employmentType, salaryMin, salaryMax,
    workplaceModality, workplaceState, workplaceCity, publicPageEnabled, publicAllowIndex,
    publicShowCompanyInfo, publicShowSalary, companyId, jobRoleId, pipelineTemplateId,
  };
  const createDisabled = loading || pipelineTemplatesLoading || !pipelineTemplateId || !title.trim() || (isAdmin && !companyId);

  const vacancyFormDrawers = (
    <>
      <AdminRichFormDrawer
        open={showCreate}
        title={t(locale, 'recruiting.createVacancyDrawerTitle')}
        locale={locale}
        onClose={closeCreate}
        footer={(
          <>
            <button
              type="button"
              onClick={closeCreate}
              disabled={loading}
              className={dialogBtnGhostClass}
            >
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={createVacancy}
              disabled={createDisabled}
              className={cn(dialogBtnPrimaryClass, 'inline-flex items-center gap-2', createDisabled && 'opacity-60')}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              {t(locale, 'panel.admin.create')}
            </button>
          </>
        )}
      >
        {showCreate ? (
          <div aria-busy={loading}>
            <VacancyFormFields
              locale={locale}
              mode="create"
              layout="stack"
              values={createFormValues}
              onChange={patchCreateForm}
              error={error}
              isAdmin={isAdmin}
              companies={companies}
              jobRoles={jobRoles}
              pipelineTemplates={pipelineTemplates}
              pipelineTemplatesLoading={pipelineTemplatesLoading}
              pipelineTemplatesError={pipelineTemplatesError}
              descAiBusy={descAiBusy}
              onDescAiBusyChange={setDescAiBusy}
            />
          </div>
        ) : null}
      </AdminRichFormDrawer>

      <AdminRichFormDrawer
        open={!!editingVacancy}
        title={t(locale, 'recruiting.editVacancyDrawerTitle')}
        locale={locale}
        headerMeta={editingVacancy ? (
          <>
            <span className="font-mono tabular-nums text-ink-muted">#{editingVacancy.id}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 break-words">{editingVacancy.title || t(locale, 'recruiting.vacancyTitlePh')}</span>
          </>
        ) : null}
        onClose={() => void closeVacancyEditor()}
        footer={(
          <>
            <button
              type="button"
              onClick={() => void closeVacancyEditor()}
              disabled={loading}
              className={dialogBtnGhostClass}
            >
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={saveVacancyEdit}
              disabled={loading || !editingVacancy}
              className={cn(dialogBtnPrimaryClass, 'inline-flex items-center gap-2', (loading || !editingVacancy) && 'opacity-60')}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              {t(locale, 'panel.admin.save')}
            </button>
          </>
        )}
      >
        {editingVacancy ? (
          <div aria-busy={loading}>
            <VacancyFormFields
              locale={locale}
              mode="edit"
              layout="stack"
              values={editingVacancy}
              onChange={(patch) => setEditingVacancy((cur) => ({ ...cur, ...patch }))}
              error={error}
              jobRoles={jobRoles}
              descAiBusy={descAiBusy}
              onDescAiBusyChange={setDescAiBusy}
            />
          </div>
        ) : null}
      </AdminRichFormDrawer>
    </>
  );

  if (isDetailView) {
    const v = detailVacancy;
    const token = v?.activeToken || null;
    const link = token ? `${appUrl}/v/${token}` : '';
    const publicPagePath =
      v?.id && v?.slug
        ? publicVacancyPath({ vacancySlug: v.slug, vacancyId: v.id })
        : '';
    const publicPageLink = publicPagePath ? `${appUrl}${publicPagePath}` : '';
    const linkState = getVacancyLinkState(v?.activeTokenExpiresAt, locale);
    const exp = linkState.date;
    return (
      <>
        {vacancyFormDrawers}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 px-1">
            <button
              type="button"
              onClick={backToVacanciesList}
              className={S.btnGhost}
            >
              {t(locale, 'recruiting.backToVacancies')}
            </button>
        </div>
        {!v || error || msg ? (
        <div className={cn(S.card, 'px-7 py-[22px]')}>
          {error ? (
            <p className="mb-0 mt-2.5 font-mono text-prose text-red-800 dark:text-danger">
              {error}
            </p>
          ) : null}
          {msg ? (
            <p className="mb-0 mt-2.5 font-mono text-prose text-success">
              {msg}
            </p>
          ) : null}
          {(detailLoading || loading) && !v ? (
            <AppLoading
              locale={locale}
              variant="panel"
              label={t(locale, 'recruiting.loadingVacancy')}
            />
          ) : null}
          {!detailLoading && !v && error ? (
            <button
              type="button"
              onClick={backToVacanciesList}
              className={cn(S.btnBrandSoft, "mt-3.5")}
            >
              {t(locale, 'recruiting.backToList')}
            </button>
          ) : null}
        </div>
        ) : null}

        {v ? (
          <>
            <div className={S.card}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <h1 className="m-0 text-xl font-bold text-ink">{v.title}</h1>
                    <span className="font-ui text-prose text-ink/75">{i18nT(locale, 'ui.vacanciesAdminTab.vacancy')}:</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 font-ui text-prose',
                        v.status === VACANCY_STATUS.OPEN
                          ? 'border-success/35 text-success'
                          : 'border-ink/12 text-ink/75'
                      )}
                    >
                      {v.status === VACANCY_STATUS.OPEN
                        ? t(locale, 'recruiting.openStatus')
                        : t(locale, 'recruiting.closedStatus')}
                    </span>
                    {isAdmin ? (
                      <span className="font-mono text-prose text-ink/75">· {v.companyName}</span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {v.positionsCount != null && v.positionsCount > 0 && (
                      <VacancyMetaItem
                        label={i18nT(locale, 'ui.vacanciesAdminTab.openings')}
                        value={t(locale, 'recruiting.positionsCount', { n: v.positionsCount })}
                      />
                    )}
                    {v.targetDate && formatPublicVacancyDate(v.targetDate, locale) ? (
                      <VacancyMetaItem
                        label={i18nT(locale, 'ui.vacanciesAdminTab.deadline')}
                        value={t(locale, 'recruiting.targetDate', {
                          date: formatPublicVacancyDate(v.targetDate, locale),
                        })}
                      />
                    ) : null}
                    {formatVacancySalaryRange(locale, v.salaryMin, v.salaryMax) ? (
                      <VacancyMetaItem
                        label={i18nT(locale, 'ui.vacanciesAdminTab.salaryRange')}
                        value={formatVacancySalaryRange(locale, v.salaryMin, v.salaryMax)}
                      />
                    ) : null}
                    <VacancyMetaItem
                      label={i18nT(locale, 'ui.vacanciesAdminTab.owner')}
                      value={v.ownerName || (i18nT(locale, 'ui.vacanciesAdminTab.notAssigned'))}
                      warning={!v.ownerName}
                    />
                    {employmentTypeLabelKey(v.employmentType) ? (
                      <VacancyMetaItem
                        label={i18nT(locale, 'ui.vacanciesAdminTab.employment')}
                        value={t(locale, employmentTypeLabelKey(v.employmentType))}
                      />
                    ) : null}
                    {formatWorkplaceLabel(
                      {
                        workplaceModality: v.workplaceModality,
                        workplaceCity: v.workplaceCity,
                        workplaceState: v.workplaceState,
                      },
                      locale,
                      t
                    ) ? (
                      <VacancyMetaItem
                        label={i18nT(locale, 'ui.vacanciesAdminTab.workplace')}
                        value={formatWorkplaceLabel(
                          {
                            workplaceModality: v.workplaceModality,
                            workplaceCity: v.workplaceCity,
                            workplaceState: v.workplaceState,
                          },
                          locale,
                          t
                        )}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => editVacancy(v)}
                    disabled={loading}
                    className={cn(S.btnBrandSoft, loading && 'opacity-60')}
                  >
                    {t(locale, 'recruiting.editVacancy')}
                  </button>
                  <details className="group relative">
                    <summary className={cn(S.btnGhost, 'gap-2 list-none select-none [&::-webkit-details-marker]:hidden')}>
                      {t(locale, 'recruiting.moreActions')}
                      <Icon
                        name="chevronDown"
                        className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180"
                      />
                    </summary>
                    <div className="absolute right-0 z-30 mt-1.5 grid min-w-[190px] gap-1 rounded-control border border-ink/12 bg-surface p-1.5 shadow-menu">
                      <button
                        type="button"
                        onClick={() =>
                          setVacancyStatus(
                            v.id,
                            v.status === VACANCY_STATUS.OPEN
                              ? VACANCY_STATUS.CLOSED
                              : VACANCY_STATUS.OPEN
                          )
                        }
                        disabled={loading}
                        className={cn(S.btnGhost, 'w-full justify-start border-transparent text-left', loading && 'opacity-60')}
                      >
                        {v.status === VACANCY_STATUS.OPEN
                          ? t(locale, 'recruiting.closeVacancy')
                          : t(locale, 'recruiting.reopenVacancy')}
                      </button>
                      <button
                        type="button"
                        onClick={() => cloneVacancyAction(v)}
                        disabled={loading}
                        className={cn(S.btnGhost, 'w-full justify-start border-transparent text-left', loading && 'opacity-60')}
                      >
                        {t(locale, 'recruiting.cloneVacancy')}
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveVacancy(v.id, v.title)}
                        disabled={loading}
                        className="min-h-touch w-full cursor-pointer rounded-control border border-transparent bg-transparent px-3 py-2 text-left font-ui text-sm text-red-800 dark:text-danger hover:bg-danger/[0.08] disabled:cursor-default disabled:opacity-60"
                      >
                        {t(locale, 'recruiting.archiveVacancy')}
                      </button>
                    </div>
                  </details>
                </div>
              </div>

              <div className="mt-5">
                <PanelSubNav
                  ariaLabel={t(locale, 'recruiting.detailTabsAria')}
                  active={detailSection}
                  onChange={(id) => {
                    const next = normalizeVacancyDetailSection(id);
                    setDetailSection(next);
                    navigateDashboard({
                      tab: 'vacancies',
                      vacancyDetail: String(v.id),
                      vacancySection: next,
                      scroll: false,
                      clientOnly: true,
                    });
                  }}
                  tabs={[
                    { id: 'pipeline', label: t(locale, 'recruiting.detailTabPipeline') },
                    { id: 'candidates', label: t(locale, 'recruiting.detailTabCandidates') },
                    { id: 'information', label: t(locale, 'recruiting.detailTabInformation') },
                    { id: 'distribution', label: t(locale, 'recruiting.detailTabDistribution') },
                    { id: 'settings', label: t(locale, 'recruiting.detailTabSettings') },
                  ]}
                />
              </div>

              <ContentEnter animKey={detailSection}>
              {detailSection === 'distribution' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <section className="rounded-control border border-ink/10 bg-ink/[0.025] p-3.5" aria-label={t(locale, 'recruiting.enneagramLinkLabel')}>
                  <span className={cn(S.label, 'mb-2.5 block')}>{t(locale, 'recruiting.enneagramLinkLabel')}</span>
                      {token ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(
                              'rounded-full border px-2 py-1 font-ui text-prose',
                              linkState.expired
                                ? 'border-warning/35 bg-warning/[0.10] text-amber-800 dark:text-warning'
                                : 'border-success/30 bg-success/[0.08] text-success'
                            )}>
                              {linkState.label}
                            </span>
                            <CopyableLink
                          url={link}
                          locale={locale}
                          label={t(locale, 'recruiting.enneagramLinkLabel')}
                          iconOnly
                          compact
                          disabled={loading}
                        />
                            <button
                          type="button"
                          onClick={() => rotateLink(v.id)}
                          disabled={loading}
                          className={cn(S.btnGhost, loading && 'opacity-60')}
                            >
                              {linkState.expired
                                ? (i18nT(locale, 'ui.vacanciesAdminTab.renewLink'))
                                : t(locale, 'recruiting.rotateLink')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLinkExpiryEdit((cur) =>
                              cur?.vacancyId === v.id
                                ? null
                                : {
                                    vacancyId: v.id,
                                    value: v.activeTokenExpiresAt
                                      ? toDatetimeLocalValue(new Date(v.activeTokenExpiresAt))
                                      : toDatetimeLocalValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                                  }
                            )
                          }
                          disabled={loading}
                          className={cn(S.btnGhost, loading && 'opacity-60')}
                        >
                          {t(locale, 'recruiting.editLinkExpiry')}
                        </button>
                      </div>
                      {exp ? (
                        <span className={cn(META_FAINT, 'mt-2 block', linkState.expired && 'text-amber-800 dark:text-warning')}>
                          {linkState.expired
                            ? i18nT(locale, 'ui.vacanciesAdminTab.expiredOn', { when: exp.toLocaleString(localeHtmlLang(locale)) })
                            : t(locale, 'recruiting.expiresAt', {
                                when: exp.toLocaleString(localeHtmlLang(locale)),
                              })}
                        </span>
                      ) : null}
                      <p className="m-0 mt-2 font-ui text-prose text-ink/75">
                        {i18nT(locale, 'ui.vacanciesAdminTab.vacancyStatusDescribesRecruitingThis')}
                      </p>
                    </>
                  ) : (
                    <div>
                      <span className={META_FAINT}>{t(locale, 'recruiting.noActiveLink')}</span>
                      <p className="m-0 mt-2 font-ui text-prose text-ink/75">
                        {i18nT(locale, 'ui.vacanciesAdminTab.vacancyStatusDescribesRecruitingThis')}
                      </p>
                    </div>
                  )}

                  {linkExpiryEdit?.vacancyId === v.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-ink/8 pt-3">
                      <DateField
                        mode="datetime-local"
                        value={linkExpiryEdit.value}
                        onChange={(e) =>
                          setLinkExpiryEdit((cur) =>
                            cur && cur.vacancyId === v.id ? { ...cur, value: e.target.value } : cur
                          )
                        }
                        disabled={loading}
                        aria-label={t(locale, 'panel.admin.ariaLinkExpiry')}
                        className={cn(FIELD, 'min-w-[180px] flex-[1_1_200px] px-2.5 py-2 text-prose')}
                      />
                      <button type="button" onClick={saveLinkExpiry} disabled={loading} className={cn(S.btnBrandSoft, loading && 'opacity-60')}>
                        {t(locale, 'panel.admin.save')}
                      </button>
                      <button type="button" onClick={() => setLinkExpiryEdit(null)} disabled={loading} className={cn(S.btnGhost, loading && 'opacity-60')}>
                        {t(locale, 'panel.admin.cancel')}
                      </button>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-control border border-ink/10 bg-ink/[0.025] p-3.5" aria-label={t(locale, 'recruiting.publicPageLinkLabel')}>
                  <span className={cn(S.label, 'mb-2.5 block')}>{t(locale, 'recruiting.publicPageLinkLabel')}</span>
                  {publicPageLink ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyableLink
                        url={publicPageLink}
                        locale={locale}
                        label={t(locale, 'recruiting.publicPageLinkLabel')}
                        iconOnly
                        compact
                        disabled={loading}
                      />
                      <VacancyWhatsAppShareButton
                        locale={locale}
                        pageUrl={publicPageLink}
                        title={v.title}
                        companyName={v.companyName}
                        disabled={loading || !v.publicPageEnabled}
                      />
                    </div>
                  ) : null}
                  {!v.publicPageEnabled ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/8 pt-3">
                      <span className={cn(META_FAINT, 'block flex-1')}>{t(locale, 'recruiting.publicPageLinkDisabledHint')}</span>
                      <button type="button" onClick={() => editVacancy(v)} disabled={loading} className={S.btnBrandSoft}>
                        {i18nT(locale, 'ui.vacanciesAdminTab.activatePage')}
                      </button>
                    </div>
                  ) : null}
                </section>
              </div>
              ) : null}

              {detailSection === 'pipeline' ? (
                <>
                  <VacancyKanbanBlock
                    vacancyId={v.id}
                    companyId={v.companyId}
                    locale={locale}
                    refreshKey={pipelineRefresh}
                    onPersonClick={(candidateId) => {
                      if (!candidateId) return;
                      navigateDashboard({
                        tab: 'team',
                        candidate: String(candidateId),
                        vacancy: String(v.id),
                      });
                    }}
                  />
                  <CollapsibleBlock
                    locale={locale}
                    title={t(locale, 'recruiting.detailTabAnalytics')}
                    defaultOpen={false}
                    className="mt-4"
                  >
                    <VacancyFunnelAnalyticsBlock
                      vacancyId={v.id}
                      locale={locale}
                      appUrl={appUrl}
                      publicPagePath={
                        v.publicPageEnabled && v.slug
                          ? publicVacancyPath({ vacancySlug: v.slug, vacancyId: v.id })
                          : ''
                      }
                    />
                  </CollapsibleBlock>
                </>
              ) : null}

              {detailSection === 'candidates' ? (
                <div className="space-y-4">
                  <div className="rounded-control border border-brand-500/20 bg-brand-500/[0.045] px-4 py-3">
                    <h3 className="m-0 font-ui text-sm font-semibold text-ink">
                      {i18nT(locale, 'ui.vacanciesAdminTab.candidateIntake')}
                    </h3>
                    <p className="mb-0 mt-1 text-prose leading-[1.5] text-ink-muted">
                      {i18nT(locale, 'ui.vacanciesAdminTab.registerInterviewDetailsFirstThen')}
                    </p>
                  </div>
                  <VacancyInterviewCandidates
                    vacancyId={v.id}
                    locale={locale}
                    onPipelineChange={() => {
                      setInvitesRefresh((x) => x + 1);
                      setPipelineRefresh((x) => x + 1);
                    }}
                  />
                  <VacancyInviteByEmail
                    vacancyId={v.id}
                    locale={locale}
                    onSent={() => {
                      setInvitesRefresh((x) => x + 1);
                      setPipelineRefresh((x) => x + 1);
                    }}
                  />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="flex flex-col">
                      <h3 className="mb-2 font-ui text-sm font-semibold text-ink">
                        {t(locale, 'recruiting.inviteListTitle')}
                      </h3>
                      <VacancyInvitesBlock vacancyId={v.id} locale={locale} refreshKey={invitesRefresh} />
                    </section>
                    <section className="flex flex-col">
                      <h3 className="mb-2 font-ui text-sm font-semibold text-ink">
                        {i18nT(locale, 'ui.vacanciesAdminTab.nextStep')}
                      </h3>
                      <div className="flex-1 rounded-control border border-ink/10 bg-ink/[0.02] p-4">
                        <p className="m-0 text-prose leading-[1.55] text-ink-muted">
                          {i18nT(locale, 'ui.vacanciesAdminTab.useThePipelineTabTo')}
                        </p>
                      </div>
                    </section>
                  </div>
                  <CollapsibleBlock
                    locale={locale}
                    title={t(locale, 'recruiting.detailTabFit')}
                    defaultOpen={false}
                    className="mt-4"
                  >
                    <VacancyRubricEditor
                      vacancyId={v.id}
                      locale={locale}
                      vacancyTitle={v.title || ''}
                      vacancyDescription={v.description || ''}
                      onSaved={() => setPipelineRefresh((x) => x + 1)}
                    />
                    <div className="mt-4">
                      <VacancyFitRankingBlock vacancyId={v.id} locale={locale} refreshKey={pipelineRefresh} />
                    </div>
                  </CollapsibleBlock>
                </div>
              ) : null}

              {detailSection === 'information' ? (
                <div className="rounded-card border border-ink/10 bg-ink/[0.02] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 font-ui text-base font-semibold text-ink">
                        {t(locale, 'recruiting.vacancyDescriptionLabel')}
                      </h3>
                      <p className="mb-0 mt-1 max-w-[68ch] font-ui text-prose text-ink-muted">
                        {t(locale, 'recruiting.detailInformationHint')}
                      </p>
                    </div>
                    <button type="button" onClick={() => editVacancy(v)} disabled={loading} className={S.btnBrandSoft}>
                      {t(locale, 'recruiting.editVacancy')}
                    </button>
                  </div>
                  {v.description ? (
                    <VacancyDescriptionHtml html={v.description} />
                  ) : (
                    <p className="mb-0 mt-4 font-ui text-sm text-ink-muted">
                      {t(locale, 'recruiting.detailInformationEmpty')}
                    </p>
                  )}
                </div>
              ) : null}

              {detailSection === 'distribution' ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-2 xl:items-start">
                  <VacancyReferralBlock
                    vacancyId={v.id}
                    locale={locale}
                    appUrl={appUrl}
                    publicPagePath={
                      v.publicPageEnabled && v.slug
                        ? publicVacancyPath({ vacancySlug: v.slug, vacancyId: v.id })
                        : ''
                    }
                  />
                  <VacancyClientReportBlock
                    vacancyId={v.id}
                    locale={locale}
                    appUrl={appUrl}
                    clientReportShowSalary={Boolean(v.clientReportShowSalary)}
                    onClientReportShowSalaryChange={(next) => {
                      setVacancies((list) =>
                        list.map((row) =>
                          Number(row.id) === Number(v.id)
                            ? { ...row, clientReportShowSalary: next }
                            : row
                        )
                      );
                    }}
                  />
                </div>
              ) : null}

              {detailSection === 'settings' ? (
                <div className="rounded-card border border-ink/10 bg-ink/[0.02] p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 font-ui text-base font-semibold text-ink">
                        {t(locale, 'panel.pipelineEditor.title')}
                      </h3>
                      <p className="mb-0 mt-1 max-w-[68ch] font-ui text-prose leading-[1.55] text-ink-muted">
                        {t(locale, 'panel.pipelineEditor.subtitle')}
                      </p>
                    </div>
                    <button type="button" className={S.btnGhost} onClick={saveCurrentPipelineAsTemplate} disabled={loading}>
                      {t(locale, 'panel.pipelineTemplates.saveAction')}
                    </button>
                  </div>
                  <PipelineStagesEditor
                    locale={locale}
                    vacancyId={v.id}
                    companyId={v.companyId}
                    onChange={handlePipelineStagesChange}
                  />
                </div>
              ) : null}
              </ContentEnter>
            </div>
          </>
        ) : null}
      </div>
      </>
    );
  }

  if (showPipelineSettings) {
    return (
      <ContentEnter animKey="pipeline-template-settings">
        <div className="flex flex-col gap-4">
          <div className={cn(S.card, 'px-7 py-[22px]')}>
            <button type="button" className={cn(S.btnGhost, 'mb-4')} onClick={() => setShowPipelineSettings(false)}>
              {t(locale, 'panel.pipelineTemplates.backToVacancies')}
            </button>
            <span className={S.label}>{t(locale, 'panel.pipelineTemplates.manageTitle')}</span>
            <p className="mb-0 mt-2.5 max-w-[720px] text-prose leading-[1.65] text-ink-muted">
              {t(locale, 'panel.pipelineTemplates.manageHint')}
            </p>
          </div>
          <div className={S.card}>
            <PipelineTemplatesManager
              locale={locale}
              companyId={companyId}
              templates={pipelineTemplates}
              loading={pipelineTemplatesLoading}
              onChanged={loadPipelineTemplates}
            />
          </div>
        </div>
      </ContentEnter>
    );
  }

  return (
    <>
      {vacancyFormDrawers}
    <div className="flex flex-col gap-4">
      <div className={S.card}>
        <AdminPageHeader
          title={t(locale, 'recruiting.vacanciesTitle')}
          description={t(locale, 'recruiting.vacanciesIntro')}
          actions={(
            <>
            <button
              type="button"
              onClick={() => setShowPipelineSettings(true)}
              className={S.btnGhost}
            >
              {t(locale, 'panel.pipelineTemplates.manageAction')}
            </button>
            <button
              type="button"
              onClick={loadVacancies}
              disabled={loading}
              className={cn(S.btnGhost, loading && "opacity-60")}
            >
              {loading ? <span className="spinner" /> : null}
              {t(locale, 'recruiting.refresh')}
            </button>
            <AdminCreateButton
              label={t(locale, 'recruiting.createVacancyOpen')}
              onClick={openCreate}
            />
            </>
          )}
        />
        {error ? <p className="mb-0 mt-2 font-ui text-sm text-red-800 dark:text-danger">{error}</p> : null}
        {msg ? <p className="mb-0 mt-2 font-ui text-sm text-success">{msg}</p> : null}

        {vacFilterFromUrl !== 'all' ? (
          <div className="mt-2.5 rounded-control border border-ink/12 bg-ink/[0.03] px-3.5 py-2.5">
            <p className="m-0 text-prose leading-[1.55] text-ink-muted">
              {t(locale, 'recruiting.filterLimited')}{' '}
              <button
                type="button"
                onClick={() => navigateDashboard({ vacancy: 'all', vacanciesPage: 1, tab: 'vacancies' })}
                className="cursor-pointer border-none bg-transparent p-0 font-mono text-prose text-brand-600 underline"
              >
                {t(locale, 'recruiting.showAllVacancies')}
              </button>
            </p>
          </div>
        ) : null}
        {!vacLoaded ? (
          <AppLoading variant="panel" locale={locale} label={t(locale, 'panel.common.loading')} />
        ) : vacTotal === 0 && !listFiltered && !loading ? (
          <div className="mt-3">
            <EmptyState
              message={
                vacFilterFromUrl !== 'all'
                  ? t(locale, 'recruiting.noVacancyFilter')
                  : t(locale, 'recruiting.noVacanciesYet')
              }
              actionLabel={
                vacFilterFromUrl === 'all' ? t(locale, 'recruiting.createVacancyOpen') : undefined
              }
              onAction={vacFilterFromUrl === 'all' ? () => openCreate() : undefined}
              actionDisabled={loading}
            />
          </div>
        ) : (
          <>
            {attentionCount > 0 ? (
              <InlineCallout
                tone="warning"
                role="status"
                className="mt-4"
                action={(
                <button
                  type="button"
                  onClick={() =>
                    pushVacanciesStatus(
                      vacStatusFromUrl === VACANCY_LIST_FILTER.ATTENTION ? VACANCY_LIST_FILTER.ALL : VACANCY_LIST_FILTER.ATTENTION
                    )
                  }
                  className="inline-flex min-h-touch shrink-0 cursor-pointer items-center rounded-control border border-warning/40 bg-surface px-3 py-1.5 font-ui text-sm font-medium text-amber-800 transition-colors hover:bg-warning/10 dark:text-warning"
                >
                  {vacStatusFromUrl === VACANCY_LIST_FILTER.ATTENTION
                    ? i18nT(locale, 'ui.vacanciesAdminTab.attentionShowAll')
                    : i18nT(locale, 'ui.vacanciesAdminTab.attentionShow')}
                </button>
                )}
              >
                <strong className="font-semibold">
                  {attentionCount === 1
                    ? i18nT(locale, 'ui.vacanciesAdminTab.attentionOne')
                    : i18nT(locale, 'ui.vacanciesAdminTab.attentionMany', { n: attentionCount })}
                </strong>{' '}
                {i18nT(locale, 'ui.vacanciesAdminTab.attentionBody')}
              </InlineCallout>
            ) : null}

            <AdminListFilters
              className="mt-4"
              aria-label={t(locale, 'recruiting.vacanciesTitle')}
              locale={locale}
              onClear={clearVacancyListFilters}
              clearEnabled={listFiltered}
            >
              <AdminListSearch
                locale={locale}
                value={vacSearchDraft}
                onChange={setVacSearchDraft}
                onSubmit={(value) =>
                  navigateDashboard({
                    tab: 'vacancies',
                    vacanciesQ: String(value || '').trim() || null,
                    vacanciesPage: 1,
                    scroll: false,
                  })
                }
                placeholder={i18nT(locale, 'ui.vacanciesAdminTab.searchPh')}
              />
              <AdminListFilterSelect
                label={i18nT(locale, 'ui.vacanciesAdminTab.statusFilter')}
                value={vacStatusFromUrl}
                onChange={pushVacanciesStatus}
                className="max-w-[16rem]"
              >
                {VACANCY_LIST_FILTER_OPTIONS.map(([value, key]) => (
                  <option key={value} value={value}>
                    {i18nT(locale, key, { n: vacSummary?.[value] ?? 0 })}
                  </option>
                ))}
              </AdminListFilterSelect>
            </AdminListFilters>

            {loading && vacancies.length === 0 ? (
              <AppLoading variant="panel" locale={locale} label={t(locale, 'panel.common.loading')} />
            ) : vacancies.length === 0 ? (
              <EmptyState
                message={i18nT(locale, 'ui.vacanciesAdminTab.noResults')}
                actionLabel={t(locale, 'panel.common.clearFilters')}
                onAction={clearVacancyListFilters}
              />
            ) : (
              <AdminTableShell
                locale={locale}
                minWidth={isAdmin ? '1020px' : '900px'}
                ariaLabel={t(locale, 'recruiting.vacanciesTitle')}
                animKey={`vac-${vacStatusFromUrl}-${vacQFromUrl}-${vacPage}-${vacSortSt.sort}-${vacSortSt.dir}`}
                className={cn('transition-opacity', loading && 'opacity-60')}
              >
                <thead>
                  <tr className="bg-ink/[0.02]">
                    <SortableTh columnKey="title" sortKey={vacSortSt.sort} dir={vacSortSt.dir} onSort={pushVacanciesSort}>
                      {i18nT(locale, 'ui.vacanciesAdminTab.vacancy')}
                    </SortableTh>
                    {isAdmin ? (
                      <SortableTh columnKey="companyName" sortKey={vacSortSt.sort} dir={vacSortSt.dir} onSort={pushVacanciesSort}>
                        {i18nT(locale, 'ui.vacanciesAdminTab.colCompany')}
                      </SortableTh>
                    ) : null}
                    <SortableTh columnKey="status" sortKey={vacSortSt.sort} dir={vacSortSt.dir} onSort={pushVacanciesSort}>
                      {i18nT(locale, 'ui.vacanciesAdminTab.statusFilter')}
                    </SortableTh>
                    <AdminTh align="right">{i18nT(locale, 'ui.vacanciesAdminTab.colCandidates')}</AdminTh>
                    <AdminTh>{i18nT(locale, 'ui.vacanciesAdminTab.colHires')}</AdminTh>
                    <AdminTh>{i18nT(locale, 'ui.vacanciesAdminTab.deadline')}</AdminTh>
                    <AdminTh className="hidden 2xl:table-cell">{i18nT(locale, 'ui.vacanciesAdminTab.salaryRange')}</AdminTh>
                    <AdminTh>
                      <span className="inline-flex items-center gap-1.5">
                        {i18nT(locale, 'ui.vacanciesAdminTab.colLink')}
                        <IconActionTip label={i18nT(locale, 'ui.vacanciesAdminTab.vacancyStatusDescribesRecruitingThis')}>
                          <span tabIndex={0} className="inline-flex text-ink-muted" aria-label={i18nT(locale, 'ui.vacanciesAdminTab.vacancyStatusDescribesRecruitingThis')}>
                            <Icon name="feedbackInfo" className="h-3.5 w-3.5" />
                          </span>
                        </IconActionTip>
                      </span>
                    </AdminTh>
                    <SortableTh className="hidden 2xl:table-cell" columnKey="createdAt" sortKey={vacSortSt.sort} dir={vacSortSt.dir} onSort={pushVacanciesSort}>
                      {i18nT(locale, 'ui.vacanciesAdminTab.colCreated')}
                    </SortableTh>
                    <AdminActionsTh />
                  </tr>
                </thead>
                <tbody>
                  {vacancies.map((v) => {
                    const token = v.activeToken || '';
                    const link = token ? `${appUrl}/v/${token}` : '';
                    const linkState = getVacancyLinkState(v.activeTokenExpiresAt, locale);
                    const exp = linkState.date;
                    const isOpen = v.status === VACANCY_STATUS.OPEN;
                    const deadlineIso = v.targetDate ? String(v.targetDate).slice(0, 10) : '';
                    const overdue = isOpen && Boolean(deadlineIso) && deadlineIso < todayIso;
                    const workplace = formatWorkplaceLabel(v, locale, i18nT);
                    const salary = formatVacancySalaryRange(locale, v.salaryMin, v.salaryMax, { compact: true });
                    const salaryFull = salary ? formatVacancySalaryRange(locale, v.salaryMin, v.salaryMax) : '';
                    const positions = Math.max(1, Number(v.positionsCount) || 1);
                    const hired = Number(v.hiredCount) || 0;
                    const candidates = Number(v.candidatesCount) || 0;
                    const recent = Number(v.candidatesRecentCount) || 0;
                    return (
                      <tr
                        key={v.id}
                        className={cn(
                          'border-t border-ink/10 transition-colors hover:bg-ink/[0.02]',
                          v.needsAttention && 'bg-warning/[0.04]'
                        )}
                      >
                        <td className="min-w-[13rem] max-w-[24rem] px-4 py-3 align-middle">
                          <button
                            type="button"
                            onClick={() => openVacancyDetail(v.id)}
                            className="line-clamp-2 block max-w-full cursor-pointer border-none bg-transparent p-0 text-left font-ui text-sm font-medium text-ink hover:text-brand-600 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
                            title={v.title}
                          >
                            {v.title}
                          </button>
                          <div className="mt-1 w-0 min-w-full truncate font-ui text-prose text-ink-muted" title={workplace || undefined}>
                            <span className="font-mono tabular-nums">#{v.id}</span>
                            {workplace ? ` · ${workplace}` : ''}
                          </div>
                          <div className="mt-0.5 w-0 min-w-full truncate font-ui text-prose">
                            {v.ownerName ? (
                              <span className="text-ink-muted">{i18nT(locale, 'ui.vacanciesAdminTab.ownerLine', { name: v.ownerName })}</span>
                            ) : (
                              <span className="text-amber-800 dark:text-warning">{i18nT(locale, 'ui.vacanciesAdminTab.noOwner')}</span>
                            )}
                          </div>
                          {salary ? (
                            <div className="mt-0.5 font-ui text-prose tabular-nums text-ink-muted 2xl:hidden" title={salaryFull}>
                              {salary}
                            </div>
                          ) : null}
                        </td>
                        {isAdmin ? (
                          <td className="px-4 py-3 align-middle font-ui text-prose text-ink-muted">{v.companyName}</td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <StatusToneChip tone={isOpen ? 'success' : 'neutral'}>
                            {isOpen ? t(locale, 'recruiting.openStatus') : t(locale, 'recruiting.closedStatus')}
                          </StatusToneChip>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <button
                            type="button"
                            onClick={() => openVacancyDetail(v.id, 'candidates')}
                            aria-label={i18nT(locale, 'ui.vacanciesAdminTab.openCandidatesAria', { title: v.title })}
                            className="inline-flex min-h-9 cursor-pointer flex-col items-end justify-center whitespace-nowrap rounded-control border-none bg-transparent px-1.5 py-0.5 hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
                            title={candidates ? undefined : i18nT(locale, 'ui.vacanciesAdminTab.noCandidates')}
                          >
                            <span className={cn('font-mono text-sm font-semibold tabular-nums', candidates ? 'text-ink' : 'text-ink-muted')}>
                              {candidates.toLocaleString(localeHtmlLang(locale))}
                            </span>
                            {recent ? (
                              <span className="font-ui text-prose text-success">
                                {i18nT(locale, 'ui.vacanciesAdminTab.recentCandidates', { n: recent })}
                              </span>
                            ) : null}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <div
                            className="flex w-20 flex-col gap-1.5"
                            aria-label={i18nT(locale, 'ui.vacanciesAdminTab.hiresAria', { hired, total: positions })}
                          >
                            <span className="font-mono text-prose tabular-nums text-ink">
                              {hired}/{positions}
                            </span>
                            <MeterBar value={hired} max={positions} height={4} toneClass="bg-success" />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle font-ui text-prose">
                          {deadlineIso ? (
                            <div className="flex flex-col items-start">
                              <span className={overdue ? 'font-medium text-amber-800 dark:text-warning' : 'text-ink'}>
                                {formatPublicVacancyDate(v.targetDate, locale)}
                              </span>
                              {overdue ? (
                                <span className="inline-flex items-center gap-1 font-ui text-prose font-semibold text-amber-800 dark:text-warning">
                                  <Icon name="feedbackWarning" className="h-3 w-3" />
                                  {i18nT(locale, 'ui.vacanciesAdminTab.overdue')}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-ink-muted">{i18nT(locale, 'ui.vacanciesAdminTab.noDeadline')}</span>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 align-middle font-ui text-prose 2xl:table-cell">
                          {salary ? (
                            <span className="tabular-nums text-ink" title={salaryFull}>{salary}</span>
                          ) : (
                            <span className="text-ink-muted">{i18nT(locale, 'ui.vacanciesAdminTab.noSalary')}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          {token ? (
                            <div className="flex flex-col items-start gap-1">
                              <div className="flex items-center gap-1.5">
                                <StatusToneChip tone={linkState.expired ? 'warning' : 'success'}>{linkState.label}</StatusToneChip>
                                {linkState.expired ? (
                                  <button
                                    type="button"
                                    onClick={() => rotateLink(v.id)}
                                    disabled={loading}
                                    className={S.btnBrandSoft}
                                  >
                                    {i18nT(locale, 'ui.vacanciesAdminTab.renewShort')}
                                  </button>
                                ) : (
                                  <CopyableLink
                                    url={link}
                                    locale={locale}
                                    label={t(locale, 'recruiting.enneagramLinkLabel')}
                                    iconOnly
                                    compact
                                    disabled={loading}
                                  />
                                )}
                              </div>
                              {exp ? (
                                <span
                                  className={cn('font-ui text-prose', linkState.expired ? 'text-amber-800 dark:text-warning' : 'text-ink-muted')}
                                  title={exp.toLocaleString(localeHtmlLang(locale))}
                                >
                                  {i18nT(
                                    locale,
                                    linkState.expired ? 'ui.vacanciesAdminTab.linkExpiredShort' : 'ui.vacanciesAdminTab.linkValidUntil',
                                    { date: exp.toLocaleDateString(localeHtmlLang(locale)) }
                                  )}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <StatusToneChip tone="neutral">{i18nT(locale, 'ui.vacanciesAdminTab.noLink')}</StatusToneChip>
                              <button
                                type="button"
                                onClick={() => rotateLink(v.id)}
                                disabled={loading}
                                className={S.btnBrandSoft}
                              >
                                {i18nT(locale, 'ui.vacanciesAdminTab.generateLink')}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 align-middle font-ui text-prose text-ink-muted 2xl:table-cell">
                          {v.createdAt ? new Date(v.createdAt).toLocaleDateString(localeHtmlLang(locale)) : ''}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <AdminActionsCell>
                            <AdminViewButton
                              label={t(locale, 'recruiting.viewCandidates')}
                              onClick={() => openVacancyDetail(v.id)}
                            />
                            <AdminEditButton
                              label={t(locale, 'recruiting.editVacancy')}
                              onClick={() => editVacancy(v)}
                              disabled={loading}
                            />
                            <RowActionsMenu
                              label={t(locale, 'recruiting.moreActions')}
                              disabled={loading}
                              items={[
                                { id: 'clone', label: t(locale, 'recruiting.cloneVacancy'), onSelect: () => cloneVacancyAction(v) },
                                { id: 'rotate', label: t(locale, 'recruiting.rotateLink'), onSelect: () => rotateLink(v.id) },
                                {
                                  id: 'status',
                                  label: isOpen ? t(locale, 'recruiting.closeVacancy') : t(locale, 'recruiting.reopenVacancy'),
                                  onSelect: () => setVacancyStatus(v.id, isOpen ? VACANCY_STATUS.CLOSED : VACANCY_STATUS.OPEN),
                                },
                                { id: 'archive', label: t(locale, 'recruiting.archiveVacancy'), danger: true, onSelect: () => archiveVacancy(v.id, v.title) },
                              ]}
                            />
                          </AdminActionsCell>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTableShell>
            )}

            <AdminListPager
              locale={locale}
              page={vacPage}
              pageSize={vacPageSize}
              total={vacTotal}
              loading={loading}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              countLabel={t(locale, 'recruiting.vacanciesPage', { total: vacTotal, page: vacPage, pages: vacTotalPages })}
              onPageChange={(p) => navigateDashboard({ vacanciesPage: p, tab: 'vacancies' })}
              onPageSizeChange={(ps) => navigateDashboard({ vacanciesPage: 1, vacanciesPageSize: ps, tab: 'vacancies' })}
            />
          </>
        )}
      </div>
    </div>
    </>
  );
}
