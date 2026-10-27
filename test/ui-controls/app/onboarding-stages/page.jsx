'use client';
import { useState } from 'react';
import { AppFeedbackProvider, useAppFeedback } from '../../../../app/_components/AppFeedback';
import { PipelineExtrasProvider, usePipelineExtras } from '../../../../app/dashboard/PipelineExtrasContext';
import { ONBOARDING_STAGES, onboardingStageOptions } from '../../../../lib/development/onboarding-stage-selection';
import { t } from '../../../../lib/i18n';
import { useEmployeeAdmission } from '../../../../app/_components/useEmployeeAdmission';
function Controls() {
  const { promptForm } = useAppFeedback();
  const { requestPipelineExtras } = usePipelineExtras();
  const [result, setResult] = useState(null);
  const { admit } = useEmployeeAdmission({ locale:'pt-BR',onAdmitted:setResult });
  const direct = async () => setResult(await promptForm({ title: 'Incluir colaborador', confirmLabel: 'Adicionar', fields: [{
    key: 'onboardingStages', type: 'checkboxGroup', label: t('pt-BR', 'onboardingStages.title'),
    help: t('pt-BR', 'onboardingStages.help'), defaultValue: [...ONBOARDING_STAGES], options: onboardingStageOptions('pt-BR', t),
    selectAllLabel: t('pt-BR', 'onboardingStages.selectAll'), clearAllLabel: t('pt-BR', 'onboardingStages.clearAll'),
    selectionSummary: (n, total) => t('pt-BR', 'onboardingStages.summary', { n, total }), emptySelectionLabel: t('pt-BR', 'onboardingStages.empty'),
  }] }));
  return <main className="p-4"><button onClick={direct}>Incluir colaborador</button>
    <button onClick={() => admit(7)}>Ativar colaborador</button>
    <button onClick={async () => setResult(await requestPipelineExtras('pt-BR', 'hired'))}>Contratar</button>
    <output data-testid="result">{JSON.stringify(result)}</output></main>;
}
export default function Fixture() { return <AppFeedbackProvider locale="pt-BR"><PipelineExtrasProvider><Controls /></PipelineExtrasProvider></AppFeedbackProvider>; }
