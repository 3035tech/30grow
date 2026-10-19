import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

async function fixture({ invalidCertificate = false, storageFailure = false, secretFailure = false } = {}) {
  const events = [];
  const certificate = { fingerprint: 'a'.repeat(64), validTo: '2030-01-01T00:00:00Z' };
  const deps = {
    z, randomUUID,
    S3Client: class { async send(command) { events.push(['upload', command.input]); if (storageFailure) throw Error('AWS private details'); return { VersionId: 'version-1' }; } destroy() {} },
    PutObjectCommand: class { constructor(input) { this.input = input; } },
    withSigningCertificate: async (action, { settings, p12 }) => {
      events.push(['validate', settings]); assert.equal(p12.toString(), 'encrypted-a1');
      if (invalidCertificate) throw Error('invalid certificate or password');
      return action({ sign: async () => Buffer.from('signature'), certificate });
    },
    writeSigningSettings: async settings => { events.push(['activate', settings]); if (secretFailure) throw Error('unavailable'); },
    publicCertificateSettings: settings => ({ configured: true, certificate: settings.certificate }),
  };
  const context = vm.createContext({ Buffer, Response, Set, Date, Number, Error, AbortSignal, setTimeout, clearTimeout, process: { env: { REP_SIGNING_UPLOAD_PREFIX: 'private/homolog/rep/a1/' } } });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../lib/rep/certificate-upload.js', import.meta.url), 'utf8'), { context });
  await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () { for (const [key,value] of Object.entries(deps)) this.setExport(key,value); }, { context }));
  await mod.evaluate();
  return { api: mod.namespace, events };
}
function upload({ name = 'new.pfx', bytes = 'encrypted-a1', extra = false } = {}) {
  const form = new FormData(); form.set('action','save'); form.set('password','new-password');
  form.set('file',new File([bytes],name)); if (extra) form.set('bucket','attacker-bucket');
  return new Request('https://team.test/api/admin/digital-certificate',{method:'POST',body:form});
}
test('upload accepts A1 and password, rejects arbitrary storage locations and oversized/wrong files', async () => {
  const { api } = await fixture();
  const body = await api.readCertificateUpload(upload()); assert.equal(body.p12.toString(),'encrypted-a1');
  for (const options of [{extra:true},{name:'script.js'},{bytes:''},{bytes:new Uint8Array(1024*1024+1)}]) await assert.rejects(api.readCertificateUpload(upload(options)));
  await assert.rejects(api.readCertificateUpload(new Request('https://team.test',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})));
});
test('streamed upload limit applies even without Content-Length', async () => {
  const { api } = await fixture();
  const body = new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1024*1024+16385));controller.close();}});
  await assert.rejects(api.readCertificateUpload(new Request('https://team.test',{method:'POST',body,duplex:'half',headers:{'Content-Type':'multipart/form-data; boundary=boundary'}})));
});
test('renewal validates first, uploads privately to a new server key, then activates it', async () => {
  const { api, events } = await fixture();
  for (let i=0;i<2;i++) {
    const p12=Buffer.from('encrypted-a1');
    const result=await api.validateAndSaveUploadedCertificate({action:'save',password:'new-password',p12});
    assert.ok(p12.every(byte=>byte===0)); assert.ok(!JSON.stringify(result).includes('password'));
  }
  assert.equal(events.map(([action])=>action).join(','),'validate,upload,activate,validate,upload,activate');
  const first=events[1][1], second=events[4][1];
  assert.equal(first.Bucket,'30grow'); assert.match(first.Key,/^private\/homolog\/rep\/a1\/[a-f0-9-]+\.p12$/);
  assert.notEqual(first.Key,second.Key); assert.equal(first.ServerSideEncryption,'AES256'); assert.equal(first.ACL,undefined);
  assert.equal(first.CacheControl,'private, no-store'); assert.equal(first.IfNoneMatch,'*');
  assert.equal(events[2][1].versionId,'version-1');
});
test('test action validates without uploading or activating', async () => {
  const { api, events }=await fixture(); await api.validateAndSaveUploadedCertificate({action:'test',password:'new-password',p12:Buffer.from('encrypted-a1')});
  assert.equal(events.map(([action])=>action).join(','),'validate');
});
test('invalid A1/password or failed upload cannot replace the active certificate',async()=>{
 for(const options of [{invalidCertificate:true},{storageFailure:true}]) {
  const {api,events}=await fixture(options);const p12=Buffer.from('encrypted-a1');
  await assert.rejects(api.validateAndSaveUploadedCertificate({action:'save',password:'wrong',p12}));
  assert.ok(!events.some(([action])=>action==='activate')); assert.ok(p12.every(byte=>byte===0));
 }
});
test('ambiguous activation failure never deletes the new or previous certificate',async()=>{
 const {api,events}=await fixture({secretFailure:true});
 await assert.rejects(api.validateAndSaveUploadedCertificate({action:'save',password:'new-password',p12:Buffer.from('encrypted-a1')}));
 assert.equal(events.map(([action])=>action).join(','),'validate,upload,activate');
});
