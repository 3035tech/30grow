'use client';
import { DigitalCertificateAdminTab } from '../../../../app/dashboard/tabs/DigitalCertificateAdminTab';
import { AppFeedbackProvider } from '../../../../app/_components/AppFeedback';
export default function Page() {
  return <AppFeedbackProvider locale="pt-BR"><main className="mx-auto max-w-4xl p-5"><DigitalCertificateAdminTab locale="pt-BR" /></main></AppFeedbackProvider>;
}
