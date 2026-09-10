import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
 const secret = randomBytes(24).toString('hex');
 writeFileSync('.env', readFileSync('.env.example', 'utf8').replaceAll('CHANGE_ME', secret), {mode:0o600,flag:'wx'});
}
let content = readFileSync('.env','utf8');
for (const [name,value] of Object.entries({ AUTH_SECRET:randomBytes(48).toString('hex'),
 SEED_PASSWORD:randomBytes(18).toString('base64url'), APP_ORIGINS:'http://localhost:3000,http://127.0.0.1:3000',
 RESTAURANT_ID:'10000000-0000-4000-8000-000000000001', LOGIN_LIMIT:'5' })) {
 if (!new RegExp('^'+name+'=','m').test(content)) content += '\n'+name+'='+value+'\n';
}
writeFileSync('.env',content,{mode:0o600}); chmodSync('.env',0o600);
console.log('Local environment ready. Existing settings preserved; secrets are not displayed.');
