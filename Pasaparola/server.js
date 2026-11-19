const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');

const scrypt=promisify(crypto.scrypt);
const ROOT=__dirname;
const DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'data');
const DB_FILE=path.join(DATA_DIR,'accounts.json');
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
const sessions=new Map(),attempts=new Map();
let db={users:{}};
let writeQueue=Promise.resolve();

function json(res,status,payload,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(payload))}
function cookie(req,res,token,maxAge){const secure=process.env.NODE_ENV==='production'||String(req.headers['x-forwarded-proto']).includes('https');res.setHeader('Set-Cookie',`kc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`)}
function readCookie(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kc_session='))?.slice('kc_session='.length)||''}
function currentUser(req){const token=readCookie(req),session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null}return db.users[session.userId]||null}
function makeSession(req,res,user){const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,{userId:user.id,expires:Date.now()+14*86400000});cookie(req,res,token,14*86400)}
function rateLimited(req){const ip=req.socket.remoteAddress||'unknown',now=Date.now(),items=(attempts.get(ip)||[]).filter(t=>now-t<15*60*1000);items.push(now);attempts.set(ip,items);return items.length>20}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw new Error('İstek çok büyük.')}try{return JSON.parse(raw||'{}')}catch{throw new Error('Gönderilen bilgi okunamadı.')}}
function persist(){writeQueue=writeQueue.then(async()=>{await fs.promises.mkdir(DATA_DIR,{recursive:true});const temp=DB_FILE+'.tmp';await fs.promises.writeFile(temp,JSON.stringify(db),'utf8');await fs.promises.rename(temp,DB_FILE)});return writeQueue}
async function route(req,res){const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/me'){const user=currentUser(req);return json(res,200,{user:user?{id:user.id,email:user.email}:null})}
  if(req.method==='POST'&&['/api/register','/api/login'].includes(url.pathname)){
    if(rateLimited(req))return json(res,429,{error:'Çok fazla deneme yapıldı. 15 dakika sonra tekrar dene.'});
    let input;try{input=await body(req)}catch(e){return json(res,400,{error:e.message})}
    const email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,400,{error:'Geçerli bir e-posta adresi yaz.'});
    if(password.length<8||password.length>200)return json(res,400,{error:'Şifre 8 ile 200 karakter arasında olmalı.'});
    let user=Object.values(db.users).find(u=>u.email===email);
    if(url.pathname==='/api/register'){
      if(user)return json(res,409,{error:'Bu e-posta ile zaten hesap var. Giriş yapmayı dene.'});
      const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);
      user={id:crypto.randomUUID(),email,salt,passwordHash:hash.toString('hex'),data:{},createdAt:new Date().toISOString()};db.users[user.id]=user;await persist();
    }else{
      if(!user)return json(res,401,{error:'E-posta veya şifre yanlış.'});
      const hash=await scrypt(password,user.salt,64);if(!crypto.timingSafeEqual(hash,Buffer.from(user.passwordHash,'hex')))return json(res,401,{error:'E-posta veya şifre yanlış.'});
    }
    makeSession(req,res,user);return json(res,200,{user:{id:user.id,email:user.email}})
  }
  if(req.method==='POST'&&url.pathname==='/api/logout'){const token=readCookie(req);sessions.delete(token);cookie(req,res,'',0);return json(res,200,{ok:true})}
  const user=currentUser(req);
  if(req.method==='GET'&&url.pathname==='/api/state'){if(!user)return json(res,401,{error:'Giriş yapmalısın.'});return json(res,200,{data:user.data||{}})}
  if(req.method==='POST'&&url.pathname==='/api/state'){
    if(!user)return json(res,401,{error:'Giriş yapmalısın.'});let input;try{input=await body(req)}catch(e){return json(res,400,{error:e.message})}
    if(!input.data||typeof input.data!=='object'||Array.isArray(input.data))return json(res,400,{error:'Kayıt biçimi geçersiz.'});
    user.data=input.data;await persist();return json(res,200,{ok:true})
  }
  return null;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8','.png':'image/png','.sql':'text/plain; charset=utf-8'};
async function handle(req,res){try{const result=await route(req,res);if(result!==null)return;if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Bu işlem desteklenmiyor.'});let requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(requested==='/')requested='/index.html';const fileName=path.basename(requested);const publicFiles=new Set(['index.html','pasaparola.html','account.js','word-bank.js','word-overrides.json','manifest.webmanifest','service-worker.js','icon-192.png','icon-512.png','WORD-DATA-LICENSE.txt']);if(!publicFiles.has(fileName)||requested!=='/'+fileName)return json(res,404,{error:'Sayfa bulunamadı.'});const file=path.resolve(ROOT,'.'+requested);const stat=await fs.promises.stat(file).catch(()=>null);if(!stat?.isFile())return json(res,404,{error:'Sayfa bulunamadı.'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res)}catch(e){console.error(e);json(res,500,{error:'Sunucu hatası oluştu.'})}}
async function start(){await fs.promises.mkdir(DATA_DIR,{recursive:true});try{db=JSON.parse(await fs.promises.readFile(DB_FILE,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}http.createServer(handle).listen(PORT,HOST,()=>console.log(`Kelime Çemberi sunucusu çalışıyor: http://localhost:${PORT}`))}
start().catch(error=>{console.error('Sunucu başlatılamadı:',error);process.exitCode=1});
