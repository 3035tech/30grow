'use client';

import { AppFeedbackProvider } from '../../../../app/_components/AppFeedback';
import { ClimateTab } from '../../../../app/dashboard/tabs/ClimateTab';

export default function ClimateStarterFixture() {
  return <AppFeedbackProvider locale="pt-BR"><ClimateTab locale="pt-BR" isAdmin={false} /></AppFeedbackProvider>;
}
