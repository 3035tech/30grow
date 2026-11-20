'use client';

import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { CompanyScopeNotice } from '../../_components/CompanyScopeNotice';
import {
  AdminRichFormDrawer,
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
} from '../../_components/AdminRichFormDrawer';
import { VacancyFormFields } from './VacancyFormFields';

/** Create and edit workspaces for vacancies. Form state stays owned by the list route. */
export function VacancyFormDrawers({
  locale,
  isAdmin,
  companyId,
  sessionCompanyId,
  sessionCompanyName,
  companies,
  showCreate,
  closeCreate,
  loading,
  createDisabled,
  createVacancy,
  createFormValues,
  patchCreateForm,
  error,
  jobRoles,
  pipelineTemplates,
  pipelineTemplatesLoading,
  pipelineTemplatesError,
  descAiBusy,
  setDescAiBusy,
  editingVacancy,
  editingVacancyBaseline,
  setEditingVacancy,
  setEditingVacancyBaseline,
  closeVacancyEditor,
  saveVacancyEdit,
}) {
  return (
    <>
      <AdminRichFormDrawer
        headerMeta={<CompanyScopeNotice locale={locale} companyId={isAdmin ? companyId : sessionCompanyId} companyName={isAdmin ? companies.find((company) => String(company.id) === String(companyId))?.name : sessionCompanyName} />}
        open={showCreate}
        title={t(locale, 'recruiting.createVacancyDrawerTitle')}
        locale={locale}
        onClose={closeCreate}
        footer={(
          <>
            <button type="button" onClick={closeCreate} disabled={loading} className={dialogBtnGhostClass}>
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={createVacancy}
              disabled={createDisabled}
              className={cn(dialogBtnPrimaryClass, 'inline-flex items-center gap-2', createDisabled && 'opacity-60')}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              {t(locale, 'panel.admin.create')}
            </button>
          </>
        )}
      >
        {showCreate ? (
          <div aria-busy={loading}>
            <VacancyFormFields
              locale={locale}
              mode="create"
              layout="stack"
              values={createFormValues}
              onChange={patchCreateForm}
              error={error}
              isAdmin={isAdmin}
              companies={companies}
              jobRoles={jobRoles}
              pipelineTemplates={pipelineTemplates}
              pipelineTemplatesLoading={pipelineTemplatesLoading}
              pipelineTemplatesError={pipelineTemplatesError}
              descAiBusy={descAiBusy}
              onDescAiBusyChange={setDescAiBusy}
            />
          </div>
        ) : null}
      </AdminRichFormDrawer>

      <AdminRichFormDrawer
        open={Boolean(editingVacancy)}
        title={t(locale, 'recruiting.editVacancyDrawerTitle')}
        locale={locale}
        headerMeta={editingVacancy ? (
          <>
            <CompanyScopeNotice
              locale={locale}
              companyId={editingVacancy.companyId}
              companyName={editingVacancy.companyName || companies.find((company) => String(company.id) === String(editingVacancy.companyId))?.name}
            />
            <span className="font-mono tabular-nums text-ink-muted">#{editingVacancy.id}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 break-words">{editingVacancy.title || t(locale, 'recruiting.vacancyTitlePh')}</span>
          </>
        ) : null}
        dirty={Boolean(editingVacancyBaseline && JSON.stringify(editingVacancy) !== editingVacancyBaseline)}
        busy={loading}
        onClose={() => { setEditingVacancy(null); setEditingVacancyBaseline(''); }}
        footer={(
          <>
            <button type="button" onClick={() => void closeVacancyEditor()} disabled={loading} className={dialogBtnGhostClass}>
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={saveVacancyEdit}
              disabled={loading || !editingVacancy}
              className={cn(dialogBtnPrimaryClass, 'inline-flex items-center gap-2', (loading || !editingVacancy) && 'opacity-60')}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              {t(locale, 'panel.admin.save')}
            </button>
          </>
        )}
      >
        {editingVacancy ? (
          <div aria-busy={loading}>
            <VacancyFormFields
              locale={locale}
              mode="edit"
              layout="stack"
              values={editingVacancy}
              onChange={(patch) => setEditingVacancy((current) => ({ ...current, ...patch }))}
              error={error}
              jobRoles={jobRoles}
              descAiBusy={descAiBusy}
              onDescAiBusyChange={setDescAiBusy}
            />
          </div>
        ) : null}
      </AdminRichFormDrawer>
    </>
  );
}
