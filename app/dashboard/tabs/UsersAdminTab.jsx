'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { InlineCallout } from '../../_components/InlineCallout';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { parseUsersPagination, parseUsersSort } from '../../../lib/assessment-filters';
import { ASSIGNABLE_MODULE_CAPS, ASSIGNABLE_MODULE_I18N } from '../../../lib/permissions';
import { clientSortNextDir, S, SortableTh, AdminListPager, AdminListSearch, AdminTableShell, AdminTh, AdminCreateButton, AdminEditButton, AdminDeleteButton, AdminActionsCell, AdminActionsTh, AdminViewButton, AdminIconButton, AdminPageHeader } from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { AdminRecordViewDrawer } from '../../_components/AdminRecordViewDrawer';


function moduleOptions(locale) {
  return ASSIGNABLE_MODULE_CAPS.map((cap) => ({
    value: cap,
    label: t(locale, ASSIGNABLE_MODULE_I18N[cap] || cap),
  }));
}

function roleSelectOptions(locale, includeAdmin) {
  return [
    { value: 'hr', label: t(locale, 'common.roles.hr') },
    { value: 'direction', label: t(locale, 'common.roles.direction') },
    ...(includeAdmin ? [{ value: 'admin', label: t(locale, 'common.roles.admin') }] : []),
  ];
}

function companySelectOptions(locale, companyOptions) {
  if (!companyOptions.length) {
    return [{ value: '', label: t(locale, 'panel.admin.noCompanyOption') }];
  }
  return companyOptions.map((c) => ({
    value: String(c.id),
    label: `${c.name} (#${c.id})`,
  }));
}

export function UsersAdminTab({ navigateDashboard, locale, canManageAllCompanies = true, currentUserId = null }) {
  const { promptForm } = useAppFeedback();
  const [viewingUser, setViewingUser] = useState(null);
  const urlParams = useSearchParams();
  const spKey = urlParams.toString();
  const dateLocale = localeHtmlLang(locale);

  const sp = useMemo(() => Object.fromEntries(urlParams.entries()), [spKey]);
  const { page: usersPage, pageSize: usersPageSize } = parseUsersPagination(sp);
  const listSort = parseUsersSort(sp);
  const usersQ = String(sp.usersQ || '').trim();
  const usersRole = String(sp.usersRole || '').trim();
  const usersActive = String(sp.usersActive || '').trim();
  const usersCompany = String(sp.usersCompany || '').trim();
  const hasUsersFilter = Boolean(usersQ || usersRole || usersActive || usersCompany);

  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState(usersQ);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setSearchDraft(usersQ);
  }, [usersQ]);

  const toggleUserSort = (col) => {
    if (!navigateDashboard) return;
    const nextDir = clientSortNextDir(col, listSort.sort, listSort.dir);
    navigateDashboard({ usersSort: col, usersSortDir: nextDir, usersPage: 1, tab: 'users' });
  };

  const pushUsersSearch = (value) => {
    if (!navigateDashboard) return;
    navigateDashboard({
      usersQ: value || null,
      usersPage: 1,
      tab: 'users',
    });
  };

  useEffect(() => {
    if (!canManageAllCompanies) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rc = await fetch('/api/admin/companies?forSelect=1');
        const dc = await rc.json();
        if (!rc.ok) throw new Error(dc?.error || t(locale, 'panel.admin.loadCompaniesFailed'));
        const list = Array.isArray(dc) ? dc : [];
        if (!cancelled) setCompanyOptions(list);
      } catch (e) {
        if (!cancelled) setError(e?.message || t(locale, 'panel.common.error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManageAllCompanies]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const snap = Object.fromEntries(urlParams.entries());
        const { page, pageSize } = parseUsersPagination(snap);
        const sortSt = parseUsersSort(snap);
        const qs = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          sort: sortSt.sort,
          sortDir: sortSt.dir,
        });
        const q = String(snap.usersQ || '').trim();
        if (q) qs.set('q', q);
        const role = String(snap.usersRole || '').trim();
        if (role) qs.set('role', role);
        const active = String(snap.usersActive || '').trim();
        if (active) qs.set('active', active);
        const companyId = String(snap.usersCompany || '').trim();
        if (companyId) qs.set('companyId', companyId);
        const ru = await fetch(`/api/admin/users?${qs.toString()}`);
        const du = await ru.json();
        if (!ru.ok) throw new Error(du?.error || t(locale, 'panel.admin.loadUsersFailed'));
        if (!cancelled) {
          setUsers(Array.isArray(du.items) ? du.items : []);
          setUsersTotal(typeof du.total === 'number' ? du.total : 0);
          setUsersTotalPages(typeof du.totalPages === 'number' ? du.totalPages : 1);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || t(locale, 'panel.common.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spKey]);

  const loadUsersOnly = async () => {
    const snap = Object.fromEntries(urlParams.entries());
    const { page, pageSize } = parseUsersPagination(snap);
    const sortSt = parseUsersSort(snap);
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortSt.sort,
      sortDir: sortSt.dir,
    });
    const q = String(snap.usersQ || '').trim();
    if (q) qs.set('q', q);
    const role = String(snap.usersRole || '').trim();
    if (role) qs.set('role', role);
    const active = String(snap.usersActive || '').trim();
    if (active) qs.set('active', active);
    const companyId = String(snap.usersCompany || '').trim();
    if (companyId) qs.set('companyId', companyId);
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/users?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.loadUsersFailed'));
      setUsers(Array.isArray(data.items) ? data.items : []);
      setUsersTotal(typeof data.total === 'number' ? data.total : 0);
      setUsersTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const refreshCompanyOptions = async () => {
    if (!canManageAllCompanies) return;
    try {
      const rc = await fetch('/api/admin/companies?forSelect=1');
      const dc = await rc.json();
      if (!rc.ok) throw new Error(dc?.error || t(locale, 'panel.admin.loadCompaniesFailed'));
      setCompanyOptions(Array.isArray(dc) ? dc : []);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    }
  };

  const openCreateUser = async () => {
    const defaultCompanyId = companyOptions[0] ? String(companyOptions[0].id) : '';

    // Step 1: identity only (email, optional password, role, company).
    const step1 = await promptForm({
      title: t(locale, 'panel.admin.createUserStep1Title'),
      message: t(locale, canManageAllCompanies ? 'panel.admin.passwordOptionalHelp' : 'panel.admin.inviteOnlyHelp'),
      confirmLabel: t(locale, 'panel.admin.createUserContinue'),
      fields: [
        {
          key: 'email',
          label: t(locale, 'panel.admin.editUserEmail'),
          placeholder: t(locale, 'panel.admin.emailPh'),
          defaultValue: '',
        },
        ...(canManageAllCompanies
          ? [
            {
              key: 'password',
              type: 'password',
              label: t(locale, 'panel.admin.passwordPh'),
              placeholder: t(locale, 'panel.admin.passwordPh'),
              defaultValue: '',
            },
          ]
          : []),
        {
          key: 'role',
          type: 'select',
          label: t(locale, canManageAllCompanies ? 'panel.admin.editUserRole' : 'panel.admin.editUserRoleTenant'),
          options: roleSelectOptions(locale, canManageAllCompanies),
          defaultValue: 'hr',
        },
        ...(canManageAllCompanies
          ? [
            {
              key: 'companyId',
              type: 'select',
              label: t(locale, 'panel.admin.editUserCompanyId'),
              options: companySelectOptions(locale, companyOptions),
              defaultValue: defaultCompanyId,
              showWhen: (v) => v.role !== 'admin',
            },
          ]
          : []),
      ],
    });
    if (!step1) return;

    // Step 2: optional module overrides. Cancel here aborts create entirely (safer than
    // creating with role defaults after the admin already dismissed module choice).
    const step2 = await promptForm({
      title: t(locale, 'panel.admin.createUserStep2Title'),
      message: t(locale, 'panel.admin.createUserStep2Help'),
      confirmLabel: t(locale, 'panel.admin.createUserBtn'),
      fields: [
        {
          key: 'modules',
          type: 'checkboxGroup',
          label: t(locale, 'panel.admin.userModulesLabel'),
          options: moduleOptions(locale),
          defaultValue: [],
        },
      ],
    });
    if (!step2) return;

    const email = String(step1.email || '').trim();
    const password = String(step1.password || '');
    const role = String(step1.role || '').trim();
    if (!email) return;

    const body = {
      email,
      role,
      companyId: role === 'admin' ? null : (step1.companyId ? parseInt(String(step1.companyId), 10) : null),
    };
    if (password.trim()) body.password = password;
    else body.sendInvite = true;
    // This create dialog promises role defaults when no override is selected.
    // An explicit [] means deny-all to the API and must remain valid for edits.
    if (Array.isArray(step2.modules) && step2.modules.length) body.modules = step2.modules;

    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.createUserFailed'));
      if (data.inviteSent) {
        setMsg(t(locale, 'panel.admin.userCreatedInviteSent', { email }));
      } else if (data.inviteError === 'SMTP_NOT_CONFIGURED' || data.inviteError) {
        setMsg(t(locale, 'panel.admin.userCreatedInvitePending', { email }));
      } else {
        setMsg(t(locale, 'panel.admin.userCreated'));
      }
      await loadUsersOnly();
      setTimeout(() => setMsg(''), 2800);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (userId) => {
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.deleteUserFailed'));
      setMsg(t(locale, 'panel.admin.userDeactivated'));
      await loadUsersOnly();
      setTimeout(() => setMsg(''), 1600);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const resendInvite = async (userId, email) => {
    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/resend-invite`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.resendInviteFailed'));
      setMsg(t(locale, 'panel.admin.resendInviteOk', { email: email || data.email || '' }));
      await loadUsersOnly();
      setTimeout(() => setMsg(''), 2800);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const userViewSections = (u) => {
    const origin = u.origin || 'admin';
    return [
      {
        key: 'identity',
        title: t(locale, 'panel.recordView.sectionIdentity'),
        fields: [
          { key: 'email', label: t(locale, 'panel.admin.colEmail'), value: u.email },
          { key: 'role', label: t(locale, 'panel.admin.colRole'), value: u.role ? t(locale, `common.roles.${u.role}`) : '' },
          {
            key: 'company',
            label: t(locale, 'panel.admin.colCompany'),
            value: u.companyName || (u.companyId != null ? `#${u.companyId}` : ''),
          },
          {
            key: 'origin',
            label: t(locale, 'panel.admin.colOrigin'),
            value: (
              <StatusToneChip
                tone={origin === 'admin' ? 'neutral' : 'info'}
                title={t(locale, `panel.admin.originHint.${origin}`)}
              >
                {t(locale, `panel.admin.origin.${origin}`)}
              </StatusToneChip>
            ),
          },
        ],
      },
      {
        key: 'status',
        title: t(locale, 'panel.recordView.sectionStatus'),
        fields: [
          {
            key: 'created',
            label: t(locale, 'panel.admin.colCreated'),
            value: u.createdAt ? new Date(u.createdAt).toLocaleString(dateLocale) : '',
          },
        ],
      },
    ];
  };

  const editUser = async (u) => {
    const emailLocked = !canManageAllCompanies && Number(u?.id) !== Number(currentUserId);
    const values = await promptForm({
      title: t(locale, 'panel.admin.editUserTitle'),
      message: t(locale, 'panel.admin.userModulesHint'),
      fields: [
        {
          key: 'email',
          label: t(locale, 'panel.admin.editUserEmail'),
          defaultValue: u?.email ?? '',
          disabled: emailLocked,
          help: emailLocked ? t(locale, 'panel.admin.emailLockedHelp') : undefined,
        },
        {
          key: 'role',
          type: 'select',
          label: t(locale, canManageAllCompanies ? 'panel.admin.editUserRole' : 'panel.admin.editUserRoleTenant'),
          options: roleSelectOptions(locale, canManageAllCompanies),
          defaultValue: u?.role ?? 'hr',
        },
        ...(canManageAllCompanies
          ? [
            {
              key: 'companyId',
              type: 'select',
              label: t(locale, 'panel.admin.editUserCompanyId'),
              options: companySelectOptions(locale, companyOptions),
              defaultValue: u?.companyId != null ? String(u.companyId) : (companyOptions[0] ? String(companyOptions[0].id) : ''),
              showWhen: (v) => v.role !== 'admin',
            },
          ]
          : []),
        {
          key: 'active',
          type: 'boolean',
          label: t(locale, 'panel.admin.editUserActive'),
          defaultValue: Boolean(u?.active),
        },
        ...(canManageAllCompanies
          ? [
            {
              key: 'password',
              label: t(locale, 'panel.admin.editUserPassword'),
              defaultValue: '',
              type: 'password',
            },
          ]
          : []),
        {
          key: 'modules',
          type: 'checkboxGroup',
          label: t(locale, 'panel.admin.userModulesLabel'),
          options: moduleOptions(locale),
          defaultValue: Array.isArray(u?.modules) ? u.modules : [],
        },
      ],
    });
    if (!values) return;

    const nextEmail = values.email;
    const nextRole = values.role;
    const nextCompanyIdRaw = values.companyId;
    const nextActive = values.active === true;
    const nextPassword = values.password;

    const payload = {
      role: String(nextRole).trim(),
      active: nextActive,
      modules: Array.isArray(values.modules) ? values.modules : [],
    };
    if (!emailLocked) payload.email = String(nextEmail).trim();
    if (canManageAllCompanies) {
      payload.companyId = payload.role !== 'admin' && String(nextCompanyIdRaw || '').trim()
        ? parseInt(String(nextCompanyIdRaw).trim(), 10)
        : null;
    }
    if (canManageAllCompanies && String(nextPassword || '').trim()) payload.password = String(nextPassword).trim();

    setLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.admin.updateUserFailed'));
      setMsg(t(locale, 'panel.admin.userUpdated'));
      await loadUsersOnly();
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
        <InlineCallout tone="danger" role="alert">{error}</InlineCallout>
      ) : null}
      {msg ? (
        <InlineCallout tone="success" role="status">{msg}</InlineCallout>
      ) : null}

      <AdminPageHeader
        title={t(locale, 'panel.admin.usersTitle')}
        subtitle={
          canManageAllCompanies ? (
            <>
              {t(locale, 'panel.admin.usersIntro')}
              <strong className="font-semibold text-ink">{t(locale, 'panel.admin.companiesTitle')}</strong>
              {t(locale, 'panel.admin.usersIntroSuffix')}
            </>
          ) : (
            t(locale, 'panel.admin.usersIntroCompany')
          )
        }
        actions={
          <>
            <AdminCreateButton
              label={t(locale, 'panel.admin.newUserBtn')}
              onClick={openCreateUser}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => {
                refreshCompanyOptions();
                loadUsersOnly();
              }}
              disabled={loading}
              className={cn(S.btnGhost, loading && 'opacity-60')}
            >
              {t(locale, 'panel.admin.refresh')}
            </button>
          </>
        }
      />

      <div className={S.card}>
        <AdminListFilters
          aria-label={t(locale, 'panel.admin.usersList')}
          locale={locale}
          onClear={() => {
            setSearchDraft('');
            if (!navigateDashboard) return;
            navigateDashboard({
              usersQ: null,
              usersRole: null,
              usersActive: null,
              usersCompany: null,
              usersPage: 1,
              tab: 'users',
            });
          }}
          clearEnabled={Boolean(hasUsersFilter || String(searchDraft || '').trim())}
        >
          <AdminListSearch
            locale={locale}
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={(v) => pushUsersSearch(String(v || '').trim())}
            placeholder={t(locale, 'panel.admin.usersSearchPh')}
          />
          <AdminListFilterSelect
            label={t(locale, 'panel.admin.filterRole')}
            value={usersRole}
            onChange={(v) => {
              if (!navigateDashboard) return;
              navigateDashboard({
                usersRole: v || null,
                usersPage: 1,
                tab: 'users',
              });
            }}
          >
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            <option value="hr">{t(locale, 'common.roles.hr')}</option>
            <option value="direction">{t(locale, 'common.roles.direction')}</option>
            {canManageAllCompanies ? <option value="admin">{t(locale, 'common.roles.admin')}</option> : null}
          </AdminListFilterSelect>
          <AdminListFilterSelect
            label={t(locale, 'panel.admin.filterActive')}
            value={usersActive}
            onChange={(v) => {
              if (!navigateDashboard) return;
              navigateDashboard({
                usersActive: v || null,
                usersPage: 1,
                tab: 'users',
              });
            }}
          >
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            <option value="active">{t(locale, 'panel.admin.filterActiveYes')}</option>
            <option value="inactive">{t(locale, 'panel.admin.filterActiveNo')}</option>
          </AdminListFilterSelect>
          {companyOptions.length > 0 ? (
            <AdminListFilterSelect
              label={t(locale, 'panel.admin.filterCompany')}
              value={usersCompany}
              onChange={(v) => {
                if (!navigateDashboard) return;
                navigateDashboard({
                  usersCompany: v || null,
                  usersPage: 1,
                  tab: 'users',
                });
              }}
            >
              <option value="">{t(locale, 'panel.admin.filterAll')}</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </AdminListFilterSelect>
          ) : null}
        </AdminListFilters>
        {usersTotal === 0 ? (
          <div className="mt-3">
            <EmptyState
              message={
                hasUsersFilter
                  ? t(locale, 'panel.admin.noUsersMatch')
                  : t(locale, 'panel.admin.noUsersYet')
              }
              actionLabel={hasUsersFilter ? undefined : t(locale, 'panel.admin.createUserBtn')}
              onAction={hasUsersFilter ? undefined : openCreateUser}
              actionDisabled={loading}
            />
          </div>
        ) : (
          <>
          <AdminTableShell locale={locale}
            minWidth="640px"
            className="mt-2.5"
            animKey={`${usersQ}|${usersRole}|${usersActive}|${usersCompany}|${usersPage}|${usersPageSize}`}
          >
              <thead>
                <tr className="bg-ink/[0.02]">
                  <SortableTh columnKey="id" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.sortId')}</SortableTh>
                  <SortableTh columnKey="displayName" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colDisplayName')}</SortableTh>
                  <SortableTh columnKey="email" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colEmail')}</SortableTh>
                  <SortableTh columnKey="role" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colRole')}</SortableTh>
                  <AdminTh>{t(locale, 'panel.admin.colOrigin')}</AdminTh>
                  {canManageAllCompanies ? (
                    <SortableTh columnKey="companyName" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colCompany')}</SortableTh>
                  ) : null}
                  <SortableTh columnKey="active" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colUserActive')}</SortableTh>
                  <SortableTh columnKey="createdAt" sortKey={listSort.sort} dir={listSort.dir} onSort={toggleUserSort}>{t(locale, 'panel.admin.colUserCreated')}</SortableTh>
                  <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const companyLabel = u.role === 'admin' ? t(locale, 'panel.common.notApplicable') : (u.companyName || `#${u.companyId || t(locale, 'panel.common.notApplicable')}`);
                  const createdAt = u.createdAt ? new Date(u.createdAt) : null;
                  return (
                    <tr key={u.id} className="border-b border-ink/[0.07]">
                      <td className="px-4 py-3 font-mono text-ink-faint">#{u.id}</td>
                      <td className="px-4 py-3 text-ink">
                        {u.displayName || t(locale, 'panel.common.notApplicable')}
                      </td>
                      <td className="px-4 py-3 text-ink">{u.email}</td>
                      <td className="px-4 py-3">
                        <StatusToneChip tone="neutral">{t(locale, `common.roles.${u.role}`)}</StatusToneChip>
                        {u.capabilitiesCustomized ? (
                          <StatusToneChip
                            tone="brand"
                            title={t(locale, 'panel.admin.userModulesHint')}
                            className="ml-1.5"
                          >
                            {t(locale, 'panel.admin.userModulesCustom')}
                          </StatusToneChip>
                        ) : null}
                        {u.passwordSetupPending ? (
                          <StatusToneChip
                            tone="neutral"
                            title={t(locale, 'panel.admin.passwordSetupPendingHint')}
                            className="ml-1.5"
                          >
                            {t(locale, 'panel.admin.passwordSetupPending')}
                          </StatusToneChip>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <StatusToneChip
                          tone={u.origin === 'admin' || !u.origin ? 'neutral' : 'info'}
                          title={t(locale, `panel.admin.originHint.${u.origin || 'admin'}`)}
                        >
                          {t(locale, `panel.admin.origin.${u.origin || 'admin'}`)}
                        </StatusToneChip>
                        {u.signupPending ? (
                          <div className="mt-1 font-mono text-2xs text-warning">
                            {t(locale, 'panel.admin.signupPendingBadge')}
                          </div>
                        ) : null}
                      </td>
                      {canManageAllCompanies ? (
                        <td className="px-4 py-3 font-mono text-ink-muted">{companyLabel}</td>
                      ) : null}
                      <td className="px-4 py-3 font-mono text-ink-muted">{u.active ? t(locale, 'panel.common.yes') : t(locale, 'panel.common.no')}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-ink-faint">
                        {createdAt ? createdAt.toLocaleString(dateLocale) : t(locale, 'panel.common.notApplicable')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AdminActionsCell>
                          {u.passwordSetupPending ? (
                            <AdminIconButton
                              label={t(locale, 'panel.admin.resendInvite')}
                              icon="refresh"
                              onClick={() => resendInvite(u.id, u.email)}
                              disabled={loading}
                            />
                          ) : (
                            <AdminViewButton
                              label={t(locale, 'panel.admin.viewUser')}
                              onClick={() => setViewingUser(u)}
                              disabled={loading}
                            />
                          )}
                          <AdminEditButton
                            label={t(locale, 'panel.admin.editUser')}
                            onClick={() => editUser(u)}
                            disabled={loading}
                          />
                          <AdminDeleteButton
                            label={t(locale, 'panel.admin.deactivate')}
                            onClick={() => deleteUser(u.id)}
                            disabled={loading}
                          />
                        </AdminActionsCell>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </AdminTableShell>
            {navigateDashboard && usersTotal > 0 ? (
              <AdminListPager
                locale={locale}
                page={usersPage}
                pageSize={usersPageSize}
                total={usersTotal}
                loading={loading}
                countLabel={t(locale, 'panel.admin.userCount', {
                  total: usersTotal,
                  page: usersPage,
                  totalPages: usersTotalPages,
                })}
                onPageChange={(p) => navigateDashboard({ usersPage: p, tab: 'users' })}
                onPageSizeChange={(ps) =>
                  navigateDashboard({ usersPage: 1, usersPageSize: ps, tab: 'users' })
                }
              />
            ) : null}
          </>
        )}
      </div>
      <AdminRecordViewDrawer
        open={Boolean(viewingUser)}
        title={viewingUser ? viewingUser.displayName || viewingUser.email || `#${viewingUser.id}` : ''}
        locale={locale}
        onClose={() => setViewingUser(null)}
        onEdit={viewingUser ? () => editUser(viewingUser) : null}
        editLabel={t(locale, 'panel.admin.editUser')}
        headerMeta={
          viewingUser ? (
            <>
              <StatusToneChip tone={viewingUser.active ? 'success' : 'neutral'}>
                {t(locale, viewingUser.active ? 'panel.recordView.active' : 'panel.recordView.inactive')}
              </StatusToneChip>
              {viewingUser.capabilitiesCustomized ? (
                <StatusToneChip tone="brand" title={t(locale, 'panel.admin.userModulesHint')}>
                  {t(locale, 'panel.admin.userModulesCustom')}
                </StatusToneChip>
              ) : null}
              {viewingUser.signupPending ? (
                <StatusToneChip tone="warning">{t(locale, 'panel.admin.signupPendingBadge')}</StatusToneChip>
              ) : null}
            </>
          ) : null
        }
        sections={viewingUser ? userViewSections(viewingUser) : []}
      />
    </div>
  );
}
