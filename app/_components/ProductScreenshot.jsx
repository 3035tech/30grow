import Image from 'next/image';
import { screenshotLabels } from '../../lib/product-screenshots';

/** Keep the original capture available without a modal or additional client state. */
export function ProductScreenshot({ image, title, locale, eager = false, sizes = '(max-width: 767px) calc(100vw - 40px), 960px' }) {
  if (!image) return null;
  const labels = screenshotLabels(locale);
  return <figure className="m-0 min-w-0">
    <a href={image.src} target="_blank" rel="noopener noreferrer" aria-label={`${labels.enlarge}: ${title}`} className="block overflow-hidden rounded-card border border-ink/10 bg-white shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
      <Image src={image.src} width={image.width} height={image.height} alt={`${title}. ${labels.note}`} sizes={sizes} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} className="block h-auto w-full" />
    </a>
    <figcaption className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs leading-5 text-ink-muted"><span>{title}. {labels.note}</span><a href={image.src} target="_blank" rel="noopener noreferrer" className="shrink-0 font-semibold text-brand-700 underline underline-offset-4">{labels.enlarge}</a></figcaption>
  </figure>;
}
