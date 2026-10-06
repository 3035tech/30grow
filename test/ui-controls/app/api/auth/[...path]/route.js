// Synthetic responses only; no credentials are persisted or sent to a real service.
export async function GET(request, context) {
  const {path} = await context.params;
  if (path.join('/') === 'captcha-config') return Response.json({required:false,siteKey:''});
  return Response.json({errorCode:'UNAUTHORIZED'}, {status:401});
}
export async function POST() {
  return Response.json({errorCode:'UNAUTHORIZED',error:'Não autorizado'}, {status:401});
}
