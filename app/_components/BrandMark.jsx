'use client';


import { cn } from '../../lib/cn';
import brandTokens from '../../lib/marketing/brand-tokens.cjs';

const { LOGO_PATHS } = brandTokens;

/**
 * 30grow vector identity: the 3 follows currentColor (navy on light, white on navy);
 * zero, arrow and "grow" use the Grow green.
 * Pass `href` or `onClick` to make the mark a home / nav control.
 * @param {{
 *   size?: number,
 *   withWordmark?: boolean,
 *   wordmark?: string,
 *   style?: object,
 *   className?: string,
 *   href?: string,
 *   onClick?: Function,
 *   title?: string,
 *   'aria-label'?: string,
 * }} props
 */
export function BrandMark({
  size = 32,
  withWordmark = false,
  wordmark = '30grow',
  style,
  className,
  href,
  onClick,
  title,
  'aria-label': ariaLabel,
}) {
  const vbWidth = withWordmark ? 368 : 140;
  const vbHeight = withWordmark ? 114 : 110;
  const height = (size * vbHeight) / 110;
  const inner = (
    <svg viewBox={`0 0 ${vbWidth} ${vbHeight}`} width={(height * vbWidth) / vbHeight} height={height} className="block shrink-0" aria-hidden="true">
      <path fill="currentColor" d={LOGO_PATHS.three} />
      <path fill="var(--grow-primary)" d={LOGO_PATHS.zero} />
      {withWordmark
        ? LOGO_PATHS.grow.map((d) => <path key={d.slice(0, 12)} fill="var(--grow-primary)" fillRule="evenodd" d={d} />)
        : null}
    </svg>
  );
  const layoutClass = cn('brand-mark inline-flex items-center', className);
  const layoutStyle = { gap: 0, ...style };

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel || wordmark}
        className={cn(layoutClass, 'cursor-pointer text-inherit no-underline')}
        style={layoutStyle}
      >
        {inner}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel || wordmark}
        className={cn(layoutClass, 'm-0 cursor-pointer border-none bg-transparent p-0 font-inherit text-inherit')}
        style={layoutStyle}
      >
        {inner}
      </button>
    );
  }

  return (
    <span role="img" aria-label={ariaLabel || wordmark} className={layoutClass} style={layoutStyle}>
      {inner}
    </span>
  );
}
