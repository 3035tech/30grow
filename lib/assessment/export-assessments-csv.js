/**
 * CSV export of assessments (manager dashboard).
 * Hard row cap to avoid OOM/timeouts; stream chunks to the client.
 */

import { queryRead } from '../db.js';
import {
  assessmentListWhereParts,
  sqlWhere,
} from './assessment-filters.js';
import { htmlToPlainText } from '../sanitize-html.js';

export const EXPORT_MAX_ROWS_DEFAULT = 10000;

export function exportMaxRows() {
  const n = parseInt(process.env.EXPORT_MAX_ROWS || '', 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 100000);
  return EXPORT_MAX_ROWS_DEFAULT;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADER = [
  'assessment_id',
  'candidate_name',
  'candidate_email',
  'candidate_phone',
  'candidate_linkedin',
  'candidate_city',
  'candidate_state',
  'candidate_salary',
  'candidate_availability',
  'candidate_source',
  'area_key',
  'area_label',
  'top_type',
  'pipeline_stage',
  'hr_notes',
  'scores_json',
  'created_at',
].join(',');

function rowToCsvLine(row) {
  return [
    row.assessment_id,
    csvEscape(row.candidate_name),
    csvEscape(row.candidate_email || ''),
    csvEscape(row.candidate_phone || ''),
    csvEscape(row.candidate_linkedin || ''),
    csvEscape(row.candidate_city || ''),
    csvEscape(row.candidate_state || ''),
    csvEscape(row.candidate_salary || ''),
    csvEscape(row.candidate_availability || ''),
    csvEscape(row.candidate_source || ''),
    row.area_key,
    csvEscape(row.area_label),
    row.top_type,
    csvEscape(row.pipeline_stage || ''),
    csvEscape(htmlToPlainText(row.hr_notes || '')),
    csvEscape(JSON.stringify(row.scores)),
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  ].join(',');
}

/**
 * @returns {{ rows: object[], truncated: boolean, maxRows: number }}
 */
export async function fetchAssessmentsForExport({
  isAdmin,
  companyId,
  scopeCompanyFilter,
  area,
  vacancy,
  pipelineStage,
  dateFrom,
  dateTo,
  rosterScope,
  nameSearch,
  maxRows = exportMaxRows(),
}) {
  const { whereParts, params } = assessmentListWhereParts({
    isAdmin,
    companyId,
    scopeCompanyFilter,
    selectedArea: area,
    selectedVacancy: vacancy,
    pipelineStage,
    dateFrom,
    dateTo,
    rosterScope,
  });
  const extWhereParts = nameSearch
    ? [...whereParts, `c.full_name ILIKE $${params.length + 1}`]
    : whereParts;
  const extParams = nameSearch ? [...params, `%${nameSearch}%`] : params;
  const where = sqlWhere(extWhereParts);
  const limit = Math.max(1, maxRows);
  const fetchLimit = limit + 1;

  const r = await queryRead(
    `SELECT
       ass.id AS assessment_id,
       c.full_name AS candidate_name,
       c.email AS candidate_email,
       c.phone AS candidate_phone,
       c.linkedin_url AS candidate_linkedin,
       c.city AS candidate_city,
       c.state AS candidate_state,
       c.salary_expectation AS candidate_salary,
       c.availability AS candidate_availability,
       c.source AS candidate_source,
       ar.key AS area_key,
       ar.label AS area_label,
       ass.top_type,
       ass.scores,
       ass.pipeline_stage AS pipeline_stage,
       c.hr_notes,
       ass.created_at
     FROM assessments ass
     JOIN candidates c ON c.id = ass.candidate_id
     JOIN areas ar ON ar.id = ass.area_id
     ${where}
     ORDER BY ass.created_at DESC
     LIMIT $${extParams.length + 1}`,
    [...extParams, fetchLimit]
  );

  const truncated = r.rows.length > limit;
  const rows = truncated ? r.rows.slice(0, limit) : r.rows;
  return { rows, truncated, maxRows: limit };
}

/** ReadableStream of CSV text (UTF-8). */
export function assessmentsCsvStream(rows) {
  const encoder = new TextEncoder();
  let i = -1;
  return new ReadableStream({
    pull(controller) {
      if (i < 0) {
        controller.enqueue(encoder.encode(`${CSV_HEADER}\n`));
        i = 0;
        return;
      }
      if (i >= rows.length) {
        controller.close();
        return;
      }
      // Chunk ~100 rows per enqueue to keep memory flat
      const end = Math.min(i + 100, rows.length);
      let chunk = '';
      for (; i < end; i += 1) {
        chunk += `${rowToCsvLine(rows[i])}\n`;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
}
