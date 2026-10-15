export const ORG_UNIT_TYPES = Object.freeze([
  'directorate',
  'area',
  'department',
  'sector',
  'team',
  'nucleus',
]);
export const POSITION_STATUSES = Object.freeze(['planned', 'approved', 'frozen', 'closed']);
export const POSITION_TRANSITIONS = Object.freeze({
  planned: ['approved', 'closed'],
  approved: ['frozen', 'closed'],
  frozen: ['approved', 'closed'],
  closed: [],
});
export const POSITION_PAGE_SIZE = 20;
export const POSITION_MAX = 5000;
export function positionStatus(position) {
  return position.candidateId
    ? 'occupied'
    : position.status === 'approved'
      ? 'open'
      : position.status;
}
