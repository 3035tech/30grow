'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading } from '../../_components/AppLoading';
import { RichTextView } from '../../_components/RichTextView';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { TagChips } from '../../_components/TagInput';
import { AdminListFilters, AdminListFilterSelect, AdminListResults } from '../../_components/AdminListFilters';
import { formatTagList, parseTagList } from '../../../lib/tag-list';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminViewButton,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { LEARNING_RESOURCE_TYPE, LEARNING_RESOURCE_TYPES } from '../../../lib/domain-status';
import { t as i18nT, contentLocale } from '../../../lib/i18n';

export function LearningResourcesAdminTab({ locale = 'pt-BR', companyId }) {
  const [resources, setResources] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [filterTheme, setFilterTheme] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  const [nameQ, setNameQ] = useState('');
  const { confirm, promptForm, toast } = useAppFeedback();
  const [viewing, setViewing] = useState(null);

  function companyQs(prefix = '?') {
    if (!companyId) return '';
    return `${prefix}companyId=${companyId}`;
  }

  function withCompanyBody(payload) {
    return companyId ? { ...payload, companyId } : payload;
  }

  function t(key, values = {}) {
    const path = `adminModules.learningResources.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  useEffect(() => {
    loadResources();
    loadThemes();
  }, [companyId, filterTheme, filterType]);

  useEffect(() => {
    setPage(1);
  }, [filterTheme, filterType]);

  async function loadResources() {
    if (!companyId) {
      setResources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTheme) params.set('theme', filterTheme);
      if (filterType) params.set('resourceType', filterType);
      params.set('companyId', String(companyId));
      const res = await fetch(`/api/admin/learning-resources?${params.toString()}`);
      const data = await res.json();
      if (data.ok) setResources(data.resources || []);
      else toast(t('loadError'), 'error');
    } catch {
      toast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadThemes() {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/admin/learning-resources?themes=true${companyQs('&')}`);
      const data = await res.json();
      if (data.ok) setThemes(data.themes || []);
    } catch (err) {
      console.error('Failed to load themes:', err);
    }
  }

  function resourceFields(resource) {
    return [
      {
        name: 'title',
        label: t('formTitleLabel'),
        type: 'text',
        required: true,
        value: resource?.title || '',
      },
      {
        name: 'description',
        label: t('formDescLabel'),
        type: 'richText',
        required: false,
        value: resource?.description || '',
        minHeight: 120,
      },
      {
        name: 'theme',
        label: t('formThemeLabel'),
        type: 'tags',
        required: false,
        value: parseTagList(resource?.theme),
        placeholder: t('formThemePh'),
        help: t('formThemeHelp'),
        suggestions: themes,
        maxTags: 10,
        tagMax: 40,
      },
      {
        name: 'resourceType',
        label: t('formTypeLabel'),
        type: 'select',
        required: false,
        value: resource?.resourceType || LEARNING_RESOURCE_TYPE.COURSE,
        options: LEARNING_RESOURCE_TYPES.map((value) => ({
          value,
          label: t(value),
        })),
        row: 'typeDuration',
      },
      {
        name: 'durationHours',
        label: t('formDurationLabel'),
        type: 'text',
        required: false,
        value: resource?.durationHours != null ? String(resource.durationHours) : '',
        row: 'typeDuration',
      },
      { name: 'url', label: t('formUrlLabel'), type: 'text', required: false, value: resource?.url || '' },
    ];
  }

  function payloadFromForm(result) {
    return {
      title: result.title,
      description: result.description,
      theme: formatTagList(result.theme),
      resourceType: result.resourceType,
      url: result.url,
      durationHours: result.durationHours,
    };
  }

  async function handleCreate() {
    const result = await promptForm({
      title: t('formTitle'),
      fields: resourceFields(null),
    });
    if (!result) return;

    try {
      const res = await fetch('/api/admin/learning-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCompanyBody(payloadFromForm(result))),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('created'), 'ok');
        loadResources();
        loadThemes();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleEdit(resource) {
    const result = await promptForm({
      title: t('formTitle'),
      fields: resourceFields(resource),
    });
    if (!result) return;

    try {
      const res = await fetch(`/api/admin/learning-resources/${resource.id}${companyQs('?')}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCompanyBody(payloadFromForm(result))),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('updated'), 'ok');
        loadResources();
        loadThemes();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleDeactivate(resource) {
    const ok = await confirm(t('confirmDeactivate'));
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/learning-resources/${resource.id}${companyQs('?')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('deactivated'), 'ok');
        loadResources();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  const sortedResources = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...resources].filter((row) => {
      if (!q) return true;
      return String(row.title || '').toLowerCase().includes(q);
    });
    const collator = contentLocale(locale);
    rows.sort((a, b) => {
      if (sort === 'durationHours') {
        const an = Number(a.durationHours) || 0;
        const bn = Number(b.durationHours) || 0;
        return (an - bn) * dirMul;
      }
      if (sort === 'resourceType') {
        return String(t(a.resourceType) || '').localeCompare(String(t(b.resourceType) || ''), collator) * dirMul;
      }
      if (sort === 'theme') {
        return String(a.theme || '').localeCompare(String(b.theme || ''), collator) * dirMul;
      }
      return String(a.title || '').localeCompare(String(b.title || ''), collator) * dirMul;
    });
    return rows;
  }, [resources, sort, sortDir, locale, nameQ]);

  const total = sortedResources.length;
  const hasActiveFilters = Boolean(String(nameQ || '').trim() || filterTheme || filterType);
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedResources.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  if (!companyId) {
    return <EmptyState title={t('needCompanyTitle')} message={t('needCompanyHint')} />;
  }

  if (loading && resources.length === 0) return <AppLoading variant="panel" />;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<AdminCreateButton label={t('create')} onClick={handleCreate} />}
      />

      <AdminListFilters
        aria-label={t('title')}
        locale={locale}
        onClear={() => {
          setNameQ('');
          setFilterTheme('');
          setFilterType('');
          setPage(1);
        }}
        clearEnabled={Boolean(String(nameQ || '').trim() || filterTheme || filterType)}
      >
        <AdminListSearch
          locale={locale}
          value={nameQ}
          onChange={(v) => {
            setNameQ(v);
            setPage(1);
          }}
          placeholder={t('searchNamePh')}
        />
        {themes.length > 0 ? (
          <AdminListFilterSelect
            label={t('theme_col')}
            value={filterTheme}
            onChange={(v) => {
              setFilterTheme(v);
              setPage(1);
            }}
          >
            <option value="">{t('allThemes')}</option>
            {themes.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </AdminListFilterSelect>
        ) : null}
        <AdminListFilterSelect
          label={t('type_col')}
          value={filterType}
          onChange={(v) => {
            setFilterType(v);
            setPage(1);
          }}
        >
          <option value="">{t('allTypes')}</option>
          {LEARNING_RESOURCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      <AdminListResults animKey={`${nameQ}|${filterTheme}|${filterType}|${safePage}|${pageSize}`}>
      {sortedResources.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            title={hasActiveFilters ? t('noResults') : t('noResources')}
            message={hasActiveFilters ? t('noResultsDesc') : t('noResourcesDesc')}
            actionLabel={hasActiveFilters ? undefined : t('create')}
            onAction={hasActiveFilters ? undefined : handleCreate}
          />
          {!hasActiveFilters ? <div className="flex flex-wrap gap-3 px-1">
            <Link href={companyId ? `/dashboard?tab=pdi&company=${encodeURIComponent(companyId)}` : '/dashboard?tab=pdi'} className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaPdi')} →
            </Link>
            <Link href="/dashboard?tab=help" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaHelp')} →
            </Link>
          </div> : null}
        </div>
      ) : (
        <>
        <AdminTableShell locale={locale} minWidth="640px">
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="title" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('title_col')}
                </SortableTh>
                <SortableTh columnKey="theme" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('theme_col')}
                </SortableTh>
                <SortableTh columnKey="resourceType" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('type_col')}
                </SortableTh>
                <SortableTh columnKey="durationHours" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('duration_col')}
                </SortableTh>
                <AdminActionsTh>{t('actions_col')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((res) => (
                <tr key={res.id} className="hover:bg-canvas-alt/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-ink">{res.title}</p>
                    {res.description ? (
                      <RichTextView html={res.description} className="mt-0.5 text-xs text-ink-muted" />
                    ) : null}
                    {res.url ? (
                      <a
                        href={res.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-600 hover:text-brand-700"
                      >
                        Link →
                      </a>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={res.theme} />
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{t(res.resourceType)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {res.durationHours ? `${res.durationHours}${t('hours')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <AdminActionsCell>
                      <AdminViewButton
                        label={t('view')}
                        onClick={() => setViewing(res)}
                      />
                      <AdminEditButton label={t('edit')} onClick={() => handleEdit(res)} />
                      <AdminDeleteButton label={t('deactivate')} onClick={() => handleDeactivate(res)} />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
        </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={safePage}
            pageSize={pageSize}
            total={total}
            loading={loading}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      )}
      </AdminListResults>
      <AdminRecordViewDrawer
        open={Boolean(viewing)}
        title={viewing?.title || ''}
        locale={locale}
        onClose={() => setViewing(null)}
        onEdit={viewing ? () => handleEdit(viewing) : null}
        editLabel={t('edit')}
        sections={
          viewing
            ? [
                {
                  key: 'meta',
                  fields: [
                    { key: 'type', label: t('type_col'), value: viewing.resourceType ? t(viewing.resourceType) : '' },
                    {
                      key: 'duration',
                      label: t('duration_col'),
                      value: viewing.durationHours != null ? `${viewing.durationHours}${t('hours')}` : '',
                    },
                    {
                      key: 'theme',
                      label: t('theme_col'),
                      value: viewing.theme?.length ? <TagChips tags={viewing.theme} /> : '',
                      full: true,
                    },
                    {
                      key: 'url',
                      label: i18nT(locale, 'panel.recordView.link'),
                      value: viewing.url,
                      kind: RECORD_FIELD_KIND.LINK,
                    },
                    {
                      key: 'description',
                      label: t('formDescLabel'),
                      value: viewing.description,
                      kind: RECORD_FIELD_KIND.HTML,
                    },
                  ],
                },
              ]
            : []
        }
      />
    </div>
  );
}
