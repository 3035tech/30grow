'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminRichFormDrawer } from '../../_components/AdminRichFormDrawer';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { cn } from '../../../lib/cn';
import { RichTextView } from '../../_components/RichTextView';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { BENEFIT_TYPES } from '../../../lib/domain-status.js';
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
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { t as i18nT, contentLocale } from '../../../lib/i18n';

export function CompanyBenefitsAdminTab({ locale = 'pt-BR', companyId }) {
  const [benefits, setBenefits] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterBenefitType, setFilterBenefitType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [nameQ, setNameQ] = useState('');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
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
    const path = `adminModules.companyBenefits.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  const typeOptions = BENEFIT_TYPES.map((value) => ({ value, label: t(value) }));

  const categorySelectOptions = [
    { value: '', label: t('formCategoryNone') },
    ...categories.map((cat) => ({ value: String(cat.id), label: cat.name })),
  ];

  useEffect(() => {
    loadCategories();
  }, [companyId]);

  useEffect(() => {
    loadBenefits();
  }, [companyId, filterCategoryId]);

  useEffect(() => {
    setPage(1);
  }, [filterCategoryId]);

  async function loadBenefits() {
    if (!companyId) {
      setBenefits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterCategoryId) qs.set('categoryId', filterCategoryId);
      qs.set('companyId', String(companyId));
      const res = await fetch(`/api/admin/company-benefits?${qs}`);
      const data = await res.json();
      if (data.ok) setBenefits(data.benefits || []);
      else toast(t('loadError'), 'error');
    } catch {
      toast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/admin/benefit-categories${companyQs('?')}`);
      const data = await res.json();
      if (data.ok) setCategories(data.categories || []);
    } catch (err) {
      console.error('Failed to load benefit categories:', err);
    }
  }

  function benefitFormFields(benefit) {
    return [
      {
        name: 'name',
        label: t('formNameLabel'),
        type: 'text',
        required: true,
        value: benefit?.name || '',
      },
      {
        name: 'description',
        label: t('formDescLabel'),
        type: 'richText',
        required: false,
        value: benefit?.description || '',
        minHeight: 120,
      },
      {
        name: 'categoryId',
        label: t('formCategoryLabel'),
        type: 'select',
        required: false,
        value: benefit?.categoryId != null ? String(benefit.categoryId) : '',
        options: categorySelectOptions,
      },
      {
        name: 'benefitType',
        label: t('formTypeLabel'),
        type: 'select',
        required: false,
        value: benefit?.benefitType || 'other',
        options: typeOptions,
      },
    ];
  }

  function parseCategoryId(raw) {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function handleCreateCategory() {
    const result = await promptForm({
      title: t('newCategory'),
      fields: [
        {
          name: 'name',
          label: t('formCategoryNameLabel'),
          type: 'text',
          required: true,
        },
      ],
    });
    if (!result) return;

    try {
      const res = await fetch('/api/admin/benefit-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCompanyBody({ name: result.name })),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('categoryCreated'), 'ok');
        await loadCategories();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleEditCategory(cat) {
    const result = await promptForm({
      title: t('editCategory'),
      fields: [
        {
          name: 'name',
          label: t('formCategoryNameLabel'),
          type: 'text',
          required: true,
          value: cat.name,
        },
      ],
    });
    if (!result) return;

    try {
      const res = await fetch(`/api/admin/benefit-categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCompanyBody({ name: result.name })),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('categoryUpdated'), 'ok');
        await loadCategories();
        loadBenefits();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleDeactivateCategory(cat) {
    const ok = await confirm(t('confirmDeactivateCategory'));
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/benefit-categories/${cat.id}${companyQs('?')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('categoryDeactivated'), 'ok');
        if (String(filterCategoryId) === String(cat.id)) setFilterCategoryId('');
        await loadCategories();
        loadBenefits();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleCreate() {
    if (categories.length === 0) {
      toast(t('noCategories'), 'info');
    }
    const result = await promptForm({
      title: t('formTitle'),
      fields: benefitFormFields(null),
    });
    if (!result) return;

    try {
      const res = await fetch('/api/admin/company-benefits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withCompanyBody({
            name: result.name,
            description: result.description,
            categoryId: parseCategoryId(result.categoryId),
            benefitType: result.benefitType,
          })
        ),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('benefitCreated'), 'ok');
        loadBenefits();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleEdit(benefit) {
    const result = await promptForm({
      title: t('formTitle'),
      fields: benefitFormFields(benefit),
    });
    if (!result) return;

    try {
      const res = await fetch(`/api/admin/company-benefits/${benefit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withCompanyBody({
            name: result.name,
            description: result.description,
            categoryId: parseCategoryId(result.categoryId),
            benefitType: result.benefitType,
          })
        ),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('benefitUpdated'), 'ok');
        loadBenefits();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleDeactivate(benefit) {
    const ok = await confirm(t('confirmDeactivate'));
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/company-benefits/${benefit.id}${companyQs('?')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('benefitDeactivated'), 'ok');
        loadBenefits();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  const sortedBenefits = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...benefits].filter((row) => {
      if (filterBenefitType && row.benefitType !== filterBenefitType) return false;
      if (!q) return true;
      return String(row.name || '').toLowerCase().includes(q);
    });
    const collator = contentLocale(locale);
    rows.sort((a, b) => {
      const key = sort === 'category' ? 'category' : sort === 'benefitType' ? 'benefitType' : 'name';
      const av = key === 'benefitType' ? t(a.benefitType) : a?.[key];
      const bv = key === 'benefitType' ? t(b.benefitType) : b?.[key];
      return String(av || '').localeCompare(String(bv || ''), collator) * dirMul;
    });
    return rows;
  }, [benefits, sort, sortDir, locale, nameQ, filterBenefitType]);

  const total = sortedBenefits.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedBenefits.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  if (!companyId) {
    return <EmptyState title={t('needCompanyTitle')} message={t('needCompanyHint')} />;
  }

  if (loading && benefits.length === 0) return <AppLoading variant="panel" />;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <button
              type="button"
              className={cn(S.btnGhost, 'min-h-touch text-ink')}
              onClick={() => setCategoriesOpen(true)}
            >
              {t('manageCategories')}
              <span className="tabular-nums text-ink-muted">{categories.length}</span>
            </button>
            <AdminCreateButton label={t('create')} onClick={handleCreate} />
          </>
        }
      />

      <AdminRichFormDrawer
        open={categoriesOpen}
        title={t('manageCategories')}
        locale={locale}
        maxWidth="520px"
        onClose={() => setCategoriesOpen(false)}
        headerActions={<AdminCreateButton variant="secondary" label={t('newCategory')} onClick={handleCreateCategory} />}
      >
        <p className={cn(S.muted, 'mb-4 mt-0')}>{t('categoriesHint')}</p>
        {categories.length === 0 ? (
          <EmptyState title={t('noCategories')} actionLabel={t('newCategory')} onAction={handleCreateCategory} />
        ) : (
          <ContentEnter animKey={`benefit-categories-${categories.length}`}>
            <ul className="m-0 list-none divide-y divide-ink/5 rounded-card border border-ink/10 p-0">
              {categories.map((cat) => (
                <li key={cat.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 break-words text-sm text-ink">{cat.name}</span>
                  <AdminActionsCell>
                    <AdminEditButton label={t('edit')} onClick={() => handleEditCategory(cat)} />
                    <AdminDeleteButton label={t('deactivate')} onClick={() => handleDeactivateCategory(cat)} />
                  </AdminActionsCell>
                </li>
              ))}
            </ul>
          </ContentEnter>
        )}
      </AdminRichFormDrawer>

      <AdminListFilters
        aria-label={t('title')}
        locale={locale}
        onClear={() => {
          setNameQ('');
          setFilterCategoryId('');
          setFilterBenefitType('');
          setPage(1);
        }}
        clearEnabled={Boolean(
          String(nameQ || '').trim() || filterCategoryId || filterBenefitType
        )}
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
        {categories.length > 0 ? (
          <AdminListFilterSelect
            label={t('category_col')}
            value={filterCategoryId}
            onChange={(v) => {
              setFilterCategoryId(v);
              setPage(1);
            }}
          >
            <option value="">{t('allCategories')}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={String(cat.id)}>
                {cat.name}
              </option>
            ))}
          </AdminListFilterSelect>
        ) : null}
        <AdminListFilterSelect
          label={t('type_col')}
          value={filterBenefitType}
          onChange={(v) => {
            setFilterBenefitType(v);
            setPage(1);
          }}
        >
          <option value="">{t('allTypes')}</option>
          {BENEFIT_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      {benefits.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            title={t('noBenefits')}
            message={t('noBenefitsDesc')}
            actionLabel={t('create')}
            onAction={handleCreate}
          />
          <div className="flex flex-wrap gap-3 px-1">
            <Link href="/dashboard?tab=exit-analysis" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaExit')} →
            </Link>
            <Link href="/dashboard?tab=help" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaHelp')} →
            </Link>
          </div>
        </div>
      ) : (
        <>
        <AdminTableShell locale={locale} minWidth="560px" animKey={`${nameQ}|${filterCategoryId}|${filterBenefitType}|${safePage}|${pageSize}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="name" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('name_col')}
                </SortableTh>
                <SortableTh columnKey="category" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('category_col')}
                </SortableTh>
                <SortableTh columnKey="benefitType" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('type_col')}
                </SortableTh>
                <AdminActionsTh>{t('actions_col')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((ben) => (
                <tr key={ben.id} className="hover:bg-canvas-alt/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-ink">{ben.name}</p>
                    {ben.description ? (
                      <RichTextView
                        html={ben.description}
                        className="mt-0.5 text-xs text-ink-muted"
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{ben.category || '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{t(ben.benefitType)}</td>
                  <td className="px-4 py-3 text-right">
                    <AdminActionsCell>
                      <AdminViewButton
                        label={t('view')}
                        onClick={() => setViewing(ben)}
                      />
                      <AdminEditButton label={t('edit')} onClick={() => handleEdit(ben)} />
                      <AdminDeleteButton label={t('deactivate')} onClick={() => handleDeactivate(ben)} />
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
      <AdminRecordViewDrawer
        open={Boolean(viewing)}
        title={viewing?.name || ''}
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
                    { key: 'category', label: t('category_col'), value: viewing.category },
                    { key: 'type', label: t('type_col'), value: viewing.benefitType ? t(viewing.benefitType) : '' },
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
