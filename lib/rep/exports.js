import { buildAfd, buildAej, validDocument, latin1 } from './formats.js';
import { getEmployeeTimeMirror } from '../people/time-clock-manager.js';
import { verifyRecords } from './formats.js';

export function developerConfig() {
  const d = {
    document: process.env.REP_DEVELOPER_DOCUMENT || '',
    name: '30Grow',
    version: '1.0',
    legalName: process.env.REP_DEVELOPER_NAME || '',
    email: process.env.REP_DEVELOPER_EMAIL || '',
  };
  if (
    !validDocument(d.document) ||
    !d.legalName ||
    d.legalName.length > 150 ||
    !/^\S+@\S+\.\S+$/.test(d.email) ||
    d.email.length > 50
  )
    throw new Error('REP_DEVELOPER_NOT_CONFIGURED');
  latin1(d.legalName);
  return d;
}
export function validPeriod(from, to) {
  const date = (s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s || '') &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  return (
    date(from) &&
    date(to) &&
    from <= to &&
    (Date.parse(to) - Date.parse(from)) / 86400000 <= 61
  );
}
/** Contractual wall-clock minutes; round reduced urban duration once per contract. */
export function fiscalSchedule(schedule) {
  const hm = (value) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || ''))
      throw new Error('REP_INVALID_SCHEDULE');
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };
  const start = hm(schedule.workdayStart),
    end = hm(schedule.workdayEnd);
  if (start === end) throw new Error('REP_INVALID_SCHEDULE');
  let times = [[schedule.workdayStart, schedule.workdayEnd]];
  if (schedule.breakMinutes > 0) {
    if (!schedule.breakStart || !schedule.breakEnd)
      throw new Error('REP_CONTRACT_BREAK_REQUIRED');
    times = [
      [schedule.workdayStart, schedule.breakStart],
      [schedule.breakEnd, schedule.workdayEnd],
    ];
  }
  const span = (end - start + 1440) % 1440;
  let physical = 0,
    night = 0,
    previousEnd = start;
  for (const [a, b] of times) {
    const begin = start + ((hm(a) - start + 1440) % 1440);
    const finish = begin + ((hm(b) - hm(a) + 1440) % 1440);
    if (finish <= begin || begin < previousEnd || finish > start + span)
      throw new Error('REP_INVALID_SCHEDULE');
    physical += finish - begin;
    for (const [low, high] of [
      [0, 300],
      [1320, 1740],
      [2760, 3180],
    ])
      night += Math.max(0, Math.min(finish, high) - Math.max(begin, low));
    previousEnd = finish;
  }
  // A night rule must be explicit; do not certify physical minutes as reduced hours.
  if (night && schedule.nightRule !== 'urban_clt')
    throw new Error('REP_NIGHT_RULE_REQUIRED');
  const minutes = Math.round(
    physical + (schedule.nightRule === 'urban_clt' ? night / 7 : 0),
  );
  return {
    pairs: times.map((pair) => pair.map((value) => value.replace(':', ''))),
    minutes,
  };
}

export async function fiscalExport(
  db,
  {
    companyId,
    establishmentId,
    from,
    to,
    format,
    developer = developerConfig(),
  },
) {
  if (!validPeriod(from, to) || !['afd', 'aej'].includes(format))
    throw new Error('REP_INVALID_PERIOD');
  const er = await db.query(
    'SELECT * FROM rep_establishments WHERE id=$1 AND company_id=$2',
    [establishmentId, companyId],
  );
  const e = er.rows[0];
  if (!e) return null;
  const records = (
    await db.query(
      'SELECT * FROM rep_original_records WHERE establishment_id=$1 ORDER BY nsr',
      [e.id],
    )
  ).rows;
  verifyRecords(records);
  const missing = await db.query(
    `SELECT count(*) AS n FROM employee_time_punches p LEFT JOIN rep_original_records r ON r.punch_id=p.id WHERE p.company_id=$1 AND p.source<>'manager' AND (p.punched_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date AND r.nsr IS NULL`,
    [companyId, from, to, e.timezone],
  );
  if (Number(missing.rows[0].n))
    throw new Error('REP_LEGACY_OR_UNREGISTERED_PUNCHES');
  if (format === 'afd')
    return buildAfd({ establishment: e, records, from, to, developer });
  const workers = (
    await db.query(
      'SELECT * FROM rep_workers WHERE establishment_id=$1 ORDER BY id',
      [e.id],
    )
  ).rows;
  if (workers.length > 200) throw new Error('REP_EXPORT_TOO_LARGE');
  const schedules = [],
    markings = [],
    absences = [];
  const exportWorkers = workers.map((worker, i) => ({ ...worker, id: i + 1 }));
  const codes = new Map();
  const refs = new Map(
    records
      .filter((r) => Number(r.record_type) === 7)
      .map((r) => [String(r.punch_id), r]),
  );
  for (const [index, w] of workers.entries()) {
    const workerId = index + 1;
    const mirror = await getEmployeeTimeMirror(db, {
      companyId,
      candidateId: w.candidate_id,
      from,
      to,
      includeFormer: true,
      includeFiscal: true,
    });
    if (
      !mirror.ok ||
      mirror.truncated ||
      mirror.from !== from ||
      mirror.to !== to
    )
      throw new Error('REP_INCOMPLETE_MIRROR');
    for (const day of mirror.days) {
      if (
        day.historyReview ||
        day.requiresScheduleReview ||
        !day.fiscal ||
        day.fiscal.bankAnchorDeltaMinutes ||
        day.bankPendingCount ||
        day.requests?.some((request) => request.status === 'pending')
      )
        throw new Error('REP_HISTORY_REVIEW_REQUIRED');
      if (
        !day.fiscal.employed &&
        !day.punches.length &&
        day.fiscal.bankDeltaMinutes === 0
      )
        continue;
      const s = day.daySchedule;
      const { pairs, minutes } = fiscalSchedule(s);
      const key = JSON.stringify([pairs, s.nightRule || 'none', minutes]);
      let code = codes.get(key);
      if (!code) {
        code = String(codes.size + 1);
        codes.set(key, code);
        schedules.push({ code, pairs, minutes });
      }
      const active = day.punches.filter((p) => !p.voidedAt);
      if (active.some((p, i) => p.punchKind !== (i % 2 === 0 ? 'in' : 'out')))
        throw new Error('REP_REVIEW_REQUIRED');
      let pair = 0;
      for (const p of day.punches) {
        if (!p.voidedAt && p.punchKind === 'in') pair++;
        const original = p.source !== 'manager';
        if (original && !refs.has(String(p.id)))
          throw new Error('REP_ORIGINAL_MISSING');
        markings.push({
          workerId,
          at: p.punchedAt,
          kind: p.punchKind,
          pair: Math.max(1, pair),
          original,
          disregarded: Boolean(p.voidedAt),
          scheduleCode:
            !p.voidedAt && p.punchKind === 'in' && pair === 1 ? code : '',
          reason: String(
            (p.voidedAt ? p.voidReason : !original ? p.notes : '') || '',
          ).slice(0, 150),
        });
      }
      const employed = day.fiscal.employed && day.fiscal.enabled;
      if (employed && day.occurrence === 'absence')
        absences.push({ workerId, type: 2, day: day.day });
      // Weekly rest is explicitly declared in the fiscal registry, never inferred
      // from a Sunday or a missing punch. Cyclic rest needs a separate fiscal rule.
      if (employed && s.shiftPattern === '12x36')
        throw new Error('REP_DSR_REVIEW_REQUIRED');
      if (
        employed &&
        new Date(day.day + 'T12:00:00Z').getUTCDay() === w.weekly_rest_day &&
        day.fiscal.weekdays?.includes(w.weekly_rest_day)
      )
        throw new Error('REP_DSR_REVIEW_REQUIRED');
      if (
        employed &&
        day.occurrence === 'rest' &&
        !day.holiday &&
        new Date(day.day + 'T12:00:00Z').getUTCDay() === w.weekly_rest_day
      ) {
        if (
          !Array.isArray(day.fiscal.weekdays) ||
          day.fiscal.weekdays.includes(w.weekly_rest_day)
        )
          throw new Error('REP_DSR_REVIEW_REQUIRED');
        absences.push({ workerId, type: 1, day: day.day });
      }
      const delta = day.fiscal.bankDeltaMinutes;
      if (!Number.isSafeInteger(delta)) throw new Error('REP_INCOMPLETE_BANK');
      if (delta)
        absences.push({
          workerId,
          type: 3,
          day: day.day,
          minutes: Math.abs(delta),
          movement: delta > 0 ? '1' : '2',
        });
    }
  }
  return buildAej({
    establishment: e,
    workers: exportWorkers,
    schedules,
    markings,
    absences,
    from,
    to,
    developer,
  });
}
