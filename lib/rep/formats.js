import { createHash } from 'node:crypto';

export function latin1(value) {
  const text = String(value);
  if (
    [...text].some((c) => c.charCodeAt(0) > 255) ||
    /[\x00-\x1f\x7f]/.test(text)
  )
    throw new Error('REP_INVALID_TEXT');
  return text;
}
export function field(value, size, numeric = false) {
  const text = latin1(value ?? '');
  if (text.length > size || (numeric && !/^\d+$/.test(text)))
    throw new Error('REP_INVALID_FIELD');
  return numeric ? text.padStart(size, '0') : text.padEnd(size, ' ');
}
export function validDocument(value) {
  const s = String(value || '');
  if (!/^(\d{11}|[A-Z0-9]{12}\d{2})$/.test(s) || /^(\d)\1+$/.test(s))
    return false;
  if (s.length === 11) {
    for (let len = 9; len < 11; len++) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(s[i]) * (len + 1 - i);
      const digit = ((sum * 10) % 11) % 10;
      if (digit !== Number(s[len])) return false;
    }
    return true;
  }
  for (let len = 12; len < 14; len++) {
    let weight = len - 7,
      sum = 0;
    for (let i = 0; i < len; i++) {
      sum += (s.charCodeAt(i) - 48) * weight;
      if (--weight < 2) weight = 9;
    }
    const digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (digit !== Number(s[len])) return false;
  }
  return true;
}
export function crc16(text) {
  let crc = 0;
  for (const byte of Buffer.from(latin1(text), 'latin1')) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).padStart(4, '0');
}
export function stamp(value, timezone = 'America/Sao_Paulo') {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('REP_INVALID_DATE');
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const offset =
    p.timeZoneName === 'GMT'
      ? '+0000'
      : p.timeZoneName.replace('GMT', '').replace(':', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00${offset}`;
}
export const SIGNATURE_LINE = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(
  100,
  ' ',
);
export function verifyRecords(records) {
  let priorNsr = 0,
    priorHash = '';
  for (const r of records) {
    if (Number(r.nsr) !== priorNsr + 1) throw new Error('REP_NSR_GAP');
    const raw = r.record_text;
    if (
      raw.slice(0, 9) !== String(r.nsr).padStart(9, '0') ||
      Number(raw[9]) !== Number(r.record_type)
    )
      throw new Error('REP_RECORD_ID');
    if (Number(r.record_type) === 7) {
      const hash = createHash('sha256')
        .update(raw.slice(0, 73) + priorHash, 'latin1')
        .digest('hex');
      if (
        raw.length !== 137 ||
        raw.slice(73) !== hash ||
        r.record_hash !== hash ||
        r.previous_hash !== priorHash
      )
        throw new Error('REP_HASH_MISMATCH');
      priorHash = hash;
    } else {
      const expected = { 2: 331, 5: 118, 6: 36 }[Number(r.record_type)];
      if (!expected || raw.length !== expected)
        throw new Error('REP_RECORD_LENGTH');
      if (
        [2, 5].includes(Number(r.record_type)) &&
        raw.slice(-4) !== crc16(raw.slice(0, -4))
      )
        throw new Error('REP_CRC_MISMATCH');
      if (Number(r.record_type) === 6 && !['07', '08'].includes(raw.slice(-2)))
        throw new Error('REP_SERVICE_EVENT_INVALID');
    }
    priorNsr = Number(r.nsr);
  }
  return true;
}
function bounded(value, min, max, pattern = null) {
  const text = latin1(value ?? '');
  if (
    text.length < min ||
    text.length > max ||
    text.includes('|') ||
    (pattern && !pattern.test(text))
  )
    throw new Error('REP_INVALID_FIELD');
  return text;
}
function fiscalIdentity(establishment, developer) {
  if (
    !validDocument(establishment.employer_document) ||
    !validDocument(developer.document)
  )
    throw new Error('REP_INVALID_DOCUMENT');
  bounded(establishment.registration, 1, 17, /^\d+$/);
  bounded(
    establishment.complementary_document || '',
    0,
    14,
    /^(?:\d{12}|\d{14})?$/,
  );
  bounded(establishment.employer_name, 1, 150);
}
function isoDate(value) {
  const text = bounded(value, 10, 10, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
    throw new Error('REP_INVALID_DATE');
}
function validateAej({
  establishment,
  developer,
  workers,
  schedules,
  markings,
  absences,
  from,
  to,
}) {
  fiscalIdentity(establishment, developer);
  isoDate(from);
  isoDate(to);
  if (from > to) throw new Error('REP_INVALID_PERIOD');
  bounded(developer.name, 1, 150);
  bounded(developer.version, 1, 8);
  bounded(developer.legalName, 1, 150);
  bounded(developer.email, 1, 50, /^\S+@\S+\.\S+$/);
  const ids = new Set(),
    cpfs = new Set(),
    codes = new Set();
  const id = (value) => bounded(value, 1, 9, /^[1-9]\d*$/);
  for (const worker of workers) {
    const key = id(worker.id);
    if (ids.has(key)) throw new Error('REP_DUPLICATE_REFERENCE');
    if (cpfs.has(worker.cpf))
      throw new Error('REP_MULTIPLE_EMPLOYMENTS_UNSUPPORTED');
    if (!/^\d{11}$/.test(worker.cpf) || !validDocument(worker.cpf))
      throw new Error('REP_INVALID_DOCUMENT');
    ids.add(key);
    cpfs.add(worker.cpf);
    bounded(worker.worker_name, 1, 150);
  }
  for (const schedule of schedules) {
    const code = bounded(schedule.code, 1, 30);
    if (codes.has(code)) throw new Error('REP_DUPLICATE_REFERENCE');
    codes.add(code);
    bounded(schedule.minutes, 1, 12, /^[1-9]\d*$/);
    if (!Array.isArray(schedule.pairs) || !schedule.pairs.length)
      throw new Error('REP_INVALID_SCHEDULE');
    for (const pair of schedule.pairs) {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new Error('REP_INVALID_SCHEDULE');
      for (const time of pair)
        bounded(time, 4, 4, /^(?:[01]\d|2[0-3])[0-5]\d$/);
    }
  }
  const reference = (value) => {
    if (!ids.has(id(value))) throw new Error('REP_INVALID_REFERENCE');
  };
  for (const marking of markings) {
    reference(marking.workerId);
    if (!['in', 'out'].includes(marking.kind))
      throw new Error('REP_INVALID_MARKING');
    bounded(marking.pair, 1, 3, /^[1-9]\d*$/);
    const code = bounded(marking.scheduleCode || '', 0, 30);
    if (
      (code && !codes.has(code)) ||
      (!marking.disregarded &&
        marking.kind === 'in' &&
        Number(marking.pair) === 1 &&
        !code)
    )
      throw new Error('REP_INVALID_REFERENCE');
    bounded(
      marking.reason || '',
      marking.disregarded || !marking.original ? 1 : 0,
      150,
    );
  }
  for (const absence of absences) {
    reference(absence.workerId);
    isoDate(absence.day);
    if (
      absence.day < from ||
      absence.day > to ||
      ![1, 2, 3, 4].includes(Number(absence.type))
    )
      throw new Error('REP_INVALID_ABSENCE');
    if (Number(absence.type) === 3) {
      bounded(absence.minutes, 1, 12, /^[1-9]\d*$/);
      bounded(absence.movement, 1, 1, /^[12]$/);
    } else if (absence.minutes != null || absence.movement)
      throw new Error('REP_INVALID_ABSENCE');
  }
}

export function buildAfd({
  establishment: e,
  records,
  from,
  to,
  developer,
  generatedAt = new Date(),
}) {
  fiscalIdentity(e, developer);
  isoDate(from);
  isoDate(to);
  if (from > to) throw new Error('REP_INVALID_PERIOD');
  verifyRecords(records);
  const type = e.employer_document.length === 14 ? '1' : '2';
  let header =
    '0000000001' +
    type +
    field(e.employer_document, 14) +
    field(e.complementary_document || '', 14) +
    field(e.employer_name, 150) +
    field(e.registration, 17) +
    field(from, 10) +
    field(to, 10) +
    stamp(generatedAt, e.timezone) +
    '004' +
    (developer.document.length === 14 ? '1' : '2') +
    field(developer.document, 14) +
    field('', 30);
  header += crc16(header);
  const selected = records.filter((r) => {
    const day = r.record_text.slice(10, 20);
    return day >= from && day <= to;
  });
  for (const record of selected) {
    if (Number(record.record_type) === 2) {
      const responsible = record.record_text.slice(34, 48);
      const complementary = record.record_text.slice(63, 77);
      if (
        !/^\d{11} {3}$/.test(responsible) ||
        !/^(?: {14}|\d{12} {2}|\d{14})$/.test(complementary) ||
        /^0{14}$/.test(complementary)
      )
        throw new Error('REP_LEGACY_RECORD_FORMAT');
    }
  }
  const count = (t) =>
    selected.filter((r) => Number(r.record_type) === t).length;
  const trailer =
    '999999999' +
    [2, 3, 4, 5, 6, 7].map((t) => field(count(t), 9)).join('') +
    '9';
  return Buffer.from(
    [
      header,
      ...selected.map((r) => r.record_text),
      trailer,
      SIGNATURE_LINE,
    ].join('\r\n') + '\r\n',
    'latin1',
  );
}
export function buildAej({
  establishment: e,
  workers,
  schedules,
  markings,
  absences = [],
  from,
  to,
  developer,
  generatedAt = new Date(),
}) {
  validateAej({
    establishment: e,
    developer,
    workers,
    schedules,
    markings,
    absences,
    from,
    to,
  });
  const rows = [
    [
      '01',
      e.employer_document.length === 14 ? '1' : '2',
      e.employer_document,
      e.complementary_document.length === 14 ? e.complementary_document : '',
      e.complementary_document.length === 12 ? e.complementary_document : '',
      e.employer_name,
      from,
      to,
      stamp(generatedAt, e.timezone),
      '002',
    ],
    ['02', '1', '3', e.registration],
  ];
  for (const w of workers)
    rows.push(['03', String(w.id), w.cpf, w.worker_name]);
  for (const s of schedules)
    rows.push([
      '04',
      s.code,
      String(s.minutes),
      ...s.pairs.flat(),
      ...(s.pairs.length === 1 ? ['', ''] : []),
    ]);
  for (const m of markings)
    rows.push([
      '05',
      String(m.workerId),
      stamp(m.at, e.timezone),
      m.original ? '1' : '',
      m.disregarded ? 'D' : m.kind === 'in' ? 'E' : 'S',
      field(m.pair, 3, true),
      m.original ? 'O' : 'I',
      m.scheduleCode || '',
      m.reason || '',
    ]);
  for (const a of absences)
    rows.push([
      '07',
      String(a.workerId),
      String(a.type),
      a.day,
      a.minutes == null ? '' : String(a.minutes),
      a.movement || '',
    ]);
  rows.push([
    '08',
    developer.name,
    developer.version,
    developer.document.length === 14 ? '1' : '2',
    developer.document,
    developer.legalName,
    developer.email,
  ]);
  const counts = Array.from({ length: 8 }, (_, i) =>
    String(rows.filter((r) => r[0] === String(i + 1).padStart(2, '0')).length),
  );
  rows.push(['99', ...counts]);
  for (const row of rows)
    for (const v of row)
      if (latin1(v).includes('|')) throw new Error('REP_INVALID_TEXT');
  return Buffer.from(
    rows
      .map((r) => r.join('|'))
      .concat(SIGNATURE_LINE)
      .join('\r\n') + '\r\n',
    'latin1',
  );
}
