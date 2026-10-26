/**
 * Score determinístico 0–100 da página pública da vaga (sem IA).
 */

import { htmlToPlainText } from '../sanitize-html.js';
import { normalizeEmploymentType } from './vacancy-employment-type.js';
import { normalizeWorkplaceModality } from './vacancy-workplace.js';

const CHECKS = [
  {
    id: 'TITLE_CLEAR',
    weight: 15,
    ok: (v) => String(v.title || '').trim().length >= 8,
  },
  {
    id: 'DESCRIPTION_LENGTH',
    weight: 20,
    ok: (v) => htmlToPlainText(v.description || '').replace(/\s+/g, ' ').trim().length >= 280,
  },
  {
    id: 'EMPLOYMENT_TYPE',
    weight: 10,
    ok: (v) => Boolean(normalizeEmploymentType(v.employmentType)),
  },
  {
    id: 'WORKPLACE_MODALITY',
    weight: 10,
    ok: (v) => Boolean(normalizeWorkplaceModality(v.workplaceModality)),
  },
  {
    id: 'SALARY_PRESENT',
    weight: 10,
    ok: (v) => Boolean(String(v.salaryMin || '').trim() || String(v.salaryMax || '').trim()),
  },
  {
    id: 'PUBLIC_PAGE_ON',
    weight: 15,
    ok: (v) => v.publicPageEnabled === true,
  },
  {
    id: 'PUBLIC_INDEX_ON',
    weight: 10,
    ok: (v) => v.publicPageEnabled === true && v.publicAllowIndex === true,
  },
  {
    id: 'SHOW_COMPANY',
    weight: 5,
    ok: (v) => v.publicShowCompanyInfo === true,
  },
  {
    id: 'COMPANY_ABOUT',
    weight: 5,
    ok: (v) => {
      if (!v.publicShowCompanyInfo) return false;
      const about = htmlToPlainText(v.companyAboutHtml || '').trim();
      const web = String(v.companyWebsite || '').trim();
      return about.length >= 40 || Boolean(web);
    },
  },
];

/**
 * @param {object} vacancy — campos do drawer/API (camelCase)
 * @returns {{ score: number, maxScore: number, checks: Array<{ id: string, weight: number, ok: boolean }> }}
 */
export function computeJobSeoScore(vacancy) {
  const checks = CHECKS.map((c) => ({
    id: c.id,
    weight: c.weight,
    ok: Boolean(c.ok(vacancy || {})),
  }));
  const maxScore = checks.reduce((s, c) => s + c.weight, 0);
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  return { score, maxScore, checks };
}
