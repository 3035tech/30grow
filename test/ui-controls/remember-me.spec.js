const {test,expect}=require('@playwright/test');
for(const employee of [false,true])for(const rememberMe of [false,true])test(`${employee?'employee':'manager'} login: remember ${rememberMe}`,async({page},testInfo)=>{
 await page.route('**/api/**',async route=>{
   if(route.request().url().endsWith('/api/auth/session-edge'))return route.fulfill({status:401,json:{ok:false}});
   if(route.request().url().endsWith('/api/auth/employee/session'))return route.fulfill({status:401,json:{}});
   if(employee && rememberMe && route.request().method()==='POST' && !route.request().postDataJSON().pickToken)return route.fulfill({json:{ok:true,needsCompanyPick:true,pickToken:'synthetic-pick',companies:[{candidateId:7,companyId:3,companyName:'Empresa de teste'}]}});
   if(route.request().method()==='POST')return route.fulfill({json:{ok:true,requires2fa:true,challengeToken:'synthetic-challenge'}});
   return route.fulfill({json:{}});
 });
 if(employee)await page.setViewportSize({width:390,height:844});
 await page.goto(employee?'/employee-login':'/login');
 const checkbox=page.getByRole('checkbox',{name:/Lembrar de mim/});
 await expect(checkbox).not.toBeChecked();
 await expect(page.getByText('Até 30 dias neste dispositivo. Use apenas em um dispositivo pessoal.')).toBeVisible();
 if(rememberMe)await checkbox.check();
 await page.getByRole('textbox',{name:/E-mail/i}).fill('synthetic@example.test');
 await page.locator('input[type="password"]').fill('synthetic-test-password');
 await page.screenshot({path:testInfo.outputPath('remember-login.png'),fullPage:true});
 const posted=page.waitForRequest(request=>request.method()==='POST'&&request.url().includes(employee?'/api/auth/employee/login':'/api/auth/login'));
 await page.getByRole('button',{name:/Entrar/}).last().click();
 expect((await posted).postDataJSON().rememberMe).toBe(rememberMe);
 await expect(checkbox).toHaveCount(0);
 if(employee && rememberMe){
   const picked=page.waitForRequest(request=>request.method()==='POST'&&request.url().includes('/api/auth/employee/login'));
   await page.getByRole('button',{name:'Empresa de teste'}).click();
   expect((await picked).postDataJSON()).toMatchObject({rememberMe:true,pickToken:'synthetic-pick',candidateId:7});
 }
});

test('manager with a valid remembered session bypasses the login form',async({page})=>{
 await page.route('**/api/auth/session-edge',route=>route.fulfill({json:{ok:true}}));
 await page.route('**/dashboard**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Dashboard</title>'}));
 await page.goto('/login?redirect=%2Fdashboard%3Ftab%3Dteam');
 await expect(page).toHaveURL(/\/dashboard\?tab=team$/);
});
