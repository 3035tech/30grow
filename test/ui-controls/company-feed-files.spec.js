const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64');
test('publish files, retry without duplicate notice or attachment, and view private previews',async({page},testInfo)=>{
 let posts=[],created=0,patched=0,attempts=0;const uploaded=new Map();
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.pathname.endsWith('/kudos'))return route.fulfill({json:{ok:true,kudos:[],total:0}});
  if(method==='POST'&&url.pathname.endsWith('/posts')){created++;const body=request.postDataJSON();posts=[{id:5,title:body.title,bodyHtml:body.bodyHtml,attachments:[],createdAt:'2026-10-23T12:00:00Z'}];return route.fulfill({status:201,json:{ok:true,post:posts[0]}});}
  if(method==='PATCH'){patched++;return route.fulfill({json:{ok:true,post:posts[0]}});}
  if(method==='POST'&&url.pathname.endsWith('/attachments')){
   attempts++;const key=url.searchParams.get('uploadId');expect(key).toMatch(/^[0-9a-f-]{36}$/);
   if(!uploaded.has(key)){const form=await new Response(request.postDataBuffer(),{headers:{'Content-Type':request.headers()['content-type']}}).formData();const file=form.get('file');const item={id:10+uploaded.size,postId:5,fileName:file.name,contentType:file.type,byteSize:file.size};uploaded.set(key,item);posts[0].attachments.push(item);}
   if(attempts===1)return route.fulfill({status:503,json:{error:'Falha simulada'}});
   return route.fulfill({status:201,json:{ok:true,attachment:uploaded.get(key)}});
  }
  if(method==='GET'&&url.pathname.includes('/attachments/'))return route.fulfill({contentType:'image/png',body:png});
  return route.fulfill({json:{ok:true,posts,total:posts.length}});
 });
 await page.goto('/company-feed');
 await page.getByRole('button',{name:/Novo aviso/}).first().click();
 const dialog=page.getByRole('dialog',{name:'Novo aviso'});
 await dialog.getByRole('textbox',{name:'Título',exact:true}).fill('Comunicado da empresa');
 await dialog.getByLabel('Adicionar arquivos').setInputFiles([{name:'foto.png',mimeType:'image/png',buffer:png},{name:'politica.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')}]);
 await dialog.getByRole('button',{name:'Publicar',exact:true}).click();
 await expect(dialog.getByText(/O aviso foi salvo, mas um arquivo/)).toBeVisible();
 expect(created).toBe(1);
 await dialog.getByRole('button',{name:'Publicar',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(created).toBe(1);expect(patched).toBe(1);expect(uploaded.size).toBe(2);expect(attempts).toBe(3);
 const row=page.getByRole('row').filter({hasText:'Comunicado da empresa'});
 await row.getByRole('button',{name:/Ver/}).click();
 const view=page.getByRole('dialog',{name:'Comunicado da empresa'});
 await expect(view.getByText('foto.png',{exact:true})).toBeVisible();await expect(view.getByText('politica.pdf',{exact:true})).toBeVisible();
 await expect(view.getByRole('link',{name:'Baixar arquivo'}).first()).toHaveAttribute('href',/\/api\/admin\/company-feed\/posts\/5\/attachments\/10\?companyId=1/);
 await expect(view.getByRole('img',{name:'foto.png'})).toHaveAttribute('src',/preview=1/);
 await page.screenshot({path:testInfo.outputPath('notice-attachments.png'),fullPage:true});
});

test('limits and pending-file removal are clear on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/**',route=>route.fulfill({json:{ok:true,posts:[],kudos:[],total:0}}));
 await page.goto('/company-feed');await page.getByRole('button',{name:/Novo aviso/}).first().click();
 const dialog=page.getByRole('dialog',{name:'Novo aviso'}),input=dialog.getByLabel('Adicionar arquivos');
 await input.setInputFiles(Array.from({length:6},(_,i)=>({name:`file-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('test')})));
 await expect(dialog.getByRole('alert')).toContainText('até 5 anexos');
 await input.setInputFiles({name:'foto.png',mimeType:'image/png',buffer:png});
 await expect(dialog.getByText('foto.png',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Remover foto.png',exact:true}).click();
 await expect(dialog.getByText('foto.png',{exact:true})).toHaveCount(0);
});
