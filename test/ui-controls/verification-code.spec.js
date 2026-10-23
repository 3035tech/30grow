const {test,expect}=require('@playwright/test');
for(const employee of [false,true])test(`${employee?'employee':'manager'}: six positions advance and submit exactly once`,async({page},testInfo)=>{
 const codes=[];
 await page.route('**/api/**',async route=>{
   if(route.request().url().endsWith('/api/auth/employee/session'))return route.fulfill({status:401,json:{}});
   if(route.request().url().includes('/2fa/verify')){
     codes.push(route.request().postDataJSON().code);
     await new Promise(resolve=>setTimeout(resolve,200));
     return route.fulfill({status:401,json:{errorCode:'TOTP_INVALID',error:'Código inválido'}});
   }
   return route.fulfill({json:route.request().method()==='POST'?{ok:true,requires2fa:true,challengeToken:'synthetic'}:{}});
 });
 if(employee)await page.setViewportSize({width:390,height:844});
 await page.goto(employee?'/employee-login':'/login');
 await page.getByRole('textbox',{name:/E-mail/}).fill('synthetic@example.test');
 await page.locator('input[type="password"]').fill('synthetic-password');
 await page.getByRole('button',{name:/Entrar/}).last().click();
 const group=page.getByRole('group',{name:'Código',exact:true});
 const digits=group.getByRole('textbox');
 await expect(digits).toHaveCount(6);
 await digits.nth(0).focus();
 await digits.nth(0).press('a');
 await expect(digits.nth(0)).toHaveValue('');
 for(let i=0;i<5;i++){
   await digits.nth(i).press(String(i+1));
   await expect(digits.nth(i+1)).toBeFocused();
 }
 await expect.poll(()=>codes.length).toBe(0);
 await digits.nth(5).press('Backspace');
 await expect(digits.nth(4)).toBeFocused();
 await expect(digits.nth(4)).toHaveValue('');
 await digits.nth(4).press('5');
 await page.screenshot({path:testInfo.outputPath('six-digit-code.png'),fullPage:true});
 await digits.nth(5).press('6');
 await expect(digits.nth(5)).toBeDisabled();
 await expect.poll(()=>codes.length).toBe(1);
 expect(codes).toEqual(['123456']);
 await expect(digits.nth(5)).toBeEnabled();
 await expect(digits.nth(0)).toBeFocused();
 for(let i=0;i<6;i++)await expect(digits.nth(i)).toHaveValue('');
 expect(codes).toHaveLength(1);
 // Simulate a paste without touching the user's system clipboard.
 await digits.nth(0).evaluate(element=>{
   const data=new DataTransfer();data.setData('text','654 321');
   element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 });
 await expect.poll(()=>codes.length).toBe(2);
 expect(codes).toEqual(['123456','654321']);
 await expect(digits.nth(5)).toBeEnabled();
 await digits.nth(0).press('ArrowRight');
 await expect(digits.nth(1)).toBeFocused();
});
