// 10 (card game) multiplayer server. No dependencies: run with `node server.js`
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,rooms={},BOTS=[['Ava','easy'],['Levi','easy'],['Dax','medium'],['Sarah','hard'],['Danny','easy'],['Addy','hard'],['Nora','medium'],['Findley','expert'],['Addie','medium'],['Hope','hard'],['Ella','impossible'],['Hannah','expert'],['Andrew','expert'],['Greg','unbeatable']].map(([name,lvl])=>({name,lvl}));
const wild=(R,c)=>c.r===10&&!R.tenUsed,pts=c=>c.r===10?15:c.r>=11?10:c.r,rid=()=>Math.random().toString(36).slice(2,10);
const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const vis=p=>[...p.h,...p.b.filter(Boolean)];
const unl=p=>p.m.map((c,i)=>c&&!p.b[i]?i:-1).filter(i=>i>=0);
const topC=R=>R.pile[R.pile.length-1];
const ok=(R,c)=>c.r===10?!R.tenUsed:(!R.pile.length||c.r<=topC(R).r);
const lab=r=>({1:'A',11:'J',12:'Q',13:'K',0:'Joker'}[r]||String(r));
const cnt=(R,r)=>R.pile.filter(c=>c.r===r).length;
const ph=p=>p.h.length?'h':p.b.some(Boolean)?'b':'m',blocked=p=>!!p.tenJust;
const empty=p=>!p.h.length&&!p.b.some(Boolean)&&!p.m.some(Boolean);

function addP(R,name,bot,lvl){const p={id:rid(),vid:rid(),human:!bot,name,bot,lvl:lvl||'medium',host:!R.ps.length&&!bot,tot:0,tenPh:null,tenJust:false,h:[],b:[],m:[]};R.ps.push(p);return p}
// ---- season leaderboard (one season per calendar month, New York time) ----
// Saved to Upstash Redis when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set (survives restarts and redeploys),
// otherwise to lb.json next to this file (lost whenever Render restarts or redeploys the server).
const LBF=typeof __dirname!=='undefined'?path.join(__dirname,'lb.json'):null,UP=typeof process!=='undefined'&&process.env.UPSTASH_REDIS_REST_URL,UT=UP&&process.env.UPSTASH_REDIS_REST_TOKEN;
let LB=null,lbSave=Promise.resolve(),lbErr='',lbOK=false,lbWriteErr='';
const season=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).format(d).slice(0,7);
const UPURL=UP?String(UP).trim().replace(/^["']|["']$/g,'').replace(/\/+$/,''):'',UPTOK=UT?String(UT).trim().replace(/^["']|["']$/g,''):'';
async function up(cmd){if(typeof fetch!=='function')throw new Error('Node on Render is too old (needs 18+): '+process.version);const r=await fetch(UPURL,{signal:AbortSignal.timeout(6000),method:'POST',headers:{authorization:'Bearer '+UPTOK,'content-type':'application/json'},body:JSON.stringify(cmd)});const j=await r.json().catch(()=>({error:'HTTP '+r.status}));if(!r.ok||j.error)throw new Error(j.error||('HTTP '+r.status));return j.result}
async function lbLoad(){
  if(LB&&lbOK)return LB;
  try{
    if(UP){if(!/^https:\/\//.test(UPURL))throw new Error('UPSTASH_REDIS_REST_URL must be the https:// REST URL');const r=await up(['GET','ten:lb']);LB=r?JSON.parse(r):{};try{await up(['SET','ten:ping',String(Date.now())])}catch(e){lbWriteErr='Saving is not allowed with this token ('+e.message+'). Use the main token, not the read-only one.'}}
    else{try{LB=JSON.parse(fs.readFileSync(LBF,'utf8'))}catch(e){LB=LB||{}}}
    lbOK=true;lbErr='';
  }catch(e){lbErr=e.message;console.error('leaderboard load failed:',e.message);LB=LB||{};lbOK=false}
  return LB}
function lbStore(){
  if(!lbOK){console.error('leaderboard not saved: never loaded successfully, refusing to overwrite');return}
  const data=JSON.stringify(LB);
  lbSave=lbSave.then(async()=>{try{if(UP)await up(['SET','ten:lb',data]);else if(LBF)fs.writeFileSync(LBF,data);lbErr='';lbWriteErr=''}catch(e){lbErr=e.message;console.error('leaderboard save failed',e.message)}})}
// ---- usage stats: games and distinct players per day, kept next to the leaderboard ----
let ST=null,stOK=false;const day=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(d);
async function stLoad(){if(ST&&stOK)return ST;try{if(UP){const r=await up(['GET','ten:stats']);ST=r?JSON.parse(r):{}}else{try{ST=JSON.parse(fs.readFileSync(LBF.replace('lb.json','stats.json'),'utf8'))}catch(e){ST=ST||{}}}stOK=true}catch(e){ST=ST||{};stOK=false}return ST}
function stStore(){if(!stOK)return;const data=JSON.stringify(ST);lbSave=lbSave.then(async()=>{try{if(UP)await up(['SET','ten:stats',data]);else if(LBF)fs.writeFileSync(LBF.replace('lb.json','stats.json'),data)}catch(e){}})}
async function stat(R,kind){
  if(!LBF&&!UP||R.coach)return;await stLoad();const k=day(),d=ST[k]||(ST[k]={started:0,finished:0,players:[]});
  d[kind]++;R.ps.forEach(q=>{if(q.human&&!d.players.includes(q.name.toLowerCase()))d.players.push(q.name.toLowerCase())});
  const ks=Object.keys(ST).sort();while(ks.length>120)delete ST[ks.shift()];stStore()}
async function recordGame(R){
  stat(R,'finished');
  if(!LBF&&!UP)return;
  await lbLoad();const s=season(),S=LB[s]||(LB[s]={});const o=R.over,low=Math.min(...R.ps.map(q=>q.tot));
  R.ps.forEach((q,i)=>{
    const top=q.bot&&(q.lvl==='impossible'||q.lvl==='unbeatable');if(!q.human&&!top)return;
    const key=(q.human?'':'bot:')+(q.base||q.name).toLowerCase(),e=S[key]||(S[key]={name:q.human?q.name:(q.base||q.name),bot:!q.human,games:0,wins:0,pts:0,best:null});
    e.name=q.human?q.name:e.name;e.games++;if(o.champs.includes(i))e.wins+=1;e.pts+=q.tot;if(e.best==null||q.tot<e.best)e.best=q.tot});
  const ks=Object.keys(LB).sort();while(ks.length>24)delete LB[ks.shift()];
  lbStore()}
const HCAP=250;
// ---- 2v2 partners: seats 0+2 vs 1+3, so partners take alternate turns ----
const teamsOn=R=>!!R.teams&&R.ps.length===4&&!R.daily&&!R.coach;
const TSIG=['👍 Got it','🔟 I have a 10','🧹 Clear the pile!','🆘 Help, I am stuck','🐢 Go low','💪 Nice one!'];
function deal(R){
  R.hm=0;
  const d=[];for(let k=0;k<Math.max(2,Math.ceil(R.ps.length/2));k++){for(let s=0;s<4;s++)for(let r=1;r<=13;r++)d.push({r,s});}
  shuf(d).forEach((c,i)=>c.id=i);
  const nm=R.small||R.quick?3:4,nh=R.small?5:R.quick?7:11;R.ps.forEach(p=>{p.lm=null;p.m=d.splice(0,nm);p.b=d.splice(0,nm);p.h=d.splice(0,nh)});
  tilt(R,d);R.spare=d;R.ps.forEach(q=>q.swp=0);
  R.round++;R.tenUsed=false;R.draw=null;R.add=null;R.ps.forEach(q=>{q.tenPh=null;q.tenJust=false;q.picked=0;q.ready=false;q.tip=null});
  R.cur=R.start;R.pile=[];R.last=null;R.phase='play';R.over=null;R.msg=R.ps[R.cur].name+' starts the round.';
}
// Greg's built-in luck: swaps a few of Greg's high hand cards for low cards/10s from the unused part of the deck
const SPLIT_PEN=6;
const LUCK_SWAPS=0;
// Greg's ladder: level 1 is fair and quick, level 5 thinks longest and gets the luckiest deals
// q = how often Greg uses his full search instead of a simple 'hard' computer move; luck = lucky-deal swaps
// fair deals at every level: no lucky swaps. Greg still sees everyone's cards when he plans; higher levels make fewer mistakes and think longer
const GL={1:{q:.15,luck:0,ms:500,name:'Rookie'},2:{q:.4,luck:0,ms:600,name:'Shark'},3:{q:.7,luck:0,ms:800,name:'Pro'},4:{q:1,luck:0,ms:1500,name:'Master'},5:{q:1,luck:6,deep:true,rig:.2,ms:2200,name:'Legend'}}; // Legend: a modest deal edge, tuned to win about 80% against an equally skilled player
const gregMax=R=>{const h=R.ps.find(q=>q.host);if(!h||!FU||!FU.x)return 1;const x=FU.x[pkey(h)];return Math.min(5,((x&&x.gl)||0)+1)};
function tilt(R,d){
  // extra 10s: Greg's worst hand cards are swapped for 10s from the unused deck (the only edge in his deal)
  R.ps.forEach(g=>{if(g.lvl!=='unbeatable')return;const n=R.tenN!=null?R.tenN:(g.gl&&GL[g.gl]&&GL[g.gl].ten)||0;
    for(let k=0;k<n;k++){const j=d.findIndex(c=>c.r===10);if(j<0)break;let wi=-1;g.h.forEach((c,i)=>{if(c.r!==10&&(wi<0||c.r>g.h[wi].r))wi=i});if(wi<0)break;const t=g.h[wi];g.h[wi]=d[j];d[j]=t}});
  // low swaps: a few of Greg's highest hand cards are swapped for random low cards (ace to 5) from the unused deck
  R.ps.forEach(g=>{if(g.lvl!=='unbeatable')return;const n=R.lowN!=null?R.lowN:(g.gl&&GL[g.gl]&&GL[g.gl].low)||0;
    for(let k=0;k<n;k++){const lows=[];d.forEach((c,i)=>{if(c.r<=5)lows.push(i)});if(!lows.length)break;const j=lows[Math.random()*lows.length|0];let wi=-1;g.h.forEach((c,i)=>{if(c.r!==10&&c.r>5&&(wi<0||c.r>g.h[wi].r))wi=i});if(wi<0)break;const t=g.h[wi];g.h[wi]=d[j];d[j]=t}});
  R.ps.forEach(g=>{if(g.lvl!=='unbeatable')return;const n=R.luckN!=null?R.luckN:(g.gl?GL[g.gl].luck:LUCK_SWAPS);if(!n)return;
    const mine=[];g.h.forEach((c,i)=>{if(c.r>=11)mine.push({i,r:c.r})});mine.sort((x,y)=>y.r-x.r);
    const spare=[];d.forEach((c,i)=>{if(c.r===10||c.r<=3)spare.push(i)});spare.sort(()=>Math.random()-.5);
    for(let k=0;k<n&&k<mine.length&&k<spare.length;k++){const t=g.h[mine[k].i];g.h[mine[k].i]=d[spare[k]];d[spare[k]]=t}
    // Legend boss: every card he holds is low or a 10 (as far as the unused deck allows)
    const rigP=R.rig!=null?R.rig:(g.gl&&GL[g.gl].rig)||0;if(rigP){
      const lowI=[],tenI=[];d.forEach((c,i)=>{if(c.r===10)tenI.push(i);else if(c.r<=5)lowI.push(i)});lowI.sort(()=>Math.random()-.5);tenI.sort(()=>Math.random()-.5);
      const take=(arr)=>arr.length?arr.shift():null;
      const put=(arr,i,src)=>{const j=take(src);if(j==null)return false;const t=arr[i];arr[i]=d[j];d[j]=t;return true};
      let ft=g.m.filter(c=>c&&c.r===10).length;g.m.forEach((c,i)=>{if(c&&c.r!==10&&Math.random()<rigP){if(ft<1&&tenI.length&&put(g.m,i,tenI))ft++;else put(g.m,i,lowI)}}); // face-down: low cards, at most one 10
      g.b.forEach((c,i)=>{if(c&&c.r>5&&c.r!==10&&Math.random()<rigP)put(g.b,i,lowI)});
      let tens=g.h.filter(c=>c.r===10).length;g.h.forEach((c,i)=>{if(c.r>5&&c.r!==10&&Math.random()<rigP){if(tens<2&&tenI.length&&Math.random()<.3&&put(g.h,i,tenI))tens++;else put(g.h,i,lowI)}});
    }
    // Legend: his face-up face cards and face-down cards get the lucky treatment too
    if(R.deep!=null?R.deep:(g.gl&&GL[g.gl].deep)){
      const sp=[];d.forEach((c,i)=>{if(c.r===10||c.r<=3)sp.push(i)});sp.sort(()=>Math.random()-.5);let k=0;
      const fix=(arr,bad)=>arr.forEach((c,i)=>{if(c&&bad(c)&&k<sp.length){const j=sp[k++];arr[i]=d[j];d[j]=c}});
      fix(g.b,c=>c.r>=11);fix(g.m,c=>c.r>=5&&c.r!==10);fix(g.b,c=>c.r>=8&&c.r!==10);
    }
  });
}
// ===================== fun extras: Greg's trash talk, achievements, rivalries, highlights =====================
const GREG_LINES={
  sweep:["Clean sweep. Thank you.","Swept. You're welcome.","And... gone.","That pile looked heavy anyway."],
  gregpick:["I meant to do that.","Collecting cards. It's a strategy.","Hmm. Noted.","Enjoy it while it lasts."],
  gregout:["Out. Again.","Too easy.","That's how it's done.","Read 'em and weep."],
  humanout:["Lucky... this time.","Beginner's luck.","Enjoy that one. It won't happen often.","Fine. I let you have that."],
  champ:["Game over. I'll be here when you want a rematch.","Undefeated. Mostly.","GG. Better luck next time."],
  lose:["I demand a rematch.","That was a glitch.","Okay, okay. Well played."]
};
const BOT_CHAT=false; // computer players never post in the chat
function gregSay(R,kind,force){
  if(!BOT_CHAT)return;
  const g=R.ps.find(q=>q.bot&&q.lvl==='unbeatable');if(!g||R.coach)return;
  const now=Date.now();if(!force&&(now-(R.gregT||0)<12000||Math.random()>.55))return;R.gregT=now;
  const L=GREG_LINES[kind];const txt=L[Math.random()*L.length|0];
  R.cn=(R.cn||0)+1;(R.chat=R.chat||[]).push({k:'c',txt,who:g.name,pi:R.ps.indexOf(g),at:now,n:R.cn,bot:1});if(R.chat.length>60)R.chat.shift();
}
const ACHNAME={tchamp:'Tournament champion',first:'First game',champ:'Champion',sweep20:'Bulldozer',clean:'Clean hands',blind10:'Blind luck',greg5:'Greg slayer',flawless:'Flawless',comeback:'Comeback kid',steal:'Pickpocket',gl1:'Beat Greg: Rookie',gl2:'Beat Greg: Shark',gl3:'Beat Greg: Pro',gl4:'Beat Greg: Master',gl5:'Beat Greg: Legend'};
const ACH={tchamp:1,first:1,champ:1,sweep20:1,clean:1,blind10:1,greg5:1,flawless:1,comeback:1,steal:1,gl1:1,gl2:1,gl3:1,gl4:1,gl5:1};
const pkey=q=>q.human?(q.base||q.name).toLowerCase():'bot:'+(q.base||q.name).toLowerCase();
// ---- tokens: earned by playing, spent on card swaps in games against computers ----
const TK={start:100,game:10,win:25,daily:15,badge:20,swap:100};
function tkX(k){if(!FU||!fuOK||!k||!FU.a||!FU.a[k])return null;FU.x=FU.x||{};const x=FU.x[k]||(FU.x[k]={b:{},h:{}});if(x.tk==null)x.tk=TK.start;return x}
function tkPing(k){const A=FU&&FU.a&&FU.a[k];if(A&&A.pid&&typeof fsend==='function')setTimeout(()=>{try{fsend(A.pid)}catch(e){}},50)}
function tkAdd(k,n){const x=tkX(k);if(!x)return 0;x.tk=Math.max(0,(x.tk||0)+n);tkPing(k);return n}
// ---- ranked tiers: from the ranked rating, after 3 placement matches. Ratings soften toward 1000 each new month (season). ----
const TIERS=[{id:'bronze',n:'Bronze',ic:'🥉',min:0},{id:'silver',n:'Silver',ic:'🥈',min:950},{id:'gold',n:'Gold',ic:'🥇',min:1050},{id:'plat',n:'Platinum',ic:'💠',min:1150},{id:'dia',n:'Diamond',ic:'💎',min:1250},{id:'slayer',n:'Greg Slayer',ic:'🐉',min:1350}];
function rkSeason(x){if(!x)return;const s=season();if(x.rks===s)return;if(x.rks&&x.rk&&(x.rk.w+x.rk.l)>=3){const t=tierOf(x,1);if(t)(x.rkh=x.rkh||[]).push({s:x.rks,t:t.id})}
  if(x.rks&&x.elo)x.elo=Math.round(1000+(x.elo-1000)/2);if(x.rks)x.rk={w:0,l:0};x.rks=s}
function tierOf(x,any){if(!x||!x.rk||(x.rk.w+x.rk.l)<3||(!any&&x.rks&&x.rks!==season()))return null;const e=x.elo||1000;let t=TIERS[0];for(const T of TIERS)if(e>=T.min)t=T;return t}
const tierK=k=>{const t=FU&&FU.x&&tierOf(FU.x[k]);return t?t.ic+'|'+t.n:''};
// ---- daily streak: finish at least one hand a day (US Eastern days). Freezes cover missed days. ----
const etDay=(t=Date.now())=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const dayN=d=>Math.round(Date.parse(d+'T12:00:00Z')/864e5);
const STK={3:20,7:50,14:100,30:200},FREEZE={cost:75,max:2};
function stkState(x){const st=x&&x.st;if(!st||!st.n)return{n:0,today:false,best:st&&st.best||0,fz:st&&st.fz||0,alive:false};
  const gap=dayN(etDay())-dayN(st.d);return{n:gap-1<=(st.fz||0)?st.n:0,today:gap===0,best:st.best||st.n,fz:st.fz||0,alive:gap-1<=(st.fz||0),risk:gap>=1&&gap-1<=(st.fz||0),lost:gap-1>(st.fz||0)?st.n:0}}
function streakHand(R){if(!FU||!fuOK)return;const today=etDay();
  R.ps.forEach(q=>{if(!q.human||q.left||q.bot)return;const k=pkey(q),x=tkX(k);if(!x)return;const st=x.st||(x.st={d:'',n:0,best:0,fz:0});if(st.d===today)return;
    const gap=st.d?dayN(today)-dayN(st.d):99,used=gap>1&&gap-1<=(st.fz||0)?gap-1:0;
    if(st.d&&(gap===1||used)){st.n++;st.fz-=used}else st.n=1;st.d=today;st.best=Math.max(st.best||0,st.n);st.warn='';
    const bonus=STK[st.n]||(st.n>30&&st.n%30===0?200:0);if(bonus)tkAdd(k,bonus);
    toast(R,q,st.n===1?'🔥 Streak started! Play a hand tomorrow to keep it going.':`🔥 ${st.n}-day streak!${used?` (🧊 ${used} freeze${used>1?'s':''} used)`:''}${bonus?` +${bonus} tokens`:''}`);
    if(bonus)feedAdd(k,`hit a ${st.n}-day streak`,'🔥')});
  fuStore()}
// evening reminder for anyone whose streak (2+ days) ends tonight
function streakNudge(){if(!FU||!fuOK||!FU.x)return;const now=new Date(),h=+now.toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false});if(h<19||h>=21)return;const today=etDay();
  for(const k in FU.x){const x=FU.x[k],st=x.st;if(!st||st.n<2||st.d===today||st.warn===today)continue;if(dayN(today)-dayN(st.d)!==1)continue;st.warn=today;
    if(FU.push&&FU.push[k]&&FU.push[k].length)pushTo(k,{emoji:'🔥',title:`Your ${st.n}-day streak ends tonight`,body:'Play one hand to keep it alive.',url:'/',tag:'streak'})}
  fuStore()}
function tkGame(R){ // finished full game: every person gets tokens, winners get a bonus
  if(!R.over||R.coach||R.daily)return;const tg={};
  R.ps.forEach((q,i)=>{if(!q.human||q.left)return;const n=TK.game+(R.over.champs.includes(i)?TK.win:0);if(tkAdd(pkey(q),n))tg[q.name]=n});
  R.over.tk=tg;fuStore()}
// ---- 10 Wrapped: year in review (home card Dec 1 to Jan 15; /?wrap=1 previews any time) ----
const etYM=()=>{const d=etDay();return[+d.slice(0,4),+d.slice(5,7)]};
const wrapYear=()=>{const [y,m]=etYM();return m===1?y-1:y};
const wrapOpen=()=>{const [,m]=etYM(),d=+etDay().slice(8,10);return m===12||(m===1&&d<=15)};
function yrX(k){const x=tkX(k);if(!x)return null;const y=+etDay().slice(0,4);if(!x.yr||x.yr.y!==y)x.yr={y,c:{},cl:0,big:0,f4:0,t10:0,pk:0,gw:0,gl:0};return x.yr}
function yrMove(p,e){if(!p.human||p.bot)return;const Y=yrX(pkey(p));if(!Y)return;const r=e.cs[0].r;Y.c[r]=(Y.c[r]||0)+e.cs.length;
  if(e.swoop){Y.cl++;Y.big=Math.max(Y.big,e.pre.length+e.cs.length);if(e.w)Y.t10++;else Y.f4++}if(e.bad&&e.up)Y.pk=Math.max(Y.pk,e.up)}
function wrapOf(k){if(!FU||!FU.a||!FU.a[k])return null;const y=wrapYear(),x=(FU.x&&FU.x[k])||{},Y=x.yr&&x.yr.y===y?x.yr:null;
  let games=0,wins=0,bm=null,bmw=0;const all={};
  for(const s in LB||{}){if(!s.startsWith(y+'-'))continue;for(const [kk,e] of Object.entries(LB[s])){if(e.bot)continue;const a=all[kk]||(all[kk]={g:0,w:0});a.g+=e.games;a.w+=e.wins}
    const e=LB[s][k];if(e){games+=e.games;wins+=e.wins;if(e.wins>bmw){bmw=e.wins;bm=s}}}
  const ranked=Object.entries(all).filter(([,a])=>a.g>0).sort((a,b)=>b[1].w-a[1].w),pos=ranked.findIndex(([kk])=>kk===k);
  const top=pos>=0&&ranked.length>=5?Math.max(1,Math.ceil((pos+1)/ranked.length*100)):null;
  const RN={1:'Ace',11:'Jack',12:'Queen',13:'King'},fav=Y&&Object.keys(Y.c).length?Object.entries(Y.c).sort((a,b)=>b[1]-a[1])[0]:null;
  const hs=Object.entries(x.h||{}).filter(([kk,r])=>!kk.startsWith('bot:')&&r.w+r.l>0).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)),rv=hs[0]&&hs[0][1];
  const gr=(x.h||{})['bot:greg'];
  return{y,user:FU.a[k].u,games,wins,top,bestMonth:bm,bestMonthWins:bmw,fav:fav?{r:+fav[0],name:RN[fav[0]]||fav[0],n:fav[1]}:null,
    clears:Y?Y.cl:0,big:Y?Y.big:0,fours:Y?Y.f4:0,tens:Y?Y.t10:0,pickup:Y?Y.pk:0,
    rival:rv?{n:rv.n,w:rv.w,l:rv.l}:null,greg:gr?{w:gr.w,l:gr.l}:null,gregLevel:x.gl||0,
    badges:Object.values(x.b||{}).filter(t=>new Date(t).getFullYear()===y).length,tours:(x.tt||[]).filter(t=>new Date(t.t).getFullYear()===y).length,
    streak:x.st?x.st.best||0:0,tier:tierK(k),elo:x.elo||null,tk:x.tk==null?TK.start:x.tk}}
// ---- Christmas Greg trivia: Dec 1-25, one question a day. Right: +25 tokens. Wrong: the Grinch steals 50. ----
const GRINCH={win:25,steal:50};
const GQ=[
 ['What is the name of the top level on the Greg ladder?',['Legend','Master','Boss','Champion'],0],
 ['How many levels does the Greg ladder have?',['3','4','5','10'],2],
 ['What is level 2 Greg called?',['Rookie','Shark','Pro','Master'],1],
 ['What does Greg know that other players don\'t?',['Everyone\'s cards','The next card in the deck','Your PIN','Nothing, he plays fair'],0],
 ['Starting at which Greg level are token swaps turned off?',['Shark','Pro','Master','Legend'],2],
 ['You beat Greg 3 games in a row. What is his mood?',['Cocky','Sulking','Sleepy','Proud'],1],
 ['How many 10s can Greg play from his hand in one turn?',['One','Two','As many as he has','None'],0],
 ['What is level 1 Greg called?',['Baby Greg','Rookie','Beginner','Newbie'],1],
 ['Which badge do you earn by beating Greg 5 times?',['Pickpocket','Bulldozer','Greg slayer','Flawless'],2],
 ['What is level 3 Greg called?',['Pro','Expert','Shark','Ace'],0],
 ['At which level does Greg get a small edge in his deal?',['Rookie','Pro','Master','Legend'],3],
 ['What is the highest ranked tier called?',['Diamond','Platinum','Greg Slayer','Grandmaster'],2],
 ['Which computer player is rated "impossible", one step below Greg?',['Findley','Ella','Hannah','Nora'],1],
 ['Greg has beaten you 3 games in a row. What is his mood?',['Cocky','Sulking','Fuming','Bored'],0],
 ['How do you unlock the next Greg level?',['Pay 100 tokens','Beat Greg at your highest level','Play 10 games','Ask Greg nicely'],1],
 ['How many decks are used when you play Greg 1v1?',['1','2','3','4'],1],
 ['Which card is wild in Greg\'s favorite game?',['Ace','7','10','King'],2],
 ['What happens when four of the same card are on the pile?',['The pile clears','You pick up the pile','Greg cries','Nothing'],0],
 ['Greg\'s emoji on the home screen is…',['🤖','🧠','👑','🐉'],1],
 ['Which two players do you face in the daily challenge?',['Greg and Ella','Ella and Findley','Ava and Levi','Nora and Addie'],1],
 ['How many moves can a single hand last before it ends automatically?',['100','150','250','No limit'],2],
 ['Which emoji shows up when Greg is sulking?',['😭','😎','😤','😴'],0],
 ['What is the 4th Greg level called?',['Legend','Master','Boss','Shark'],1],
 ['Who is Greg named after?',['The guy who made this game','A famous card shark','A cat','A movie robot'],0],
 ['What does Greg want after you beat him once?',['A nap','Revenge','A hug','Tokens'],1]];
const grDay=()=>{const d=etDay();return{key:d,m:+d.slice(5,7),d:+d.slice(8,10)}};
const grOpen=()=>{const D=grDay();return D.m===12&&D.d<=25};
function grBank(){return[...((FU&&FU.gq)||[]).map(q=>[q.q,q.a,q.c]),...GQ]}
function grQ(dayNum){const B=grBank();return B[(dayNum-1)%B.length]}
function grinchHome(k){if(!grOpen())return null;const D=grDay(),x=(FU.x&&FU.x[k])||{},r=x.gr&&x.gr[D.key];return{day:D.d,done:!!r,ok:r?r.ok:null,score:Object.values(x.gr||{}).filter(v=>v.ok).length}}
// ---- guided first game: finishing the tutorial once pays a welcome bonus ----
const TUT_BONUS=50;
function tutDone(R){const h=R.ps.find(q=>q.human&&!q.bot);if(!h)return;const k=pkey(h),x=tkX(k);if(!x||x.tut)return;x.tut=Date.now();tkAdd(k,TUT_BONUS);toast(R,h,`🎓 Tutorial complete! +${TUT_BONUS} tokens`);R.msg+=` Tutorial complete: +${TUT_BONUS} tokens!`;fuStore()}
// ---- token stakes: in a 1v1 between two people, both put up tokens and the winner takes the pot ----
const STAKES=[0,25,50,100,250];
const stakeable=R=>R.ps.length===2&&R.ps.every(q=>q.human&&!q.bot)&&!R.ranked&&!R.tour&&!R.daily&&!R.slow&&!R.coach;
function stakeStart(R){if(!R.stake)return '';if(!stakeable(R))return 'Token stakes only work in a 1v1 between two people. Set stakes to 0 to play anyway.';
  if(!FU||!fuOK)return 'Tokens can\'t be saved right now. Set stakes to 0 or try again in a minute.';
  for(const q of R.ps){const x=tkX(pkey(q));if(!x)return `${q.name} needs a profile to play for tokens.`;if(!(R.stakeOk||{})[pkey(q)])return `Waiting for ${q.name} to accept the stakes.`;if((x.tk||0)<R.stake)return `${q.name} doesn't have ${R.stake} tokens.`}
  R.stakeP=R.ps.map(pkey);R.stakeP.forEach(k=>tkAdd(k,-R.stake));R.pot=R.stake*2;fuStore();return ''}
function stakePay(R,winKeys,why){if(!R.pot||!R.stakeP)return;const pot=R.pot;R.pot=0;
  if(winKeys.length===1){tkAdd(winKeys[0],pot);const q=R.ps.find(x=>pkey(x)===winKeys[0]);if(q)toast(R,q,`🪙 You won the pot: +${pot} tokens!`);if(R.over)R.over.pot={w:q?q.name:'',n:pot};feedAdd(winKeys[0],`won ${pot} tokens in a 1v1`,'🪙')}
  else{R.stakeP.forEach(k=>tkAdd(k,pot/2));if(R.over)R.over.pot={tie:1,n:pot}}
  if(why)R.msg+=' '+why;fuStore()}
const swapOK=(R,p)=>!!p&&p.human&&!p.bot&&!p.left&&!R.daily&&!R.tour&&!R.coach&&!otherPeople(R,p)&&!R.ps.some(q=>q.bot&&q.lvl==='unbeatable'&&(q.gl||3)>=4); // no swaps against Master or Legend Greg
// ---- weekly missions (same three for everyone each week) ----
const MPOOL=[
 {id:'games3',k:'games',n:3,tk:40,txt:'Finish 3 games'},{id:'games6',k:'games',n:6,tk:80,txt:'Finish 6 games'},
 {id:'wins2',k:'wins',n:2,tk:60,txt:'Win 2 games'},{id:'wins4',k:'wins',n:4,tk:100,txt:'Win 4 games'},
 {id:'greg1',k:'greg',n:1,tk:50,txt:'Beat Greg in a full game'},{id:'gregpro',k:'gregpro',n:1,tk:120,txt:'Beat Greg on Pro or higher'},
 {id:'four3',k:'four',n:3,tk:60,txt:'Clear the pile with four of a kind 3 times'},{id:'four6',k:'four',n:6,tk:100,txt:'Clear the pile with four of a kind 6 times'},
 {id:'clean2',k:'clean',n:2,tk:70,txt:'Go out twice without picking up that hand'},{id:'friends2',k:'friends',n:2,tk:70,txt:'Finish 2 games with friends'},
 {id:'daily3',k:'daily',n:3,tk:60,txt:'Play the daily challenge 3 times'},{id:'blitz1',k:'blitz',n:1,tk:50,txt:'Finish a Blitz game'},
 {id:'ranked2',k:'ranked',n:2,tk:80,txt:'Play 2 ranked matches'},{id:'sweep1',k:'sweep',n:1,tk:60,txt:'Clear a pile of 12 or more cards'},
 {id:'tens5',k:'tens',n:5,tk:50,txt:'Clear the pile with a 10 five times'}];
function wkKey(t){const d=new Date(t||Date.now());const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10)}
function wkMissions(wk){const w=wk||wkKey();let h=0;for(const ch of w)h=(h*31+ch.charCodeAt(0))>>>0;const pool=MPOOL.slice(),out=[];
  const core=pool.filter(m=>m.k==='games'||m.k==='wins');h=(h*1103515245+12345)>>>0;out.push(core[(h>>>16)%core.length]);
  while(out.length<3&&pool.length){h=(h*1103515245+12345)>>>0;const m=pool.splice((h>>>16)%pool.length,1)[0];if(out.some(o=>o.k===m.k||(o.k==='games'&&m.k==='wins')||(o.k==='wins'&&m.k==='games')))continue;out.push(m)}return out}
// ---- seasonal events: one limited card back per month ----
const EVENTS={1:{id:'frost',name:'Frost',ic:'❄️',k:'games',n:10,txt:'Finish 10 games in January'},2:{id:'hearts',name:'Hearts',ic:'💘',k:'wins',n:3,txt:'Win 3 games in February'},
 3:{id:'clover',name:'Lucky Clover',ic:'🍀',k:'four',n:5,txt:'Clear 5 piles with four of a kind in March'},4:{id:'bloom',name:'Bloom',ic:'🌸',k:'games',n:8,txt:'Finish 8 games in April'},
 5:{id:'garden',name:'Butterfly',ic:'🦋',k:'wins',n:4,txt:'Win 4 games in May'},6:{id:'summer',name:'Sunburst',ic:'☀️',k:'daily',n:5,txt:'Play 5 daily challenges in June'},
 7:{id:'stars',name:'Fireworks',ic:'🎆',k:'wins',n:5,txt:'Win 5 games in July'},8:{id:'wave',name:'Wave',ic:'🌊',k:'four',n:6,txt:'Clear 6 piles with four of a kind in August'},
 9:{id:'harvest',name:'Harvest',ic:'🌾',k:'games',n:10,txt:'Finish 10 games in September'},10:{id:'haunted',name:'Haunted',ic:'🦇',k:'wins',n:3,txt:'Win 3 games in October'},
 11:{id:'ember',name:'Ember',ic:'🍁',k:'games',n:8,txt:'Finish 8 games in November'},12:{id:'holly',name:'Holly',ic:'🎄',k:'wins',n:5,txt:'Win 5 games in December'}};
const evNow=()=>{const d=new Date();return Object.assign({key:d.getUTCFullYear()+'-'+(d.getUTCMonth()+1)},EVENTS[d.getUTCMonth()+1])};
// ---- friend activity feed ----
function feedAdd(k,txt,ic){if(!FU||!fuOK||!k||!FU.a||!FU.a[k])return;FU.feed=FU.feed||[];FU.feed.push({t:Date.now(),k,u:FU.a[k].u,txt,ic:ic||'⭐'});if(FU.feed.length>300)FU.feed.splice(0,FU.feed.length-300);fuStore()}
// counts an activity toward this week's missions and this month's event; R (optional) gets a toast for the player
function prog(R,q,kind,n){
  if(!q||!q.human||!FU||!fuOK)return;const k=pkey(q);if(!FU.a||!FU.a[k])return;FU.x=FU.x||{};const x=FU.x[k]||(FU.x[k]={b:{},h:{}});n=n||1;
  const wk=wkKey();if(!x.ms||x.ms.wk!==wk)x.ms={wk,p:{},c:{}};
  for(const m of wkMissions(wk)){if(m.k!==kind||x.ms.c[m.id])continue;x.ms.p[m.id]=Math.min(m.n,(x.ms.p[m.id]||0)+n);
    if(x.ms.p[m.id]>=m.n){x.ms.c[m.id]=1;if(x.tk==null)x.tk=TK.start;x.tk+=m.tk;tkPing(k);toast(R,q,`🎯 Mission complete: ${m.txt}. +${m.tk} tokens!`);feedAdd(k,'completed a weekly mission: '+m.txt,'🎯')}}
  const E=evNow();if(E.id&&E.k===kind){x.ev=x.ev||{};const e=x.ev[E.key]||(x.ev[E.key]={n:0});x.backs=x.backs||{};
    if(!x.backs[E.id]){e.n=Math.min(E.n,e.n+n);if(e.n>=E.n){x.backs[E.id]=Date.now();toast(R,q,`${E.ic} You unlocked the ${E.name} card back! Equip it on your profile.`);feedAdd(k,`unlocked the limited ${E.name} card back`,E.ic)}}}
  fuStore()}
function toast(R,q,txt){if(!R||!R.clients)return;R.tn=(R.tn||0)+1;(R.toasts=R.toasts||[]).push({n:R.tn,pi:R.ps.indexOf(q),txt});if(R.toasts.length>10)R.toasts.shift()}
// ---- Greg's mood: how he feels about you, from your recent full games against him ----
function gregMood(k){const x=FU&&FU.x&&FU.x[k],g=(x&&x.gm)||[];if(!g.length)return{e:'😐',t:'focused',d:"Greg hasn't played you yet."};
  let s=0;const last=g[g.length-1];for(let i=g.length-1;i>=0&&g[i]===last;i--)s++;
  if(last==='W')return s>=3?{e:'😎',t:'cocky',d:`Greg has beaten you ${s} games in a row and won't stop talking about it.`}:{e:'😏',t:'smug',d:s>1?`Greg beat you the last ${s} games.`:'Greg beat you last time.'};
  return s>=3?{e:'😭',t:'sulking',d:`You've beaten Greg ${s} times in a row. He's sulking.`}:s===2?{e:'😤',t:'fuming',d:"You've beaten Greg twice in a row. He's fuming."}:{e:'😒',t:'annoyed',d:'You beat Greg last time. He wants revenge.'}}
// ---- everything that happens once when a full game ends ----
const LVN={1:'Rookie',2:'Shark',3:'Pro',4:'Master',5:'Legend'};
function styleSave(R){
  if(!FU||!fuOK)return;R.ps.forEach(q=>{if(!q.human||q.bot||!q.sty)return;const k=pkey(q);if(!FU.a||!FU.a[k])return;FU.x=FU.x||{};const x=FU.x[k]||(FU.x[k]={b:{},h:{}}),o=x.sty||(x.sty={n:0}),m=q.styM||{};
    for(const L of ['n',...STY])o[L]=(o[L]||0)+((q.sty[L]||0)-(m[L]||0));q.styM={...q.sty}});fuStore()}
function ghostStyle(o){if(!o||o.n<8)return null;let best='expert',br=o.expert||0;for(const L of STY)if((o[L]||0)>br+1){best=L;br=o[L]}return best}
function ghostsFor(R){const h=R.ps.find(q=>q.host&&q.human);if(!h||!FU||!FU.a)return [];const k=pkey(h),A=FU.a[k],u=A&&FU.u[A.pid];if(!u)return [];
  const ks=[k,...(u.f||[]).map(p=>FU.u[p]&&FU.u[p].acct).filter(Boolean)];const out=[];
  for(const g of [...new Set(ks)]){const x=FU.x&&FU.x[g],st=ghostStyle(x&&x.sty);if(!st||!FU.a[g])continue;out.push({k:g,name:FU.a[g].u,me:g===k,used:R.ps.some(q=>q.ghost===g)})}return out}
const GHOST_TXT={expert:'plays it straight',flipfirst:'loves flipping face-down cards early',flip3:'flips face-down cards when stuck',low:'gets rid of low cards first',sets:'plays big sets together',dumphigh:'dumps high cards fast'};
const PRED={stake:20};const predMult=R=>Math.min(4,Math.max(2,R.ps.length));
function predPay(R){if(!R.preds||!R.over||!R.over.done)return;const champ=R.over.champs.map(i=>R.ps[i].name);
  for(const [k,pr] of Object.entries(R.preds)){if(pr.paid)continue;pr.paid=true;const ok=champ.includes(pr.pick),win=ok?PRED.stake*predMult(R):0;if(ok)tkAdd(k,win);
    R.stn=(R.stn||0)+1;(R.stoasts=R.stoasts||[]).push({n:R.stn,k,txt:ok?`🔮 You called it! ${pr.pick} won. +${win} tokens.`:`🔮 ${champ.join(' and ')} won. Better luck next time.`});if(ok)feedAdd(k,`called it, predicting ${pr.pick} would win`,'🔮')}
  fuStore()}
function gameDone(R){
  try{predPay(R)}catch(e){console.error('pred',e.message)}
  if(!FU||!fuOK||!R.over||R.coach||R.daily)return;const o=R.over,hum=R.ps.filter(q=>q.human&&!q.left),greg=R.ps.find(q=>q.bot&&q.lvl==='unbeatable'),wn=o.champs.map(i=>R.ps[i]);
  hum.forEach(q=>{const won=wn.includes(q),k=pkey(q);
    prog(R,q,'games');if(won)prog(R,q,'wins');if(hum.length>1)prog(R,q,'friends');if(R.blitz)prog(R,q,'blitz');if(R.ranked)prog(R,q,'ranked');
    if(greg){if(won){prog(R,q,'greg');if((greg.gl||3)>=3)prog(R,q,'gregpro')}
      FU.x=FU.x||{};const x=FU.x[k]||(FU.x[k]={b:{},h:{}});(x.gm=x.gm||[]).push(won?'L':'W');if(x.gm.length>10)x.gm.shift()}
    if(won)feedAdd(k,greg?`beat Greg on ${LVN[greg.gl||3]||'Pro'}`:R.ranked?'won a ranked match':R.tour?'won their tournament table':hum.length>1?`won a game against ${hum.filter(x=>x!==q).map(x=>x.name).join(', ')}`:'won a game',greg?'🧠':R.ranked?'⚡':'🏆')});
  if(R.ranked&&hum.length===2){const [a,b]=hum,ka=pkey(a),kb=pkey(b),xa=FU.x[ka]||(FU.x[ka]={b:{},h:{}}),xb=FU.x[kb]||(FU.x[kb]={b:{},h:{}});rkSeason(xa);rkSeason(xb);const ta=tierOf(xa),tb=tierOf(xb);
    const ra=xa.elo||1000,rb=xb.elo||1000,ea=1/(1+Math.pow(10,(rb-ra)/400)),sa=wn.includes(a)&&!wn.includes(b)?1:wn.includes(b)&&!wn.includes(a)?0:.5,d=Math.round(32*(sa-ea));
    xa.elo=ra+d;xb.elo=rb-d;xa.rk=xa.rk||{w:0,l:0};xb.rk=xb.rk||{w:0,l:0};if(sa===1){xa.rk.w++;xb.rk.l++}else if(sa===0){xa.rk.l++;xb.rk.w++}
    o.elo={[a.name]:{r:xa.elo,d},[b.name]:{r:xb.elo,d:-d}};toast(R,a,`⚡ Rating ${d>=0?'+':''}${d} (now ${xa.elo})`);toast(R,b,`⚡ Rating ${-d>=0?'+':''}${-d} (now ${xb.elo})`);
    [[a,ka,xa,ta],[b,kb,xb,tb]].forEach(([q,k,x,t0])=>{const t=tierOf(x);if(!t)return;const up=!t0||TIERS.findIndex(T=>T.id===t.id)>TIERS.findIndex(T=>T.id===t0.id),dn=t0&&TIERS.findIndex(T=>T.id===t.id)<TIERS.findIndex(T=>T.id===t0.id);
      if(!t0){toast(R,q,`${t.ic} Placed in ${t.n}!`);feedAdd(k,`was placed in ${t.n}`,t.ic)}else if(up){toast(R,q,`${t.ic} Promoted to ${t.n}!`);feedAdd(k,`reached ${t.n} in ranked`,t.ic)}else if(dn)toast(R,q,`${t.ic} Dropped to ${t.n}`)});
    o.tiers={[a.name]:tierK(ka),[b.name]:tierK(kb)}}
  fuStore()}
function award(R,q,id){
  if(!q.human||!ACH[id]||!FU||!fuOK)return;FU.x=FU.x||{};const k=pkey(q),x=FU.x[k]||(FU.x[k]={b:{},h:{}});x.b=x.b||{};
  if(x.b[id])return;x.b[id]=Date.now();if(x.tk==null)x.tk=TK.start;x.tk+=TK.badge;fuStore();tkPing(k);if(R&&R.clients)feedAdd(k,'earned the '+(ACHNAME[id]||id)+' badge','🏅');
  R.an=(R.an||0)+1;(R.ach=R.ach||[]).push({n:R.an,pi:R.ps.indexOf(q),name:q.name,id});if(R.ach.length>20)R.ach.shift();
}
function highlight(R,title,by){R.hl=R.hl||[];if(R.hl.length>=8)R.hl.shift();R.hl.push({title,by,round:R.round,steps:JSON.parse(JSON.stringify((R.rb||[]).slice(-4)))})}
function moveEvents(R,p,e){
  const {cs,pre,swoop,w,bad,up,fromM,msg}=e;
  (R.rb=R.rb||[]).push({who:p.name,pi:R.ps.indexOf(p),cards:cs.map(c=>({r:c.r,s:c.s})),pile:pre.slice(-6).map(c=>({r:c.r,s:c.s})),n:pre.length,msg:msg.slice(p.name.length+1),out:swoop?'swoop':bad?'pickup':'',up});if(R.rb.length>6)R.rb.shift();
  if(up)p.picked=(p.picked||0)+up;
  try{yrMove(p,e)}catch(x){}
  const greg=p.bot&&p.lvl==='unbeatable';
  if(swoop&&!w)prog(R,p,'four');if(swoop&&w)prog(R,p,'tens');if(swoop&&pre.length>=12)prog(R,p,'sweep');
  if(swoop&&pre.length>=20)award(R,p,'sweep20');
  if(swoop&&!w&&up>0)award(R,p,'steal');
  if(swoop&&pre.length>=12)highlight(R,`${p.name} cleared a pile of ${pre.length+cs.length} cards`,p.name);
  else if(swoop&&!w&&up>=4)highlight(R,`${p.name} stole ${up} cards with four of a kind`,p.name);
  else if(bad&&up>=12)highlight(R,`${p.name} picked up ${up} cards. Ouch.`,p.name);
  if(greg&&swoop&&pre.length>=6)gregSay(R,'sweep');
  if(greg&&bad&&up>=6)gregSay(R,'gregpick');
  if(empty(p)&&fromM&&cs[0].r===10)award(R,p,'blind10');
}
// ---- season trophies: when a month ends, its top 3 players get a trophy on their profile ----
const lbRank=S=>Object.entries(S||{}).filter(([k,e])=>!e.bot&&e.games>0).sort(([,a],[,b])=>b.wins-a.wins||(b.wins/b.games)-(a.wins/a.games)||(a.pts/a.games)-(b.pts/b.games));
function awardTrophies(){
  if(!LB||!lbOK||!FU||!fuOK)return;FU.tro=FU.tro||{};FU.x=FU.x||{};const cur=season();let ch=false;
  for(const s of Object.keys(LB).sort()){if(s>=cur||FU.tro[s])continue;
    lbRank(LB[s]).slice(0,3).forEach(([k],i)=>{const x=FU.x[k]||(FU.x[k]={b:{},h:{}});(x.tr=x.tr||[]).push({s,p:i+1})});FU.tro[s]=1;ch=true}
  if(ch)fuStore()}
function dailyRecord(R){
  if(!FU||!fuOK)return;const h=R.ps.find(q=>q.human);if(!h)return;FU.d=FU.d||{};const D=FU.d[R.daily]||(FU.d[R.daily]={});const k=pkey(h);if(D[k])return;
  const i=R.ps.indexOf(h);D[k]={name:h.name,pts:R.over.rp[i],out:R.over.w===i,left:[...h.h,...h.b,...h.m].filter(Boolean).length,t:Date.now()};
  tkAdd(k,TK.daily);prog(R,h,'daily');
  const ks=Object.keys(FU.d).sort();while(ks.length>8)delete FU.d[ks.shift()];fuStore();
}
function roundEvents(R,p){
  if(R.daily)dailyRecord(R);
  const o=R.over,greg=R.ps.find(q=>q.bot&&q.lvl==='unbeatable');
  if(!p.picked){award(R,p,'clean');prog(R,p,'clean')}
  if(greg){if(p===greg)gregSay(R,o.done?'champ':'gregout',o.done);else if(p.human)gregSay(R,o.done?'lose':'humanout',o.done)}
  if(o.done){
    const cw=o.champs.map(i=>R.ps[i]);
    R.ps.forEach(q=>{if(q.human)award(R,q,'first')});
    const gb=R.ps.find(q=>q.bot&&q.lvl==='unbeatable');
    if(gb&&!R.daily)cw.forEach(q=>{if(!q.human||!FU||!fuOK)return;const lv=gb.gl||3;FU.x=FU.x||{};const x=FU.x[pkey(q)]||(FU.x[pkey(q)]={b:{},h:{}});if((x.gl||0)<lv){x.gl=lv;fuStore()}award(R,q,'gl'+lv)});
    cw.forEach(q=>{award(R,q,'champ');if(q.tot<=25)award(R,q,'flawless');if(q.wasLast)award(R,q,'comeback')});
    if(!R.daily)rivals(R,cw);
    if(R.rb&&R.rb.length&&!R.daily)highlight(R,`${p.name} played the last card`,p.name);
  }else{const hi=Math.max(...R.ps.map(q=>q.tot));R.ps.forEach(q=>{if(q.tot===hi&&hi>0)q.wasLast=true})}
}
function rivals(R,winners){
  if(!FU||!fuOK)return;FU.x=FU.x||{};const ppl=R.ps.filter(q=>q.human||q.lvl==='unbeatable'||q.lvl==='impossible');
  for(const a of ppl){if(!a.human)continue;const x=FU.x[pkey(a)]||(FU.x[pkey(a)]={b:{},h:{}});x.h=x.h||{};
    for(const b of ppl){if(a===b)continue;const r=x.h[pkey(b)]||(x.h[pkey(b)]={w:0,l:0,n:b.base||b.name});r.n=b.human?b.name:(b.base||b.name);
      const aw=winners.includes(a),bw=winners.includes(b);if(aw&&!bw)r.w++;else if(bw&&!aw)r.l++}
    const gk=Object.keys(x.h).find(k=>k.startsWith('bot:')&&ppl.some(q=>q.lvl==='unbeatable'&&pkey(q)===k));
    if(gk&&x.h[gk].w>=5)award(R,a,'greg5')}
  fuStore();
}
function startDraw(R){
  if(R.slow){R.created=R.created||Date.now();slowIndex(R)}
  R.hl=[];R.rb=[];R.ps.forEach(q=>{q.wasLast=false;q.ready=false});
  if(R.clients)stat(R,'started');
  let cand=R.ps.map((_,i)=>i);const rounds=[];
  for(;;){
    const cards=cand.map(()=>({r:1+Math.random()*13|0,s:Math.random()*4|0}));rounds.push({who:[...cand],cards});
    const hi=Math.max(...cards.map(c=>c.r)),w=cand.filter((_,k)=>cards[k].r===hi);
    if(w.length===1){R.draw={rounds,winner:w[0]};break}cand=w;
  }
  R.start=R.draw.winner;R.phase='draw';R.round=0;R.over=null;R.msg='';
  setTimeout(()=>{if(R.phase==='draw'){deal(R);push(R);kick(R)}},rounds.length*2200+2400);
}
// ---- coach: after each hand, show a player the move that cost them the most and what Greg would have played ----
function coachRate(R,p,cs){
  const me=R.ps.indexOf(p),s=vis(p),u=unl(p),g={},cands=[];
  s.filter(c=>c.r!==10).forEach(c=>(g[c.r]=g[c.r]||[]).push(c));
  for(const a of Object.values(g)){const legal=ok(R,a[0]),clears=cnt(R,a[0].r)+a.length>=4;
    if(legal)for(let k=1;k<=a.length;k++)cands.push(a.slice(0,k));else if(clears)cands.push(a);else if(R.pile.length)cands.push(a)}
  const tn=s.filter(c=>c.r===10&&ok(R,c));if(tn.length)cands.push([tn[0]]);u.forEach(i=>cands.push([p.m[i]]));
  if(cands.length<2)return;
  const sig=x=>x.map(c=>c.id).sort().join(',');if(!cands.some(x=>sig(x)===sig(cs)))cands.push(cs);
  const one=(x,k)=>{const S=simCopy(R);S.quiet=true;S.noObs=true;const q=S.ps[me],all=[...q.h,...q.b.filter(Boolean),...q.m.filter(Boolean)];
    return seeded(k*104729+7,()=>{play(S,q,x.map(c=>all.find(y=>y.id===c.id)));return rollScore(S,me,0)})};
  // quick look at every option, then a careful side-by-side of the player's move and the best one on the same shuffles
  const t0=Date.now();let best=null,bv=-1e9;
  for(const x of cands){if(Date.now()-t0>150)return;let t=0;for(let k=0;k<8;k++)t+=one(x,k);t/=8;if(t>bv){bv=t;best=x}}
  if(sig(best)===sig(cs))return;
  const d=[];for(let k=100;k<124;k++){if(Date.now()-t0>400)break;d.push(one(best,k)-one(cs,k))}
  if(d.length<12)return;const mean=d.reduce((a,b)=>a+b,0)/d.length,sd=Math.sqrt(d.reduce((a,b)=>a+(b-mean)**2,0)/(d.length-1)),se=sd/Math.sqrt(d.length);
  if(mean<2.5*se)return;const loss=mean;
  if(loss>=5&&(!p.tip||loss>p.tip.loss)){const top=R.pile.length?topC(R):null,d=x=>p.m.includes(x[0])?'flipping a face-down card':`playing ${x.length>1?x.length+'× ':''}${lab(x[0].r)}${x[0].r!==10&&top&&x[0].r>top.r&&cnt(R,x[0].r)+x.length<4?' (too high, picking up the pile)':''}`;
    p.tip={loss:Math.round(loss),you:d(cs),greg:d(best),on:top?lab(top.r):null,pile:R.pile.length}}
}
function play(R,p,cs){
  if(p.offer)p.offer=null;
  // safety net: a second face-up or in-hand 10 in the same turn is never played; the turn passes instead
  if(cs[0]&&cs[0].r===10&&R.add==null&&p.tenJust&&!p.m.includes(cs[0])){p.tenJust=false;R.cur=(R.cur+1)%R.ps.length;if(!R.quiet)R.msg=p.name+' already used a 10 this turn, so the turn passes.';return}
  if(!R.quiet&&R.clients&&!R.coach&&!R.daily&&p.human&&!p.bot&&!p.away&&R.phase==='play'&&R.add==null)try{coachRate(R,p,cs)}catch(e){}
  if(!R.quiet&&!R.noObs&&R.phase==='play'&&R.add==null&&!R.coach&&(!p.bot||p.hide))observe(R,p,cs);
  const fromM=p.m.includes(cs[0]),pre=[...R.pile],only10=cs[0].r===10&&vis(p).every(c=>c.r===10)&&!unl(p).length;
  const t=R.pile.length?topC(R):null,w=cs[0].r===10&&(!R.tenUsed||fromM),bad=!w&&((t&&cs[0].r>t.r)||cs[0].r===10);
  R.add=null;
  p.tenJust=p.tenJust||!!(w&&!fromM); // one 10 per turn: stays set until the turn passes
  cs.forEach(c=>{let i=p.h.indexOf(c);if(i>-1)p.h.splice(i,1);else{i=p.b.indexOf(c);if(i>-1)p.b[i]=null;else p.m[p.m.indexOf(c)]=null}R.pile.push(c)});
  const Q=R.quiet;let msg=Q?'':p.name+' played '+(cs.length>1?cs.length+'× ':'')+lab(cs[0].r),swoop=w;
  if(!w&&cnt(R,cs[0].r)>=4)swoop=true
  let up=0;
  // a blind flip that lands four of a kind: the pile waits so the player can add their other cards of that rank (or tap Done)
  const hold=swoop&&!w&&fromM&&vis(p).some(c=>c.r===cs[0].r);R.addSw=false;
  if(hold){const rk=cs[0].r;if(bad){const u=pre.filter(c=>c.r!==rk);p.h.push(...u);up=u.length}R.pile=R.pile.filter(c=>c.r===rk);
    if(!Q)msg+=(up?` — four of a kind! Picks up ${up}.`:' — four of a kind!');R.flt='FOUR!'}
  else if(swoop){
    if(!w&&bad){const rk=cs[0].r,u=pre.filter(c=>c.r!==rk);p.h.push(...u);up=u.length}
    R.pile=[];if(!Q)msg+=up?` — four of a kind! Picks up ${up}, goes again.`:(w?' — Swoop! Goes again.':' — four of a kind! Pile cleared, goes again.');R.fl++;R.flt=w?'SWOOP!':'FOUR!'}
  else if(bad){const rk=cs[0].r,keep=rk===10?[]:pre.filter(c=>c.r===rk),rest=R.pile.filter(c=>!cs.includes(c)&&!keep.includes(c));if(!Q)msg+=rk===10?(rest.length?' — only one 10 per turn. It stays on the pile; picks up '+rest.length+'.':' — only one 10 per turn. It stays on the pile and the turn passes.'):rest.length?' — too high, stays on the pile; picks up '+rest.length+'.':' — too high.';p.h.push(...rest);up=rest.length;R.pile=[...keep,...cs];R.fl++;R.flt='Pickup'}
  if(!Q)p.lm={t:msg.slice(p.name.length+1),cards:cs.map(c=>({id:c.id,r:c.r,s:c.s})),out:swoop?'swoop':bad?'pickup':'',up};
  if(!Q)R.msg=msg;R.last=Q?{}:{n:++R.ln,by:R.ps.indexOf(p),cards:cs.map(c=>({id:c.id,r:c.r,s:c.s,w})),m:fromM,out:swoop?'swoop':bad?'pickup':'',up};
  if(!Q&&R.clients&&!R.coach)try{moveEvents(R,p,{cs,pre,swoop,w,bad,up,fromM,msg})}catch(e){console.error('events',e.message)}
  // move cap: two strong players (especially 1v1) can trade the same cards back and forth forever
  if(!Q)R.hm=(R.hm||0)+1;
  const held=q=>[...q.h,...q.b,...q.m].filter(Boolean).reduce((a,c)=>a+pts(c),0);
  let capW=null;if(!Q&&!empty(p)&&R.hm>=HCAP&&!R.coach){const hp=R.ps.map(held),lo=Math.min(...hp);capW=R.ps[hp.indexOf(lo)]}
  if(empty(p)||capW){
    const out=empty(p);if(capW)p=capW;
    if(out)R.last.win=true;
    const rp=R.ps.map(q=>q===p?0:held(q));
    R.ps.forEach((q,i)=>q.tot+=rp[i]);
    const done=!!R.coach||!!R.daily||R.ps.some(q=>q.tot>=(R.target||150)),low=Math.min(...R.ps.map(q=>q.tot));
    R.over={w:R.ps.indexOf(p),cap:!out,rp,done,champ:done?(R.coach?R.ps.indexOf(p):R.ps.findIndex(q=>q.tot===low)):-1,champs:done?(R.coach?[R.ps.indexOf(p)]:R.ps.map((q,i)=>q.tot===low?i:-1).filter(i=>i>=0)):[]};
    if(teamsOn(R)){const TT=[R.ps[0].tot+R.ps[2].tot,R.ps[1].tot+R.ps[3].tot],tdone=TT.some(t=>t>=2*(R.target||150)),tl=Math.min(...TT);R.over.teams=TT;R.over.done=tdone;
      R.over.champs=tdone?[0,1,2,3].filter(i=>TT[i%2]===tl):[];R.over.champ=tdone?R.over.champs[0]:-1}
    if(!Q&&R.clients&&!R.coach)try{styleSave(R)}catch(e){}
    R.phase='over';if(!Q&&R.clients)try{streakHand(R)}catch(e){console.error('streak',e.message)}if(!Q)R.msg=out?p.name+' played the last card.':`This hand hit the ${HCAP}-move limit, so it ends here. ${p.name} held the fewest points and wins the hand.`;if(out&&!Q&&R.clients&&!R.coach)try{roundEvents(R,p)}catch(e){console.error('round events',e.message)}if(R.over.done&&!Q&&R.pot)try{stakePay(R,R.over.champs.map(i=>R.ps[i]).filter(q=>q.human).map(pkey))}catch(e){console.error('stakes',e.message)}
    if(R.coach&&!Q&&R.clients)try{tutDone(R)}catch(e){}
    if(R.over.done&&!Q&&!R.coach&&!R.daily&&R.clients&&!R.recorded){R.recorded=true;try{tkGame(R)}catch(e){}try{gameDone(R)}catch(e){console.error('game done',e.message)}recordGame(R)}return;
  }
  const addR=hold?cs[0].r:fromM&&!swoop&&(!bad||cs[0].r!==10)&&vis(p).some(c=>c.r===cs[0].r)?cs[0].r:null;
  R.add=addR;R.addSw=hold;if(addR!==null&&!Q)R.msg+=hold?' Add your other '+lab(addR)+' too, or tap Done. Either way the pile clears and they go again.':' — may add more '+lab(addR)+'s.';
  if(!swoop&&addR===null){p.tenJust=false;R.cur=(R.cur+1)%R.ps.length}
  // one 10 per turn: if all that's left to play is 10s (and no face-down card to flip), the turn ends here
  else if(addR===null&&p.tenJust&&!unl(p).length&&vis(p).length&&vis(p).every(c=>c.r===10)){p.tenJust=false;R.cur=(R.cur+1)%R.ps.length;if(!Q){R.msg=R.msg.replace(' Goes again.','')+' Only 10s left, and one 10 per turn, so the turn passes.';if(p.lm)p.lm.t=p.lm.t.replace(' Goes again.','')}}
}
function bench(){const R={ps:[],phase:'lobby',round:0,start:0,cur:0,pile:[],tick:0,fl:0,ln:0,last:null,tenUsed:false,add:null,draw:null,flt:'',msg:'',over:null};['a','b','c'].forEach(n=>addP(R,n,true,'expert'));deal(R);let n=0;const t=Date.now();while(Date.now()-t<60){const S=simCopy(R);rollScore(S,0,0);n++}return Math.round(n/((Date.now()-t)/1000))}
const STYLE={expert:1,flipfirst:1,flip3:1,low:1,sets:1,dumphigh:1},STY=['expert','flipfirst','flip3','low','sets','dumphigh'];
// Greg watches how each human plays and assumes they keep playing that way when he looks ahead
function observe(R,p,cs){
  const i=R.ps.indexOf(p),act=p.m.includes(cs[0])?'F':cs[0].r+'x'+cs.length,sg={};let diff=false,first=null;
  for(const L of STY){const S=simCopy(R);S.noObs=true;S.ps[i].lvl=L;bot(S,S.ps[i]);const g=S.last&&S.last.cards?(S.last.m?'F':S.last.cards[0].r+'x'+S.last.cards.length):'?';sg[L]=g;if(first===null)first=g;else if(g!==first)diff=true}
  if(!diff)return;
  const o=p.sty||(p.sty={n:0});o.n++;for(const L of STY)if(sg[L]===act)o[L]=(o[L]||0)+1;
}
function modelOf(q){
  if(q.bot&&!q.hide){const l=q.lvl;return l==='impossible'||l==='unbeatable'?'expert':l}
  const o=q.sty;if(!o||o.n<4)return 'expert';
  let best='expert',br=o.expert||0;for(const L of STY)if((o[L]||0)>br+1){best=L;br=o[L]}
  return best;
}
const UNB_DEPTH=1;let searchEnd=0,HIGH=false,SRCH={s1:4,cap:40,top:4};const GS={moves:0,rounds:0,stage1ms:0,totalms:0,cands:0};
// "impossible" computer: sees every hidden card and tries each move against many look-ahead games
function simCopy(R){return{ps:R.ps.map(q=>({...q,h:q.h.slice(),b:q.b.slice(),m:q.m.slice()})),pile:R.pile.slice(),tenUsed:R.tenUsed,add:R.add,addSw:R.addSw,cur:R.cur,fl:R.fl,flt:R.flt,ln:R.ln,last:null,msg:'',phase:R.phase,over:null,round:R.round,start:R.start,draw:null}}
function rollScore(S,me,depth){
  S.quiet=true;S.ps.forEach((q,i)=>q.lvl=i===me?'expert':(q.model||'expert'));let n=0;
  while(S.phase==='play'&&n++<3000){const q=S.ps[S.cur];if(S.cur===me&&depth>0&&S.add==null&&Date.now()<searchEnd){const mv=impossibleMove(S,q,depth-1,1,true);if(mv){play(S,q,mv);continue}}bot(S,q)}
  if(S.phase!=='over')return -1e3;
  const rp=S.over.rp,others=rp.filter((_,i)=>i!==me);
  return others.reduce((a,b)=>a+b,0)/others.length-rp[me];
}
function impossibleMove(R,p,depth,N0,nested){
  depth=depth||0;N0=N0||4;if(nested&&Date.now()>searchEnd)return null;
  const me=R.ps.indexOf(p),s=vis(p),u=unl(p),cands=[],g={};
  s.filter(c=>c.r!==10).forEach(c=>(g[c.r]=g[c.r]||[]).push(c));
  for(const a of Object.values(g)){
    const r=a[0].r,legal=ok(R,a[0]),clears=cnt(R,r)+a.length>=4;
    const kMin=1;
    if(legal)for(let k=kMin;k<=a.length;k++)cands.push(a.slice(0,k).map(c=>c.id));
    else if(clears)cands.push(a.map(c=>c.id));
    else if(HIGH&&R.pile.length)for(let k=kMin;k<=a.length;k++)cands.push(a.slice(0,k).map(c=>c.id)); // deliberate too-high play: dump heavy cards, pick up the pile
  }
  const tn=s.filter(c=>c.r===10&&ok(R,c));if(tn.length)cands.push([tn[0].id]);
  u.forEach(i=>cands.push([p.m[i].id]));
  if(!cands.length)return null;
  if(cands.length===1)return idsToCards(p,cands[0]);
  const rkOf=ids=>{const c=[...p.h,...p.b.filter(Boolean),...p.m.filter(Boolean)].find(x=>x.id===ids[0]);return p.m.some(x=>x&&x.id===ids[0])?-1:c.r===10?0:c.r};
  cands.sort((a,b)=>rkOf(b)-rkOf(a));
  // reserve value: keep 10s and aces for when stuck; don't hoard so many 10s that they become points
  const hand=vis(p),n10=hand.filter(c=>c.r===10).length,nA=hand.filter(c=>c.r===1).length,left=p.h.length+p.b.filter(Boolean).length+p.m.filter(Boolean).length;
  const legalAlt=cands.some(ids=>{const c=hand.find(x=>x.id===ids[0]);return c&&c.r!==10&&c.r!==1&&ok(R,c)});
  const legalAltA=cands.some(ids=>{const c=hand.find(x=>x.id===ids[0]);return c&&c.r!==10&&ok(R,c)&&!(c.r===1)||false});
  const SPLITP=R.splitP!=null?R.splitP:SPLIT_PEN;
  const pen=ids=>{
    const cs=ids.map(id=>hand.find(x=>x.id===id)).filter(Boolean);if(!cs.length)return 0;
    const r=cs[0].r;
    // nudge: play every J/Q/K of a rank together; only split when the look-ahead says it's clearly better
    const kept=r>=11?hand.filter(c=>c.r===r).length-cs.length:0,sp=kept>0?SPLITP*kept:0;
    if(left<=3||!R.pile.length)return sp;
    return sp+(()=>{
    if(r===10)return legalAlt&&n10<=3?Math.max(1,4-1.5*(n10-1)):0;
    if(r===1&&cnt(R,1)+cs.length<4){const keep=nA-cs.length;return legalAltA?(cs.length>1?1.5*cs.length:1.5)*(keep>=1?0.6:1)*(nA>=4?0.3:1):0}
    return 0})()};
  const ev=(ids,k,d)=>{const S=simCopy(R);S.quiet=true;const q=S.ps[me],all=[...q.h,...q.b.filter(Boolean),...q.m.filter(Boolean)];
    return seeded(k*7919+17,()=>{play(S,q,ids.map(id=>all.find(c=>c.id===id)));return rollScore(S,me,d)})-pen(ids)};
  let best=null,bs=-Infinity;
  if(!(depth>0)){
    for(const ids of cands){let tot=0;for(let k=0;k<N0;k++)tot+=ev(ids,k,0);tot/=N0;if(tot>bs){bs=tot;best=ids}}
  }else{
    const T0=Date.now();
    // stage 1: every candidate gets a quick look on the same shared games
    const S1=nested?4:SRCH.s1,sc=cands.map(ids=>{let t=0;for(let k=0;k<S1;k++)t+=ev(ids,k,0);return {ids,v:t/S1}}).sort((x,y)=>y.v-x.v);
    best=sc[0].ids;
    const T1=Date.now();
    // stage 2: the best few get a deeper look (Greg also plans his own later turns), round-robin until time is up
    const top=sc.slice(0,Math.min(nested?4:SRCH.top,sc.length)).map(x=>({ids:x.ids,t:0})),vals=[];
    for(let k=0;k<(nested?40:SRCH.cap)&&Date.now()<searchEnd;k++){
      const row=[];for(const c of top){if(Date.now()>=searchEnd)break;row.push(ev(c.ids,100+k,depth))}
      if(row.length<top.length)break;row.forEach((v,i)=>top[i].t+=v);vals.push(1);
    }
    GS.moves++;GS.rounds+=vals.length;GS.stage1ms+=T1-T0;GS.totalms+=Date.now()-T0;GS.cands+=cands.length;
    if(vals.length){let m=-Infinity;top.forEach(c=>{if(c.t>m){m=c.t;best=c.ids}})}
  }
  return idsToCards(p,best);
}
function seeded(seed,fn){const old=Math.random;let a=seed>>>0;Math.random=()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};try{return fn()}finally{Math.random=old}}
function idsToCards(p,ids){const all=[...p.h,...p.b.filter(Boolean),...p.m.filter(Boolean)];return ids.map(id=>all.find(c=>c.id===id))}
function fastExpert(R,p,mode){
  const pl=R.pile,np=pl.length,top=np?pl[np-1].r:99,tu=R.tenUsed,h=p.h,b=p.b;
  let nu=0,ui=null;for(let i=0;i<p.m.length;i++){if(p.m[i]&&!b[i]){(ui||(ui=[])).push(i);nu++}}
  const flip=()=>play(R,p,[p.m[ui[Math.random()*nu|0]]]);
  if(nu&&(mode==='flipfirst'||(mode==='flip3'&&np<=2)))return flip();
  if(nu&&(!np||top>=11))return flip();
  // four of a kind that costs at most 4 pick-ups
  const cntR=new Array(14).fill(0),cp=new Array(14).fill(0);let anyNon10=false,hi=0,ten=null;
  const scan=c=>{if(!c)return;if(c.r===10){if(!ten)ten=c;return}cntR[c.r]++;anyNon10=true;if((!np||c.r<=top)&&(mode==='low'?(hi===0||c.r<hi):c.r>hi))hi=c.r};
  for(let i=0;i<h.length;i++)scan(h[i]);for(let i=0;i<b.length;i++)scan(b[i]);
  for(let i=0;i<np;i++)cp[pl[i].r]++;
  let fkr=0,fku=99;
  for(let r=1;r<=13;r++){if(r===10||!cntR[r])continue;if(cp[r]+cntR[r]>=4){const up=(!np||r<=top)?0:np-cp[r];if(up<=4&&up<fku){fku=up;fkr=r}}}
  const grp=r=>{const o=[];for(let i=0;i<h.length;i++)if(h[i].r===r)o.push(h[i]);for(let i=0;i<b.length;i++)if(b[i]&&b[i].r===r)o.push(b[i]);return o};
  if(mode==='sets'){let bc=0;hi=0;for(let r=13;r>=1;r--){if(r!==10&&cntR[r]&&(!np||r<=top)&&cntR[r]>bc){bc=cntR[r];hi=r}}}
  if(mode==='dumphigh'&&np&&np<=3)for(let r=13;r>=11;r--){if(cntR[r]>=2&&r>top)return play(R,p,grp(r))}
  if(fkr)return play(R,p,grp(fkr));
  if(hi)return play(R,p,grp(hi));
  if(nu&&np<=2)return flip();
  if(ten&&!tu)return play(R,p,[ten]);
  if(nu)return flip();
  // nothing legal: dump the highest card
  let best=null;const all=[...h,...b.filter(Boolean)];
  const only10=tu&&all.some(c=>c.r!==10);
  for(const c of all){if(only10&&c.r===10)continue;if(!best||c.r>best.r)best=c}
  return play(R,p,[best]);
}
function bot(R,p){
  R.tenUsed=blocked(p);
  if(R.add!=null)return play(R,p,vis(p).filter(c=>c.r===R.add));
  if(STYLE[p.lvl]&&!R.noFast)return fastExpert(R,p,p.lvl);
  const L=p.lvl||'medium',pick=a=>a[Math.random()*a.length|0];
  const g={},upN=r=>(!R.pile.length||r<=topC(R).r)?0:R.pile.filter(c=>c.r!==r).length;
  vis(p).filter(c=>c.r!==10).forEach(c=>(g[c.r]=g[c.r]||[]).push(c));
  const fk=m=>Object.values(g).filter(a=>cnt(R,a[0].r)+a.length>=4&&upN(a[0].r)<=m).sort((a,b)=>upN(a[0].r)-upN(b[0].r))[0];
  const s=vis(p),v=s.filter(c=>ok(R,c)),nw=v.filter(c=>!wild(R,c)),tn=v.filter(c=>wild(R,c)),u=unl(p);
  const hiSet=a=>{const hi=Math.max(...a.map(c=>c.r));return a.filter(c=>c.r===hi)};
  const pool=R.tenUsed&&s.some(c=>c.r!==10)?s.filter(c=>c.r!==10):s;
  const flip=()=>play(R,p,[p.m[pick(u)]]);
  if(L==='easy'){
    if(nw.length)return play(R,p,Math.random()<.6?[pick(nw)]:hiSet(nw));
    if(tn.length&&Math.random()<.8)return play(R,p,[tn[0]]);
    if(u.length)return flip();
    return play(R,p,[pick(pool)]);
  }
  if(L==='medium'){
    const c=fk(2);if(c&&Math.random()<.8)return play(R,p,c);
    if(nw.length)return play(R,p,hiSet(nw));
    if(tn.length)return play(R,p,[tn[0]]);
    if(u.length)return flip();
    return play(R,p,[pool.reduce((a,c)=>c.r<a.r?c:a)]);
  }
  if(L==='hard'){
    if(u.length&&!R.pile.length&&Math.random()<.7)return flip();
    const c=fk(4);if(c)return play(R,p,c);
    if(nw.length)return play(R,p,hiSet(nw));
    if(tn.length)return play(R,p,[tn[0]]);
    if(u.length)return flip();
    return play(R,p,[pool.reduce((a,c)=>c.r<a.r?c:a)]);
  }
  if(L==='impossible'){const mv=impossibleMove(R,p);if(mv)return play(R,p,mv)}
  if(L==='unbeatable'){const G=p.gl&&GL[p.gl];searchEnd=Date.now()+(+(R.perMs&&G?G.ms:R.searchMs)||250);HIGH=!R.noHigh;R.ps.forEach(q=>q.model=R.noInfer?'expert':modelOf(q));let mv=null;SRCH={s1:(G&&G.s1)||4,cap:(G&&G.cap)||40,top:(G&&G.top)||4};try{mv=impossibleMove(R,p,(G&&G.depth)||UNB_DEPTH,2)}finally{HIGH=false;SRCH={s1:4,cap:40,top:4}}if(mv)return play(R,p,mv)}
  // expert: flips face-down cards when it is nearly free, then plays the highest legal card
  const t=R.pile.length?topC(R):null;
  if(u.length&&(!t||t.r>=11))return flip();
  const c=fk(4);if(c)return play(R,p,c);
  if(nw.length)return play(R,p,hiSet(nw));
  if(u.length&&R.pile.length<=2)return flip();
  if(tn.length)return play(R,p,[tn[0]]);
  if(u.length)return flip();
  play(R,p,[pool.reduce((a,c)=>c.r>a.r?c:a)]);
}
const solo=R=>R.ps.filter(q=>!q.bot).length===1&&!R.ps.some(q=>q.lvl==='impossible'||q.lvl==='unbeatable');
const snap=R=>structuredClone({round:R.round,ps:R.ps.map(q=>({h:q.h,b:q.b,m:q.m,tot:q.tot,tenJust:q.tenJust,tenPh:q.tenPh,lm:q.lm})),pile:R.pile,cur:R.cur,add:R.add,addSw:R.addSw,msg:R.msg,fl:R.fl,flt:R.flt});
const REACTS=['👍','😂','😮','😡','😭','🔥','👏','🙈','😎','💀'];
function act(R,p,a){
  if(a.t==='vjoin'){if(!p.bot){R.voice=R.voice||new Set();R.voice.add(p.id)}return push(R)}
  if(a.t==='vleave'){if(R.voice)R.voice.delete(p.id);return push(R)}
  if(a.t==='chat'||a.t==='react'){
    const now=Date.now();if(now-(p.chatT||0)<700)return;p.chatT=now;
    let e=null;
    if(a.t==='chat'){const txt=String(a.txt||'').replace(/\s+/g,' ').trim().slice(0,200);if(!txt)return;e={k:'c',txt}}
    else{const em=String(a.e||'');if(!REACTS.includes(em))return;e={k:'r',txt:em}}
    R.cn=(R.cn||0)+1;e.n=R.cn;e.who=p.name;e.pi=R.ps.indexOf(p);e.at=now;
    (R.chat=R.chat||[]).push(e);if(R.chat.length>60)R.chat.shift();
    return push(R); // no kick: chatting never delays or restarts the computer players
  }
  const host=p.host;R.tenUsed=blocked(p);
  const sn=(a.t==='play'||a.t==='done')&&R.phase==='play'&&solo(R)&&R.ps[R.cur]===p?snap(R):null;
  if(a.t==='bot'&&host&&R.phase==='lobby'&&R.ps.length<8&&!R.ranked){const used=x=>R.ps.some(q=>q.bot&&(q.base||q.name)===x.name),i=(a.ids||[])[0]|0;let b=BOTS[i];if(!b||used(b))b=BOTS.find(x=>!used(x));if(b){const nm=R.ps.some(q=>!q.bot&&q.name.toLowerCase()===b.name.toLowerCase())?b.name+' (AI)':b.name;{const q=addP(R,nm,true,b.lvl);q.base=b.name;if(b.lvl==='unbeatable')q.gl=gregMax(R)}}}
  else if(a.t==='ghost'&&host&&R.phase==='lobby'&&R.ps.length<8&&!R.ranked){const g=String((a.ids||[])[0]||''),G=ghostsFor(R).find(x=>x.k===g&&!x.used);
    if(G){const st=ghostStyle(FU.x[g].sty),nm=G.name+' 👻';const q=addP(R,nm,true,st);q.ghost=g;q.base=nm;R.msg=`${nm} joined. ${G.name}'s ghost ${GHOST_TXT[st]||'plays like them'}.`}}
  else if(a.t==='rmbot'&&host&&R.phase==='lobby'){const i=R.ps.findIndex(q=>q.bot&&q.id===String((a.ids||[])[0]));if(i>=0)R.ps.splice(i,1)}
  else if(a.t==='start'&&host&&R.phase==='lobby'&&R.ps.length>=2&&(!R.teams||R.ps.length===4)){const e=stakeStart(R);if(e){R.msg=e;R.stakeErr=e}else{R.stakeErr='';startDraw(R)}}
  else if(a.t==='stake'&&host&&R.phase==='lobby'){const v=(a.ids||[])[0]|0;if(STAKES.includes(v)){R.stake=v;R.stakeOk={[pkey(p)]:1};R.stakeErr=''}}
  else if(a.t==='stakeok'&&R.phase==='lobby'&&R.stake){(R.stakeOk=R.stakeOk||{})[pkey(p)]=1;R.stakeErr=''}
  else if(a.t==='ready'&&R.phase==='over'&&R.over&&R.over.done){p.ready=!p.ready}
  else if(a.t==='greglvl'&&host&&R.phase==='lobby'){const g=R.ps.find(q=>q.bot&&q.lvl==='unbeatable'),L=(a.ids||[])[0]|0;if(g&&L>=1&&L<=gregMax(R))g.gl=L}
  else if(a.t==='nextready'&&R.phase==='over'&&R.over&&!R.over.done){p.ready=true;
    // deal the next hand as soon as every player who is here has tapped Next
    if(R.ps.every(q=>q.ready||q.bot||q.away))(R.start=R.over.w,deal(R))}
  else if(a.t==='target'&&host&&R.phase==='lobby'){const T=[100,150,250];R.target=T[(T.indexOf(R.target||150)+1)%3]}
  else if(a.t==='quick'&&host&&R.phase==='lobby'){R.quick=!R.quick}
  else if(a.t==='blitz'&&host&&R.phase==='lobby'&&!R.slow){R.blitz=!R.blitz;if(R.blitz)R.quick=true}
  else if(a.t==='teams'&&host&&R.phase==='lobby'){R.teams=!R.teams}
  else if(a.t==='swap'&&R.phase==='play'&&R.ps[R.cur]===p&&R.add==null&&swapOK(R,p)){
    const id=(a.ids||[])[0],x=tkX(pkey(p));if(!x||x.tk<TK.swap||p.swp===R.round||!R.spare||!R.spare.length)return push(R);
    const give=p.h.find(c=>c.id===id)||p.b.find(c=>c&&c.id===id);if(!give)return push(R);
    // three different random cards from the unused deck to choose from
    const idx=[...R.spare.keys()].sort(()=>Math.random()-.5),opts=[],seen=new Set([give.r]);for(const j of idx){const c=R.spare[j];if(seen.has(c.r))continue;seen.add(c.r);opts.push(c.id);if(opts.length===3)break}
    // same choices all hand, so cancelling and asking again can't re-roll for a better card
    if(p.offRound===R.round&&p.offOpts){const keep=p.offOpts.filter(id=>{const c=R.spare.find(x=>x.id===id);return c&&c.r!==give.r});if(keep.length){opts.length=0;opts.push(...keep)}}
    p.offRound=R.round;p.offOpts=[...new Set([...(p.offRound===R.round&&p.offOpts?p.offOpts:[]),...opts])].slice(0,4);
    p.offer={give:give.id,opts};return push(R)}
  else if(a.t==='swapx'){p.offer=null;return push(R)}
  else if(a.t==='swappick'&&R.phase==='play'&&R.ps[R.cur]===p&&R.add==null&&swapOK(R,p)&&p.offer){
    const pick=(a.ids||[])[0],o=p.offer;p.offer=null;const x=tkX(pkey(p));if(!x||x.tk<TK.swap||p.swp===R.round||!o.opts.includes(pick))return push(R);
    let where=p.h,i=p.h.findIndex(c=>c.id===o.give);if(i<0){where=p.b;i=p.b.findIndex(c=>c&&c.id===o.give)}const j=R.spare.findIndex(c=>c.id===pick);if(i<0||j<0)return push(R);
    const old=where[i],nw=R.spare[j];where[i]=nw;R.spare[j]=old;
    x.tk-=TK.swap;p.swp=R.round;R.undo=[];fuStore();tkPing(pkey(p));R.msg=`${p.name} traded a ${lab(old.r)} for a ${lab(nw.r)} (🪙 ${TK.swap}).`;R.lastSwap={n:(R.lastSwap?R.lastSwap.n:0)+1,by:R.ps.indexOf(p),from:lab(old.r),to:lab(nw.r)};return push(R)}
  else if(a.t==='partner'&&host&&R.phase==='lobby'&&R.ps.length===4){const [a0,a1,a2,a3]=R.ps;R.ps=[a0,a2,a3,a1]}
  else if(a.t==='tsig'&&teamsOn(R)&&R.phase!=='lobby'){const k=(a.ids||[])[0]|0,i=R.ps.indexOf(p);if(TSIG[k]&&Date.now()-(p.tsT||0)>1500){p.tsT=Date.now();R.tsig=R.tsig||[null,null];R.tsig[i%2]={from:i,txt:TSIG[k],n:(R.tsig[i%2]?R.tsig[i%2].n:0)+1}}return push(R)}
  else if(a.t==='slow'&&host&&R.phase==='lobby'){R.slow=!R.slow;if(R.slow)R.blitz=false;if(!R.slow)R.speed=null}
  else if(a.t==='speed'&&host&&R.phase!=='gone'){R.speed=((R.speed==null?1:R.speed)+1)%3}
  else if(a.t==='tutorial'&&host&&R.phase==='lobby'){R.ps=R.ps.filter(q=>!q.bot);addP(R,'Ava',true,'easy');addP(R,'Levi',true,'easy');R.coach=true;R.small=true;R.start=R.ps.indexOf(p);R.round=0;deal(R)}
  else if(a.t==='quit'){
    if(R.voice)R.voice.delete(p.id);
    const nm=p.name,wasHost=p.host;
    if(R.phase==='lobby')R.ps.splice(R.ps.indexOf(p),1);
    else{p.bot=true;p.left=true;p.away=false;R.msg=nm+' left. A computer player took over. They can rejoin with the game code.';
      if(R.pot&&R.stakeP){const other=R.stakeP.filter(k=>k!==pkey(p));stakePay(R,other,`${nm} forfeited the ${R.pot} token pot.`)}}
    p.host=false;
    if(!R.ps.some(q=>!q.bot)){R.phase='gone';R.tick++;delete rooms[R.code]}
    else if(wasHost){const n=R.ps.find(q=>!q.bot);if(n)n.host=true}
  }
  else if(a.t==='undo'){
    const u=R.undo&&R.undo[R.undo.length-1];
    if(!u||R.phase!=='play'||!solo(R)||u.round!==R.round||u.ps.length!==R.ps.length)return;
    R.undo.pop();R.tick++;
    R.ps.forEach((q,i)=>Object.assign(q,u.ps[i]));
    R.pile=u.pile;R.cur=u.cur;R.add=u.add;R.addSw=!!u.addSw;R.fl=u.fl;R.flt=u.flt;R.last=null;R.msg='Move undone.';R.tenUsed=blocked(R.ps[R.cur]);
  }
  else if(a.t==='next'&&host&&R.phase==='over'&&!R.over.done){R.start=R.over.w;deal(R)}
  else if(a.t==='again'&&host&&R.phase==='over'&&R.over.done){R.recorded=false;R.stake=0;R.stakeOk={};R.round=0;R.ps.forEach(q=>q.tot=0);startDraw(R)}
  else if(a.t==='done'&&R.phase==='play'&&R.ps[R.cur]===p&&R.add!=null&&R.addSw){R.addSw=false;R.add=null;R.pile=[];R.fl++;R.flt='FOUR!';R.msg=p.name+' cleared the four of a kind and goes again.';if(p.lm)p.lm.t='cleared four of a kind, goes again'}
  else if(a.t==='done'&&R.phase==='play'&&R.ps[R.cur]===p&&R.add!=null){R.add=null;p.tenJust=false;R.cur=(R.cur+1)%R.ps.length;R.msg=p.name+' ends their turn.'}
  else if(a.t==='play'&&R.phase==='play'&&R.ps[R.cur]===p){
    const ids=[...new Set(a.ids||[])];let cs;
    if(String(ids[0])[0]==='m'){if(R.add!=null)return;const i=+String(ids[0]).slice(1);if(!p.m[i]||p.b[i])return;cs=[p.m[i]]}
    else{
      const av=vis(p);cs=ids.map(id=>av.find(c=>c.id===id));
      if(!cs.length||cs.some(c=>!c)||cs.some(c=>c.r!==cs[0].r)||(R.add!=null&&cs[0].r!==R.add))return;
      if(wild(R,cs[0])&&cs.length>1)return;
      if(R.add==null&&cs[0].r!==10&&!ok(R,cs[0])){const need=4-cnt(R,cs[0].r);if(need>cs.length){const ex=av.filter(c=>c.r===cs[0].r&&!cs.includes(c));if(cs.length+ex.length>=need)cs=[...cs,...ex.slice(0,need-cs.length)]}}
      if(cs[0].r===10&&R.tenUsed&&!p.m.includes(cs[0]))return;
      if(cs[0].r===10&&cs.length>1)cs=[cs[0]];
    }
    play(R,p,cs);
  }else return;
  if(sn){(R.undo=R.undo||[]).push(sn);if(R.undo.length>15)R.undo.shift()}
  push(R);kick(R);
}
function kick(R){
  const p=R.ps[R.cur];if(R.phase!=='play'||!(p.bot||p.away))return;
  const base=process.env.FAST_BOTS?30:R.blitz?700:[1000,2200,3500][R.speed==null?1:R.speed],t=++R.tick,delay=R.last&&R.last.out?base+1200:base,t0=Date.now();
  let ids=null;
  // Greg thinks during the pause that is already there, so a longer think does not slow the game
  const simple=p.lvl==='unbeatable'&&p.gl&&GL[p.gl]&&Math.random()>=GL[p.gl].q; // lower ladder levels play a simple move some of the time
  if(p.lvl==='unbeatable'&&!simple){try{const S=simCopy(R),q=S.ps[R.cur];S.searchMs=p.gl?GL[p.gl].ms:900;bot(S,q);if(S.last)ids=S.last.cards.map(c=>c.id)}catch(e){ids=null}}
  setTimeout(()=>{if(R.tick!==t||R.phase!=='play'||R.ps[R.cur]!==p)return;
    const cs=ids&&idsToCards(p,ids);
    if(cs&&cs.every(Boolean)){R.tenUsed=blocked(p);play(R,p,cs)}else if(simple){p.lvl='hard';try{bot(R,p)}finally{p.lvl='unbeatable'}}else bot(R,p);
    push(R);kick(R)},Math.max(0,delay-(Date.now()-t0)));
}
const RN=r=>({1:'Ace',11:'Jack',12:'Queen',13:'King'}[r]||String(r));
function coachInfo(R,p){
  try{
    const me=R.ps.indexOf(p),mine=R.phase==='play'&&R.cur===me,L=R.last;let past='',tip='',text='',ids=[];
    if(R.phase==='over')return{text:'Round over! The player who gets rid of every card wins. Everyone else adds up the cards they were still holding as points, and the lowest total wins. 10s count 15, J/Q/K count 10, other cards count their number, Aces count 1.',ids:[],tip:''};
    if(!L)past='Welcome! Your goal is to get rid of all your cards before anyone else: the hand at the bottom, then the face-up cards, then the face-down cards. Each card you play must be equal to or lower than the top card of the pile (Ace is lowest, King is highest).';
    else{
      const who=L.by===me?'You':R.ps[L.by].name,c0=L.cards[0],n=L.cards.length,rk=RN(c0.r)+(n>1?'s':'');
      if(c0.w)past=who+' played a 10. Tens are wild: they clear the pile and that player goes again.';
      else if(L.out==='swoop')past=who+' completed four '+RN(c0.r)+'s. Four of a kind clears the pile and the player goes again.';
      else if(L.out==='pickup')past=who+' played a card higher than the top of the pile, so '+(L.up?(who==='You'?'you picked up ':who+' picked up ')+L.up+' card'+(L.up>1?'s':''):'nothing was picked up')+'. Playing too high costs you cards!';
      else past=who+' played '+(n>1?n+' ':'a ')+rk+'.';
    }
    if(mine){
      if(R.add!=null){
        const m=vis(p).filter(c=>c.r===R.add);ids=m.map(c=>c.id);
        text=R.addSw?'Your flip made four '+RN(R.add)+'s. Add your other '+RN(R.add)+'s now (highlighted) so they go out with the pile, or tap Done.':'You flipped a '+RN(R.add)+'. You can add your other '+RN(R.add)+'s now (highlighted). When you are done, tap Done.';
      }else{
        const S=simCopy(R),q=S.ps[me];q.lvl='expert';bot(S,q);const l=S.last;
        if(l){
          const c0=l.cards[0],n=l.cards.length,rk=RN(c0.r)+(n>1?'s':'');
          if(l.m){const i=p.m.findIndex(c=>c&&c.id===c0.id);ids=['m'+i]}else ids=l.cards.map(c=>c.id);
          if(c0.w)text='Play your 10 (highlighted)! A 10 is wild: it clears the pile and you go again. You can\'t play two 10s in a row, though.';
          else if(l.out==='swoop')text='Play your '+n+' '+rk+'. Together with the '+RN(c0.r)+'s already on the pile, that makes four of a kind, which clears the pile and lets you go again.';
          else if(l.m)text='Flip a face-down card (highlighted). It is a surprise, but flipping early is smart while the pile is small: if it is too high you only pick up a few cards. If it matches cards in your hand, you can add them.';
          else if(l.out==='pickup')text='Nothing you hold is low enough to play legally. Play the highlighted '+rk+' anyway: it is too high, so it stays on the pile and you pick up the other '+(l.up||0)+' card'+(l.up===1?'':'s')+'. Try to avoid this when you can.';
          else text='Play your '+rk+' (highlighted). Rule of thumb: play the highest card you are allowed to play. High cards are hard to get rid of later and cost the most points.';
        }
        if(unl(p).length)tip='Tip: a face-down card unlocks when the face-up card on top of it is gone. Unlocked ones glow, and you can flip them any time.';
        else if(vis(p).some(c=>c.r===11||c.r===12||c.r===13)&&R.pile.length===0)tip='Tip: the pile is empty, so any card is legal. A good time to get rid of a King!';
        else tip='Tip: you can tap more than one card of the same rank to play them together.';
      }
    }else if(R.phase==='play')text='Waiting for '+R.ps[R.cur].name+'...';
    return{text:(past?past+' ':'')+text,ids,tip};
  }catch(e){return null}
}
// admin watching: a link only the owner can make (from the stats page with the admin key) that shows everyone's cards
const admTok=code=>process.env.ADMIN_KEY?'adm'+crypto.createHmac('sha256',process.env.ADMIN_KEY).update('watch:'+code).digest('hex').slice(0,24):null;
const isAdm=(R,pid)=>!!pid&&pid===admTok(R.code);
function view(R,pid){
  const me=R.ps.findIndex(p=>p.id===pid),t=R.pile.length?topC(R):null;
  return{code:R.code,phase:R.phase,round:R.round,cur:R.cur,me,msg:R.msg,pile:R.pile.length,top:t,tenUsed:me>=0&&blocked(R.ps[me]),add:R.add,addSw:!!R.addSw,canUndo:R.phase==='play'&&solo(R)&&!!(R.undo&&R.undo.length&&R.undo[R.undo.length-1].round===R.round),draw:R.phase==='draw'?R.draw:null,stack:R.pile.slice(-5),all:R.pile.map(c=>({id:c.id,r:c.r,s:c.s})),bur:[...new Set(R.pile.slice(0,-1).map(c=>c.r))],pcnt:R.pile.reduce((a,c)=>(a[c.r]=(a[c.r]||0)+1,a),{}),last:R.last,over:R.over,fl:R.fl,flt:R.flt,
    ps:R.ps.map(p=>({id:p.bot?p.id:null,rev:R.phase==='over'?[...p.h,...p.b.filter(Boolean),...p.m.filter(Boolean)].map(c=>({id:c.id,r:c.r,s:c.s})):null,name:p.name,bot:p.bot,lvl:p.bot?p.lvl:null,host:p.host,h:p.h.length,b:p.b,m:p.m.map(c=>!!c),tot:p.tot,lm:p.lm||null,away:!!p.away,gl:p.gl||0,gh:p.ghost?1:0,back:p.human&&FU&&FU.x&&FU.x[p.name.toLowerCase()]&&FU.x[p.name.toLowerCase()].back||'',fb:p.human&&FU&&FU.a&&FU.a[p.name.toLowerCase()]?FU.a[p.name.toLowerCase()].fb||'':'',ti:p.human?tierK(p.name.toLowerCase()):'',dc:p.dcAt&&!p.away&&!p.bot?Math.max(0,AWAY_MS-(Date.now()-p.dcAt)):0})),tip:me>=0&&R.phase==='over'?R.ps[me].tip||null:null,pred:(()=>{const sk=me<0&&R.specK&&R.specK[pid],crowd={};Object.values(R.preds||{}).forEach(p=>crowd[p.pick]=(crowd[p.pick]||0)+1);
      const open=R.phase!=='lobby'&&!(R.over&&R.over.done)&&R.round<=2&&!R.daily&&!R.tour;if(!sk&&!Object.keys(crowd).length)return null;
      return{crowd,can:!!sk,open,mine:sk&&R.preds&&R.preds[sk]?R.preds[sk].pick:null,stake:PRED.stake,mult:predMult(R),tk:sk?((tkX(sk)||{}).tk||0):null}})(),stoasts:me<0&&R.specK&&R.specK[pid]&&R.stoasts?R.stoasts.filter(t=>t.k===R.specK[pid]):[],blitz:!!R.blitz,bdl:R.blitz&&R.bdl?Math.max(0,R.bdl-Date.now()):0,ranked:!!R.ranked,stake:R.stake||0,stakeOk:Object.keys(R.stakeOk||{}),pot:R.pot||0,stakeable:stakeable(R),stakeErr:R.stakeErr||'',stakes:STAKES,mykey:me>=0?pkey(R.ps[me]):'',toasts:me>=0&&R.toasts?R.toasts.filter(t=>t.pi===me):[],mood:(()=>{const vq=me>=0?R.ps[me]:null;if(!vq||!vq.human||!R.ps.some(q=>q.bot&&q.lvl==='unbeatable'))return null;return gregMood(pkey(vq))})(),tk:me>=0&&R.ps[me].human&&FU&&FU.a&&FU.a[pkey(R.ps[me])]?(tkX(pkey(R.ps[me]))||{}).tk:null,swap:me>=0&&swapOK(R,R.ps[me])?{cost:TK.swap,used:R.ps[me].swp===R.round,left:R.spare?R.spare.length:0,offer:R.ps[me].offer&&R.spare?{give:(()=>{const q=R.ps[me],c=q.h.find(c=>c.id===q.offer.give)||q.b.find(c=>c&&c.id===q.offer.give);return c?{id:c.id,r:c.r,s:c.s}:null})(),opts:R.ps[me].offer.opts.map(id=>R.spare.find(c=>c.id===id)).filter(Boolean).map(c=>({id:c.id,r:c.r,s:c.s}))}:null}:null,lastSwap:R.lastSwap||null,teams:!!R.teams,tsigs:TSIG,psig:teamsOn(R)&&me>=0&&R.tsig&&R.tsig[me%2]&&R.tsig[me%2].from!==me?R.tsig[me%2]:null,gregMax:R.phase==='lobby'?gregMax(R):0,ghosts:R.phase==='lobby'&&me>=0&&R.ps[me].host?ghostsFor(R):null,
    speed:R.speed==null?1:R.speed,chat:(R.chat||[]).slice(-40),reacts:REACTS,myVid:me>=0?R.ps[me].vid:null,voice:R.voice?R.ps.map((q,i)=>R.voice.has(q.id)?{vid:q.vid,pi:i,name:q.name}:null).filter(Boolean):[],
    coach:R.coach&&me>=0?coachInfo(R,R.ps[me]):null,peek:me<0&&isAdm(R,pid)?R.ps.map(p=>({h:p.h.map(c=>({id:c.id,r:c.r,s:c.s})).sort((a,b)=>a.r-b.r),m:p.m.map(c=>c?{id:c.id,r:c.r,s:c.s}:null)})):null,target:R.target||150,quick:!!R.quick,slow:!!R.slow,tour:R.tour||null,tlabel:R.tlabel||null,daily:R.daily||null,spec:me<0,ach:(R.ach||[]).slice(-6),hl:R.phase==='over'?(R.hl||[]):null,ready:R.ps.map(q=>!!(q.ready||q.bot)),hand:me>=0?R.ps[me].h:[],bots:R.phase==='lobby'?BOTS.map((b,i)=>({i,name:b.name,lvl:b.lvl,used:R.ps.some(q=>q.bot&&(q.base||q.name)===b.name)})):null};
}
const BLITZ_MS=10000;
function blitzTick(R){
  if(!R.blitz||!R.clients)return;
  if(R.phase==='play'){const p=R.ps[R.cur];if(!p||!p.human||p.bot||p.away){R.bdl=0;return}
    const key=R.round+':'+R.ln+':'+R.cur+':'+(R.add==null?'':R.add);if(R.bk===key)return;R.bk=key;R.bdl=Date.now()+BLITZ_MS;clearTimeout(R.bT);
    R.bT=setTimeout(()=>{if(R.bk!==key||R.phase!=='play'||R.ps[R.cur]!==p)return;R.tenUsed=blocked(p);const lv=p.lvl;p.lvl='hard';try{bot(R,p)}finally{p.lvl=lv}
      R.msg='⏱ '+p.name+' ran out of time, so the computer moved. '+R.msg;push(R);kick(R)},BLITZ_MS+300)}
  else{R.bdl=0;if(R.phase==='over'&&R.over&&!R.over.done&&!R.bOver){R.bOver=setTimeout(()=>{R.bOver=null;if(R.phase==='over'&&!R.over.done){R.start=R.over.w;deal(R);push(R);kick(R)}},7000)}}}
function push(R){R.t=Date.now();try{blitzTick(R)}catch(e){}for(const c of R.clients)c.res.write(`data: ${JSON.stringify(view(R,c.pid))}\n\n`);if(R.slow)slowAfter(R);else liveAfter(R)}
// ---- live games survive a server restart or an update: saved to Upstash a moment after every change ----
const AWAY_MS=60000; // a disconnected player gets 1 minute before a computer takes their turns
const otherPeople=(R,q)=>R.ps.some(x=>x!==q&&x.human&&!x.bot&&!x.left); // a computer only stands in when real people are waiting
const liveKeep=R=>R.ps.some(q=>q.human&&!q.left)&&R.phase!=='gone';
function liveSave(R){if(!UP||R.slow||!liveKeep(R))return Promise.resolve();return up(['SET','ten:room:'+R.code,slowSer(R),'EX',String(R.tour?86400:6*3600)]).catch(()=>{})}
function liveAfter(R){if(!UP||stopping)return;clearTimeout(R.saveT);R.saveT=setTimeout(()=>{R.saveT=null;liveSave(R)},500)}
let stopping=false;
async function saveAll(){
  const ps=[];for(const R of Object.values(rooms)){if(!R.saveT)continue;clearTimeout(R.saveT);R.saveT=null;ps.push(R.slow?up(['SET','ten:room:'+R.code,slowSer(R),'EX',String(21*86400)]).catch(()=>{}):liveSave(R))}
  if(UP&&Object.keys(TOURS).length)ps.push(up(['SET','ten:tours',JSON.stringify(TOURS),'EX',String(3*86400)]).catch(()=>{}));
  await Promise.race([Promise.all(ps),new Promise(r=>setTimeout(r,8000))])}
if(typeof process!=='undefined'&&process.on)for(const sg of ['SIGTERM','SIGINT'])process.on(sg,async()=>{if(stopping)return;stopping=true;console.log(sg+': saving games before shutting down');await saveAll();process.exit(0)});
// ---- slow games (play by mail): saved to the database after every change, take your turn whenever you like ----
const SLOW_KEYS=['stake','stakeOk','stakeP','pot','code','phase','hm','blitz','ranked','mm','spare','lastSwap','teams','tsig','tour','tlabel','tStart','daily','recorded','coach','round','start','cur','pile','tenUsed','add','last','msg','over','fl','flt','ln','target','quick','slow','t','chat','hl','rb','cn','an','ach','speed','created'];
const P_KEYS=['swp','offRound','offOpts','id','vid','name','human','bot','lvl','host','tot','h','b','m','tenPh','tenJust','lm','base','gl','sty','left','ready','picked','wasLast'];
function slowSer(R){const o={};SLOW_KEYS.forEach(k=>o[k]=R[k]);o.ps=R.ps.map(q=>{const x={};P_KEYS.forEach(k=>x[k]=q[k]);return x});return JSON.stringify(o)}
function slowDes(j){const o=JSON.parse(j);const R={...o,clients:new Set(),tick:0,draw:null};R.ps=o.ps.map(x=>({...x,tip:null}));return R}
async function slowLoad(code){if(rooms[code])return rooms[code];if(!UP)return null;try{const r=await up(['GET','ten:room:'+code]);if(!r)return null;const R=slowDes(r);if(!rooms[code]){rooms[code]=R;if(R.phase==='draw'){deal(R)}if(R.phase==='play')setTimeout(()=>kick(R),500);
      if(!R.slow){R.msg=R.phase==='play'?'The game was updated. Welcome back!':R.msg;if(R.phase!=='lobby')R.ps.forEach(q=>{if(q.human&&!q.bot&&otherPeople(R,q))q.dcAt=Date.now()});setTimeout(()=>{R.ps.forEach(q=>q.dcAt=0);if(rooms[code]!==R||R.phase==='lobby')return;let ch=false;R.ps.forEach(q=>{if(q.human&&!q.bot&&!q.away&&otherPeople(R,q)&&![...R.clients].some(c=>c.pid===q.id)){q.away=true;q.lvl='hard';ch=true}});if(ch){R.msg='A computer is playing for anyone who has not come back yet.';push(R);kick(R)}},AWAY_MS)}}return rooms[code]}catch(e){return null}}
function slowAfter(R){
  clearTimeout(R.saveT);R.saveT=setTimeout(()=>{if(UP)up(['SET','ten:room:'+R.code,slowSer(R),'EX',String(21*86400)]).catch(()=>{})},400);
  // tell the player whose turn it is, if they aren't looking
  const q=R.ps[R.cur];
  if(R.phase==='play'&&q&&q.human&&!q.bot&&R.notified!==R.ln+':'+R.cur&&![...R.clients].some(c=>c.pid===q.id)){R.notified=R.ln+':'+R.cur;
    const k=FU&&FU.a&&FU.a[q.name.toLowerCase()]?q.name.toLowerCase():null;if(k)pushTo(k,{image:'/n-turn.jpg',emoji:'⏳',title:'Your move',body:`Slow game with ${R.ps.filter(x=>x!==q).map(x=>x.name).join(', ')}`,actions:[{action:'go',title:'Play now'},{action:'no',title:'Later'}],url:'/?join='+R.code,tag:'turn-'+R.code})}
  // slow games deal the next hand by themselves
  if(R.phase==='over'&&R.over&&!R.over.done&&!R.autoDeal){R.autoDeal=setTimeout(()=>{R.autoDeal=null;if(R.phase==='over'&&!R.over.done){R.start=R.over.w;deal(R);push(R);kick(R)}},6000)}
}
function slowIndex(R){if(!FU||!fuOK)return;FU.sg=FU.sg||{};let ch=false;R.ps.forEach(q=>{if(!q.human)return;const k=q.name.toLowerCase();if(!FU.a||!FU.a[k])return;const L=FU.sg[k]||(FU.sg[k]=[]);if(!L.includes(R.code)){L.unshift(R.code);FU.sg[k]=L.slice(0,20);ch=true}});if(ch)fuStore()}

const body=req=>new Promise(r=>{let s='';req.on('data',d=>{s+=d;if(s.length>1e5)req.destroy()});req.on('end',()=>{try{r(JSON.parse(s||'{}'))}catch{r({})}})});
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const groups={},rosters={},cool={};
const gcode=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
const plist=(g,code)=>{const ro=rosters[code]||new Map(),out=[];for(const r of ro.values()){const m=g&&g.get(r.pid);if(!m){out.push({id:r.pid,name:r.name,st:'off'});continue}const R=m.room&&rooms[m.room];out.push({id:m.pid,name:m.name,st:R?(R.phase==='lobby'?'lobby':'game'):'online'})}return out};
const pcast=code=>{const g=groups[code];if(!g)return;const d=`data: ${JSON.stringify({t:'list',players:plist(g,code)})}\n\n`;for(const m of g.values())try{m.res.write(d)}catch(e){}};
const FILES={'/':['index.html','text/html'],'/tv':['index.html','text/html'],'/manifest.json':['manifest.json','application/manifest+json'],'/icon.svg':['icon.svg','image/svg+xml'],'/badge-96.png':['badge-96.png','image/png'],'/n-online.jpg':['n-online.jpg','image/jpeg'],'/n-invite.jpg':['n-invite.jpg','image/jpeg'],'/n-turn.jpg':['n-turn.jpg','image/jpeg'],'/n-tour.jpg':['n-tour.jpg','image/jpeg'],'/win.mp3':['win.mp3','audio/mpeg'],'/lose.mp3':['lose.mp3','audio/mpeg'],'/champ.mp3':['champ.mp3','audio/mpeg'],'/gameover.mp3':['gameover.mp3','audio/mpeg'],'/groan.mp3':['groan.mp3','audio/mpeg'],'/laugh.mp3':['laugh.mp3','audio/mpeg'],'/sw.js':['sw.js','text/javascript'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png'],'/icon-maskable-512.png':['icon-maskable-512.png','image/png'],'/apple-touch-icon.png':['apple-touch-icon.png','image/png']};
// ---- friends list (people you add by friend code; not tied to a group) ----
// FU.u[pid]={c:code,n:name,f:[friend pids]}, FU.c[code]=pid. Saved next to the leaderboard.
let FU=null,fuOK=false;const me={},fcool={},PICS=new Map();
const FUF=LBF?LBF.replace('lb.json','friends.json'):null;
async function fuLoad(){if(FU&&fuOK)return FU;try{if(UP){const r=await up(['GET','ten:friends']);FU=r?JSON.parse(r):{}}else{try{FU=JSON.parse(fs.readFileSync(FUF,'utf8'))}catch(e){FU=FU||{}}}fuOK=true}catch(e){FU=FU||{};fuOK=false}FU.u=FU.u||{};FU.c=FU.c||{};FU.a=FU.a||{};return FU}
function fuStore(){if(!fuOK)return;const data=JSON.stringify(FU);lbSave=lbSave.then(async()=>{try{if(UP)await up(['SET','ten:friends',data]);else if(FUF)fs.writeFileSync(FUF,data)}catch(e){console.error('friends save failed',e.message)}})}
const AVS=['🃏','😎','🦊','🐯','🐼','🦁','🐸','🐙','🦄','🐲','👻','🎃','🤠','🧙','🦈','🔥','⚡','🌙','👑','🍀'];
// AUTO_FRIEND (a username, set in Render): that player automatically becomes friends with everyone who makes a profile
function autoFriend(pid){const o=String(process.env.AUTO_FRIEND||'').trim().toLowerCase(),A=o&&FU.a[o];if(!A||A.pid===pid)return false;
  const a=FU.u[pid],b=FU.u[A.pid];if(!a||!b)return false;let ch=false;if(!a.f.includes(A.pid)){a.f.push(A.pid);ch=true}if(!b.f.includes(pid)){b.f.push(pid);ch=true}if(ch){fsend(A.pid)}return ch}
const fcode=()=>{let c;do c=Array.from({length:6},()=>'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.random()*31|0]).join('');while(FU.c[c]);return c};
const fst=pid=>{const m=me[pid];if(!m)return 'off';const R=m.room&&rooms[m.room];return R&&R.phase!=='gone'?(R.phase==='lobby'?'lobby':'game'):'online'};
// suggested friends: friends of your friends you haven't added yet, most mutual friends first
function fsug(pid){const u=FU&&FU.u[pid];if(!u)return[];const mine=new Set(u.f||[]),hid=new Set(u.nh||[]),M={};
  for(const f of u.f||[]){const F=FU.u[f];if(!F)continue;for(const g of F.f||[]){if(g===pid||mine.has(g)||hid.has(g)||!FU.u[g])continue;(M[g]=M[g]||[]).push(F.n)}}
  const ac=x=>x.acct&&FU.a[x.acct];
  return Object.entries(M).map(([g,via])=>{const x=FU.u[g],A=ac(x);return{code:x.c,name:x.n,av:A?A.av:'',pic:A&&A.pic||0,user:!!x.acct,n:via.length,via:via.slice(0,2),seen:A?A.seen||0:0,st:fst(g)}})
    .sort((a,b)=>b.n-a.n||(b.st!=='off')-(a.st!=='off')||b.seen-a.seen).slice(0,6)}
function fsend(pid){const m=me[pid],u=FU&&FU.u[pid];if(!m||!u)return;const ac=x=>x.acct&&FU.a[x.acct],own=String(process.env.AUTO_FRIEND||'').trim().toLowerCase(),friends=(u.f||[]).map(q=>FU.u[q]).filter(Boolean).map(x=>({code:x.c,name:x.n,st:fst(FU.c[x.c]),av:ac(x)?ac(x).av:'',pic:ac(x)&&ac(x).pic||0,user:!!x.acct,seen:ac(x)?ac(x).seen||0:0,lock:!!own&&x.acct===own,fb:ac(x)?ac(x).fb||'':'',ti:x.acct?tierK(x.acct):'',bd:x.acct&&FU.x&&FU.x[x.acct]&&FU.x[x.acct].b?Object.keys(FU.x[x.acct].b).length:0}));const A=u.acct&&FU.a[u.acct];try{m.res.write(`data: ${JSON.stringify({t:'me',code:u.c,friends,sug:fsug(pid),acct:A?{u:A.u,av:A.av,t:A.t,pic:A.pic||0,fb:A.fb||'',ti:tierK(u.acct),tk:FU.x&&FU.x[u.acct]&&FU.x[u.acct].tk!=null?FU.x[u.acct].tk:TK.start}:null})}\n\n`)}catch(e){}}
function fnotify(pid){const u=FU&&FU.u[pid];if(!u)return;(u.f||[]).forEach(fsend)}
// ---- push notifications (Web Push, RFC 8291 + VAPID), built on Node's crypto, no extra libraries ----
const b64u=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const ub64=x=>Buffer.from(String(x).replace(/-/g,'+').replace(/_/g,'/'),'base64');
let VAPID=null;
async function vapid(){
  if(VAPID)return VAPID;let j=null;
  try{if(UP){const r=await up(['GET','ten:vapid']);if(r)j=JSON.parse(r)}}catch(e){}
  if(!j){const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pj=publicKey.export({format:'jwk'});
    j={pub:b64u(Buffer.concat([Buffer.from([4]),ub64(pj.x),ub64(pj.y)])),priv:privateKey.export({format:'jwk'})};try{if(UP)await up(['SET','ten:vapid',JSON.stringify(j)])}catch(e){}}
  VAPID={pub:j.pub,key:crypto.createPrivateKey({key:j.priv,format:'jwk'})};return VAPID}
function wpEncrypt(payload,p256dh,auth){
  const ua=ub64(p256dh),as=crypto.createECDH('prime256v1');as.generateKeys();const asPub=as.getPublicKey(),secret=as.computeSecret(ua),salt=crypto.randomBytes(16);
  const ikm=Buffer.from(crypto.hkdfSync('sha256',secret,ub64(auth),Buffer.concat([Buffer.from('WebPush: info\0'),ua,asPub]),32));
  const cek=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const c=crypto.createCipheriv('aes-128-gcm',cek,nonce),ct=Buffer.concat([c.update(Buffer.concat([Buffer.from(payload),Buffer.from([2])])),c.final(),c.getAuthTag()]);
  const rs=Buffer.alloc(4);rs.writeUInt32BE(4096);return Buffer.concat([salt,rs,Buffer.from([asPub.length]),asPub,ct])}
const picIcon=k=>{const A=FU&&FU.a&&FU.a[k];return A&&A.pic?`/pic/${encodeURIComponent(k)}?v=${A.pic}`:'/icon-192.png'};
async function pushTo(acctKey,msg){
  try{if(!FU||!FU.push||!acctKey)return;const subs=FU.push[acctKey];if(!subs||!subs.length||typeof fetch!=='function')return;const V=await vapid();
    const body=JSON.stringify(msg);let changed=false;
    for(const sub of subs.slice()){try{const aud=new URL(sub.endpoint).origin,now=Math.floor(Date.now()/1000);
      const data=b64u(JSON.stringify({typ:'JWT',alg:'ES256'}))+'.'+b64u(JSON.stringify({aud,exp:now+43200,sub:'mailto:ten-game@example.com'}));
      const jwt=data+'.'+b64u(crypto.sign('sha256',Buffer.from(data),{key:V.key,dsaEncoding:'ieee-p1363'}));
      const r=await fetch(sub.endpoint,{method:'POST',signal:AbortSignal.timeout(8000),headers:{TTL:'86400',Urgency:'high','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',Authorization:`vapid t=${jwt}, k=${V.pub}`},body:wpEncrypt(body,sub.keys.p256dh,sub.keys.auth)});
      if(r.status===404||r.status===410){FU.push[acctKey]=FU.push[acctKey].filter(x=>x.endpoint!==sub.endpoint);changed=true}}catch(e){}}
    if(changed)fuStore()}catch(e){}}
function markSeen(pid){const k=FU&&FU.u[pid]&&FU.u[pid].acct,A=k&&FU.a[k];if(!A)return;const now=Date.now(),old=A.seen||0;A.seen=now;if(now-(A.seenSaved||0)>5*60e3){A.seenSaved=now;fuStore()}}
setInterval(()=>{try{if(FU&&fuOK)Object.keys(me).forEach(p=>{const k=FU.u[p]&&FU.u[p].acct;if(k&&FU.a[k])FU.a[k].seen=Date.now()})}catch(e){}},60e3).unref?.();
const acctOf=pid=>{const u=FU&&FU.u[pid];return u&&u.acct||null};
// ---- "your friend just came online" notifications ----
const BOOT=Date.now(),lastOff={},lastNote={},MMQ=[];
const acctOnline=(k,except)=>Object.keys(me).some(p=>p!==except&&FU.u[p]&&FU.u[p].acct===k);
const fonOn=k=>{const x=FU.x&&FU.x[k];if(x&&x.fon!=null)return !!x.fon;const own=String(process.env.AUTO_FRIEND||'').trim().toLowerCase();return !!own&&k===own};
function onlineNotice(pid){
  const usr=FU.u[pid],k=usr&&usr.acct,A=k&&FU.a[k];if(!A)return;const now=Date.now();
  if(now-BOOT<(process.env.ONLINE_GRACE!=null?+process.env.ONLINE_GRACE:180000)||acctOnline(k,pid))return;                 // server just restarted, or they're already on another device
  if(lastOff[k]&&now-lastOff[k]<10*60e3)return;                  // only a quick reconnect
  if(lastNote[k]&&now-lastNote[k]<30*60e3)return;lastNote[k]=now;
  const sent=new Set();
  for(const fp of usr.f||[]){const f=FU.u[fp],fk=f&&f.acct;if(!fk||sent.has(fk)||fk===k)continue;sent.add(fk);
    if(!fonOn(fk)||acctOnline(fk)||!(FU.push&&FU.push[fk]&&FU.push[fk].length))continue;
    console.log('online notice:',A.u,'->',fk);pushTo(fk,{emoji:'🟢',title:`${A.u} is online`,body:'Up for a quick game?',image:'/n-online.jpg',icon:picIcon(k),actions:[{action:'go',title:'🃏 Deal me in'},{action:'no',title:'Later'}],url:'/?with='+usr.c,tag:'online-'+k})}
}
const acctOfPlayer=(R,q)=>{if(!q||!q.human||!FU||!FU.a)return null;const A=FU.a[q.name.toLowerCase()];return A?q.name.toLowerCase():null};
// ---- tournaments: tables of 3-4, each table's winner goes to the final table ----
const TOURS={};
const tcode=()=>{let c;do c=Array.from({length:5},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(TOURS[c]);return c};
function tourRoom(T,names,label){let code;do code=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(rooms[code]);
  const R=rooms[code]={code,ps:[],phase:'lobby',round:0,start:0,cur:0,pile:[],clients:new Set(),tick:0,fl:0,ln:0,last:null,tenUsed:false,add:null,draw:null,flt:'',msg:'',over:null,t:Date.now(),tour:T.code,tlabel:label,quick:true,target:T.target,tStart:Date.now()};
  names.forEach((n,i)=>{const q=addP(R,n,false);if(i===0)q.host=true});return code}
function tourSplit(n){const k=Math.ceil(n/4),base=Math.floor(n/k),extra=n%k;return [...Array(k)].map((_,i)=>base+(i<extra?1:0))}
function tourTick(){
  for(const T of Object.values(TOURS)){if(T.state==='done'||T.state==='lobby')continue;
    for(const tb of T.tables.concat(T.final?[T.final]:[])){const R=rooms[tb.room];if(!R)continue;
      if(R.phase==='lobby'){const here=new Set([...R.clients].map(c=>c.pid)),all=R.ps.every(q=>here.has(q.id));
        if(all||Date.now()-R.tStart>(+process.env.TOUR_WAIT||90000)){R.ps.forEach(q=>{if(!here.has(q.id)){q.away=true;q.lvl='hard'}});startDraw(R);push(R)}}
      else if(R.phase==='over'&&R.over&&!R.over.done){R.overAt=R.overAt||Date.now();const allAway=R.ps.every(q=>q.bot||q.away);
        // keep the night moving: deal the next hand after 15 seconds even if someone hasn't tapped
        if(Date.now()-R.overAt>(allAway?2000:15000)){R.overAt=0;R.start=R.over.w;deal(R);push(R);kick(R)}}
      else if(R.over&&R.over.done&&!tb.winner){const i=R.over.champs[0];tb.winner=R.ps[i].name;tb.scores=R.ps.map(q=>({name:q.name,tot:q.tot}))}}
    if(T.state==='tables'&&T.tables.every(t=>t.winner)){
      let fin=T.tables.map(t=>t.winner);
      if(fin.length<3){const ru=T.tables.flatMap(t=>t.scores.filter(x=>x.name!==t.winner)).sort((a,b)=>a.tot-b.tot);for(const r of ru){if(fin.length>=3)break;fin.push(r.name)}}
      T.final={players:fin,room:tourRoom(T,fin,'Final table')};T.state='final';
      fin.forEach(n=>{const k=n.toLowerCase();if(FU&&FU.a&&FU.a[k])pushTo(k,{title:'🏆 You made the final table',body:T.name,image:'/n-tour.jpg',url:'/?tour='+T.code,tag:'tour-'+T.code})})}
    if(T.state==='final'&&T.final.winner){T.state='done';T.champion=T.final.winner;T.ended=Date.now();
      if(FU&&fuOK){FU.x=FU.x||{};const k=T.champion.toLowerCase(),x=FU.x[k]||(FU.x[k]={b:{},h:{}});(x.tt=x.tt||[]).push({name:T.name,t:Date.now(),n:T.players.length});feedAdd(k,'won the '+T.name+' tournament','🏆');x.b=x.b||{};x.b.tchamp=x.b.tchamp||Date.now();fuStore()}}
  }
  for(const [c,T] of Object.entries(TOURS))if(Date.now()-(T.ended||T.t)>2*864e5)delete TOURS[c];
  const tj=JSON.stringify(TOURS);if(UP&&!stopping&&tj!==tourSaved&&Date.now()-tourSavedAt>10000){tourSaved=tj;tourSavedAt=Date.now();up(['SET','ten:tours',tj,'EX',String(3*86400)]).catch(()=>{tourSaved=''})}
}
let tourSaved='',tourSavedAt=0;
async function tourBoot(){if(!UP)return;try{const r=await up(['GET','ten:tours']);if(!r)return;const L=JSON.parse(r);for(const [c,T] of Object.entries(L)){if(TOURS[c])continue;TOURS[c]=T;for(const tb of T.tables.concat(T.final?[T.final]:[]))if(tb.room)await slowLoad(tb.room)}tourSaved=JSON.stringify(TOURS)}catch(e){console.error('tournament restore failed',e.message)}}
function tourView(T,acctName){const me=acctName&&acctName.toLowerCase();const tableOf=tb=>{const R=rooms[tb.room];return{room:tb.room,label:tb.label||(R&&R.tlabel),players:(R?R.ps.map(q=>({name:q.name,tot:q.tot,away:!!q.away})):tb.players.map(n=>({name:n,tot:0}))),phase:R?R.phase:'gone',round:R?R.round:0,winner:tb.winner||null,mine:(R?R.ps:[]).some(q=>q.name.toLowerCase()===me)}};
  return{code:T.code,name:T.name,host:T.host,state:T.state,target:T.target,players:T.players,tables:T.tables.map(tableOf),final:T.final?tableOf({...T.final,label:'Final table'}):null,champion:T.champion||null,isHost:!!me&&T.host.toLowerCase()===me,joined:!!me&&T.players.some(n=>n.toLowerCase()===me)}}
const dseed=d=>{let h=2166136261;for(const ch of 'ten-daily-'+d)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0};
setTimeout(()=>{fuLoad().catch(()=>{})},50);
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');
  if(req.method==='GET'&&u.pathname==='/api/events'){
    const R=rooms[u.searchParams.get('room')]||await slowLoad(String(u.searchParams.get('room')||'').toUpperCase().slice(0,4)),pid=u.searchParams.get('pid');
    if(!R||(!R.ps.some(p=>p.id===pid)&&!(R.specs&&R.specs.has(pid))&&!isAdm(R,pid))){res.writeHead(404);return res.end()}
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive','x-accel-buffering':'no'});
    const cl={res,pid};R.clients.add(cl);{const q=R.ps.find(x=>x.id===pid);if(q&&q.away){q.away=false;q.dcAt=0;R.msg=q.name+' is back.';push(R)}else if(q&&q.dcAt){q.dcAt=0;push(R)}if(q)clearTimeout(q.awayT)}res.write(`data: ${JSON.stringify(view(R,pid))}\n\n`);
    const ka=setInterval(()=>res.write(':\n\n'),20000);
    return req.on('close',()=>{clearInterval(ka);R.clients.delete(cl);
      {const q=R.ps.find(x=>x.id===pid);if(q&&q.human&&!q.bot&&!R.slow&&R.phase!=='lobby'&&R.phase!=='gone'&&otherPeople(R,q)){clearTimeout(q.awayT);q.dcAt=Date.now();setTimeout(()=>{if(q.dcAt&&![...R.clients].some(c=>c.pid===pid))push(R)},1500);q.awayT=setTimeout(()=>{
        q.dcAt=0;if([...R.clients].some(c=>c.pid===pid)||q.bot||R.phase==='gone')return;q.away=true;q.lvl='hard';R.msg=q.name+' lost connection. A computer is playing for them until they come back.';
        if(q.host){const n=R.ps.find(x=>x.human&&!x.bot&&!x.away&&[...R.clients].some(c=>c.pid===x.id));if(n){q.host=false;n.host=true}}
        push(R);kick(R)},AWAY_MS)}}if(R.voice&&R.voice.has(pid)&&![...R.clients].some(c=>c.pid===pid)){R.voice.delete(pid);push(R)}});
  }
  if(req.method==='POST'&&u.pathname==='/api/sig'){
    // WebRTC voice signalling: relay an offer/answer/ICE candidate to one other player in the same room
    const b=await body(req),R=rooms[b.room],p=R&&R.ps.find(x=>x.id===b.pid),q=R&&R.ps.find(x=>x.vid===b.to);
    if(!p||!q||!R.voice||!R.voice.has(p.id)||!R.voice.has(q.id))return send(res,404,{});
    const msg=`event: sig\ndata: ${JSON.stringify({from:p.vid,data:b.data})}\n\n`;
    for(const c of R.clients)if(c.pid===q.id)try{c.res.write(msg)}catch(e){}
    return send(res,200,{});
  }
  if(req.method==='GET'&&u.pathname==='/api/lb'){
    let L;try{L=await lbLoad()}catch(e){return send(res,200,{season:season(),current:season(),seasons:[],rows:[],saved:'cloud-error',err:e.message})}
    const m=/^\d{4}-\d{2}$/.test(u.searchParams.get('m')||'')?u.searchParams.get('m'):season();
    await fuLoad();awardTrophies();const prevS=Object.keys(L).sort().filter(x=>x<season()).pop();
    return send(res,200,{podium:prevS?{season:prevS,top:lbRank(L[prevS]).slice(0,3).map(([k,e])=>({name:e.name,wins:e.wins,games:e.games}))}:null,season:m,current:season(),seasons:Object.keys(L).sort().reverse(),rows:Object.entries(L[m]||{}).map(([k,e])=>({...e,fb:!e.bot&&FU&&FU.a&&FU.a[k]?FU.a[k].fb||'':'',ti:!e.bot?tierK(k):''})),saved:UP?(lbOK?'cloud':'cloud-error'):'server',err:lbWriteErr||lbErr});
  }
  if(req.method==='GET'&&u.pathname==='/api/home'){
    await fuLoad();const pid=String(u.searchParams.get('pid')||''),usr=FU.u[pid],k=usr&&usr.acct;if(!k)return send(res,200,{});
    const x=(FU.x&&FU.x[k])||{};if(x.rk)rkSeason(x);const wk=wkKey(),ms=x.ms&&x.ms.wk===wk?x.ms:{p:{},c:{}},E=evNow(),ev=x.ev&&x.ev[E.key]||{n:0};
    const fr=new Set((usr.f||[]).map(p=>FU.u[p]&&FU.u[p].acct).filter(Boolean));fr.add(k);
    const feed=(FU.feed||[]).filter(f=>fr.has(f.k)).slice(-8).reverse();
    const nx=new Date(wk+'T00:00:00Z');nx.setUTCDate(nx.getUTCDate()+7);
    return send(res,200,{missions:wkMissions(wk).map(m=>({id:m.id,txt:m.txt,n:m.n,tk:m.tk,p:ms.p[m.id]||0,done:!!ms.c[m.id]})),resets:nx.getTime(),
      event:E.id?{id:E.id,name:E.name,ic:E.ic,txt:E.txt,n:E.n,p:Math.min(E.n,ev.n),got:!!(x.backs&&x.backs[E.id])}:null,feed,elo:x.elo||1000,rk:x.rk||{w:0,l:0},ti:tierK(k),mmN:MMQ.length,st:stkState(x),fzCost:FREEZE.cost,fzMax:FREEZE.max,tut:!x.tut&&(FU.a[k].t||0)>Date.now()-7*864e5,tutB:TUT_BONUS,wrap:wrapOpen()?{y:wrapYear()}:null,grinch:grinchHome(k)});
  }
  if(req.method==='GET'&&u.pathname==='/api/wrap'){await fuLoad();await lbLoad();const usr=FU.u[String(u.searchParams.get('pid')||'')],k=usr&&usr.acct;if(!k)return send(res,401,{err:'Log in to see your year.'});return send(res,200,wrapOf(k))}
  if(req.method==='GET'&&u.pathname==='/api/grinch'){await fuLoad();const usr=FU.u[String(u.searchParams.get('pid')||'')],k=usr&&usr.acct;if(!k)return send(res,401,{err:'Log in to play.'});
    const pv=u.searchParams.get('pv')==='1',D=grDay();if(!pv&&!grOpen())return send(res,200,{closed:true});
    const n=pv?(+u.searchParams.get('d')||D.d):D.d,q=grQ(n),x=(FU.x&&FU.x[k])||{},r=!pv&&x.gr&&x.gr[D.key],st=(FU.grs&&FU.grs[D.key])||{ok:0,bad:0};
    return send(res,200,{pv,day:n,q:q[0],a:q[1],done:!!r,pick:r?r.pick:null,ok:r?r.ok:null,c:r?q[2]:null,win:GRINCH.win,steal:GRINCH.steal,score:Object.values(x.gr||{}).filter(v=>v.ok).length,tk:x.tk==null?TK.start:x.tk,stolen:st.bad*GRINCH.steal,players:st.ok+st.bad})}
  if(req.method==='POST'&&u.pathname==='/api/grinch'){const b=await body(req);await fuLoad();const usr=FU.u[String(b.pid||'')],k=usr&&usr.acct,x=k&&tkX(k);if(!x)return send(res,401,{err:'Log in to play.'});
    const pv=!!b.pv,D=grDay();if(!pv&&!grOpen())return send(res,400,{err:'The Grinch only visits December 1 to 25.'});
    const n=pv?(+b.d||D.d):D.d,q=grQ(n),pick=b.pick|0;if(pick<0||pick>=q[1].length)return send(res,400,{err:'Pick an answer.'});const ok=pick===q[2];
    if(pv)return send(res,200,{ok,c:q[2],pick,delta:0,tk:x.tk,pv:true});
    x.gr=x.gr||{};if(x.gr[D.key])return send(res,200,{ok:x.gr[D.key].ok,c:q[2],pick:x.gr[D.key].pick,delta:0,tk:x.tk,again:true});
    const before=x.tk||0,delta=ok?GRINCH.win:-Math.min(before,GRINCH.steal);x.tk=before+delta;x.gr[D.key]={ok,pick,d:delta};
    FU.grs=FU.grs||{};const st=FU.grs[D.key]||(FU.grs[D.key]={ok:0,bad:0});if(ok)st.ok++;else st.bad++;
    if(ok)feedAdd(k,'outsmarted the Grinch today','🎄');fuStore();tkPing(k);return send(res,200,{ok,c:q[2],pick,delta,tk:x.tk})}
  if(req.method==='POST'&&u.pathname==='/api/freeze'){
    const b=await body(req);await fuLoad();const usr=FU.u[String(b.pid||'')],k=usr&&usr.acct,x=k&&tkX(k);if(!x)return send(res,401,{err:'Log in first.'});
    const st=x.st||(x.st={d:'',n:0,best:0,fz:0});if((st.fz||0)>=FREEZE.max)return send(res,400,{err:`You can hold ${FREEZE.max} freezes at most.`});
    if((x.tk||0)<FREEZE.cost)return send(res,400,{err:`A freeze costs ${FREEZE.cost} tokens.`});
    x.tk-=FREEZE.cost;st.fz=(st.fz||0)+1;fuStore();tkPing(k);return send(res,200,{fz:st.fz,tk:x.tk})}
  // ---- matchmaking: "Play someone now" pairs two searching players into a ranked 1v1 ----
  if(req.method==='POST'&&u.pathname==='/api/mm'){
    const b=await body(req);await fuLoad();const pid=String(b.pid||''),usr=FU.u[pid],k=usr&&usr.acct;if(!k)return send(res,401,{err:'Log in to play ranked.'});
    for(let i=MMQ.length-1;i>=0;i--)if(MMQ[i].k===k)MMQ.splice(i,1);
    if(!b.on)return send(res,200,{off:true});
    const other=MMQ.find(m=>m.k!==k&&me[m.pid]);
    if(other){MMQ.splice(MMQ.indexOf(other),1);let code;do code=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(rooms[code]);
      rooms[code]={code,ps:[],phase:'lobby',round:0,start:0,cur:0,pile:[],clients:new Set(),tick:0,fl:0,ln:0,last:null,tenUsed:false,add:null,draw:null,flt:'',msg:'Ranked match! Starting as soon as you are both here.',over:null,t:Date.now(),ranked:true,quick:true,target:100,mm:[other.k,k]};
      try{me[other.pid].res.write(`data: ${JSON.stringify({t:'match',room:code,vs:FU.a[k].u})}\n\n`)}catch(e){}
      return send(res,200,{room:code,vs:FU.a[other.k].u})}
    MMQ.push({k,pid,t:Date.now()});return send(res,200,{waiting:true,n:MMQ.length})}
  if(req.method==='GET'&&u.pathname==='/api/me'){
    const pid=String(u.searchParams.get('pid')||'').replace(/[^a-z0-9]/gi,'').slice(0,24),name=String(u.searchParams.get('name')||'').trim().slice(0,12);
    if(pid.length<6||!name){res.writeHead(400);return res.end()}
    await fuLoad();let usr=FU.u[pid],changed=false;
    if(!usr){usr=FU.u[pid]={c:fcode(),n:name,f:[]};FU.c[usr.c]=pid;changed=true}else if(!usr.acct&&usr.n!==name){usr.n=name;changed=true}
    if(changed)fuStore();
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive','x-accel-buffering':'no'});
    const old=me[pid];if(old)try{old.res.end()}catch(e){}
    const m=me[pid]={res,name,room:old?old.room:null};markSeen(pid);fsend(pid);fnotify(pid);try{onlineNotice(pid)}catch(e){console.error('online notice',e.message)}
    const ka=setInterval(()=>{try{res.write(':\n\n')}catch(e){}},20000);
    return req.on('close',()=>{clearInterval(ka);for(let i=MMQ.length-1;i>=0;i--)if(MMQ[i].pid===pid)MMQ.splice(i,1);if(me[pid]===m){delete me[pid];markSeen(pid);fnotify(pid);const k=FU&&FU.u[pid]&&FU.u[pid].acct;if(k)lastOff[k]=Date.now()}});
  }
  if(req.method==='POST'&&['/api/signup','/api/login','/api/avatar','/api/logout','/api/photo','/api/pin','/api/badge','/api/fon','/api/back'].includes(u.pathname)){
    const b=await body(req);await fuLoad();
    if(!fuOK)return send(res,503,{err:"Profiles can't be reached right now. Try again in a minute."});
    const uname=String(b.username||'').trim(),key=uname.toLowerCase(),pin=String(b.pin||'');
    const hash=(pin,salt)=>crypto.scryptSync(pin,salt,32).toString('hex');
    if(u.pathname==='/api/signup'){
      const pid=String(b.pid||'').replace(/[^a-z0-9]/gi,'').slice(0,24);
      if(!/^[A-Za-z0-9_]{3,12}$/.test(uname))return send(res,400,{err:'Usernames are 3 to 12 letters, numbers or _.'});
      if(!/^\d{4,8}$/.test(pin))return send(res,400,{err:'Your PIN must be 4 to 8 digits.'});
      if(FU.a[key])return send(res,409,{err:'That username is taken. Try another one.'});
      if(pid.length<6)return send(res,400,{err:'Open the game first, then try again.'});
      let usr=FU.u[pid];if(!usr){usr=FU.u[pid]={c:fcode(),n:uname,f:[]};FU.c[usr.c]=pid}
      if(usr.acct&&FU.a[usr.acct])return send(res,400,{err:'This device already has a profile. Log out first.'});
      const salt=crypto.randomBytes(12).toString('hex');FU.a[key]={u:uname,s:salt,h:hash(pin,salt),pid,av:'🃏',t:Date.now()};usr.acct=key;usr.n=uname;
      autoFriend(pid);fuStore();fsend(pid);fnotify(pid);return send(res,200,{username:uname});
    }
    if(u.pathname==='/api/login'){
      const A=FU.a[key],ck='login:'+key,now=Date.now(),c=fcool[ck]||{n:0,t:now};if(now-c.t>10*60e3){c.n=0;c.t=now}
      if(c.n>=6)return send(res,429,{err:'Too many tries. Wait 10 minutes and try again.'});
      if(!A||hash(pin,A.s)!==A.h){c.n++;fcool[ck]=c;return send(res,401,{err:'Wrong username or PIN.'})}
      c.n=0;fcool[ck]=c;return send(res,200,{pid:A.pid,username:A.u});
    }
    const pid=String(b.pid||''),usr=FU.u[pid],A=usr&&usr.acct&&FU.a[usr.acct];
    if(!A)return send(res,400,{err:'You are not logged in.'});
    if(u.pathname==='/api/pin'){
      const np=String(b.newpin||'');
      if(hash(pin,A.s)!==A.h)return send(res,401,{err:'Your current PIN is wrong.'});
      if(!/^\d{4,8}$/.test(np))return send(res,400,{err:'Your new PIN must be 4 to 8 digits.'});
      A.s=crypto.randomBytes(12).toString('hex');A.h=hash(np,A.s);fuStore();return send(res,200,{});
    }
    if(u.pathname==='/api/photo'){
      const d=String(b.photo||'');
      if(!d){A.pic=0;PICS.delete(usr.acct);try{if(UP)await up(['DEL','ten:pic:'+usr.acct])}catch(e){}fuStore();fsend(pid);fnotify(pid);return send(res,200,{pic:0})}
      if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d)||d.length>80000)return send(res,400,{err:'That picture is too big or not a photo. Try another one.'});
      try{if(UP)await up(['SET','ten:pic:'+usr.acct,d])}catch(e){return send(res,503,{err:"Couldn't save the picture. Try again."})}
      PICS.set(usr.acct,d);A.pic=Date.now();fuStore();fsend(pid);fnotify(pid);return send(res,200,{pic:A.pic});
    }
    if(u.pathname==='/api/back'){FU.x=FU.x||{};const x=FU.x[usr.acct]||(FU.x[usr.acct]={b:{},h:{}}),id=String(b.back||'');if(id&&!(x.backs&&x.backs[id]))return send(res,400,{err:"You haven't unlocked that card back yet."});x.back=id;fuStore();for(const R of Object.values(rooms))if(R.ps.some(q=>q.human&&q.name.toLowerCase()===usr.acct))push(R);return send(res,200,{back:id})}
    if(u.pathname==='/api/fon'){FU.x=FU.x||{};const x=FU.x[usr.acct]||(FU.x[usr.acct]={b:{},h:{}});x.fon=!!b.on;fuStore();return send(res,200,{fon:x.fon})}
    if(u.pathname==='/api/badge'){const k=String(b.badge||'');const X=(FU.x&&FU.x[usr.acct])||{};if(k&&!(X.b&&X.b[k]))return send(res,400,{err:"You haven't earned that badge yet."});A.fb=k;fuStore();fsend(pid);fnotify(pid);return send(res,200,{fb:A.fb})}
    if(u.pathname==='/api/avatar'){const av=String(b.av||'');if(!AVS.includes(av))return send(res,400,{err:'Pick one of the pictures.'});A.av=av;fuStore();fsend(pid);fnotify(pid);return send(res,200,{})}
    return send(res,200,{});
  }
  if(req.method==='GET'&&u.pathname.startsWith('/pic/')){
    const key=decodeURIComponent(u.pathname.slice(5)).toLowerCase().replace(/[^a-z0-9_]/g,'');let d=PICS.get(key);
    if(!d&&UP){try{d=await up(['GET','ten:pic:'+key]);if(d)PICS.set(key,d)}catch(e){}}
    const m=d&&/^data:(image\/[a-z]+);base64,(.*)$/.exec(d);if(!m){res.writeHead(404);return res.end()}
    res.writeHead(200,{'content-type':m[1],'cache-control':'public, max-age=604800'});return res.end(Buffer.from(m[2],'base64'));
  }
  if(u.pathname==='/admin'&&req.method==='GET'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>10 admin</title>
<style>body{font:16px system-ui,sans-serif;background:#0e1621;color:#f3ecdc;margin:0 auto;max-width:460px;padding:20px}h1{font-family:Georgia,serif;color:#e6bd63}input,select,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #2a3a4c;background:#121c27;color:#f3ecdc;margin:6px 0}button{background:#e6bd63;color:#20160a;font-weight:700;border:0}#out{margin-top:12px;padding:12px;border-radius:12px;background:#1a2532;min-height:1em}small{color:#9eaebb}</style>
<h1>10 · admin</h1>${process.env.ADMIN_KEY?'':'<p style="color:#f08a9b">Admin is turned off. Add an ADMIN_KEY environment variable in Render to turn it on.</p>'}
<label>Admin password<input id="k" type="password" autocomplete="current-password"></label>
<label>Username<input id="u" autocapitalize="off" autocomplete="off"></label>
<label>What to do<select id="a"><option value="reset">Reset PIN to a temporary one</option><option value="info">Look up the profile</option><option value="nophoto">Remove their photo</option><option value="befriend">Make me friends with every profile (uses AUTO_FRIEND)</option><option value="pair">Make two players friends</option><option value="tokens">Give tokens (use a minus number to take away)</option><option value="gadd">🎄 Add a Christmas question about Greg</option><option value="glist">🎄 See the Christmas questions</option><option value="gdel">🎄 Delete one of my Christmas questions</option></select></label>
<label id="gql" style="display:none">Question<input id="gq" autocomplete="off" placeholder="What is Greg's favorite food?"></label>
<label id="gal" style="display:none">Answers, one per line. Put a * in front of the right one.<textarea id="ga" rows="4" style="font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #2a3a4c;background:#121c27;color:#f3ecdc" placeholder="*Pizza&#10;Tacos&#10;Sushi&#10;Burgers"></textarea></label>
<label id="gnl" style="display:none">Question number to delete<input id="gn" inputmode="numeric" autocomplete="off"></label>
<label id="ul2" style="display:none">Second username<input id="u2" autocapitalize="off" autocomplete="off"></label>
<label id="pl">New temporary PIN (4 to 8 digits)<input id="p" inputmode="numeric" autocomplete="off"></label>
<label id="tl" style="display:none">How many tokens<input id="t" inputmode="numeric" autocomplete="off" placeholder="100"></label>
<button id="go">Do it</button><button id="watch" style="background:#2e9d5b;color:#fff">👀 Watch live games (everyone's cards)</button><div id="out"><small>Results show here.</small></div>
<script>const $=id=>document.getElementById(id);$('a').onchange=()=>{$('pl').style.display=$('a').value==='reset'?'':'none';$('tl').style.display=$('a').value==='tokens'?'':'none';$('ul2').style.display=$('a').value==='pair'?'':'none';const v=$('a').value;$('gql').style.display=$('gal').style.display=v==='gadd'?'':'none';$('gnl').style.display=v==='gdel'?'':'none';$('u').parentNode.style.display=v.startsWith('g')&&v!=='glist'||v==='glist'?'none':''};
$('watch').onclick=()=>{const k=$('k').value;if(!k){$('out').textContent='Type the admin password first.';return}location.href='/stats?key='+encodeURIComponent(k)};
$('go').onclick=async()=>{$('out').textContent='Working…';const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:$('k').value,username:$('u').value,username2:$('u2').value,act:$('a').value,pin:$('p').value,tokens:$('t').value,gq:$('gq').value,ga:$('ga').value,gn:$('gn').value})});const j=await r.json().catch(()=>({err:'Something went wrong.'}));$('out').textContent=j.err||j.msg}</script><style>#out{white-space:pre-wrap}</style>`);
  }
  if(req.method==='POST'&&u.pathname==='/api/admin'){
    const b=await body(req),K=process.env.ADMIN_KEY,ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0],ck='admin:'+ip,now=Date.now(),c=fcool[ck]||{n:0,t:now};
    if(!K)return send(res,403,{err:'Admin is turned off. Add ADMIN_KEY in Render first.'});
    if(now-c.t>15*60e3){c.n=0;c.t=now}if(c.n>=8)return send(res,429,{err:'Too many wrong passwords. Wait 15 minutes.'});
    const kb=Buffer.from(String(b.key||'')),Kb=Buffer.from(K),ok=kb.length===Kb.length&&crypto.timingSafeEqual(kb,Kb);
    if(!ok){c.n++;fcool[ck]=c;return send(res,401,{err:'Wrong admin password.'})}
    await fuLoad();if(!fuOK)return send(res,503,{err:"Can't reach the database right now. Try again in a minute."});
    if(b.act==='pair'){const k1=String(b.username||'').trim().toLowerCase(),k2=String(b.username2||'').trim().toLowerCase(),A1=FU.a[k1],A2=FU.a[k2];
      if(!A1||!A2)return send(res,404,{err:'No profile called "'+String((!A1?b.username:b.username2)||'').trim()+'".'});if(A1===A2)return send(res,400,{err:'Those are the same player.'});
      const x=FU.u[A1.pid],y=FU.u[A2.pid];if(!x||!y)return send(res,404,{err:'One of those profiles is incomplete.'});
      if(x.f.includes(A2.pid)&&y.f.includes(A1.pid))return send(res,200,{msg:`${A1.u} and ${A2.u} are already friends.`});
      if(!x.f.includes(A2.pid))x.f.push(A2.pid);if(!y.f.includes(A1.pid))y.f.push(A1.pid);fuStore();fsend(A1.pid);fsend(A2.pid);return send(res,200,{msg:`Done. ${A1.u} and ${A2.u} are now friends.`})}
    if(b.act==='gadd'){const q=String(b.gq||'').trim().slice(0,200),L=String(b.ga||'').split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,4),c=L.findIndex(x=>x.startsWith('*'));
      if(!q)return send(res,400,{err:'Type the question.'});if(L.length<2)return send(res,400,{err:'Type at least 2 answers, one per line.'});if(c<0||L.filter(x=>x.startsWith('*')).length>1)return send(res,400,{err:'Put a * in front of exactly one answer (the right one).'});
      FU.gq=FU.gq||[];if(FU.gq.length>=40)return send(res,400,{err:'That\'s 40 questions already. Delete one first.'});FU.gq.push({q,a:L.map(x=>x.replace(/^\*\s*/,'').slice(0,60)),c});fuStore();
      return send(res,200,{msg:`Added as question ${FU.gq.length}. Your questions are asked first (Dec 1 = your question 1), then the built-in Greg questions.`})}
    if(b.act==='glist'){const L=FU.gq||[];return send(res,200,{msg:(L.length?'Your questions (asked first):\n'+L.map((q,i)=>`${i+1}. ${q.q}\n   ${q.a.map((a,j)=>(j===q.c?'✅ ':'• ')+a).join('\n   ')}`).join('\n'):'You haven\'t added any questions yet.')+`\n\nPlus ${GQ.length} built-in Greg questions. December day 1 to 25 uses them in order. Preview on your phone: open the site with /?grinch=1`})}
    if(b.act==='gdel'){const i=(+b.gn|0)-1,L=FU.gq||[];if(!L[i])return send(res,404,{err:'No question with that number. Use "See the Christmas questions" to find it.'});const [g]=L.splice(i,1);fuStore();return send(res,200,{msg:`Deleted: ${g.q}`})}
    if(b.act==='tokens'){const k=String(b.username||'').trim().toLowerCase(),A=FU.a[k],n=Math.round(+b.tokens);if(!A)return send(res,404,{err:'No profile called "'+String(b.username||'').trim()+'".'});if(!n||Math.abs(n)>100000)return send(res,400,{err:'Type a number of tokens, like 100.'});
      const x=tkX(k);x.tk=Math.max(0,(x.tk||0)+n);fuStore();tkPing(k);for(const R of Object.values(rooms))if(R.ps.some(q=>q.human&&q.name.toLowerCase()===k))push(R);return send(res,200,{msg:`Done. ${A.u} now has ${x.tk} tokens (${n>0?'+':''}${n}).`})}
    if(b.act==='befriend'){const o=String(process.env.AUTO_FRIEND||'').trim();if(!o||!FU.a[o.toLowerCase()])return send(res,400,{err:'Set AUTO_FRIEND in Render to your username first (and make sure that profile exists).'});
      let n=0;for(const A of Object.values(FU.a))if(autoFriend(A.pid)){n++;fsend(A.pid)}fuStore();return send(res,200,{msg:`Done. Added ${n} new friend${n===1?'':'s'} to ${FU.a[o.toLowerCase()].u}.`})}
    const key=String(b.username||'').trim().toLowerCase(),A=FU.a[key];if(!A)return send(res,404,{err:'No profile with the username "'+String(b.username||'').trim()+'".'});
    if(b.act==='reset'){const pin=String(b.pin||'');if(!/^\d{4,8}$/.test(pin))return send(res,400,{err:'The temporary PIN must be 4 to 8 digits.'});
      A.s=crypto.randomBytes(12).toString('hex');A.h=crypto.scryptSync(pin,A.s,32).toString('hex');fcool['login:'+key]={n:0,t:now};fuStore();
      return send(res,200,{msg:`Done. ${A.u} can now log in with PIN ${pin}. Ask them to change it on their profile page right away.`})}
    if(b.act==='nophoto'){A.pic=0;PICS.delete(key);try{if(UP)await up(['DEL','ten:pic:'+key])}catch(e){}fuStore();const usr=FU.u[A.pid];if(usr){fsend(A.pid);fnotify(A.pid)}return send(res,200,{msg:`Removed ${A.u}'s photo.`})}
    const usr=FU.u[A.pid];return send(res,200,{msg:`${A.u}: profile created ${new Date(A.t).toLocaleDateString('en-US')}, ${usr?usr.f.length:0} friends, ${A.pic?'has a photo':'no photo'}.`});
  }
  if(req.method==='GET'&&u.pathname==='/api/slow'){
    await fuLoad();const k=acctOf(String(u.searchParams.get('pid')||''));if(!k)return send(res,200,{games:[]});
    const codes=(FU.sg&&FU.sg[k])||[],out=[],keep=[];
    for(const c of codes){const R=await slowLoad(c);if(!R||R.phase==='gone')continue;keep.push(c);const i=R.ps.findIndex(q=>q.human&&q.name.toLowerCase()===k);
      out.push({code:c,with:R.ps.filter((q,j)=>j!==i).map(q=>q.name),round:R.round,phase:R.phase,yourTurn:R.phase==='play'&&R.cur===i,turn:R.phase==='play'?R.ps[R.cur].name:null,done:!!(R.over&&R.over.done),tot:i>=0?R.ps[i].tot:0,t:R.t})}
    if(keep.length!==codes.length){FU.sg[k]=keep;fuStore()}
    return send(res,200,{games:out.sort((a,b)=>(b.yourTurn-a.yourTurn)||b.t-a.t)})}
  if(u.pathname.startsWith('/api/tour')){
    await fuLoad();const b=req.method==='POST'?await body(req):{},pid=String(b.pid||u.searchParams.get('pid')||''),k=acctOf(pid),A=k&&FU.a[k];
    const T=TOURS[String(b.code||u.searchParams.get('code')||'').toUpperCase().trim()];
    if(u.pathname==='/api/tour'&&req.method==='GET'){if(!T)return send(res,404,{err:'No tournament with that code. It may have ended.'});return send(res,200,tourView(T,A&&A.u))}
    if(!A)return send(res,401,{err:'Log in to your profile first.'});
    if(u.pathname==='/api/tour/create'){const name=String(b.name||'').trim().slice(0,30)||`${A.u}'s tournament`;const T2={code:tcode(),name,host:A.u,players:[A.u],state:'lobby',tables:[],final:null,t:Date.now(),target:[100,150].includes(+b.target)?+b.target:100};TOURS[T2.code]=T2;return send(res,200,tourView(T2,A.u))}
    if(!T)return send(res,404,{err:'No tournament with that code. It may have ended.'});
    if(u.pathname==='/api/tour/join'){if(T.state!=='lobby'&&!T.players.includes(A.u))return send(res,400,{err:'That tournament has already started.'});if(!T.players.includes(A.u)){if(T.players.length>=16)return send(res,400,{err:'That tournament is full (16 players).'});T.players.push(A.u)}return send(res,200,tourView(T,A.u))}
    if(u.pathname==='/api/tour/leave'){if(T.state==='lobby'&&A.u!==T.host)T.players=T.players.filter(n=>n!==A.u);return send(res,200,{})}
    if(u.pathname==='/api/tour/start'){if(T.host!==A.u)return send(res,403,{err:'Only the host can start the tournament.'});if(T.state!=='lobby')return send(res,400,{err:'Already started.'});if(T.players.length<3)return send(res,400,{err:'You need at least 3 players.'});
      const ppl=T.players.slice().sort(()=>Math.random()-.5);
      if(ppl.length<6){T.final={players:ppl,room:tourRoom(T,ppl,'Final table')};T.state='final'}
      else{let i=0;T.tables=tourSplit(ppl.length).map((n,j)=>{const ps=ppl.slice(i,i+n);i+=n;return{players:ps,room:tourRoom(T,ps,'Table '+(j+1)),label:'Table '+(j+1)}});T.state='tables'}
      T.players.forEach(n=>{const kk=n.toLowerCase();if(FU.a[kk]&&n!==A.u)pushTo(kk,{emoji:'🏆',title:`${T.name} is starting`,body:'Head to your table.',image:'/n-tour.jpg',url:'/?tour='+T.code,tag:'tour-'+T.code})});
      return send(res,200,tourView(T,A.u))}
    return send(res,404,{})}
  if(req.method==='GET'&&u.pathname==='/api/vapid'){const V=await vapid();return send(res,200,{key:V.pub})}
  if(req.method==='POST'&&(u.pathname==='/api/push/sub'||u.pathname==='/api/push/unsub')){
    const b=await body(req);await fuLoad();const k=acctOf(String(b.pid||''));if(!k)return send(res,400,{err:'Log in to your profile first.'});
    const sub=b.sub||{};if(!/^https:\/\//.test(String(sub.endpoint||'')))return send(res,400,{err:'Bad subscription.'});
    FU.push=FU.push||{};const L=(FU.push[k]||[]).filter(x=>x.endpoint!==sub.endpoint);
    if(u.pathname==='/api/push/sub'){if(!sub.keys||!sub.keys.p256dh||!sub.keys.auth)return send(res,400,{err:'Bad subscription.'});L.unshift({endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}})}
    FU.push[k]=L.slice(0,5);fuStore();
    if(u.pathname==='/api/push/sub'&&b.test)pushTo(k,{title:'Notifications are on 🔔',body:"You'll hear about invites and your turns.",url:'/',tag:'test'});
    return send(res,200,{})}
  if(req.method==='GET'&&u.pathname==='/api/daily'){
    await fuLoad();const d=day(),D=(FU.d&&FU.d[d])||{},rows=Object.values(D).sort((a,b)=>a.pts-b.pts||a.left-b.left||a.t-b.t).map(r=>({name:r.name,pts:r.pts,out:r.out}));
    const k=String(u.searchParams.get('name')||'').toLowerCase();return send(res,200,{day:d,rows,mine:D[k]?{pts:D[k].pts,out:D[k].out}:null});
  }
  if(req.method==='POST'&&u.pathname==='/api/watch'){
    const b=await body(req),pid=String(b.pid||''),code=String(b.code||'').toUpperCase();await fuLoad();
    const a=FU.u[pid],tp=FU.c[code],t=me[tp],R=t&&t.room&&rooms[t.room];
    if(!a||!tp||!a.f.includes(tp))return send(res,404,{err:'That person is not on your friends list.'});
    if(!R||R.phase==='gone')return send(res,404,{err:"Your friend isn't in a game right now."});
    if(R.daily)return send(res,400,{err:"Your friend is playing the daily challenge. No peeking!"});
    const tok='spec'+rid()+rid();(R.specs=R.specs||new Map()).set(tok,a.n);(R.specK=R.specK||{})[tok]=a.acct||null;if(R.specs.size>20)R.specs.delete(R.specs.keys().next().value);
    return send(res,200,{room:R.code,spec:tok});
  }
  if(req.method==='GET'&&u.pathname==='/api/profile'){
    await fuLoad();const key=String(u.searchParams.get('u')||'').toLowerCase(),A=FU.a[key];
    if(!A)return send(res,404,{err:'No profile with that username.'});
    const L=await lbLoad(),cur=season();let g=0,w=0,pts=0,best=null,sg=0,sw=0;
    for(const [m,S] of Object.entries(L)){const e=S[key];if(!e)continue;g+=e.games;w+=e.wins;pts+=e.pts;if(e.best!=null&&(best==null||e.best<best))best=e.best;if(m===cur){sg=e.games;sw=e.wins}}
    const usr=FU.u[A.pid];
    const X=(FU.x&&FU.x[key])||{};if(X.rk)rkSeason(X);const rv=Object.values(X.h||{}).filter(r=>r.w+r.l>0).sort((a,b)=>(b.w+b.l)-(a.w+a.l)).slice(0,12);
    awardTrophies();
    return send(res,200,{tourWins:(X.tt||[]).slice(-10).reverse(),gregLevel:X.gl||0,trophies:(X.tr||[]).slice().sort((a,b)=>b.s.localeCompare(a.s)),badges:X.b||{},rivals:rv,username:A.u,av:A.av,pic:A.pic||0,seen:A.seen||0,online:acctOnline(key),fb:A.fb||'',ti:tierK(key),tiers:TIERS.map(T=>({id:T.id,ic:T.ic,n:T.n,min:T.min})),rkh:X.rkh||[],fon:fonOn(key),elo:X.elo||1000,rk:X.rk||{w:0,l:0},backs:Object.keys(X.backs||{}),back:X.back||'',tk:X.tk==null?TK.start:X.tk,since:A.t,code:usr?usr.c:'',friends:usr?usr.f.length:0,games:g,wins:w,avg:g?Math.round(pts/g):null,best,season:{games:sg,wins:sw}});
  }
  if(req.method==='POST'&&u.pathname==='/api/mstatus'){
    const b=await body(req),pid=String(b.pid||''),m=me[pid];if(!m)return send(res,404,{});
    m.room=String(b.room||'').toUpperCase().slice(0,4)||null;fnotify(pid);return send(res,200,{});
  }
  if(req.method==='POST'&&(u.pathname==='/api/friend'||u.pathname==='/api/unfriend')){
    const b=await body(req),pid=String(b.pid||''),code=String(b.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    await fuLoad();const a=FU.u[pid],raw=String(b.code||'').trim().toLowerCase(),tp=FU.c[code]||(FU.a[raw]&&FU.a[raw].pid),t=tp&&FU.u[tp];
    if(!a)return send(res,400,{err:'Type your name and open the game first.'});
    if(!t)return send(res,404,{err:'No player has the code or username '+String(b.code||'').trim()+'.'});
    if(tp===pid)return send(res,400,{err:"That's your own friend code."});
    if(!fuOK)return send(res,503,{err:'Friends can\'t be saved right now. Try again in a minute.'});
    if(u.pathname==='/api/friend'){if(a.f.includes(tp))return send(res,200,{name:t.n,already:true});if(a.f.length>=100)return send(res,400,{err:'Your friends list is full.'});a.f.push(tp);if(!t.f.includes(pid))t.f.push(pid)}
    else{const o=String(process.env.AUTO_FRIEND||'').trim().toLowerCase(),O=o&&FU.a[o];if(O&&O.pid===tp)return send(res,403,{err:`${t.n} can't be removed from your friends.`});a.f=a.f.filter(x=>x!==tp);t.f=t.f.filter(x=>x!==pid)}
    fuStore();fsend(pid);fsend(tp);return send(res,200,{name:t.n});
  }
  if(req.method==='POST'&&u.pathname==='/api/fhide'){
    const b=await body(req),pid=String(b.pid||''),tp=FU&&FU.c[String(b.code||'').toUpperCase()],a=FU&&FU.u[pid];
    if(!a||!tp)return send(res,404,{});a.nh=[...(a.nh||[]).filter(x=>x!==tp),tp].slice(-200);fuStore();fsend(pid);return send(res,200,{});
  }
  if(req.method==='POST'&&u.pathname==='/api/finvite'){
    const b=await body(req),pid=String(b.pid||''),code=String(b.code||'').toUpperCase(),R=rooms[String(b.room||'').toUpperCase()];
    await fuLoad();const a=FU.u[pid],tp=FU.c[code],t=me[tp];
    if(!a||!tp||!a.f.includes(tp))return send(res,404,{err:'That person is not on your friends list.'});
    if(!t){if(R&&R.phase==='lobby'&&me[pid]&&me[pid].room===R.code&&acctOf(tp)&&FU.push&&FU.push[acctOf(tp)]&&FU.push[acctOf(tp)].length){pushTo(acctOf(tp),{emoji:'📨',title:`${a.n} wants to play`,body:'Your seat is waiting.',image:'/n-invite.jpg',icon:picIcon(a.acct||''),actions:[{action:'go',title:'🃏 Join'},{action:'no',title:'Not now'}],url:'/?join='+R.code,tag:'invite'});return send(res,200,{pushed:true})}return send(res,404,{err:`${(FU.u[tp]&&FU.u[tp].n)||'That friend'} isn't in the app and hasn't turned on notifications. Tap Send invite link and text it to them instead.`})}
    if(!R||R.phase!=='lobby'||!me[pid]||me[pid].room!==R.code)return send(res,400,{err:'Create a game first, then invite friends.'});
    if(R.ps.length>=8)return send(res,400,{err:'That game is full.'});
    const k=pid+'>'+tp;if(Date.now()-(fcool[k]||0)<8000)return send(res,429,{err:'Invite already sent. Give them a moment.'});
    fcool[k]=Date.now();try{t.res.write(`data: ${JSON.stringify({t:'invite',from:a.n,room:R.code})}\n\n`)}catch(e){}
    pushTo(acctOf(tp),{emoji:'📨',title:`${a.n} wants to play`,body:'Your seat is waiting.',image:'/n-invite.jpg',icon:picIcon(a.acct||''),actions:[{action:'go',title:'🃏 Join'},{action:'no',title:'Not now'}],url:'/?join='+R.code,tag:'invite'});
    return send(res,200,{});
  }
  if(req.method==='GET'&&u.pathname==='/api/presence'){
    const code=gcode(u.searchParams.get('group')),pid=String(u.searchParams.get('pid')||'').replace(/[^a-z0-9]/gi,'').slice(0,24),name=String(u.searchParams.get('name')||'').trim().slice(0,12);
    if(code.length<3||pid.length<6||!name){res.writeHead(400);return res.end()}
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive','x-accel-buffering':'no'});
    const g=groups[code]||(groups[code]=new Map()),old=g.get(pid);if(old)try{old.res.end()}catch(e){}
    const m={pid,name,res,room:old?old.room:null};g.set(pid,m);
    const ro=rosters[code]||(rosters[code]=new Map());for(const [k,r] of ro)if(k!==pid&&r.name.toLowerCase()===name.toLowerCase()&&!g.has(k))ro.delete(k);
    ro.set(pid,{pid,name,seen:Date.now()});if(ro.size>60){const o=[...ro.values()].filter(r=>!g.has(r.pid)).sort((a,b)=>a.seen-b.seen)[0];if(o)ro.delete(o.pid)}
    pcast(code);
    const ka=setInterval(()=>{try{res.write(':\n\n')}catch(e){}},20000);
    return req.on('close',()=>{clearInterval(ka);const gg=groups[code];if(gg&&gg.get(pid)===m){gg.delete(pid);const r=rosters[code]&&rosters[code].get(pid);if(r)r.seen=Date.now();if(!gg.size)delete groups[code];else pcast(code)}});
  }
  if(req.method==='GET'&&(u.pathname==='/api/stats'||u.pathname==='/stats')){
    const live={rooms:0,playing:0,lobbies:0,people:0,inGames:0},seen=new Set();
    for(const R of Object.values(rooms)){if(R.phase==='gone')continue;live.rooms++;if(R.phase==='lobby')live.lobbies++;else live.playing++;
      const here=new Set([...R.clients].map(c=>c.pid));R.ps.forEach(q=>{if(q.human&&!q.bot&&here.has(q.id)){seen.add(q.id);if(R.phase!=='lobby')live.inGames++}})}
    live.people=seen.size;let online=0;for(const g of Object.values(groups))online+=g.size;live.friendsOnline=online;
    const S=await stLoad(),days=Object.keys(S).sort().reverse(),today=S[day()]||{started:0,finished:0,players:[]};
    const all=new Set();let started=0,finished=0;days.forEach(k=>{started+=S[k].started;finished+=S[k].finished;S[k].players.forEach(n=>all.add(n))});
    const last7=days.slice(0,7).map(k=>({day:k,started:S[k].started,finished:S[k].finished,players:S[k].players.length}));
    const out={live,today:{started:today.started,finished:today.finished,players:today.players.length},allTime:{started,finished,players:all.size,since:days[days.length-1]||null},last7,saved:UP?(stOK?'cloud':'cloud-error'):'server'};
    if(u.pathname==='/api/stats')return send(res,200,out);
    const AK=process.env.ADMIN_KEY,qk=String(u.searchParams.get('key')||''),showNames=!!AK&&qk.length===AK.length&&crypto.timingSafeEqual(Buffer.from(qk),Buffer.from(AK));
    const row=(a,b)=>`<tr><td>${a}</td><td>${b}</td></tr>`;
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>10 stats</title>
<style>body{font:16px system-ui,sans-serif;background:#14142e;color:#e8ecfb;margin:0;padding:16px;max-width:520px;margin:auto}h1{margin:.2em 0}h2{font-size:15px;color:#9aa3c7;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.05em}.big{display:grid;grid-template-columns:1fr 1fr;gap:10px}.big div{background:#1f1f45;border-radius:14px;padding:12px}.big b{display:block;font-size:30px}table{width:100%;border-collapse:collapse}td,th{padding:7px 4px;border-bottom:1px solid #2c2c5a;text-align:left}td:last-child,th:last-child{text-align:right}small{color:#9aa3c7}</style>
<h1>10 · who's playing</h1><small>Updates every 20 seconds · ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})}</small>
<h2>Right now</h2><div class="big"><div><b>${live.people}</b>people connected</div><div><b>${live.inGames}</b>in a game</div><div><b>${live.playing}</b>games going</div><div><b>${live.lobbies}</b>lobbies waiting</div></div>
<p><small>${live.friendsOnline} online in friend groups.</small></p>
${showNames?`<h2>Games right now</h2>${Object.values(rooms).filter(R=>R.phase!=='gone'&&R.ps.some(q=>q.human)).map(R=>{const here=new Set([...R.clients].map(c=>c.pid));return `<p style="margin:14px 0 4px"><a style="color:#e6bd63;font-weight:700" href="/?spec=${R.code}.${admTok(R.code)}">👁 Watch game ${R.code} with everyone's cards</a></p><table style="margin-bottom:10px"><tr><th>Game ${R.code}${R.daily?' (daily)':''}</th><th>${R.phase==='lobby'?'In the lobby':R.phase==='over'?'Between hands':'Playing'}${R.round?' · round '+R.round:''}</th></tr>${R.ps.map(q=>`<tr><td>${q.name.replace(/[<>&]/g,'')}${q.host?' (host)':''}</td><td>${q.bot&&!q.human?'computer ('+q.lvl+')':q.bot?'left the game':q.away?'away':here.has(q.id)?'connected':'reconnecting…'}</td></tr>`).join('')}</table>`}).join('')||'<p><small>Nobody is in a game right now.</small></p>'}${Object.keys(groups).length?`<h2>Online in friend groups</h2><table>${Object.entries(groups).map(([c,g])=>[...g.values()].map(m=>`<tr><td>${m.name.replace(/[<>&]/g,'')}</td><td>${c}</td></tr>`).join('')).join('')}</table>`:''}`:'<p><small>Add <b>?key=</b> followed by your admin password to the address to see names.</small></p>'}
<h2>Today</h2><table>${row('Games started',out.today.started)}${row('Games finished',out.today.finished)}${row('Different players',out.today.players)}</table>
<h2>Last 7 days</h2><table><tr><th>Day</th><th>Started</th><th>Finished</th><th>Players</th></tr>${last7.map(d=>`<tr><td>${d.day}</td><td>${d.started}</td><td>${d.finished}</td><td>${d.players}</td></tr>`).join('')||'<tr><td colspan=4><small>No games yet.</small></td></tr>'}</table>
<h2>All time${out.allTime.since?' (since '+out.allTime.since+')':''}</h2><table>${row('Games started',started)}${row('Games finished',finished)}${row('Different players',all.size)}</table>
<p><small>${out.saved==='cloud'?'✓ Totals saved to the cloud.':out.saved==='server'?'⚠️ Totals reset when the server restarts (Upstash not connected).':'⚠️ Cannot reach the database right now.'} Computer players are not counted. Players are counted by name.</small></p>`);
  }
  if(req.method==='GET'&&u.pathname==='/api/ver')return send(res,200,{greg:'v61 streaks, ranked tiers, token stakes, guided first game, 10 Wrapped, Christmas Greg quiz, end-of-hand sound toggle, v60 suggested friends, v59 flipped four of a kind lets you choose to add, v57 friends last online, v56 Legend about 80 percent with a modest deal edge, fair Master, v52 short TV link, v51 party mode TV, ghost players, predictions, v50 weekly missions, blitz, ranked matchmaking, friend feed, Greg mood, seasonal card backs, v49 new app icon, iPhone emoji titles and badge count, v48 notification artwork, v47 cleaner notifications, v46 friend-online notifications, v45 admin watch button, v44 Legend boss luck, v43 rebuilt Greg ladder difficulty, v42 pick 1 of 3 swaps, admin give tokens, v41 token catch-up for existing players, v40 tokens and card swaps vs computers, v39 one 10 per turn, turn passes when only 10s are left, v37 featured badge, v36 friend profiles with badges, v35 1-minute disconnect countdown, v34 one 10 per turn, no computer stand-in when playing only bots, v33 games survive updates, cleaner home and lobby, v32 2v2 partners, big cards, vibration, 1v1, invite buttons, challenge Greg button, v31 tournaments, slow games, push notifications, coach, Greg ladder, trophies, share cards, admin pair friends, profiles required, unique names, no bot chat, admin watch with all cards, owner cannot be unfriended, auto-friend, everyone taps Next to deal, rejoin after leaving, away autoplay, change PIN and admin PIN reset, rematch, trash talk, achievements, rivalries, house rules, daily challenge, spectating, highlights, profile photos, profiles with usernames, friends list, stats page, safer leaderboard saving, prefers playing all its kings/queens/jacks together, season leaderboard, voice chat, text chat and reactions, saves 10s and aces',rolloutsPerSec:bench(),moves:GS.moves,avgDeepRounds:GS.moves?+(GS.rounds/GS.moves).toFixed(2):0,avgStage1Ms:GS.moves?Math.round(GS.stage1ms/GS.moves):0,avgTotalMs:GS.moves?Math.round(GS.totalms/GS.moves):0,avgOptions:GS.moves?+(GS.cands/GS.moves).toFixed(1):0,node:process.version});
  if(req.method==='POST'&&u.pathname==='/api/pstatus'){
    const b=await body(req),code=gcode(b.group),m=groups[code]&&groups[code].get(String(b.pid||''));
    if(!m)return send(res,404,{});
    m.room=String(b.room||'').toUpperCase().slice(0,4)||null;pcast(code);return send(res,200,{});
  }
  if(req.method==='POST'&&u.pathname==='/api/invite'){
    const b=await body(req),code=gcode(b.group),g=groups[code],m=g&&g.get(String(b.pid||'')),t=g&&g.get(String(b.to||'')),R=rooms[String(b.room||'').toUpperCase()];
    if(!m||!t||t===m)return send(res,404,{err:'That friend is not online.'});
    if(!R||R.phase!=='lobby'||m.room!==R.code)return send(res,400,{err:'Create a game first, then invite friends.'});
    if(R.ps.length>=8)return send(res,400,{err:'That game is full.'});
    const k=m.pid+'>'+t.pid;if(Date.now()-(cool[k]||0)<8000)return send(res,429,{err:'Invite already sent. Give them a moment.'});
    cool[k]=Date.now();try{t.res.write(`data: ${JSON.stringify({t:'invite',from:m.name,room:R.code})}\n\n`)}catch(e){}
    return send(res,200,{});
  }
  if(req.method==='POST'&&u.pathname==='/api/join'){
    const b=await body(req);let name=String(b.name||'').trim().slice(0,12)||'Player',code=String(b.room||'').toUpperCase().trim(),R;
    // a profile is required to play: the player's name is always their username
    const REQ=process.env.REQUIRE_PROFILE!=='0';let acct=null;
    if(REQ){await fuLoad();const tu=FU.u[String(b.tp||'')];acct=tu&&tu.acct&&FU.a[tu.acct]||null;if(acct)name=acct.u}
    const rejoining=code&&rooms[code]&&rooms[code].ps.some(x=>x.id===b.pid);if(code&&!rooms[code])await slowLoad(code);
    if(REQ&&!acct&&!rejoining)return send(res,401,{err:'Create a profile or log in to play.',needProfile:true});
    if(b.daily){
      await fuLoad();const d=day(),k=name.toLowerCase(),done=FU.d&&FU.d[d]&&FU.d[d][k];
      if(done)return send(res,409,{err:"You've already played today's challenge. Come back tomorrow!"});
      {const A=FU.a[k];if(A&&A.pid!==String(b.tp||''))return send(res,403,{err:'The name '+name+' belongs to a profile. Log in, or pick another name.'})}
      do code=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(rooms[code]);
      R=rooms[code]={code,ps:[],phase:'lobby',round:0,start:0,cur:0,pile:[],clients:new Set(),tick:0,fl:0,ln:0,last:null,tenUsed:false,add:null,draw:null,flt:'',msg:'',over:null,t:Date.now(),daily:d};
      const p=addP(R,name,false);addP(R,'Ella',true,'impossible');addP(R,'Findley',true,'expert');R.start=0;seeded(dseed(d),()=>deal(R));R.msg="Today's challenge: everyone gets this same deal. Go out with as few points as possible.";
      push(R);setTimeout(()=>kick(R),400);return send(res,200,{pid:p.id,room:code});
    }
    if(!code){do code=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(rooms[code]);
      R=rooms[code]={code,ps:[],phase:'lobby',round:0,start:0,cur:0,pile:[],clients:new Set(),tick:0,fl:0,ln:0,last:null,tenUsed:false,add:null,draw:null,flt:'',msg:'',over:null,t:Date.now()}}
    else R=rooms[code]||await slowLoad(code);
    if(!R)return send(res,404,{err:'No game with that code.'});
    if((R.slow||R.tour)&&acct){const q=R.ps.find(x=>x.human&&x.name.toLowerCase()===acct.u.toLowerCase());if(q){if(q.bot&&q.left){q.bot=false;q.left=false}push(R);return send(res,200,{pid:q.id,room:code})}}
    {await fuLoad();const A=FU.a[name.toLowerCase()];if(A&&A.pid!==String(b.tp||'')&&!R.ps.some(x=>x.id===b.pid))return send(res,403,{err:'The name '+name+' belongs to a profile. Log in, or pick another name.'})}
    let p=R.ps.find(x=>x.id===b.pid);
    if(!p&&R.ranked&&!(R.mm||[]).includes(name.toLowerCase())&&!R.ps.some(x=>x.human&&x.name.toLowerCase()===name.toLowerCase()))return send(res,403,{err:'That is a ranked match between two other players.'});
    if(!p&&R.phase!=='lobby'){const q=R.ps.find(x=>x.human&&(x.left||x.away)&&x.name.toLowerCase()===name.toLowerCase());if(q){q.bot=false;q.left=false;q.away=false;R.msg=q.name+' is back.';push(R);kick(R);return send(res,200,{pid:q.id,room:code})}}
    if(!p){if(R.phase!=='lobby')return send(res,403,{err:'That game has already started. If you were in it, use the same name you played with.'});if(R.ps.length>=8)return send(res,403,{err:'That game is full.'});if(R.ps.some(q=>(q.base||q.name).toLowerCase()===name.toLowerCase()||q.name.toLowerCase()===name.toLowerCase()))return send(res,409,{err:'Someone in this game is already called '+name+'. Pick a different name.'});p=addP(R,name,false)}
    if(R.ranked&&R.phase==='lobby'&&R.ps.length===2&&!R.rkStart){R.rkStart=1;setTimeout(()=>{if(R.phase==='lobby'&&R.ps.length===2){startDraw(R);push(R)}},1800)}
    push(R);return send(res,200,{pid:p.id,room:code});
  }
  if(req.method==='POST'&&u.pathname==='/api/predict'){
    const b=await body(req),R=rooms[String(b.room||'')],k=R&&R.specK&&R.specK[String(b.spec||'')];await fuLoad();
    if(!R||!k)return send(res,404,{err:'Only people watching can make a prediction.'});
    if(R.phase==='lobby'||(R.over&&R.over.done)||R.round>2||R.daily||R.tour)return send(res,400,{err:'Predictions close after the second hand.'});
    R.preds=R.preds||{};if(R.preds[k])return send(res,400,{err:'You already made your prediction.'});
    const pick=String(b.pick||''),q=R.ps.find(x=>x.name===pick);if(!q)return send(res,400,{err:'Pick one of the players.'});
    const x=tkX(k);if(!x||x.tk<PRED.stake)return send(res,400,{err:`A prediction costs ${PRED.stake} tokens.`});
    x.tk-=PRED.stake;fuStore();tkPing(k);R.preds[k]={pick,t:Date.now()};push(R);return send(res,200,{})}
  if(req.method==='GET'&&u.pathname==='/api/cfg')return send(res,200,{tv:String(process.env.TV_URL||'tinyurl.com/play10tv').trim().replace(/^https?:\/\//,'')});
  if(req.method==='POST'&&u.pathname==='/api/tv'){
    const b=await body(req),code=String(b.room||'').toUpperCase().trim(),R=rooms[code]||await slowLoad(code);
    if(!R||R.phase==='gone')return send(res,404,{err:'No game with that code. Check the code on a player\'s phone.'});
    if(R.daily)return send(res,400,{err:"That's a daily challenge. Pick a regular game."});
    const tok='spec'+rid()+rid();(R.specs=R.specs||new Map()).set(tok,'📺 TV');if(R.specs.size>20)R.specs.delete(R.specs.keys().next().value);return send(res,200,{room:R.code,spec:tok})}
  if(req.method==='POST'&&u.pathname==='/api/act'){
    const b=await body(req),R=rooms[b.room],p=R&&R.ps.find(x=>x.id===b.pid);
    if(!p)return send(res,404,{err:'Not in this game.'});
    act(R,p,b);return send(res,200,{});
  }
  const f=FILES[u.pathname];
  if(!f){res.writeHead(404);return res.end('Not found')}
  fs.readFile(path.join(__dirname,f[0]),(e,d)=>{if(e){console.error('FILE ERROR:',e);res.writeHead(500);return res.end('File error: '+e.message)}res.writeHead(200,{'content-type':f[1],'cache-control':'no-cache'});res.end(d)});
}).listen(PORT,'0.0.0.0',()=>{
  console.log('\n10 is running. Open one of these on every phone on your wifi:\n');
  for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)console.log('  http://'+i.address+':'+PORT);
  console.log('');
});
setInterval(()=>{for(const k in cool)if(Date.now()-cool[k]>60e3)delete cool[k]},60e3);
setInterval(tourTick,3000);tourBoot();setInterval(()=>{try{streakNudge()}catch(e){}},10*60e3).unref?.();
// ---- one-time token catch-up: players who were here before tokens existed get credit for everything they've done ----
async function tkBackfill(){try{
  await fuLoad();await lbLoad();if(!fuOK||!lbOK||!FU||FU.tkv)return;
  const games={},wins={},daily={};
  for(const S of Object.values(LB||{}))for(const [k,e] of Object.entries(S||{})){if(e.bot)continue;games[k]=(games[k]||0)+(e.games||0);wins[k]=(wins[k]||0)+(e.wins||0)}
  for(const D of Object.values(FU.d||{}))for(const k of Object.keys(D||{}))daily[k]=(daily[k]||0)+1;
  FU.x=FU.x||{};const log=[];
  for(const k of Object.keys(FU.a||{})){const x=FU.x[k]||(FU.x[k]={b:{},h:{}});
    const due=TK.start+TK.game*(games[k]||0)+TK.win*Math.round(wins[k]||0)+TK.daily*(daily[k]||0)+TK.badge*Object.keys(x.b||{}).length;
    const before=x.tk;x.tk=Math.max(x.tk==null?0:x.tk,due);log.push(`${k}: ${before==null?'new':before} -> ${x.tk}`)}
  FU.tkv=1;fuStore();console.log('token catch-up done for',log.length,'players:',log.join(', '));
  for(const k of Object.keys(FU.a||{}))tkPing(k)}catch(e){console.error('token catch-up failed',e.message)}}
tkBackfill();const tkBfT=setInterval(()=>{if(FU&&FU.tkv)return clearInterval(tkBfT);tkBackfill()},300000);
setInterval(()=>{const cut=Date.now()-14*864e5;for(const c in rosters){for(const [k,r] of rosters[c])if(r.seen<cut&&!(groups[c]&&groups[c].has(k)))rosters[c].delete(k);if(!rosters[c].size)delete rosters[c]}for(const k in rooms)if(!rooms[k].clients.size&&Date.now()-rooms[k].t>2*3600e3)delete rooms[k]},600e3);
