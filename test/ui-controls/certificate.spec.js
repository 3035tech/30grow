import { test, expect } from '@playwright/test';
for (const width of [1440, 390]) test(`super admin renews A1 with only file and password at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height:1100});
 await page.route('**/api/admin/time-clock/operations',route=>route.fulfill({json:{certificate:null,pendingReceipts:{n:0},signingFailures:{n:0},unavailableServices:0,deliveries:{},failedJobs:[]}}));
 let active=false;
 await page.route('**/api/admin/digital-certificate',async route=>{
  if(route.request().method()==='POST') {
   const body=route.request().postDataBuffer().toString();
   expect(route.request().headers()['content-type']).toContain('multipart/form-data;');
   expect(body).toContain('filename="renewal.p12"'); expect(body).toContain('new-test-password');
   expect(body).not.toContain('name="bucket"');
   if(body.includes('\r\nsave\r\n')) active=true;
   return route.fulfill({json:{editable:true,configured:active,certificate:{subject:'A1 teste',issuer:'AC teste',validFrom:'2026-01-01T00:00:00Z',validTo:'2030-01-01T00:00:00Z',fingerprint:'a'.repeat(64)},validatedAt:'2026-10-19T00:00:00Z'}});
  }
  return route.fulfill({json:{editable:true,configured:false}});
 });
 await page.goto('/certificate');
 await expect(page.getByLabel('Arquivo A1',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Bucket privado',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Região AWS do bucket',{exact:true})).toHaveCount(0);
 await page.getByLabel('Arquivo A1',{exact:true}).setInputFiles({name:'renewal.p12',mimeType:'application/x-pkcs12',buffer:Buffer.from('encrypted-a1-fixture')});
 await page.getByLabel('Senha do A1',{exact:true}).fill('new-test-password');
 await page.getByRole('button',{name:'Testar certificado',exact:true}).click();
 await expect(page.getByText('Teste concluído. A configuração ainda não foi salva.')).toBeVisible();
 expect(active).toBe(false);
 await expect(page.getByText('Ainda não salvo',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Validar e salvar',exact:true}).click();
 await expect(page.getByText('Certificado validado e configuração salva.')).toBeVisible();
 expect(active).toBe(true);
 await expect(page.getByRole('heading',{name:'Certificado atual',exact:true})).toBeVisible();
 await expect(page.getByText('Ainda não salvo',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Nenhum arquivo selecionado',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Senha do A1',{exact:true})).toHaveValue('');
 await expect(page.getByText('Renovar certificado A1',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:`/private/tmp/grow-a1-upload-${width}.png`,fullPage:true});
});
