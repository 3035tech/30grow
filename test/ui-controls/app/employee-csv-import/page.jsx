'use client';

import { useState } from 'react';
import { EmployeeCsvImport } from '../../../../app/_components/EmployeeCsvImport';

export default function EmployeeCsvImportFixture() {
  const [open, setOpen] = useState(false);
  const [imported, setImported] = useState(false);
  return <main className="p-6">
    <button type="button" onClick={() => setOpen(true)}>Importar CSV</button>
    <EmployeeCsvImport open={open} onClose={() => setOpen(false)} companyId={26} locale="pt-BR" onImported={() => setImported(true)} />
    {imported ? <p data-testid="imported">Atualizado</p> : null}
  </main>;
}
