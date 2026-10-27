import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { profilePdf } from '../fixtures/profile-pdf.js';
import { prepareCandidateImportFile } from '../../lib/recruiting/candidate-import-file.js';

test('CV reader accepts PDF and UTF-8 text by content', async () => {
  const pdf = await prepareCandidateImportFile(profilePdf(['Synthetic candidate', 'person@example.test', 'Professional experience since 2020.']));
  assert.equal(pdf.extension, 'pdf');
  assert.ok(pdf.text.includes('person@example.test'));
  const txt = await prepareCandidateImportFile(Buffer.from('Synthetic candidate\nperson@example.test\nProfessional experience since 2020.'));
  assert.equal(txt.extension, 'txt');
  assert.ok(txt.content.includes('person@example.test'));
});

test('CV reader extracts DOCX paragraphs without accepting arbitrary ZIP or macros', async () => {
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Synthetic candidate</w:t></w:r></w:p><w:p><w:r><w:t>person@example.test</w:t></w:r></w:p></w:document>'),
  });
  const parsed = await prepareCandidateImportFile(Buffer.from(docx));
  assert.equal(parsed.extension, 'docx');
  assert.ok(parsed.text.includes('Synthetic candidate\nperson@example.test'));
  await assert.rejects(prepareCandidateImportFile(Buffer.from(zipSync({ 'other.txt': strToU8('not a CV') }))), { code: 'INVALID_CV_FILE_TYPE' });
  const macro = zipSync({ ...{
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<w:p><w:t>Person</w:t></w:p>'),
  }, 'word/vbaProject.bin': strToU8('macro') });
  await assert.rejects(prepareCandidateImportFile(Buffer.from(macro)), { code: 'INVALID_CV_FILE_TYPE' });
});

test('CV reader sends PNG image to vision and rejects unsupported bytes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lRcAAAAASUVORK5CYII=', 'base64');
  const parsed = await prepareCandidateImportFile(png);
  assert.equal(parsed.extension, 'png');
  assert.equal(parsed.content[1].type, 'image_url');
  await assert.rejects(prepareCandidateImportFile(Buffer.from([0, 1, 2, 3])), { code: 'INVALID_CV_FILE_TYPE' });
});
