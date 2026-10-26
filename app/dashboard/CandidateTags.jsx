'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { t } from '../../lib/i18n';
import { CANDIDATE_TAG_COLORS, MAX_CANDIDATE_TAGS } from '../../lib/recruiting/candidate-tags-core';
import { AdminRichFormDrawer } from '../_components/AdminRichFormDrawer';
import { SelectField } from '../_components/SelectField';
import { useAppFeedback } from '../_components/AppFeedback';
import { dialogBtnPrimaryClass } from '../_components/app-dialog-styles';
import { fieldCheckboxClass, fieldInputClass } from '../_components/form-control-styles';
import { cn } from '../../lib/cn';

const TagsContext = createContext(null);
const buttonClass =
  'min-h-touch cursor-pointer rounded-control border border-ink/12 bg-transparent px-3 py-1.5 font-ui text-sm text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-default disabled:opacity-50';
const inputClass = `w-full ${fieldInputClass}`;
const emptyDraft = () => ({ id: null, name: '', color: CANDIDATE_TAG_COLORS[0], active: true });

export function CandidateTagsProvider(props) {
  return <CandidateTagsScope key={`${props.companyId}:${props.locale || 'pt-BR'}`} {...props} />;
}

function CandidateTagsScope({ companyId, locale = 'pt-BR', onChanged, children }) {
  const { toast } = useAppFeedback();
  const nameInputRef = useRef(null);
  const [catalog, setCatalog] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [manager, setManager] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [overrides, setOverrides] = useState({});

  // Wait for the async form to re-enable its input before returning keyboard focus.
  useEffect(() => {
    if (savedMessage && !busy) nameInputRef.current?.focus();
  }, [savedMessage, busy]);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(
    async (signal) => {
      if (!companyId) return null;
      const response = await fetch(
        `/api/admin/candidate-tags?companyId=${encodeURIComponent(companyId)}`,
        { signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t(locale, 'candidateTags.loadFailed'));
      return data;
    },
    [companyId, locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        setLoadError('');
        setCatalog(data.tags || []);
        setCanManage(data.canManage === true);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, reloadKey]);

  const mutate = async (url, method, body) => {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, companyId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
    return data;
  };

  const saveAssignments = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await mutate(`/api/admin/candidates/${target.id}/tags`, 'PUT', {
        tagIds: selected,
      });
      setOverrides((current) => ({ ...current, [target.id]: data.tags }));
      setTarget(null);
      toast(t(locale, 'candidateTags.saved'), 'ok');
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async (event) => {
    event.preventDefault();
    setSavedMessage('');
    setBusy(true);
    setError('');
    try {
      const data = await mutate(
        `/api/admin/candidate-tags${draft.id ? `/${draft.id}` : ''}`,
        draft.id ? 'PATCH' : 'POST',
        draft,
      );
      setCatalog((current) =>
        [...current.filter((tag) => Number(tag.id) !== Number(data.tag.id)), data.tag].sort(
          (a, b) => a.name.localeCompare(b.name, locale),
        ),
      );
      if (target && !draft.id && selected.length < MAX_CANDIDATE_TAGS) {
        setSelected((current) => [...current, Number(data.tag.id)]);
      }
      setSavedMessage(t(locale, draft.id ? 'candidateTags.updated' : 'candidateTags.created'));
      setDraft(emptyDraft());
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const catalogById = useMemo(
    () => new Map(catalog.map((tag) => [Number(tag.id), tag])),
    [catalog],
  );
  const openManager = () => {
    setManager(true);
    setDraft(emptyDraft());
    setCatalogSearch('');
    setSavedMessage('');
    setError('');
  };
  const closeManager = () => {
    if (busy) return;
    setManager(false);
    setError('');
  };
  const selectionChanged =
    target &&
    (selected.length !== target.tagIds.length ||
      selected.some((id) => !target.tagIds.includes(id)));
  const matchingCatalog = catalog.filter((tag) =>
    tag.name.toLocaleLowerCase(locale).includes(catalogSearch.toLocaleLowerCase(locale)),
  );
  const value = {
    catalog,
    catalogById,
    canManage,
    loading,
    loadError,
    reload: () => {
      setLoading(true);
      setLoadError('');
      setReloadKey((current) => current + 1);
    },
    overrides,
    edit: (id, name, tags) => {
      setTarget({ id, name, tagIds: tags.map((tag) => Number(tag.id)) });
      setSelected(tags.map((tag) => Number(tag.id)));
      setSearch('');
      setError('');
    },
    manage: openManager,
  };
  const visible = catalog.filter(
    (tag) =>
      (tag.active || selected.includes(Number(tag.id))) &&
      tag.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)),
  );

  return (
    <TagsContext.Provider value={value}>
      {children}
      <AdminRichFormDrawer
        open={Boolean(target) && !manager}
        title={`${t(locale, 'candidateTags.title')} · ${target?.name || ''}`}
        locale={locale}
        maxWidth="520px"
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              {t(locale, 'panel.common.cancel')}
            </button>
            <button
              type="button"
              className={dialogBtnPrimaryClass}
              disabled={busy || !selectionChanged || selected.length > MAX_CANDIDATE_TAGS}
              aria-busy={busy}
              onClick={saveAssignments}
            >
              {t(locale, busy ? 'candidateTags.saving' : 'candidateTags.save')}
            </button>
          </>
        }
      >
        <p className="mt-0 mb-4 text-sm leading-relaxed text-ink-muted">
          {t(locale, 'candidateTags.selectHint')}
        </p>
        <input
          className={inputClass}
          aria-label={t(locale, 'candidateTags.search')}
          placeholder={t(locale, 'candidateTags.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto" aria-busy={busy}>
          {visible.map((tag) => (
            <label
              key={tag.id}
              className={cn(
                'flex min-h-touch cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors hover:bg-ink/[0.035]',
                selected.includes(Number(tag.id)) && 'bg-brand-500/[0.06]',
              )}
            >
              <input
                type="checkbox"
                className={fieldCheckboxClass}
                checked={selected.includes(Number(tag.id))}
                disabled={
                  busy ||
                  (!selected.includes(Number(tag.id)) && selected.length >= MAX_CANDIDATE_TAGS)
                }
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, Number(tag.id)]
                      : current.filter((id) => id !== Number(tag.id)),
                  )
                }
              />
              <TagChip tag={tag} locale={locale} />
            </label>
          ))}
          {!visible.length ? (
            <div className="py-6 text-center text-sm text-ink-muted">
              <p className="m-0">
                {t(locale, search ? 'candidateTags.noMatch' : 'candidateTags.catalogEmpty')}
              </p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-3">
          <span role="status" className="text-xs text-ink-muted">
            {t(locale, 'candidateTags.selectionCount', {
              n: selected.length,
              max: MAX_CANDIDATE_TAGS,
            })}
          </span>
          <button
            type="button"
            className="min-h-touch rounded-control px-2 text-sm font-medium text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
            disabled={busy}
            onClick={openManager}
          >
            {t(locale, catalog.length ? 'candidateTags.manage' : 'candidateTags.createFirst')}
          </button>
        </div>
        {selected.length >= MAX_CANDIDATE_TAGS ? (
          <p className="mb-0 text-xs text-ink-muted">
            {t(locale, 'candidateTags.limitHint', { max: MAX_CANDIDATE_TAGS })}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-control border border-danger/20 bg-danger/5 p-3 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
      </AdminRichFormDrawer>
      <AdminRichFormDrawer
        open={manager}
        title={t(locale, 'candidateTags.manage')}
        locale={locale}
        maxWidth="620px"
        onClose={closeManager}
        footer={
          <button
            type="button"
            className={target ? dialogBtnPrimaryClass : buttonClass}
            disabled={busy}
            onClick={closeManager}
          >
            {t(locale, target ? 'candidateTags.backToSelection' : 'candidateTags.done')}
          </button>
        }
      >
        <p className="mt-0 mb-5 text-sm leading-relaxed text-ink-muted">
          {t(locale, 'candidateTags.companyHint')}
        </p>
        <form onSubmit={saveTag} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 shrink-0 text-sm font-semibold text-ink">
              {t(locale, draft.id ? 'candidateTags.editTag' : 'candidateTags.newTag')}
            </h3>
            <div className="min-w-0 max-w-[60%]" aria-label={t(locale, 'candidateTags.preview')}>
              <TagChip
                tag={{
                  ...draft,
                  name: draft.name.trim() || t(locale, 'candidateTags.previewPlaceholder'),
                }}
                locale={locale}
              />
            </div>
          </div>
          <label className="block text-sm font-medium text-ink">
            {t(locale, 'candidateTags.name')}
            <input
              required
              maxLength={40}
              ref={nameInputRef}
              className={cn(inputClass, 'mt-1.5')}
              value={draft.name}
              placeholder={t(locale, 'candidateTags.namePlaceholder')}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <fieldset disabled={busy} className="flex flex-wrap gap-1 border-0 p-0">
              <legend className="mb-2 text-sm font-medium text-ink">
                {t(locale, 'candidateTags.color')}
              </legend>
              {CANDIDATE_TAG_COLORS.map((color, index) => (
                <label
                  key={color}
                  className="relative grid h-9 w-9 cursor-pointer place-items-center"
                  title={t(locale, `candidateTags.colors.c${index}`)}
                >
                  <input
                    type="radio"
                    className="peer sr-only"
                    name="candidate-tag-color"
                    value={color}
                    checked={draft.color === color}
                    aria-label={t(locale, `candidateTags.colors.c${index}`)}
                    onChange={() => setDraft((current) => ({ ...current, color }))}
                  />
                  <span
                    className="grid h-7 w-7 place-items-center rounded-full text-sm text-white ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-ink/70 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand-500 peer-disabled:opacity-50"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  >
                    {draft.color === color ? '✓' : ''}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          {draft.id ? (
            <div>
              <label className="flex min-h-touch items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className={fieldCheckboxClass}
                  checked={draft.active}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, active: event.target.checked }))
                  }
                />
                {t(locale, 'candidateTags.active')}
              </label>
              <p className="mt-0 text-xs leading-relaxed text-ink-muted">
                {t(locale, 'candidateTags.inactiveHint')}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className={dialogBtnPrimaryClass}
              disabled={busy || !draft.name.trim()}
              aria-busy={busy}
              type="submit"
            >
              {t(
                locale,
                busy
                  ? 'candidateTags.saving'
                  : draft.id
                    ? 'candidateTags.save'
                    : 'candidateTags.create',
              )}
            </button>
            {draft.id ? (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => setDraft(emptyDraft())}
              >
                {t(locale, 'panel.common.cancel')}
              </button>
            ) : null}
          </div>
        </form>
        {savedMessage ? (
          <p role="status" className="mb-0 mt-3 text-sm text-success">
            {savedMessage}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-control border border-danger/20 bg-danger/5 p-3 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-6 border-t border-ink/10 pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold text-ink">
              {t(locale, 'candidateTags.companyTags')}
            </h3>
            <span className="text-xs tabular-nums text-ink-muted">{catalog.length}</span>
          </div>
          {catalog.length ? (
            <input
              className={inputClass}
              aria-label={t(locale, 'candidateTags.catalogSearch')}
              placeholder={t(locale, 'candidateTags.search')}
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
          ) : null}
          <div className="mt-2 max-h-64 divide-y divide-ink/8 overflow-y-auto">
            {matchingCatalog.map((tag) => (
              <div
                key={tag.id}
                className="flex min-h-touch items-center justify-between gap-3 py-2"
              >
                <TagChip tag={tag} locale={locale} />
                <button
                  type="button"
                  className={cn(buttonClass, 'shrink-0')}
                  disabled={busy}
                  onClick={() => {
                    setDraft({ ...tag, id: Number(tag.id) });
                    setSavedMessage('');
                    setError('');
                    nameInputRef.current?.focus();
                  }}
                >
                  {t(locale, 'candidateTags.editTag')}
                </button>
              </div>
            ))}
            {!matchingCatalog.length ? (
              <p className="py-3 text-sm text-ink-muted">
                {t(locale, catalogSearch ? 'candidateTags.noMatch' : 'candidateTags.catalogEmpty')}
              </p>
            ) : null}
          </div>
        </div>
      </AdminRichFormDrawer>
    </TagsContext.Provider>
  );
}

function TagChip({ tag, locale, children }) {
  const color = CANDIDATE_TAG_COLORS.includes(tag.color) ? tag.color : CANDIDATE_TAG_COLORS[0];
  const inactive = tag.active === false;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none',
        inactive ? 'border-ink/12 bg-ink/[0.035] text-ink-muted' : 'text-ink',
      )}
      style={inactive ? undefined : { backgroundColor: `${color}16`, borderColor: `${color}55` }}
      title={inactive ? `${tag.name} · ${t(locale, 'candidateTags.inactiveHint')}` : tag.name}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', inactive && 'bg-ink/30')}
        style={inactive ? undefined : { backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="max-w-[12rem] truncate leading-4">{tag.name}</span>
      {inactive ? (
        <span className="shrink-0 text-[10px] font-normal">
          {t(locale, 'candidateTags.inactive')}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function CandidateTags({ candidateId, name, tags = [], locale = 'pt-BR' }) {
  const context = useContext(TagsContext);
  const assigned = (context?.overrides[candidateId] || tags).map(
    (tag) => context?.catalogById.get(Number(tag.id)) || tag,
  );
  const [expanded, setExpanded] = useState(false);
  if (!assigned.length && (!context?.canManage || !candidateId)) return null;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {(expanded ? assigned : assigned.slice(0, 2)).map((tag) => (
        <TagChip key={tag.id} tag={tag} locale={locale} />
      ))}
      {assigned.length > 2 ? (
        <button
          type="button"
          className="min-h-8 min-w-8 rounded-full bg-ink/5 px-2 text-xs tabular-nums text-ink-muted hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          aria-label={t(locale, expanded ? 'candidateTags.showLess' : 'candidateTags.showMore')}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '−' : `+${assigned.length - 2}`}
        </button>
      ) : null}
      {context?.canManage && candidateId ? (
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 rounded-control px-1.5 text-xs text-ink-muted transition-colors hover:bg-ink/5 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          onClick={() => context.edit(candidateId, name, assigned)}
          aria-label={`${t(locale, 'candidateTags.edit')} · ${name || ''}`}
          title={t(locale, 'candidateTags.edit')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 13 13 20a2 2 0 0 1-3 0l-7-7V3h10l7 7a2 2 0 0 1 0 3Z" />
            <circle cx="7.5" cy="7.5" r="1" />
          </svg>
          {!assigned.length ? t(locale, 'candidateTags.add') : null}
        </button>
      ) : null}
    </div>
  );
}

export function CandidateTagFilters({ value, onChange, locale = 'pt-BR' }) {
  const context = useContext(TagsContext);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const detailsRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onOutside = (event) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target))
        detailsRef.current.open = false;
    };
    const onKey = (event) => {
      if (event.key !== 'Escape' || !detailsRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      detailsRef.current.open = false;
      detailsRef.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!context) return null;
  const ids = value.tagIds || [];
  const filtered = context.catalog.filter((tag) =>
    tag.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)),
  );
  const selectedTags = ids.map((id) => context.catalogById.get(Number(id))).filter(Boolean);
  const remove = (id) =>
    onChange({ ...value, tagIds: ids.filter((selectedId) => selectedId !== id) });
  const clear = () => onChange({ ...value, tagIds: [], tagMode: 'any' });
  return (
    <div className="flex max-w-full flex-col gap-2">
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <details
          ref={detailsRef}
          className="relative"
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary
            className={cn(
              buttonClass,
              'flex list-none items-center gap-2 [&::-webkit-details-marker]:hidden',
              (ids.length > 0 || value.tagMode === 'none') &&
                'border-brand-500/30 bg-brand-500/[0.06] text-brand-600',
            )}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 13 13 20a2 2 0 0 1-3 0l-7-7V3h10l7 7a2 2 0 0 1 0 3Z" />
              <circle cx="7.5" cy="7.5" r="1" />
            </svg>
            {t(locale, 'candidateTags.title')}
            {ids.length ? (
              <span className="rounded-full bg-brand-500/10 px-1.5 text-xs tabular-nums">
                {ids.length}
              </span>
            ) : null}
            <span
              className={cn('text-xs transition-transform', open && 'rotate-180')}
              aria-hidden="true"
            >
              ⌄
            </span>
          </summary>
          <div className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-3rem)] rounded-card border border-ink/12 bg-surface p-3 shadow-dialog">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-muted">
                {t(locale, 'candidateTags.filterHint')}
              </span>
              {ids.length ? (
                <button
                  type="button"
                  className="min-h-8 rounded-control px-1 text-xs font-medium text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  onClick={clear}
                >
                  {t(locale, 'candidateTags.clear')}
                </button>
              ) : null}
            </div>
            <input
              className={inputClass}
              value={search}
              aria-label={t(locale, 'candidateTags.search')}
              placeholder={t(locale, 'candidateTags.search')}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
              {filtered.map((tag) => (
                <label
                  key={tag.id}
                  className={cn(
                    'flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 hover:bg-ink/[0.035]',
                    ids.includes(Number(tag.id)) && 'bg-brand-500/[0.06]',
                  )}
                >
                  <input
                    type="checkbox"
                    className={fieldCheckboxClass}
                    disabled={!ids.includes(Number(tag.id)) && ids.length >= MAX_CANDIDATE_TAGS}
                    checked={ids.includes(Number(tag.id))}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        tagMode: value.tagMode === 'none' ? 'any' : value.tagMode || 'any',
                        tagIds: event.target.checked
                          ? [...ids, Number(tag.id)]
                          : ids.filter((id) => id !== Number(tag.id)),
                      })
                    }
                  />
                  <TagChip tag={tag} locale={locale} />
                </label>
              ))}
              {context.loading ? (
                <p className="text-sm text-ink-muted">{t(locale, 'common.loading')}</p>
              ) : null}
              {!context.loading && !filtered.length && !context.loadError ? (
                <p className="py-2 text-sm leading-relaxed text-ink-muted">
                  {t(locale, search ? 'candidateTags.noMatch' : 'candidateTags.catalogEmpty')}
                </p>
              ) : null}
            </div>
          </div>
        </details>
        <SelectField
          aria-label={t(locale, 'candidateTags.filterMode')}
          className="min-w-[11rem] max-w-full text-sm"
          value={value.tagMode || 'any'}
          onChange={(event) =>
            onChange({
              ...value,
              tagMode: event.target.value,
              ...(event.target.value === 'none' ? { tagIds: [] } : {}),
            })
          }
        >
          <option value="any">{t(locale, 'candidateTags.any')}</option>
          <option value="all">{t(locale, 'candidateTags.all')}</option>
          <option value="none">{t(locale, 'candidateTags.none')}</option>
        </SelectField>
        {context.canManage ? (
          <button
            type="button"
            className="min-h-touch rounded-control px-2 text-sm text-ink-muted hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              context.manage();
            }}
          >
            {t(locale, 'candidateTags.manage')}
          </button>
        ) : null}
      </div>
      {selectedTags.length || value.tagMode === 'none' ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={t(locale, 'candidateTags.applied')}
        >
          {selectedTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} locale={locale}>
              <button
                type="button"
                className="-my-1 -mr-1 grid min-h-7 min-w-7 place-items-center rounded-full text-base font-normal hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                aria-label={t(locale, 'candidateTags.removeFilter', { name: tag.name })}
                onClick={() => remove(Number(tag.id))}
              >
                ×
              </button>
            </TagChip>
          ))}
          {value.tagMode === 'none' ? (
            <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink-muted">
              {t(locale, 'candidateTags.none')}
            </span>
          ) : null}
          <button
            type="button"
            className="min-h-8 rounded-control px-2 text-xs text-ink-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            onClick={clear}
          >
            {t(locale, 'candidateTags.clear')}
          </button>
        </div>
      ) : null}
      {context.loadError ? (
        <span role="alert" className="text-sm text-danger">
          {context.loadError}{' '}
          <button type="button" className="underline" onClick={context.reload}>
            {t(locale, 'candidateTags.retry')}
          </button>
        </span>
      ) : null}
    </div>
  );
}
