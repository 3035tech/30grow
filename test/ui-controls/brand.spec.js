const {test,expect}=require('@playwright/test');
for (const width of [390,768,1440]) {
 test(`30grow identity at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});
  await page.goto('/brand');
  await expect(page.getByRole('heading',{name:'Entrar no 30grow'})).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'Entrar',exact:true})).toHaveCSS('background-color','rgb(21, 128, 61)');
  await expect(page.getByLabel('E-mail')).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if(width>768) {
   await expect(page.locator('.db-sidebar')).toHaveCSS('background-color','rgb(255, 255, 255)');
   await expect(page.locator('.db-sidebar .brand-mark svg').first()).toHaveAttribute('viewBox','0 0 368 114');
   await page.getByRole('button',{name:'Recolher menu',exact:true}).click();
   await expect(page.locator('.db-sidebar')).toHaveCSS('width','64px');
   await expect(page.locator('.db-sidebar .brand-mark svg').first()).toHaveAttribute('viewBox','0 0 140 110');
  }
  if(width<=768) {
   await expect(page.locator('.db-sidebar')).toHaveCSS('box-shadow','none');
   await page.evaluate(()=>document.querySelector('.db-sidebar').classList.add('db-sidebar-open'));
   await page.waitForTimeout(350);
   await expect(page.locator('.db-sidebar')).toHaveCSS('background-color','rgb(255, 255, 255)');
   await page.screenshot({path:test.info().outputPath('drawer-open.png')});
   await page.evaluate(()=>document.querySelector('.db-sidebar').classList.remove('db-sidebar-open'));
   await page.waitForTimeout(350);
  }
  await page.screenshot({path:test.info().outputPath('identity-light.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await expect(page.getByRole('button',{name:'Entrar',exact:true})).toHaveCSS('color','rgb(17, 24, 39)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('identity-dark.png'),fullPage:true});
  await page.goto('/brand-landing');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Pessoas crescem. Empresas vão mais longe.');
  await expect(page.locator('img[src*="landing-people"]')).toHaveCount(0);
  const bars = page.locator('#produto-hero .bg-teal');
  await expect(bars).toHaveCount(9);
  expect(await bars.evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height > 20))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('landing.png'),fullPage:true});
 });
}
