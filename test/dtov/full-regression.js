/**
 * Regressão ampla (SQL + libs) — caça bugs “passados”, não o gate focado do DTOV smoke.
 *
 * Preferido (banco efêmero):
 *   npm run dtov:full
 *
 * Só a suíte (DB já seedado — DTOV ou outro Postgres com demo):
 *   DTOV=1 npm run test:full          # força alvo DTOV
 *   npm run test:full                 # usa POSTGRES_* do ambiente (.env) — cuidado
 *
 * Offline only (sem DB):
 *   npm run test:full -- --offline
 */

import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getPgBaseConfig } from '../../lib/pg-config.js';
import { DTOV_DEFAULTS, assertDtovTarget, dtovEnv } from './harness.js';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const DEMO_SLUG = 'todos-os-dados-demo';
const TOK = {
  company: 'd0d0todosdadose5f60718293a4b5c6d7e8f01',
  vacancyOpen: 'e1e1todosdadose5f60718293a4b5c6d7e8f02',
  report: 'a3a3todosdadose5f60718293a4b5c6d7e8f04a3a3todosdadose5f60718',
  aeInvite: 'b4b4todosdadose5f60718293a4b5c6d7e8f05',
};

const results = [];

function ok(suite, name, detail = '') {
  results.push({ suite, name, status: 'pass', detail });
  process.stdout.write(`  ✓ ${suite}/${name}${detail ? ` — ${detail}` : ''}\n`);
}

function fail(suite, name, detail) {
  results.push({ suite, name, status: 'fail', detail: String(detail || '') });
  process.stderr.write(`  ✗ ${suite}/${name} — ${detail}\n`);
}

async function check(suite, name, fn) {
  try {
    const detail = await fn();
    ok(suite, name, typeof detail === 'string' ? detail : '');
  } catch (e) {
    fail(suite, name, e?.message || e);
  }
}

async function runOfflineLibs() {
  process.stdout.write('\n== offline libs ==\n');

  await check('lib', 'ae-scoring', async () => {
    const { computeMotivatorScores } = await import('../../lib/ae/scoring.js');
    const questions = [
      {
        id: '1',
        questionType: 'forced_choice',
        weight: 1,
        options: [
          { id: 'a', weights: { autonomia: 4 } },
          { id: 'b', weights: { seguranca: 4 } },
        ],
      },
    ];
    const out = computeMotivatorScores({
      questions,
      answers: [{ questionId: '1', optionId: 'a' }],
    });
    if (!out || typeof out !== 'object') throw new Error('empty scores');
    return 'ok';
  });

  await check('lib', 'cohort-company-scope', async () => {
    const { resolveCohortCompanyId, assessmentListWhereParts } = await import(
      '../../lib/assessment-filters.js'
    );
    if (resolveCohortCompanyId({ isAdmin: true, companyId: 12, scopeCompanyFilter: null }) !== 12) {
      throw new Error('tenant-bound admin must default to home company');
    }
    if (resolveCohortCompanyId({ isAdmin: true, companyId: 12, scopeCompanyFilter: 99 }) !== 12) {
      throw new Error('tenant-bound admin must ignore other company chip');
    }
    if (resolveCohortCompanyId({ isAdmin: true, companyId: null, scopeCompanyFilter: null }) != null) {
      throw new Error('super-admin without chip must be unscoped');
    }
    const scoped = assessmentListWhereParts({
      isAdmin: true,
      companyId: 42,
      scopeCompanyFilter: null,
      selectedArea: 'all',
      selectedVacancy: 'all',
    });
    if (!scoped.whereParts.some((p) => p.includes('ass.company_id')) || scoped.params[0] !== 42) {
      throw new Error('assessmentListWhereParts missing tenant filter for bound admin');
    }
    return 'tenant-bound admin scoped';
  });

  await check('lib', 'decision-brief-exports', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = await readFile(join(root, 'lib', 'people', 'decision-brief.js'), 'utf8');
    for (const name of ['buildDecisionBrief', 'buildInterviewQuestions', 'buildTeamCompositionHints', 'buildNucleusCompositionAdvice', 'scorePersonAgainstNucleus']) {
      if (!src.includes(`export function ${name}`)) throw new Error(`missing ${name}`);
    }
    const wire = await readFile(join(root, 'lib', 'people', 'candidate-people-brief.js'), 'utf8');
    if (!wire.includes('decisionBrief')) throw new Error('candidate brief missing decisionBrief');
    const groups = await readFile(join(root, 'lib', 'people', 'team-groups.js'), 'utf8');
    for (const name of ['listTeamGroups', 'createTeamGroup', 'updateTeamGroup', 'softDeleteTeamGroup']) {
      if (!groups.includes(`export async function ${name}`)) throw new Error(`missing ${name}`);
    }
    return 'exports wired';
  });

  await check('lib', 'b600-pdi-retention-pulse', async () => {
    const { parseActionLinesFromRichText, isItemDueOverdue } = await import(
      '../../lib/people/pdi-action-lines.js'
    );
    const lines = parseActionLinesFromRichText(
      '<ul><li>Praticar feedback semanal</li><li>Revisar carga do time</li></ul>'
    );
    if (lines.length < 2) throw new Error(`parse lines ${lines.length}`);
    if (!isItemDueOverdue({ status: 'todo', dueDate: '2000-01-01' })) {
      throw new Error('expected overdue');
    }
    const { computeAreaScore010 } = await import('../../lib/area-fit.js');
    const fit = computeAreaScore010(
      { 1: 10, 2: 5, 3: 2 },
      { 1: 3, 2: 1 },
      { withBreakdown: true }
    );
    if (fit.score010 == null || !fit.breakdown?.types?.length) {
      throw new Error('fit breakdown missing');
    }
    if (!fit.breakdown.excludes?.includes('motivators')) throw new Error('excludes missing');
    const { importItemsFromOneOnOne, getCompanyPdiPulse } = await import(
      '../../lib/people/development-plans.js'
    );
    if (typeof importItemsFromOneOnOne !== 'function') throw new Error('missing importItemsFromOneOnOne');
    if (typeof getCompanyPdiPulse !== 'function') throw new Error('missing getCompanyPdiPulse');
    const fs = await import('node:fs/promises');
    const pulseSrc = await fs.readFile(
      new URL('../../lib/people/development-plans.js', import.meta.url),
      'utf8'
    );
    for (const marker of [
      'overdueItemCount',
      'noPlanEmployeeCount',
      'itemsWithoutOneOnOne',
      'queue:',
      'plans,',
      'PULSE_ACTIVE_PLANS_CAP',
    ]) {
      if (!pulseSrc.includes(marker)) throw new Error(`pdi pulse missing ${marker}`);
    }
    const { openRetentionFollowUp } = await import('../../lib/people/retention-followups.js');
    if (typeof openRetentionFollowUp !== 'function') throw new Error('missing openRetentionFollowUp');
    const { createTeamPulse, DEFAULT_TEAM_PULSE_PROMPTS } = await import(
      '../../lib/people/team-pulses.js'
    );
    if (typeof createTeamPulse !== 'function') throw new Error('missing createTeamPulse');
    if (DEFAULT_TEAM_PULSE_PROMPTS.length < 3) throw new Error('pulse prompts');
    const { buildTeamPulseReading } = await import('../../lib/people/team-pulses.js');
    const reading = buildTeamPulseReading({ overallMean: 4.2, locale: 'pt-BR', typeMix: [{ type: 5, n: 2 }] });
    if (!reading?.overallText || !reading?.mixText) throw new Error('pulse reading');
    const portalSrc = await fs.readFile(
      new URL('../../lib/people/employee-portal.js', import.meta.url),
      'utf8'
    );
    for (const name of ['createEmployeePortalToken', 'getEmployeePortalView']) {
      if (!portalSrc.includes(`export async function ${name}`)) {
        throw new Error(`missing ${name}`);
      }
    }
    return 'b600 helpers ok';
  });

  await check('lib', 'b701-onboarding-checkins', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../../lib/people/onboarding-checkins.js', import.meta.url),
      'utf8'
    );
    for (const name of [
      'ensureOnboardingCheckins',
      'listOnboardingCheckins',
      'updateOnboardingCheckin',
      'setOnboardingCheckinMeetUrl',
      'getCompanyOnboardingPulse',
    ]) {
      if (!src.includes(`export async function ${name}`)) throw new Error(`missing ${name}`);
    }
    const mig = await fs.readFile(
      new URL('../../migrations/049_onboarding_checkins.sql', import.meta.url),
      'utf8'
    );
    if (!mig.includes('employee_onboarding_checkins')) throw new Error('mig table');
    if (!mig.includes('onboarding')) throw new Error('mig source');
    const mig076 = await fs.readFile(
      new URL('../../migrations/076_employee_onboarding_journey.sql', import.meta.url),
      'utf8'
    );
    if (!mig076.includes('access_sheet')) throw new Error('mig076 access_sheet');
    if (!mig076.includes('employee_ack_at')) throw new Error('mig076 ack');
    return 'b701 onboarding ok';
  });

  await check('lib', 'employee-onboarding-journey', async () => {
    const { PRE_ONBOARDING_KEYS } = await import('../../lib/people/pre-onboarding.js');
    const {
      getEmployeeOnboardingJourney,
      buildOnboardingTasksFromJourney,
      employeeAckOnboardingItem,
    } = await import('../../lib/people/employee-onboarding-journey.js');
    if (!PRE_ONBOARDING_KEYS.includes('access_sheet')) {
      throw new Error('missing access_sheet key');
    }
    if (typeof getEmployeeOnboardingJourney !== 'function') throw new Error('missing get');
    const empty = buildOnboardingTasksFromJourney({ hasJourney: false });
    if (empty.length !== 0) throw new Error('expected no tasks');
    const ackBad = await employeeAckOnboardingItem(null, {
      companyId: 1,
      candidateId: 1,
      kind: 'nope',
      itemId: 1,
    });
    if (ackBad.ok) throw new Error('expected ack reject');
    return 'employee journey lib ok';
  });

  await check('lib', 'retention-watch-notif', async () => {
    const {
      NOTIF,
      NOTIF_TYPES,
      notificationHref,
      notificationCopySpec,
    } = await import('../../lib/manager-notification-catalog.js');
    const { retentionWatchMinScore, listCompanyRetentionWatches } = await import(
      '../../lib/people/retention-watch.js'
    );
    if (!NOTIF_TYPES.has(NOTIF.RETENTION_WATCH)) throw new Error('RETENTION_WATCH not in catalog');
    if (!NOTIF_TYPES.has(NOTIF.HIRE_ONBOARDING_KIT)) throw new Error('HIRE_ONBOARDING_KIT not in catalog');
    if (!NOTIF_TYPES.has(NOTIF.MANAGER_WEEKLY_DIGEST)) throw new Error('MANAGER_WEEKLY_DIGEST not in catalog');
    const min = retentionWatchMinScore();
    if (!(min >= 1 && min <= 100)) throw new Error(`bad min score ${min}`);
    if (typeof listCompanyRetentionWatches !== 'function') throw new Error('missing listCompanyRetentionWatches');
    const href = notificationHref(NOTIF.RETENTION_WATCH, { candidateId: 42 });
    if (!String(href).includes('candidate=42')) throw new Error(`bad href ${href}`);
    const hireHref = notificationHref(NOTIF.HIRE_ONBOARDING_KIT, { candidateId: 7 });
    if (!String(hireHref).includes('candidate=7')) throw new Error(`bad hire href ${hireHref}`);
    const digestHref = notificationHref(NOTIF.MANAGER_WEEKLY_DIGEST, {});
    if (!String(digestHref).includes('tab=overview')) throw new Error(`bad digest href ${digestHref}`);
    const spec = notificationCopySpec(NOTIF.RETENTION_WATCH, {
      candidateName: 'Ana',
      signalLabels: 'Equilíbrio',
    });
    if (spec.tone !== 'attention' || spec.category !== 'retention') {
      throw new Error(`bad spec ${JSON.stringify(spec)}`);
    }
    if (spec.titleKey !== 'dashboard.notifRetentionTitle') throw new Error('bad title key');
    const hireSpec = notificationCopySpec(NOTIF.HIRE_ONBOARDING_KIT, {
      candidateName: 'Bob',
      vacancyTitle: 'Dev',
    });
    if (hireSpec.titleKey !== 'dashboard.notifHireKitTitle' || hireSpec.tone !== 'success') {
      throw new Error(`bad hire spec ${JSON.stringify(hireSpec)}`);
    }
    const digestSpec = notificationCopySpec(NOTIF.MANAGER_WEEKLY_DIGEST, {
      retentionCount: 2,
      staleCount: 1,
      retentionNames: 'A',
      staleNames: 'B',
      attentionTotal: 3,
      attentionSummary: '2 hire gaps',
    });
    if (digestSpec.titleKey !== 'dashboard.notifWeeklyDigestTitle') {
      throw new Error(`bad digest spec ${JSON.stringify(digestSpec)}`);
    }
    if (Number(digestSpec.values?.attention) !== 3) {
      throw new Error(`digest missing attention ${JSON.stringify(digestSpec.values)}`);
    }
    return 'retention_watch + hire_kit + weekly_digest ok';
  });

  await check('lib', 'batch-motivators-invites', async () => {
    const {
      BATCH_INVITE_CAP,
      listInternalMotivatorsInviteRoster,
      batchCreateMotivatorsInvites,
    } = await import('../../lib/ae/batch-motivators-invites.js');
    if (BATCH_INVITE_CAP !== 25) throw new Error(`cap ${BATCH_INVITE_CAP}`);
    if (typeof listInternalMotivatorsInviteRoster !== 'function') throw new Error('list missing');
    if (typeof batchCreateMotivatorsInvites !== 'function') throw new Error('batch missing');
    const empty = await batchCreateMotivatorsInvites(async () => ({ rowCount: 0, rows: [] }), {
      companyId: 1,
      candidateIds: [],
      appBaseUrl: 'http://localhost',
    });
    if (empty.ok || empty.errorCode !== 'NO_CANDIDATES') {
      throw new Error(`expected NO_CANDIDATES got ${JSON.stringify(empty)}`);
    }
    return 'batch motivators helpers ok';
  });

  await check('lib', 'b400-remaining-helpers', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

    const { buildTypeMixCompositionAdvice, buildMixVsRubricAdvice } = await import('../../lib/overview-type-mix.js');
    const empty = buildTypeMixCompositionAdvice({});
    if (empty.kind !== 'empty') throw new Error('expected empty');
    const conc = buildTypeMixCompositionAdvice({ 3: 10, 1: 1, 2: 1 });
    if (conc.kind !== 'concentrated' || conc.dominantType !== 3) {
      throw new Error(`expected concentrated got ${JSON.stringify(conc)}`);
    }
    const rubric = buildMixVsRubricAdvice({ 3: 10, 1: 1 }, [{ 5: 2, 6: 2 }]);
    if (rubric.kind !== 'scarce_sought' || !rubric.scarceTypes?.includes(5)) {
      throw new Error(`expected scarce_sought got ${JSON.stringify(rubric)}`);
    }
    const { extractClimateThemes } = await import('../../lib/people/climate-themes.js');
    const themed = extractClimateThemes([
      { prompt: 'x', answers: ['muita carga de trabalho', 'falta reconhecimento'] },
    ]);
    if (!(themed.themes || []).some((t) => t.key === 'workload')) {
      throw new Error(`themes missing workload ${JSON.stringify(themed)}`);
    }

    const scoreSrc = await readFile(join(root, 'lib', 'people', 'interview-scorecard.js'), 'utf8');
    for (const name of ['draftScorecardItemsFromBrief', 'getInterviewScorecard', 'upsertInterviewScorecard']) {
      if (!scoreSrc.includes(`export function ${name}`) && !scoreSrc.includes(`export async function ${name}`)) {
        throw new Error(`missing ${name}`);
      }
    }

    const { buildClientReportPrintHtml } = await import('../../lib/client-report-print.js');
    const html = buildClientReportPrintHtml({
      data: {
        title: 'Dev',
        vacancy: { companyName: 'Acme' },
        candidates: [{ name: 'Ana', topType: 2, recommendation: 'Hire', whyFit: 'fit' }],
        note: 'ok',
      },
      labels: {
        executiveNote: 'Note',
        shortlistTitle: 'List {n}',
        colName: 'N',
        colRec: 'R',
        colFit: 'F',
        colType: 'T',
        colWhy: 'W',
      },
    });
    if (!html.includes('Ana') || !html.includes('Acme')) throw new Error('print html missing');
    return 'overview heat + scorecard + /r print ok';
  });

  await check('lib', 'b500-pdi-climate-helpers', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pdi = await readFile(join(root, 'lib', 'people', 'development-plans.js'), 'utf8');
    for (const name of ['listDevelopmentPlans', 'createDevelopmentPlan', 'addDevelopmentPlanItem', 'updateDevelopmentPlan', 'getCompanyPdiPulse']) {
      if (!pdi.includes(`export async function ${name}`)) throw new Error(`missing ${name}`);
    }
    const clima = await readFile(join(root, 'lib', 'people', 'climate-surveys.js'), 'utf8');
    for (const name of [
      'createClimateSurvey',
      'createClimateSurveyInvite',
      'createClimateSurveyInviteBatch',
      'addClimateSurveyQuestion',
      'emailClimateSurveyInvites',
      'resolveClimateInviteByToken',
      'submitClimateResponse',
      'getClimateSurveyAggregate',
      'getClimateCompanyBenchmark',
      'getCompanyClimatePulse',
      'getCompanyEnpsPulse',
      'climateMinResponses',
      'archiveClimateSurvey',
      'versionClimateSurvey',
      'climateQuestionsEditable',
    ]) {
      if (!clima.includes(`export async function ${name}`) && !clima.includes(`export function ${name}`)) {
        throw new Error(`missing ${name}`);
      }
    }
    const viz = await readFile(join(root, 'lib', 'people', 'climate-viz.js'), 'utf8');
    for (const name of ['climateMeanLevel', 'buildClimateTrendChart']) {
      if (!viz.includes(`export function ${name}`)) throw new Error(`missing viz ${name}`);
    }
    const { climateMeanLevel, buildClimateTrendChart } = await import('../../lib/people/climate-viz.js');
    const low = climateMeanLevel(2.0, 1, 5);
    const mid = climateMeanLevel(3.0, 1, 5);
    const high = climateMeanLevel(4.5, 1, 5);
    if (low?.level !== 'low' || mid?.level !== 'mid' || high?.level !== 'high') {
      throw new Error(`climateMeanLevel levels ${low?.level}/${mid?.level}/${high?.level}`);
    }
    const trend = buildClimateTrendChart([
      { surveyId: 1, title: 'A', overallMean: 2.5 },
      { surveyId: 2, title: 'B', overallMean: 3.5 },
      { surveyId: 3, title: 'C', overallMean: 4.0 },
    ]);
    if (!trend?.path || trend.points.length !== 3) throw new Error('trend chart');
    if (buildClimateTrendChart([{ surveyId: 1, title: 'A', overallMean: 3 }]) != null) {
      throw new Error('trend should need 2+');
    }
    if (!clima.includes('DEFAULT_CLIMATE_TEXT_PROMPTS_PT') || !clima.includes('textByQuestion')) {
      throw new Error('climate text questions missing');
    }
    if (!clima.includes('CLIMATE_QUESTION_KIND.ENPS') || !clima.includes('enpsScoreFromCounts')) {
      throw new Error('climate enps missing');
    }
    const nine = await readFile(join(root, 'lib', 'people', 'nine-box.js'), 'utf8');
    if (!nine.includes('loadNineBoxForCompany') || !nine.includes('nineBoxCellIndex')) {
      throw new Error('nine-box missing exports');
    }
    const mig050 = await readFile(join(root, 'migrations', '050_climate_text_questions.sql'), 'utf8');
    if (!mig050.includes('question_kind')) throw new Error('mig 050 missing kind');
    const mig = await readFile(join(root, 'migrations', '042_pdi_and_climate.sql'), 'utf8');
    if (!mig.includes('development_plans') || !mig.includes('climate_surveys')) {
      throw new Error('migration 042 missing tables');
    }
    const mig43 = await readFile(join(root, 'migrations', '043_pdi_item_one_on_one.sql'), 'utf8');
    if (!mig43.includes('one_on_one_id')) throw new Error('migration 043 missing');
    return 'pdi + climate B-501..506 ok';
  });

  await check('lib', 'vacancy-clone-and-aging', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const cloneSrc = await readFile(join(root, 'lib', 'vacancy-clone.js'), 'utf8');
    if (!cloneSrc.includes('export async function cloneVacancy')) throw new Error('missing cloneVacancy');
    const digestSrc = await readFile(join(root, 'lib', 'manager-weekly-digest.js'), 'utf8');
    if (!digestSrc.includes('export async function runManagerWeeklyDigest')) {
      throw new Error('missing runManagerWeeklyDigest');
    }
    const shared = await readFile(
      join(root, 'app', 'dashboard', 'vacancies', 'vacancy-admin-shared.js'),
      'utf8'
    );
    if (!shared.includes('export function daysInStage')) throw new Error('missing daysInStage');
    if (!shared.includes('export function stageAgingTone')) throw new Error('missing stageAgingTone');
    // Mirror stageAgingTone thresholds (B-406)
    const tone = (days, stage) => {
      if (days == null) return null;
      if (stage === 'hired' || stage === 'rejected' || stage === 'archived') return null;
      if (days >= 14) return 'danger';
      if (days >= 7) return 'warning';
      return null;
    };
    if (tone(3, 'interview') != null) throw new Error('aging young');
    if (tone(7, 'interview') !== 'warning') throw new Error('aging warn');
    if (tone(14, 'interview') !== 'danger') throw new Error('aging danger');
    if (tone(20, 'hired') != null) throw new Error('aging terminal');
    return 'clone + digest + aging helpers ok';
  });

  await check('lib', 'assessment-score-export', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = await readFile(join(root, 'lib', 'assessment-score.js'), 'utf8');
    if (!src.includes('export function computeAssessmentFromAnswers')) {
      throw new Error('missing computeAssessmentFromAnswers export');
    }
    return 'source ok (node ESM skips Next resolution of i18n)';
  });

  await check('lib', 'permissions-hr', async () => {
    const { can, CAP } = await import('../../lib/permissions.js');
    const hr = { role: 'hr', companyId: 1 };
    if (!can(hr, CAP.VACANCIES_VIEW)) throw new Error('hr should view vacancies');
    if (!can(hr, CAP.CLIMATE_VIEW)) throw new Error('hr should view climate');
    if (can(hr, CAP.USERS_MANAGE)) throw new Error('hr must not manage users');
    return 'hr ACL ok';
  });

  await check('lib', 'permissions-admin-only', async () => {
    const { ADMIN_ONLY_CAPS, resolveCapabilities } = await import('../../lib/permissions.js');
    const set = resolveCapabilities({ role: 'hr', companyId: 1 });
    for (const c of ADMIN_ONLY_CAPS) {
      if (set.has(c)) throw new Error(`hr leaked admin cap ${c}`);
    }
    return 'no admin leak';
  });
  await check('lib', 'sanitize-html', async () => {
    const {
      sanitizeInterviewNotesHtml,
      htmlToPlainText,
      normalizeAiRichTextHtml,
    } = await import('../../lib/sanitize-html.js');
    const dirty = '<p>oi</p><script>alert(1)</script>';
    const clean = sanitizeInterviewNotesHtml(dirty);
    if (/<script/i.test(clean)) throw new Error('script survived');
    if (!htmlToPlainText(clean).includes('oi')) throw new Error('text lost');

    const xss = sanitizeInterviewNotesHtml(
      '<p>ok</p><img src=x onerror=alert(1)><svg onload=alert(1)></svg><a href="javascript:evil">x</a>'
    );
    if (/<img|<svg|onerror|onload|javascript:/i.test(xss || '')) {
      throw new Error(`unsafe html survived: ${xss}`);
    }

    const linkOk = sanitizeInterviewNotesHtml('<p><a href="https://example.com">site</a></p>');
    if (!linkOk || !linkOk.includes('href="https://example.com"')) {
      throw new Error(`safe link stripped: ${linkOk}`);
    }

    const fromMd = normalizeAiRichTextHtml('```html\n## Sobre a vaga\n**Texto** com *marca*\n```');
    if (!fromMd || /```|\*\*|<strong|<em/i.test(fromMd)) {
      throw new Error(`markup leaked: ${fromMd}`);
    }
    if (!/<h2>/i.test(fromMd) || !htmlToPlainText(fromMd).includes('Sobre a vaga')) {
      throw new Error(`structure lost: ${fromMd}`);
    }
    return 'sanitized';
  });

  await check('lib', 'crawler-guard', async () => {
    const { isCrawlerNoIndexPath, robotsDisallowPaths } = await import('../../lib/crawler-guard.js');
    if (!isCrawlerNoIndexPath('/v/abc')) throw new Error('/v should noindex');
    if (!isCrawlerNoIndexPath('/t/abc')) throw new Error('/t should noindex');
    if (isCrawlerNoIndexPath('/jobs/engenheiro-1')) throw new Error('/jobs must stay indexable');
    if (isCrawlerNoIndexPath('/jobs')) throw new Error('/jobs index must stay indexable');
    if (isCrawlerNoIndexPath('/companies/acme')) throw new Error('/companies must stay indexable');
    const dis = robotsDisallowPaths();
    if (dis.some((p) => p.startsWith('/jobs'))) throw new Error('robots must not disallow jobs');
    if (!dis.includes('/t/')) throw new Error('robots missing /t/');
    const { buildRobotsRules, AI_CRAWLER_USER_AGENTS } = await import('../../lib/crawler-guard.js');
    const rules = buildRobotsRules();
    const gpt = rules.find((r) => r.userAgent === 'GPTBot');
    if (!gpt || !gpt.disallow?.includes('/dashboard') || !gpt.allow?.includes('/llms.txt')) {
      throw new Error('GPTBot rules wrong');
    }
    if (AI_CRAWLER_USER_AGENTS.length < 5) throw new Error('AI crawlers list too short');
    return 'jobs open, tokens blocked';
  });

  await check('lib', 'totp-optional-2fa', async () => {
    const { generateTotpSecret, verifyTotpCode, buildOtpAuthUrl } = await import('../../lib/totp.js');
    const { roleMayUse2Fa } = await import('../../lib/manager-2fa.js');
    if (!roleMayUse2Fa('admin') || !roleMayUse2Fa('hr') || !roleMayUse2Fa('direction')) {
      throw new Error('managers should use 2FA');
    }
    const secret = generateTotpSecret();
    if (secret.length < 16) throw new Error('short secret');
    const url = buildOtpAuthUrl({ secret, email: 'a@b.com' });
    if (!url.includes('otpauth://totp/')) throw new Error('bad otpauth url');
    if (verifyTotpCode(secret, 'abc')) throw new Error('reject non-digit');
    const vectorSecret = 'JBSWY3DPEHPK3PXP';
    const orig = Date.now;
    Date.now = () => 59 * 1000;
    try {
      if (!verifyTotpCode(vectorSecret, '996554')) throw new Error('RFC6238 vector failed');
    } finally {
      Date.now = orig;
    }
    return 'totp + manager/employee optional ok';
  });

  await check('lib', 'audit-log-admin', async () => {
    const { parseAuditLogListParams } = await import('../../lib/audit-log-admin.js');
    const { AUDIT_ACTOR_KIND } = await import('../../lib/audit.js');
    const p = parseAuditLogListParams({ page: '2', pageSize: '30', actorKind: 'employee', q: 'login' });
    if (p.page !== 2 || p.pageSize !== 30 || p.actorKind !== 'employee' || p.q !== 'login') {
      throw new Error(`parse failed ${JSON.stringify(p)}`);
    }
    if (!AUDIT_ACTOR_KIND.MANAGER) throw new Error('missing actor kind');
    return 'audit parse ok';
  });

  await check('lib', 'product-feedback', async () => {
    const {
      parseProductFeedbackListParams,
      PRODUCT_FEEDBACK_KIND,
      PRODUCT_FEEDBACK_STATUS,
    } = await import('../../lib/product-feedback.js');
    const p = parseProductFeedbackListParams({
      page: '2',
      pageSize: '10',
      status: 'new',
      kind: 'idea',
      q: 'radar',
    });
    if (p.page !== 2 || p.pageSize !== 10 || p.status !== 'new' || p.kind !== 'idea' || p.q !== 'radar') {
      throw new Error(`parse failed ${JSON.stringify(p)}`);
    }
    if (!PRODUCT_FEEDBACK_KIND.IDEA || !PRODUCT_FEEDBACK_STATUS.NEW) {
      throw new Error('missing constants');
    }
    return 'product-feedback parse ok';
  });

  await check('lib', 'employee-dp', async () => {
    const { parseLeaveListParams, DP_DOC_MAX_BYTES } = await import('../../lib/people/employee-dp.js');
    const { DP_LEAVE_STATUS, DP_DOCUMENT_STATUS, DP_DOCUMENT_KEYS } = await import(
      '../../lib/domain-status.js'
    );
    const p = parseLeaveListParams({
      page: '2',
      pageSize: '10',
      status: 'requested',
      leaveType: 'vacation',
      q: 'ana',
    });
    if (
      p.page !== 2 ||
      p.pageSize !== 10 ||
      p.status !== 'requested' ||
      p.leaveType !== 'vacation' ||
      p.q !== 'ana'
    ) {
      throw new Error(`parse failed ${JSON.stringify(p)}`);
    }
    if (!DP_LEAVE_STATUS.REQUESTED || !DP_DOCUMENT_STATUS.PENDING) {
      throw new Error('missing domain status');
    }
    if (!(DP_DOC_MAX_BYTES > 0) || !DP_DOCUMENT_KEYS.includes('contract')) {
      throw new Error('bad dp constants');
    }
    return 'employee-dp parse ok';
  });

  await check('lib', 'vacancy-public-allow-index-default', async () => {
    const { parseVacancyDetailsFromBody } = await import('../../lib/vacancy-details.js');
    const created = parseVacancyDetailsFromBody({}, { forCreate: true });
    if (created.publicAllowIndex !== true) {
      throw new Error(`expected publicAllowIndex true on create, got ${created.publicAllowIndex}`);
    }
    const off = parseVacancyDetailsFromBody({ publicAllowIndex: false }, { forCreate: true });
    if (off.publicAllowIndex !== false) throw new Error('explicit false ignored');
    return 'default on';
  });

  await check('lib', 'br-masks-salary', async () => {
    const {
      salaryAmountNumber,
      formatVacancySalaryRangeDisplay,
      formatCepBr,
      stripCep,
      formatCpfBr,
      stripCpf,
      formatPhoneBr,
    } = await import('../../lib/br-masks.js');
    assert.equal(stripCep('01310-100'), '01310100');
    assert.equal(formatCepBr('01310100'), '01310-100');
    assert.equal(stripCpf('529.982.247-25'), '52998224725');
    assert.equal(formatCpfBr('52998224725'), '529.982.247-25');
    assert.ok(formatPhoneBr('11987654321').includes('98765'));
    if (salaryAmountNumber('3500.00') !== 3500) throw new Error(`expected 3500 got ${salaryAmountNumber('3500.00')}`);
    const range = formatVacancySalaryRangeDisplay('3500.00', '5000.00');
    if (!range || !range.includes('3.500')) throw new Error(`bad range ${range}`);
    return range;
  });

  await check('lib', 'vacancy-description-mode', async () => {
    const {
      isVacancyDescriptionSparse,
      resolveVacancyDescriptionMode,
      buildVacancyDescriptionTemplate,
    } = await import('../../lib/vacancy-description-template.js');
    if (!isVacancyDescriptionSparse('')) throw new Error('empty should be sparse');
    if (resolveVacancyDescriptionMode('auto', '') !== 'draft') throw new Error('expected draft');
    if (resolveVacancyDescriptionMode('auto', `<p>${'x'.repeat(50)}</p>`) !== 'improve') {
      throw new Error('expected improve');
    }
    if (!buildVacancyDescriptionTemplate('pt-BR').includes('<h2>')) throw new Error('no template');
    return 'modes ok';
  });

  await check('lib', 'hire-readiness', async () => {
    const { computeHireReadiness } = await import('../../lib/hire-readiness.js');
    const empty = computeHireReadiness({});
    if (empty.ready || empty.readyCount !== 0) throw new Error('empty should not be ready');
    const partial = computeHireReadiness({
      assessmentId: 1,
      motivatorsAttemptId: 2,
      pipelineStage: 'interview',
      offerStatus: 'none',
    });
    if (partial.readyCount !== 2) throw new Error(`expected 2 got ${partial.readyCount}`);
    const ready = computeHireReadiness(
      {
        assessmentId: 1,
        motivatorsInviteStatus: 'completed',
        pipelineStage: 'approved',
        offerStatus: 'proposed',
      },
      { scorecardComplete: true }
    );
    if (!ready.ready) throw new Error('should be ready');
    if (!ready.checks.some((c) => c.id === 'SCORECARD' && c.ok)) {
      throw new Error('scorecard check missing');
    }
    return `empty=${empty.readyCount} ready=${ready.readyCount}/${ready.total}`;
  });

  await check('lib', 'help-assistant', async () => {
    const {
      matchHelpFaq,
      retrieveHelpChunks,
      buildHelpChunks,
      isHelpOutOfScope,
      helpAnswerLooksOffTopic,
      answerHelpQuestion,
    } = await import('../../lib/help-assistant.js');
    const { validateHelpGuideCoverage, HELP_GUIDE_SECTIONS } = await import('../../lib/help-sections.js');
    if (!isHelpOutOfScope('diagnóstico clínico')) throw new Error('scope clinical');
    if (!isHelpOutOfScope('receita de bolo de chocolate')) throw new Error('scope recipe');
    if (!isHelpOutOfScope('como está o clima amanhã?')) throw new Error('scope weather');
    if (!isHelpOutOfScope('explique javascript promises')) throw new Error('scope code');
    if (isHelpOutOfScope('como criar uma vaga?')) throw new Error('false positive vacancy');
    if (isHelpOutOfScope('pesquisa de clima na aba Clima')) throw new Error('false positive climate');
    if (!helpAnswerLooksOffTopic('Aqui vai a receita de bolo com farinha e ovo')) {
      throw new Error('drift recipe');
    }
    const cov = validateHelpGuideCoverage(['pt-BR', 'en']);
    if (!cov.ok) throw new Error(`help guide gaps: ${cov.missing.slice(0, 5).join(', ')}`);
    const faq = matchHelpFaq('como criar uma vaga?', 'pt-BR');
    if (!faq || faq.source !== 'faq') throw new Error('faq miss');
    const journeyFaq = matchHelpFaq('jornada de chegada minha chegada', 'pt-BR');
    if (!journeyFaq || journeyFaq.section !== 'b700Onboarding') throw new Error('faq journey miss');
    const compFaq = matchHelpFaq('onde vejo o salário do colaborador na equipe?', 'pt-BR');
    if (!compFaq || compFaq.section !== 'compensation') throw new Error('faq compensation miss');
    if (!String(compFaq.answer || '').includes('/dashboard?tab=compensation')) {
      throw new Error('faq compensation missing list link');
    }
    if (matchHelpFaq('salário da vaga na página pública', 'pt-BR')?.section === 'compensation') {
      throw new Error('faq compensation false positive vacancy');
    }
    if (isHelpOutOfScope('salário do colaborador na equipe')) {
      throw new Error('false positive compensation scope');
    }
    if (!isHelpOutOfScope('folha de pagamento holerite')) throw new Error('scope payroll');
    const cohortFaq = matchHelpFaq('visão geral pede para escolher empresa', 'pt-BR');
    if (!cohortFaq || cohortFaq.section !== 'dashboardCohort') throw new Error('faq cohort miss');
    const hrFaq = matchHelpFaq('o que é o hr score?', 'pt-BR');
    if (!hrFaq || hrFaq.section !== 'b1000HrScore') throw new Error('faq hr-score miss');
    const turnFaq = matchHelpFaq('radar de rotatividade varredura limitada', 'pt-BR');
    if (!turnFaq || turnFaq.section !== 'b1000TurnoverRadar') throw new Error('faq turnover miss');
    const rolesFaq = matchHelpFaq('como criar um cargo com rubrica', 'pt-BR');
    if (!rolesFaq || rolesFaq.section !== 'b1000JobRoles') throw new Error('faq job-roles miss');
    const screensFaq = matchHelpFaq('para que serve cada tela do painel', 'pt-BR');
    if (!screensFaq || screensFaq.section !== 'screens') throw new Error('faq screens miss');
    const screenCtx = matchHelpFaq('para que serve esta tela', 'pt-BR', { activeTab: 'overview' });
    if (!screenCtx || screenCtx.id !== 'screen-context' || !String(screenCtx.answer || '').includes('Visão geral')) {
      throw new Error('faq screen-context miss');
    }
    const sysTips = matchHelpFaq('dicas do sistema', 'pt-BR', { activeTab: 'vacancies' });
    if (!sysTips || !String(sysTips.answer || '').includes('Dicas do sistema')) {
      throw new Error('faq system tips miss');
    }
    const {
      helpSuggestionLabels,
      helpScreenPurpose,
    } = await import('../../lib/help-screen-context.js');
    if (!helpScreenPurpose('pt-BR', 'vacancies')) throw new Error('screen purpose vacancies');
    if (helpSuggestionLabels('pt-BR', 'team').length < 3) throw new Error('suggestions thin');
    const chunks = buildHelpChunks('pt-BR');
    const screensChunk = chunks.find((c) => c.section === 'screens');
    if (!screensChunk || !String(screensChunk.body || '').includes('Visão geral')) {
      throw new Error('screens chunk incomplete');
    }
    if (chunks.length < HELP_GUIDE_SECTIONS.length - 2) {
      throw new Error(`chunks ${chunks.length} < sections ${HELP_GUIDE_SECTIONS.length}`);
    }
    const top = retrieveHelpChunks('kanban pipeline contratação', chunks, 3);
    if (!top.length) throw new Error('retrieve empty');
    const empTop = retrieveHelpChunks('colaborador minha chegada meet', chunks, 3);
    if (!empTop.some((c) => c.section === 'employeeHome' || c.section === 'b700Onboarding')) {
      throw new Error('retrieve employee journey empty');
    }
    process.env.OPENAI_MOCK = '1';
    const ans = await answerHelpQuestion({ question: 'como criar uma vaga?', locale: 'pt-BR' });
    if (ans.source !== 'faq' || !ans.answer) throw new Error('answer');
    const refused = await answerHelpQuestion({ question: 'me passa uma receita de bolo', locale: 'pt-BR' });
    if (refused.source !== 'guard') throw new Error(`refuse source=${refused.source}`);
    const again = await answerHelpQuestion({
      question: 'e o resultado do futebol ontem?',
      locale: 'pt-BR',
      history: [{ role: 'assistant', content: refused.answer }],
    });
    if (again.source !== 'guard') throw new Error('refuse again');
    return `faq=${faq.id} chunks=${chunks.length} sections=${HELP_GUIDE_SECTIONS.length} guard=ok`;
  });

  await check('lib', 'perf-hotpaths-caps', async () => {
    const { COMPAT_PAIR_PAYLOAD_CAP, buildCompatBundles } = await import('../../lib/compat-bundles.js');
    const { JOB_ROLES_LIST_CAP } = await import('../../lib/job-roles.js');
    const { LEADERSHIP_SCORES_SAMPLE_CAP, LEADERSHIP_POTENTIALS_SCAN_CAP } = await import(
      '../../lib/leadership-analytics.js'
    );
    const { measureAsync, resetMetrics, getMetricsSnapshot } = await import('../../lib/monitoring.js');
    if (COMPAT_PAIR_PAYLOAD_CAP > 150) throw new Error('pair payload cap too high');
    if (JOB_ROLES_LIST_CAP !== 500) throw new Error('job roles cap');
    if (LEADERSHIP_SCORES_SAMPLE_CAP > 1000) throw new Error('leadership scores cap');
    if (LEADERSHIP_POTENTIALS_SCAN_CAP > 800) throw new Error('leadership potentials cap');
    const people = Array.from({ length: 40 }, (_, i) => ({
      assessmentId: i + 1,
      candidateId: i + 1,
      name: `P${i + 1}`,
      topType: (i % 9) + 1,
      areaLabel: 'Eng',
    }));
    const bundles = buildCompatBundles(people, 'pt-BR', { includePairs: true });
    if (bundles.pairs.length > COMPAT_PAIR_PAYLOAD_CAP) throw new Error('pairs not capped');
    resetMetrics();
    const v = await measureAsync('test.fullRegression', async () => 1);
    if (v !== 1) throw new Error('measureAsync');
    if (!getMetricsSnapshot().dbQueries['op:test.fullRegression']) throw new Error('metric miss');
    return `pairCap=${COMPAT_PAIR_PAYLOAD_CAP} rolesCap=${JOB_ROLES_LIST_CAP}`;
  });

  await check('lib', 'slugify-accents-specials', async () => {
    const { slugify } = await import('../../lib/slugify.js');
    if (slugify('São Paulo') !== 'sao-paulo') throw new Error(`São Paulo → ${slugify('São Paulo')}`);
    if (slugify('Ação & RH!') !== 'acao-rh') throw new Error(`Ação → ${slugify('Ação & RH!')}`);
    if (slugify('café') !== 'cafe') throw new Error(`café → ${slugify('café')}`);
    if (slugify('Engenheiro(a) Fullstack') !== 'engenheiro-a-fullstack') {
      throw new Error(slugify('Engenheiro(a) Fullstack'));
    }
    if (slugify('  ---  ') !== '') throw new Error('empty expected');
    if (slugify('x'.repeat(100), { maxLength: 8 }).length !== 8) throw new Error('maxLength');
    return 'slugify ok';
  });

  await check('lib', 'password-setup-invite-mask', async () => {
    const {
      generatePasswordSetupToken,
      maskEmail,
      PASSWORD_SETUP_TTL_MS,
    } = await import('../../lib/user-password-invite.js');
    const tok = generatePasswordSetupToken();
    if (!tok || tok.length < 20) throw new Error('token too short');
    if (maskEmail('hr@acme.com') !== 'hr***@acme.com') throw new Error(maskEmail('hr@acme.com'));
    if (PASSWORD_SETUP_TTL_MS < 24 * 60 * 60 * 1000) throw new Error('ttl too short');
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../lib/user-password-invite.js', import.meta.url), 'utf8')
    );
    if (!src.includes('signup_pending = TRUE')) {
      throw new Error('invite must allow signup_pending inactive users');
    }
    if (!src.includes('signup_pending = FALSE')) {
      throw new Error('completePasswordSetup must clear signup_pending');
    }
    return 'invite helpers ok';
  });

  await check('lib', 'file-magic', async () => {
    const { detectImageMimeFromBuffer, isPdfBuffer, bufferMatchesImageMime } = await import(
      '../../lib/file-magic.js'
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    if (detectImageMimeFromBuffer(png) !== 'image/png') throw new Error('png');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    if (detectImageMimeFromBuffer(jpeg) !== 'image/jpeg') throw new Error('jpeg');
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
    ]);
    if (detectImageMimeFromBuffer(webp) !== 'image/webp') throw new Error('webp');
    const pdf = Buffer.from('%PDF-1.4\n');
    if (!isPdfBuffer(pdf)) throw new Error('pdf');
    if (bufferMatchesImageMime(Buffer.alloc(8), 'image/png')) throw new Error('empty png');
    return 'magic bytes ok';
  });

  await check('lib', 'company-logo-validate', async () => {
    const {
      assertValidCompanyLogoFile,
      companyLogoObjectKey,
      isCompanyLogoStorageConfigured,
      COMPANY_LOGO_MAX_BYTES,
    } = await import('../../lib/company-logo.js');
    if (isCompanyLogoStorageConfigured()) throw new Error('expected storage off in offline/DTOV default');
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngBuf = Buffer.concat([pngSig, Buffer.alloc(92)]);
    const ok = assertValidCompanyLogoFile({
      mimeType: 'image/png',
      size: pngBuf.length,
      buffer: pngBuf,
    });
    if (ok.ext !== 'png') throw new Error('ext');
    try {
      assertValidCompanyLogoFile({
        mimeType: 'image/png',
        size: 100,
        buffer: Buffer.alloc(100),
      });
      throw new Error('fake png should fail magic');
    } catch (e) {
      if (e?.code !== 'INVALID_LOGO_TYPE') throw e;
    }
    try {
      assertValidCompanyLogoFile({ mimeType: 'image/svg+xml', size: 10 });
      throw new Error('svg should fail');
    } catch (e) {
      if (e?.code !== 'INVALID_LOGO_TYPE') throw e;
    }
    try {
      assertValidCompanyLogoFile({ mimeType: 'image/png', size: COMPANY_LOGO_MAX_BYTES + 1 });
      throw new Error('size should fail');
    } catch (e) {
      if (e?.code !== 'INVALID_LOGO_SIZE') throw e;
    }
    const key = companyLogoObjectKey(42, 'webp');
    if (!/^companies\/42\/[0-9a-f-]+\.webp$/i.test(key)) throw new Error(key);
    const prevPrefix = process.env.S3_KEY_PREFIX;
    process.env.S3_KEY_PREFIX = 'image/logo';
    const keyed = companyLogoObjectKey(7, 'png');
    if (!/^image\/logo\/companies\/7\/[0-9a-f-]+\.png$/i.test(keyed)) {
      if (prevPrefix == null) delete process.env.S3_KEY_PREFIX;
      else process.env.S3_KEY_PREFIX = prevPrefix;
      throw new Error(keyed);
    }
    if (prevPrefix == null) delete process.env.S3_KEY_PREFIX;
    else process.env.S3_KEY_PREFIX = prevPrefix;
    const { buildJobPostingJsonLd } = await import('../../lib/public-vacancy-posting.js');
    const ld = buildJobPostingJsonLd({
      status: 'open',
      publicAllowIndex: true,
      title: 'Dev',
      vacancyId: 9,
      showCompany: true,
      company: { name: 'Acme', logoUrl: 'https://cdn.example/logo.png' },
      createdAt: new Date('2026-01-01'),
    });
    if (ld?.hiringOrganization?.logo !== 'https://cdn.example/logo.png') {
      throw new Error('jsonld logo missing');
    }
    return 'logo helpers ok';
  });

  await check('lib', 'job-posting-jsonld-guards', async () => {
    const { buildJobPostingJsonLd, serializeJsonLdForScript } = await import(
      '../../lib/public-vacancy-posting.js'
    );
    const closed = buildJobPostingJsonLd({
      status: 'closed',
      publicAllowIndex: true,
      title: 'X',
      vacancyId: 1,
    });
    if (closed != null) throw new Error('closed must not emit JobPosting');
    const noIndex = buildJobPostingJsonLd({
      status: 'open',
      publicAllowIndex: false,
      title: 'X',
      vacancyId: 2,
    });
    if (noIndex != null) throw new Error('publicAllowIndex false must not emit JobPosting');
    const expired = buildJobPostingJsonLd({
      status: 'open',
      publicAllowIndex: true,
      title: 'X',
      vacancyId: 3,
      targetDate: '2020-01-01',
    });
    if (expired != null) throw new Error('past targetDate must not emit JobPosting');
    const open = buildJobPostingJsonLd({
      status: 'open',
      publicAllowIndex: true,
      title: 'Dev',
      vacancyId: 1,
      description: '<p>hi</p></script><p>x</p>',
      showSalary: true,
      salaryMin: '3500.00',
      salaryMax: null,
      showCompany: false,
      company: { id: 1 },
      pageUrl: 'http://localhost:3000/jobs/dev-1',
      createdAt: new Date('2026-01-15'),
      targetDate: new Date('2026-12-01'),
    });
    if (!open || open['@type'] !== 'JobPosting') throw new Error('expected JobPosting');
    if (open.baseSalary?.value?.minValue !== 3500) {
      throw new Error(`salary wrong: ${JSON.stringify(open.baseSalary)}`);
    }
    if (!String(open.validThrough || '').startsWith('2026-12-01')) {
      throw new Error(`validThrough missing: ${open.validThrough}`);
    }
    if (open.jobLocationType === 'TELECOMMUTE') {
      throw new Error('must not invent TELECOMMUTE without remote field');
    }
    if (!open.applicantLocationRequirements) throw new Error('expected BR applicantLocationRequirements');
    const remote = buildJobPostingJsonLd({
      status: 'open',
      publicAllowIndex: true,
      title: 'Dev remoto',
      vacancyId: 9,
      workplaceModality: 'remote',
      workplaceCity: 'São Paulo',
      workplaceState: 'SP',
      showCompany: false,
      company: { id: 1 },
      pageUrl: 'http://localhost:3000/jobs/dev-9',
      createdAt: new Date('2026-01-15'),
    });
    if (remote?.jobLocationType !== 'TELECOMMUTE') {
      throw new Error('remote modality should set TELECOMMUTE');
    }
    if (remote?.jobLocation?.address?.addressLocality !== 'São Paulo') {
      throw new Error('expected city in jobLocation');
    }
    const raw = serializeJsonLdForScript(open);
    if (raw.includes('</script>')) throw new Error('unescaped script closer');
    return 'jsonld ok';
  });

  await check('lib', 'job-share-utm', async () => {
    const { buildJobShareCopy, withShareUtm } = await import('../../lib/job-share-copy.js');
    const u = withShareUtm('https://app.example/jobs/dev-12', { source: 'whatsapp', medium: 'social' });
    if (!u.includes('utm_source=whatsapp') || !u.includes('utm_medium=social')) {
      throw new Error(`utm missing: ${u}`);
    }
    const pack = buildJobShareCopy(
      { title: 'Dev', companyName: 'Acme', pageUrl: 'https://app.example/jobs/dev-12' },
      'pt-BR'
    );
    if (!pack.whatsappShareHref.includes('wa.me')) throw new Error('whatsapp href');
    if (!pack.linkedinShareHref.includes('linkedin.com')) throw new Error('linkedin href');
    if (!pack.whatsappUrl.includes('utm_source=whatsapp')) throw new Error('wa utm');
    return 'share ok';
  });

  await check('lib', 'job-attribution-cookie-roundtrip', async () => {
    const {
      parseAttributionFromSearchParams,
      encodeAttributionCookie,
      decodeAttributionCookie,
      mergeAttribution,
      mapAttributionToCandidateSource,
      searchHasAttribution,
    } = await import('../../lib/job-attribution.js');
    const params = new URLSearchParams(
      'utm_source=linkedin&utm_medium=social&utm_campaign=share'
    );
    if (!searchHasAttribution(params)) throw new Error('searchHasAttribution');
    const attr = parseAttributionFromSearchParams(params, '/jobs/dev-12');
    if (!attr?.source || attr.source !== 'linkedin') {
      throw new Error(`parse ${JSON.stringify(attr)}`);
    }
    const encoded = encodeAttributionCookie(attr);
    const decoded = decodeAttributionCookie(encoded);
    if (!decoded || decoded.source !== 'linkedin' || decoded.sessionId !== attr.sessionId) {
      throw new Error(`roundtrip ${JSON.stringify(decoded)}`);
    }
    const merged = mergeAttribution(decoded, parseAttributionFromSearchParams(
      new URLSearchParams('utm_source=google'),
      '/jobs/other'
    ));
    if (merged.source !== 'linkedin') throw new Error('first-touch source must win');
    if (mapAttributionToCandidateSource(decoded) !== 'linkedin') {
      throw new Error('map linkedin');
    }
    if (mapAttributionToCandidateSource({ ref: 'X' }) !== 'referral') {
      throw new Error('map referral');
    }
    return 'attr ok';
  });

  await check('lib', 'job-funnel-pipeline-map', async () => {
    const { pipelineStageToFunnelEvent, FUNNEL_EVENT_TYPES } = await import('../../lib/job-funnel.js');
    if (pipelineStageToFunnelEvent('interview') !== 'interview') throw new Error('interview');
    if (pipelineStageToFunnelEvent('approved') !== 'screening') throw new Error('approved→screening');
    if (pipelineStageToFunnelEvent('new') != null) throw new Error('new must be null');
    if (!FUNNEL_EVENT_TYPES.has('apply_complete')) throw new Error('types');
    return 'funnel map ok';
  });

  await check('lib', 'referral-code-normalize', async () => {
    const { normalizeReferralCode } = await import('../../lib/referral-codes.js');
    if (normalizeReferralCode('ab-c') !== 'AB-C') throw new Error('normalize');
    if (normalizeReferralCode('x') != null) throw new Error('too short');
    if (normalizeReferralCode('@@@') != null) throw new Error('invalid chars');
    return 'referral normalize ok';
  });

  await check('lib', 'public-job-key-canonical', async () => {
    const {
      parsePublicJobKey,
      publicVacancyPath,
    } = await import('../../lib/public-vacancy-posting.js');
    const path = publicVacancyPath({ vacancySlug: 'dev-senior', vacancyId: 42 });
    if (path !== '/jobs/dev-senior-42') throw new Error(`path ${path}`);
    const parsed = parsePublicJobKey('dev-senior-42');
    if (!parsed || parsed.id !== 42 || parsed.slug !== 'dev-senior') {
      throw new Error(`parse ${JSON.stringify(parsed)}`);
    }
    if (parsePublicJobKey('42')?.id !== 42) throw new Error('id-only parse');
    return 'canonical ok';
  });

  await check('lib', 'job-indexing-mock-sync', async () => {
    process.env.GOOGLE_INDEXING_ENABLED = 'true';
    process.env.GOOGLE_INDEXING_MOCK = '1';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
    const {
      __resetJobIndexingMockLog,
      __getJobIndexingMockLog,
      isGoogleIndexingEnabled,
      publishJob,
      syncVacancyIndex,
      vacancyShouldBeIndexed,
    } = await import('../../lib/job-indexing.js');
    __resetJobIndexingMockLog();
    if (!isGoogleIndexingEnabled()) throw new Error('expected enabled');
    if (!vacancyShouldBeIndexed({
      status: 'open',
      publicPageEnabled: true,
      publicAllowIndex: true,
      targetDate: '2099-01-01',
    })) {
      throw new Error('should index');
    }
    const pub = await publishJob('https://app.example/jobs/dev-9');
    if (!pub.ok || !pub.mocked) throw new Error('publish mock');
    const closed = await syncVacancyIndex({
      previous: {
        id: 9,
        slug: 'dev',
        status: 'open',
        publicPageEnabled: true,
        publicAllowIndex: true,
      },
      current: {
        id: 9,
        slug: 'dev',
        status: 'closed',
        publicPageEnabled: true,
        publicAllowIndex: true,
      },
      reason: 'test_close',
    });
    if (!closed.ok) throw new Error('sync close');
    const log = __getJobIndexingMockLog();
    if (!log.some((e) => e.event === 'job_indexing_requested' && e.type === 'URL_UPDATED')) {
      throw new Error('missing URL_UPDATED request');
    }
    if (!log.some((e) => e.event === 'job_closed')) throw new Error('missing job_closed');
    if (!log.some((e) => e.event === 'job_indexing_requested' && e.type === 'URL_DELETED')) {
      throw new Error('missing URL_DELETED request');
    }
    process.env.GOOGLE_INDEXING_ENABLED = 'false';
    const off = await publishJob('https://app.example/jobs/dev-9');
    if (!off.skipped) throw new Error('disabled should skip');
    return `mock events=${log.length}`;
  });

  await check('lib', 'smtp-mock-capture', async () => {
    const prev = {
      SMTP_MOCK: process.env.SMTP_MOCK,
      SMTP_HOST: process.env.SMTP_HOST,
      MAIL_FROM: process.env.MAIL_FROM,
      DTOV: process.env.DTOV,
    };
    process.env.SMTP_MOCK = '1';
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    delete process.env.DTOV;
    const {
      __resetMailMockLog,
      __getMailMockLog,
      isMailConfigured,
      isSmtpMock,
      sendTransactionalMail,
      verifySmtpConnection,
    } = await import('../../lib/mail.js');
    __resetMailMockLog();
    if (!isSmtpMock()) throw new Error('expected smtp mock');
    if (!isMailConfigured()) throw new Error('mock should count as configured');
    const verify = await verifySmtpConnection();
    if (!verify.ok || !verify.mocked) throw new Error('verify mock');
    await sendTransactionalMail({
      to: 'cand@example.com',
      subject: 'DTOV invite',
      text: 'Hello from mock SMTP',
    });
    const log = __getMailMockLog();
    if (log.length !== 1) throw new Error(`expected 1 send, got ${log.length}`);
    if (log[0].to !== 'cand@example.com' || log[0].subject !== 'DTOV invite') {
      throw new Error(`bad mock payload ${JSON.stringify(log[0])}`);
    }
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    return 'smtp mock ok';
  });

  await check('lib', 'openai-mock-assistants', async () => {
    const prev = {
      OPENAI_MOCK: process.env.OPENAI_MOCK,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DTOV: process.env.DTOV,
    };
    process.env.OPENAI_MOCK = '1';
    delete process.env.OPENAI_API_KEY;
    delete process.env.DTOV;
    const {
      __resetOpenAiMockLog,
      __getOpenAiMockLog,
      buildOpenAiMockCompletion,
      extractJsonObject,
      isOpenAiConfigured,
      isOpenAiMock,
      openAiChatCompletion,
    } = await import('../../lib/openai-chat.js');
    __resetOpenAiMockLog();
    if (!isOpenAiMock()) throw new Error('expected openai mock');
    if (!isOpenAiConfigured()) throw new Error('mock should count as configured');

    const weightsRaw = await openAiChatCompletion({
      messages: [
        { role: 'system', content: 'Return JSON weights for T1–T9.' },
        { role: 'user', content: 'Suggest rubric weights JSON for this vacancy context.' },
      ],
    });
    const weightsObj = JSON.parse(extractJsonObject(weightsRaw));
    const w = weightsObj.weights || weightsObj;
    if (Number(w['5']) !== 3) throw new Error(`bad weight stub ${weightsRaw.slice(0, 80)}`);

    const htmlRaw = await openAiChatCompletion({
      messages: [
        { role: 'system', content: 'Write an executive HTML note with hedging.' },
        { role: 'user', content: 'Return ONLY the HTML note for the shortlist.' },
      ],
    });
    if (!htmlRaw.includes('<p>') || htmlRaw.length < 80) throw new Error('html stub short');

    const shortlistStub = buildOpenAiMockCompletion({
      messages: [
        {
          role: 'system',
          content: 'Return ONLY valid JSON: {"candidateIds":[1,2],"rationaleHtml":"<p>...</p>"}',
        },
        { role: 'user', content: 'Candidates: [{"candidateId": 11, "name": "Ana"}]' },
      ],
    });
    const shortlist = JSON.parse(extractJsonObject(shortlistStub));
    if (!Array.isArray(shortlist.candidateIds) || !shortlist.candidateIds.includes(11)) {
      throw new Error(`shortlist stub ${shortlistStub}`);
    }

    const log = __getOpenAiMockLog();
    if (log.length < 2) throw new Error(`expected mock calls, got ${log.length}`);
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    return `openai mock calls=${log.length}`;
  });

  await check('lib', 'public-vacancy-lifecycle-meta', async () => {
    const {
      isVacancyTargetDatePast,
      postingDocumentTitle,
      publicVacancyShowsClosedExperience,
      buildJobPostingJsonLd,
    } = await import('../../lib/public-vacancy-posting.js');
    const now = new Date('2026-08-22T12:00:00Z');
    if (!isVacancyTargetDatePast('2026-08-01', now)) throw new Error('expected past');
    if (isVacancyTargetDatePast('2026-08-30', now)) throw new Error('expected future');
    const open = {
      status: 'open',
      title: 'Dev',
      showCompany: true,
      company: { name: 'Acme' },
      publicAllowIndex: true,
      vacancyId: 9,
      createdAt: new Date('2026-01-01'),
    };
    const title = postingDocumentTitle(open, 'pt-BR');
    if (title !== 'Dev | Acme') throw new Error(`title ${title}`);
    const expired = { ...open, targetDate: '2026-08-01', publicAllowIndex: false };
    if (!publicVacancyShowsClosedExperience(expired, now)) throw new Error('expired closed');
    if (buildJobPostingJsonLd(expired, 'pt-BR') != null) throw new Error('no jsonld expired');
    return 'lifecycle ok';
  });
}

async function runSqlSuite(client) {
  process.stdout.write('\n== sql integrity (demo tenant) ==\n');

  const company = await client.query(
    `SELECT id FROM companies WHERE slug = $1 AND deleted = FALSE LIMIT 1`,
    [DEMO_SLUG]
  );
  if (!company.rowCount) {
    fail('sql', 'demo-company', `missing company slug=${DEMO_SLUG} — run npm run dtov:reset`);
    return;
  }
  const companyId = company.rows[0].id;
  ok('sql', 'demo-company', `id=${companyId}`);

  await check('sql', 'schema-migrations', async () => {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`);
    if (r.rows[0].n < 20) throw new Error(`too few migrations: ${r.rows[0].n}`);
    return `${r.rows[0].n} applied`;
  });

  await check('sql', 'soft-delete-companies', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM companies WHERE deleted = TRUE AND slug = $1`,
      [DEMO_SLUG]
    );
    // live demo must not be deleted
    const live = await client.query(
      `SELECT 1 FROM companies WHERE id = $1 AND deleted = FALSE`,
      [companyId]
    );
    if (!live.rowCount) throw new Error('demo company deleted');
    return `tombstones=${r.rows[0].n}`;
  });

  await check('sql', 'hr-user', async () => {
    const r = await client.query(
      `SELECT id, role FROM users WHERE company_id = $1 AND LOWER(email) = $2 AND deleted = FALSE`,
      [companyId, 'hr@todos-os-dados.demo']
    );
    if (!r.rowCount || r.rows[0].role !== 'hr') throw new Error('hr user missing');
    return `id=${r.rows[0].id}`;
  });

  await check('sql', 'direction-user', async () => {
    const r = await client.query(
      `SELECT 1 FROM users WHERE company_id = $1 AND role = 'direction' AND deleted = FALSE LIMIT 1`,
      [companyId]
    );
    if (!r.rowCount) throw new Error('direction user missing');
  });

  await check('sql', 'company-link-token', async () => {
    const r = await client.query(
      `SELECT 1 FROM company_links WHERE company_id = $1 AND token = $2 AND active = TRUE LIMIT 1`,
      [companyId, TOK.company]
    );
    if (!r.rowCount) throw new Error('company link token missing');
  });

  await check('sql', 'vacancy-open-link', async () => {
    const r = await client.query(
      `SELECT v.id FROM vacancies v
       JOIN vacancy_links l ON l.vacancy_id = v.id
       WHERE v.company_id = $1 AND l.token = $2 AND v.status = 'open' AND v.deleted = FALSE
       LIMIT 1`,
      [companyId, TOK.vacancyOpen]
    );
    if (!r.rowCount) throw new Error('open vacancy link missing');
  });

  await check('sql', 'vacancy-closed-exists', async () => {
    const r = await client.query(
      `SELECT 1 FROM vacancies WHERE company_id = $1 AND status = 'closed' AND deleted = FALSE LIMIT 1`,
      [companyId]
    );
    if (!r.rowCount) throw new Error('no closed vacancy');
  });

  await check('sql', 'public-page-open-indexed', async () => {
    const r = await client.query(
      `SELECT 1 FROM vacancies
       WHERE company_id = $1 AND public_page_enabled AND public_allow_index AND status = 'open'
         AND deleted = FALSE LIMIT 1`,
      [companyId]
    );
    if (!r.rowCount) throw new Error('missing public indexed open vacancy — seed public-vacancy-page');
  });

  await check('sql', 'public-page-closed', async () => {
    const r = await client.query(
      `SELECT 1 FROM vacancies
       WHERE company_id = $1 AND public_page_enabled AND status = 'closed' AND deleted = FALSE LIMIT 1`,
      [companyId]
    );
    if (!r.rowCount) throw new Error('missing public closed vacancy');
  });

  await check('sql', 'company-website-about', async () => {
    const r = await client.query(
      `SELECT website, about_html FROM companies WHERE id = $1`,
      [companyId]
    );
    if (!r.rows[0]?.website || !r.rows[0]?.about_html) throw new Error('company profile empty');
  });

  await check('sql', 'candidates-in-company', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM candidates WHERE company_id = $1`,
      [companyId]
    );
    if (r.rows[0].n < 3) throw new Error(`expected several candidates, got ${r.rows[0].n}`);
    return `${r.rows[0].n} candidates`;
  });

  await check('sql', 'assessments-present', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM assessments a
       JOIN candidates c ON c.id = a.candidate_id
       WHERE c.company_id = $1`,
      [companyId]
    );
    if (r.rows[0].n < 1) throw new Error('no assessments');
    return `${r.rows[0].n} assessments`;
  });

  await check('sql', 'pipeline-stages', async () => {
    const r = await client.query(
      `SELECT COUNT(DISTINCT pipeline_stage)::int AS n
       FROM vacancy_candidates vc
       JOIN vacancies v ON v.id = vc.vacancy_id
       WHERE v.company_id = $1`,
      [companyId]
    );
    if (r.rows[0].n < 2) throw new Error(`narrow pipeline diversity: ${r.rows[0].n}`);
    return `${r.rows[0].n} stages`;
  });

  await check('sql', 'motivators-definition', async () => {
    const r = await client.query(
      `SELECT 1 FROM ae_definitions WHERE LOWER(slug) = 'motivators' AND active = TRUE LIMIT 1`
    );
    if (!r.rowCount) throw new Error('motivators def missing');
  });

  await check('sql', 'motivators-questions', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM ae_questions q
       JOIN ae_definitions d ON d.id = q.definition_id
       WHERE LOWER(d.slug) = 'motivators' AND q.active = TRUE`
    );
    if (r.rows[0].n < 5) throw new Error(`few questions: ${r.rows[0].n}`);
    return `${r.rows[0].n} questions`;
  });

  await check('sql', 'ae-invite-token', async () => {
    const r = await client.query(
      `SELECT 1 FROM ae_invites WHERE token = $1 AND company_id = $2 LIMIT 1`,
      [TOK.aeInvite, companyId]
    );
    if (!r.rowCount) throw new Error('ae invite token missing');
  });

  await check('sql', 'one-on-ones', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM one_on_ones o
       JOIN candidates c ON c.id = o.candidate_id
       WHERE c.company_id = $1`,
      [companyId]
    );
    if (r.rows[0].n < 1) throw new Error('no 1:1 rows');
    return `${r.rows[0].n} one_on_ones`;
  });

  await check('sql', 'report-share-token', async () => {
    const r = await client.query(
      `SELECT 1 FROM vacancy_report_shares WHERE token = $1 LIMIT 1`,
      [TOK.report]
    );
    if (!r.rowCount) throw new Error('report share token missing');
  });

  await check('sql', 'tenant-isolation-sample', async () => {
    // Candidates of demo company must not reference another company_id via join mistakes
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM assessments a
       JOIN candidates c ON c.id = a.candidate_id
       WHERE c.company_id = $1 AND a.vacancy_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM vacancies v WHERE v.id = a.vacancy_id AND v.company_id = c.company_id
         )`,
      [companyId]
    );
    if (r.rows[0].n > 0) throw new Error(`${r.rows[0].n} assessments with cross-tenant vacancy`);
    return 'no cross-tenant vacancy link';
  });

  await check('sql', 'orphan-vacancy-links', async () => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM vacancy_links l
       LEFT JOIN vacancies v ON v.id = l.vacancy_id
       WHERE v.id IS NULL`
    );
    if (r.rows[0].n > 0) throw new Error(`${r.rows[0].n} orphan vacancy_links`);
  });

  // Lib resolve against live DTOV data
  await check('sql', 'resolve-public-vacancy-open', async () => {
    const { resolvePublicVacancyPosting } = await import('../../lib/public-vacancy-posting.js');
    const company = await client.query(`SELECT slug FROM companies WHERE id = $1`, [companyId]);
    const vac = await client.query(
      `SELECT slug FROM vacancies
       WHERE company_id = $1 AND public_page_enabled AND status = 'open' AND deleted = FALSE
       LIMIT 1`,
      [companyId]
    );
    const resolved = await resolvePublicVacancyPosting(company.rows[0].slug, vac.rows[0].slug);
    if (!resolved.ok) throw new Error(resolved.errorCode || 'resolve failed');
    if (resolved.posting.status !== 'open') throw new Error('expected open');
    if (!String(resolved.canonicalPath || '').includes(`-${resolved.posting.vacancyId}`)) {
      throw new Error(`canonical missing id: ${resolved.canonicalPath}`);
    }
    return resolved.posting.title;
  });

  await check('sql', 'resolve-public-vacancy-by-id', async () => {
    const { resolvePublicVacancyPostingById, publicVacancyPath } = await import(
      '../../lib/public-vacancy-posting.js'
    );
    const vac = await client.query(
      `SELECT id, slug FROM vacancies
       WHERE company_id = $1 AND public_page_enabled AND status = 'open' AND deleted = FALSE
       LIMIT 1`,
      [companyId]
    );
    const row = vac.rows[0];
    const wrongSlug = await resolvePublicVacancyPostingById(row.id, 'slug-antigo-errado');
    if (!wrongSlug.ok || !wrongSlug.slugMismatch) throw new Error('expected slugMismatch');
    const expectPath = publicVacancyPath({ vacancySlug: row.slug, vacancyId: row.id });
    if (wrongSlug.canonicalPath !== expectPath) {
      throw new Error(`canonical ${wrongSlug.canonicalPath} != ${expectPath}`);
    }
    const ok = await resolvePublicVacancyPostingById(row.id, row.slug);
    if (!ok.ok || ok.slugMismatch) throw new Error('expected match');
    return expectPath;
  });

  await check('sql', 'sitemap-public-entries', async () => {
    const { listSitemapPublicEntries } = await import('../../lib/public-vacancy-posting.js');
    const entries = await listSitemapPublicEntries({ limit: 100 });
    if (!Array.isArray(entries) || !entries.length) {
      throw new Error('expected ≥1 sitemap entry from public-vacancy-page seed');
    }
    const hit = entries.find((e) => String(e.path || '').includes('/jobs/') && /-\d+$/.test(e.path));
    if (!hit) throw new Error('no /jobs/{slug}-{id} path in sitemap entries');
    const closed = await client.query(
      `SELECT v.slug FROM vacancies v
       WHERE v.company_id = $1 AND v.status = 'closed' AND v.public_page_enabled AND v.deleted = FALSE
       LIMIT 1`,
      [companyId]
    );
    if (closed.rows[0]) {
      const closedPath = closed.rows[0].slug;
      if (entries.some((e) => String(e.path || '').includes(`/${closedPath}`))) {
        throw new Error('closed vacancy must not appear in sitemap list');
      }
    }
    return `${entries.length} entries`;
  });

  await check('sql', 'vacancy-funnel-analytics', async () => {
    const { getVacancyFunnelAnalytics } = await import('../../lib/job-funnel.js');
    const vac = await client.query(
      `SELECT id FROM vacancies
       WHERE company_id = $1 AND slug = 'engenheiro-fullstack-plataforma' AND deleted = FALSE
       LIMIT 1`,
      [companyId]
    );
    if (!vac.rowCount) throw new Error('missing open vacancy');
    const stats = await getVacancyFunnelAnalytics({
      vacancyId: vac.rows[0].id,
      companyId,
      isAdmin: false,
    });
    if (!stats.ok) throw new Error(stats.errorCode || 'analytics failed');
    if (stats.views < 1) throw new Error(`expected seeded views, got ${stats.views}`);
    if (stats.applications < 1) throw new Error(`expected seeded applications`);
    if (!Array.isArray(stats.sources) || !stats.sources.length) {
      throw new Error('expected sources breakdown');
    }
    return `views=${stats.views} apps=${stats.applications}`;
  });

  await check('sql', 'referral-analytics', async () => {
    const { getReferralAnalytics, findActiveReferralCode } = await import(
      '../../lib/referral-codes.js'
    );
    const found = await findActiveReferralCode('dtovref', { companyId });
    if (!found || found.code !== 'DTOVREF') throw new Error('missing DTOVREF code');
    const stats = await getReferralAnalytics({ companyId, isAdmin: false });
    if (!stats.ok) throw new Error(stats.errorCode || 'analytics failed');
    const row = (stats.items || []).find((i) => i.code === 'DTOVREF');
    if (!row) throw new Error('DTOVREF not in analytics');
    if (row.views < 1 || row.applications < 1 || row.hires < 1) {
      throw new Error(`unexpected counts ${JSON.stringify(row)}`);
    }
    if (!row.registered) throw new Error('expected registered meta');
    return `DTOVREF views=${row.views} hires=${row.hires}`;
  });

  await check('lib', 'job-seo-score', async () => {
    const { computeJobSeoScore } = await import('../../lib/job-seo-score.js');
    const weak = computeJobSeoScore({ title: 'Dev', publicPageEnabled: false });
    const strong = computeJobSeoScore({
      title: 'Engenheiro Fullstack Plataforma',
      description: `${'x'.repeat(300)}`,
      employmentType: 'clt',
      workplaceModality: 'hybrid',
      salaryMin: '5000',
      salaryMax: '8000',
      publicPageEnabled: true,
      publicAllowIndex: true,
      publicShowCompanyInfo: true,
      companyWebsite: 'https://example.com',
      companyAboutHtml: '<p>Sobre a empresa com texto longo suficiente aqui.</p>',
    });
    if (weak.score >= strong.score) throw new Error('strong should score higher');
    if (strong.score < 80) throw new Error(`expected high score got ${strong.score}`);
    return `weak=${weak.score} strong=${strong.score}`;
  });

  await check('lib', 'job-alerts-dispatch-gates', async () => {
    const {
      shouldDispatchJobAlerts,
      jobAlertMatchesVacancy,
      vacancyIsAlertablePublic,
    } = await import('../../lib/job-alerts.js');
    const openPub = {
      id: 1,
      title: 'Engenheiro Fullstack',
      status: 'open',
      publicPageEnabled: true,
      employmentType: 'clt',
    };
    const closed = { ...openPub, status: 'closed' };
    if (!vacancyIsAlertablePublic(openPub)) throw new Error('open public should alert');
    if (vacancyIsAlertablePublic(closed)) throw new Error('closed should not');
    if (!shouldDispatchJobAlerts({ previous: null, current: openPub })) {
      throw new Error('create should dispatch');
    }
    if (shouldDispatchJobAlerts({ previous: openPub, current: openPub })) {
      throw new Error('cosmetic update must not dispatch');
    }
    if (
      !shouldDispatchJobAlerts({
        previous: { ...openPub, publicPageEnabled: false },
        current: openPub,
      })
    ) {
      throw new Error('off→on should dispatch');
    }
    if (!jobAlertMatchesVacancy({ q: 'fullstack', employmentType: 'clt' }, openPub)) {
      throw new Error('filters should match');
    }
    if (jobAlertMatchesVacancy({ employmentType: 'pj' }, openPub)) {
      throw new Error('employment mismatch');
    }
    return 'gates ok';
  });

  await check('lib', 'public-jobs-index-paged', async () => {
    const { listOpenPublicVacancies } = await import('../../lib/public-vacancy-posting.js');
    const page1 = await listOpenPublicVacancies({ page: 1, pageSize: 1, includeTotal: true });
    if (!page1 || !Array.isArray(page1.items)) throw new Error('expected paged shape');
    if (typeof page1.total !== 'number' || page1.total < 1) throw new Error('expected total>=1');
    if (page1.items.length !== 1) throw new Error('pageSize 1');
    const filtered = await listOpenPublicVacancies({
      q: 'Engenheiro',
      page: 1,
      pageSize: 12,
      includeTotal: true,
    });
    if (!filtered.total) throw new Error('search should find demo fullstack role');
    return `total=${page1.total} search=${filtered.total}`;
  });

  await check('lib', 'public-job-aggregators', async () => {
    const prev = process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT;
    process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT = '1';
    const {
      citySlugFromName,
      aggregatorMinCount,
      resolveRemoteAggregator,
      resolveCityAggregator,
    } = await import('../../lib/public-job-aggregators.js');
    const { listOpenPublicVacancies } = await import('../../lib/public-vacancy-posting.js');

    if (citySlugFromName('São Paulo') !== 'sao-paulo') {
      throw new Error(`slug ${citySlugFromName('São Paulo')}`);
    }
    if (aggregatorMinCount() !== 1) throw new Error(`min=${aggregatorMinCount()}`);

    await client.query(
      `UPDATE vacancies
       SET workplace_modality = 'remote',
           workplace_city = 'São Paulo',
           workplace_state = 'SP'
       WHERE deleted = FALSE
         AND public_page_enabled = TRUE
         AND public_allow_index = TRUE
         AND status = 'open'
         AND (target_date IS NULL OR target_date >= CURRENT_DATE)`
    );

    const remoteListed = await listOpenPublicVacancies({
      workplaceModality: 'remote',
      page: 1,
      pageSize: 5,
      includeTotal: true,
    });
    if (!remoteListed.total) throw new Error('workplaceModality filter empty');

    const cityListed = await listOpenPublicVacancies({
      workplaceCity: 'São Paulo',
      page: 1,
      pageSize: 5,
      includeTotal: true,
    });
    if (!cityListed.total) throw new Error('workplaceCity filter empty');

    const remote = await resolveRemoteAggregator();
    if (!remote.ok) throw new Error('remote aggregator should pass with min=1');

    const city = await resolveCityAggregator('sao-paulo');
    if (!city.ok) throw new Error('city aggregator should pass with min=1');
    if (city.slug !== 'sao-paulo') throw new Error(`city slug=${city.slug}`);

    process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT = '9999';
    const blocked = await resolveRemoteAggregator();
    if (blocked.ok) throw new Error('threshold must block empty-mass aggregators');

    if (prev == null) delete process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT;
    else process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT = prev;

    return `remote=${remoteListed.total} city=${cityListed.total}`;
  });

  await check('sql', 'resolve-public-vacancy-closed', async () => {
    const { resolvePublicVacancyPosting, listOpenPublicVacancies } = await import(
      '../../lib/public-vacancy-posting.js'
    );
    const company = await client.query(`SELECT slug FROM companies WHERE id = $1`, [companyId]);
    const vac = await client.query(
      `SELECT id, slug FROM vacancies
       WHERE company_id = $1 AND public_page_enabled AND status = 'closed' AND deleted = FALSE
       LIMIT 1`,
      [companyId]
    );
    const resolved = await resolvePublicVacancyPosting(company.rows[0].slug, vac.rows[0].slug);
    if (!resolved.ok) throw new Error(resolved.errorCode || 'resolve failed');
    if (resolved.posting.publicAllowIndex) throw new Error('closed must not be indexable');
    const related = await listOpenPublicVacancies({
      companyId,
      excludeVacancyId: vac.rows[0].id,
      limit: 5,
    });
    if (!related.length) throw new Error('closed page should have related open public vacancies');
    return `related=${related.length}`;
  });

  await check('sql', 'b1000-tables-present', async () => {
    const tables = [
      'hr_scores',
      'job_roles',
      'performance_cycles',
      'critical_roles',
      'exit_records',
      'learning_resources',
      'company_benefits',
      'employee_compensation_events',
    ];
    for (const name of tables) {
      const r = await client.query(`SELECT to_regclass('public.${name}') AS reg`);
      if (!r.rows[0]?.reg) throw new Error(`missing table ${name}`);
    }
    return tables.join(',');
  });

  await check('sql', 'demo-all-employees-dp', async () => {
    const r = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM candidates c WHERE c.company_id = $1 AND c.employment_status = 'employee') AS emp,
         (SELECT COUNT(*)::int FROM candidate_dp_profiles p WHERE p.company_id = $1) AS dp,
         (SELECT COUNT(*)::int FROM company_kudos k WHERE k.company_id = $1 AND k.deleted = FALSE) AS kudos,
         (SELECT COUNT(*)::int FROM okr_activity_assignees a WHERE a.company_id = $1) AS okr,
         (SELECT COUNT(*)::int FROM employee_hour_bank_entries h WHERE h.company_id = $1) AS bank`,
      [companyId]
    );
    const row = r.rows[0];
    if (row.emp < 8) throw new Error(`employees ${row.emp}`);
    if (row.dp < row.emp) throw new Error(`dp ${row.dp} < emp ${row.emp}`);
    if (row.kudos < 1) throw new Error('kudos');
    if (row.okr < row.emp) throw new Error(`okr assignees ${row.okr} < emp ${row.emp}`);
    if (row.bank < 1) throw new Error('hour bank');
    return `emp=${row.emp} dp=${row.dp} kudos=${row.kudos} okr=${row.okr} bank=${row.bank}`;
  });

  await check('lib', 'turnover-radar-shape', async () => {
    const { getCompanyTurnoverRisks } = await import('../../lib/turnover-radar.js');
    const out = await getCompanyTurnoverRisks(companyId, { limit: 5, minRisk: 'low' });
    if (!Array.isArray(out.risks)) throw new Error('risks array');
    if (typeof out.truncated !== 'boolean') throw new Error('truncated');
    if (typeof out.scanned !== 'number') throw new Error('scanned');
    return `risks=${out.risks.length} scanned=${out.scanned}`;
  });

  await check('lib', 'job-roles-list-cap', async () => {
    const { listCompanyJobRoles } = await import('../../lib/job-roles.js');
    const out = await listCompanyJobRoles(companyId);
    if (!Array.isArray(out.roles)) throw new Error('roles');
    if (typeof out.truncated !== 'boolean') throw new Error('truncated');
    return `n=${out.roles.length}`;
  });

  await check('lib', 'vacancy-candidates-paged', async () => {
    const { listVacancyCandidates } = await import('../../lib/vacancies-admin.js');
    const vac = await client.query(
      `SELECT id FROM vacancies WHERE company_id = $1 AND deleted = FALSE ORDER BY id LIMIT 1`,
      [companyId]
    );
    if (!vac.rowCount) throw new Error('no vacancy');
    const list = await listVacancyCandidates(vac.rows[0].id, { page: 1, pageSize: 20 });
    if (!Array.isArray(list.items)) throw new Error('items');
    if (typeof list.total !== 'number') throw new Error('total');
    return `items=${list.items.length} total=${list.total}`;
  });
}

function printSummary() {
  const failed = results.filter((r) => r.status === 'fail');
  const passed = results.filter((r) => r.status === 'pass');
  process.stdout.write('\n== summary ==\n');
  process.stdout.write(`pass: ${passed.length}  fail: ${failed.length}\n`);
  if (failed.length) {
    process.stdout.write('failures:\n');
    for (const f of failed) process.stdout.write(`  - ${f.suite}/${f.name}: ${f.detail}\n`);
  }
  return failed.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  const forceDtov = argv.includes('--dtov') || process.env.DTOV === '1';

  process.stdout.write('30Grow full regression\n');

  // DTOV env must be set BEFORE any import of lib/db.js (pool is created at load).
  if (forceDtov) {
    Object.assign(process.env, dtovEnv());
    assertDtovTarget(process.env);
    process.stdout.write(`DB target: DTOV ${DTOV_DEFAULTS.POSTGRES_HOST}:${DTOV_DEFAULTS.POSTGRES_PORT}\n`);
  } else if (!offline) {
    process.stdout.write(
      `DB target: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'} / ${process.env.POSTGRES_DB || 'enneagram'} (set DTOV=1 or --dtov for ephemeral)\n`
    );
  }

  await runOfflineLibs();

  if (offline) {
    const allOk = printSummary();
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  const client = new Client(getPgBaseConfig());
  try {
    await client.connect();
  } catch (e) {
    fail('sql', 'connect', e.message || e);
    printSummary();
    process.exitCode = 2;
    return;
  }

  try {
    await runSqlSuite(client);
  } finally {
    await client.end();
  }

  const allOk = printSummary();
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
