'use client';
// Isolated validation of the real management shell; no production auth or database.
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardClient from '../../../../app/dashboard/DashboardClient';
import { DarkModeProvider } from '../../../../app/_components/DarkModeProvider';

export default function ManagementFixture() {
  const params = useSearchParams();
  const [auth] = useState(() => ({
    userId: 90001,
    role: params.get('persona') === 'admin' ? 'admin' : 'hr',
    companyOwner: params.get('persona') === 'owner',
    companyId: params.get('persona') === 'admin' ? null : 1,
    displayName: 'Gestão de teste',
    email: 'gestao@example.test',
    locale: 'pt-BR',
  }));
  return <DarkModeProvider><DashboardClient auth={auth} results={[]} companies={[{id:1,name:'Empresa exemplo'}]} initialLocale="pt-BR" /></DarkModeProvider>;
}
