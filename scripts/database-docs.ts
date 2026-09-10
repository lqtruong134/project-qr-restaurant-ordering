import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createDatabase} from '../packages/database/src/index.js';
const db=createDatabase(process.env.DATABASE_URL!);
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
try{
 const tables=(await db.pool.query<{name:string;description:string}>(`SELECT c.relname AS name,obj_description(c.oid) AS description FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations' ORDER BY c.relname`)).rows;
 if(tables.length!==14)throw new Error('Expected exactly 14 business tables');
 const md=['# Data Dictionary — Sprint 1','Version: 2026-09-10 · Migration: `202609100001_c0_c1`','Sinh từ PostgreSQL đang chạy, gồm đúng 14 bảng. PK/FK/unique/check ở từng bảng; index bao gồm partial unique. Mọi FK RESTRICT, mọi thời gian UTC (timestamptz). Trigger tự cập nhật updated_at; trigger app_user_revoke thu hồi phiên khi đổi mật khẩu/trạng thái. Prisma schema quản lý cấu trúc; SQL migration quản lý thêm partial index, check, comment và trigger.'];
 const dot=['digraph ERD {','graph [rankdir=LR,bgcolor="#f7f9f5",pad="0.5",nodesep="0.55",ranksep="1.3",label="SPRINT 1 • PHYSICAL ERD • 14 TABLES\nPostgreSQL · C0 / C1 · 2026-09-10",labelloc=t,fontname="DejaVu Sans",fontsize=22];','node [shape=plain,fontname="DejaVu Sans"];','edge [color="#638478",fontname="DejaVu Sans",fontsize=10];'];
 for(const table of tables){
  const cols=(await db.pool.query<{name:string;type:string;required:boolean;default_value:string|null;description:string|null}>(`SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,pg_get_expr(d.adbin,d.adrelid) default_value,col_description(a.attrelid,a.attnum) description FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE c.oid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[table.name])).rows;
  const constraints=(await db.pool.query<{name:string;type:string;definition:string}>(`SELECT conname name,contype type,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype,conname`,[table.name])).rows;
  const indexes=(await db.pool.query<{indexdef:string}>(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,[table.name])).rows;
  md.push('## '+table.name,table.description,'| Cột | Kiểu | Nullable | Default | Ý nghĩa |','|---|---|---|---|---|');
  for(const c of cols)md.push(`| ${c.name} | ${c.type} | ${c.required?'Không':'Có'} | ${c.default_value??'—'} | ${c.description??'—'} |`);
  md.push('### PK / FK / Unique / Check','```sql',...constraints.map(c=>c.name+': '+c.definition),'```','### Index','```sql',...indexes.map(i=>i.indexdef+';'),'```');
  dot.push(table.name+' [label=<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="5" COLOR="#b7c8bd"><TR><TD COLSPAN="2" BGCOLOR="#21583e"><FONT COLOR="white"><B>'+table.name+'</B></FONT></TD></TR>'+cols.map(c=>'<TR><TD ALIGN="LEFT" BGCOLOR="white">'+esc(c.name)+(c.name==='id'?' [PK]':c.name.endsWith('_id')&&c.name!=='guest_id'?' [FK*]':'')+'</TD><TD ALIGN="LEFT" BGCOLOR="white">'+esc(c.type)+(c.required?'':' ?')+'</TD></TR>').join('')+'</TABLE>>];');
  const fks=(await db.pool.query<{target:string;definition:string}>(`SELECT confrelid::regclass::text target,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'`,[table.name])).rows;
  for(const fk of fks)dot.push(fk.target+' -> '+table.name+' [label="'+(table.name==='session_cart'?'1 → 0..1':'1 → 0..N')+'",tooltip="'+esc(fk.definition)+'"];');
 }
 dot.push('legend [label="? nullable · FK* see connector (guest_id is opaque, not FK)\nPartial unique: active QR/table; open session/table; active role/user\nHistory remains 1:N; cart is at most one per session",shape=box,color="#b7c8bd",fontname="DejaVu Sans",fontsize=12];','}');
 writeFileSync('docs/database/data-dictionary.md',md.join('\n')+'\n');
 writeFileSync('docs/database/physical.dot',dot.join('\n'));
 execFileSync('dot',['-Tsvg','docs/database/physical.dot','-o','docs/database/physical.svg']);
 execFileSync('dot',['-Tpng','-Gdpi=90','docs/database/physical.dot','-o','docs/database/physical.png']);
 console.log('Exported Data Dictionary and physical ERD from 14 live tables.');
}finally{await db.close();}
