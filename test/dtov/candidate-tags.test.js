import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';

const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);
const { pool, query, withTransaction } = await import('../../lib/db.js');
const { listCandidateTags, saveCandidateTag, replaceCandidateTags } = await import(
  '../../lib/recruiting/candidate-tags.js'
);
const { normalizeTagIds, normalizeCandidateTagFilter } = await import(
  '../../lib/recruiting/candidate-tags-core.js'
);
const { listTalentBank } = await import('../../lib/recruiting/talent-bank.js');
const { getVacancyRanking } = await import('../../lib/recruiting/vacancy-ranking.js');
const { saveRecruitingView, getRecruitingWorkspace } = await import(
  '../../lib/recruiting/recruiting-workspace.js'
);
const stamp = Date.now();
const companies = [];
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};

try {
  assert.deepEqual(normalizeTagIds('1,2,1'), [1, 2]);
  for (const value of ['abc', '-1', '0', '9007199254740992']) {
    assert.throws(() => normalizeTagIds(value));
  }
  assert.throws(() => normalizeCandidateTagFilter({ tagMode: 'invalid' }));
  checks++;
  for (let i = 0; i < 2; i++)
    companies.push(
      Number(
        (
          await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [
            'Tags regression',
            `tags-${stamp}-${i}`,
          ])
        ).rows[0].id,
      ),
    );
  const [companyId, otherCompany] = companies;
  const userId = Number(
    (
      await query(
        "INSERT INTO users(company_id,email,password_hash,role,display_name) VALUES($1,$2,'unusable','hr','Tags tester') RETURNING id",
        [companyId, `tags-${stamp}@dtov.invalid`],
      )
    ).rows[0].id,
  );
  const vacancyId = Number(
    (
      await query(
        "INSERT INTO vacancies(company_id,title,slug) VALUES($1,'Tags vacancy',$2) RETURNING id",
        [companyId, `tags-${stamp}`],
      )
    ).rows[0].id,
  );
  const candidates = (
    await query(
      "INSERT INTO candidates(company_id,full_name,email) SELECT $1,'Tags person ' || n,'tags-' || n || '-' || $2 || '@dtov.invalid' FROM generate_series(1,205) n RETURNING id",
      [companyId, stamp],
    )
  ).rows.map((row) => Number(row.id));
  await query(
    "INSERT INTO vacancy_candidates(company_id,vacancy_id,candidate_id,pipeline_stage,created_at) SELECT $1,$2,id,'new',now() + id * interval '1 second' FROM candidates WHERE company_id=$1",
    [companyId, vacancyId],
  );
  const candidateId = candidates[0]; // Oldest row is beyond ranking cap before filtering.
  const otherCandidate = Number(
    (
      await query(
        "INSERT INTO candidates(company_id,full_name) VALUES($1,'Other tenant') RETURNING id",
        [otherCompany],
      )
    ).rows[0].id,
  );
  const create = (name, tenant = companyId) =>
    saveCandidateTag({ companyId: tenant, name, color: '#6366f1', actorId: userId });
  const tag1 = (await create('  .NET  ')).tag;
  const tag2 = (await create('Líder   técnico')).tag;
  const tag3 = (await create('C#')).tag;
  const foreignTag = (await create('.NET', otherCompany)).tag;
  check(
    (await create('.net')).errorCode === 'CANDIDATE_TAG_NAME_EXISTS',
    'names are unique ignoring case',
  );
  check(
    (await create('Líder técnico')).status === 409,
    'whitespace-normalized duplicates rejected',
  );
  check((await listCandidateTags(companyId)).length === 3, 'catalog is tenant scoped');
  const assigned = await replaceCandidateTags({
    companyId,
    candidateId,
    tagIds: [Number(tag1.id), Number(tag2.id), Number(tag1.id)],
    actorId: userId,
  });
  check(assigned.ok && assigned.tags.length === 2, 'assignments deduplicated');
  const before = (
    await query('SELECT * FROM candidate_tag_assignments WHERE candidate_id=$1 ORDER BY tag_id', [
      candidateId,
    ])
  ).rows;
  check(
    !(
      await replaceCandidateTags({
        companyId,
        candidateId,
        tagIds: [Number(foreignTag.id)],
        actorId: userId,
      })
    ).ok,
    'foreign label rejected',
  );
  check(
    (
      await replaceCandidateTags({
        companyId,
        candidateId: otherCandidate,
        tagIds: [],
        actorId: userId,
      })
    ).status === 404,
    'foreign candidate rejected',
  );
  assert.deepEqual(
    (
      await query('SELECT * FROM candidate_tag_assignments WHERE candidate_id=$1 ORDER BY tag_id', [
        candidateId,
      ])
    ).rows,
    before,
  );
  checks++;
  await assert.rejects(
    query(
      'INSERT INTO candidate_tag_assignments(company_id,candidate_id,tag_id) VALUES($1,$2,$3)',
      [companyId, otherCandidate, tag1.id],
    ),
    { code: '23503' },
  );
  checks++;
  await assert.rejects(
    query(
      'INSERT INTO candidate_tag_assignments(company_id,candidate_id,tag_id) VALUES($1,$2,$3)',
      [companyId, candidateId, foreignTag.id],
    ),
    { code: '23503' },
  );
  checks++;
  const total = async (tagIds, tagMode) =>
    (await listTalentBank(null, { companyId, tagIds, tagMode, pageSize: 1 })).total;
  assert.equal(await total([tag1.id, tag3.id], 'any'), 1);
  assert.equal(await total([tag1.id, tag2.id], 'all'), 1);
  assert.equal(await total([tag1.id, tag3.id], 'all'), 0);
  assert.equal(await total([], 'none'), 204);
  checks++;
  const ranking = await getVacancyRanking({
    vacancyId,
    companyId,
    isAdmin: false,
    tagIds: [tag1.id],
  });
  check(
    ranking.ok && ranking.total === 1 && Number(ranking.ranking[0].candidateId) === candidateId,
    'ranking filters before cap',
  );
  check(
    ranking.ranking[0].tags.length === 2 && !ranking.truncated,
    'ranking includes labels and accurate matching total',
  );
  const all = await getVacancyRanking({ vacancyId, companyId, isAdmin: true });
  check(
    all.total === 205 && all.ranking.length === 200 && all.truncated,
    'ranking reports truncation',
  );
  const saved = await saveRecruitingView({
    companyId,
    userId,
    vacancyId,
    name: 'Tagged view',
    filters: { tagIds: [tag1.id, tag2.id], tagMode: 'all' },
  });
  check(saved.ok, 'save tag view');
  const workspace = await getRecruitingWorkspace({ companyId, userId, vacancyId });
  assert.deepEqual(workspace.views[0].filters.tagIds, [Number(tag1.id), Number(tag2.id)]);
  assert.equal(workspace.views[0].filters.tagMode, 'all');
  checks++;
  await saveCandidateTag({
    companyId,
    id: tag1.id,
    name: 'Backend',
    color: '#16a34a',
    active: false,
    actorId: userId,
  });
  check((await total([tag1.id], 'any')) === 1, 'inactive labels remain filterable');
  check(
    (
      await replaceCandidateTags({
        companyId,
        candidateId,
        tagIds: [Number(tag1.id), Number(tag2.id)],
        actorId: userId,
      })
    ).ok,
    'existing inactive label preserved',
  );
  check(
    !(
      await replaceCandidateTags({
        companyId,
        candidateId: candidates[1],
        tagIds: [Number(tag1.id)],
        actorId: userId,
      })
    ).ok,
    'inactive label cannot be newly assigned',
  );
  const migration = await readFile(
    new URL('../../migrations/157_candidate_tags.sql', import.meta.url),
    'utf8',
  );
  await query(migration);
  await query(migration);
  assert.deepEqual(
    (
      await query('SELECT * FROM candidate_tag_assignments WHERE candidate_id=$1 ORDER BY tag_id', [
        candidateId,
      ])
    ).rows,
    before,
  );
  checks++;
  check(
    (await listCandidateTags(companyId)).find((tag) => tag.id === tag1.id).name === 'Backend',
    'migration reapplication preserves edited catalog',
  );
  await replaceCandidateTags({ companyId, candidateId, tagIds: [], actorId: userId });
  assert.equal(await total([], 'none'), 205);
  checks++;
  await replaceCandidateTags({
    companyId,
    candidateId: candidates[1],
    tagIds: [Number(tag3.id)],
    actorId: userId,
  });
  check(
    (
      await withTransaction(async (client) => {
        await client.query('DELETE FROM candidate_tags WHERE id=$1 AND company_id=$2', [
          tag3.id,
          companyId,
        ]);
        return client.query('SELECT tag_id FROM candidate_tag_assignments WHERE tag_id=$1', [
          tag3.id,
        ]);
      })
    ).rowCount === 0,
    'tag deletion has referential cleanup',
  );
  console.log(`Candidate tags: ${checks} checks passed (real PostgreSQL, isolated fixtures).`);
} finally {
  if (companies.length) {
    await query('DELETE FROM users WHERE company_id=ANY($1::bigint[])', [companies]);
    await query('DELETE FROM companies WHERE id=ANY($1::bigint[])', [companies]);
  }
  await pool.end();
}
