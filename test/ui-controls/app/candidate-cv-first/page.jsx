'use client';

import { useState } from 'react';
import { AppFeedbackProvider } from '../../../../app/_components/AppFeedback';
import { CandidateCvFirstImport } from '../../../../app/_components/CandidateCvFirstImport';

export default function CandidateCvFirstFixture() {
  const [created, setCreated] = useState(null);
  return <AppFeedbackProvider locale="pt-BR"><main className="p-4">
    <CandidateCvFirstImport vacancyId={7} locale="pt-BR" onCreated={setCreated} />
    {created ? <p data-testid="candidate-created">Candidato {created}</p> : null}
  </main></AppFeedbackProvider>;
}
