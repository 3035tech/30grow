'use client';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer, dialogBtnGhostClass, dialogBtnPrimaryClass } from './AdminRichFormDrawer';
import { ContentEnter } from './AppLoading';
import { CopyableLink } from './CopyableLink';
import { RichTextView } from './RichTextView';
import { RECORD_FIELD_KIND, visibleRecordSections } from '../../lib/record-view';

export { RECORD_FIELD_KIND };

function FieldValue({ field, locale }) {
  if (field.kind === RECORD_FIELD_KIND.HTML) return <RichTextView html={field.value} />;
  if (field.kind === RECORD_FIELD_KIND.LINK) {
    return (
      <CopyableLink
        url={field.value}
        locale={locale}
        compact
        copyLabel={`${t(locale, 'panel.common.copyLink')}: ${field.label}`}
        openLabel={`${t(locale, 'panel.common.openLink')}: ${field.label}`}
      />
    );
  }
  return (
    <span className={cn(field.kind === RECORD_FIELD_KIND.LONG_TEXT && 'whitespace-pre-wrap')}>
      {field.value}
    </span>
  );
}

/**
 * Read-only record view for admin lists (the eye action). Sections of label-above-value fields;
 * empty fields are skipped unless they carry `emptyText`. `onEdit` adds the primary Edit CTA;
 * `secondaryActions` (e.g. a destructive ghost button) render before Close.
 *
 * sections: [{ key, title?, fields?: [{ key, label, value, kind?, full?, emptyText? }], content? }]
 */
export function AdminRecordViewDrawer({
  open,
  title,
  locale = 'pt-BR',
  onClose,
  onEdit = null,
  editLabel = null,
  headerMeta = null,
  secondaryActions = null,
  sections = [],
  maxWidth = '640px',
}) {
  const visible = visibleRecordSections(sections);

  return (
    <AdminRichFormDrawer
      open={open}
      title={title}
      locale={locale}
      onClose={onClose}
      maxWidth={maxWidth}
      headerMeta={headerMeta}
      footer={
        <>
          {secondaryActions ? <div className="mr-auto flex flex-wrap gap-2.5">{secondaryActions}</div> : null}
          <button type="button" className={dialogBtnGhostClass} onClick={onClose}>
            {t(locale, 'panel.common.close')}
          </button>
          {onEdit ? (
            <button
              type="button"
              className={dialogBtnPrimaryClass}
              onClick={() => {
                onClose?.();
                onEdit();
              }}
            >
              {editLabel || t(locale, 'panel.common.edit')}
            </button>
          ) : null}
        </>
      }
    >
      <ContentEnter animKey={`record-view|${title}`} className="flex flex-col">
        {visible.map((section, index) => (
          <section
            key={section.key}
            aria-label={section.title || undefined}
            className={cn(index > 0 && 'mt-5 border-t border-line pt-5')}
          >
            {section.title ? <h3 className="mb-3 mt-0 font-ui text-sm font-semibold text-ink">{section.title}</h3> : null}
            {section.fields.length ? (
              <dl className="m-0 grid items-start gap-x-6 gap-y-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <div
                    key={field.key}
                    className={cn('min-w-0', field.full && 'sm:col-span-2')}
                  >
                    <dt className={S.muted}>{field.label}</dt>
                    <dd className={cn('m-0 mt-1 break-words text-sm text-ink', field.muted && 'text-ink-muted')}>
                      <FieldValue field={field} locale={locale} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {section.content || null}
          </section>
        ))}
      </ContentEnter>
    </AdminRichFormDrawer>
  );
}
