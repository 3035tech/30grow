import { FIELD_SESSION, fieldEmployeeHandlers } from '../../../../../../../../lib/people/field-team-http.js';

export const dynamic = 'force-dynamic';
const h = fieldEmployeeHandlers(FIELD_SESSION.MOBILE);

export const POST = h.visitAction;
