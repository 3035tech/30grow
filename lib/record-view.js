export const RECORD_FIELD_KIND = Object.freeze({
  TEXT: 'text',
  LONG_TEXT: 'longText',
  HTML: 'html',
  LINK: 'link',
});

const FULL_WIDTH_KINDS = new Set([RECORD_FIELD_KIND.HTML, RECORD_FIELD_KIND.LONG_TEXT, RECORD_FIELD_KIND.LINK]);

function isEmptyValue(value) {
  return value == null || value === false || (typeof value === 'string' && !value.trim());
}

/**
 * Drops empty fields (or swaps in `emptyText`, rendered muted) and sections left with nothing to show.
 * @param {Array<{ key: string, title?: string, fields?: Array<object|null|false>, content?: unknown }>} sections
 */
export function visibleRecordSections(sections = []) {
  return sections
    .filter(Boolean)
    .map((section) => {
      const fields = [];
      for (const field of section.fields || []) {
        if (!field) continue;
        if (!isEmptyValue(field.value)) {
          fields.push({ ...field, full: Boolean(field.full || FULL_WIDTH_KINDS.has(field.kind)) });
        } else if (field.emptyText) {
          fields.push({ ...field, value: field.emptyText, kind: RECORD_FIELD_KIND.TEXT, muted: true, full: Boolean(field.full) });
        }
      }
      return { ...section, fields };
    })
    .filter((section) => section.fields.length || section.content);
}
