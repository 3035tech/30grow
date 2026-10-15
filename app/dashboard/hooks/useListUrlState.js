'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseListValue, LIST_URL_PREFIX } from '../../../lib/list-url-state.js';

/** Native history integration preserves scroll and avoids a server navigation per keystroke. */
export function useListUrlState(namespace, field, fallback) {
  const params = useSearchParams();
  const key = `${LIST_URL_PREFIX}${namespace}.${field}`;
  const raw = params.get(key);
  const defaultJson = JSON.stringify(fallback);
  const value = useMemo(
    () => parseListValue(raw, JSON.parse(defaultJson), field),
    [raw, defaultJson, field],
  );
  const setValue = useCallback(
    (next) => {
      const url = new URL(window.location.href);
      const defaultValue = JSON.parse(defaultJson);
      const current = parseListValue(url.searchParams.get(key), defaultValue, field);
      const resolved = typeof next === 'function' ? next(current) : next;
      const encoded = JSON.stringify(resolved);
      if (encoded === defaultJson) url.searchParams.delete(key);
      else url.searchParams.set(key, encoded);
      if (url.href !== window.location.href) window.history.replaceState(null, '', url);
    },
    [key, field, defaultJson],
  );
  return [value, setValue];
}

/** Keep editable search text aligned with back/forward without persisting unfinished input. */
export function useListSearchDraft(query) {
  const [state, setState] = useState({ query, value: query });
  if (state.query !== query) setState({ query, value: query });
  return [state.query === query ? state.value : query, (value) => setState({ query, value })];
}
