'use client';
import { Suspense } from 'react';
import { AppFeedbackProvider } from '../../../../app/_components/AppFeedback';
import { PreOnboardingChecklistBlock } from '../../../../app/_components/PreOnboardingChecklistBlock';
import { OnboardingCheckinsBlock } from '../../../../app/_components/OnboardingCheckinsBlock';
import { CompanyBenefitsAdminTab } from '../../../../app/dashboard/tabs/CompanyBenefitsAdminTab';
export default function HrFeedbackFixture(){return <AppFeedbackProvider locale="pt-BR"><main className="p-4">
  <PreOnboardingChecklistBlock locale="pt-BR" candidateId={7} employmentStatus="employee"/>
  <OnboardingCheckinsBlock locale="pt-BR" candidateId={7} employmentStatus="employee"/>
  <Suspense><CompanyBenefitsAdminTab locale="pt-BR" companyId={1}/></Suspense>
</main></AppFeedbackProvider>;}
