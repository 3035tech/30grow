'use client';
import {Suspense} from 'react';
import {CompanyFeedAdminTab} from '../../../../app/dashboard/tabs/CompanyFeedAdminTab';
import {EmployeeFeedPanel} from '../../../../app/_components/EmployeeFeedKudosSections';
import {AppFeedbackProvider} from '../../../../app/_components/AppFeedback';
export default function Page(){return <AppFeedbackProvider locale="pt-BR"><main className="p-4"><Suspense><CompanyFeedAdminTab locale="pt-BR" companyId={1}/></Suspense><section aria-label="Mural do colaborador"><EmployeeFeedPanel locale="pt-BR" items={[{id:5,title:'Aviso com foto',attachments:[{id:10,fileName:'foto.png',contentType:'image/png',byteSize:68}]}]} /></section></main></AppFeedbackProvider>;}
