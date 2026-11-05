import { asDb } from '../ae/as-db.js';
import { runtimeAppUrl } from '../app-url.js';
import { renderEmailLayout, escapeEmailHtml } from '../email-layout.js';
import { isMailConfigured, sendTransactionalMail } from '../mail.js';
import { EMPLOYEE_NOTIF, notifyCandidate } from '../employee/employee-notifications.js';
import { getCompanyTimeSchedule, isoDayInTz } from './time-clock.js';
import { getTimeClosingReadiness } from './time-clock-readiness.js';
import { addDaysIso } from './time-day-summary.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';

const COMPANY_CAP = 200;

function formatDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function buildOpenDayMail({ name, day, appUrl }) {
  const subject = `30Grow: revise seu ponto de ${formatDay(day)}`;
  const text = `Olá, ${name}.\n\nIdentificamos uma jornada incompleta no seu ponto em ${formatDay(day)}. Acesse o sistema para conferir as marcações e solicitar um ajuste, se necessário.\n\n${appUrl || ''}\n\nMensagem automática do 30Grow.`;
  const ctaUrl = appUrl ? `${appUrl}/employee/time-clock` : '';
  const html = renderEmailLayout({
    subject,
    title: 'Confira seu ponto',
    subtitle: `Há um dia de jornada incompleta em ${formatDay(day)}.`,
    preheader: 'Acesse o 30Grow para conferir suas marcações de ponto.',
    text: `Olá, ${name}. Confira as marcações e solicite um ajuste se necessário.`,
    contentHtml: `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#243746;">Olá, ${escapeEmailHtml(name)}.</p><p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#243746;">Identificamos uma jornada incompleta no seu ponto em <strong>${escapeEmailHtml(formatDay(day))}</strong>. Acesse o sistema para conferir as marcações e solicitar um ajuste, se necessário.</p>`,
    ctaUrl,
    ctaLabel: 'Conferir meu ponto',
    locale: 'pt-BR',
  });
  return { subject, text, html };
}

/** Sends one reminder per employee and local workday; candidate_notifications provides durable dedupe. */
export async function runTimeClockOpenDayReminders(dbOrQuery, { sendEmail = true } = {}) {
  const db = asDb(dbOrQuery);
  const companies = await db.query(
    `SELECT id FROM companies WHERE deleted = FALSE ORDER BY id LIMIT $1`,
    [COMPANY_CAP],
  );
  const appUrl = String(runtimeAppUrl() || '').replace(/\/$/, '');
  let eligible = 0;
  let notified = 0;
  let emailed = 0;
  let errors = 0;

  for (const { id: companyId } of companies.rows || []) {
    const scheduleResult = await getCompanyTimeSchedule(db, { companyId });
    if (!scheduleResult.ok) continue;
    const schedule = scheduleResult.schedule;
    const today = isoDayInTz(new Date(), schedule.timezone);
    const day = addDaysIso(today, -1);
    const report = await getTimeClosingReadiness(db, {
      companyId, periodStart: day, periodEnd: day, schedule,
    });
    if (!report.ok || report.closed) continue;

    for (const person of report.items) {
      if (person.incompleteDays < 1 || !resolveTimeClockEligibility({
        workFormat: person.workFormat,
        override: person.timeClockOverride,
      }).enabled) continue;
      eligible += 1;
      const created = await notifyCandidate(db, {
        companyId,
        candidateId: person.candidateId,
        type: EMPLOYEE_NOTIF.TIME_CLOSING_REMINDER,
        entityType: 'time_clock_day',
        entityId: null,
        dedupeKey: `time_clock_open_day:${day}`,
        payload: { day, incompleteDays: person.incompleteDays },
      });
      if (!created.inserted) continue;
      notified += 1;
      if (!sendEmail || !isMailConfigured() || !person.email) continue;
      try {
        const mail = buildOpenDayMail({ name: person.fullName || 'colaborador(a)', day, appUrl });
        await sendTransactionalMail({ to: person.email, ...mail, locale: 'pt-BR' });
        emailed += 1;
      } catch (error) {
        errors += 1;
        if (error?.code === 'MAIL_NOT_CONFIGURED') break;
        console.error('[time-clock-open-day-reminders] mail failed', { companyId, candidateId: person.candidateId, code: error?.code });
      }
    }
  }
  return { companies: companies.rowCount || 0, eligible, notified, emailed, errors };
}
