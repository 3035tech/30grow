import { stripSalary } from '../br-masks.js';
import { sanitizeInterviewNotesHtml } from '../sanitize-html.js';
import { normalizeEmploymentType } from './vacancy-employment-type.js';
import {
  normalizeWorkplaceCity,
  normalizeWorkplaceModality,
  normalizeWorkplaceState,
} from './vacancy-workplace.js';

function cleanDescription(v) {
  return sanitizeInterviewNotesHtml(v);
}

function parseOptionalBool(body, camelKey, snakeKey, { forCreate, defaultWhenCreate = false } = {}) {
  const has = body[camelKey] !== undefined || body[snakeKey] !== undefined;
  if (forCreate) {
    return has ? Boolean(body[camelKey] ?? body[snakeKey]) : defaultWhenCreate;
  }
  if (has) return Boolean(body[camelKey] ?? body[snakeKey]);
  return undefined;
}

/**
 * Extrai campos de detalhe da vaga do body.
 * Campos omitidos retornam `undefined` (não atualizar no PATCH).
 * description é HTML sanitizado (mesmo editor das anotações).
 */
export function parseVacancyDetailsFromBody(body = {}, { forCreate = false } = {}) {
  const hasDesc = body.description !== undefined || body.vacancyDescription !== undefined;
  const hasMin = body.salaryMin !== undefined || body.salary_min !== undefined;
  const hasMax = body.salaryMax !== undefined || body.salary_max !== undefined;
  const hasShowSalary =
    body.clientReportShowSalary !== undefined || body.client_report_show_salary !== undefined;
  const hasEmployment =
    body.employmentType !== undefined || body.employment_type !== undefined;
  const hasWorkplaceModality =
    body.workplaceModality !== undefined || body.workplace_modality !== undefined;
  const hasWorkplaceCity =
    body.workplaceCity !== undefined || body.workplace_city !== undefined;
  const hasWorkplaceState =
    body.workplaceState !== undefined || body.workplace_state !== undefined;

  const description = forCreate
    ? cleanDescription(body.description ?? body.vacancyDescription)
    : hasDesc
      ? cleanDescription(body.description ?? body.vacancyDescription)
      : undefined;

  const salaryMin = forCreate
    ? stripSalary(body.salaryMin ?? body.salary_min)
    : hasMin
      ? stripSalary(body.salaryMin ?? body.salary_min)
      : undefined;

  const salaryMax = forCreate
    ? stripSalary(body.salaryMax ?? body.salary_max)
    : hasMax
      ? stripSalary(body.salaryMax ?? body.salary_max)
      : undefined;

  const minVal = salaryMin !== undefined ? salaryMin : null;
  const maxVal = salaryMax !== undefined ? salaryMax : null;
  if (minVal != null && maxVal != null && Number(minVal) > Number(maxVal)) {
    const err = new Error('INVALID_SALARY_RANGE');
    err.code = 'INVALID_SALARY_RANGE';
    throw err;
  }

  let clientReportShowSalary;
  if (forCreate) {
    clientReportShowSalary = hasShowSalary
      ? Boolean(body.clientReportShowSalary ?? body.client_report_show_salary)
      : false;
  } else if (hasShowSalary) {
    clientReportShowSalary = Boolean(body.clientReportShowSalary ?? body.client_report_show_salary);
  } else {
    clientReportShowSalary = undefined;
  }

  let employmentType;
  if (forCreate) {
    employmentType = hasEmployment
      ? normalizeEmploymentType(body.employmentType ?? body.employment_type)
      : null;
  } else if (hasEmployment) {
    const raw = body.employmentType ?? body.employment_type;
    employmentType = raw === '' || raw == null ? null : normalizeEmploymentType(raw);
    if (raw && employmentType == null) {
      const err = new Error('INVALID_EMPLOYMENT_TYPE');
      err.code = 'INVALID_EMPLOYMENT_TYPE';
      throw err;
    }
  } else {
    employmentType = undefined;
  }

  let workplaceModality;
  if (forCreate) {
    workplaceModality = hasWorkplaceModality
      ? normalizeWorkplaceModality(body.workplaceModality ?? body.workplace_modality)
      : null;
  } else if (hasWorkplaceModality) {
    const raw = body.workplaceModality ?? body.workplace_modality;
    workplaceModality = raw === '' || raw == null ? null : normalizeWorkplaceModality(raw);
    if (raw && workplaceModality == null) {
      const err = new Error('INVALID_WORKPLACE_MODALITY');
      err.code = 'INVALID_WORKPLACE_MODALITY';
      throw err;
    }
  } else {
    workplaceModality = undefined;
  }

  let workplaceState;
  if (forCreate) {
    const raw = body.workplaceState ?? body.workplace_state;
    if (hasWorkplaceState && raw && !normalizeWorkplaceState(raw)) {
      const err = new Error('INVALID_WORKPLACE_STATE');
      err.code = 'INVALID_WORKPLACE_STATE';
      throw err;
    }
    workplaceState = hasWorkplaceState ? normalizeWorkplaceState(raw) : null;
  } else if (hasWorkplaceState) {
    const raw = body.workplaceState ?? body.workplace_state;
    workplaceState = raw === '' || raw == null ? null : normalizeWorkplaceState(raw);
    if (raw && workplaceState == null) {
      const err = new Error('INVALID_WORKPLACE_STATE');
      err.code = 'INVALID_WORKPLACE_STATE';
      throw err;
    }
  } else {
    workplaceState = undefined;
  }

  let workplaceCity;
  if (forCreate) {
    workplaceCity = hasWorkplaceCity
      ? normalizeWorkplaceCity(body.workplaceCity ?? body.workplace_city)
      : null;
  } else if (hasWorkplaceCity) {
    workplaceCity = normalizeWorkplaceCity(body.workplaceCity ?? body.workplace_city);
  } else {
    workplaceCity = undefined;
  }

  const publicPageEnabled = parseOptionalBool(body, 'publicPageEnabled', 'public_page_enabled', {
    forCreate,
  });
  const publicAllowIndex = parseOptionalBool(body, 'publicAllowIndex', 'public_allow_index', {
    forCreate,
    defaultWhenCreate: true,
  });
  const publicShowCompanyInfo = parseOptionalBool(
    body,
    'publicShowCompanyInfo',
    'public_show_company_info',
    { forCreate }
  );
  const publicShowSalary = parseOptionalBool(body, 'publicShowSalary', 'public_show_salary', {
    forCreate,
  });

  return {
    description,
    salaryMin,
    salaryMax,
    clientReportShowSalary,
    employmentType,
    workplaceModality,
    workplaceCity,
    workplaceState,
    publicPageEnabled,
    publicAllowIndex,
    publicShowCompanyInfo,
    publicShowSalary,
  };
}

export const VACANCY_DETAILS_SQL_SELECT = `
  v.description,
  v.salary_min AS "salaryMin",
  v.salary_max AS "salaryMax",
  v.client_report_show_salary AS "clientReportShowSalary",
  v.employment_type AS "employmentType",
  v.workplace_modality AS "workplaceModality",
  v.workplace_city AS "workplaceCity",
  v.workplace_state AS "workplaceState",
  v.public_page_enabled AS "publicPageEnabled",
  v.public_allow_index AS "publicAllowIndex",
  v.public_show_company_info AS "publicShowCompanyInfo",
  v.public_show_salary AS "publicShowSalary"`.trim();
