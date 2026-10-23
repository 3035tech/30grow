/** Development always uses the dedicated sandbox secret, never the production key.
 * AWS CLI login supplies credentials; no secret is written to disk or stdout.
 */
import { execFileSync, spawn } from 'node:child_process';
import { stripeSandboxEnvironment } from '../lib/billing/sandbox-env.js';
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (process.env.NODE_ENV === 'production') throw new Error('dev-sandbox is for development only.');
if (!['localhost','127.0.0.1','::1','postgres','host.docker.internal'].includes(process.env.POSTGRES_HOST || 'localhost')) throw new Error('Development sandbox requires a local or development Docker database. A remote database is refused.');
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
let secret;
try {
  const result = JSON.parse(execFileSync('aws', ['secretsmanager','get-secret-value','--secret-id','/homolog/30grow/stripe','--region',region,'--output','json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  secret = JSON.parse(result.SecretString);
} catch {
  console.error('Could not load the Stripe sandbox secret. Run aws login and verify access to /homolog/30grow/stripe.');
  process.exit(1);
}
const args = process.argv.slice(2);
const portIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || '3000';
if (!/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid development port.');
const env = stripeSandboxEnvironment(secret,{...process.env,APP_URL:`http://localhost:${port}`,NEXT_PUBLIC_APP_URL:`http://localhost:${port}`});
console.log('Development uses Stripe sandbox (/homolog/30grow/stripe).');
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack',...args],{env,stdio:'inherit'});
child.on('error',()=>{console.error('Development server could not start.');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
