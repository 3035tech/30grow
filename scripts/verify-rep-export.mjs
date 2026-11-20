#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const signatureLine = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(100, ' ');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultCaFile = path.join(root, 'lib/rep/icp-brasil-roots.pem');

function usage() {
  console.log(`Usage:
  node scripts/verify-rep-export.mjs --format afd|aej --input FILE --signature FILE [--ca FILE] [--openssl PATH]

Validates an extracted AFD/AEJ text file and its detached DER .p7s signature.
Defaults to the ICP-Brasil roots bundled with this repository.`);
}

function argumentsMap(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '--help' || key === '-h') return new Map([['help', true]]);
    if (!key.startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error(`Invalid argument: ${key}`);
    values.set(key.slice(2), args[++i]);
  }
  return values;
}

function fail(message) {
  throw new Error(message);
}

function linesFrom(buffer) {
  if (buffer.length < 4 || buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    fail('The file is empty or has a UTF-8 BOM.');
  const text = buffer.toString('latin1');
  if (!text.endsWith('\r\n')) fail('The file must end with CRLF.');
  const body = text.slice(0, -2);
  if (body.includes('\n') || body.includes('\r'))
    fail('The file contains a line ending other than CRLF.');
  const lines = body.split('\r\n');
  if (lines.some((line) => !line.length)) fail('The file contains a blank line.');
  return lines;
}

// CRC-16/KERMIT (CRC-16/CCITT-TRUE), independently implemented per MTE AFD layout.
function crc16Kermit(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).padStart(4, '0');
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):00([+-])(\d{2})(\d{2})$/.exec(value || '');
  if (!match || !validIsoDate(match[1])) return false;
  const offsetHour = Number(match[5]);
  const offsetMinute = Number(match[6]);
  return offsetHour < 14 && offsetMinute <= 59 || offsetHour === 14 && offsetMinute === 0;
}

function verifyAfd(lines) {
  if (lines.length < 3) fail('AFD must contain header, trailer, and signature records.');
  if (lines.at(-1) !== signatureLine) fail('AFD signature marker does not match the MTE literal.');
  const records = lines.slice(0, -1);
  const header = records[0];
  if (header.length !== 302 || header.slice(0, 10) !== '0000000001')
    fail('AFD header must be type 1 with exactly 302 characters.');
  if (header.slice(250, 253) !== '004') fail('Unsupported AFD layout version; expected 004.');
  if (header.slice(-4) !== crc16Kermit(Buffer.from(header.slice(0, -4), 'latin1')))
    fail('AFD header CRC-16/KERMIT is invalid.');

  const lengths = { 2: 331, 3: 50, 4: 73, 5: 118, 6: 36, 7: 137, 9: 64 };
  const counts = new Map([[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0]]);
  let priorNsr = 0;
  let priorHash = '';
  for (const [index, record] of records.slice(1, -1).entries()) {
    const lineNo = index + 2;
    const type = Number(record[9]);
    if (![2, 3, 4, 5, 6, 7].includes(type)) fail(`AFD line ${lineNo}: unsupported record type.`);
    if (record.length !== lengths[type]) fail(`AFD line ${lineNo}: type ${type} has invalid length.`);
    const nsr = Number(record.slice(0, 9));
    if (!Number.isSafeInteger(nsr) || nsr !== priorNsr + 1)
      fail(`AFD line ${lineNo}: NSR is not sequential.`);
    priorNsr = nsr;
    if (type <= 5 && record.slice(-4) !== crc16Kermit(Buffer.from(record.slice(0, -4), 'latin1')))
      fail(`AFD line ${lineNo}: CRC-16/KERMIT is invalid.`);
    if (type === 5 && !['I', 'A', 'E'].includes(record[34]))
      fail(`AFD line ${lineNo}: invalid worker operation.`);
    if (type === 6 && !['02', '07', '08'].includes(record.slice(34, 36)))
      fail(`AFD line ${lineNo}: unsupported REP-P service event.`);
    if (type === 7) {
      if (!['01', '02', '03', '04', '05'].includes(record.slice(70, 72)) || !['0', '1'].includes(record[72]))
        fail(`AFD line ${lineNo}: invalid collector or online status.`);
      const hash = createHash('sha256').update(record.slice(0, 73) + priorHash, 'latin1').digest('hex');
      if (record.slice(73) !== hash) fail(`AFD line ${lineNo}: SHA-256 chain is invalid.`);
      priorHash = hash;
    }
    counts.set(type, counts.get(type) + 1);
  }

  const trailer = records.at(-1);
  if (trailer.length !== 64 || trailer.slice(0, 9) !== '999999999' || trailer[63] !== '9')
    fail('AFD trailer is malformed.');
  for (const [index, type] of [2, 3, 4, 5, 6, 7].entries()) {
    const field = trailer.slice(9 + index * 9, 18 + index * 9).trim();
    if (!/^\d+$/.test(field) || Number(field) !== counts.get(type))
      fail(`AFD trailer count for record ${type} does not match.`);
  }
  if (crc16Kermit(Buffer.from('123456789', 'ascii')) !== '2189')
    fail('Internal CRC-16/KERMIT reference check failed.');
  return { format: 'AFD', version: '004', records: records.length, counts: Object.fromEntries(counts) };
}

const aejFieldCounts = { '01': [10, 10], '02': [4, 4], '03': [4, 4], '05': [9, 9], '06': [3, 3], '07': [6, 6], '08': [7, 7], '99': [9, 9] };
function verifyAej(lines) {
  if (lines.length < 4) fail('AEJ must contain header, PTRP, trailer, and signature records.');
  if (lines.at(-1) !== signatureLine) fail('AEJ signature marker does not match the MTE literal.');
  const rows = lines.slice(0, -1).map((line, index) => {
    const fields = line.split('|');
    const type = fields[0];
    if (!/^(?:01|02|03|04|05|06|07|08|99)$/.test(type))
      fail(`AEJ line ${index + 1}: unknown record type.`);
    const expected = aejFieldCounts[type];
    if (expected && (fields.length < expected[0] || fields.length > expected[1]))
      fail(`AEJ line ${index + 1}: type ${type} has invalid field count.`);
    if (type === '04' && (fields.length < 7 || (fields.length - 3) % 2 !== 0))
      fail(`AEJ line ${index + 1}: type 04 must have complete time pairs.`);
    if (fields.some((field) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(field)))
      fail(`AEJ line ${index + 1}: control characters are not allowed.`);
    return { type, fields, line: index + 1 };
  });
  const count = (type) => rows.filter((row) => row.type === type).length;
  if (count('01') !== 1 || rows[0]?.type !== '01') fail('AEJ must start with exactly one type 01 header.');
  if (count('08') !== 1 || rows.at(-2)?.type !== '08') fail('AEJ must end with one PTRP record immediately before its trailer.');
  if (rows[0].fields[9] !== '002') fail('Unsupported AEJ layout version; expected 002.');
  if (!validIsoDate(rows[0].fields[6]) || !validIsoDate(rows[0].fields[7]) || !validDateTime(rows[0].fields[8]))
    fail('AEJ header contains an invalid date or timestamp.');
  if (rows[0].fields[6] > rows[0].fields[7]) fail('AEJ period is inverted.');
  const order = new Map(['01', '02', '03', '04', '05', '06', '07', '08', '99'].map((type, index) => [type, index]));
  for (let index = 1; index < rows.length; index += 1)
    if (order.get(rows[index].type) < order.get(rows[index - 1].type))
      fail(`AEJ line ${rows[index].line}: records are out of type order.`);
  const trailer = rows.at(-1);
  if (trailer.type !== '99') fail('AEJ trailer is missing.');
  for (let type = 1; type <= 8; type += 1) {
    const declared = trailer.fields[type];
    if (!/^\d+$/.test(declared || '') || Number(declared) !== count(String(type).padStart(2, '0')))
      fail(`AEJ trailer count for record ${String(type).padStart(2, '0')} does not match.`);
  }
  const workers = new Set(rows.filter((row) => row.type === '03').map((row) => row.fields[1]));
  const reps = new Set(rows.filter((row) => row.type === '02').map((row) => row.fields[1]));
  const schedules = new Set(rows.filter((row) => row.type === '04').map((row) => row.fields[1]));
  for (const row of rows) {
    const [, workerId, dateTime, repId, kind, pair, source, scheduleCode, reason] = row.fields;
    if (row.type === '03' && (!/^\d{1,9}$/.test(workerId) || !/^\d{11}$/.test(row.fields[2])))
      fail(`AEJ line ${row.line}: invalid worker identifier or CPF.`);
    if (row.type === '02' && (!/^\d{1,9}$/.test(row.fields[1]) || !['1', '2', '3'].includes(row.fields[2]) || !/^\d{1,17}$/.test(row.fields[3])))
      fail(`AEJ line ${row.line}: invalid REP identifier, type, or INPI number.`);
    if (row.type === '04') {
      if (!/^\d{1,30}$/.test(row.fields[1]) || !/^\d{1,12}$/.test(row.fields[2]))
        fail(`AEJ line ${row.line}: invalid schedule code or duration.`);
      if (row.fields.slice(3).some((time) => time && !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)))
        fail(`AEJ line ${row.line}: invalid contractual time.`);
    }
    if (row.type === '05') {
      if (!workers.has(workerId) || !/^\d{1,9}$/.test(workerId)) fail(`AEJ line ${row.line}: unknown worker reference.`);
      if (!validDateTime(dateTime))
        fail(`AEJ line ${row.line}: invalid timestamp.`);
      if (repId && !reps.has(repId)) fail(`AEJ line ${row.line}: unknown REP reference.`);
      if (!['E', 'S', 'D'].includes(kind) || !/^\d{3}$/.test(pair)) fail(`AEJ line ${row.line}: invalid marking type or pair sequence.`);
      if (!['O', 'I', 'P', 'X', 'T', ''].includes(source)) fail(`AEJ line ${row.line}: invalid marking source.`);
      if (kind === 'D' && !reason) fail(`AEJ line ${row.line}: discarded marking requires a reason.`);
      if (source === 'I' && !reason) fail(`AEJ line ${row.line}: included marking requires a reason.`);
      if (kind === 'E' && pair === '001' && (!scheduleCode || !schedules.has(scheduleCode)))
        fail(`AEJ line ${row.line}: first entry requires a known schedule reference.`);
    }
    if (row.type === '06' && !workers.has(row.fields[1])) fail(`AEJ line ${row.line}: unknown worker reference.`);
    if (row.type === '07') {
      if (!workers.has(row.fields[1]) || !['1', '2', '3', '4'].includes(row.fields[2]) || !validIsoDate(row.fields[3]))
        fail(`AEJ line ${row.line}: invalid worker reference, date, or absence/bank code.`);
      if (row.fields[2] === '3' && (!/^\d{1,12}$/.test(row.fields[4]) || !['1', '2'].includes(row.fields[5])))
        fail(`AEJ line ${row.line}: bank movement requires minutes and movement type.`);
      if (row.fields[2] !== '3' && (row.fields[4] || row.fields[5]))
        fail(`AEJ line ${row.line}: non-bank absence cannot have bank fields.`);
    }
  }
  return {
    format: 'AEJ',
    version: '002',
    records: rows.length,
    counts: Object.fromEntries(Array.from({ length: 9 }, (_, i) => {
      const type = String(i + 1).padStart(2, '0');
      return [type, count(type)];
    })),
  };
}

async function verifySignature(input, signature, caFile, openssl) {
  await execFileAsync(openssl, [
    'cms', '-verify', '-binary', '-cades', '-inform', 'DER',
    '-in', signature, '-content', input, '-CAfile', caFile,
    '-no-CApath', '-no-CAstore', '-purpose', 'any',
    '-out', process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
}

try {
  const args = argumentsMap(process.argv.slice(2));
  if (args.has('help')) {
    usage();
    process.exit(0);
  }
  const format = args.get('format');
  const input = args.get('input');
  const signature = args.get('signature');
  const caFile = args.get('ca') || defaultCaFile;
  const openssl = args.get('openssl') || process.env.REP_OPENSSL_PATH || 'openssl';
  if (!['afd', 'aej'].includes(format) || !input || !signature) {
    usage();
    process.exitCode = 2;
  } else {
    const buffer = await readFile(input);
    const summary = format === 'afd' ? verifyAfd(linesFrom(buffer)) : verifyAej(linesFrom(buffer));
    await verifySignature(input, signature, caFile, openssl);
    console.log(JSON.stringify({ ok: true, ...summary, signature: 'valid', caFile }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
