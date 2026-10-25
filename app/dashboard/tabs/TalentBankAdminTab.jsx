'use client';

import { useListUrlState, useListSearchDraft } from '../hooks/useListUrlState';

import { CandidateTagsProvider, CandidateTags, CandidateTagFilters } from '../CandidateTags';
import { useCallback, useEffect, useState } from 'react';
import { useAppFeedback } from '../../_components/AppFeedback';
import { useEmployeeAdmission } from '../../_components/useEmployeeAdmission';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading } from '../../_components/AppLoading';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import { PIPELINE_STAGES } from '../../../lib/pipeline';
import {
  ABSENCE_LIST,
  ABSENCE_SUGGESTION,
  formatAbsenceExplanation,
  formatAbsenceReasonLines,
} from '../../../lib/people/list-absence-diagnostics-core.js';
import {
  S,
  SortableTh,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminActionsCell,
  AdminActionsTh,
  AdminIconButton,
  clientSortNextDir,
  TypeBadge,
} from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';

const STAGE_I18N = {
  new: 'recruiting.pipelineNew',
  interview: 'recruiting.pipelineInterview',
  test_completed: 'recruiting.pipelineTestCompleted',
  screening: 'recruiting.pipelineScreening',
  approved: 'recruiting.pipelineApproved',
  hired: 'recruiting.pipelineHired',
  rejected: 'recruiting.pipelineRejected',
  archived: 'recruiting.pipelineArchived',
};

function stageLabel(locale, stage) {
  if (!stage) return '—';
  const key = STAGE_I18N[stage];
  return key ? t(locale, key) : stage;
}

/**
 * Talent bank — reuse people who already applied / linked to a vacancy.
 */
export function TalentBankAdminTab(props) {
  const [tagRefresh, setTagRefresh] = useState(0);
  return (
    <CandidateTagsProvider
      companyId={props.companyId}
      locale={props.locale}
      onChanged={() => setTagRefresh((current) => current + 1)}
    >
      <TalentBankContent {...props} tagRefresh={tagRefresh} />
    </CandidateTagsProvider>
  );
}

function TalentBankContent({ tagRefresh, locale = 'pt-BR', companyId, navigateDashboard, canAdmitCandidate = false }) {
  const { promptForm, toast, notice, confirm } = useAppFeedback();
  const { admit, busyId: admissionBusyId } = useEmployeeAdmission({ locale, onAdmitted: result => navigateDashboard?.({tab:'team',candidate:result.candidateId,roster:'internal',section:'summary',returnTab:null}) });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [error, setError] = useState('');
  const [q, setQ] = useListUrlState('talent', 'q', '');
  const [qDraft, setQDraft] = useListSearchDraft(q);
  const [vacancyId, setVacancyId] = useListUrlState('talent', 'vacancyId', '');
  const [stage, setStage] = useListUrlState('talent', 'stage', '');
  const [topType, setTopType] = useListUrlState('talent', 'topType', '');
  const [tagFilters, setTagFilters] = useListUrlState('talent', 'tagFilters', { tagIds: [], tagMode: 'any' });
  const tagIdsKey = tagFilters.tagIds.join(',');
  const [page, setPage] = useListUrlState('talent', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('talent', 'pageSize', 20);
  const [sort, setSort] = useListUrlState('talent', 'sort', 'lastActivityAt');
  const [sortDir, setSortDir] = useListUrlState('talent', 'sortDir', 'desc');
  const [vacancyOptions, setVacancyOptions] = useState([]);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);

  const loadVacancies = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/vacancies?pageSize=50&page=1');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const list = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.vacancies)
          ? data.vacancies
          : [];
      setVacancyOptions(list);
    } catch {
      /* filter stays empty */
    }
  }, []);

  const load = useCallback(async (signal) => {
    if (!companyId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        sortDir,
        companyId: String(companyId),
      });
      qs.set('tagIds', tagIdsKey); qs.set('tagMode', tagFilters.tagMode);
      if (q) qs.set('q', q);
      if (vacancyId) qs.set('vacancyId', vacancyId);
      if (stage) qs.set('stage', stage);
      if (topType) qs.set('topType', topType);
      const res = await fetch(`/api/admin/talent-bank?${qs.toString()}`, { signal });
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.talentBank.loadFailed'));
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e?.message || t(locale, 'panel.common.error'));
      setItems([]);
      setTotal(0);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [companyId, page, pageSize, sort, sortDir, q, vacancyId, stage, topType, locale, tagIdsKey, tagFilters.tagMode]);

  useEffect(() => {
    loadVacancies();
  }, [loadVacancies]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, tagRefresh]);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    // Prefer desc for activity dates on first click.
    const dir =
      columnKey === 'lastActivityAt' && sort !== columnKey ? 'desc' : nextDir;
    setSort(columnKey);
    setSortDir(dir);
    setPage(1);
  };

  const applySearch = () => {
    setQ(qDraft.trim());
    setPage(1);
  };

  const runAbsenceDiagnose = async () => {
    const query = String(q || qDraft || '').trim();
    if (!query || diagnoseBusy) return;
    setDiagnoseBusy(true);
    try {
      const res = await fetch('/api/admin/help-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          list: ABSENCE_LIST.TALENT_BANK,
          pipeline: stage || null,
          vacancyId: vacancyId ? Number(vacancyId) : null,
          topType: topType ? Number(topType) : null,
          explain: true,
          locale,
          ...(companyId ? { companyId: Number(companyId) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t(locale, 'panel.talentBank.diagnoseError'));
      }
      const reasonLines = formatAbsenceReasonLines(locale, data.reasons, {
        stageLabel: (s) => stageLabel(locale, s),
      }).join('\n');
      const candidateLines = (data.candidates || [])
        .slice(0, 4)
        .map((c) => `· ${c.name || ''}`)
        .join('\n');
      await notice({
        title: t(locale, 'panel.talentBank.diagnoseTitle'),
        message: [
          formatAbsenceExplanation(locale, data.explanation),
          reasonLines || t(locale, 'panel.talentBank.diagnoseNoReasons'),
          candidateLines
            ? `\n${t(locale, 'panel.talentBank.diagnoseFoundPeople')}\n${candidateLines}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      const canClear = vacancyId || stage || topType;
      if (canClear && (data.suggestions || []).some((s) => s.action === ABSENCE_SUGGESTION.CLEAR_FILTERS)) {
        const accepted = await confirm({
          title: t(locale, 'panel.team.diagnoseClearFiltersTitle'),
          message: t(locale, 'panel.team.diagnoseClearFiltersBody'),
          confirmLabel: t(locale, 'panel.team.diagnoseClearFilters'),
        });
        if (accepted) {
          setVacancyId('');
          setStage('');
          setTopType('');
          setTagFilters({ tagIds: [], tagMode: 'any' });
          setPage(1);
        }
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.talentBank.diagnoseError'), 'error');
    } finally {
      setDiagnoseBusy(false);
    }
  };

  const addToVacancy = async (candidateId, personName) => {
    const cid = Number(candidateId);
    if (!Number.isFinite(cid)) return;
    try {
      const searchQs = new URLSearchParams();
      if (companyId) searchQs.set('companyId', String(companyId));
      const values = await promptForm({
        title: t(locale, 'panel.team.addToVacancyTitle', { name: personName || '' }),
        confirmLabel: t(locale, 'panel.team.addToVacancyConfirm'),
        fields: [
          {
            key: 'vacancyId',
            type: 'entitySearch',
            label: t(locale, 'panel.team.addToVacancyPick'),
            searchUrl: `/api/admin/vacancies/search${searchQs.toString() ? `?${searchQs}` : ''}`,
            minChars: 0,
            placeholder: t(locale, 'panel.team.addToVacancySearchPh'),
            defaultValue: '',
          },
        ],
      });
      if (!values) return;
      const vid = String(values.vacancyId || '').trim();
      if (!vid) {
        toast(t(locale, 'panel.team.addToVacancyNeedVacancy'), 'error');
        return;
      }
      const post = await fetch(`/api/admin/vacancies/${encodeURIComponent(vid)}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: cid }),
      });
      const postData = await post.json().catch(() => ({}));
      if (!post.ok) throw new Error(postData?.error || t(locale, 'panel.common.error'));
      toast(
        postData?.alreadyLinked
          ? t(locale, 'panel.team.addToVacancyAlready')
          : t(locale, 'panel.team.addToVacancyOk'),
        'ok'
      );
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    }
  };
;

  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(localeHtmlLang(locale), {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return '—';
    }
  };

  if (!companyId) {
    return (
      <EmptyState
        title={t(locale, 'panel.talentBank.needCompanyTitle')}
        message={t(locale, 'panel.talentBank.needCompanyBody')}
      />
    );
  }

  return (
    <div className={S.stack}>
      <AdminPageHeader
        title={t(locale, 'panel.talentBank.title')}
        subtitle={t(locale, 'panel.talentBank.intro')}
      />

      <AdminListFilters
        aria-label={t(locale, 'panel.talentBank.title')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          setQ('');
          setVacancyId('');
          setStage('');
          setTopType('');
          setTagFilters({ tagIds: [], tagMode: 'any' });
          setPage(1);
        }}
        clearEnabled={Boolean(
          String(qDraft || '').trim() || q || vacancyId || stage || topType || tagFilters.tagIds.length || tagFilters.tagMode === 'none'
        )}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={() => applySearch()}
          placeholder={t(locale, 'panel.talentBank.searchPh')}
          className="min-w-[200px] flex-1"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.talentBank.filterVacancy')}
          value={vacancyId}
          onChange={(v) => {
            setVacancyId(v);
            setPage(1);
          }}
        >
          <option value="">{t(locale, 'panel.talentBank.allVacancies')}</option>
          {vacancyOptions.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {v.title || `#${v.id}`}
            </option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.talentBank.filterStage')}
          value={stage}
          onChange={(v) => {
            setStage(v);
            setPage(1);
          }}
        >
          <option value="">{t(locale, 'panel.talentBank.allStages')}</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(locale, s)}
            </option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.talentBank.filterType')}
          value={topType}
          onChange={(v) => {
            setTopType(v);
            setPage(1);
          }}
        >
          <option value="">{t(locale, 'panel.talentBank.allTypes')}</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={String(n)}>
              T{n}
            </option>
          ))}
        </AdminListFilterSelect>
        <CandidateTagFilters value={tagFilters} locale={locale} onChange={(value) => { setTagFilters(value); setPage(1); }} />
      </AdminListFilters>

      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {loading ? (
        <AppLoading locale={locale} variant="panel" label={t(locale, 'common.loading')} />
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title={
            q
              ? t(locale, 'panel.talentBank.emptySearchTitle')
              : t(locale, 'panel.talentBank.emptyTitle')
          }
          message={
            q
              ? t(locale, 'panel.talentBank.emptySearchBody')
              : t(locale, 'panel.talentBank.emptyBody')
          }
          actionLabel={q ? t(locale, 'panel.talentBank.diagnoseCta') : undefined}
          onAction={q ? runAbsenceDiagnose : undefined}
          actionDisabled={diagnoseBusy}
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <>
          <p className={cn(S.faint, 'm-0')}>
            {t(locale, 'panel.talentBank.count', { n: total })}
          </p>
          <AdminTableShell locale={locale} minWidth="56rem" animKey={`${q}|${vacancyId}|${stage}|${topType}|${page}|${pageSize}`}>
              <thead>
                <tr className="border-b border-ink/10 bg-canvas/80">
                  <SortableTh
                    columnKey="name"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colName')}
                  </SortableTh>
                  <SortableTh
                    columnKey="email"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colEmail')}
                  </SortableTh>
                  <SortableTh
                    columnKey="vacancy"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colVacancy')}
                  </SortableTh>
                  <SortableTh
                    columnKey="stage"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colStage')}
                  </SortableTh>
                  <SortableTh
                    columnKey="type"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colType')}
                  </SortableTh>
                  <SortableTh
                    columnKey="lastActivityAt"
                    sortKey={sort}
                    dir={sortDir}
                    onSort={toggleSort}
                  >
                    {t(locale, 'panel.talentBank.colActivity')}
                  </SortableTh>
                  <AdminActionsTh>{t(locale, 'panel.talentBank.colActions')}</AdminActionsTh>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-ink/6 align-middle last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{row.fullName || '—'}</div>
                      <div className="font-mono text-2xs text-ink-faint">#{row.id}</div>
                      <CandidateTags candidateId={row.id} name={row.fullName} tags={row.tags || []} locale={locale} />
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-muted">{row.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink">
                      {row.vacancyTitle || (row.vacancyId ? `#${row.vacancyId}` : '—')}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-muted">
                      {stageLabel(locale, row.stage)}
                    </td>
                    <td className="px-4 py-3">
                      {row.topType ? (
                        <TypeBadge type={row.topType} locale={locale} compact />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">
                      {formatDate(row.lastActivityAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AdminActionsCell>
                        {canAdmitCandidate && row.employmentStatus === 'candidate' ? <button type="button" className={S.btnGhost} disabled={Boolean(admissionBusyId)} onClick={() => admit(row.id)}>{t(locale,'employeeAdmission.action')}</button> : null}
                        <AdminIconButton
                          onClick={() => navigateDashboard?.({ tab: 'team', candidate: row.id, section: 'profile', returnTab: 'talent-bank', clientOnly: true })}
                          label={t(locale, 'panel.talentBank.openPerson')}
                          icon="team"
                        />
                        <AdminIconButton
                          label={t(locale, 'panel.team.addToVacancyBtn')}
                          icon="briefcase"
                          onClick={() => addToVacancy(row.id, row.fullName)}
                        />
                      </AdminActionsCell>
                    </td>
                  </tr>
                ))}
              </tbody>
          </AdminTableShell>

          <AdminListPager
            locale={locale}
            page={page}
            pageSize={pageSize}
            total={total}
            pageSizeOptions={PAGE_SIZE_OPTIONS.filter((n) => n <= 50)}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
