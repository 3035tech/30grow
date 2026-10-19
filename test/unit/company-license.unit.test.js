import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPANY_LICENSE, companyLicenseSummary } from '../../lib/company-license.js';
import { t } from '../../lib/i18n.js';
import { HELP_GUIDE_GROUPS, TAB_BY_HELP_SECTION, validateHelpGuideCoverage } from '../../lib/help-sections.js';

test('license number is a padded string without bigint precision loss', () => {
  const row = { licenseNumber: '1', licenseStartsAt: '2026-09-20T10:00:00Z', licenseExpiresAt: '2027-09-20T10:00:00Z', licenseExpired: false };
  assert.deepEqual(companyLicenseSummary(row), {
    number: '30T-EA-000001',
    plan: COMPANY_LICENSE.PLAN,
    startsAt: row.licenseStartsAt,
    expiresAt: row.licenseExpiresAt,
    status: COMPANY_LICENSE.ACTIVE,
    offerTier: COMPANY_LICENSE.OFFER_TIERS.LEGACY,
    trialDays: 365,
  });
  assert.equal(companyLicenseSummary({ ...row, licenseNumber: '9007199254740993' }).number, '30T-EA-9007199254740993');
  assert.equal(companyLicenseSummary({ ...row, licenseExpired: true }).status, COMPANY_LICENSE.EXPIRED);
  assert.equal(companyLicenseSummary({ licenseNumber: null }), null);
});

test('new license terms are preserved in the profile summary', () => {
  const row = {
    licenseNumber: '22',
    licenseStartsAt: '2026-09-24T10:00:00Z',
    licenseExpiresAt: '2026-12-23T10:00:00Z',
    licenseExpired: false,
    licenseOfferTier: COMPANY_LICENSE.OFFER_TIERS.EARLY_ADOPTER,
    licenseTrialDays: 90,
  };
  assert.equal(companyLicenseSummary(row).offerTier, COMPANY_LICENSE.OFFER_TIERS.EARLY_ADOPTER);
  assert.equal(companyLicenseSummary(row).trialDays, 90);
});

test('license and logout have bilingual help and UI copy', () => {
  assert.deepEqual(validateHelpGuideCoverage(), { ok: true });
  assert.equal(TAB_BY_HELP_SECTION.companyLicense, 'profile');
  assert.equal(HELP_GUIDE_GROUPS.filter((g) => g.sections.includes('companyLicense')).length, 1);
  for (const locale of ['pt-BR', 'en']) {
    for (const key of ['licenseTitle', 'licensePlan', 'licensePlanTrial', 'licensePlanEarlyAdopter', 'licensePlanDesignPartner', 'licensePlanLegacy', 'licenseNumber', 'licenseStartsAt', 'licenseExpiresAt', 'licenseActive', 'licenseExpired', 'licenseEmployeeFree', 'licenseExpiredNotice', 'licenseNone', 'profileSectionBilling', 'billingPlatformTitle', 'billingCompanyTitle', 'billingHistoryTitle', 'billingIntegrationNotice']) {
      assert.notEqual(t(locale, `dashboard.${key}`), `dashboard.${key}`);
    }
    assert.notEqual(t(locale, 'employeeHome.logoutFailed'), 'employeeHome.logoutFailed');
  }
});

test('Stripe extends the existing license view without replacing number or historical term', () => {
  const row={licenseNumber:'23',licenseStartsAt:'2026-01-01T00:00:00Z',licenseExpiresAt:'2026-02-01T00:00:00Z',licenseExpired:true,licenseOfferTier:'trial',licenseTrialDays:30};
  const billing={managed:true,subscriptionId:'sub_test',status:'active',planKey:'brl_small_monthly',periodEnd:'2099-01-01T00:00:00Z',trialEndsAt:row.licenseExpiresAt};
  const paid=companyLicenseSummary(row,billing);
  assert.equal(paid.number,'30T-EA-000023');
  assert.equal(paid.originalExpiresAt,row.licenseExpiresAt);
  assert.equal(paid.expiresAt,billing.periodEnd);
  assert.equal(paid.status,COMPANY_LICENSE.ACTIVE);
  assert.equal(paid.plan,'subscription');
  assert.equal(paid.billing.source,'stripe');
  const unpaid=companyLicenseSummary(row,{...billing,status:'unpaid'});
  assert.equal(unpaid.status,COMPANY_LICENSE.EXPIRED);
  assert.equal(unpaid.number,paid.number);
  assert.equal(companyLicenseSummary(row,{...billing,planKey:null}).status,COMPANY_LICENSE.EXPIRED);
});
