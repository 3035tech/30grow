export async function GET(request, context) {
  const { path = [] } = await context.params;
  const key = path.join('/');
  if (key === '2fa') {
    if ((request.headers.get('referer') || '').includes('twofa=error')) return Response.json({error:'Falha simulada'}, {status:503});
    return Response.json({canUse2Fa:true,enabled:true});
  }
  if (key === 'company-modules') return Response.json({enabledModules:null,canEdit:false});
  return Response.json({user:{id:90001,email:'gestao@example.test',displayName:'Gestão de teste',role:'hr',companyId:1,companyName:'Empresa exemplo'}});
}
