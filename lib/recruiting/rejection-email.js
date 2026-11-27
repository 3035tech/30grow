import { queryRead } from '../db.js';
import { htmlToPlainText, sanitizeInterviewNotesHtml } from '../sanitize-html.js';
import { sendTransactionalMail } from '../mail.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** Sends a candidate rejection message with company-scoped HR addresses in BCC. */
export async function sendCandidateRejectionEmail({ companyId, vacancyId, candidateId, subject, body, locale }) {
  const content = sanitizeInterviewNotesHtml(body);
  const cleanSubject = String(subject || '').trim();
  if (!cleanSubject || cleanSubject.length > 180 || !htmlToPlainText(content).trim()) {
    throw new Error('INVALID_REJECTION_EMAIL');
  }
  const target = await queryRead(
    `SELECT c.email, c.full_name AS "candidateName", v.title AS "vacancyTitle", co.name AS "companyName"
     FROM candidates c JOIN vacancies v ON v.id = $2 AND v.company_id = $1
     JOIN companies co ON co.id = v.company_id AND co.deleted = FALSE
     WHERE c.id = $3 AND c.company_id = $1 AND v.deleted = FALSE
       AND (EXISTS (SELECT 1 FROM vacancy_candidates vc WHERE vc.vacancy_id=v.id AND vc.candidate_id=c.id AND vc.company_id=$1)
         OR EXISTS (SELECT 1 FROM assessments a WHERE a.vacancy_id=v.id AND a.candidate_id=c.id AND a.company_id=$1))
     LIMIT 1`, [companyId, vacancyId, candidateId]
  );
  if (!target.rowCount || !target.rows[0].email) throw new Error('REJECTION_EMAIL_CANDIDATE_UNAVAILABLE');
  const hr = await queryRead(
    `SELECT DISTINCT LOWER(TRIM(email)) AS email FROM users
     WHERE company_id=$1 AND deleted=FALSE AND active=TRUE
       AND role IN ('hr','direction','admin') AND email IS NOT NULL AND TRIM(email)<>''
     ORDER BY email LIMIT 100`, [companyId]
  );
  const bcc = hr.rows.map((row) => row.email).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!bcc.length) throw new Error('REJECTION_EMAIL_RH_UNAVAILABLE');
  const values = {
    candidateName: escapeHtml(target.rows[0].candidateName),
    vacancyTitle: escapeHtml(target.rows[0].vacancyTitle),
    companyName: escapeHtml(target.rows[0].companyName),
  };
  const personalized = content.replace(/\{(candidateName|vacancyTitle|companyName)\}/g, (_, key) => values[key]);
  const personalizedSubject = cleanSubject.replace(/\{(candidateName|vacancyTitle|companyName)\}/g, (_, key) => target.rows[0][key]);
  await sendTransactionalMail({ to: target.rows[0].email, bcc, subject: personalizedSubject, html: personalized, locale });
  return { sent: true };
}
