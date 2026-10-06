const {test,expect}=require('@playwright/test');

test('opening a datetime field preserves the saved hour and minute',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('time')).toHaveText('2026-09-19T10:30');
  await page.getByRole('button',{name:'Horário de teste',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Selecionar data'})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('datetime-existing-value.png')});
  await expect.soft(page.getByRole('combobox',{name:'Hora',exact:true})).toContainText('10');
  await expect.soft(page.getByRole('combobox',{name:'Minuto',exact:true})).toContainText('30');
  await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
  await expect(page.getByTestId('time')).toHaveText('2026-09-19T10:30');
  await page.getByRole('button',{name:'Horário de teste',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByTestId('time')).toHaveText('2026-09-19T10:30');
});

test('datetime Apply action stays inside the visible viewport',async({page})=>{
  await page.setViewportSize({width:1280,height:720});
  await page.goto('/');
  await page.getByRole('button',{name:'Horário de teste',exact:true}).click();
  await page.getByRole('combobox',{name:'Hora',exact:true}).click();
  await page.getByRole('option',{name:'09',exact:true}).click();
  const apply=page.getByRole('dialog',{name:'Selecionar data'}).getByRole('button',{name:'Aplicar',exact:true});
  const box=await apply.boundingBox();
  await page.screenshot({path:test.info().outputPath('datetime-apply-bounds.png')});
  expect.soft(box.y).toBeGreaterThanOrEqual(0);
  expect.soft(box.y+box.height).toBeLessThanOrEqual(720);
});


test('datetime seconds survive opening, cancelling and applying',async({page})=>{
  await page.goto('/');
  const opener=page.getByRole('button',{name:'Horário com segundos',exact:true});
  await opener.click();
  await expect(page.getByRole('combobox',{name:'Segundo',exact:true})).toContainText('45');
  await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
  await expect(opener).toBeFocused();
  await expect(page.getByTestId('seconds')).toHaveText('2026-09-19T10:30:45');
  await opener.click();
  await page.getByRole('dialog').getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByTestId('seconds')).toHaveText('2026-09-19T10:30:45');
});
