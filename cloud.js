const $=id=>document.getElementById(id);
const lock=$('cloudLock'),status=$('cloudStatus');
const baseRoster=structuredClone(DEFAULT_ROSTER);
let syncing=false,editing=false,loaded=false,seen='';
const api=async(path,options={})=>{
 const res=await fetch('/api/'+path,{credentials:'same-origin',cache:'no-store',...options});
 const body=await res.json().catch(()=>({error:'서버 응답을 읽지 못했습니다.'}));
 if(!res.ok)throw Object.assign(Error(body.error||'요청 실패'),{status:res.status});return body;
};
const post=(path,data)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
function changesBetween(before,after){
 const changes=[];
 const old=new Map(before.roster.map(p=>[p.id,p]));const now=new Map(after.roster.map(p=>[p.id,p]));
 for(const [id,p] of now){const prior=old.get(id);if(!prior)changes.push({type:'roster',action:'add',id,name:p.name});else{
  if(p.name!==prior.name)changes.push({type:'roster',action:'rename',id,name:p.name});
  if(!!p.lunchExempt!==!!prior.lunchExempt)changes.push({type:'roster',action:'exempt',id,value:!!p.lunchExempt});
 }}
 for(const id of old.keys())if(!now.has(id))changes.push({type:'roster',action:'delete',id});
 for(const field of ['off','early','lunchDone','dinnerNo','attendance']){
  const oldSet=new Set(before.daily[field]||[]),newSet=new Set(after.daily[field]||[]);
  for(const id of new Set([...oldSet,...newSet]))if(oldSet.has(id)!==newSet.has(id))changes.push({type:'status',field,id,value:newSet.has(id)});
 }
 const oldDep=new Map((before.daily.lunchDepartures||[]).map(x=>[x.id,x]));
 const newDep=new Map((after.daily.lunchDepartures||[]).map(x=>[x.id,x]));
 for(const id of new Set([...oldDep.keys(),...newDep.keys()]))if(oldDep.has(id)!==newDep.has(id))changes.push({type:'departure',id,value:newDep.has(id)});
 return changes;
}
window.computeChanges=changesBetween;
function project(events,today){
 const persons=new Map(baseRoster.map(p=>[p.id,{...p}]));
 const days=new Map();const history=new Map();
 const getDay=day=>{if(!days.has(day))days.set(day,{date:day,attendance:[],off:[],early:[],lunchDone:[],lunchDepartures:[],dinnerNo:[],undo:null});return days.get(day)};
 for(const event of events){
  const d=getDay(event.day);
  for(const c of event.changes||[]){
   if(c.type==='roster'){
    if(c.action==='add')persons.set(c.id,{id:c.id,name:c.name,lunchExempt:false});
    else if(c.action==='delete')persons.delete(c.id);
    else if(c.action==='rename'&&persons.has(c.id))persons.get(c.id).name=c.name;
    else if(c.action==='exempt'&&persons.has(c.id))persons.get(c.id).lunchExempt=c.value;
   }else if(c.type==='status'){
    const arr=d[c.field];if(!Array.isArray(arr))continue;
    d[c.field]=arr.filter(x=>x!==c.id);if(c.value)d[c.field].push(c.id);
   }else if(c.type==='departure'){
    d.lunchDepartures=d.lunchDepartures.filter(x=>x.id!==c.id);
    if(c.value)d.lunchDepartures.push({id:c.id,name:persons.get(c.id)?.name||'',at:event.at});
   }
  }
 }
 const yesterday=new Date(`${today}T12:00:00+09:00`);yesterday.setDate(yesterday.getDate()-1);
 const yesterdayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(yesterday);
 const hist=[...days.values()].filter(x=>x.date!==today).map(x=>({date:x.date,lunchDepartures:x.lunchDepartures}));
 return {roster:[...persons.values()],daily:getDay(today),history:hist,today,yesterdayKey};
}
async function refresh(){
 if(syncing||editing)return;syncing=true;
 try{
  const result=await api('state');
  const fingerprint=JSON.stringify(result.events);
  if(fingerprint!==seen||!loaded){
   const state=project(result.events,result.today);
   roster=state.roster;daily=state.daily;window.staffHistory=state.history;
   seen=fingerprint;renderHome();showTab(currentTab);loaded=true;
  }
  lock.classList.add('hidden');window._cloudReady=true;
  status.textContent='● 서버 연결됨';status.style.color='#365e51';
 }catch(err){status.textContent='● 연결 오류';status.style.color='#b65a5c';if(err.status===401){lock.classList.remove('hidden');$('cloudLoginError').textContent='로그인이 필요합니다.';}}
 finally{syncing=false;}
}
let queue=Promise.resolve();
window.sendChanges=changes=>{
 editing=true;status.textContent='● 저장 중';status.style.color='#ad7645';
 queue=queue.then(async()=>{await post('change',{day:daily.date,changes});editing=false;await refresh();}).catch(err=>{editing=false;status.textContent='● 저장 실패';status.style.color='#b65a5c';alert('서버 저장 실패: '+err.message+'\n화면을 다시 불러옵니다.');return refresh();});
};
$('cloudLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{await post('login',{password:$('cloudPassword').value});$('cloudPassword').value='';$('cloudLoginError').textContent='';await refresh();}
 catch(err){$('cloudLoginError').textContent=err.message;}finally{button.disabled=false;}
});
refresh();setInterval(()=>{if(!document.hidden)refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
