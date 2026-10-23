/** Local disposable databases only. CI runs this before either image is published.
 * Opt in locally with RELEASE_CONTRACTS=1. This resets DTOV synthetic fixtures.
 */
import { spawn } from 'node:child_process';
if (process.env.CI !== 'true' && process.env.RELEASE_CONTRACTS !== '1') {
  throw new Error('CI=true or RELEASE_CONTRACTS=1 required; this gate resets local DTOV fixtures.');
}
const run=(command,args,extra={})=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'inherit',env:{...process.env,...extra},shell:false});
  child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} failed (${signal||code})`)));
});
const compose=['compose','-p','30grow-billing-gate','-f','test/integration/docker-compose.billing.yml'];
let failed=false;
try {
  await run('npm',['run','dtov:reset']);
  await run('docker',[...compose,'up','-d','--wait']);
  await run(process.execPath,['--experimental-vm-modules','--test','test/integration/stripe-billing.test.js','test/integration/company-lifecycle.test.js'],{BILLING_TEST_PG_PORT:'55447'});
  await run('npm',['run','build'],{NODE_OPTIONS:'--max-old-space-size=6144'});
  await run(process.execPath,['test/dtov/tenant-permissions.http.test.js'],{TENANT_AUDIT:'1'});
  if(process.argv.includes('--ui')) await run('npx',['--no-install','playwright','test','--config','test/ui-controls/playwright.config.js','subscriptions.spec.js','billing.spec.js','hr-feedback.spec.js','remember-me.spec.js']);
} catch(error) {
  failed=true;console.error('Release contract gate failed:',error.message);
} finally {
  for(const [command,args] of [['docker',[...compose,'down','-v','--remove-orphans']],['npm',['run','dtov:down']]]) {
    try{await run(command,args);}catch(error){failed=true;console.error('Test cleanup failed:',error.message);}
  }
}
if(failed) process.exitCode=1;
