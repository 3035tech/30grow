import { z } from 'zod';
const zPositiveInt = z.coerce.number().int().positive();
import { validDocument, latin1 } from './formats.js';
const text = (n) =>
  z
    .string()
    .trim()
    .min(1)
    .max(n)
    .refine((v) => {
      try {
        return !/[|\r\n]/.test(latin1(v));
      } catch {
        return false;
      }
    });
const cpf = z
  .string()
  .regex(/^\d{11}$/)
  .refine(validDocument);
export const repRegistrySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('establishment'),
    companyId: zPositiveInt.optional(),
    employerDocument: z.string().refine(validDocument),
    employerName: text(150),
    complementaryDocument: z
      .string()
      .regex(/^([0-9]{12}|[0-9]{14})?$/)
      .default(''),
    workplace: text(100),
    registration: z.string().regex(/^\d{1,17}$/),
    timezone: z
      .string()
      .max(64)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    responsibleCpf: cpf,
  }),
  z.object({
    action: z.literal('worker'),
    companyId: zPositiveInt.optional(),
    establishmentId: zPositiveInt,
    candidateId: zPositiveInt,
    cpf,
    workerName: text(52),
    weeklyRestDay: z.coerce.number().int().min(0).max(6).default(0),
    responsibleCpf: cpf,
  }),
]);

export async function saveRepRegistry(db, companyId, b) {
  if (b.action === 'establishment') {
    const r = await db.query(
      `INSERT INTO rep_establishments(company_id,employer_document,employer_name,workplace,registration,timezone,responsible_cpf,complementary_document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(employer_document) DO UPDATE SET employer_name=EXCLUDED.employer_name,workplace=EXCLUDED.workplace,responsible_cpf=EXCLUDED.responsible_cpf,complementary_document=EXCLUDED.complementary_document,registration=EXCLUDED.registration
 WHERE rep_establishments.company_id=EXCLUDED.company_id AND (rep_establishments.registration=EXCLUDED.registration OR (length(rep_establishments.registration)=17 AND length(EXCLUDED.registration)<17 AND rep_establishments.registration=lpad(EXCLUDED.registration,17,'0'))) AND rep_establishments.timezone=EXCLUDED.timezone RETURNING id`,
      [
        companyId,
        b.employerDocument,
        b.employerName,
        b.workplace,
        b.registration,
        b.timezone,
        b.responsibleCpf,
        b.complementaryDocument,
      ],
    );
    return r.rows[0]?.id || null;
  }
  const r = await db.query(
    `INSERT INTO rep_workers(company_id,establishment_id,candidate_id,cpf,worker_name,responsible_cpf,weekly_rest_day)
 SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM rep_establishments WHERE id=$2 AND company_id=$1) AND EXISTS(SELECT 1 FROM candidates WHERE id=$3 AND company_id=$1)
 ON CONFLICT(company_id,candidate_id) DO UPDATE SET worker_name=EXCLUDED.worker_name,responsible_cpf=EXCLUDED.responsible_cpf
 WHERE rep_workers.establishment_id=EXCLUDED.establishment_id AND rep_workers.cpf=EXCLUDED.cpf AND rep_workers.weekly_rest_day=EXCLUDED.weekly_rest_day RETURNING id`,
    [
      companyId,
      b.establishmentId,
      b.candidateId,
      b.cpf,
      b.workerName,
      b.responsibleCpf,
      b.weeklyRestDay,
    ],
  );
  return r.rows[0]?.id || null;
}
