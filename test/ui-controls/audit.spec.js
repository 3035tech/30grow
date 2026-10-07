const { test, expect } = require('@playwright/test');
for (const width of [390,1440]) {
  test(`owner audit is scoped, searchable and exportable at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/dashboard?tab=audit&persona=owner');
    await expect(page.getByRole('heading',{level:1,name:'Auditoria',exact:true})).toBeVisible();
    await expect(page.getByRole('table')).toContainText('dp.profile.updated');
    await expect(page.getByRole('combobox',{name:'Empresa',exact:true})).toHaveCount(0);
    const person=page.getByRole('searchbox',{name:'ID do colaborador',exact:true});
    await person.fill('123'); await person.press('Enter');
    await expect(page).toHaveURL(/auditTargetId=123/);
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Exportar CSV',exact:true}).click();
    expect((await download).suggestedFilename()).toBe('audit.csv');
    await expect(page.getByRole('status').filter({hasText:'5.000'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`owner-audit-${width}.png`),fullPage:true});
  });
}
test('platform admin keeps company selection and HR does not receive audit navigation', async ({page}) => {
  await page.goto('/dashboard?tab=audit&persona=admin');
  await expect(page.getByRole('table')).toContainText('dp.profile.updated');
  await expect(page.getByRole('combobox',{name:'Empresa',exact:true})).toHaveCount(1);
  await expect(page.getByRole('combobox',{name:'Empresa',exact:true})).toBeVisible();
  await page.goto('/dashboard?tab=team&persona=hr');
  await expect(page.locator('#audit-tab')).toHaveCount(0);
});
