'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { publicCompanyPath } from '../../../lib/public-job-url';
import { parseCompaniesPagination, parseCompaniesSort } from '../../../lib/assessment-filters';
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
  PanelSubNav,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { useAppFeedback } from '../../_components/AppFeedback';
import { DateField } from '../../_components/DateField';
import { EmptyState } from '../../_components/EmptyState';
import { AdminRichFormDrawer } from '../../_components/AdminRichFormDrawer';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { CopyableLink } from '../../_components/CopyableLink';
import { RichTextEditor } from '../../_components/RichTextEditor';
import { FormField } from '../../_components/FormField';
import { CompanyLogoCropDialog } from '../../_components/CompanyLogoCropDialog';
import { COMPANY_LOGO_ACCEPT } from '../../../lib/company-logo-limits';
import { CompanyModulesField } from '../../_components/CompanyModulesField';
import { ContentEnter } from '../../_components/AppLoading';
import { AiUsageAdminPanel } from './AiUsageAdminPanel';
import { OnboardingFunnelAdminPanel } from './OnboardingFunnelAdminPanel';
import {
  modulesSelectionForPersist,
  modulesSelectionForUi,
  SELECTABLE_COMPANY_MODULE_IDS,
} from '../../../lib/company-modules';

const FIELD_INPUT =
  'box-border w-full rounded-control border border-ink/12 bg-ink/[0.04] px-3 py-2.5 font-mono text-xs text-ink';
const BTN_GHOST =
  'min-h-touch rounded-control border border-ink/12 bg-transparent px-3.5 py-2.5 font-mono text-xs text-ink-muted disabled:cursor-default disabled:opacity-60';
const DIALOG_BTN_GHOST =
  'cursor-pointer rounded-control border border-ink/12 bg-transparent px-5 py-2.5 font-mono text-prose text-ink-muted disabled:cursor-default disabled:opacity-60';
const DIALOG_BTN_PRIMARY =
  'inline-flex cursor-pointer items-center gap-2 rounded-control border-none bg-action px-5 py-2.5 font-mono text-prose text-action-ink disabled:cursor-default disabled:opacity-60';

/** Minimal logo upload/preview for company drawer (create = local file; edit = POST/DELETE). */
function CompanyLogoField({
  locale,
  previewUrl,
  storageConfigured,
  uploadUrl,
  busy,
  error,
  disabled,
  onLocalFile,
  onPreviewUrl,
  onBusy,
  onError,
}) {
  const blobUrlsRef = useRef([]);
  const [cropFile, setCropFile] = useState(null);

  useEffect(() => () => {
    for (const u of blobUrlsRef.current) {
      try { URL.revokeObjectURL(u); } catch { /* ignore */ }
    }
    blobUrlsRef.current = [];
  }, []);

  const off = storageConfigured === false;
  const preview = String(previewUrl || '').trim();

  const uploadProcessed = async (file) => {
    if (!file) return;
    onError?.('');
    if (uploadUrl && storageConfigured !== false) {
      onBusy?.(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(uploadUrl, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.companyLogoUploadFailed'));
        onLocalFile?.(null);
        onPreviewUrl?.(data.logoUrl || data.url || '');
      } catch (e) {
        onError?.(e?.message || t(locale, 'panel.common.error'));
      } finally {
        onBusy?.(false);
      }
      return;
    }
    const localUrl = URL.createObjectURL(file);
    blobUrlsRef.current.push(localUrl);
    onLocalFile?.(file);
    onPreviewUrl?.(localUrl);
  };

  const onRemove = async () => {
    onError?.('');
    if (uploadUrl && storageConfigured !== false) {
      onBusy?.(true);
      try {
        const res = await fetch(uploadUrl, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        onLocalFile?.(null);
        onPreviewUrl?.('');
      } catch (e) {
        onError?.(e?.message || t(locale, 'panel.common.error'));
      } finally {
        onBusy?.(false);
      }
      return;
    }
    onLocalFile?.(null);
    onPreviewUrl?.('');
  };

  const blocked = off || busy || disabled;

  return (
    <div>
      <span className="font-mono text-2xs text-ink-faint">
        {t(locale, 'panel.admin.companyLogoUpload')}
      </span>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ink/12 bg-ink/[0.03]">
          {preview ? (
            <img src={preview} alt="" width={72} height={72} className="object-contain" />
          ) : (
            <span className="font-mono text-2xs text-ink-faint">—</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label
            className={cn(
              DIALOG_BTN_GHOST,
              'm-0 inline-flex min-h-touch items-center justify-center px-3 py-2',
              blocked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
            )}
          >
            <input
              type="file"
              accept={COMPANY_LOGO_ACCEPT}
              disabled={blocked}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) setCropFile(file);
              }}
            />
            {busy
              ? t(locale, 'panel.admin.companyLogoUploading')
              : t(locale, 'panel.admin.companyLogoChoose')}
          </label>
          {preview ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => void onRemove()}
              className={cn(DIALOG_BTN_GHOST, 'min-h-touch', blocked && 'opacity-55')}
            >
              {t(locale, 'panel.admin.companyLogoRemove')}
            </button>
          ) : null}
        </div>
      </div>
      {off ? (
        <p className="mb-0 mt-2 text-xs leading-snug text-ink-muted">
          {t(locale, 'panel.admin.companyLogoStorageOff')}
        </p>
      ) : (
        <p className="mb-0 mt-2 text-xs leading-snug text-ink-muted">
          {t(locale, 'panel.admin.companyLogoHint')}
        </p>
      )}
      {error ? (
        <p className="mb-0 mt-2 text-xs leading-snug text-danger">{error}</p>
      ) : null}
      <CompanyLogoCropDialog
        open={Boolean(cropFile)}
        file={cropFile}
        locale={locale}
        onCancel={() => setCropFile(null)}
        onApply={(processed) => {
          setCropFile(null);
          void uploadProcessed(processed);
        }}
      />
    </div>
  );
}

function emptyCompanyForm() {
  return {
    name: '',
    slug: '',
    website: '',
    aboutHtml: '',
    publicProfileEnabled: false,
    anniversaryDate: '',
    active: true,
    aiMonthlyCallLimit: '',
    moduleIds: [],
  };
}

export function CompaniesAdminTab({ navigateDashboard, locale, isSuperAdmin = false }) {
  const { confirm } = useAppFeedback();
  const urlParams = useSearchParams();
  const spKey = urlParams.toString();
  const sp = useMemo(() => Object.fromEntries(urlParams.entries()), [spKey]);
  const { page: companiesPage, pageSize: companiesPageSize } = parseCompaniesPagination(sp);
  const listSort = parseCompaniesSort(sp);
  const companiesQ = String(sp.companiesQ || '').trim();
  const companiesActive = String(sp.companiesActive || '').trim();
  const hasCompaniesFilter = Boolean(companiesQ || companiesActive);
  const companiesView =
    sp.companiesView === 'aiUsage'
      ? 'aiUsage'
      : sp.companiesView === 'onboarding' && isSuperAdmin
        ? 'onboarding'
        : 'list';
  const [searchDraft, setSearchDraft] = useState(companiesQ);
  const dateLocale = localeHtmlLang(locale);

  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companiesTotal, setCompaniesTotal] = useState(0);
  const [companiesTotalPages, setCompaniesTotalPages] = useState(1);
  const [logoStorageConfigured, setLogoStorageConfigured] = useState(false);
  const [aiDefaultLimit, setAiDefaultLimit] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [viewingCompany, setViewingCompany] = useState(null);
  const [drawerMode, setDrawerMode] = useState(null); // null | 'create' | 'edit'
  const [editingCompany, setEditingCompany] = useState(null);
  const [form, setForm] = useState(emptyCompanyForm);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [pendingLogoFile, setPendingLogoFile] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [modulesLoading, setModulesLoading] = useState(false);
  /** idle | checking | ok | taken | invalid */
  const [slugStatus, setSlugStatus] = useState('idle');
  const [slugNormalized, setSlugNormalized] = useState('');
  const slugCheckSeq = useRef(0);

  useEffect(() => {
    setSearchDraft(companiesQ);
  }, [companiesQ]);

  useEffect(() => {
    if (drawerMode !== 'create' && drawerMode !== 'edit') {
      setSlugStatus('idle');
      setSlugNormalized('');
      return undefined;
    }

    const raw = String(form.slug || '').trim();
    if (!raw) {
      // Create: empty slug is ok (server derives from name). Edit: empty is invalid.
      setSlugStatus(drawerMode === 'create' ? 'idle' : 'invalid');
      setSlugNormalized('');
      return undefined;
    }

    const excludeId = drawerMode === 'edit' && editingCompany?.id ? Number(editingCompany.id) : null;
    const ownSlug =
      drawerMode === 'edit' && editingCompany?.slug
        ? String(editingCompany.slug).toLowerCase()
        : '';

    const seq = ++slugCheckSeq.current;
    setSlugStatus('checking');
    const timer = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ checkSlug: raw });
        if (Number.isFinite(excludeId) && excludeId > 0) qs.set('excludeId', String(excludeId));
        const res = await fetch(`/api/admin/companies?${qs.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (seq !== slugCheckSeq.current) return;
        if (!res.ok) {
          setSlugStatus('idle');
          return;
        }
        const normalized = String(data.slug || '').toLowerCase();
        setSlugNormalized(data.slug || '');
        if (data.invalid) {
          setSlugStatus('invalid');
          return;
        }
        if (ownSlug && normalized === ownSlug) {
          setSlugStatus('ok');
          return;
        }
        setSlugStatus(data.available ? 'ok' : 'taken');
      } catch {
        if (seq === slugCheckSeq.current) setSlugStatus('idle');
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [form.slug, drawerMode, editingCompany?.id, editingCompany?.slug]);

  const pushCompaniesSearch = (q) => {
    if (!navigateDashboard) return;
    navigateDashboard({ companiesQ: q || '', companiesPage: 1, tab: 'companies' });
  };

  const toggleCompanySort = (col) => {
    if (!navigateDashboard) return;
    const nextDir = clientSortNextDir(col, listSort.sort, listSort.dir);
    navigateDashboard({ companiesSort: col, companiesSortDir: nextDir, companiesPage: 1, tab: 'companies' });
  };

  const appUrl =
    (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';

  const loadCompanies = async () => {
    setLoading(true);
    setError('');
    try {
      const snap = Object.fromEntries(urlParams.entries());
      const { page, pageSize } = parseCompaniesPagination(snap);
      const sortSt = parseCompaniesSort(snap);
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort: sortSt.sort,
        sortDir: sortSt.dir,
      });
      const q = String(snap.companiesQ || '').trim();
      if (q) qs.set('q', q);
      const active = String(snap.companiesActive || '').trim();
      if (active) qs.set('active', active);
      const res = await fetch(`/api/admin/companies?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.loadCompaniesFailed'));
      setCompanies(Array.isArray(data.items) ? data.items : []);
      setCompaniesTotal(typeof data.total === 'number' ? data.total : 0);
      setCompaniesTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1);
      setLogoStorageConfigured(Boolean(data.logoStorageConfigured));
      setAiDefaultLimit(Number.isFinite(data.aiDefaultMonthlyCallLimit) ? data.aiDefaultMonthlyCallLimit : null);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companiesView === 'list') loadCompanies();
  }, [spKey]); // eslint-disable-line react-hooks/exhaustive-deps


  const setFormField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const aiUsage = useMemo(() => {
    if (drawerMode !== 'edit' || !editingCompany) return null;
    const typed = String(form.aiMonthlyCallLimit ?? '').trim();
    const limit = typed !== '' && Number.isInteger(Number(typed)) ? Number(typed) : aiDefaultLimit;
    if (!Number.isFinite(limit) || limit < 0) return null;
    const used = Number(editingCompany.aiUsedThisMonth) || 0;
    return { used, limit, reached: used >= limit };
  }, [drawerMode, editingCompany, form.aiMonthlyCallLimit, aiDefaultLimit]);

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingCompany(null);
    setForm(emptyCompanyForm());
    setLogoPreviewUrl('');
    setPendingLogoFile(null);
    setLogoBusy(false);
    setLogoError('');
    setFormSaving(false);
  };

  const openCreateCompany = () => {
    setEditingCompany(null);
    setForm({
      ...emptyCompanyForm(),
      moduleIds: [...SELECTABLE_COMPANY_MODULE_IDS],
    });
    setLogoPreviewUrl('');
    setPendingLogoFile(null);
    setLogoError('');
    setDrawerMode('create');
  };

  const companyViewSections = (c) => {
    const token = c.activeToken || '';
    const exp = c.activeTokenExpiresAt ? new Date(c.activeTokenExpiresAt) : null;
    const careersPath = c.slug ? publicCompanyPath(c.slug) : '';
    const careersUrl = careersPath && appUrl ? `${appUrl}${careersPath}` : careersPath;
    const anniversary = c.anniversaryDate ? new Date(`${String(c.anniversaryDate).slice(0, 10)}T00:00:00`) : null;
    const aiLimit = c.aiMonthlyCallLimit;
    let aiLimitLabel = t(locale, 'panel.recordView.aiLimitDefault');
    if (aiLimit != null && Number(aiLimit) === 0) aiLimitLabel = t(locale, 'panel.recordView.aiLimitBlocked');
    else if (aiLimit != null) {
      aiLimitLabel = t(locale, 'panel.recordView.aiLimitValue', { n: Number(aiLimit).toLocaleString(dateLocale) });
    } else if (aiDefaultLimit != null) {
      aiLimitLabel = `${aiLimitLabel} (${t(locale, 'panel.recordView.aiLimitValue', { n: Number(aiDefaultLimit).toLocaleString(dateLocale) })})`;
    }
    return [
      {
        key: 'identity',
        title: t(locale, 'panel.recordView.sectionIdentity'),
        fields: [
          { key: 'slug', label: t(locale, 'panel.admin.colSlug'), value: c.slug },
          {
            key: 'website',
            label: t(locale, 'panel.admin.colWebsite'),
            value: c.website ? (/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`) : '',
            kind: RECORD_FIELD_KIND.LINK,
          },
          {
            key: 'anniversary',
            label: t(locale, 'panel.admin.editCompanyAnniversary'),
            value: anniversary && !Number.isNaN(anniversary.getTime()) ? anniversary.toLocaleDateString(dateLocale) : '',
          },
        ],
      },
      {
        key: 'status',
        title: t(locale, 'panel.recordView.sectionStatus'),
        fields: [
          {
            key: 'employees',
            label: t(locale, 'panel.admin.colActiveEmployees'),
            value: Number(c.activeEmployees || 0).toLocaleString(dateLocale),
          },
          {
            key: 'created',
            label: t(locale, 'panel.admin.colCreated'),
            value: c.createdAt ? new Date(c.createdAt).toLocaleDateString(dateLocale) : '',
          },
        ],
      },
      {
        key: 'access',
        title: t(locale, 'panel.recordView.sectionAccess'),
        fields: [
          {
            key: 'testLink',
            label: exp
              ? `${t(locale, 'panel.recordView.testLink')} · ${t(locale, 'panel.recordView.linkExpires', { date: exp.toLocaleDateString(dateLocale) })}`
              : t(locale, 'panel.recordView.testLink'),
            value: token && appUrl ? `${appUrl}/t/${token}` : '',
            kind: RECORD_FIELD_KIND.LINK,
            emptyText: t(locale, 'panel.recordView.noActiveLink'),
          },
          {
            key: 'careers',
            label: t(locale, 'panel.admin.colCareers'),
            value: c.publicProfileEnabled && careersUrl ? careersUrl : '',
            kind: RECORD_FIELD_KIND.LINK,
            emptyText: t(locale, 'panel.admin.companyPublicPageOff'),
          },
        ],
      },
      {
        key: 'usage',
        title: t(locale, 'panel.recordView.sectionUsage'),
        fields: [{ key: 'aiLimit', label: t(locale, 'panel.admin.companyAiLimit'), value: aiLimitLabel }],
      },
    ];
  };

  const editCompany = async (c) => {
    setEditingCompany(c);
    setForm({
      name: c?.name ?? '',
      slug: c?.slug ?? '',
      website: c?.website ?? '',
      aboutHtml: c?.aboutHtml ?? '',
      publicProfileEnabled: Boolean(c?.publicProfileEnabled),
      anniversaryDate:
        c?.anniversaryDate != null ? String(c.anniversaryDate).slice(0, 10) : '',
      active: Boolean(c?.active),
      aiMonthlyCallLimit: c?.aiMonthlyCallLimit != null ? String(c.aiMonthlyCallLimit) : '',
      moduleIds: [...SELECTABLE_COMPANY_MODULE_IDS],
    });
    setLogoPreviewUrl(c?.logoUrl ?? '');
    setPendingLogoFile(null);
    setLogoError('');
    setDrawerMode('edit');
    if (c?.id) {
      setModulesLoading(true);
      try {
        const res = await fetch(
          `/api/admin/company-modules?companyId=${encodeURIComponent(c.id)}`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setForm((prev) => ({
            ...prev,
            moduleIds: modulesSelectionForUi(data.enabledModules),
          }));
        }
      } catch {
        /* keep all-on default */
      } finally {
        setModulesLoading(false);
      }
    }
  };

  const submitCompanyForm = async () => {
    const nextName = String(form.name || '').trim();
    if (!nextName) return;
    if (slugStatus === 'taken' || slugStatus === 'invalid') {
      setError(
        slugStatus === 'taken'
          ? t(locale, 'panel.admin.companySlugTaken')
          : t(locale, 'panel.admin.companySlugInvalid')
      );
      return;
    }

    setFormSaving(true);
    setError('');
    setMsg('');
    try {
      if (drawerMode === 'create') {
        const res = await fetch('/api/admin/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nextName,
            slug: String(form.slug || '').trim() || undefined,
            website: String(form.website || '').trim() || null,
            aboutHtml: String(form.aboutHtml || '').trim() || null,
            publicProfileEnabled: form.publicProfileEnabled === true,
            anniversaryDate: String(form.anniversaryDate || '').trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            data?.error ||
              (res.status === 409
                ? t(locale, 'errors.SLUG_TAKEN')
                : t(locale, 'panel.admin.createCompanyFailed'))
          );
        }        if (pendingLogoFile && data?.id && logoStorageConfigured) {
          const fd = new FormData();
          fd.append('file', pendingLogoFile);
          const up = await fetch(`/api/admin/companies/${encodeURIComponent(data.id)}/logo`, {
            method: 'POST',
            body: fd,
          });
          const upData = await up.json().catch(() => ({}));
          if (!up.ok) throw new Error(upData?.error || t(locale, 'panel.admin.companyLogoUploadFailed'));
        }
        if (data?.id) {
          const modRes = await fetch('/api/admin/company-modules', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              companyId: data.id,
              modules: modulesSelectionForPersist(form.moduleIds),
            }),
          });
          const modData = await modRes.json().catch(() => ({}));
          if (!modRes.ok) {
            throw new Error(modData?.error || t(locale, 'panel.admin.companyModulesSaveFailed'));
          }
        }
        setMsg(t(locale, 'panel.admin.companyCreated'));
        closeDrawer();
        await loadCompanies();
        setTimeout(() => setMsg(''), 1600);
        return;
      }

      if (drawerMode === 'edit' && editingCompany?.id) {
        const res = await fetch(`/api/admin/companies/${encodeURIComponent(editingCompany.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nextName,
            slug: String(form.slug || '').trim(),
            active: form.active === true,
            website: String(form.website || '').trim() || null,
            aboutHtml: String(form.aboutHtml || '').trim() || null,
            publicProfileEnabled: form.publicProfileEnabled === true,
            anniversaryDate: String(form.anniversaryDate || '').trim() || null,
            aiMonthlyCallLimit: String(form.aiMonthlyCallLimit ?? '').trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            data?.error ||
              (res.status === 409
                ? t(locale, 'errors.SLUG_TAKEN')
                : t(locale, 'panel.admin.updateCompanyFailed'))
          );
        }
        const modRes = await fetch('/api/admin/company-modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: editingCompany.id,
            modules: modulesSelectionForPersist(form.moduleIds),
          }),
        });
        const modData = await modRes.json().catch(() => ({}));
        if (!modRes.ok) {
          throw new Error(modData?.error || t(locale, 'panel.admin.companyModulesSaveFailed'));
        }
        setMsg(t(locale, 'panel.admin.companyUpdated'));
        closeDrawer();
        await loadCompanies();
        setTimeout(() => setMsg(''), 1600);
      }
    } catch (e) {
      const message = e?.message || t(locale, 'panel.common.error');
      setError(message);
      // Surface empty-body 500s as a readable toast, not the raw JSON parse error.
      if (/Unexpected end of JSON|Failed to execute 'json'/i.test(String(message))) {
        setError(t(locale, 'panel.admin.updateCompanyFailed'));
      }
    } finally {
      setFormSaving(false);
    }
  };

  const rotateLink = async (companyId) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/companies/${encodeURIComponent(companyId)}/link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.rotateLinkFailed'));
      await loadCompanies();
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const deleteCompany = async (companyId, companyName) => {
    const ok = await confirm({
      message: t(locale, 'panel.admin.archiveCompanyConfirm', { name: companyName }),
      danger: true,
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.archiveCompanyFailed'));
      setMsg(t(locale, 'panel.admin.companyArchived'));
      await loadCompanies();
      setTimeout(() => setMsg(''), 1600);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className={cn(S.card, 'px-[18px] py-3.5')}>
          <p className="m-0 font-mono text-xs text-danger">{error}</p>
        </div>
      ) : null}
      {msg ? (
        <div className={cn(S.card, 'px-[18px] py-3.5')}>
          <p className="m-0 font-mono text-xs text-success">{msg}</p>
        </div>
      ) : null}

      <AdminPageHeader
        title={t(locale, 'panel.admin.companiesTitle')}
        subtitle={t(locale, 'panel.admin.companiesRegisterDesc')}
        actions={
          companiesView === 'list' ? (
          <>
            <AdminCreateButton
              label={t(locale, 'panel.admin.newCompanyBtn')}
              onClick={openCreateCompany}
              disabled={loading}
            />
            <button
              type="button"
              onClick={loadCompanies}
              disabled={loading}
              className={cn(BTN_GHOST, loading && 'opacity-60')}
            >
              {t(locale, 'panel.admin.refresh')}
            </button>
          </>
          ) : null
        }
      />

      <PanelSubNav
        ariaLabel={t(locale, 'panel.admin.companiesViewsAria')}
        active={companiesView}
        onChange={(next) =>
          navigateDashboard?.({
            tab: 'companies',
            companiesView: next === 'list' ? null : next,
            scroll: false,
            clientOnly: true,
          })
        }
        tabs={[
          { id: 'list', label: t(locale, 'panel.admin.companiesViewList') },
          { id: 'aiUsage', label: t(locale, 'panel.admin.aiUsageTitle') },
          ...(isSuperAdmin ? [{ id: 'onboarding', label: t(locale, 'panel.admin.onboardingFunnelTitle') }] : []),
        ]}
      />

      {companiesView === 'aiUsage' ? (
        <ContentEnter animKey="aiUsage">
          <AiUsageAdminPanel locale={locale} />
        </ContentEnter>
      ) : companiesView === 'onboarding' ? (
        <ContentEnter animKey="onboarding">
          <OnboardingFunnelAdminPanel locale={locale} />
        </ContentEnter>
      ) : (
      <div className={S.card}>
        <AdminListFilters
          aria-label={t(locale, 'panel.admin.companiesList')}
          locale={locale}
          onClear={() => {
            setSearchDraft('');
            if (!navigateDashboard) return;
            navigateDashboard({
              companiesQ: null,
              companiesActive: null,
              companiesPage: 1,
              tab: 'companies',
            });
          }}
          clearEnabled={Boolean(hasCompaniesFilter || String(searchDraft || '').trim())}
        >
          <AdminListSearch
            locale={locale}
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={(v) => pushCompaniesSearch(String(v || '').trim())}
            placeholder={t(locale, 'panel.admin.companiesSearchPh')}
          />
          <AdminListFilterSelect
            label={t(locale, 'panel.admin.filterActive')}
            value={companiesActive}
            onChange={(v) => {
              if (!navigateDashboard) return;
              navigateDashboard({
                companiesActive: v || null,
                companiesPage: 1,
                tab: 'companies',
              });
            }}
          >
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            <option value="active">{t(locale, 'panel.admin.filterActiveYes')}</option>
            <option value="inactive">{t(locale, 'panel.admin.filterActiveNo')}</option>
          </AdminListFilterSelect>
        </AdminListFilters>
        {companiesTotal === 0 ? (
          <div className="mt-3">
            <EmptyState
              message={
                hasCompaniesFilter
                  ? t(locale, 'panel.admin.noUsersMatch')
                  : t(locale, 'panel.admin.noCompaniesYet')
              }
              actionLabel={hasCompaniesFilter ? undefined : t(locale, 'panel.admin.createCompanyTitle')}
              onAction={hasCompaniesFilter ? undefined : openCreateCompany}
              actionDisabled={loading}
            />
          </div>
        ) : (
          <>
          <AdminTableShell locale={locale}
            minWidth="960px"
            className="mt-2.5"
            animKey={`${companiesQ}|${companiesActive}|${companiesPage}|${companiesPageSize}`}
          >
              <thead>
                <tr className="bg-ink/[0.02]">
                  <SortableTh columnKey="id" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleCompanySort}>{t(locale, 'panel.admin.sortId')}</SortableTh>
                  <SortableTh columnKey="name" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleCompanySort}>{t(locale, 'panel.admin.colName')}</SortableTh>
                  <SortableTh columnKey="slug" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleCompanySort}>{t(locale, 'panel.admin.colSlug')}</SortableTh>
                  <SortableTh columnKey="active" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleCompanySort}>{t(locale, 'panel.admin.colActive')}</SortableTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.colActiveEmployees')}</AdminTh>
                  <SortableTh columnKey="createdAt" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleCompanySort}>{t(locale, 'panel.admin.colCreated')}</SortableTh>
                  <AdminTh>{t(locale, 'panel.admin.colLinkT')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.admin.colCareers')}</AdminTh>
                  <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const token = c.activeToken || '';
                  const link = token ? `${appUrl}/t/${token}` : '';
                  const careersPath = c.slug ? publicCompanyPath(c.slug) : '';
                  const careersUrl = careersPath && appUrl ? `${appUrl}${careersPath}` : careersPath;
                  const publicOn = Boolean(c.publicProfileEnabled);
                  const exp = c.activeTokenExpiresAt ? new Date(c.activeTokenExpiresAt) : null;
                  const createdAt = c.createdAt ? new Date(c.createdAt) : null;
                  return (
                    <tr key={c.id} className="border-b border-ink/[0.07]">
                      <td className="px-4 py-2 align-middle font-mono text-ink-faint">#{c.id}</td>
                      <td className="px-4 py-2 align-middle text-ink">
                        <div className="flex items-center gap-2">
                          {c.logoUrl ? (
                            <img
                              src={c.logoUrl}
                              alt=""
                              width={24}
                              height={24}
                              className="shrink-0 rounded-md object-contain"
                            />
                          ) : null}
                          <span className="whitespace-nowrap">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 align-middle font-mono text-ink-muted whitespace-nowrap">{c.slug}</td>
                      <td className="px-4 py-2 align-middle font-mono text-ink-muted">
                        {c.active ? t(locale, 'panel.common.yes') : t(locale, 'panel.common.no')}
                      </td>
                      <td className="px-4 py-2 text-right align-middle font-mono tabular-nums text-ink">
                        {Number(c.activeEmployees || 0).toLocaleString(dateLocale)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-ink-faint">
                        {createdAt
                          ? createdAt.toLocaleDateString(dateLocale)
                          : t(locale, 'panel.common.notApplicable')}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        {token ? (
                          <CopyableLink
                            url={link}
                            locale={locale}
                            compact
                            iconOnly
                            label={t(locale, 'panel.admin.linkAssessmentShort')}
                            disabled={loading}
                            openLabel={
                              exp
                                ? `${t(locale, 'panel.common.openLink')}: ${t(locale, 'panel.admin.linkExpires', { date: exp.toLocaleString(dateLocale) })}`
                                : undefined
                            }
                          />
                        ) : (
                          <span className="font-mono text-2xs text-ink-faint">
                            {t(locale, 'panel.admin.noLinkShort')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        {publicOn && careersUrl ? (
                          <CopyableLink
                            url={careersUrl}
                            locale={locale}
                            compact
                            iconOnly
                            label={t(locale, 'panel.admin.companyPublicPageLabel')}
                            disabled={loading}
                          />
                        ) : (
                          <span className="font-mono text-2xs text-ink-faint">
                            {t(locale, 'panel.admin.companyPublicPageOffShort')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 align-middle text-right">
                        <AdminActionsCell>
                          <AdminViewButton
                            label={t(locale, 'panel.admin.view')}
                            onClick={() => setViewingCompany(c)}
                            disabled={loading}
                          />
                          <AdminEditButton
                            label={t(locale, 'panel.admin.edit')}
                            onClick={() => editCompany(c)}
                            disabled={loading}
                          />
                          <AdminIconButton
                            label={t(locale, 'panel.admin.rotateLink')}
                            icon="refresh"
                            tint="muted"
                            onClick={() => rotateLink(c.id)}
                            disabled={loading}
                          />
                          <AdminDeleteButton
                            label={t(locale, 'panel.admin.archive')}
                            onClick={() => deleteCompany(c.id, c.name)}
                            disabled={loading}
                          />
                        </AdminActionsCell>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </AdminTableShell>
            {navigateDashboard && companiesTotal > 0 ? (
              <AdminListPager
                locale={locale}
                page={companiesPage}
                pageSize={companiesPageSize}
                total={companiesTotal}
                loading={loading}
                countLabel={t(locale, 'panel.admin.companyCount', {
                  total: companiesTotal,
                  page: companiesPage,
                  totalPages: companiesTotalPages,
                })}
                onPageChange={(p) => navigateDashboard({ companiesPage: p, tab: 'companies' })}
                onPageSizeChange={(ps) =>
                  navigateDashboard({ companiesPage: 1, companiesPageSize: ps, tab: 'companies' })
                }
              />
            ) : null}
          </>
        )}
      </div>
      )}

      <AdminRecordViewDrawer
        open={Boolean(viewingCompany)}
        title={viewingCompany?.name || ''}
        locale={locale}
        onClose={() => setViewingCompany(null)}
        onEdit={viewingCompany ? () => editCompany(viewingCompany) : null}
        headerMeta={
          viewingCompany ? (
            <>
              {viewingCompany.logoUrl ? (
                <img src={viewingCompany.logoUrl} alt="" width={28} height={28} className="shrink-0 rounded-md object-contain" />
              ) : null}
              <StatusToneChip tone={viewingCompany.active ? 'success' : 'neutral'}>
                {t(locale, viewingCompany.active ? 'panel.recordView.activeFem' : 'panel.recordView.inactiveFem')}
              </StatusToneChip>
              <span className="font-mono text-ink-faint">#{viewingCompany.id}</span>
            </>
          ) : null
        }
        sections={viewingCompany ? companyViewSections(viewingCompany) : []}
      />

      <AdminRichFormDrawer
        open={drawerMode === 'create' || drawerMode === 'edit'}
        title={
          drawerMode === 'edit'
            ? t(locale, 'panel.admin.editCompanyTitle')
            : t(locale, 'panel.admin.createCompanyTitle')
        }
        locale={locale}
        onClose={() => {
          if (!formSaving && !logoBusy) closeDrawer();
        }}
        maxWidth="640px"
        footer={(
          <>
            <button
              type="button"
              onClick={closeDrawer}
              disabled={formSaving || logoBusy}
              className={DIALOG_BTN_GHOST}
            >
              {t(locale, 'panel.admin.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitCompanyForm()}
              disabled={
                formSaving ||
                logoBusy ||
                loading ||
                modulesLoading ||
                !String(form.name || '').trim() ||
                slugStatus === 'taken' ||
                slugStatus === 'invalid' ||
                slugStatus === 'checking'
              }
              className={cn(
                DIALOG_BTN_PRIMARY,
                (formSaving ||
                  logoBusy ||
                  loading ||
                  modulesLoading ||
                  !String(form.name || '').trim() ||
                  slugStatus === 'taken' ||
                  slugStatus === 'invalid' ||
                  slugStatus === 'checking') &&
                  'opacity-60'
              )}
            >
              {formSaving ? <span className="spinner" /> : null}
              {drawerMode === 'edit'
                ? t(locale, 'panel.common.save')
                : t(locale, 'panel.admin.create')}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3.5">
          <p className="m-0 text-prose leading-snug text-ink-muted">
            {drawerMode === 'edit'
              ? t(locale, 'panel.admin.editCompanyHelp')
              : t(locale, 'panel.admin.createCompanyHelp')}
          </p>
          <FormField label={t(locale, 'panel.admin.editCompanyName')}>
            <input
              value={form.name}
              onChange={(e) => setFormField('name', e.target.value)}
              placeholder={t(locale, 'panel.admin.companiesNamePlaceholder')}
              disabled={formSaving}
              className={FIELD_INPUT}
            />
          </FormField>
          <FormField label={t(locale, 'panel.admin.editCompanySlug')}>
            <input
              value={form.slug}
              onChange={(e) => setFormField('slug', e.target.value)}
              onBlur={() => {
                if (slugNormalized && slugNormalized !== String(form.slug || '').trim()) {
                  setFormField('slug', slugNormalized);
                }
              }}
              placeholder={t(locale, 'panel.admin.companySlugPlaceholder')}
              disabled={formSaving}
              aria-invalid={slugStatus === 'taken' || slugStatus === 'invalid'}
              className={cn(
                FIELD_INPUT,
                slugStatus === 'ok' && 'border-success/50 focus:border-success',
                slugStatus === 'taken' && 'border-danger/50 focus:border-danger',
                slugStatus === 'invalid' && 'border-warning/50 focus:border-warning'
              )}
            />
            {slugStatus === 'checking' ? (
              <span className="mt-1 block text-2xs leading-snug text-ink-muted">
                {t(locale, 'panel.admin.companySlugChecking')}
              </span>
            ) : null}
            {slugStatus === 'ok' ? (
              <span className="mt-1 block text-2xs leading-snug text-success">
                {t(locale, 'panel.admin.companySlugAvailable')}
                {slugNormalized ? ` (${slugNormalized})` : ''}
              </span>
            ) : null}
            {slugStatus === 'taken' ? (
              <span className="mt-1 block text-2xs leading-snug text-danger">
                {t(locale, 'panel.admin.companySlugTaken')}
              </span>
            ) : null}
            {slugStatus === 'invalid' && String(form.slug || '').trim() ? (
              <span className="mt-1 block text-2xs leading-snug text-warning">
                {t(locale, 'panel.admin.companySlugInvalid')}
              </span>
            ) : null}
            {slugStatus === 'idle' || (slugStatus === 'invalid' && !String(form.slug || '').trim()) ? (
              <span className="mt-1 block text-2xs leading-snug text-ink-muted">
                {t(locale, 'panel.admin.companySlugHelp')}
              </span>
            ) : null}
          </FormField>
          <FormField label={t(locale, 'panel.admin.editCompanyWebsite')}>
            <input
              value={form.website}
              onChange={(e) => setFormField('website', e.target.value)}
              placeholder={t(locale, 'panel.admin.editCompanyWebsitePh')}
              disabled={formSaving}
              className={FIELD_INPUT}
            />
          </FormField>
          <FormField
            as="div"
            label={t(locale, 'panel.admin.editCompanyAnniversary')}
            hint={t(locale, 'panel.admin.editCompanyAnniversaryHelp')}
          >
            <DateField
              value={form.anniversaryDate || ''}
              onChange={(e) => setFormField('anniversaryDate', e.target.value || '')}
              disabled={formSaving}
              aria-label={t(locale, 'panel.admin.editCompanyAnniversary')}
              className={FIELD_INPUT}
            />
          </FormField>
          <CompanyLogoField
            locale={locale}
            previewUrl={logoPreviewUrl}
            storageConfigured={logoStorageConfigured}
            uploadUrl={
              drawerMode === 'edit' && editingCompany?.id
                ? `/api/admin/companies/${encodeURIComponent(editingCompany.id)}/logo`
                : undefined
            }
            busy={logoBusy}
            error={logoError}
            disabled={formSaving}
            onLocalFile={setPendingLogoFile}
            onPreviewUrl={setLogoPreviewUrl}
            onBusy={setLogoBusy}
            onError={setLogoError}
          />
          <label
            className={cn(
              'flex items-start gap-2.5 font-mono text-xs text-ink',
              formSaving ? 'cursor-default' : 'cursor-pointer'
            )}
          >
            <input
              type="checkbox"
              checked={form.publicProfileEnabled === true}
              disabled={formSaving}
              onChange={(e) => setFormField('publicProfileEnabled', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-500"
            />
            <span>
              {t(locale, 'panel.admin.editCompanyPublicProfile')}
              <span className="mt-1 block text-2xs leading-snug text-ink-muted">
                {t(locale, 'panel.admin.editCompanyPublicProfileHelp')}
              </span>
            </span>
          </label>
          <FormField
            as="div"
            label={t(locale, 'panel.admin.editCompanyAbout')}
            hint={t(locale, 'panel.admin.editCompanyAboutHelp')}
          >
            <RichTextEditor
              value={form.aboutHtml}
              onChange={(html) => setFormField('aboutHtml', html)}
              placeholder={t(locale, 'panel.admin.editCompanyAboutPh')}
              minHeight={120}
              locale={locale}
              disabled={formSaving}
            />
          </FormField>
          {drawerMode === 'edit' ? (
            <label
              className={cn(
                'flex items-center gap-2.5 font-mono text-xs text-ink',
                formSaving ? 'cursor-default' : 'cursor-pointer'
              )}
            >
              <input
                type="checkbox"
                checked={form.active === true}
                disabled={formSaving}
                onChange={(e) => setFormField('active', e.target.checked)}
                className="h-4 w-4 accent-brand-500"
              />
              {t(locale, 'panel.admin.editCompanyActive')}
            </label>
          ) : null}
          {drawerMode === 'edit' ? (
            <FormField
              label={t(locale, 'panel.admin.companyAiLimit')}
              hint={t(locale, 'panel.admin.companyAiLimitHint', { default: aiDefaultLimit ?? '–' })}
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000000}
                step={1}
                value={form.aiMonthlyCallLimit}
                onChange={(e) => setFormField('aiMonthlyCallLimit', e.target.value)}
                placeholder={aiDefaultLimit != null ? String(aiDefaultLimit) : ''}
                disabled={formSaving}
                className={FIELD_INPUT}
              />
              {aiUsage ? (
                <span
                  className={cn(
                    'mt-1 block font-mono text-2xs leading-snug tabular-nums',
                    aiUsage.reached ? 'text-danger' : 'text-ink-muted'
                  )}
                >
                  {t(locale, 'panel.admin.companyAiUsage', { used: aiUsage.used, limit: aiUsage.limit })}
                  {aiUsage.reached ? ` · ${t(locale, 'panel.admin.companyAiLimitReached')}` : ''}
                </span>
              ) : null}
            </FormField>
          ) : null}
          <FormField
            as="div"
            label={t(locale, 'panel.admin.companyModulesLabel')}
            hint={t(locale, 'panel.admin.companyModulesHint')}
          >
            {modulesLoading ? (
              <p className={cn(S.faint, 'mb-0')}>{t(locale, 'panel.common.loading')}</p>
            ) : (
              <CompanyModulesField
                locale={locale}
                selectedIds={form.moduleIds || []}
                onChange={(ids) => setFormField('moduleIds', ids)}
                disabled={formSaving || modulesLoading}
                maxHeightClass="max-h-[240px]"
              />
            )}
          </FormField>
        </div>
      </AdminRichFormDrawer>

    </div>
  );
}
