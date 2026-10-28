import { getStore } from '@netlify/blobs';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
const secret=()=>process.env.STAFF_SESSION_SECRET;
const password=()=>process.env.STAFF_PASSWORD;
const sign=s=>createHmac('sha256',secret()).update(s).digest('hex');
const valid=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
const cookie=req=>(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('staff_session='))?.split('=')[1]||'';
function authorized(req){const [exp,sig]=cookie(req).split('.');return !!exp&&/^\d+$/.test(exp)&&Number(exp)>Date.now()&&valid(sig,sign(exp));}
const kstDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const allowed=['off','early','lunchDone','dinnerNo','attendance'];
function validateChanges(changes){
 if(!Array.isArray(changes)||changes.length>100)throw Error('잘못된 변경 요청');
 for(const c of changes){
  if(!c||typeof c!=='object'||!['status','roster','departure','restore'].includes(c.type))throw Error('잘못된 변경 유형');
  if(c.type==='status'&&(!allowed.includes(c.field)||typeof c.id!=='string'||c.id.length>90||typeof c.value!=='boolean'))throw Error('잘못된 상태 변경');
  if(c.type==='roster'&&(!['add','rename','delete','exempt'].includes(c.action)||typeof c.id!=='string'||c.id.length>90||(c.name!==undefined&&(typeof c.name!=='string'||c.name.length>30))||(c.action==='exempt'&&typeof c.value!=='boolean')))throw Error('잘못된 명부 변경');
  if(c.type==='departure'&&(typeof c.id!=='string'||c.id.length>90||typeof c.value!=='boolean'))throw Error('잘못된 출발 기록');
  if(c.type==='restore')throw Error('전체 데이터 교체는 서버 모드에서 지원하지 않습니다.');
 }
}
export default async (req)=>{
 try{
  if(!password()||!secret()||secret().length<32)return json({error:'Netlify 환경 변수 STAFF_PASSWORD, STAFF_SESSION_SECRET 설정이 필요합니다.'},503);
  const path=new URL(req.url).pathname.replace(/^.*\/api\/?/,'').replace(/^.*\/functions\/api\/?/,'');
  if(path==='login'&&req.method==='POST'){
   const data=await req.json();if(typeof data.password!=='string'||!valid(data.password,password()))return json({error:'비밀번호가 올바르지 않습니다.'},401);
   const exp=String(Date.now()+7*86400000);return json({ok:true},200,{'set-cookie':`staff_session=${exp}.${sign(exp)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`});
  }
  if(path==='logout'&&req.method==='POST')return json({ok:true},200,{'set-cookie':'staff_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
  if(!authorized(req))return json({error:'로그인이 필요합니다.'},401);
  const store=getStore({name:'staff-events-v1',consistency:'strong'});
  if(path==='state'&&req.method==='GET'){
   const today=kstDay();
   const keys=[];let cursor;
   do {
    const page=await store.list({prefix:'events/',...(cursor?{cursor}:{})});
    keys.push(...page.blobs.map(b=>b.key));
    cursor=page.cursor;
   } while(cursor);
   const events=(await Promise.all(keys.map(k=>store.get(k,{type:'json',consistency:'strong'})))).filter(Boolean);
   events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
   return json({today,events});
  }
  if(path==='change'&&req.method==='POST'){
   const body=await req.json();validateChanges(body.changes);
   const today=kstDay();if(body.day!==today)return json({error:'날짜가 변경되었습니다. 새로고침 후 다시 시도하세요.'},409);
   if(!body.changes.length)return json({ok:true});
   const id=randomUUID();const event={id,at:new Date().toISOString(),day:today,changes:body.changes};
   await store.setJSON(`events/${today}/${id}`,event,{onlyIfNew:true});
   return json({ok:true,event});
  }
  return json({error:'지원하지 않는 요청입니다.'},404);
 }catch(e){console.error(e);return json({error:'서버 처리 중 오류가 발생했습니다.'},500)}
};
