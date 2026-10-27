import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isValidAnalyticsDate,
  isValidAnalyticsDateRange,
  isValidAnalyticsMonths,
} from '../../lib/analytics/analytics-query.js';

describe('analytics query bounds', () => {
  it('accepts bounded periods and rejects malformed or inverted dates', () => {
    assert.equal(isValidAnalyticsDate('2026-09-19'), true);
    assert.equal(isValidAnalyticsDate('19/09/2026'), false);
    assert.equal(isValidAnalyticsDateRange('2026-01-01', '2026-12-31'), true);
    assert.equal(isValidAnalyticsDateRange('2026-12-31', '2026-01-01'), false);
  });

  it('caps trend windows at 24 months', () => {
    assert.equal(isValidAnalyticsMonths(1), true);
    assert.equal(isValidAnalyticsMonths(24), true);
    assert.equal(isValidAnalyticsMonths(0), false);
    assert.equal(isValidAnalyticsMonths(25), false);
    assert.equal(isValidAnalyticsMonths(Number.NaN), false);
  });
});
