/**
 * DTOV — B-2709 interview prep links.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import {
  ensureInterviewPrepLink,
  markInterviewPrepPrepared,
  resolveInterviewPrepByToken,
} from '../../lib/recruiting/interview-prep.js';
import { buildInterviewQuestions } from '../../lib/people/decision-brief.js';

async function main() {
  const qs = buildInterviewQuestions({
    locale: 'pt-BR',
    topType: 5,
    preferredTypes: [3, 7],
    motivatorKeys: ['autonomia'],
  });
  assert.ok(qs.length >= 2);
  assert.ok(qs.some((q) => q.id === 'iv-t5'));
  assert.ok(qs.some((q) => q.id.startsWith('iv-rubric-')));

  const vac = await query(
    `SELECT v.id AS "vacancyId", v.company_id AS "companyId", vc.candidate_id AS "candidateId"
     FROM vacancies v
     JOIN vacancy_candidates vc ON vc.vacancy_id = v.id AND vc.company_id = v.company_id
     WHERE v.deleted = FALSE AND v.status = 'open'
     ORDER BY v.id DESC
     LIMIT 1`
  );
  assert.ok(vac.rowCount > 0, 'need open vacancy with candidate');
  const { vacancyId, companyId, candidateId } = vac.rows[0];

  const link = await ensureInterviewPrepLink(null, {
    companyId,
    vacancyId,
    candidateId,
    createdByUserId: null,
  });
  assert.equal(link.ok, true, link.errorCode);
  assert.ok(link.link?.token);

  const again = await ensureInterviewPrepLink(null, {
    companyId,
    vacancyId,
    candidateId,
  });
  assert.equal(again.link.token, link.link.token);

  const resolved = await resolveInterviewPrepByToken(null, {
    token: link.link.token,
    locale: 'pt-BR',
  });
  assert.equal(resolved.ok, true, resolved.errorCode);
  assert.ok((resolved.prep.questions || []).length >= 1);
  assert.equal(resolved.prep.prepared, false);

  const marked = await markInterviewPrepPrepared(null, { token: link.link.token });
  assert.equal(marked.ok, true);
  const resolved2 = await resolveInterviewPrepByToken(null, {
    token: link.link.token,
    locale: 'en',
  });
  assert.equal(resolved2.prep.prepared, true);

  console.log('interview-prep.dtov.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
