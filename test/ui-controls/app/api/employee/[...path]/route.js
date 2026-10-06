// Synthetic, read-only data. This route exists only in the isolated UI fixture app.
const home = {
  person: { fullName: 'Pessoa de teste' },
  tasks: [{id:'pdi-1',titleKey:'employeeHome.pdiPending',dueDate:'2020-01-10',href:'/employee/pdi'}],
  plans: [{ id:1, title:'Desenvolvimento do trimestre', objective:'Praticar feedback e organizar as entregas do time.', items:[
    { id:1, title:'Planejar entregas do próximo trimestre', status:'todo', dueDate:'2099-12-10' },
    { id:2, title:'Consolidar rituais de feedback e documentar os combinados com a equipe', status:'doing', dueDate:'2020-01-10' },
    { id:3, title:'Concluir integração', status:'done', dueDate:'2020-01-01' },
  ] }], courses:[], okrActivities:[], recentAgreements:[], oneOnOnePrompts:[], feed:{total:42,items:[]},kudos:{total:17,items:[]}, company:{name:'Empresa exemplo'},
};
export async function GET(request, context) {
  const {path} = await context.params;
  const endpoint = path.join('/');
  if (endpoint === 'me/2fa') {
    const scenario = new URL(request.headers.get('referer') || request.url).searchParams.get('twofa');
    if (scenario === 'error') return Response.json({error:'Unavailable'}, {status:503});
    if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 1500));
    if (scenario === 'enabled') return Response.json({enabled:true});
  }

  const data = {
    home,
    me: {person:{fullName:'Pessoa de teste',email:'pessoa@example.test'}},
    'me/2fa':{enabled:false},
    companies:{companies:[]}, notifications:{items:[],unreadCount:0},
    dp: {profile:{addressCity:'Cidade exemplo',addressState:'RS'},documents:[],leaves:[],pendingDocs:2,badge:2},
    lms: {courses:[{id:1,enrollmentId:1,title:'Integração',isComplete:true,progressPct:100,lessons:[]}],continue:{enrollmentId:1,courseTitle:'Integração',lessonId:1}},
    'time-clock': {open:false,punches:[],day:'2026-09-29'},
    'hour-bank': {enabled:false},
    surveys:{openClimate:[{id:1},{id:2}],openPulse:[{id:3}],history:[]},
    'formal-reviews':{reviews:[]},
    compensation:{items:[]}, feed:{items:[],total:0}, kudos:{items:[],total:0},
  };
  return Response.json(data[endpoint] || {});
}
