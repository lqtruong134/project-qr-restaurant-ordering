import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createDatabase} from '../packages/database/src/index.js';
import {seed,restaurantId} from '../packages/database/src/seed.js';
import {buildApp} from '../apps/api/src/app.js';
import {registerAuth} from '../apps/api/src/auth.js';
const logs:string[]=['# Sprint 1 — Rehearsal evidence',new Date().toISOString(),'Each run creates its own empty database; existing development data is untouched.'];
const admin=createDatabase(process.env.DATABASE_URL!);
try{for(let run=1;run<=2;run++){
 const name='thesis_rehearsal_'+randomBytes(6).toString('hex');const url=new URL(process.env.DATABASE_URL!);url.pathname='/'+name;
 await admin.pool.query('CREATE DATABASE '+name);const db=createDatabase(url.toString());
 try{
  const migrate=()=>{const result=spawnSync('pnpm',['--filter','@thesis/database','exec','prisma','migrate','deploy'],{env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8'});assert.equal(result.status,0,'Migration failed');};
  migrate();const password=randomBytes(24).toString('hex');await seed(db,password);
  const counts=async()=>{const rows=await db.pool.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename");assert.equal(rows.rows.length,14);const result:Record<string,number>={};for(const {tablename} of rows.rows){assert.match(tablename,/^[a-z_]+$/);result[tablename]=Number((await db.pool.query('SELECT count(*) AS n FROM '+tablename)).rows[0].n);}return result;};
  const before=await counts();migrate();await seed(db,password);assert.deepEqual(await counts(),before);
  const app=buildApp(db);await registerAuth(app,db,{secret:randomBytes(48).toString('hex'),restaurantId,origins:['http://localhost:3000'],secure:false});
  try{for(const role of ['staff','kitchen','admin']){
   const login=await app.inject({method:'POST',url:'/auth/login',headers:{origin:'http://localhost:3000','x-csrf-protection':'1'},payload:{username:role,password}});assert.equal(login.statusCode,200);
   const cookie=login.cookies.map(c=>c.name+'='+c.value).join('; ');
   for(const area of ['staff','kitchen','admin'])assert.equal((await app.inject({url:'/workspaces/'+area,headers:{cookie}})).statusCode,area===role?200:403);
  }}finally{await app.close();}
  const sample=await db.prisma.product.findMany({select:{code:true,base_price:true}});assert.equal(sample.length,3);assert.ok(sample.every(p=>p.base_price>=0n));
  logs.push('## Run '+run+' — PASS','- Empty DB migrate: PASS','- Seed twice + migration rerun preserve data: PASS','- Three logins / 3 allow / 6 deny: PASS','- Sample VND query: PASS','```json',JSON.stringify(before,null,2),'```');
  console.log('Rehearsal '+run+': migration, seed, SQL, three-role allow/deny PASS');
 }finally{await db.close();await admin.pool.query('DROP DATABASE '+name+' WITH (FORCE)');}
}}finally{await admin.close();}
mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/rehearsal.md',logs.join('\n')+'\n');
