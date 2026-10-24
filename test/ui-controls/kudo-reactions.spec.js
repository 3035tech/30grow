const {test,expect}=require('@playwright/test');
test('react, replace, inspect names and remove on mobile without duplicating a kudos',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});let mine=null;const mutations=[];
 await page.route('**/api/employee/kudos/7/reactions*',route=>{
  const req=route.request();
  if(req.method()==='GET')return route.fulfill({json:{ok:true,people:[{emoji:'❤️',fullName:'Ana'},{emoji:'👏',fullName:'Carla'}],hasMore:false}});
  mutations.push(req.method());mine=req.method()==='DELETE'?null:req.postDataJSON().emoji;
  const reactions=[{emoji:'👏',count:2+(mine==='👏'?1:0),mine:mine==='👏'}];if(mine&&mine!=='👏')reactions.push({emoji:mine,count:1,mine:true});
  return route.fulfill({json:{ok:true,reactions}});
 });
 await page.goto('/kudo-reactions');
 await page.getByRole('button',{name:'Reagir',exact:true}).click();await page.getByRole('button',{name:'Amei',exact:true}).click();
 await expect(page.getByRole('button',{name:'Amei · 1'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Ver quem reagiu',exact:true}).click();await expect(page.getByText('❤️ Ana',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Aplausos · 2'}).click();await expect(page.getByRole('button',{name:'Amei · 1'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Aplausos · 3'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Aplausos · 3'}).click();await expect(page.getByRole('button',{name:'Aplausos · 2'})).toHaveAttribute('aria-pressed','false');
 expect(mutations).toEqual(['PUT','PUT','DELETE']);
 await page.getByRole('button',{name:'Reagir',exact:true}).click();
 await expect(page.getByRole('group',{name:'Escolher reação'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('kudo-reactions.png'),fullPage:true});
});
test('failed mutation preserves counts and permits an explicit retry',async({page})=>{
 let calls=0;await page.route('**/api/employee/kudos/7/reactions',route=>{
  calls++;if(calls===1)return route.fulfill({status:503,json:{ok:false}});
  return route.fulfill({json:{ok:true,reactions:[{emoji:'👏',count:3,mine:true}]}});
 });
 await page.goto('/kudo-reactions');await page.getByRole('button',{name:'Aplausos · 2'}).click();
 await expect(page.getByText('Não foi possível atualizar as reações. Tente novamente.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Aplausos · 2'})).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Aplausos · 2'}).click();await expect(page.getByRole('button',{name:'Aplausos · 3'})).toHaveAttribute('aria-pressed','true');expect(calls).toBe(2);
});
