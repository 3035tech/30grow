/**
 * Unit proof — AdminRecordViewDrawer section filtering (empty fields, emptyText, full width).
 */
import assert from 'node:assert/strict';
import { RECORD_FIELD_KIND, visibleRecordSections } from '../../lib/record-view.js';

function main() {
  const out = visibleRecordSections([
    {
      key: 'a',
      fields: [
        { key: 'slug', label: 'Slug', value: 'acme' },
        { key: 'blank', label: 'Blank', value: '   ' },
        { key: 'nil', label: 'Nil', value: null },
        null,
        false,
        { key: 'zero', label: 'Zero', value: 0 },
        { key: 'link', label: 'Link', value: 'https://x.test', kind: RECORD_FIELD_KIND.LINK },
        { key: 'fallback', label: 'Notes', value: '', kind: RECORD_FIELD_KIND.HTML, emptyText: 'No notes' },
      ],
    },
    { key: 'empty', title: 'Gone', fields: [{ key: 'x', label: 'X', value: '' }] },
    { key: 'custom', title: 'Kept', content: 'node' },
    null,
  ]);

  assert.deepEqual(out.map((s) => s.key), ['a', 'custom']);
  const fields = out[0].fields;
  assert.deepEqual(fields.map((f) => f.key), ['slug', 'zero', 'link', 'fallback']);
  assert.equal(fields[0].full, false);
  assert.equal(fields[2].full, true, 'link spans both columns');
  assert.equal(fields[3].value, 'No notes');
  assert.equal(fields[3].kind, RECORD_FIELD_KIND.TEXT, 'emptyText never renders as HTML');
  assert.equal(fields[3].muted, true);
  assert.deepEqual(out[1].fields, []);

  assert.deepEqual(visibleRecordSections(), []);

  console.log('record-view.unit.test.js OK');
}

main();
