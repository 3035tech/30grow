'use client';

import { useEffect, useMemo, useState } from 'react';
import { t, contentLocale } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminTh,
  AdminViewButton,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading } from '../../_components/AppLoading';
import {
  AdminRichFormDrawer,
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
} from '../../_components/AdminRichFormDrawer';
import { RubricEditor } from '../../_components/RubricEditor';
import { FormField, formFieldGrowClass } from '../../_components/FormField';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { fieldInputClass } from '../../_components/form-control-styles';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { RichTextEditor } from '../../_components/RichTextEditor';
import { htmlToPlainText } from '../../../lib/sanitize-html';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { StatusToneChip } from '../../_components/StatusToneChip';
import {
  digitsOnly,
  formatSalaryDisplay,
  formatVacancySalaryRangeDisplay,
  salaryToCentsDigits,
  stripSalary,
} from '../../../lib/br-masks';

const FIELD = `${fieldInputClass} w-full font-mono text-prose`;

const emptyForm = () => ({
  name: '',
  description: '',
  rubric: {},
  marketSalaryMin: '',
  marketSalaryMax: '',
});

export function JobRolesAdminTab({ locale, companyId }) {
  const { toast, confirm, notice, promptForm } = useAppFeedback();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [viewingRole, setViewingRole] = useState(null);
  const [drawerMode, setDrawerMode] = useState(null); // 'create' | 'edit' | null
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [nameQ, setNameQ] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const loadRoles = async () => {
    if (!companyId) {
      setRoles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/admin/job-roles?companyId=${companyId}`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = await res.json();
      setRoles(data.roles || []);
    } catch (err) {
      console.error('[JobRolesAdminTab] Load error:', err);
      setError(t(locale, 'panel.common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLmsTrail = async (role) => {
    try {
      const [coursesRes, trailRes] = await Promise.all([
        fetch(`/api/admin/lms/courses?companyId=${companyId}&limit=80`),
        fetch(
          `/api/admin/job-roles/${encodeURIComponent(role.id)}/lms-trail?companyId=${companyId}`
        ),
      ]);
      const coursesData = await coursesRes.json().catch(() => ({}));
      const trailData = await trailRes.json().catch(() => ({}));
      if (!coursesRes.ok) throw new Error(coursesData?.error || 'courses');
      if (!trailRes.ok) throw new Error(trailData?.error || 'trail');
      const courses = Array.isArray(coursesData.courses) ? coursesData.courses : [];
      if (!courses.length) {
        toast(t(locale, 'jobRoles.lmsTrailEmptyCourses'), 'error');
        return;
      }
      const trailItems = Array.isArray(trailData.items) ? trailData.items : [];
      const selected = trailItems.map((x) => String(x.courseId));
      const dueDefault = trailItems[0]?.dueOffsetDays || 30;
      const mandatoryDefault = trailItems.length
        ? trailItems.every((x) => x.mandatory)
        : true;
      const values = await promptForm({
        title: t(locale, 'jobRoles.lmsTrailTitle', { name: role.name }),
        confirmLabel: t(locale, 'panel.common.save'),
        fields: [
          {
            key: 'courseIds',
            type: 'checkboxGroup',
            label: t(locale, 'jobRoles.lmsTrailCourses'),
            help: t(locale, 'jobRoles.lmsTrailHint'),
            options: courses.map((c) => ({
              value: String(c.id),
              label: c.title,
            })),
            initialValue: selected,
          },
          {
            key: 'dueOffsetDays',
            type: 'number',
            label: t(locale, 'jobRoles.lmsTrailDue'),
            initialValue: String(dueDefault),
          },
          {
            key: 'mandatory',
            type: 'boolean',
            label: t(locale, 'jobRoles.lmsTrailMandatory'),
            initialValue: mandatoryDefault,
          },
        ],
      });
      if (!values) return;
      const ids = Array.isArray(values.courseIds) ? values.courseIds : [];
      const dueOffsetDays = Math.min(365, Math.max(1, Number(values.dueOffsetDays) || 30));
      const items = ids.map((id, i) => ({
        courseId: Number(id),
        sortOrder: i,
        mandatory: values.mandatory !== false,
        dueOffsetDays,
      }));
      const saveRes = await fetch(
        `/api/admin/job-roles/${encodeURIComponent(role.id)}/lms-trail`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, items }),
        }
      );
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saveData?.error || 'save');
      toast(
        items.length
          ? t(locale, 'jobRoles.lmsTrailSavedCount', { n: items.length })
          : t(locale, 'jobRoles.lmsTrailCleared'),
        'ok'
      );
    } catch (e) {
      toast(e?.message || t(locale, 'jobRoles.lmsTrailError'), 'error');
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDrawerMode('create');
  };

  const openEdit = (role) => {
    setEditingId(role.id);
    setForm({
      name: role.name || '',
      description: role.description || '',
      rubric: role.rubric && typeof role.rubric === 'object' ? { ...role.rubric } : {},
      marketSalaryMin: role.marketSalaryMin ? salaryToCentsDigits(role.marketSalaryMin) || '' : '',
      marketSalaryMax: role.marketSalaryMax ? salaryToCentsDigits(role.marketSalaryMax) || '' : '',
    });
    setDrawerMode('edit');
  };

  const closeDrawer = () => {
    if (saving || aiBusy) return;
    setDrawerMode(null);
    setEditingId(null);
    setForm(emptyForm());
  };

  const suggestRubricAi = async () => {
    const name = String(form.name || '').trim();
    if (name.length < 2) {
      toast(t(locale, 'jobRoles.rubricAiNeedName'), 'error');
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch('/api/admin/job-roles/rubric-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: String(form.description || '').trim() || null,
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data?.errorCode || data?.error || '';
        if (code === 'RUBRIC_AI_NOT_CONFIGURED') {
          throw new Error(t(locale, 'jobRoles.rubricAiNotConfigured'));
        }
        if (code === 'RUBRIC_AI_PARSE') {
          throw new Error(t(locale, 'jobRoles.rubricAiParseError'));
        }
        throw new Error(data?.error || t(locale, 'jobRoles.rubricAiFailed'));
      }
      const rubric = data.rubric && typeof data.rubric === 'object' ? data.rubric : {};
      if (Object.keys(rubric).length === 0) {
        throw new Error(t(locale, 'jobRoles.rubricAiParseError'));
      }
      setForm((cur) => ({ ...cur, rubric }));
      toast(t(locale, 'jobRoles.rubricAiApplied'), 'ok');
      if (data.notes) {
        void notice({
          title: t(locale, 'jobRoles.rubricAiNotesTitle'),
          message: String(data.notes),
          tone: 'info',
        });
      }
    } catch (err) {
      toast(err?.message || t(locale, 'jobRoles.rubricAiFailed'), 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const saveForm = async () => {
    const name = String(form.name || '').trim();
    if (!name) {
      toast(t(locale, 'jobRoles.errorNameRequired'), 'error');
      return;
    }
    const min = stripSalary(form.marketSalaryMin);
    const max = stripSalary(form.marketSalaryMax);
    if (min && max) {
      const minN = Number(min);
      const maxN = Number(max);
      if (Number.isFinite(minN) && Number.isFinite(maxN) && minN > maxN) {
        toast(t(locale, 'jobRoles.errorMarketBandOrder'), 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (drawerMode === 'create') {
        const res = await fetch('/api/admin/job-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            name,
            description: form.description?.trim() || null,
            rubric: form.rubric || {},
            marketSalaryMin: min,
            marketSalaryMax: max,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.errorCode || data?.error || 'create_failed');
        }
        toast(t(locale, 'jobRoles.createSuccess'), 'ok');
      } else if (drawerMode === 'edit' && editingId) {
        const res = await fetch(`/api/admin/job-roles/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            name,
            description: form.description?.trim() || null,
            rubric: form.rubric || {},
            marketSalaryMin: min,
            marketSalaryMax: max,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.errorCode || data?.error || 'update_failed');
        }
        toast(t(locale, 'jobRoles.updateSuccess'), 'ok');
      }
      setDrawerMode(null);
      setEditingId(null);
      setForm(emptyForm());
      await loadRoles();
    } catch (err) {
      console.error('[JobRolesAdminTab] Save error:', err);
      const code = err?.message;
      if (code === 'JOB_ROLE_NAME_EXISTS') {
        toast(t(locale, 'jobRoles.errorNameExists'), 'error');
      } else if (code === 'INVALID_RUBRIC') {
        toast(t(locale, 'jobRoles.errorInvalidRubric'), 'error');
      } else {
        toast(
          drawerMode === 'create'
            ? t(locale, 'jobRoles.errorNameRequired')
            : t(locale, 'panel.common.error'),
          'error'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (role) => {
    const confirmed = await confirm(t(locale, 'jobRoles.deactivateConfirm'));
    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/admin/job-roles/${role.id}${companyId ? `?companyId=${companyId}` : ''}`,
        { method: 'DELETE' }
      );

      if (!res.ok) throw new Error('deactivate_failed');

      toast(t(locale, 'jobRoles.deactivateSuccess'), 'ok');
      loadRoles();
    } catch (err) {
      console.error('[JobRolesAdminTab] Deactivate error:', err);
      toast(t(locale, 'panel.common.error'), 'error');
    }
  };

  const sortedRoles = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const collator = contentLocale(locale);
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...roles].filter((r) => {
      if (activeFilter === 'active' && !r.active) return false;
      if (activeFilter === 'inactive' && r.active) return false;
      if (!q) return true;
      return String(r.name || '').toLowerCase().includes(q);
    });
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), collator) * dirMul);
    return rows;
  }, [roles, sort, sortDir, locale, nameQ, activeFilter]);

  const total = sortedRoles.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRoles.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  if (!companyId) {
    return (
      <div className={S.card}>
        <p className="text-ink-muted">{t(locale, 'jobRoles.selectCompany')}</p>
      </div>
    );
  }

  if (loading && roles.length === 0) {
    return <AppLoading variant="panel" />;
  }

  if (error) {
    return (
      <div className={S.card}>
        <p className="text-red-800 dark:text-danger">{error}</p>
      </div>
    );
  }

  const drawerOpen = drawerMode === 'create' || drawerMode === 'edit';

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        title={t(locale, 'jobRoles.title')}
        subtitle={t(locale, 'jobRoles.subtitle')}
        actions={<AdminCreateButton label={t(locale, 'jobRoles.createButton')} onClick={openCreate} />}
      />

      {roles.length === 0 ? (
        <EmptyState
          title={t(locale, 'jobRoles.listEmpty')}
          message={t(locale, 'jobRoles.listEmptyDesc')}
          actionLabel={t(locale, 'jobRoles.createButton')}
          onAction={openCreate}
        />
      ) : (
        <>
        <AdminListFilters
          aria-label={t(locale, 'jobRoles.title')}
          locale={locale}
          onClear={() => {
            setNameQ('');
            setActiveFilter('');
            setPage(1);
          }}
          clearEnabled={Boolean(String(nameQ || '').trim() || activeFilter)}
        >
          <AdminListSearch
            locale={locale}
            value={nameQ}
            onChange={(v) => {
              setNameQ(v);
              setPage(1);
            }}
            placeholder={t(locale, 'panel.admin.nameSearchPh')}
          />
          <AdminListFilterSelect
            label={t(locale, 'panel.admin.filterActive')}
            value={activeFilter}
            onChange={(v) => {
              setActiveFilter(v);
              setPage(1);
            }}
          >
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            <option value="active">{t(locale, 'panel.admin.filterActiveYes')}</option>
            <option value="inactive">{t(locale, 'panel.admin.filterActiveNo')}</option>
          </AdminListFilterSelect>
        </AdminListFilters>
        {sortedRoles.length === 0 ? (
          <EmptyState message={t(locale, 'panel.admin.noUsersMatch')} />
        ) : (
        <>
        <AdminTableShell locale={locale} minWidth="720px" animKey={`${nameQ}|${activeFilter}|${safePage}|${pageSize}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="name" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t(locale, 'jobRoles.nameLabel')}
                </SortableTh>
                <AdminTh>{t(locale, 'jobRoles.colDescription')}</AdminTh>
                <AdminTh>{t(locale, 'jobRoles.colMarketBand')}</AdminTh>
                <AdminTh>{t(locale, 'jobRoles.colRubric')}</AdminTh>
                <AdminTh>{t(locale, 'jobRoles.colStatus')}</AdminTh>
                <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((role) => {
                const rubric = role.rubric && typeof role.rubric === 'object' ? role.rubric : {};
                const rubricKeys = Object.keys(rubric).filter((k) => Number(rubric[k]) > 0);
                return (
                  <tr key={role.id} className="hover:bg-canvas-alt/50">
                    <td className="px-4 py-2 align-middle text-sm font-medium text-ink whitespace-nowrap">
                      {role.name}
                    </td>
                    <td className="max-w-[280px] px-3 py-2 align-middle text-prose text-ink-muted">
                      <span
                        className="line-clamp-1"
                        title={
                          role.description
                            ? htmlToPlainText(role.description) || undefined
                            : undefined
                        }
                      >
                        {role.description
                          ? htmlToPlainText(role.description) || '—'
                          : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 align-middle font-ui text-prose text-ink-muted whitespace-nowrap">
                      {formatVacancySalaryRangeDisplay(
                        role.marketSalaryMin,
                        role.marketSalaryMax
                      ) || '—'}
                    </td>
                    <td className="px-4 py-2 align-middle font-ui text-prose text-ink/75 whitespace-nowrap">
                      {rubricKeys.length > 0
                        ? `${rubricKeys.length} ${t(locale, 'jobRoles.rubricTypesCount')}`
                        : t(locale, 'jobRoles.rubricEmpty')}
                    </td>
                    <td className="px-4 py-2 align-middle whitespace-nowrap">
                      {role.active ? (
                        <span className="font-ui text-prose text-ink-muted">
                          {t(locale, 'panel.common.yes')}
                        </span>
                      ) : (
                        <span className="rounded bg-ink/10 px-1.5 py-0.5 font-ui text-prose normal-case text-ink-muted">
                          {t(locale, 'jobRoles.inactive')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-middle text-right">
                      {role.active ? (
                        <AdminActionsCell>
                          <AdminViewButton
                            label={t(locale, 'jobRoles.viewButton')}
                            onClick={() => setViewingRole(role)}
                          />
                          <AdminEditButton
                            label={t(locale, 'jobRoles.editButton')}
                            onClick={() => openEdit(role)}
                          />
                          <AdminIconButton
                            icon="academy"
                            label={t(locale, 'jobRoles.lmsTrailBtn')}
                            onClick={() => void openLmsTrail(role)}
                          />
                          <AdminDeleteButton
                            label={t(locale, 'jobRoles.deactivateButton')}
                            onClick={() => handleDeactivate(role)}
                          />
                        </AdminActionsCell>
                      ) : (
                        <AdminActionsCell>
                          <AdminViewButton
                            label={t(locale, 'jobRoles.viewButton')}
                            onClick={() => setViewingRole(role)}
                          />
                        </AdminActionsCell>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTableShell>
          <div className="px-4 pb-3">
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
          </div>
        </>
        )}
        </>
      )}

      <AdminRichFormDrawer
        open={drawerOpen}
        title={
          drawerMode === 'edit'
            ? t(locale, 'jobRoles.editDrawerTitle')
            : t(locale, 'jobRoles.createDrawerTitle')
        }
        locale={locale}
        onClose={closeDrawer}
        footer={(
          <>
            <button
              type="button"
              onClick={closeDrawer}
              disabled={saving || aiBusy}
              className={dialogBtnGhostClass}
            >
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={saveForm}
              disabled={saving || aiBusy || !String(form.name || '').trim()}
              className={cn(
                dialogBtnPrimaryClass,
                'inline-flex items-center gap-2',
                (saving || aiBusy || !String(form.name || '').trim()) && 'opacity-60'
              )}
            >
              {saving ? <span className="spinner" /> : null}
              {drawerMode === 'edit'
                ? t(locale, 'panel.admin.save')
                : t(locale, 'panel.admin.create')}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3.5">
          <FormField label={t(locale, 'jobRoles.nameLabel')}>
            <input
              value={form.name}
              onChange={(e) => setForm((cur) => ({ ...cur, name: e.target.value }))}
              placeholder={t(locale, 'jobRoles.namePlaceholder')}
              className={FIELD}
              autoFocus
            />
          </FormField>

          <FormField as="div" label={t(locale, 'jobRoles.descriptionLabel')}>
            <RichTextEditor
              value={form.description}
              onChange={(html) => setForm((cur) => ({ ...cur, description: html }))}
              placeholder={t(locale, 'jobRoles.descriptionPlaceholder')}
              minHeight={100}
              locale={locale}
            />
          </FormField>

          <CollapsibleBlock
            title={t(locale, 'jobRoles.marketBandSection')}
            defaultOpen={Boolean(form.marketSalaryMin || form.marketSalaryMax)}
            locale={locale}
            variant="panel"
          >
            <div className="flex flex-col gap-3">
              <p className="m-0 text-prose text-ink-muted">{t(locale, 'jobRoles.marketBandHint')}</p>
              <div className={cn(S.fieldRow, 'items-start gap-3')}>
                <FormField label={t(locale, 'jobRoles.marketMinLabel')} className={formFieldGrowClass}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatSalaryDisplay(form.marketSalaryMin, locale)}
                    onChange={(e) =>
                      setForm((cur) => ({
                        ...cur,
                        marketSalaryMin: digitsOnly(e.target.value).slice(0, 15),
                      }))
                    }
                    placeholder={t(locale, 'jobRoles.marketSalaryPh')}
                    className={FIELD}
                  />
                </FormField>
                <FormField label={t(locale, 'jobRoles.marketMaxLabel')} className={formFieldGrowClass}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatSalaryDisplay(form.marketSalaryMax, locale)}
                    onChange={(e) =>
                      setForm((cur) => ({
                        ...cur,
                        marketSalaryMax: digitsOnly(e.target.value).slice(0, 15),
                      }))
                    }
                    placeholder={t(locale, 'jobRoles.marketSalaryPh')}
                    className={FIELD}
                  />
                </FormField>
              </div>
            </div>
          </CollapsibleBlock>

          <FormField as="div" label={t(locale, 'jobRoles.rubricLabel')}>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <p className="m-0 min-w-0 flex-1 text-prose text-ink-muted">
                {t(locale, 'jobRoles.rubricHint')}
              </p>
              <button
                type="button"
                onClick={suggestRubricAi}
                disabled={saving || aiBusy || !String(form.name || '').trim()}
                aria-busy={aiBusy || undefined}
                className={cn(
                  'inline-flex min-h-touch shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-500/35 bg-brand-500/[0.09] px-3 py-2 font-ui text-prose text-brand-500',
                  (saving || aiBusy || !String(form.name || '').trim()) && 'cursor-default opacity-60'
                )}
              >
                {aiBusy ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'jobRoles.rubricAiWorking')} />
                ) : (
                  t(locale, 'jobRoles.rubricAiSuggest')
                )}
              </button>
            </div>
            <p className="m-0 mb-2 text-prose leading-normal text-ink/75">
              {t(locale, 'jobRoles.rubricAiHint')}
            </p>
            <RubricEditor
              value={form.rubric}
              onChange={(rubric) => setForm((cur) => ({ ...cur, rubric }))}
              locale={locale}
            />
          </FormField>
        </div>
      </AdminRichFormDrawer>
      <AdminRecordViewDrawer
        open={Boolean(viewingRole)}
        title={viewingRole?.name || ''}
        locale={locale}
        onClose={() => setViewingRole(null)}
        onEdit={viewingRole?.active ? () => openEdit(viewingRole) : null}
        editLabel={t(locale, 'jobRoles.editButton')}
        headerMeta={
          viewingRole ? (
            <StatusToneChip tone={viewingRole.active ? 'success' : 'neutral'}>
              {t(locale, viewingRole.active ? 'panel.recordView.active' : 'jobRoles.inactive')}
            </StatusToneChip>
          ) : null
        }
        sections={
          viewingRole
            ? [
                {
                  key: 'content',
                  fields: [
                    {
                      key: 'description',
                      label: t(locale, 'jobRoles.colDescription'),
                      value: htmlToPlainText(viewingRole.description || '') ? viewingRole.description : '',
                      kind: RECORD_FIELD_KIND.HTML,
                      emptyText: t(locale, 'jobRoles.noDescription'),
                    },
                    {
                      key: 'marketBand',
                      label: t(locale, 'jobRoles.colMarketBand'),
                      value: formatVacancySalaryRangeDisplay(viewingRole.marketSalaryMin, viewingRole.marketSalaryMax),
                      emptyText: t(locale, 'jobRoles.marketBandEmptyView'),
                    },
                    {
                      key: 'rubric',
                      label: t(locale, 'jobRoles.rubricLabel'),
                      value: Object.values(viewingRole.rubric || {}).some((weight) => Number(weight) > 0) ? (
                        <RubricEditor value={viewingRole.rubric} locale={locale} compact />
                      ) : (
                        ''
                      ),
                      full: true,
                      emptyText: t(locale, 'jobRoles.rubricEmpty'),
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
