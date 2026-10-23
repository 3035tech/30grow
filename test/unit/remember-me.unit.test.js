import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { rememberedSessionClaims, webSessionMaxAge, REMEMBER_SESSION_MAX_AGE_SEC, MANAGER_SESSION_MAX_AGE_SEC } from '../../lib/session-ttl.js';
import { EMPLOYEE_SESSION_MAX_AGE } from '../../lib/employee-auth-constants.js';

const secret = 'remember-me-local-test-secret-at-least-32-characters';
process.env.JWT_SECRET = secret;

test('only explicit boolean opt-in extends a session; remembered deadline is absolute', () => {
  const now = 1800000000;
  for (const value of [undefined, false, 'true', 'false', 1]) {
    assert.deepEqual(rememberedSessionClaims(value, now), {});
    assert.equal(webSessionMaxAge({}, MANAGER_SESSION_MAX_AGE_SEC, now), 28800);
  }
  const claims = rememberedSessionClaims(true, now);
  assert.equal(webSessionMaxAge(claims, 28800, now), 2592000);
  assert.equal(webSessionMaxAge(claims, 28800, now + 86400), 2505600);
  assert.equal(webSessionMaxAge(claims, 28800, now + 2592000), 0);
  assert.equal(webSessionMaxAge({ rememberUntil: now + 99999999 }, 28800, now), REMEMBER_SESSION_MAX_AGE_SEC);
});

test('manager and employee JWTs retain default TTL or fixed remembered expiry when reissued', async () => {
  const { signToken, verifyToken } = await import('../../lib/auth.js');
  const { signEmployeeToken, verifyEmployeeToken } = await import('../../lib/employee-auth.js');
  const { verifyEmployeeTokenEdge } = await import('../../lib/auth-edge.js');
  for (const [sign, claims, fallback] of [
    [signToken, {userId: 1,role:'hr',companyId:3,sv:2}, MANAGER_SESSION_MAX_AGE_SEC],
    [signEmployeeToken, {candidateId:7,companyId:3,sv:2,email:'person@example.test'}, EMPLOYEE_SESSION_MAX_AGE],
  ]) {
    const regular = jwt.verify(sign(claims), secret);
    assert.equal(regular.exp - regular.iat, fallback);
    assert.equal(regular.rememberUntil, undefined);
    const remembered = {...claims,...rememberedSessionClaims(true)};
    const first = jwt.verify(sign(remembered),secret);
    const renewed = jwt.verify(sign({...remembered,locale:'en-US'}),secret);
    assert.equal(first.exp,remembered.rememberUntil);
    assert.equal(renewed.exp,first.exp);
    const expired = jwt.sign({...remembered, exp:Math.floor(Date.now()/1000)-1},secret);
    assert.equal(verifyToken(expired),null);
    if (claims.candidateId) {
      assert.equal(verifyEmployeeToken(sign(remembered)).rememberUntil,remembered.rememberUntil);
      assert.equal((await verifyEmployeeTokenEdge(sign(remembered))).rememberUntil,remembered.rememberUntil);
    }
    const realNow = Date.now;
    let clock = realNow();
    try {
      Date.now = () => { clock += 1000; return clock; };
      assert.equal(jwt.decode(sign(remembered)).exp, remembered.rememberUntil, 'crossing a second while signing cannot extend the deadline');
    } finally { Date.now = realNow; }
  }
});

async function secondFactor(file) {
  const deps = {
    default:jwt,checkRateLimit:async()=>({ok:true}),issueSecondFactorChallenge:async()=>({sv:1,jti:'synthetic'}),
    secondFactorChallengeLive:async()=>true,query:async()=>({rows:[]}),verifyPassword:async()=>true,
    isManagerRole:()=>true,EMPLOYMENT_STATUS:{EMPLOYEE:'employee'},getJwtSecret:()=>secret,
    generateTotpSecret:()=>'',verifyTotpCode:()=>true,buildOtpAuthUrl:()=>'',
  };
  const context = vm.createContext({process});
  const module = new vm.SourceTextModule(await readFile(new URL(file,import.meta.url),'utf8'),{context});
  await module.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value]of Object.entries(deps))this.setExport(key,value);},{context}));
  await module.evaluate();return module.namespace;
}

test('remember choice is signed into manager and employee 2FA challenges', async () => {
  const manager = await secondFactor('../../lib/manager-2fa.js');
  const employee = await secondFactor('../../lib/employee-2fa.js');
  for (const rememberMe of [false,true]) {
    const managerToken = await manager.sign2faChallenge(5,{rememberMe});
    const managerChoice = await manager.verify2faChallenge(managerToken,{withSessionOptions:true});
    assert.equal(managerChoice.userId,5);assert.equal(managerChoice.rememberMe,rememberMe);
    assert.equal(await manager.verify2faChallenge(managerToken),5,'legacy caller contract');
    const employeeToken = await employee.signEmployee2faChallenge({candidateId:7,companyId:3,rememberMe});
    assert.equal((await employee.verifyEmployee2faChallenge(employeeToken)).rememberMe===true,rememberMe);
    const parts=managerToken.split('.');parts[1]=Buffer.from(JSON.stringify({...jwt.decode(managerToken),rememberMe:!rememberMe})).toString('base64url');
    assert.equal(await manager.verify2faChallenge(parts.join('.'),{withSessionOptions:true}),null);
  }
});
