'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';

/** One keyboard/touch scroll contract for wide comparisons and boards. */
export function HorizontalScrollRegion({
  children,
  locale = 'pt-BR',
  ariaLabel,
  className = '',
  table = false,
}) {
  const ref = useRef(null);
  const hintId = useId();
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = {
        left: node.scrollLeft > 2,
        right: node.scrollWidth - node.clientWidth - node.scrollLeft > 2,
      };
      setEdges((previous) =>
        previous.left === next.left && previous.right === next.right ? previous : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, []);
  const scroll = (direction) =>
    ref.current?.scrollBy({
      left: direction * Math.max(240, ref.current.clientWidth * 0.7),
      behavior: 'instant',
    });
  return (
    <div className="min-w-0 max-w-full">
      {edges.left || edges.right ? (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span id={hintId}>{t(locale, 'panel.common.horizontalScrollHint')}</span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => scroll(-1)}
              disabled={!edges.left}
              aria-label={t(locale, 'panel.common.scrollLeft')}
              className="min-h-touch min-w-touch rounded-control border border-ink/10 px-3 disabled:opacity-35"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => scroll(1)}
              disabled={!edges.right}
              aria-label={t(locale, 'panel.common.scrollRight')}
              className="min-h-touch min-w-touch rounded-control border border-ink/10 px-3 disabled:opacity-35"
            >
              →
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={ref}
        role="region"
        tabIndex={0}
        aria-label={ariaLabel || t(locale, 'panel.common.dataTable')}
        aria-describedby={edges.left || edges.right ? hintId : undefined}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
          )
            return;
          event.preventDefault();
          if (event.key === 'Home' || event.key === 'End')
            event.currentTarget.scrollLeft =
              event.key === 'Home' ? 0 : event.currentTarget.scrollWidth;
          else scroll(event.key === 'ArrowLeft' ? -1 : 1);
        }}
        className={cn(
          'max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35',
          table && 'ui-data-table rounded-card border border-ink/10',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
