'use client';
import { useState } from 'react';
import { BillingTab } from '../../../../app/_components/BillingTab';
import { CompanyLicenseSummary } from '../../../../app/_components/CompanyLicenseSummary';
import { companyLicenseSummary } from '../../../../lib/company-license';
const original = companyLicenseSummary({ licenseNumber:'7',licenseStartsAt:'2025-01-01T00:00:00Z',licenseExpiresAt:'2025-02-01T00:00:00Z',licenseExpired:true,licenseOfferTier:'trial',licenseTrialDays:30 });
export default function BillingPreview() {
  const [license,setLicense]=useState(original);
  return <main className="mx-auto max-w-5xl p-5"><CompanyLicenseSummary license={license} locale="pt-BR" onManage={()=>document.getElementById('billing-panel').scrollIntoView()} /><div id="billing-panel"><BillingTab locale="pt-BR" role="direction" companyId={7} companyName="Empresa de teste" onLicenseChange={setLicense} /></div></main>;
}
