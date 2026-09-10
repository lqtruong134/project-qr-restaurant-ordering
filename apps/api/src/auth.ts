import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import { SignJWT, jwtVerify } from 'jose';
import { hash, verify, argon2id, type Database } from '@thesis/database';
import type { FastifyInstance, FastifyReply } from 'fastify';
export interface AuthOptions { secret:string; restaurantId:string; origins:string[]; secure:boolean; loginLimit?:number; now?:()=>number }
interface Identity { id:string; displayName:string; role:string; permissions:string[]; version:number }
declare module 'fastify' {
 interface FastifyContextConfig { public?:boolean; permission?:string; authenticated?:boolean }
 interface FastifyRequest { identity?:Identity }
}
export function fail(reply:FastifyReply, code:number, errorCode:string, userMessage:string) {
 return reply.code(code).send({errorCode,userMessage,correlationId:reply.request.id});
}
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const invalid=(reply:FastifyReply)=>fail(reply,401,'UNAUTHORIZED','Thông tin đăng nhập không hợp lệ hoặc phiên đã hết hạn.');
export async function registerAuth(app:FastifyInstance, db:Database, options:AuthOptions) {
 if (options.secret.length<64 || !options.origins.length) throw new Error('Auth configuration is incomplete.');
 const key=new TextEncoder().encode(options.secret);
 const now=options.now??Date.now;
 const attempts=new Map<string,{count:number;until:number}>();
 const limit=options.loginLimit??5;
 if (!Number.isInteger(limit)||limit<1) throw new Error('Invalid login limit');
 const dummy=await hash(randomBytes(32),{type:argon2id,memoryCost:19456,timeCost:2,parallelism:1});
 await app.register(cookie);
 const cookieOptions={httpOnly:true,secure:options.secure,sameSite:'strict' as const,path:'/'};
 const clear=(reply:FastifyReply)=>{reply.clearCookie('access',cookieOptions);reply.clearCookie('refresh',cookieOptions);};
 async function identity(userId:string,version:number):Promise<Identity|null> {
  const user=await db.prisma.app_user.findFirst({where:{id:userId,restaurant_id:options.restaurantId,status:'ACTIVE',auth_version:version,restaurant:{status:'ACTIVE'}},include:{user_role:{where:{revoked_at:null},include:{role:{include:{role_permission:{include:{permission:true}}}}}}}});
  if(!user || !user.refresh_expires_at || user.refresh_expires_at.getTime()<=now()) return null;
  const role=user.user_role[0]?.role;
  return {id:user.id,displayName:user.display_name,role:role?.code??'',permissions:role?.role_permission.map(r=>r.permission.code)??[],version:user.auth_version};
 }
 async function issue(reply:FastifyReply,userId:string,version:number,refresh:string,expires:Date) {
  const access=await new SignJWT({v:version}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setIssuer('thesis-api').setAudience('thesis-internal').setIssuedAt(Math.floor(now()/1000)).setExpirationTime(Math.floor(now()/1000)+900).sign(key);
  reply.setCookie('access',access,{...cookieOptions,maxAge:900});
  reply.setCookie('refresh',refresh,{...cookieOptions,maxAge:Math.max(0,Math.floor((expires.getTime()-now())/1000))});
 }
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
   if(!options.origins.includes(request.headers.origin??'') || request.headers['x-csrf-protection']!=='1') return fail(reply,403,'CSRF_REJECTED','Yêu cầu không hợp lệ. Vui lòng tải lại trang.');
  }
 });
 app.addHook('preHandler',async(request,reply)=>{
  const config=request.routeOptions.config;
  if(config.public) return;
  let subject:string|undefined;let version:number|undefined;
  try {
   const token=request.cookies.access;
   if(token){const {payload}=await jwtVerify(token,key,{algorithms:['HS256'],issuer:'thesis-api',audience:'thesis-internal',currentDate:new Date(now())});subject=payload.sub;version=typeof payload.v==='number'?payload.v:undefined;}
  } catch { /* Invalid/expired credentials are indistinguishable. */ }
  if(!subject||version===undefined) return invalid(reply);
  const user=await identity(subject,version);
  if(!user) return invalid(reply);
  request.identity=user;
  if(!config.authenticated && (!config.permission||!user.permissions.includes(config.permission))) return fail(reply,403,'FORBIDDEN','Bạn không có quyền truy cập chức năng này.');
 });
 app.post<{Body:{username:string;password:string}}>('/auth/login',{config:{public:true},schema:{body:{type:'object',additionalProperties:false,required:['username','password'],properties:{username:{type:'string',minLength:3,maxLength:64,pattern:'^[a-zA-Z0-9_.-]+$'},password:{type:'string',minLength:1,maxLength:256}}}}},async(request,reply)=>{
  const username=request.body.username.toLowerCase();
  for(const [key,value] of attempts) if(value.until<=now()) attempts.delete(key);
  const keys=['account:'+username,'ip:'+request.ip];
  if(keys.some(k=>(attempts.get(k)?.count??0)>=limit)||attempts.size>10000) {reply.header('Retry-After','60');return fail(reply,429,'RATE_LIMITED','Bạn thử quá nhiều lần. Vui lòng chờ một phút.');}
  for(const k of keys){const old=attempts.get(k);attempts.set(k,{count:(old?.count??0)+1,until:old?.until??now()+60000});}
  const user=await db.prisma.app_user.findUnique({where:{restaurant_id_username:{restaurant_id:options.restaurantId,username}},include:{restaurant:true}});
  const correct=await verify(user?.password_hash??dummy,request.body.password);
  if(!user||!correct||user.status!=='ACTIVE'||user.restaurant.status!=='ACTIVE') return invalid(reply);
  const refresh=randomBytes(32).toString('base64url');const expires=new Date(now()+7*86400000);
  const changed=await db.prisma.app_user.updateMany({where:{id:user.id,status:'ACTIVE',password_hash:user.password_hash,auth_version:user.auth_version},data:{refresh_token_hash:digest(refresh),refresh_expires_at:expires,auth_version:{increment:1},last_login_at:new Date(now())}});
  if(changed.count!==1) return invalid(reply);
  await issue(reply,user.id,user.auth_version+1,refresh,expires);
  return {user:await identity(user.id,user.auth_version+1)};
 });
 app.post('/auth/refresh',{config:{public:true}},async(request,reply)=>{
  const old=request.cookies.refresh;
  if(!old||old.length>128) {clear(reply);return invalid(reply);}
  const fresh=randomBytes(32).toString('base64url');
  // Atomic rotation: concurrent requests using the same old token cannot both win.
  const rows=await db.pool.query<{id:string;auth_version:number;refresh_expires_at:Date}>(`UPDATE app_user SET refresh_token_hash=$1 WHERE refresh_token_hash=$2 AND status='ACTIVE' AND restaurant_id=$3 AND refresh_expires_at>$4 AND EXISTS (SELECT 1 FROM restaurant WHERE id=$3 AND status='ACTIVE') RETURNING id,auth_version,refresh_expires_at`,[digest(fresh),digest(old),options.restaurantId,new Date(now())]);
  const user=rows.rows[0];if(!user){clear(reply);return invalid(reply);}
  await issue(reply,user.id,user.auth_version,fresh,user.refresh_expires_at);return {status:'ok'};
 });
 app.post('/auth/logout',{config:{public:true}},async(request,reply)=>{
  // Refresh remains usable for logout even when the short access token expired.
  const token=request.cookies.refresh;
  if(token&&token.length<=128) await db.prisma.app_user.updateMany({where:{refresh_token_hash:digest(token),restaurant_id:options.restaurantId},data:{refresh_token_hash:null,refresh_expires_at:null,auth_version:{increment:1}}});
  clear(reply);return reply.code(204).send();
 });
 app.get('/auth/me',{config:{authenticated:true}},async(request)=>({user:request.identity}));
 for(const area of ['staff','kitchen','admin']) app.get('/workspaces/'+area,{config:{permission:area+'.workspace'}},async(request)=>({area,user:request.identity,message:'Bạn đã được cấp quyền truy cập. Chức năng vận hành sẽ được bổ sung trong các Sprint sau.'}));
}
