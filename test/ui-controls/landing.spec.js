const {test,expect}=require('@playwright/test');

for (const width of [390,768,1440]) {
  test(`landing exposes every module feature without horizontal overflow at ${width}px`,async({page})=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height:960});
    await page.goto('/brand-landing#modulos');
    const modules=page.locator('#modulos');
    await expect(modules.getByRole('article')).toHaveCount(6);
    await expect(modules).toContainText('Organograma com hierarquia');
    await expect(modules).toContainText('Assistente de IA');
    await expect(modules).toContainText('página de carreiras');
    const management=modules.locator('#time');
    await expect(management.getByText(/Plano de sucessão/)).toBeVisible();
    await expect(management.getByText(/Canal de ouvidoria/)).toBeVisible();
    const recruiting=modules.locator('#recrutar');
    const toggle=recruiting.locator('summary');
    const shortlist=recruiting.getByText(/Relatório shortlist/);
    await expect(shortlist).toBeHidden();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(shortlist).toBeVisible();
    await expect(toggle).toHaveAccessibleName('Mostrar menos');
    await page.keyboard.press('Space');
    await expect(shortlist).toBeHidden();
    await expect(toggle).toBeFocused();
    for (const control of await modules.locator('summary').all()) await control.click();
    await expect(management.getByText(/Pesquisa de clima anônima, pulso/)).toBeVisible();
    await expect(modules.locator('#jornada').getByText('Jornada contínua na ficha da pessoa')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await modules.screenshot({path:test.info().outputPath(`modules-expanded-${width}.png`)});
    for (const control of await modules.locator('summary').all()) await control.click();
    await modules.screenshot({path:test.info().outputPath(`modules-collapsed-${width}.png`)});
    expect(errors).toEqual([]);
  });
}

for (const [locale,more,less,title] of [
  ['en','See all features','Show less','Organization and support for managers'],
  ['es-419','Ver todas las funcionalidades','Mostrar menos','Organización y apoyo a la gestión'],
  ['fr-FR','Voir toutes les fonctionnalités','Afficher moins','Organisation et accompagnement des managers'],
  ['de-DE','Alle Funktionen ansehen','Weniger anzeigen','Organisation und Unterstützung für Führungskräfte'],
]) {
  test(`landing feature expansion is translated in ${locale}`,async({page})=>{
    await page.goto(`/brand-landing?lang=${locale}#modulos`);
    const modules=page.locator('#modulos');
    await expect(modules.getByRole('heading',{name:title,exact:true})).toBeVisible();
    const toggle=modules.getByRole('article').first().locator('summary');
    await expect(toggle).toHaveAccessibleName(more);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(less);
    await expect(modules.getByRole('article').first().locator('details')).toHaveAttribute('open','');
  });
}
