import { query, queryRead } from '../../lib/db';
import { ORG_UNIT, parseOrgUnitFilter } from '../../lib/org-unit-constants.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import {
  parseDashboardPagination,
  parseDashboardTab,
  parseTeamSort,
  sqlTeamOrderBy,
  assessmentListWhereParts,
  resolveCohortCompanyId,
  parsePipelineFilter,
  parseDateFilter,
  parseNameSearch,
  candidateNameSearchClause,
  parseRosterScope,
  parseTeamListFilter,
  sqlWhere,
} from '../../lib/assessment-filters';
import { enrichAssessmentDashboardRow, toNum } from '../../lib/dashboard-assessment-row';
import {
  buildAreaSummaries,
  buildLeadershipPotentialsByCompany,
  globalTopTypeCounts,
  rubricAlignmentShare,
  LEADERSHIP_SCORES_SAMPLE_CAP,
  LEADERSHIP_POTENTIALS_SCAN_CAP,
} from '../../lib/leadership-analytics';
import { buildOverviewMetrics } from '../../lib/overview-metrics';
import { OVERVIEW_FUNNEL_STAGES } from '../../lib/overview-constants.js';
import { buildCompatBundles, COMPAT_PEOPLE_CAP } from '../../lib/compat-bundles';
import { getOnboardingProgress } from '../../lib/onboarding-progress';
import { ANNIVERSARY_WINDOW_DAYS, getUpcomingAnniversaries } from '../../lib/people/upcoming-anniversaries.js';
import { isSuperAdminPayload } from '../../lib/permissions';
import { measureAsync } from '../../lib/monitoring.js';
import { COHORT_TABS, needsAdminCompaniesList } from '../../lib/dashboard-company-scope.js';

/** Max rows in the vacancy filter dropdown (cohort tabs only). */
const VACANCIES_FILTER_CAP = 200;

/** Cap when recomputing area_stats from raw scores on a request. */
const AREA_STATS_SCORES_CAP = 5000;

function computeStatsFromScores(rows) {
  const sums = {};
  const sums2 = {};
  const counts = {};
  for (let t = 1; t <= 9; t++) {
    sums[t] = 0;
    sums2[t] = 0;
    counts[t] = 0;
  }
  for (const r of rows) {
    const s = r.scores || {};
    for (let t = 1; t <= 9; t++) {
      const v = toNum(s[t] ?? s[String(t)] ?? 0);
      sums[t] += v;
      sums2[t] += v * v;
      counts[t] += 1;
    }
  }
  const means = {};
  const stds = {};
  const n = rows.length;
  for (let t = 1; t <= 9; t++) {
    const c = Math.max(counts[t], 1);
    const mean = sums[t] / c;
    const variance = Math.max(0, sums2[t] / c - mean * mean);
    const std = Math.sqrt(variance) || 1;
    means[t] = mean;
    stds[t] = std;
  }
  return { n, means, stds };
}

const EMPTY_TYPE_COUNT = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => [t, 0]));

/**
 * Tab-scoped dashboard payload (queries). Call from a Suspense child so the
 * shell can paint before this resolves.
 */
export async function loadDashboardTabData({ searchParams, payload, isAdmin, companyId, locale }) {
  const activeTab = parseDashboardTab(searchParams, payload);
  const needCohortChrome = COHORT_TABS.has(activeTab);
  const needTeam = activeTab === 'team';
  const needCompatPairs = activeTab === 'compatibility';
  const needGroupPeople = activeTab === 'group';
  const needOverview = activeTab === 'overview';
  const needLeadership = activeTab === 'leadership';
  // Filtros de área/vaga no chrome: todas as abas de coorte (inclui compare).
  const needVacanciesFilter = needCohortChrome;
  const needAreaCounts = needCohortChrome;
  // COUNT + histograma T1–T9: Equipe (paginação), Compat (typeCount/capped), Overview (typeMix).
  // Compare/group/leadership não precisam desse par de queries pesadas no SSR.
  const needListMetrics = needTeam || needCompatPairs || needOverview;
  const needAreas = needCohortChrome;
  const needCompaniesFilter = isAdmin && needsAdminCompaniesList(activeTab);

  const selectedArea = (searchParams?.area || 'all').toString();
  const selectedVacancy = (searchParams?.vacancy || 'all').toString();
  const selectedPipeline = parsePipelineFilter(searchParams);
  const selectedRoster = parseRosterScope(searchParams);
  const selectedListFilter = needTeam ? parseTeamListFilter(searchParams) : null;
  const { dateFrom: selectedDateFrom, dateTo: selectedDateTo } = parseDateFilter(searchParams);
  const nameSearch = parseNameSearch(searchParams);
  const rawCompany = (searchParams?.company || 'all').toString();
  const rawTeamGroup = parseInt(String(searchParams?.teamGroup || '').trim(), 10);
  const selectedTeamGroup =
    Number.isFinite(rawTeamGroup) && rawTeamGroup > 0 ? rawTeamGroup : null;

  let results = [];
  let areas = [];
  let companiesForFilter = [];
  let scopeCompanyFilter = null;
  let counts = [];
  let vacancies = [];
  let areaStats = null;
  let areaRubric = null;
  let rubricByAreaKey = {};
  let vacancyRubricByVacancyId = {};
  let analytics = null;
  let pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  let compatMetrics = {
    pairs: [],
    tensions: [],
    synergies: [],
    typeCount: { ...EMPTY_TYPE_COUNT },
    total: 0,
    capped: false,
    peopleCap: COMPAT_PEOPLE_CAP,
  };
  let interactionPeople = [];
  let enneagram = 'all';
  let overviewMetrics = null;
  let onboardingProgress = null;

  try {
    const areasPromise = needAreas
      ? queryRead(`SELECT key, label FROM areas ORDER BY label ASC`)
      : Promise.resolve({ rows: [] });
    const companiesPromise = needCompaniesFilter
      ? queryRead(`SELECT id, name FROM companies WHERE deleted = FALSE ORDER BY name ASC`)
      : Promise.resolve(null);

    const [a, cos] = await Promise.all([areasPromise, companiesPromise]);
    areas = a.rows;

    if (cos) {
      companiesForFilter = cos.rows;
      // Tenant-bound admin: only their company in the chrome (never "all tenants").
      if (isAdmin && companyId != null && !isSuperAdminPayload(payload)) {
        companiesForFilter = cos.rows.filter((x) => Number(x.id) === Number(companyId));
        scopeCompanyFilter = Number(companyId);
      } else if (rawCompany !== 'all') {
        const cid = parseInt(rawCompany, 10);
        if (Number.isFinite(cid) && companiesForFilter.some((x) => Number(x.id) === cid)) {
          scopeCompanyFilter = cid;
        }
      }
    } else if (isAdmin && rawCompany !== 'all') {
      // Cohort tabs with company in URL but companies list skipped — still honor scope.
      const cid = parseInt(rawCompany, 10);
      if (Number.isFinite(cid)) scopeCompanyFilter = cid;
    }

    // Align vacancy/area chrome with cohort tenant (same rules as assessmentListWhereParts).
    const effectiveCompanyId = resolveCohortCompanyId({ isAdmin, companyId, scopeCompanyFilter });
    if (effectiveCompanyId != null && scopeCompanyFilter == null && isAdmin) {
      scopeCompanyFilter = effectiveCompanyId;
    }

    /** Super-admin without company chip: skip Overview/Compat scans across all tenants. */
    const needsCompanyScope =
      isAdmin &&
      companyId == null &&
      effectiveCompanyId == null &&
      (needOverview || needCompatPairs || needListMetrics);

    const { page, pageSize, enneagram: enneParsed } = parseDashboardPagination(searchParams);
    enneagram = enneParsed;
    pagination = { ...pagination, page, pageSize };

    const teamSortState = parseTeamSort(searchParams);
    const teamOrderSql = sqlTeamOrderBy(teamSortState.sort, teamSortState.dir);

    const vacanciesTask = (async () => {
      if (needVacanciesFilter) {
        const vWhereParts = ['v.deleted = FALSE', 'c.deleted = FALSE'];
        const vParams = [];
        if (effectiveCompanyId != null) {
          vParams.push(effectiveCompanyId);
          vWhereParts.push(`v.company_id = $${vParams.length}`);
        }
        const vWhere = `WHERE ${vWhereParts.join(' AND ')}`;
        vParams.push(VACANCIES_FILTER_CAP);
        const v = await queryRead(
          `SELECT v.id, v.company_id AS "companyId", v.title, v.status, v.created_at AS "createdAt"
           FROM vacancies v
           JOIN companies c ON c.id = v.company_id
           ${vWhere}
           ORDER BY (v.status = 'open') DESC, v.created_at DESC
           LIMIT $${vParams.length}`,
          vParams
        );
        vacancies = v.rows;

        // Keep the currently selected vacancy visible even if outside the cap window.
        if (selectedVacancy !== 'all') {
          const selId = parseInt(selectedVacancy, 10);
          if (Number.isFinite(selId) && !vacancies.some((x) => Number(x.id) === selId)) {
            const oneParams = [selId];
            let oneExtra = '';
            if (effectiveCompanyId != null) {
              oneParams.push(effectiveCompanyId);
              oneExtra = ` AND v.company_id = $2`;
            }
            const one = await queryRead(
              `SELECT v.id, v.company_id AS "companyId", v.title, v.status, v.created_at AS "createdAt"
               FROM vacancies v
               JOIN companies c ON c.id = v.company_id AND c.deleted = FALSE
               WHERE v.deleted = FALSE AND v.id = $1${oneExtra}
               LIMIT 1`,
              oneParams
            );
            if (one.rowCount) vacancies = [...vacancies, ...one.rows];
          }
        }
      }
    })();

    const vacancyRubricTask = (async () => {
      if (needTeam && selectedVacancy !== 'all') {
        const selId = parseInt(selectedVacancy, 10);
        if (Number.isFinite(selId) && vacancyRubricByVacancyId[String(selId)] == null) {
          const vrOne = await queryRead(
            `SELECT vacancy_id AS "vacancyId", desired_type_weights AS weights
             FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
            [selId]
          );
          if (vrOne.rowCount) {
            const row = vrOne.rows[0];
            vacancyRubricByVacancyId[String(row.vacancyId)] =
              row.weights && typeof row.weights === 'object' ? row.weights : {};
          }
        }
      }
    })();

    const areaCountsTask = (async () => {
      if (needAreaCounts) {
        const countWhereParts = [];
        const cParams = [];
        if (effectiveCompanyId != null) {
          cParams.push(effectiveCompanyId);
          countWhereParts.push(`ass.company_id = $${cParams.length}`);
        }
        const cWhere = countWhereParts.length ? `WHERE ${countWhereParts.join(' AND ')}` : '';
        const c = await queryRead(
          `SELECT ar.key, ar.label, COUNT(*)::int AS count
           FROM assessments ass
           JOIN areas ar ON ar.id = ass.area_id
           ${cWhere}
           GROUP BY ar.key, ar.label
           ORDER BY ar.label ASC`,
          cParams
        );
        counts = c.rows;
      }
    })();

    const areaChainTask = (async () => {
      if (needTeam && selectedArea !== 'all') {
        const areaRow = await queryRead(`SELECT id FROM areas WHERE key = $1 LIMIT 1`, [selectedArea]);
        const areaId = areaRow.rows?.[0]?.id;
        if (areaId) {
          if (isAdmin && scopeCompanyFilter != null) {
            const raw = await queryRead(
              `SELECT scores FROM assessments WHERE company_id = $1 AND area_id = $2 LIMIT $3`,
              [scopeCompanyFilter, areaId, AREA_STATS_SCORES_CAP]
            );
            areaStats = computeStatsFromScores(raw.rows);
          } else {
            const statsRow = await queryRead(
              `SELECT type_means AS "means", type_stds AS "stds", n FROM area_stats WHERE area_id = $1 LIMIT 1`,
              [areaId]
            );
            if (statsRow.rowCount > 0) {
              areaStats = {
                means: statsRow.rows[0].means,
                stds: statsRow.rows[0].stds,
                n: statsRow.rows[0].n,
              };
            } else {
              const rawWhere = isAdmin
                ? `WHERE area_id = $1`
                : `WHERE company_id = $1 AND area_id = $2`;
              const rawParams = isAdmin
                ? [areaId, AREA_STATS_SCORES_CAP]
                : [companyId, areaId, AREA_STATS_SCORES_CAP];
              const limIx = rawParams.length;
              const raw = await queryRead(
                `SELECT scores FROM assessments ${rawWhere} LIMIT $${limIx}`,
                rawParams
              );
              areaStats = computeStatsFromScores(raw.rows);
              // Persist via cron/ops — avoid write-on-read on the dashboard hot path.
            }
          }

          const rub = await queryRead(
            `SELECT desired_type_weights AS weights FROM area_rubrics WHERE area_id = $1 LIMIT 1`,
            [areaId]
          );
          if (rub.rowCount > 0) {
            areaRubric = rub.rows[0].weights || {};
          } else {
            await query(
              `INSERT INTO area_rubrics (area_id, desired_type_weights) VALUES ($1, '{}'::jsonb) ON CONFLICT (area_id) DO NOTHING`,
              [areaId]
            );
            areaRubric = {};
          }
        }
      }
    })();

    const rubricsTask = (async () => {
      if (needTeam || needLeadership) {
        const rubAll = await queryRead(
          `SELECT a.key AS "areaKey", r.desired_type_weights AS weights
           FROM area_rubrics r
           JOIN areas a ON a.id = r.area_id`
        );
        rubricByAreaKey = Object.fromEntries(rubAll.rows.map((x) => [x.areaKey, x.weights || {}]));
      }
    })();

    // Independent chrome/rubric reads: one round-trip wall time instead of serial.
    await Promise.all([vacanciesTask, vacancyRubricTask, areaCountsTask, areaChainTask, rubricsTask]);

    if (needListMetrics || needTeam || needCompatPairs || needGroupPeople || needOverview || needLeadership) {
      if (needsCompanyScope) {
        overviewMetrics = {
          needsCompanyScope: true,
          funnel: Object.fromEntries(OVERVIEW_FUNNEL_STAGES?.map?.((s) => [s, 0]) || []),
          funnelTotal: 0,
          attention: [],
          openVacancies: [],
          openVacancyCount: 0,
          peopleOps: null,
          behavioralIntel: null,
        };
        compatMetrics = {
          ...compatMetrics,
          needsCompanyScope: true,
        };
      } else {
      const BASE_JOIN_LIST = `
FROM assessments ass
JOIN candidates c ON c.id = ass.candidate_id
JOIN areas ar ON ar.id = ass.area_id
LEFT JOIN vacancies v ON v.id = ass.vacancy_id
`;

      const ANALYTICS_ASSESSMENT_JOIN = `
FROM assessments ass
JOIN areas ar ON ar.id = ass.area_id
LEFT JOIN vacancies v ON v.id = ass.vacancy_id
`;

      const { whereParts, params } = assessmentListWhereParts({
        isAdmin,
        companyId,
        scopeCompanyFilter,
        selectedArea,
        selectedVacancy,
        enneagram,
        pipelineStage: selectedPipeline,
        dateFrom: selectedDateFrom,
        dateTo: selectedDateTo,
        rosterScope: selectedRoster,
        listFilter: selectedListFilter,
      });
      const assessmentWhere = sqlWhere(whereParts);

      // Apply before count and pagination; never filter only the visible page.
      const orgUnitFilter = needTeam ? parseOrgUnitFilter(searchParams.orgUnit) : null;
      if (orgUnitFilter === ORG_UNIT.FILTER_NONE) whereParts.push('c.org_unit_id IS NULL');
      else if (orgUnitFilter) {
        params.push(orgUnitFilter);
        whereParts.push(`c.org_unit_id = $${params.length}`);
      }

      const extWhereParts = nameSearch
        ? [
            ...whereParts,
            candidateNameSearchClause('c', params.length + 1),
          ]
        : whereParts;
      const extParams = nameSearch ? [...params, `%${nameSearch}%`] : params;
      const candidateWhere = sqlWhere(extWhereParts);

      let listTotal = 0;
      let typeCountAgg = { ...EMPTY_TYPE_COUNT };

      // Onboarding progress (only for non-admins viewing their own company) does not depend on list data.
      const onboardingPromise = needOverview && !isAdmin && companyId
        ? getOnboardingProgress(queryRead, companyId).catch((err) => {
          console.error('[dashboard/load] Onboarding progress error:', err);
          return null;
        })
        : null;

      // Birthdays card: cheap, filter-independent; SSR it with the overview instead of a client fetch.
      const anniversariesPromise = needOverview && companyId
        ? getUpcomingAnniversaries(null, { companyId: Number(companyId), daysAhead: ANNIVERSARY_WINDOW_DAYS }).catch((err) => {
          console.error('[dashboard/load] Upcoming anniversaries error:', err);
          return null;
        })
        : null;

      const runTeamPage = (targetPage) => {
        const pageParams = [...extParams];
        pageParams.push(pageSize);
        const limIx = pageParams.length;
        pageParams.push(Math.max(0, (targetPage - 1) * pageSize));
        const offIx = pageParams.length;
        return queryRead(
          `SELECT
             ass.id AS "assessmentId",
             c.id AS "candidateId",
             c.full_name AS name,
             ar.key AS "areaKey",
             ar.label AS "areaLabel",
             ass.vacancy_id AS "vacancyId",
             v.title AS "vacancyTitle",
             ass.top_type AS "topType",
             ass.scores,
             ass.created_at AS "createdAt",
             COALESCE(stg.changed_at, ass.created_at) AS "stageEnteredAt",
             ass.pipeline_stage AS "pipelineStage",
             ass.invite_id AS "inviteId",
             c.employment_status AS "employmentStatus",
             CASE WHEN c.employment_status = '${EMPLOYMENT_STATUS.ALUMNI}' THEN (
               SELECT MAX(e.exit_date) FROM exit_records e WHERE e.candidate_id = c.id
             ) END AS "exitDate"
           ${BASE_JOIN_LIST}
           LEFT JOIN LATERAL (
             SELECT h.changed_at
             FROM assessment_pipeline_history h
             WHERE h.assessment_id = ass.id
             ORDER BY h.changed_at DESC NULLS LAST, h.id DESC
             LIMIT 1
           ) stg ON TRUE
           ${candidateWhere}
           ${teamOrderSql}
           LIMIT $${limIx} OFFSET $${offIx}`,
          pageParams
        );
      };
      // Speculative: requested page in parallel with the count; re-run only if the page gets clamped.
      const speculativeTeamPage = needTeam ? runTeamPage(page) : null;
      speculativeTeamPage?.catch(() => {});

      if (needListMetrics) {
        const needHistogram = needCompatPairs || needOverview;
        const aggregatePromise = needHistogram
          ? queryRead(
              `SELECT ass.top_type AS "topType", COUNT(*)::int AS n,
                      SUM(COUNT(*)) OVER ()::int AS total
                 ${BASE_JOIN_LIST}
                 ${candidateWhere}
                GROUP BY ass.top_type`,
              extParams
            )
          : queryRead(`SELECT COUNT(*)::int AS total ${BASE_JOIN_LIST} ${candidateWhere}`, extParams);
        const aggregateRes = await aggregatePromise;
        listTotal = Number(aggregateRes.rows[0]?.total) || 0;
        for (const row of needHistogram ? aggregateRes.rows : []) {
          const tt = row.topType;
          if (typeof tt === 'number' && tt >= 1 && tt <= 9) typeCountAgg[tt] = row.n;
        }
        const totalPagesSafe = Math.max(1, Math.ceil(listTotal / pageSize));
        const effectivePage = listTotal === 0 ? 1 : Math.min(page, totalPagesSafe);
        pagination = {
          page: effectivePage,
          pageSize,
          total: listTotal,
          totalPages: totalPagesSafe,
        };
        compatMetrics = {
          ...compatMetrics,
          typeCount: typeCountAgg,
          total: listTotal,
        };
      }

      if (needCompatPairs || needGroupPeople) {
        const lightParams = [...extParams, COMPAT_PEOPLE_CAP];
        const lightRes = await queryRead(
          `SELECT ass.id AS "assessmentId",
                  c.id AS "candidateId",
                  c.full_name AS name,
                  ass.top_type AS "topType",
                  ar.label AS "areaLabel"
           ${BASE_JOIN_LIST}
           ${candidateWhere}
           ${teamOrderSql}
           LIMIT $${lightParams.length}`,
          lightParams
        );
        const bundles = await measureAsync('dashboard.compatBundles', async () =>
          buildCompatBundles(lightRes.rows, locale, {
            peopleCap: COMPAT_PEOPLE_CAP,
            includePairs: needCompatPairs,
          })
        );
        const capped = listTotal > COMPAT_PEOPLE_CAP;
        if (needCompatPairs) {
          compatMetrics = {
            pairs: bundles.pairs,
            tensions: bundles.tensions,
            synergies: bundles.synergies,
            pairTotals: bundles.pairTotals,
            pairsPayloadCapped: bundles.pairsPayloadCapped,
            pairPayloadCap: bundles.pairPayloadCap,
            typeCount: typeCountAgg,
            total: listTotal,
            capped,
            peopleCap: COMPAT_PEOPLE_CAP,
          };
        }
        interactionPeople = bundles.people;
      }

      if (needOverview) {
        overviewMetrics = await measureAsync('dashboard.overviewMetrics', () =>
          buildOverviewMetrics({
            isAdmin,
            companyId,
            scopeCompanyFilter,
            selectedArea,
            selectedVacancy,
            enneagram,
            dateFrom: selectedDateFrom,
            dateTo: selectedDateTo,
            nameSearch,
            typeCount: typeCountAgg,
            rosterScope: selectedRoster,
            locale,
            teamGroupId: selectedTeamGroup,
          })
        );

        if (onboardingPromise) onboardingProgress = await onboardingPromise;
        if (anniversariesPromise) {
          const anniversaries = await anniversariesPromise;
          if (anniversaries?.ok) overviewMetrics = { ...overviewMetrics, upcomingAnniversaries: anniversaries };
        }
      }

      if (needTeam) {
        const effectivePage = pagination.page;
        const pageRes = effectivePage === page
          ? await speculativeTeamPage
          : await runTeamPage(effectivePage);

        const pageVacIds = [
          ...new Set(
            pageRes.rows
              .map((r) => r.vacancyId)
              .filter((id) => id != null)
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id))
          ),
        ];
        if (pageVacIds.length > 0) {
          const vr = await queryRead(
            `SELECT vacancy_id AS "vacancyId", desired_type_weights AS weights
             FROM vacancy_rubrics WHERE vacancy_id = ANY($1::bigint[])`,
            [pageVacIds]
          );
          for (const row of vr.rows) {
            vacancyRubricByVacancyId[String(row.vacancyId)] =
              row.weights && typeof row.weights === 'object' ? row.weights : {};
          }
        }

        const enrichCtx = {
          selectedArea,
          areaStats,
          areaRubric,
          rubricByAreaKey,
          vacancyRubricByVacancyId,
        };
        results = pageRes.rows.map((r) => enrichAssessmentDashboardRow(r, enrichCtx));
      }

      if (needLeadership) {
        const scoresParams = [...params, LEADERSHIP_SCORES_SAMPLE_CAP];
        const [distAgg, monthlyAgg, totalsAgg, scoresAll] = await Promise.all([
          queryRead(
            `SELECT ar.key AS "areaKey", ar.label AS "areaLabel", ass.top_type AS "topType", COUNT(*)::int AS cnt
             ${ANALYTICS_ASSESSMENT_JOIN}
             ${assessmentWhere}
             GROUP BY ar.key, ar.label, ass.top_type
             ORDER BY ar.label, ass.top_type`,
            params
          ),
          queryRead(
            `SELECT to_char(date_trunc('month', ass.created_at), 'YYYY-MM') AS period, COUNT(*)::int AS cnt
             ${ANALYTICS_ASSESSMENT_JOIN}
             ${assessmentWhere}
             GROUP BY 1
             ORDER BY 1`,
            params
          ),
          queryRead(
            `SELECT
               COUNT(*)::int AS assessments,
               COUNT(DISTINCT ass.candidate_id)::int AS candidates,
               COUNT(DISTINCT ass.area_id)::int AS areas_active
             ${ANALYTICS_ASSESSMENT_JOIN}
             ${assessmentWhere}`,
            params
          ),
          queryRead(
            `SELECT ar.key AS "areaKey", ass.scores
             ${ANALYTICS_ASSESSMENT_JOIN}
             ${assessmentWhere}
             ORDER BY ass.created_at DESC
             LIMIT $${scoresParams.length}`,
            scoresParams
          ),
        ]);

        const scoresRowsByKey = {};
        for (const row of scoresAll.rows) {
          const k = row.areaKey;
          if (!scoresRowsByKey[k]) scoresRowsByKey[k] = [];
          scoresRowsByKey[k].push({ scores: row.scores });
        }

        const areaSummaries = buildAreaSummaries(
          distAgg.rows,
          areas,
          scoresRowsByKey,
          rubricByAreaKey
        ).map((s) => ({
          ...s,
          rubricAlignPct: rubricAlignmentShare(s.topTypeCounts, rubricByAreaKey[s.areaKey] || {}),
        }));
        const gCounts = globalTopTypeCounts(distAgg.rows);
        const gTotal = Object.values(gCounts).reduce((a, b) => a + b, 0);
        const tRow = totalsAgg.rows[0] || {};

        let leadershipPotentials = [];
        try {
          const potParams = [...params, LEADERSHIP_POTENTIALS_SCAN_CAP];
          const latestCand = await queryRead(
            `SELECT * FROM (
               SELECT DISTINCT ON (ass.candidate_id, ass.company_id)
                 ass.company_id AS "companyId",
                 co.name AS "companyName",
                 ass.candidate_id AS "candidateId",
                 cand.full_name AS name,
                 ass.scores,
                 ass.top_type AS "topType"
               FROM assessments ass
               JOIN candidates cand ON cand.id = ass.candidate_id
               JOIN companies co ON co.id = ass.company_id AND co.deleted = FALSE
               JOIN areas ar ON ar.id = ass.area_id
               LEFT JOIN vacancies v ON v.id = ass.vacancy_id
               ${assessmentWhere}
               ORDER BY ass.candidate_id, ass.company_id, ass.created_at DESC
             ) latest
             LIMIT $${potParams.length}`,
            potParams
          );
          leadershipPotentials = buildLeadershipPotentialsByCompany(latestCand.rows, {
            topPerCompany: 6,
          });
        } catch (le) {
          console.error('Failed to build leadership potentials by company:', le);
        }

        analytics = {
          kpis: {
            assessments: tRow.assessments ?? 0,
            candidates: tRow.candidates ?? 0,
            areasActive: tRow.areas_active ?? 0,
          },
          monthlyTrend: monthlyAgg.rows.map((r) => ({ period: r.period, cnt: r.cnt })),
          globalTopTypeCounts: gCounts,
          globalTotal: gTotal,
          areaSummaries,
          leadershipPotentials,
        };
      }
      } // end else (!needsCompanyScope)
    }
  } catch (e) {
    console.error('Failed to fetch results:', e);
  }

  return {
    results,
    pagination,
    compatMetrics,
    interactionPeople,
    selectedEnneagram: enneagram,
    areas,
    companies: companiesForFilter,
    counts,
    vacancies,
    selectedArea,
    selectedVacancy,
    selectedPipeline,
    selectedRoster,
    selectedListFilter,
    selectedCompany: scopeCompanyFilter != null ? String(scopeCompanyFilter) : 'all',
    selectedDateFrom,
    selectedDateTo,
    selectedSearch: nameSearch,
    selectedTeamGroup,
    areaStats,
    areaRubric,
    analytics,
    overviewMetrics,
    onboardingProgress,
  };
}
