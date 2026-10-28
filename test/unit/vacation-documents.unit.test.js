import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as status from '../../lib/domain-status.js';
import * as magic from '../../lib/file-magic.js';
import * as uploadValidation from '../../lib/assessment/dp-upload-validation.js';
import * as auditChanges from '../../lib/audit-changes.js';
import { ERR } from '../../lib/api-error-codes.js';
import { normalizeDependentRelation, normalizeEmergencyRelation } from '../../lib/kinship-relation.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

async function fixture() {
  const documents = new Map();
  const storage = new Map();
  const deleted = [];
  const db = {
    async query(sql, values) {
      if (sql.includes('FROM employee_leave_requests WHERE id')) {
        return { rows: Number(values[0]) === 7 && Number(values[1]) === 1
          ? [{ id: 7, candidateId: 42, leaveType: 'vacation', status: 'approved' }] : [], rowCount: Number(values[0]) === 7 && Number(values[1]) === 1 ? 1 : 0 };
      }
      if (sql.includes('SELECT file_key') && sql.includes('FROM employee_vacation_documents')) {
        const item = documents.get(values.at(-1));
        return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO employee_vacation_documents')) {
        documents.set(values[3], { fileKey: values[4], fileName: values[5] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM employee_vacation_documents')) {
        const item = documents.get(values[3]);
        documents.delete(values[3]);
        return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const dependencies = {
    ...status, ...magic, ...uploadValidation, ...auditChanges, ERR,
    default: crypto, asDb: value => value, DB_FANOUT_CONCURRENCY: 4,
    DP_ADDRESS_NUMBER_MAX_LENGTH: 20,
    companyScopedObjectKey: (companyId, suffix) => `companies/${companyId}/${suffix}`,
    isObjectStorageConfigured: () => true,
    putObject: async ({ key, body }) => { storage.set(key, body); return { url: `private://${key}` }; },
    getObjectBytes: async key => ({ body: storage.get(key), contentType: 'application/pdf' }),
    deleteObjectBestEffort: async key => { deleted.push(key); storage.delete(key); },
    leaveInclusiveDays: () => 1, expandLeaveCalendarByDay: () => [],
    sanitizeRichTextHtml: value => value,
    stripCep: value => value, stripCpf: value => value, stripPhone: value => value,
    normalizeDependentRelation, normalizeEmergencyRelation,
  };
  const context = vm.createContext({ Buffer, console });
  const module = new vm.SourceTextModule(await readFile(new URL('../../lib/people/employee-dp.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(dependencies), function () {
    for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  return { domain: module.namespace, db, documents, storage, deleted };
}

test('notice and receipt belong to the same vacation, remain private and can be replaced independently', async () => {
  const f = await fixture();
  const input = { id: 7, companyId: 1, userId: 5, file: { buffer: pdf, size: pdf.length, mimeType: 'application/pdf', originalName: 'notice.pdf' } };
  assert.equal((await f.domain.uploadVacationDocument(f.db, { ...input, documentType: 'notice' })).ok, true);
  assert.equal((await f.domain.uploadVacationDocument(f.db, { ...input, documentType: 'receipt', file: { ...input.file, originalName: 'receipt.pdf' } })).ok, true);
  assert.equal(f.documents.size, 2);
  const notice = await f.domain.downloadVacationDocument(f.db, { id: 7, companyId: 1, documentType: 'notice' });
  assert.equal(notice.fileName, 'notice.pdf');
  assert.deepEqual(notice.body, pdf);
  assert.equal((await f.domain.downloadVacationDocument(f.db, { id: 7, companyId: 2, documentType: 'notice' })).errorCode, ERR.NOT_FOUND);
  assert.equal((await f.domain.uploadVacationDocument(f.db, { ...input, documentType: '../receipt' })).errorCode, ERR.INVALID_DATA);
  await f.domain.uploadVacationDocument(f.db, { ...input, documentType: 'notice', file: { ...input.file, originalName: 'notice-new.pdf' } });
  assert.equal(f.deleted.length, 1);
  assert.equal(f.documents.get('receipt').fileName, 'receipt.pdf');
  assert.equal((await f.domain.clearVacationDocument(f.db, { id: 7, companyId: 1, documentType: 'notice' })).ok, true);
  assert.equal(f.documents.has('notice'), false);
  assert.equal(f.documents.has('receipt'), true);
});
