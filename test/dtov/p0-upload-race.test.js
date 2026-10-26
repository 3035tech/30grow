// Real DTOV SQL + real domain; only storage is simulated. All SQL rolls back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import pg from 'pg';
import * as status from '../../lib/domain-status.js';
import * as magic from '../../lib/file-magic.js';
import * as upload from '../../lib/assessment/dp-upload-validation.js';
import { ERR } from '../../lib/api-error-codes.js';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
try {
  await db.query('BEGIN');
  const companyId = (await db.query("INSERT INTO companies(name,slug) VALUES('P0 race',$1) RETURNING id", [`p0-race-${crypto.randomUUID()}`])).rows[0].id;
  const candidateId = (await db.query("INSERT INTO candidates(company_id,full_name,employment_status) VALUES($1,'P0 race','employee') RETURNING id", [companyId])).rows[0].id;
  let duringUpload = async () => {}, newKey;
  const removed = [];
  const deps = {
    ...status, ...magic, ...upload, ERR, default: crypto, asDb: value => value,
    DP_ADDRESS_NUMBER_MAX_LENGTH: 20, isObjectStorageConfigured: () => true,
    companyScopedObjectKey: (id, suffix) => `companies/${id}/${suffix}`,
    putObject: async ({ key }) => { newKey = key; await duringUpload(); return { url: `https://storage.invalid/${key}` }; },
    deleteObjectBestEffort: async key => removed.push(key), getObjectBytes: async () => {},
    leaveInclusiveDays: () => 1, expandLeaveCalendarByDay: () => [], sanitizeRichTextHtml: value => value,
    stripCep: value => value, stripCpf: value => value, stripPhone: value => value,
  };
  const context = vm.createContext({ Buffer, console });
  const module = new vm.SourceTextModule(await readFile('lib/people/employee-dp.js', 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  await module.namespace.ensureDpDocuments(db, { companyId, candidateId });
  const original = `companies/${companyId}/original.pdf`;
  const select = () => db.query("SELECT file_key,signature_status,signer_name FROM employee_dp_documents WHERE candidate_id=$1 AND doc_key='address_proof'", [candidateId]);
  for (const scenario of ['signed', 'replaced', 'success']) {
    removed.length = 0;
    await db.query("UPDATE employee_dp_documents SET file_key=$1,signature_status='requested',signer_name='' WHERE candidate_id=$2 AND doc_key='address_proof'", [original, candidateId]);
    duringUpload = async () => {
      if (scenario === 'signed') await db.query("UPDATE employee_dp_documents SET signature_status='signed',signer_name='Concurrent signer' WHERE candidate_id=$1 AND doc_key='address_proof'", [candidateId]);
      if (scenario === 'replaced') await db.query("UPDATE employee_dp_documents SET file_key=$1 WHERE candidate_id=$2 AND doc_key='address_proof'", [`companies/${companyId}/winner.pdf`, candidateId]);
    };
    const buffer = Buffer.from('%PDF-1.4\n%%EOF');
    const result = await module.namespace.uploadDpDocumentFile(db, { companyId, candidateId, docKey: 'address_proof', file: { buffer, size: buffer.length, mimeType: 'application/pdf', originalName: 'test.pdf' } });
    const row = (await select()).rows[0];
    if (scenario === 'signed') {
      assert.equal(result.errorCode, ERR.DP_SIGNATURE_LOCKED);
      assert.equal(row.signature_status, 'signed'); assert.equal(row.signer_name, 'Concurrent signer'); assert.equal(row.file_key, original);
    } else if (scenario === 'replaced') {
      assert.equal(result.ok, false); assert.equal(row.file_key, `companies/${companyId}/winner.pdf`);
    } else {
      assert.equal(result.ok, true); assert.equal(row.file_key, newKey); assert.equal(row.signature_status, 'none');
    }
    assert.deepEqual(removed, [scenario === 'success' ? original : newKey]);
    console.log(`PASS ${scenario}: file association and cleanup preserved`);
  }
} finally { await db.query('ROLLBACK'); await db.end(); }
