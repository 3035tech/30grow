'use client';
import { EmployeeKudosPanel } from '../../../../app/_components/EmployeeFeedKudosSections';
import { AppFeedbackProvider } from '../../../../app/_components/AppFeedback';
const items=[{id:7,fromName:'Ana',toName:'Bruno',message:'Obrigada pela ajuda na entrega!',reactions:[{emoji:'👏',count:2,mine:false}]}];
export default function Page(){return <AppFeedbackProvider locale="pt-BR"><main className="mx-auto max-w-xl p-4"><h1 className="mb-4 text-xl font-semibold">Reconhecimentos</h1><EmployeeKudosPanel locale="pt-BR" items={items} total={1}/></main></AppFeedbackProvider>;}
