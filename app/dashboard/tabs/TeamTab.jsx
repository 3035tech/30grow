'use client';
import { CandidateOrgUnit, OrgUnitFilter } from '../../_components/OrgUnitField';

import { SelectField } from '../../_components/SelectField';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { TYPE_DATA } from '../../../lib/data';
import { t, localeHtmlLang, contentLocale, t as i18nT } from '../../../lib/i18n';
import { C } from '../../../lib/theme';
import { AdminListSearch, AdminCreateButton, PanelSubNav, S, TypeBadge } from '../dashboard-shared';
import { AdminListFilters } from '../../_components/AdminListFilters';
import { BrStateSelect } from '../../_components/BrStateSelect';
import { BrCitySelect } from '../../_components/BrCitySelect';
import { DateField } from '../../_components/DateField';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { formatPhoneBr, formatSalaryBr, stripPhone, salaryToCentsDigits, stripSalary, digitsOnly } from '../../../lib/br-masks';
import { titleCasePersonName } from '../../../lib/person-name';
import { rejectionReasonLabel } from '../pipeline-prompts';
import { usePipelineExtras } from '../PipelineExtrasContext';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AdminRichFormDrawer } from '../../_components/AdminRichFormDrawer';
import { EnneagramCross } from '../../_components/EnneagramCross';
import { RowActionsMenu } from '../../_components/RowActionsMenu';
import { TypeScoreChart } from '../../_components/TypeScoreChart';
import { CompensationBlock } from '../../_components/CompensationBlock';
import { BenefitAssignmentsBlock } from '../../_components/BenefitAssignmentsBlock';
import { DpBlock } from '../../_components/DpBlock';
import { CandidateRegistrationBlock } from '../../_components/CandidateRegistrationBlock';
import { OrgManagerBlock } from '../../_components/OrgManagerBlock';
import { ContinuousFeedbackBlock } from '../../_components/ContinuousFeedbackBlock';
import { PeopleManagementPanel } from '../../_components/PeopleManagementPanel';
import { HrActionBrief } from '../../_components/HrActionBrief';
import { PersonDossierBlock } from '../../_components/PersonDossierBlock';
import { CandidateTimeline } from '../../_components/CandidateTimeline';
import { CandidateCvBlock } from '../../_components/CandidateCvBlock';
import { FormField, formFieldGrowClass, formFieldRowClass } from '../../_components/FormField';
import { RichTextEditor } from '../../_components/RichTextEditor';
import { RichTextView } from '../../_components/RichTextView';
import { HrScoreBadge } from '../../_components/HrScoreBadge';
import { MotivatorsRadarChart } from '../../_components/MotivatorsRadarChartLazy';
import { InlineCallout } from '../../_components/InlineCallout';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { useRehireEmployee } from '../../_components/useRehireEmployee';
import { formatDisplayDate } from '../../../lib/format-display-date.js';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { isRichTextEmpty } from '../../../lib/sanitize-html';
import { clusterCloseTypes, rankEnneagramScores } from '../../../lib/enneagram-cross';
import { buildProfileSynthesis } from '../../../lib/profile-synthesis';
import { EMPLOYMENT_STATUS, ROSTER_SCOPE } from '../../../lib/domain-status.js';
import { PIPELINE_STAGE, PIPELINE_STAGES } from '../../../lib/pipeline';
import { DB_FANOUT_CONCURRENCY, mapWithConcurrency } from '../../../lib/concurrency';
import {
  ABSENCE_SUGGESTION,
  formatAbsenceExplanation,
} from '../../../lib/people/list-absence-diagnostics-core.js';

function nearbyCluster(scores) {
  return clusterCloseTypes(rankEnneagramScores(scores));
}

function NearbyTypeBadges({ scores, topType, locale }) {
  const extras = nearbyCluster(scores).filter((item) => item.type !== topType);
  if (extras.length === 0) return null;
  return extras.map((item) => <TypeBadge key={item.type} type={item.type} locale={locale} compact />);
}

function IntegratedProfileSynthesis({ synthesis, locale, summaryOnly = false }) {
  if (!synthesis || synthesis.completeness === 'empty') return summaryOnly ? <section><h3 className={S.label}>{t(locale, 'panel.team.synthesisTitle')}</h3><p className={S.muted}>{t(locale, 'panel.team.briefEmpty')}</p></section> : null;
  const actions = Array.isArray(synthesis.conversationActions)
    ? synthesis.conversationActions
    : [];
  const sections = [
    ['convergences', 'panel.team.synthesisConvergences'],
    ['tensions', 'panel.team.synthesisTensions'],
    ['howToLead', 'panel.team.synthesisHowToLead'],
    ['pdiIdeas', 'panel.team.synthesisPdiIdeas'],
  ].filter(([key]) => synthesis[key]?.length);

  return (
    <section className="mb-4 rounded-control border border-ink/12 bg-brand-500/[0.06] p-3.5">
      <h3 className={cn(S.sectionTitle, 'mb-2 mt-0')}>{t(locale, summaryOnly ? 'panel.team.synthesisTitle' : 'panel.team.briefPrepareTitle')}</h3>
      {!summaryOnly ? <p className="mb-2 mt-0 font-ui text-prose leading-snug text-ink/75">
        {t(locale, 'panel.team.briefPrepareHint')}
      </p> : null}
      <p className="mb-3 mt-0 font-ui text-sm leading-snug text-ink">
        {synthesis.headline}
      </p>
      {!summaryOnly && actions.length > 0 ? (
        <ol className="mb-3 mt-0 list-decimal space-y-2 pl-5 text-prose leading-snug text-ink">
          {actions.map((a) => (
            <li key={`${a.source}-${a.text}`}>
              <span className="text-ink">{a.text}</span>
              {a.sourceLabel ? (
                <span className="ml-1.5 font-ui text-prose text-ink/75">
                  · {a.sourceLabel}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {sections.length > 0 ? (
        <CollapsibleBlock
          locale={locale}
          title={t(locale, 'panel.team.synthesisDetailsTitle')}
          defaultOpen={summaryOnly}
          count={sections.length}
          bordered={false}
          className="border-t border-ink/10 pt-2"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {sections.map(([key, labelKey]) => (
              <div key={key}>
                <span className="font-ui text-prose normal-case tracking-normal text-ink/75">
                  {t(locale, labelKey)}
                </span>
                <ul className="mb-0 mt-1.5 list-disc pl-[18px] text-prose leading-snug text-ink-muted">
                  {synthesis[key].map((item) => <li key={item} className="mb-1">{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleBlock>
      ) : null}
    </section>
  );
}

const PIPELINE_OPTIONS = PIPELINE_STAGES;
const PERSON_TOP_SECTIONS = new Set(['people', 'style', 'history', 'profile']);
const PERSON_MANAGEMENT_SECTIONS = new Set(['summary', 'oneOnOne', 'feedback', 'journey', 'compensation', 'dp']);

function personNavigationFromSection(section) {
  if (section === 'profile') return { personTab: 'people', peopleSubTab: 'dp' };
  if (PERSON_TOP_SECTIONS.has(section)) {
    return { personTab: section, peopleSubTab: 'summary' };
  }
  if (PERSON_MANAGEMENT_SECTIONS.has(section)) {
    return { personTab: 'people', peopleSubTab: section };
  }
  return { personTab: 'people', peopleSubTab: 'summary' };
}


function fitBandLabel(locale, code) {
  const map = {
    high: 'recruiting.fitHigh',
    medium: 'recruiting.fitMedium',
    low: 'recruiting.fitLow',
  };
  const key = map[code];
  return key ? t(locale, key) : code;
}

function pipelineLabel(locale, code) {
  const map = {
    [PIPELINE_STAGE.NEW]: 'recruiting.pipelineNew',
    [PIPELINE_STAGE.INTERVIEW]: 'recruiting.pipelineInterview',
    [PIPELINE_STAGE.TEST_COMPLETED]: 'recruiting.pipelineTestCompleted',
    [PIPELINE_STAGE.SCREENING]: 'recruiting.pipelineScreening',
    [PIPELINE_STAGE.APPROVED]: 'recruiting.pipelineApproved',
    [PIPELINE_STAGE.HIRED]: 'recruiting.pipelineHired',
    [PIPELINE_STAGE.REJECTED]: 'recruiting.pipelineRejected',
    [PIPELINE_STAGE.ARCHIVED]: 'recruiting.pipelineArchived',
  };
  return t(locale, map[code] || 'recruiting.pipelineNew');
}

/** Formata ms → "Xm Ys" / "Xh Ym" para telemetria admin. */
function formatFillDuration(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  const totalSec = Math.max(0, Math.round(Number(ms) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 54 perguntas: < ~3 min é bem rápido (sinal soft). */
function isSuspiciouslyFast(ms) {
  return ms != null && Number.isFinite(Number(ms)) && Number(ms) < 3 * 60 * 1000;
}

function availabilityLabel(locale, code) {
  const map = {
    immediate: 'recruiting.availabilityImmediate',
    '15_days': 'recruiting.availability15',
    '30_days': 'recruiting.availability30',
    '60_days': 'recruiting.availability60',
    other: 'recruiting.availabilityOther',
  };
  return code ? t(locale, map[code] || 'recruiting.availabilityOther') : null;
}

function sourceLabel(locale, code) {
  const map = {
    linkedin: 'recruiting.sourceLinkedin',
    referral: 'recruiting.sourceReferral',
    agency: 'recruiting.sourceAgency',
    job_board: 'recruiting.sourceJobBoard',
    other: 'recruiting.sourceOther',
  };
  return code ? t(locale, map[code] || 'recruiting.sourceOther') : null;
}

const emptyProfileDraft = () => ({
  phone: '',
  linkedinUrl: '',
  city: '',
  state: '',
  salaryExpectation: '',
  availability: '',
  source: '',
  birthDate: '',
});

function profileFromCandidate(c) {
  const birth =
    c?.birthDate != null
      ? String(c.birthDate).slice(0, 10)
      : '';
  return {
    phone: stripPhone(c?.phone) || '',
    linkedinUrl: c?.linkedinUrl || '',
    city: c?.city || '',
    state: c?.state || '',
    salaryExpectation: salaryToCentsDigits(c?.salaryExpectation),
    availability: c?.availability || '',
    source: c?.source || '',
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : '',
  };
}

export function TeamTab({
  results,
  sortKey,
  sortDir,
  onSort,
  locale = 'pt-BR',
  isAdmin = false,
  companyId = null,
  search = '',
  orgUnitFilter = '',
  onSearch,
  listTotal = 0,
  focusCandidateId = null,
  focusSection = null,
  listFilter = null,
  onClearListFilter = null,
  navigateDashboard = null,
  roster = ROSTER_SCOPE.INTERNAL,
  pipelineFilter = null,
  canViewCompensation = false,
  canManageCompensation = false,
  canViewJobRoles = false,
  canRehire = false,
}) {
  const [open, setOpen] = useState(null);
  const [personTab, setPersonTab] = useState('people');
  const [peopleSubTab, setPeopleSubTab] = useState('summary');
  const [searchDraft, setSearchDraft] = useState(search || '');
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [stageBusy, setStageBusy] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesMsg, setNotesMsg] = useState('');
  const [notesMsgIsError, setNotesMsgIsError] = useState(false);
  const [profileDraft, setProfileDraft] = useState(emptyProfileDraft);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileMsgIsError, setProfileMsgIsError] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStage, setBulkStage] = useState(PIPELINE_STAGE.TEST_COMPLETED);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkMsgIsError, setBulkMsgIsError] = useState(false);
  const [stageOverrides, setStageOverrides] = useState({});
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [createEmployeeBusy, setCreateEmployeeBusy] = useState(false);
  const { requestPipelineExtras } = usePipelineExtras();
  const { confirm, notice, promptForm, toast } = useAppFeedback();
  const detailReqRef = useRef(null);
  const detailIdRef = useRef(null);
  detailIdRef.current = detail?.candidate?.id ?? null;
  const { rehire, busyId: rehireBusyId } = useRehireEmployee({ locale, companyId });

  const rehirePerson = async ({ candidateId, name, exitDate }) => {
    const ok = await rehire({ candidateId, name: titleCasePersonName(name), exitDate });
    if (!ok) return;
    setDetail((d) => (d?.candidate?.id === candidateId
      ? { ...d, candidate: { ...d.candidate, employmentStatus: EMPLOYMENT_STATUS.EMPLOYEE } }
      : d));
    router.refresh();
  };

  const createEmployeeDirect = async () => {
    if (!companyId || createEmployeeBusy) return;
    const values = await promptForm({
      title: t(locale, 'panel.team.addEmployeeTitle'),
      message: t(locale, 'panel.team.addEmployeeHint'),
      confirmLabel: t(locale, 'panel.team.addEmployeeConfirm'),
      fields: [
        {
          key: 'fullName',
          label: t(locale, 'panel.team.addEmployeeName'),
          required: true,
          defaultValue: '',
        },
        {
          key: 'email',
          label: t(locale, 'panel.team.addEmployeeEmail'),
          required: true,
          defaultValue: '',
        },
        {
          key: 'startDate',
          type: 'date',
          label: t(locale, 'panel.team.addEmployeeStartDate'),
          defaultValue: new Date().toISOString().slice(0, 10),
        },
        {
          key: 'sendAccessInvite',
          type: 'boolean',
          label: t(locale, 'panel.team.addEmployeeInvite'),
          help: t(locale, 'panel.team.addEmployeeInviteHelp'),
          defaultValue: true,
        },
      ],
    });
    if (!values) return;
    setCreateEmployeeBusy(true);
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          fullName: titleCasePersonName(values.fullName),
          email: String(values.email || '').trim().toLowerCase(),
          startDate: values.startDate || null,
          sendAccessInvite: Boolean(values.sendAccessInvite),
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.team.addEmployeeError'));
      if (values.sendAccessInvite && !data.inviteSent) {
        toast(t(locale, 'panel.team.addEmployeeOkInviteFailed'), 'warning');
      } else {
        toast(
          data.inviteSent
            ? t(locale, 'panel.team.addEmployeeOkInvite')
            : t(locale, 'panel.team.addEmployeeOk'),
          'ok'
        );
      }
      if (typeof navigateDashboard === 'function' && data.candidateId) {
        navigateDashboard({
          tab: 'team',
          roster: ROSTER_SCOPE.INTERNAL,
          candidate: data.candidateId,
          search: null,
        });
      } else {
        router.refresh();
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.team.addEmployeeError'), 'error');
    } finally {
      setCreateEmployeeBusy(false);
    }
  };

  useEffect(() => { setSelectedIds(new Set()); setStageOverrides({}); }, [results]);

  useEffect(() => {
    setSearchDraft(search || '');
  }, [search]);

  useEffect(() => {
    if (!focusCandidateId) {
      setOpen(null);
      detailReqRef.current = null;
      setDetail(null);
      setDetailErr('');
      return;
    }
    const cid = String(focusCandidateId);
    const match = (results || []).find((r) => String(r.candidateId) === cid);
    setOpen(match?.assessmentId != null ? String(match.assessmentId) : `candidate:${cid}`);
    loadDetail(cid);
  }, [focusCandidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextNavigation = personNavigationFromSection(focusSection);
    setPersonTab(nextNavigation.personTab);
    setPeopleSubTab(nextNavigation.peopleSubTab);
  }, [focusSection]);

  useEffect(() => {
    if (!focusCandidateId || !detail?.candidate) return;
    if (String(detail.candidate.id) !== String(focusCandidateId)) return;
    const match = (results || []).find((r) => String(r.candidateId) === String(focusCandidateId));
    if (match?.assessmentId != null) {
      setOpen(String(match.assessmentId));
      return;
    }
    const aid = detail.assessments?.[0]?.id;
    setOpen(aid != null ? String(aid) : `candidate:${detail.candidate.id}`);
  }, [detail, focusCandidateId, results]);

  const commitSearch = (next) => {
    const trimmed = String(next != null ? next : searchDraft).trim();
    if (trimmed === (search || '').trim()) return;
    if (typeof onSearch === 'function') onSearch(trimmed || null);
  };

  const clearActiveSearch = () => {
    setSearchDraft('');
    if (typeof onSearch === 'function') onSearch(null);
  };

  const reasonLabel = (code) => {
    const key = `panel.team.diagnoseReason.${code}`;
    const label = t(locale, key);
    return label === key ? code : label;
  };

  const runAbsenceDiagnose = async () => {
    const q = String(search || searchDraft || '').trim();
    if (!q || diagnoseBusy) return;
    setDiagnoseBusy(true);
    try {
      const res = await fetch('/api/admin/help-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q,
          roster: roster || ROSTER_SCOPE.INTERNAL,
          listFilter: listFilter || null,
          pipeline: pipelineFilter || null,
          explain: true,
          locale,
          ...(companyId ? { companyId: Number(companyId) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t(locale, 'panel.team.diagnoseError'));
      }
      const reasonLines = (data.reasons || [])
        .map((r) => `· ${reasonLabel(r.code)}`)
        .join('\n');
      const candidateLines = (data.candidates || [])
        .slice(0, 4)
        .map((c) => {
          const status = c.employmentStatus
            ? t(locale, `panel.team.employment.${c.employmentStatus}`)
            : '';
          return `· ${c.name}${status ? ` (${status})` : ''}`;
        })
        .join('\n');
      const bodyParts = [
        formatAbsenceExplanation(locale, data.explanation),
        reasonLines || t(locale, 'panel.team.diagnoseNoReasons'),
        candidateLines
          ? `\n${t(locale, 'panel.team.diagnoseFoundPeople')}\n${candidateLines}`
          : '',
      ].filter(Boolean);
      await notice({
        title: t(locale, 'panel.team.diagnoseTitle'),
        message: bodyParts.join('\n'),
        tone: 'info',
      });

      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      for (const s of suggestions) {
        if (s.action === ABSENCE_SUGGESTION.SWITCH_ROSTER && s.roster && typeof navigateDashboard === 'function') {
          const ok = await confirm({
            title: t(locale, 'panel.team.diagnoseSuggestRosterTitle'),
            message: t(locale, 'panel.team.diagnoseSuggestRosterBody', {
              roster:
                s.roster === ROSTER_SCOPE.RECRUITING
                  ? t(locale, 'dashboard.rosterRecruiting')
                  : s.roster === ROSTER_SCOPE.ALUMNI
                    ? t(locale, 'dashboard.rosterAlumni')
                    : s.roster === ROSTER_SCOPE.ALL
                      ? t(locale, 'dashboard.rosterAll')
                      : t(locale, 'dashboard.rosterInternal'),
            }),
            confirmLabel: t(locale, 'panel.team.diagnoseSwitchRoster'),
          });
          if (ok) {
            navigateDashboard({ tab: 'team', roster: s.roster, search: q });
          }
          break;
        }
        if (s.action === ABSENCE_SUGGESTION.OPEN_PERSON && s.candidateId && typeof navigateDashboard === 'function') {
          const person = (data.candidates || []).find((c) => Number(c.id) === Number(s.candidateId));
          const ok = await confirm({
            title: t(locale, 'panel.team.diagnoseSuggestOpenTitle'),
            message: t(locale, 'panel.team.diagnoseSuggestOpenBody', {
              name: person?.name || `#${s.candidateId}`,
            }),
            confirmLabel: t(locale, 'panel.team.diagnoseOpenPerson'),
          });
          if (ok) {
            navigateDashboard({
              tab: 'team',
              candidate: s.candidateId,
              search: null,
              roster: person?.inRecruiting && !person?.inInternal
                ? ROSTER_SCOPE.RECRUITING
                : roster,
            });
          }
          break;
        }
        if (s.action === ABSENCE_SUGGESTION.CLEAR_FILTERS && typeof navigateDashboard === 'function') {
          toast(t(locale, 'panel.team.diagnoseHintClearFilters'), 'info');
          break;
        }
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.team.diagnoseError'), 'error');
    } finally {
      setDiagnoseBusy(false);
    }
  };

  const sortColumns = [
    { k: 'createdAt', labelKey: 'panel.team.sortDate' },
    { k: 'name', labelKey: 'panel.team.sortName' },
    { k: 'area', labelKey: 'panel.team.sortArea' },
    { k: 'type', labelKey: 'panel.team.sortProfileType' },
    { k: 'vacancy', labelKey: 'panel.team.sortVacancy' },
    { k: 'pipeline', labelKey: 'recruiting.pipelineShort' },
  ];

  /** `silent`: after a save, keep the open person mounted (no skeleton, child blocks keep state). */
  const loadDetail = useCallback(async (candidateId, { silent = false } = {}) => {
    const reqKey = String(candidateId);
    detailReqRef.current = reqKey;
    if (!silent) {
      setDetailLoading(true);
      setDetailErr('');
      setDetail(null);
      setNotesEditing(false);
      setNotesMsg('');
      setProfileEditing(false);
      setProfileMsg('');
    }
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}?locale=${encodeURIComponent(contentLocale(locale))}`);
      const data = await res.json().catch(() => ({}));
      if (detailReqRef.current !== reqKey) return;
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.team.loadDetailError'));
      setDetail(data);
      if (!silent) {
        setNotesDraft(data?.candidate?.hrNotes || '');
        setProfileDraft(profileFromCandidate(data?.candidate));
      }
    } catch (e) {
      if (detailReqRef.current !== reqKey) return;
      if (silent) {
        toast(e?.message || t(locale, 'panel.common.error'), 'error');
        return;
      }
      setDetailErr(e?.message || t(locale, 'panel.common.error'));
      setDetail(null);
    } finally {
      if (!silent && detailReqRef.current === reqKey) setDetailLoading(false);
    }
  }, [locale, toast]);
  const reloadDetailSilently = useCallback(() => {
    const id = detailIdRef.current;
    if (id) return loadDetail(id, { silent: true });
    return undefined;
  }, [loadDetail]);

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
      const vacancyId = String(values.vacancyId || '').trim();
      if (!vacancyId) {
        toast(t(locale, 'panel.team.addToVacancyNeedVacancy'), 'error');
        return;
      }
      const post = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: cid }),
      });
      const postData = await post.json().catch(() => ({}));
      if (!post.ok) throw new Error(postData?.error || t(locale, 'panel.common.error'));
      toast(
        postData.alreadyLinked
          ? t(locale, 'panel.team.addToVacancyAlready')
          : t(locale, 'panel.team.addToVacancyOk'),
        'ok'
      );
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    }
  };

  const recalculateHrScore = async (candidateId) => {
    try {
      const res = await fetch('/api/admin/hr-score/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'hrScore.recalculateFailed'));
      toast(t(locale, 'hrScore.recalculated'), 'ok');
      router.refresh();
    } catch (e) {
      toast(e instanceof TypeError ? t(locale, 'hrScore.recalculateFailed') : e?.message || t(locale, 'hrScore.recalculateFailed'), 'error');
    }
  };

  const deleteCandidate = async (candidateId, name) => {
    const id = String(candidateId || '').trim();
    if (!id) return;
    const ok = await confirm({
      message: t(locale, 'panel.team.confirmDeletePerson', { name }),
      danger: true,
      confirmLabel: t(locale, 'panel.common.confirmAction'),
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.team.deletePersonError'));
      router.refresh();
    } catch (e) {
      await notice({ message: e?.message || t(locale, 'panel.team.deletePersonError'), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const deleteAssessment = async (assessmentId) => {
    const ok = await confirm({
      message: t(locale, 'recruiting.allowRetake') + t(locale, 'panel.team.allowRetakeConfirmSuffix'),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/assessments/${encodeURIComponent(assessmentId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      router.refresh();
      await reloadDetailSilently();
    } catch (e) {
      await notice({ message: e?.message || t(locale, 'panel.common.error'), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const patchPipeline = async (assessmentId, pipelineStage) => {
    const extras = await requestPipelineExtras(locale, pipelineStage);
    if (extras == null) return;
    setStageBusy(String(assessmentId));
    try {
      const res = await fetch(`/api/admin/assessments/${encodeURIComponent(assessmentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStage, ...extras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      router.refresh();
      await reloadDetailSilently();
    } catch (e) {
      await notice({ message: e?.message || t(locale, 'panel.common.error'), tone: 'error' });
    } finally {
      setStageBusy(null);
    }
  };

  const saveNotes = async () => {
    if (!detail?.candidate?.id) return;
    setNotesBusy(true);
    setNotesMsg('');
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(detail.candidate.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hrNotes: notesDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setDetail((prev) => prev ? { ...prev, candidate: { ...prev.candidate, hrNotes: data.hrNotes } } : prev);
      setNotesEditing(false);
      setNotesMsgIsError(false);
      setNotesMsg(t(locale, 'panel.team.notesSaved'));
      setTimeout(() => setNotesMsg(''), 3000);
    } catch (e) {
      setNotesMsgIsError(true);
      setNotesMsg(e?.message || t(locale, 'panel.team.saveNotesError'));
    } finally {
      setNotesBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!detail?.candidate?.id) return;
    setProfileBusy(true);
    setProfileMsg('');
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(detail.candidate.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: profileDraft.phone,
          linkedinUrl: profileDraft.linkedinUrl,
          city: profileDraft.city,
          state: profileDraft.state,
          salaryExpectation: stripSalary(profileDraft.salaryExpectation),
          availability: profileDraft.availability || null,
          source: profileDraft.source || null,
          birthDate: profileDraft.birthDate || null,
          hrNotes: notesDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setDetail((prev) => (prev ? {
        ...prev,
        candidate: {
          ...prev.candidate,
          phone: data.phone,
          linkedinUrl: data.linkedinUrl,
          city: data.city,
          state: data.state,
          salaryExpectation: data.salaryExpectation,
          availability: data.availability,
          source: data.source,
          hrNotes: data.hrNotes !== undefined ? data.hrNotes : prev.candidate.hrNotes,
        },
      } : prev));
      setProfileDraft(profileFromCandidate(data));
      setNotesDraft(data.hrNotes !== undefined ? (data.hrNotes || '') : notesDraft);
      setProfileEditing(false);
      setNotesEditing(false);
      setProfileMsgIsError(false);
      setProfileMsg(t(locale, 'recruiting.profileSaved'));
      setTimeout(() => setProfileMsg(''), 3000);
    } catch (e) {
      setProfileMsgIsError(true);
      setProfileMsg(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setProfileBusy(false);
    }
  };

  const toggleSelect = (assessmentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(String(assessmentId))) next.delete(String(assessmentId));
      else next.add(String(assessmentId));
      return next;
    });
  };

  const applyBulk = async () => {
    if (selectedIds.size === 0 || !bulkStage) return;
    const extras = await requestPipelineExtras(locale, bulkStage);
    if (extras == null) return;
    setBulkBusy(true);
    setBulkMsg('');
    try {
      const ids = [...selectedIds];
      const outcomes = await mapWithConcurrency(ids, DB_FANOUT_CONCURRENCY, (id) =>
        fetch(`/api/admin/assessments/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipelineStage: bulkStage, ...extras }),
        }).then((res) => res.ok, () => false)
      );
      const failed = ids.filter((_, i) => !outcomes[i]);
      if (failed.length) {
        // No refresh here: it would reset the selection. Show applied stages locally and
        // keep only the failed rows selected so the manager can retry them.
        const applied = Object.fromEntries(ids.filter((_, i) => outcomes[i]).map((id) => [id, bulkStage]));
        setStageOverrides((prev) => ({ ...prev, ...applied }));
        setSelectedIds(new Set(failed));
        setBulkMsgIsError(true);
        setBulkMsg(t(locale, 'panel.team.bulkUpdateError'));
        return;
      }
      setSelectedIds(new Set());
      setBulkMsgIsError(false);
      setBulkMsg(t(locale, 'panel.team.bulkUpdatedCount', { n: ids.length }));
      setTimeout(() => setBulkMsg(''), 3000);
      router.refresh();
    } catch {
      setBulkMsgIsError(true);
      setBulkMsg(t(locale, 'panel.team.bulkUpdateError'));
    } finally {
      setBulkBusy(false);
    }
  };

  const getEffectiveStage = (r) => stageOverrides[String(r.assessmentId)] ?? r.pipelineStage ?? PIPELINE_STAGE.NEW;

  const filtered = results;
  const activeSearch = (search || '').trim();
  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(String(r.assessmentId)));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((r) => next.delete(String(r.assessmentId)));
      else filtered.forEach((r) => next.add(String(r.assessmentId)));
      return next;
    });
  };

  let openRow = (results || []).find((row) => row.assessmentId != null && String(row.assessmentId) === String(open)) || null;
  if (!openRow && open && detail?.candidate) {
    const a = (detail.assessments || []).find((x) => String(x.id) === String(open))
      || detail.assessments?.[0]
      || null;
    if (String(open) === `candidate:${detail.candidate.id}`) {
      openRow = {
        assessmentId: null,
        candidateId: detail.candidate.id,
        name: detail.candidate.fullName || detail.candidate.email || '',
        scores: null,
        topType: null,
        pipelineStage: null,
      };
    } else if (a) {
      openRow = {
        assessmentId: a.id,
        candidateId: detail.candidate.id,
        name: detail.candidate.fullName || detail.candidate.email || '',
        scores: a.scores,
        topType: a.topType,
        pipelineStage: a.pipelineStage,
      };
    }
  }
  const openCluster = openRow?.scores
    ? new Set(nearbyCluster(openRow.scores).map((item) => item.type))
    : new Set();
  const detailMatchesOpen = detail?.candidate?.id != null
    && String(detail.candidate.id) === String(openRow?.candidateId);
  const synthesis = openRow
    ? buildProfileSynthesis({
        locale,
        topType: openRow.topType,
        scores: openRow.scores,
        motivatorsTop: detailMatchesOpen ? detail?.people?.management?.motivators?.top : null,
      })
    : null;

  const openPersonDetail = (row, section = 'summary') => {
    const id = row.assessmentId != null ? String(row.assessmentId) : `candidate:${row.candidateId}`;
    const nextNavigation = personNavigationFromSection(section);
    if (row.candidateId && typeof navigateDashboard === 'function') {
      // Let the URL switch the drawer into its full-page presentation before
      // setting `open`; otherwise the legacy inline drawer flashes first.
      navigateDashboard({
        tab: 'team',
        candidate: String(row.candidateId),
        section,
        scroll: false,
        clientOnly: true,
      });
      return;
    }

    setOpen(id);
    setPersonTab(nextNavigation.personTab);
    setPeopleSubTab(nextNavigation.peopleSubTab);
    if (row.candidateId) loadDetail(row.candidateId);
    else {
      detailReqRef.current = null;
      setDetail(null);
      setDetailErr('');
    }
  };

  const closePersonDetail = async () => {
    if (profileEditing || notesEditing) {
      const ok = await confirm({
        message: i18nT(locale, 'ui.teamTab.youHaveUnsavedChangesLeave'),
        confirmLabel: i18nT(locale, 'ui.teamTab.leaveProfile'),
      });
      if (!ok) return;
    }
    setOpen(null);
    detailReqRef.current = null;
    setDetail(null);
    setDetailErr('');
    setPersonTab('people');
    setPeopleSubTab('summary');
    if (typeof navigateDashboard === 'function') {
      navigateDashboard({ tab: 'team', candidate: null, section: null, scroll: false, clientOnly: true });
    }
  };

  const navigatePersonSection = (section) => {
    const nextNavigation = personNavigationFromSection(section);
    setPersonTab(nextNavigation.personTab);
    setPeopleSubTab(nextNavigation.peopleSubTab);
    if (openRow?.candidateId && typeof navigateDashboard === 'function') {
      navigateDashboard({
        tab: 'team',
        candidate: String(openRow.candidateId),
        section,
        scroll: false,
        clientOnly: true,
      });
    }
  };

  const personRows = (results || []).filter((row) => row.candidateId);
  const currentPersonIndex = openRow?.candidateId
    ? personRows.findIndex((row) => String(row.candidateId) === String(openRow.candidateId))
    : -1;
  const navigateAdjacentPerson = (direction) => {
    const nextRow = personRows[currentPersonIndex + direction];
    if (!nextRow) return;
    openPersonDetail(nextRow, focusSection || peopleSubTab || 'summary');
  };
  const personHeaderMeta = detailMatchesOpen && detail?.candidate ? (
    <>
      <StatusToneChip tone={detail.candidate.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ? 'success' : 'neutral'}>
        {t(locale, `panel.team.employment.${detail.candidate.employmentStatus}`)}
      </StatusToneChip>
      {openRow?.areaLabel ? <StatusToneChip tone="neutral">{openRow.areaLabel}</StatusToneChip> : null}
      {detail.candidate.email ? <span className="truncate">{detail.candidate.email}</span> : null}
    </>
  ) : null;
  const personHeaderActions = focusCandidateId ? (
    <div className="flex items-center gap-1">
      {currentPersonIndex >= 0 ? (
        <span className="mr-1 hidden whitespace-nowrap font-ui text-prose text-ink/75 sm:inline">
          {currentPersonIndex + 1} / {personRows.length}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => navigateAdjacentPerson(-1)}
        disabled={currentPersonIndex <= 0}
        aria-label={i18nT(locale, 'ui.teamTab.previousPerson')}
        title={i18nT(locale, 'ui.teamTab.previousPerson')}
        className="min-h-touch min-w-touch rounded-control border border-ink/12 bg-transparent px-2 text-lg text-ink-muted transition-colors hover:bg-ink/[0.04] hover:text-ink disabled:cursor-default disabled:opacity-35"
      >
        ←
      </button>
      <button
        type="button"
        onClick={() => navigateAdjacentPerson(1)}
        disabled={currentPersonIndex < 0 || currentPersonIndex >= personRows.length - 1}
        aria-label={i18nT(locale, 'ui.teamTab.nextPerson')}
        title={i18nT(locale, 'ui.teamTab.nextPerson')}
        className="min-h-touch min-w-touch rounded-control border border-ink/12 bg-transparent px-2 text-lg text-ink-muted transition-colors hover:bg-ink/[0.04] hover:text-ink disabled:cursor-default disabled:opacity-35"
      >
        →
      </button>
    </div>
  ) : null;
  const isPersonPage = Boolean(focusCandidateId);

  return (
    <div className="flex flex-col gap-3">
      {!isPersonPage ? (
      <>
      {companyId ? (
        <div className="flex justify-end">
          <AdminCreateButton
            label={t(locale, 'panel.team.addEmployeeBtn')}
            onClick={createEmployeeDirect}
            disabled={createEmployeeBusy}
          />
        </div>
      ) : null}
      <AdminListFilters
        locale={locale}
        aria-label={t(locale, 'panel.team.searchAriaLabel')}
        onClear={() => {
          setSearchDraft('');
          navigateDashboard?.({ search: '', orgUnit: null, teamPage: 1 });
        }}
        clearEnabled={Boolean(orgUnitFilter || activeSearch || String(searchDraft || '').trim())}
      >
        <AdminListSearch
          locale={locale}
          value={searchDraft}
          onChange={setSearchDraft}
          onSubmit={commitSearch}
          placeholder={t(locale, 'dashboard.searchPlaceholder')}
          label={t(locale, 'panel.team.searchAriaLabel')}
          className="min-w-[12rem] max-w-none grow"
        />
        <OrgUnitFilter key={companyId} companyId={companyId} locale={locale} value={orgUnitFilter}
          onChange={(orgUnit) => navigateDashboard?.({ orgUnit: orgUnit || null, teamPage: 1 })} />
        {activeSearch ? (
          <span className="mb-2.5 self-end font-ui text-prose text-ink/75">
            {t(locale, 'panel.team.searchResultsTotal', { n: listTotal })}
          </span>
        ) : null}
      </AdminListFilters>
      {listFilter === 'turnover_risk' ? (
        <InlineCallout
          tone="warning"
          className="text-sm text-ink"
          action={typeof onClearListFilter === 'function' ? (
            <button
              type="button"
              onClick={onClearListFilter}
              className={S.btnGhost}
            >
              {t(locale, 'panel.team.clearListFilter')}
            </button>
          ) : null}
        >
          {t(locale, 'panel.team.filterTurnoverRisk')}
        </InlineCallout>
      ) : null}
      <div
        role="group"
        aria-label={t(locale, 'panel.team.sortAria')}
        className="flex flex-wrap items-center gap-2 rounded-control border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5"
      >
        <label className="flex cursor-pointer items-center gap-1.5 font-ui text-prose text-ink-muted">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label={t(locale, 'panel.team.selectAllPage')}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          {t(locale, 'panel.team.all')}
        </label>
        <span className="font-ui text-prose text-ink/75">
          {t(locale, 'panel.team.sortBy')}
        </span>
        {sortColumns.map(({ k, labelKey }) => {
          const active = sortKey === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSort(k)}
              aria-pressed={active}
              className={cn(
                'min-h-9 cursor-pointer rounded-control border px-3 py-1.5 font-ui text-prose transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35',
                active
                  ? 'border-brand-500/35 bg-brand-500/[0.09] text-brand-500'
                  : 'border-ink/12 bg-transparent text-ink-muted'
              )}
            >
              {t(locale, labelKey)}
              {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </button>
          );
        })}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-brand-500/25 bg-brand-500/[0.04] px-4 py-3">
          <span className="font-ui text-prose text-brand-500">
            {t(locale, 'panel.team.selectedCount', { n: selectedIds.size })}
          </span>
          <SelectField
            value={bulkStage}
            onChange={(e) => setBulkStage(e.target.value)}
            disabled={bulkBusy}
            className={cn(S.select, 'bg-transparent py-1.5 text-prose')}
          >
            {PIPELINE_OPTIONS.map((code) => (
              <option key={code} value={code}>{pipelineLabel(locale, code)}</option>
            ))}
          </SelectField>
          <button
            type="button"
            onClick={applyBulk}
            disabled={bulkBusy}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-500/35 bg-brand-500/[0.09] px-3.5 py-[7px] font-mono text-prose text-brand-500',
              bulkBusy && 'opacity-60'
            )}
          >
            {bulkBusy ? <span className="spinner" /> : null}
            {t(locale, 'panel.team.applyStage')}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkBusy}
            className="cursor-pointer rounded-lg border border-ink/12 bg-transparent px-3 py-[7px] font-mono text-prose text-ink-muted"
          >
            {t(locale, 'panel.compare.clearSelection')}
          </button>
          {bulkMsg && (
            <span className={cn('font-mono text-prose', bulkMsgIsError ? 'text-red-800 dark:text-danger' : 'text-success')}>
              {bulkMsg}
            </span>
          )}
        </div>
      )}
      {filtered.length === 0 && activeSearch ? (
        <EmptyState
          message={t(locale, 'panel.team.noResultsFor', { query: activeSearch })}
          actionLabel={t(locale, 'panel.team.diagnoseCta')}
          actionDisabled={diagnoseBusy}
          onAction={runAbsenceDiagnose}
          secondaryActionLabel={t(locale, 'panel.common.clearFilters')}
          onSecondaryAction={clearActiveSearch}
        />
      ) : null}
      {filtered.length === 0 && !activeSearch ? (
        <EmptyState
          title={t(locale, 'panel.team.emptyFilteredTitle')}
          message={t(locale, 'panel.team.emptyFilteredBody')}
          actionLabel={
            listFilter && typeof onClearListFilter === 'function'
              ? t(locale, 'panel.team.clearListFilter')
              : typeof navigateDashboard === 'function'
                ? t(locale, 'panel.common.clearFilters')
                : undefined
          }
          onAction={
            listFilter && typeof onClearListFilter === 'function'
              ? onClearListFilter
              : typeof navigateDashboard === 'function'
                ? () =>
                    navigateDashboard({
                      tab: 'team',
                      filter: null,
                      pipeline: null,
                      vacancy: null,
                      roster: null,
                      search: null,
                    })
                : undefined
          }
        />
      ) : null}
      {focusCandidateId
        && detail?.candidate
        && String(detail.candidate.id) === String(focusCandidateId)
        && !(results || []).some((r) => String(r.candidateId) === String(focusCandidateId)) ? (
        <div className={cn(S.card, 'mb-4 px-[18px] py-3.5')}>
          <p className="m-0 text-prose text-ink-muted">
            {t(locale, 'dashboard.notifOpenOutsideFilters')}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
          {filtered.map((r) => {
        const id = String(r.assessmentId);
        const d = TYPE_DATA[r.topType];
        const isSelected = open === id;
        const showVacancyFit = r.vacancyFitScore010 != null && r.vacancyFitScore010 !== undefined;
        const created = r.createdAt != null ? new Date(r.createdAt) : null;
        const createdLabel =
          created && !Number.isNaN(created.getTime())
            ? created.toLocaleString(localeHtmlLang(locale), { dateStyle: 'short', timeStyle: 'short' })
            : null;
        return (
          <div
            key={id}
            className={cn(S.cardShell, 'overflow-visible')}
            style={{
              border: isSelected ? `1px solid ${d.color}44` : undefined,
            }}
          >
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={selectedIds.has(id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(id)}
                aria-label={t(locale, 'panel.team.selectPersonAria', { name: titleCasePersonName(r.name) })}
                className="h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
              />
              <button
                type="button"
                onClick={() => openPersonDetail(r)}
                aria-label={`${t(locale, 'panel.team.openDetail')}: ${titleCasePersonName(r.name)}`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-control border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
              >
                <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-base leading-snug text-ink">
                    {titleCasePersonName(r.name)}
                  </span>
                  {r.employmentStatus === EMPLOYMENT_STATUS.ALUMNI ? (
                    <StatusToneChip tone="neutral">
                      {r.exitDate
                        ? t(locale, 'panel.rehire.leftOn', { date: formatDisplayDate(r.exitDate, locale) })
                        : t(locale, 'panel.rehire.formerEmployee')}
                    </StatusToneChip>
                  ) : null}
                  {detail?.candidate?.id === r.candidateId && detail?.candidate?.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ? (
                    <StatusToneChip tone="success">
                      {t(locale, 'recruiting.employmentEmployee')}
                    </StatusToneChip>
                  ) : null}
                  {createdLabel ? (
                    <span
                      title={t(locale, 'dashboard.teamListDateHelp')}
                      className="font-ui text-prose text-ink/75"
                    >
                      {t(locale, 'dashboard.teamAssessmentDate')}: {createdLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={r.topType} locale={locale} compact />
                  <span className="hidden 2xl:contents">
                    <NearbyTypeBadges scores={r.scores} topType={r.topType} locale={locale} />
                    {r.areaLabel ? <StatusToneChip tone="neutral">{r.areaLabel}</StatusToneChip> : null}
                  </span>
                  {r.pipelineStage ? (
                    <StatusToneChip tone="info">
                      {t(locale, 'recruiting.pipelineShort')}: {pipelineLabel(locale, r.pipelineStage)}
                    </StatusToneChip>
                  ) : null}
                  <span className="hidden 2xl:contents">
                    {r.fitLabel ? (
                      <StatusToneChip tone="neutral">
                        {t(locale, 'recruiting.fitLabel')}: {fitBandLabel(locale, r.fitLabel)}
                      </StatusToneChip>
                    ) : null}
                    {showVacancyFit ? (
                      <StatusToneChip tone="success">
                        {t(locale, 'recruiting.vacancyFitShort')}: {r.vacancyFitScore010}/10
                      </StatusToneChip>
                    ) : r.areaFitScore010 !== null && r.areaFitScore010 !== undefined ? (
                      <StatusToneChip tone="success">
                        {t(locale, 'recruiting.areaFitShort')}: {r.areaFitScore010}/10
                      </StatusToneChip>
                    ) : null}
                  </span>
                  {(r.hrScore != null || r.turnoverRisk) && (
                    <HrScoreBadge
                      score={r.hrScore}
                      risk={r.turnoverRisk}
                      size="xs"
                      locale={locale}
                    />
                  )}
                </div>
                </div>
                <span className="hidden shrink-0 font-ui text-prose font-medium text-brand-500 sm:inline">{t(locale, 'panel.team.openDetail')}</span>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {r.candidateId ? (
                  <RowActionsMenu
                    label={t(locale, 'panel.team.moreActions')}
                    items={[
                      ...(isAdmin
                        ? [{
                          id: 'recalcHrScore',
                          label: t(locale, 'hrScore.recalculateOne'),
                          onSelect: () => recalculateHrScore(r.candidateId),
                        }]
                        : []),
                      ...(canRehire && r.employmentStatus === EMPLOYMENT_STATUS.ALUMNI
                        ? [{
                          id: 'rehire',
                          label: t(locale, 'panel.rehire.action'),
                          disabled: rehireBusyId === r.candidateId,
                          onSelect: () => rehirePerson({ candidateId: r.candidateId, name: r.name, exitDate: r.exitDate }),
                        }]
                        : []),
                      {
                        id: 'delete',
                        label: t(locale, 'panel.team.ariaDeletePerson'),
                        danger: true,
                        disabled: deleting,
                        onSelect: () => deleteCandidate(r.candidateId, r.name),
                      },
                    ]}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
        </div>
      </>
      ) : null}

      <AdminRichFormDrawer
        open={Boolean(open && openRow)}
        title={openRow ? titleCasePersonName(openRow.name) : t(locale, 'panel.team.personDetailTitle')}
        locale={locale}
        onClose={closePersonDetail}
        maxWidth="920px"
        fullPage={isPersonPage}
        withinShell={isPersonPage}
        headerMeta={personHeaderMeta}
        headerActions={personHeaderActions}
      >
        {openRow ? (
          <div>
            <PanelSubNav
              ariaLabel={t(locale, 'panel.team.personTabsAria')}
              active={personTab}
              onChange={navigatePersonSection}
              tabs={[
                { id: 'people', label: t(locale, 'panel.team.personTabSummary') },
                { id: 'style', label: t(locale, 'panel.team.personTabStyle') },
                { id: 'history', label: t(locale, 'panel.team.personTabHistory') },
              ]}
            />
            {personTab === 'style' ? (
              <ContentEnter animKey="style">
                {openRow.scores ? (
                  <EnneagramCross scores={openRow.scores} locale={locale} />
                ) : (
                  <p className="mb-4 mt-0 text-prose text-ink-muted">
                    {t(locale, 'panel.team.peopleMissingEnneagram')}
                  </p>
                )}
                <IntegratedProfileSynthesis synthesis={synthesis} locale={locale} />

                {openRow.scores ? <div className="mb-4">
                  {openCluster.size > 1 ? (
                    <p className="mb-2 mt-0 text-prose leading-snug text-ink/75">
                      {t(locale, 'panel.team.scoresClusterHint')}
                    </p>
                  ) : null}
                  <TypeScoreChart scores={openRow.scores} locale={locale} highlightTypes={openCluster} />
                </div> : null}

                {detailLoading ? (
                  <div className="mb-4">
                    <AppLoading locale={locale} variant="inline" />
                  </div>
                ) : detailMatchesOpen && detail?.people?.management?.motivators?.dimensionScores ? (
                  <div className="mb-4">
                    <MotivatorsRadarChart
                      locale={locale}
                      dimensionScores={detail.people.management.motivators.dimensionScores}
                      compact
                    />
                  </div>
                ) : detailMatchesOpen && detail?.people?.management?.motivators?.top?.length ? (
                  <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5">
                    <span className={cn(S.label, 'mb-2')}>
                      {t(locale, 'panel.team.motivatorsRadarTitle')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.people.management.motivators.top.map((d) => (
                        <span
                          key={d.key}
                          className="inline-flex min-h-8 items-center rounded-control border border-ink/12 bg-surface px-2.5 text-prose text-ink"
                        >
                          {d.label} · {Math.round(d.score)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : detailMatchesOpen ? (
                  <p className="mb-4 mt-0 font-ui text-prose text-ink/75">
                    {t(locale, 'panel.team.motivatorsStyleEmpty')}
                  </p>
                ) : null}
                {!detailLoading && detailMatchesOpen ? (
                  <PeopleManagementPanel
                    key={`context-${detail.candidate.id}`}
                    locale={locale}
                    candidateId={detail.candidate.id}
                    people={detail.people}
                    employmentStatus={detail.candidate.employmentStatus}
                    onRefresh={reloadDetailSilently}
                    section="context"
                  />
                ) : null}
              </ContentEnter>
            ) : null}
            {personTab === 'people' ? (
              <ContentEnter animKey="people">
                {detailLoading ? (
                  <AppLoading locale={locale} variant="inline" />
                ) : !detailLoading && detail?.candidate?.id === openRow.candidateId ? (
                  (() => {
                    const isHiringCandidate =
                      detail.candidate.employmentStatus === EMPLOYMENT_STATUS.CANDIDATE;
                    const isInternalPerson =
                      detail.candidate.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ||
                      detail.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI;
                    const allowedSubTabs = new Set([
                      'summary',
                      'oneOnOne',
                      ...(isInternalPerson ? ['feedback'] : []),
                      'journey',
                      ...(isInternalPerson && canViewCompensation ? ['compensation'] : []),
                      'dp',
                    ]);
                    const activePeopleSubTab = allowedSubTabs.has(peopleSubTab)
                      ? peopleSubTab
                      : 'summary';
                    return (
                  <>
                    {isHiringCandidate ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => addToVacancy(detail.candidate.id, openRow.name)}
                          className={cn(S.btnBrandSoft)}
                        >
                          {t(locale, 'panel.team.addToVacancyBtn')}
                        </button>
                      </div>
                    ) : null}
                    {detail.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI ? (
                      <InlineCallout
                        tone="neutral"
                        className="mb-3 text-sm text-ink"
                        action={canRehire ? (
                          <button
                            type="button"
                            className={S.btnBrandSoft}
                            disabled={rehireBusyId === detail.candidate.id}
                            onClick={() => rehirePerson({
                              candidateId: detail.candidate.id,
                              name: openRow.name,
                              exitDate: openRow.exitDate,
                            })}
                          >
                            {t(locale, 'panel.rehire.action')}
                          </button>
                        ) : null}
                      >
                        {openRow.exitDate
                          ? t(locale, 'panel.rehire.detailLeftOn', { date: formatDisplayDate(openRow.exitDate, locale) })
                          : t(locale, 'panel.rehire.detailFormer')}
                      </InlineCallout>
                    ) : null}
                    <PanelSubNav
                      ariaLabel={t(locale, 'panel.team.peopleSubTabsAria')}
                      active={activePeopleSubTab}
                      onChange={navigatePersonSection}
                      tabs={[
                        { id: 'summary', label: t(locale, 'panel.team.peopleSubTabSummary') },
                        { id: 'oneOnOne', label: t(locale, 'panel.team.peopleSubTabOneOnOne') },
                        ...(isInternalPerson
                          ? [{ id: 'feedback', label: t(locale, 'panel.team.peopleSubTabFeedback') }]
                          : []),
                        { id: 'journey', label: t(locale, 'panel.team.peopleSubTabJourney') },
                        ...(isInternalPerson && canViewCompensation
                          ? [
                              {
                                id: 'compensation',
                                label: t(locale, 'panel.team.peopleSubTabCompensation'),
                              },
                            ]
                          : []),
                        { id: 'dp', label: t(locale, 'panel.team.peopleSubTabDp') },
                      ]}
                    />
                    <ContentEnter animKey={activePeopleSubTab}>
                      {activePeopleSubTab === 'summary' ? (
                        <div className="space-y-4 pb-1">
                          <IntegratedProfileSynthesis synthesis={detail.people?.decisionBrief?.synthesis} locale={locale} summaryOnly />
                          {isInternalPerson ? <>
                            <CandidateOrgUnit key={`${detail.candidate.companyId}-${detail.candidate.id}`} locale={locale} companyId={detail.candidate.companyId} candidateId={detail.candidate.id} onSaved={() => router.refresh()} />
                            <OrgManagerBlock
                              locale={locale}
                              companyId={detail.candidate.companyId}
                              candidateId={detail.candidate.id}
                              onCreateManager={companyId ? createEmployeeDirect : undefined}
                              createManagerBusy={createEmployeeBusy}
                            />
                          </> : null}
                          <PersonDossierBlock locale={locale} candidateId={detail.candidate.id} companyId={detail.candidate.companyId} embedded summaryOnly />
                        </div>
                      ) : null}
                      {activePeopleSubTab === 'oneOnOne' ? (
                        <PeopleManagementPanel
                          locale={locale}
                          candidateId={detail.candidate.id}
                          people={detail.people}
                          employmentStatus={detail.candidate.employmentStatus}
                          onRefresh={reloadDetailSilently}
                          section="oneOnOne"
                        />
                      ) : null}
                      {activePeopleSubTab === 'feedback' ? (
                        <ContinuousFeedbackBlock
                          locale={locale}
                          companyId={detail.candidate.companyId}
                          candidateId={detail.candidate.id}
                          subjectName={openRow.name}
                        />
                      ) : null}
                      {activePeopleSubTab === 'journey' ? (
                        <PeopleManagementPanel
                          locale={locale}
                          candidateId={detail.candidate.id}
                          people={detail.people}
                          employmentStatus={detail.candidate.employmentStatus}
                          onRefresh={reloadDetailSilently}
                          section="journey"
                        />
                      ) : null}
                      {activePeopleSubTab === 'compensation' ? (
                        <>
                          <CompensationBlock
                            locale={locale}
                            candidateId={detail.candidate.id}
                            employmentStatus={detail.candidate.employmentStatus}
                            companyId={detail.candidate.companyId}
                            canManage={canManageCompensation}
                            canViewJobRoles={canViewJobRoles}
                            navigateDashboard={navigateDashboard}
                          />
                          <BenefitAssignmentsBlock
                            locale={locale}
                            candidateId={detail.candidate.id}
                            employmentStatus={detail.candidate.employmentStatus}
                          />
                        </>
                      ) : null}
                      {activePeopleSubTab === 'dp' && isInternalPerson ? (
                        <>
                        <DpBlock
                          locale={locale}
                          candidateId={detail.candidate.id}
                          employmentStatus={detail.candidate.employmentStatus}
                          companyId={detail.candidate.companyId}
                        />
                        <CandidateRegistrationBlock
                          key={detail.candidate.id}
                          locale={locale}
                          candidate={detail.candidate}
                          lmsOverdue={detail.lmsOverdue || []}
                          readOnly={detail.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI}
                          onSaved={data => setDetail(prev => prev?.candidate?.id === data.id
                            ? { ...prev, candidate: { ...prev.candidate, ...data } }
                            : prev)}
                        />
                        </>
                      ) : null}
                    </ContentEnter>
                  </>
                    );
                  })()
                ) : (
                  <p className="m-0 text-prose text-ink-muted">—</p>
                )}
              </ContentEnter>
            ) : null}
            {personTab === 'history' ? (
              <ContentEnter animKey="history">
                <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5">
                  <span className={cn(S.label, 'mb-2 block text-center')}>{t(locale, 'recruiting.timelineTitle')}</span>
                  <CandidateTimeline
                    locale={locale}
                    loading={detailLoading}
                    events={detail?.timeline || []}
                    currentStage={getEffectiveStage(openRow)}
                  />
                </div>

                <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5">
                  <span className={cn(S.label, 'mb-2 block')}>{t(locale, 'recruiting.assessmentsForCandidate')}</span>
                  {detailLoading ? (
                    <AppLoading locale={locale} variant="inline" />
                  ) : detailErr ? (
                    <p className="m-0 text-prose text-red-800 dark:text-danger">{detailErr}</p>
                  ) : detail?.assessments?.length ? (
                    <div className="flex flex-col gap-2.5">
                      {detail.assessments.map((a) => (
                        <div
                          key={a.id}
                          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-ink/12 bg-surface/40 p-2.5"
                        >
                          <div>
                            <span className="font-mono text-prose text-ink-muted">
                              #{a.id} · {a.areaLabel}
                              {a.vacancyTitle ? ` · ${a.vacancyTitle}` : ''}
                            </span>
                            {isAdmin && (a.fillDurationMs != null || a.copyEventCount != null) && (
                              <div
                                className={cn(
                                  'mt-1.5 font-ui text-prose leading-snug',
                                  isSuspiciouslyFast(a.fillDurationMs) || (a.copyEventCount || 0) > 0
                                    ? 'text-amber-800 dark:text-warning'
                                    : 'text-ink/75'
                                )}
                                title={t(locale, 'panel.team.integrityTitle')}
                              >
                                {t(locale, 'panel.team.testDuration', {
                                  duration: formatFillDuration(a.fillDurationMs) || t(locale, 'panel.common.notApplicable'),
                                })}
                                {isSuspiciouslyFast(a.fillDurationMs) ? t(locale, 'panel.team.fastFlag') : ''}
                                {' · '}
                                {t(locale, 'panel.team.screenCopies', { n: a.copyEventCount ?? 0 })}
                                {(a.copyEventCount || 0) > 0 ? t(locale, 'panel.team.attentionFlag') : ''}
                              </div>
                            )}
                            {a.rejectionReason ? (
                              <div className="mt-1 font-ui text-prose text-red-800 dark:text-danger">
                                {t(locale, 'recruiting.rejectionReasonLabel')}: {rejectionReasonLabel(locale, a.rejectionReason)}
                              </div>
                            ) : null}
                            {a.startDate && a.pipelineStage === PIPELINE_STAGE.HIRED ? (
                              <div className="mt-1 font-ui text-prose text-success">
                                {t(locale, 'recruiting.startDateLabel')}: {a.startDate}
                              </div>
                            ) : null}
                            {a.pipelineHistory?.length > 0 && (
                              <div className="mt-1 font-ui text-prose leading-loose text-ink/75">
                                {a.pipelineHistory.map((h, i) => (
                                  <span key={i} className="mr-2.5">
                                    {h.fromStage || '—'} → {h.toStage}
                                    {h.reason ? ` (${rejectionReasonLabel(locale, h.reason)})` : ''}
                                    {h.startDate ? ` · ${h.startDate}` : ''}
                                    {' · '}
                                    {new Date(h.changedAt).toLocaleDateString(localeHtmlLang(locale), { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <label className="flex items-center gap-1.5 text-prose text-ink-muted">
                            {t(locale, 'recruiting.stageLabel')}
                            <SelectField
                              value={a.pipelineStage || PIPELINE_STAGE.TEST_COMPLETED}
                              disabled={!!stageBusy}
                              onChange={(e) => patchPipeline(a.id, e.target.value)}
                              className={cn(S.selectCompact, 'bg-transparent py-1')}
                            >
                              {PIPELINE_OPTIONS.map((code) => (
                                <option key={code} value={code}>
                                  {pipelineLabel(locale, code)}
                                </option>
                              ))}
                            </SelectField>
                          </label>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => deleteAssessment(a.id)}
                            className="ml-auto cursor-pointer rounded-lg border border-danger/35 bg-danger/[0.08] px-2.5 py-1.5 font-mono text-prose text-red-800 dark:text-danger"
                          >
                            {t(locale, 'recruiting.allowRetake')}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-prose text-ink-muted">—</p>
                  )}
                </div>
              </ContentEnter>
            ) : null}
            {personTab === 'people' && peopleSubTab === 'dp' && detail?.candidate?.employmentStatus === EMPLOYMENT_STATUS.CANDIDATE ? (
              <ContentEnter animKey="profile">
                {detail?.candidate?.id &&
                detail.candidate.employmentStatus === EMPLOYMENT_STATUS.CANDIDATE ? (
                  <div className="mb-4">
                    <CandidateCvBlock
                      candidateId={detail.candidate.id}
                      locale={locale}
                      embedded
                      onApplied={reloadDetailSilently}
                    />
                  </div>
                ) : null}
                <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5">
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className={cn(S.label, 'mb-0')}>{t(locale, 'recruiting.candidateProfile')}</span>
                    {!profileEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileDraft(profileFromCandidate(detail?.candidate));
                          setNotesDraft(detail?.candidate?.hrNotes || '');
                          setProfileEditing(true);
                          setNotesEditing(false);
                          setProfileMsg('');
                          setNotesMsg('');
                        }}
                        className="cursor-pointer rounded-md border border-ink/12 bg-transparent px-2.5 py-[3px] font-ui text-prose text-ink-muted"
                      >
                        {t(locale, 'panel.team.editNote')}
                      </button>
                    )}
                  </div>
                  {!profileEditing ? (
                    (() => {
                      const c = detail?.candidate;
                      const locBits = [c?.city, c?.state].filter(Boolean).join(' / ');
                      const birthIso =
                        c?.birthDate != null ? String(c.birthDate).slice(0, 10) : '';
                      const startIso =
                        c?.startDate != null ? String(c.startDate).slice(0, 10) : '';
                      const dateLocale = localeHtmlLang(locale);
                      const fmtDate = (iso) => {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || null;
                        const d = new Date(`${iso}T12:00:00`);
                        if (Number.isNaN(d.getTime())) return iso;
                        return d.toLocaleDateString(dateLocale, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        });
                      };
                      const bits = [
                        c?.phone,
                        locBits || null,
                        c?.linkedinUrl ? 'LinkedIn' : null,
                        c?.salaryExpectation,
                        availabilityLabel(locale, c?.availability),
                        sourceLabel(locale, c?.source),
                        birthIso || null,
                        startIso || null,
                        c?.createdAt || c?.createdByName || null,
                        detail?.lmsOverdue?.length ? 'lms-overdue' : null,
                      ].filter(Boolean);
                      if (!bits.length) {
                        return (
                          <p className="m-0 text-prose italic text-ink/75">—</p>
                        );
                      }
                      return (
                        <div className="font-ui text-prose leading-relaxed text-ink">
                          {c?.phone ? <div>{formatPhoneBr(c.phone)}</div> : null}
                          {locBits ? <div>{locBits}</div> : null}
                          {c?.linkedinUrl ? (
                            <div>
                              <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-brand-600">
                                {c.linkedinUrl}
                              </a>
                            </div>
                          ) : null}
                          {c?.salaryExpectation ? <div>{formatSalaryBr(c.salaryExpectation)}</div> : null}
                          {availabilityLabel(locale, c?.availability) ? (
                            <div>{availabilityLabel(locale, c.availability)}</div>
                          ) : null}
                          {sourceLabel(locale, c?.source) ? (
                            <div>{sourceLabel(locale, c.source)}</div>
                          ) : null}
                          {birthIso ? (
                            <div>
                              {t(locale, 'panel.team.birthDate')}: {fmtDate(birthIso)}
                            </div>
                          ) : null}
                          {startIso ? (
                            <div>
                              {t(locale, 'panel.team.workAnniversary')}: {fmtDate(startIso)}
                            </div>
                          ) : null}
                          {c?.createdAt || c?.createdByName ? (
                            <div className="mt-2 border-t border-ink/[0.06] pt-2 font-ui text-prose text-ink/75">
                              {(() => {
                                const d = c.createdAt != null ? new Date(c.createdAt) : null;
                                const dateLabel =
                                  d && !Number.isNaN(d.getTime())
                                    ? d.toLocaleDateString(dateLocale, {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      })
                                    : '—';
                                return c?.createdByName
                                  ? t(locale, 'panel.team.registeredBy', {
                                      name: c.createdByName,
                                      date: dateLabel,
                                    })
                                  : t(locale, 'panel.team.registeredAt', { date: dateLabel });
                              })()}
                            </div>
                          ) : null}
                          {detail?.lmsOverdue?.length ? (
                            <ul className="mt-2 flex list-none flex-col gap-1 p-0">
                              {detail.lmsOverdue.map((course) => (
                                <li key={course.enrollmentId}>
                                  <StatusToneChip tone="danger" bordered={false}>
                                    {t(locale, 'panel.team.lmsOverdue', {
                                      title: course.courseTitle,
                                      date: fmtDate(course.dueDate),
                                    })}
                                  </StatusToneChip>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : (
                    <div>
                      <div className={cn(formFieldRowClass, 'mb-2.5')}>
                        <FormField
                          label={t(locale, 'recruiting.phoneLabel')}
                          className={formFieldGrowClass}
                        >
                          <input
                            value={formatPhoneBr(profileDraft.phone)}
                            onChange={(e) =>
                              setProfileDraft((p) => ({ ...p, phone: stripPhone(e.target.value) || '' }))
                            }
                            placeholder={t(locale, 'recruiting.phonePh')}
                            inputMode="tel"
                            aria-label={t(locale, 'recruiting.phoneLabel')}
                            className={cn(S.input, 'w-full font-mono text-prose')}
                          />
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.linkedinLabel')}
                          className="min-w-0 flex-[2_1_200px]"
                        >
                          <input
                            value={profileDraft.linkedinUrl}
                            onChange={(e) =>
                              setProfileDraft((p) => ({ ...p, linkedinUrl: e.target.value }))
                            }
                            placeholder={t(locale, 'recruiting.linkedinPh')}
                            autoComplete="off"
                            name="linkedin-url"
                            aria-label={t(locale, 'recruiting.linkedinLabel')}
                            className={cn(S.input, 'w-full font-mono text-prose')}
                          />
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.stateLabel')}
                          className="min-w-0 flex-[0_1_160px]"
                        >
                          <BrStateSelect
                            value={profileDraft.state}
                            onChange={(state) =>
                              setProfileDraft((p) => ({ ...p, state, city: '' }))
                            }
                            locale={locale}
                            className={cn(S.select, 'w-full font-mono text-prose')}
                          />
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.cityLabel')}
                          className="min-w-0 flex-[1_1_180px]"
                        >
                          <BrCitySelect
                            uf={profileDraft.state}
                            value={profileDraft.city}
                            onChange={(city) => setProfileDraft((p) => ({ ...p, city }))}
                            locale={locale}
                            className={cn(S.select, 'w-full font-mono text-prose')}
                          />
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.salaryExpectationLabel')}
                          className={formFieldGrowClass}
                        >
                          <input
                            value={formatSalaryBr(profileDraft.salaryExpectation)}
                            onChange={(e) =>
                              setProfileDraft((p) => ({
                                ...p,
                                salaryExpectation: digitsOnly(e.target.value).slice(0, 15),
                              }))
                            }
                            placeholder={t(locale, 'recruiting.salaryPh')}
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={t(locale, 'recruiting.salaryExpectationLabel')}
                            className={cn(S.input, 'w-full font-mono text-prose')}
                          />
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.availabilityLabel')}
                          className={formFieldGrowClass}
                        >
                          <SelectField
                            value={profileDraft.availability}
                            onChange={(e) =>
                              setProfileDraft((p) => ({ ...p, availability: e.target.value }))
                            }
                            aria-label={t(locale, 'recruiting.availabilityLabel')}
                            className={cn(S.select, 'w-full font-mono text-prose')}
                          >
                            <option value="">{t(locale, 'recruiting.availabilityLabel')}</option>
                            <option value="immediate">
                              {t(locale, 'recruiting.availabilityImmediate')}
                            </option>
                            <option value="15_days">{t(locale, 'recruiting.availability15')}</option>
                            <option value="30_days">{t(locale, 'recruiting.availability30')}</option>
                            <option value="60_days">{t(locale, 'recruiting.availability60')}</option>
                            <option value="other">{t(locale, 'recruiting.availabilityOther')}</option>
                          </SelectField>
                        </FormField>
                        <FormField
                          label={t(locale, 'recruiting.sourceLabel')}
                          className={formFieldGrowClass}
                        >
                          <SelectField
                            value={profileDraft.source}
                            onChange={(e) =>
                              setProfileDraft((p) => ({ ...p, source: e.target.value }))
                            }
                            aria-label={t(locale, 'recruiting.sourceLabel')}
                            className={cn(S.select, 'w-full font-mono text-prose')}
                          >
                            <option value="">{t(locale, 'recruiting.sourceLabel')}</option>
                            <option value="linkedin">{t(locale, 'recruiting.sourceLinkedin')}</option>
                            <option value="referral">{t(locale, 'recruiting.sourceReferral')}</option>
                            <option value="agency">{t(locale, 'recruiting.sourceAgency')}</option>
                            <option value="job_board">{t(locale, 'recruiting.sourceJobBoard')}</option>
                            <option value="other">{t(locale, 'recruiting.sourceOther')}</option>
                          </SelectField>
                        </FormField>
                        <FormField
                          label={t(locale, 'panel.team.birthDate')}
                          className={formFieldGrowClass}
                        >
                          <DateField
                            value={profileDraft.birthDate || ''}
                            onChange={(e) =>
                              setProfileDraft((p) => ({ ...p, birthDate: e.target.value || '' }))
                            }
                            aria-label={t(locale, 'panel.team.birthDate')}
                            className="w-full font-mono text-prose"
                          />
                        </FormField>
                        {detail?.candidate?.startDate ? (
                          <FormField
                            as="div"
                            label={t(locale, 'panel.team.workAnniversary')}
                            hint={t(locale, 'panel.team.workAnniversaryHint')}
                            className={formFieldGrowClass}
                          >
                            <div
                              className={cn(
                                S.input,
                                'flex min-h-touch w-full cursor-default items-center font-mono text-prose text-ink-muted opacity-90'
                              )}
                              aria-readonly="true"
                            >
                              {String(detail.candidate.startDate).slice(0, 10)}
                            </div>
                          </FormField>
                        ) : null}
                      </div>
                      <div className="mb-2.5">
                        <span className={cn(S.label, 'mb-1.5')}>{t(locale, 'panel.team.hrNotes')}</span>
                        <RichTextEditor
                          value={notesDraft}
                          onChange={setNotesDraft}
                          placeholder={t(locale, 'panel.team.notesPlaceholder')}
                          aria-label={t(locale, 'panel.team.notesAria')}
                          minHeight={120}
                          locale={locale}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={saveProfile}
                          disabled={profileBusy}
                          className={cn(
                            'cursor-pointer rounded-lg border border-brand-500/35 bg-brand-500/[0.09] px-3.5 py-[7px] font-mono text-prose text-brand-500',
                            profileBusy && 'opacity-60'
                          )}
                        >
                          {profileBusy ? t(locale, 'recruiting.savingNotes') : t(locale, 'recruiting.saveProfile')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setProfileDraft(profileFromCandidate(detail?.candidate));
                            setNotesDraft(detail?.candidate?.hrNotes || '');
                            setProfileEditing(false);
                            setProfileMsg('');
                          }}
                          disabled={profileBusy}
                          className="cursor-pointer rounded-lg border border-ink/12 bg-transparent px-3.5 py-[7px] font-mono text-prose text-ink-muted"
                        >
                          {t(locale, 'panel.admin.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                  {profileMsg ? (
                    <p className={cn('mt-2 mb-0 font-ui text-prose', profileMsgIsError ? 'text-red-800 dark:text-danger' : 'text-success')}>
                      {profileMsg}
                    </p>
                  ) : null}
                </div>

                {!profileEditing ? (
                <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5">
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className={cn(S.label, 'mb-0')}>{t(locale, 'panel.team.hrNotes')}</span>
                    {!notesEditing && (
                      <button
                        type="button"
                        onClick={() => { setNotesDraft(detail?.candidate?.hrNotes || ''); setNotesEditing(true); setNotesMsg(''); }}
                        className="cursor-pointer rounded-md border border-ink/12 bg-transparent px-2.5 py-[3px] font-ui text-prose text-ink-muted"
                      >
                        {detail?.candidate?.hrNotes && !isRichTextEmpty(detail.candidate.hrNotes)
                          ? t(locale, 'panel.team.editNote')
                          : t(locale, 'panel.team.addNote')}
                      </button>
                    )}
                  </div>
                  {!notesEditing ? (
                    !isRichTextEmpty(detail?.candidate?.hrNotes) ? (
                      <RichTextView html={detail.candidate.hrNotes} />
                    ) : (
                      <p className="m-0 text-prose italic text-ink/75">
                        {t(locale, 'panel.team.noNotes')}
                      </p>
                    )
                  ) : (
                    <div>
                      <div className="mb-2">
                        <RichTextEditor
                          value={notesDraft}
                          onChange={setNotesDraft}
                          placeholder={t(locale, 'panel.team.notesPlaceholder')}
                          aria-label={t(locale, 'panel.team.notesAria')}
                          minHeight={120}
                          locale={locale}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={saveNotes}
                          disabled={notesBusy}
                          className={cn(
                            'flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-500/35 bg-brand-500/[0.09] px-3.5 py-[7px] font-mono text-prose text-brand-500',
                            notesBusy && 'opacity-60'
                          )}
                        >
                          {notesBusy ? <span className="spinner" /> : null}
                          {t(locale, 'panel.admin.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setNotesEditing(false); setNotesDraft(detail?.candidate?.hrNotes || ''); }}
                          disabled={notesBusy}
                          className="cursor-pointer rounded-lg border border-ink/12 bg-transparent px-3 py-[7px] font-mono text-prose text-ink-muted"
                        >
                          {t(locale, 'panel.admin.cancel')}
                        </button>
                        {notesMsg && (
                          <span className={cn('font-mono text-prose', notesMsgIsError ? 'text-red-800 dark:text-danger' : 'text-success')}>
                            {notesMsg}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {!notesEditing && notesMsg && (
                    <p className={cn('mt-1.5 mb-0 font-mono text-prose', notesMsgIsError ? 'text-red-800 dark:text-danger' : 'text-success')}>
                      {notesMsg}
                    </p>
                  )}
                </div>
                ) : null}
              </ContentEnter>
            ) : null}
          </div>
        ) : null}
      </AdminRichFormDrawer>

    </div>
  );
}
