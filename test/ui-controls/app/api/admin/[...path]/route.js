// GET-only synthetic fixtures; writes have no handler and cannot change business data.
export async function GET(request, context) {
  const { path } = await context.params;
  const key = path.join('/');
  const url = new URL(request.url);
  const referer = request.headers.get('referer') || '';
  if (referer.includes('scenario=error')) return Response.json({error:'Falha simulada de carregamento'}, {status:503});
  if (referer.includes('scenario=loading')) await new Promise(resolve => setTimeout(resolve, 1500));
  if (key === 'audit-log') {
    if (url.searchParams.get('format') === 'csv') return new Response('id,action\r\n1,dp.profile.updated', { headers: { 'Content-Type': 'text/csv', 'X-Export-Truncated': 'true' } });
    return Response.json({ items: [{ id: 1, createdAt: '2026-10-07T10:00:00Z', actorKind: 'employee', actorCandidateId: 123, actorCandidateName: 'Pessoa de teste', action: 'dp.profile.updated', targetType: 'candidate', targetId: '123', companyId: 1, companyName: 'Empresa exemplo', metadata: { changes: [{ field: 'cpf' }] } }], total: 1, totalPages: 1 });
  }
  const companies = [{id:1,name:'Empresa exemplo',slug:'empresa-exemplo',active:true,licenseActive:true,userCount:2,createdAt:'2026-01-01'}];
  if (key === 'companies') return Response.json(url.searchParams.has('forSelect') ? companies : {items:companies,total:1,totalPages:1,logoStorageConfigured:false});
  if (key === 'users') return Response.json({items:[{id:90002,email:'rh@example.test',displayName:'Pessoa de RH',role:'hr',companyId:1,companyName:'Empresa exemplo',active:true,createdAt:'2026-01-01'}],total:1,totalPages:1});
  if (key === 'pdi') return Response.json({rows:[{candidateId:1,candidateName:'Pessoa de teste',planId:2,planTitle:'Desenvolver liderança',doneCount:2,itemCount:4,donePct:50}],total:1,summary:{activePlanCount:1}});
  if (key === 'whistleblowing') return Response.json({channels:[],reports:[]});
  if (key === 'pipeline-stages') return Response.json({stages:[]});
  if (key.endsWith('/invites')) return Response.json({invites:[]});
  if (key === 'org-chart') return Response.json({roots:[],total:0,withManager:0});
  return Response.json({items:[],rows:[],total:0,totalPages:1,plans:[],courses:[],objectives:[],enrollments:[],resources:[],channels:[],reports:[]});
}
