import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('vacancy list card layout', () => {
  const readSource = () => readFile(
    new URL('../../app/dashboard/tabs/VacanciesAdminTab.jsx', import.meta.url),
    'utf8'
  );

  it('renders a compact paged table with operational columns and secondary actions', async () => {
    const source = await readSource();

    assert.match(source, /<AdminTableShell/);
    assert.match(source, /<AdminListPager/);
    assert.match(source, /<RowActionsMenu/);
    assert.match(source, /minWidth=\{isAdmin \? '920px' : '780px'\}/);
    assert.doesNotMatch(source, /<AdminTh className="hidden 2xl:table-cell">.*salaryRange/);
    assert.doesNotMatch(source, /columnKey="createdAt"/);
    assert.doesNotMatch(source, /\btext-(?:2xs|xs)\b|\btext-ink-faint\b/);
    assert.doesNotMatch(source, /AdminViewButton\s+asText/);
  });

  it('uses the vacancy detail width for actions and both public links', async () => {
    const source = await readSource();

    assert.match(source, /lg:flex-row lg:items-start lg:justify-between/);
    assert.match(source, /md:grid-cols-2/);
    assert.match(source, /!v \|\| error \|\| msg/);
    assert.doesNotMatch(source, /title=\{t\(locale, 'recruiting\.linkActionsTitle'\)\}/);
  });

  it('shares one form component and the same drawer pattern between create and edit', async () => {
    const source = await readSource();
    const form = await readFile(
      new URL('../../app/dashboard/vacancies/VacancyFormFields.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /<VacancyFormFields[\s\S]*?mode="create"[\s\S]*?layout="stack"/);
    assert.match(source, /<VacancyFormFields[\s\S]*?mode="edit"[\s\S]*?layout="stack"/);
    assert.doesNotMatch(source, /fullPage=/);
    assert.doesNotMatch(source, /<RichTextEditor|<VacancyWorkplaceFields|<VacancyPublicFlagsFields/);
    assert.match(form, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
    assert.match(form, /t\(locale, 'ui\.vacanciesAdminTab\.minimumSalary'\)/);
    assert.doesNotMatch(form, /\btext-(?:2xs|xs)\b|\btext-ink-faint\b/);
  });

  it('keeps the pipeline stages callback stable to prevent reload loops', async () => {
    const source = await readSource();

    assert.match(source, /const handlePipelineStagesChange = useCallback\(\(\) => \{/);
    assert.match(source, /onChange=\{handlePipelineStagesChange\}/);
    assert.doesNotMatch(
      source,
      /<PipelineStagesEditor[\s\S]*?onChange=\{\(\) => setPipelineRefresh/
    );
  });
});
