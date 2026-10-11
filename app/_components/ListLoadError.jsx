'use client';

import { InlineCallout } from './InlineCallout';
import { t } from '../../lib/i18n';

export function ListLoadError({ locale = 'pt-BR', message, onRetry }) {
  return (
    <InlineCallout tone="danger" role="alert" action={
      <button type="button" onClick={onRetry} className="underline underline-offset-2">
        {t(locale, 'common.retry')}
      </button>
    }>
      {message}
    </InlineCallout>
  );
}
