(() => {
  const KEYS=['kelimecemberi-current','kelimecemberi-daily-progress','kelimecemberi-game-history','kelimecemberi-missed','kelimecemberi-recent','kelimecemberi-streak'];
  const manager=window.accountManager={user:null,configured:false,online:false,hydrating:false,timer:null};
  const $=id=>document.getElementById(id);
  const localKey=key=>manager.storageKey(key);
  manager.storageKey=key=>manager.user?`kelimecemberi-user:${manager.user.id}:${key}`:key;
  const message=(text,error=false)=>{$('accountMessage').textContent=text;$('accountMessage').style.color=error?'#c24e3a':'var(--muted)'};
  function updateUI(){
    $('accountForm').classList.toggle('hidden',!!manager.user);$('signedInBox').classList.toggle('hidden',!manager.user);
    $('signedInEmail').textContent=manager.user?.email||'';$('openAccount').textContent=manager.user?'Hesabım':'Hesap';
    $('accountStatus').textContent=manager.user?'Giriş yaptın. Oyun ilerlemen hesabında saklanıyor.':manager.online?'E-postan ve şifrenle giriş yap veya yeni hesap oluştur.':'Hesap sunucusu henüz çalışmıyor. Başlatma yönergesi için tıkla.';
  }
  async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'İstek tamamlanamadı.');return result}
  async function loadState(){manager.hydrating=true;try{const {data={}}=await api('/api/state');for(const key of KEYS){const full=localKey(key);if(Object.hasOwn(data,key))localStorage.setItem(full,JSON.stringify(data[key]));else localStorage.removeItem(full)}}finally{manager.hydrating=false}}
  async function saveState(){if(!manager.user||manager.hydrating)return;const data={};for(const key of KEYS){try{const raw=localStorage.getItem(localKey(key));if(raw!==null)data[key]=JSON.parse(raw)}catch{}}await api('/api/state',{data})}
  manager.queueSave=()=>{if(!manager.user||manager.hydrating)return;clearTimeout(manager.timer);manager.timer=setTimeout(()=>saveState().catch(()=>message('İnternet bağlantısı kesildi; bu cihazdaki kayıt duruyor.',true)),500)};
  manager.open=()=>{$('accountOverlay').style.display='grid';updateUI();message('')};
  async function setUser(user){manager.user=user||null;updateUI();if(manager.user){try{await loadState();message('Oyun kayıtların hesabınla eşitlendi.');$('accountOverlay').style.display='none';if(window.showMenu)window.showMenu()}catch(e){message(e.message||'Hesap verileri yüklenemedi.',true)}}}
  async function init(){try{const result=await api('/api/me');manager.online=true;manager.configured=true;await setUser(result.user||null)}catch{manager.online=false;manager.configured=false;updateUI()}}
  window.accountReady=init();
  $('openAccount').addEventListener('click',manager.open);$('closeAccount').addEventListener('click',()=>$('accountOverlay').style.display='none');
  $('accountForm').addEventListener('submit',async e=>{e.preventDefault();if(!manager.online){message('Önce web sunucusunu başlatmalısın. Başlatma yönergesine bak.',true);return}const button=$('accountSubmit');button.disabled=true;message('Giriş yapılıyor…');try{const result=await api('/api/login',{email:$('accountEmail').value.trim(),password:$('accountPassword').value});await setUser(result.user)}catch(err){message(err.message,true)}finally{button.disabled=false}});
  $('accountSignup').addEventListener('click',async()=>{if(!manager.online){message('Önce web sunucusunu başlatmalısın. Başlatma yönergesine bak.',true);return}const email=$('accountEmail').value.trim(),password=$('accountPassword').value;if(!email||password.length<8){message('E-posta yaz ve en az 8 karakterli şifre belirle.',true);return}const button=$('accountSignup');button.disabled=true;message('Hesap oluşturuluyor…');try{const result=await api('/api/register',{email,password});await setUser(result.user)}catch(err){message(err.message,true)}finally{button.disabled=false}});
  $('accountSignout').addEventListener('click',async()=>{try{await saveState();await api('/api/logout',{})}finally{manager.user=null;updateUI();location.reload()}});
})();
