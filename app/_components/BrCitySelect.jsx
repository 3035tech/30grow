'use client';

import { SelectField } from './SelectField';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';
import { BR_UF_SET } from '../../lib/recruiting/candidate-profile';
import { cn } from '../../lib/cn';
import { fieldInputClass, fieldSelectClass } from './form-control-styles';

const LIST_MAX_H = 220;

function foldCity(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Select / autocomplete de município IBGE, filtrado pela UF. */
export function BrCitySelect({
  uf = '',
  value = '',
  onChange,
  locale = 'pt-BR',
  style,
  className,
  id,
  'aria-label': ariaLabel,
  /** `select` = lista nativa; `autocomplete` = digitar + sugestões IBGE */
  mode = 'select',
}) {
  const ufCode = String(uf || '').trim().toUpperCase();
  const hasUf = BR_UF_SET.has(ufCode);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState(String(value || ''));
  const listId = useId();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [listPos, setListPos] = useState(null);
  const autocomplete = mode === 'autocomplete';

  useEffect(() => {
    setQuery(String(value || ''));
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (!hasUf) {
      setCities([]);
      setLoading(false);
      setLoadErr(false);
      setOpen(false);
      return undefined;
    }

    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadErr(false);

    (async () => {
      try {
        const res = await fetch(`/api/public/br-cities?uf=${encodeURIComponent(ufCode)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'fail');
        if (!cancelled) setCities(Array.isArray(data.cities) ? data.cities : []);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        if (!cancelled) {
          setCities([]);
          setLoadErr(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [ufCode, hasUf]);

  useEffect(() => {
    if (!autocomplete) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [autocomplete]);

  const cityValue = String(value || '').trim();
  const inList = cities.includes(cityValue);
  const showLegacy = Boolean(cityValue && !loading && cities.length > 0 && !inList);

  let placeholder = autocomplete
    ? t(locale, 'recruiting.citySearchPlaceholder')
    : t(locale, 'recruiting.cityPh');
  if (!hasUf) placeholder = t(locale, 'recruiting.citySelectUfFirst');
  else if (loading) placeholder = t(locale, 'recruiting.cityLoading');

  const suggestions = useMemo(() => {
    if (!autocomplete || !hasUf || loading || loadErr) return [];
    const q = foldCity(query);
    const list = !q ? cities : cities
      .map((name, index) => ({ name, index, folded: foldCity(name) }))
      .filter((city) => city.folded.includes(q))
      .sort((a, b) => {
        const rank = (city) => city.folded === q ? 0 : city.folded.startsWith(q) ? 1 : 2;
        return rank(a) - rank(b) || a.index - b.index;
      })
      .map((city) => city.name);
    return list.slice(0, 12);
  }, [autocomplete, hasUf, loading, loadErr, query, cities]);

  const showList = autocomplete && open && hasUf && !loading && !loadErr;

  const selectSuggestion = (name) => {
    setQuery(name);
    onChange?.(name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onAutocompleteKeyDown = (event) => {
    if (event.key === 'ArrowDown' && showList && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => index < 0 ? 0 : Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp' && showList && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1);
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        selectSuggestion(suggestions[activeIndex]);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const placeList = useCallback(() => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const above = below < LIST_MAX_H + 8 && r.top > below;
    setListPos({
      left: r.left,
      width: r.width,
      top: above ? undefined : r.bottom + 4,
      bottom: above ? window.innerHeight - r.top + 4 : undefined,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showList) return undefined;
    placeList();
    window.addEventListener('scroll', placeList, true);
    window.addEventListener('resize', placeList);
    return () => {
      window.removeEventListener('scroll', placeList, true);
      window.removeEventListener('resize', placeList);
    };
  }, [showList, placeList]);

  if (autocomplete) {
    return (
      <div ref={wrapRef} className={cn('relative w-full', className)}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-label={ariaLabel || t(locale, 'recruiting.cityPh')}
          autoComplete="off"
          disabled={!hasUf || loading}
          value={!hasUf ? '' : query}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(true);
            setActiveIndex(-1);
            onChange?.(next);
          }}
          onKeyDown={onAutocompleteKeyDown}
          onFocus={() => {
            if (hasUf && !loading) {
              setOpen(true);
              setActiveIndex(-1);
            }
          }}
          className={cn(
            fieldInputClass,
            'w-full',
            !hasUf || loading ? 'cursor-default' : 'cursor-text',
            !hasUf && 'opacity-65'
          )}
          style={style}
        />
        {loading && hasUf ? (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-2xs opacity-70"
          >
            …
          </span>
        ) : null}
        {showList && listPos && typeof document !== 'undefined' ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="fixed z-[10090] m-0 max-h-[220px] list-none overflow-y-auto rounded-control border border-ink/16 bg-white py-1.5 shadow-menu"
            style={listPos}
          >
            {suggestions.length ? suggestions.map((name, index) => (
              <li
                key={name}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={name === cityValue}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(name)}
                  className={cn(
                    'block w-full cursor-pointer border-none px-3 py-2 text-left font-inherit text-prose text-inherit',
                    index === activeIndex || name === cityValue ? 'bg-ink/[0.06]' : 'bg-transparent'
                  )}
                >
                  {name}
                </button>
              </li>
            )) : (
              <li role="option" aria-disabled="true" className="px-3 py-2 font-ui text-prose text-ink-muted">
                {t(locale, 'recruiting.cityNoResults')}
              </li>
            )}
          </ul>,
          document.body
        ) : null}
      </div>
    );
  }

  if (loadErr) {
    return (
      <input
        id={id}
        type="text"
        autoComplete="address-level2"
        value={String(value || '')}
        placeholder={t(locale, 'recruiting.cityPh')}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel || t(locale, 'recruiting.cityPh')}
        className={cn(fieldInputClass, 'w-full', className)}
        style={style}
      />
    );
  }

  return (
    <SelectField
      id={id}
      className={cn(
        fieldSelectClass,
        className,
        !hasUf && 'opacity-65',
        !hasUf || loading ? 'cursor-default' : 'cursor-pointer'
      )}
      value={showLegacy || inList ? cityValue : ''}
      disabled={!hasUf || loading}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label={ariaLabel || t(locale, 'recruiting.cityPh')}
      style={style}
    >
      <option value="">{placeholder}</option>
      {showLegacy ? <option value={cityValue}>{cityValue}</option> : null}
      {cities.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </SelectField>
  );
}
