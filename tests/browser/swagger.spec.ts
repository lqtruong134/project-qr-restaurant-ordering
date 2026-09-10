import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
test('Swagger Execute uses real cookie auth: 401, login, 200, 403, refresh, logout',async({page},info)=>{
 test.skip(info.project.name==='mobile','Detailed API demo is validated on desktop.');
 await page.goto('/api-docs');const frame=page.frameLocator('iframe');
 await expect(frame.getByRole('heading',{name:'Demo API · Sprint 1'})).toBeVisible();
 async function execute(id:string,status:number,edit?:()=>Promise<void>){
  const op=frame.locator('.opblock[id$="-'+id+'"]');
  if(!await op.locator('.opblock-body').isVisible())await op.locator('.opblock-summary').click();
  const tryButton=op.getByRole('button',{name:'Try it out'});if(!await op.getByRole('button',{name:'Execute',exact:true}).isVisible())await tryButton.click();
  if(edit)await edit();await op.getByRole('button',{name:'Execute',exact:true}).click();
  await expect(op.locator('.responses-inner .live-responses-table .response-col_status:not(.col_header)')).toHaveText(String(status));
 }
 await execute('ready',200);await execute('logout',204);await execute('me',401);
 const login=frame.locator('.opblock[id$="-login"]');
 await execute('login',401,async()=>{await login.locator('textarea').fill(JSON.stringify({username:'staff',password:'incorrect-demo-password'}));});
 await execute('login',200,async()=>{await login.locator('textarea').fill(JSON.stringify({username:'staff',password:process.env.SEED_PASSWORD}));});
 await login.locator('textarea').fill(JSON.stringify({username:'staff',password:'(đã ẩn)'}));
 await execute('workspace',200);
 const workspace=frame.locator('.opblock[id$="-workspace"]');
 await execute('workspace',403,async()=>{await workspace.locator('select').first().selectOption('admin');});
 await execute('refresh',200);await execute('logout',204);await execute('me',401);
 await page.screenshot({path:info.outputPath('swagger.png'),fullPage:true});
});
