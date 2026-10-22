import { z } from 'zod';
import { htmlToPlainText, sanitizeRichTextHtml } from './sanitize-html.js';

// Pasted documents carry formatting that must not consume the text allowance.
// Bound the transport separately, then validate the cleaned content without truncation.
const cleanedDescription = z.string().trim().max(100_000)
  .transform((value) => sanitizeRichTextHtml(value, 100_000) || '');

export const jobRoleDescriptionSchema = cleanedDescription
  .superRefine((value, ctx) => { if (htmlToPlainText(value).length > 8000) ctx.addIssue({ code: 'too_big', origin: 'string', maximum: 8000, inclusive: true }); });

export const jobRoleAiDescriptionSchema = cleanedDescription
  .transform(htmlToPlainText)
  .pipe(z.string().max(4000));
