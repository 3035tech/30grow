import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndQueueMotivatorsInvite } from '../../lib/ae/create-motivators-invite.js';
import { ERR } from '../../lib/api-error-codes.js';

test('manual Motivators invite stops when a collaborator has the same name under another email', async () => {
  const statements = [];
  const result = await createAndQueueMotivatorsInvite(async (sql) => {
    statements.push(sql);
    if (sql.includes('SELECT id, email FROM candidates')) return { rows: [], rowCount: 0 };
    if (sql.includes("employment_status = 'employee'")) return { rows: [{ id: 129 }], rowCount: 1 };
    throw new Error('Invite creation must stop before reading the company or sending mail');
  }, {
    companyId: 3,
    candidateName: 'Guilherme Caruso',
    candidateEmail: 'guilherme.caruso@3035tech.com',
    appBaseUrl: 'https://example.test',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, ERR.POSSIBLE_DUPLICATE_PERSON);
  assert.equal(result.status, 409);
  assert.equal(statements.length, 2);
});

test('manual invite also stops when the supplied email belongs to an older candidate record', async () => {
  const statements = [];
  const result = await createAndQueueMotivatorsInvite(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('SELECT id, email FROM candidates')) {
      return { rows: [{ id: 143, email: 'guilherme.caruso@3035tech.com' }], rowCount: 1 };
    }
    if (sql.includes("employment_status = 'employee'")) {
      return { rows: [{ id: 129 }], rowCount: 1 };
    }
    throw new Error('An older candidate record must not receive another invite silently');
  }, {
    companyId: 3,
    candidateName: 'Guilherme Caruso',
    candidateEmail: 'guilherme.caruso@3035tech.com',
    appBaseUrl: 'https://example.test',
  });

  assert.equal(result.errorCode, ERR.POSSIBLE_DUPLICATE_PERSON);
  assert.deepEqual(statements[1].params, [3, 'Guilherme Caruso', 143]);
});

test('the employee own email is not flagged as a duplicate', async () => {
  const statements = [];
  const result = await createAndQueueMotivatorsInvite(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('SELECT id, email FROM candidates')) {
      return { rows: [{ id: 129, email: 'guilherme.caruso@3035tech.com' }], rowCount: 1 };
    }
    if (sql.includes("employment_status = 'employee'")) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM companies')) return { rows: [], rowCount: 0 };
    throw new Error('The own-record check should continue to company validation');
  }, {
    companyId: 3,
    candidateName: 'Guilherme Caruso',
    candidateEmail: 'guilherme.caruso@3035tech.com',
    appBaseUrl: 'https://example.test',
  });

  assert.equal(result.errorCode, ERR.COMPANY_NOT_FOUND_OR_INACTIVE);
  assert.deepEqual(statements[1].params, [3, 'Guilherme Caruso', 129]);
});

test('a confirmed same-name person can continue through the manual invite flow', async () => {
  const statements = [];
  const result = await createAndQueueMotivatorsInvite(async (sql) => {
    statements.push(sql);
    if (sql.includes('SELECT id, email FROM candidates')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM companies')) return { rows: [], rowCount: 0 };
    throw new Error('Confirmation must only skip the same-name check');
  }, {
    companyId: 3,
    candidateName: 'Guilherme Caruso',
    candidateEmail: 'guilherme.caruso@3035tech.com',
    confirmedDifferentPerson: true,
    appBaseUrl: 'https://example.test',
  });

  assert.equal(result.errorCode, ERR.COMPANY_NOT_FOUND_OR_INACTIVE);
  assert.equal(statements.length, 2);
  assert.ok(statements[1].includes('FROM companies'));
});
