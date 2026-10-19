import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { RepPdfSigner, withSigningCertificate } from './signing.js';

export async function receiptRecord(
  db,
  { companyId, candidateId, nsr, establishmentId },
) {
  const r = await db.query(
    `SELECT r.*,e.employer_document,e.complementary_document,e.registration,e.timezone,
 (SELECT substr(h.record_text,78,150) FROM rep_original_records h WHERE h.establishment_id=r.establishment_id AND h.record_type=2 AND h.nsr<=r.nsr ORDER BY h.nsr DESC LIMIT 1) employer_name,
 (SELECT substr(h.record_text,48,52) FROM rep_original_records h WHERE h.establishment_id=r.establishment_id AND h.record_type=5 AND substr(h.record_text,37,11)=w.cpf AND h.nsr<=r.nsr ORDER BY h.nsr DESC LIMIT 1) worker_name,
 w.cpf FROM rep_original_records r JOIN rep_establishments e ON e.id=r.establishment_id JOIN rep_workers w ON w.id=r.worker_id
 WHERE e.company_id=$1 AND w.candidate_id=$2 AND r.nsr=$3 AND r.establishment_id=$4 AND r.record_type=7`,
    [companyId, candidateId, nsr, establishmentId],
  );
  return r.rows[0] || null;
}
export async function createReceiptPdf(record, signer) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'Comprovante de Registro de Ponto do Trabalhador',
    `Empregador: ${record.employer_name.trim()}`,
    `CNPJ/CPF: ${record.employer_document}`,
    ...(record.complementary_document
      ? [`CNO/CAEPF: ${record.complementary_document}`]
      : []),
    `Trabalhador: ${record.worker_name.trim()}`,
    `CPF: ${record.cpf}`,
    `Data/hora da marcacao: ${record.record_text.slice(10, 34)}`,
    `NSR: ${record.nsr}`,
    `REP-P - Registro INPI: ${record.registration}`,
    `Hash: ${record.record_hash.slice(0, 32)}`,
    record.record_hash.slice(32),
  ];
  let y = 790;
  for (const line of lines) {
    let current = '';
    for (const char of line) {
      if (font.widthOfTextAtSize(current + char, 10) > 510) {
        page.drawText(current, { x: 40, y, size: 10, font });
        y -= 18;
        current = '';
      }
      current += char;
    }
    page.drawText(current, { x: 40, y, size: 10, font });
    y -= 25;
  }
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: 'Comprovante de registro de ponto',
    contactInfo: '',
    name: process.env.REP_DEVELOPER_NAME || '30Grow',
    location: 'Brasil',
    subFilter: 'ETSI.CAdES.detached',
    signatureLength: 32768,
  });
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return new SignPdf().sign(bytes, new RepPdfSigner(signer));
}
export async function signedReceipt(db, identity) {
  const record = await receiptRecord(db, identity);
  if (!record) return null;
  const load = () =>
    db.query(
      'SELECT pdf FROM rep_signed_documents WHERE establishment_id=$1 AND nsr=$2',
      [record.establishment_id, record.nsr],
    );
  const prior = await load();
  if (prior.rows[0]) return prior.rows[0].pdf;
  await withSigningCertificate(async ({ sign, fingerprint }) => {
    const pdf = await createReceiptPdf(record, sign);
    await db.query(
      `INSERT INTO rep_signed_documents(establishment_id,nsr,pdf,sha256,certificate_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(establishment_id,nsr) DO NOTHING`,
      [
        record.establishment_id,
        record.nsr,
        pdf,
        createHash('sha256').update(pdf).digest('hex'),
        fingerprint,
      ],
    );
  });
  return (await load()).rows[0].pdf;
}
export async function listReceipts(db, { companyId, candidateId, after = 0 }) {
  const result = await db.query(
    `SELECT r.nsr,r.establishment_id AS "establishmentId",r.punch_id AS "punchId",substr(r.record_text,11,24) AS "punchedAt",d.signed_at AS "signedAt"
 FROM rep_original_records r JOIN rep_workers w ON w.id=r.worker_id LEFT JOIN rep_signed_documents d ON d.establishment_id=r.establishment_id AND d.nsr=r.nsr
 WHERE w.company_id=$1 AND w.candidate_id=$2 AND r.record_type=7 AND r.recorded_at>=clock_timestamp()-interval '48 hours' AND r.nsr>$3 ORDER BY r.nsr LIMIT 101`,
    [companyId, candidateId, after],
  );
  return {
    items: result.rows.slice(0, 100),
    next: result.rows.length > 100 ? result.rows[99].nsr : null,
  };
}
