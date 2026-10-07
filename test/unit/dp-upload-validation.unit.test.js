import test from 'node:test';
import assert from 'node:assert/strict';
import { dpUploadValidationKey, dpUploadResponseKey, DP_DOC_MAX_BYTES } from '../../lib/dp-upload-validation.js';

test('DP preflight accepts PDF, JPG, JPEG and existing PNG support', () => {
  for (const [name, type] of [['test.pdf', 'application/pdf'], ['test.JPG', 'image/jpeg'], ['test.jpeg', 'image/jpeg'], ['test.png', 'image/png'], ['test.jpeg', '']]) {
    assert.equal(dpUploadValidationKey({ name, type, size: 100 }), null);
    assert.equal(dpUploadValidationKey({ name, type, size: DP_DOC_MAX_BYTES }), null);
  }
});
test('DP preflight rejects empty, oversized and unsupported files before sending', () => {
  for (const size of [0, -1, NaN, DP_DOC_MAX_BYTES + 1]) assert.equal(dpUploadValidationKey({ name: 'test.pdf', type: 'application/pdf', size }), 'fileSizeError');
  for (const [name,type] of [['script.exe','application/pdf'],['test.pdf','text/html'],['test.webp','image/webp']]) assert.equal(dpUploadValidationKey({ name,type,size:100 }), 'fileTypeError');
});
test('DP API errors are described as documents, not CVs, with session guidance', () => {
  assert.equal(dpUploadResponseKey(401), 'fileSessionError');
  assert.equal(dpUploadResponseKey(400, 'DP_FILE_TYPE'), 'fileTypeError');
  assert.equal(dpUploadResponseKey(400, 'DP_FILE_SIZE'), 'fileSizeError');
  assert.equal(dpUploadResponseKey(400, 'INVALID_CV_FILE_TYPE'), 'fileTypeError');
  assert.equal(dpUploadResponseKey(413), 'fileSizeError');
  assert.equal(dpUploadResponseKey(400, 'INVALID_CV_FILE_SIZE'), 'fileSizeError');
  assert.equal(dpUploadResponseKey(403, 'FORBIDDEN'), null);
});
