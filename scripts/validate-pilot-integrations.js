#!/usr/bin/env node

import process from 'node:process';
import { companyLogoObjectKey } from '../lib/company/company-logo.js';
import {
  companyScopedObjectKey,
  deleteObjectBestEffort,
  getObjectStorageConfig,
  putObject,
} from '../lib/s3-object-storage.js';
import {
  isMailConfigured,
  sendTransactionalMail,
  verifySmtpConnection,
} from '../lib/mail.js';

const args = new Set(process.argv.slice(2));
const writeStorage = args.has('--write-storage');
const sendEmail = args.has('--send-email');
const companyId = Number(process.env.PILOT_PREFLIGHT_COMPANY_ID || 1);
const recipient = String(process.env.PILOT_SMOKE_EMAIL || '').trim();

function line(status, name, detail = '') {
  process.stdout.write(`${status} ${name}${detail ? `: ${detail}` : ''}\n`);
}

async function validateStorage() {
  const cfg = getObjectStorageConfig();
  if (!cfg.configured) throw new Error('S3_NOT_CONFIGURED');
  line('OK', 'S3 config', `${cfg.bucket} · ${cfg.region}`);
  if (!writeStorage) {
    line('SKIP', 'S3 write/delete', 'use --write-storage in homologation');
    return;
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const probes = [
    { name: 'company logo', key: companyLogoObjectKey(companyId, 'txt') },
    {
      name: 'LMS PDF',
      key: companyScopedObjectKey(companyId, 'lms', 'courses', '0', `pilot-probe-${stamp}.pdf`),
    },
    {
      name: 'DP document',
      key: companyScopedObjectKey(companyId, 'dp-docs', '0', 'pilot-probe', `pilot-probe-${stamp}.pdf`),
    },
  ];
  const created = [];
  try {
    for (const probe of probes) {
      await putObject({
        key: probe.key,
        body: Buffer.from('30Grow pilot storage probe\n'),
        contentType: 'application/octet-stream',
      });
      created.push(probe);
      line('OK', `S3 ${probe.name}`, 'put');
    }
  } finally {
    for (const probe of created.reverse()) {
      const removed = await deleteObjectBestEffort(probe.key);
      if (!removed.ok) throw new Error(`S3_DELETE_FAILED:${probe.name}`);
      line('OK', `S3 ${probe.name}`, 'delete');
    }
  }
}

async function validateMail() {
  if (!isMailConfigured()) throw new Error('SMTP_NOT_CONFIGURED');
  const result = await verifySmtpConnection(8_000);
  if (!result.ok) throw new Error(`SMTP_VERIFY_FAILED:${result.error || 'unknown'}`);
  line('OK', 'SMTP verify', `${result.latencyMs}ms${result.mocked ? ' · mock' : ''}`);

  if (!sendEmail) {
    line('SKIP', 'SMTP delivery', 'use --send-email with PILOT_SMOKE_EMAIL');
    return;
  }
  if (!recipient) throw new Error('PILOT_SMOKE_EMAIL_REQUIRED');
  const sent = await sendTransactionalMail({
    to: recipient,
    subject: '30Grow: teste de homologação',
    text: `Preflight de e-mail concluído em ${new Date().toISOString()}.`,
  });
  line('OK', 'SMTP delivery', sent.mocked ? 'mock' : recipient);
}

let failed = false;
for (const [name, fn] of [
  ['storage', validateStorage],
  ['mail', validateMail],
]) {
  try {
    await fn();
  } catch (error) {
    failed = true;
    line('FAIL', name, error?.message || String(error));
  }
}

if (failed) process.exitCode = 1;
else line('DONE', 'pilot integrations');
