/**
 * Advisory hire-readiness checklist (not a hard gate).
 * Pattern mirrors lib/recruiting/job-seo-score.js — pure, UI-safe.
 */

import { OFFER_STATUS } from '../domain-status.js';
import { PIPELINE_STAGE } from './pipeline.js';

const STAGES_READY = new Set([PIPELINE_STAGE.APPROVED, PIPELINE_STAGE.HIRED]);

function eneagramDone(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.assessmentId != null) return true;
  if (row.topType != null) return true;
  const inv = String(row.inviteStatus || '');
  return inv === 'completed';
}

function motivatorsDone(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.motivatorsAttemptId != null) return true;
  return String(row.motivatorsInviteStatus || '') === 'completed';
}

function stageReady(row) {
  const s = String(row?.pipelineStage || '').trim();
  return STAGES_READY.has(s);
}

function offerLogged(row) {
  const s = String(row?.offerStatus || OFFER_STATUS.NONE).toLowerCase();
  return s === OFFER_STATUS.PROPOSED || s === OFFER_STATUS.ACCEPTED;
}

function offerAccepted(row) {
  return String(row?.offerStatus || '').toLowerCase() === OFFER_STATUS.ACCEPTED;
}

/**
 * @param {object} row — vacancy candidate / ranking row (camelCase)
 * @param {{ scorecardComplete?: boolean|null }} [opts]
 * @returns {{ readyCount: number, total: number, ready: boolean, checks: Array<{ id: string, ok: boolean, required: boolean }> }}
 */
export function computeHireReadiness(row, opts = {}) {
  const scorecardComplete =
    opts.scorecardComplete === undefined ? null : opts.scorecardComplete;

  const checks = [
    { id: 'ENEAGRAM', ok: eneagramDone(row), required: true },
    { id: 'MOTIVATORS', ok: motivatorsDone(row), required: true },
    { id: 'STAGE_APPROVED', ok: stageReady(row), required: true },
    { id: 'OFFER_LOGGED', ok: offerLogged(row), required: true },
    { id: 'OFFER_ACCEPTED', ok: offerAccepted(row), required: false },
  ];

  if (scorecardComplete !== null) {
    checks.push({
      id: 'SCORECARD',
      ok: Boolean(scorecardComplete),
      required: false,
    });
  }

  const required = checks.filter((c) => c.required);
  const readyCount = required.filter((c) => c.ok).length;
  const total = required.length;
  return {
    readyCount,
    total,
    ready: readyCount === total && total > 0,
    checks,
  };
}
