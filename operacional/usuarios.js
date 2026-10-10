import {getApps,getApp,initializeApp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged,sendPasswordResetEmail,signOut} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,setDoc,updateDoc,onSnapshot,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
// Authentication valida o login; usuarios/{UID} define role e ativo.
// Nenhuma conta Authentication é criada pelo navegador sem autorização do servidor.
const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app),cloud=getFunctions(app,"southamerica-east1");
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=s=>String(s||"").trim();
let current=null,admin=false,users=[],unsubList=null,unsubSelf=null,busy=false,epoch=0;
const allowed=()=>admin&&!!current;
const modal=(id,show)=>$(id).classList.toggle("show",show);
function announce(s,warning=false){$("usersMessage").textContent=s;$("usersMessage").classList.toggle("warning",warning)}
function clear(){
  if(unsubList){unsubList();unsubList=null}
  if(unsubSelf){unsubSelf();unsubSelf=null}
  current=null;admin=false;users=[];
  $("usersNav").classList.add("auth-hidden");
  modal("usersCreateModal",false);modal("usersEditModal",false);
  $("usersTotal").textContent="—";$("usersActive").textContent="—";$("usersAdmins").textContent="—";
  $("usersTable").innerHTML='<div class="users-empty">Aguardando Autorização.</div>';
}
function render(){
  const ordered=[...users].sort((a,b)=>a.ativo!==b.ativo?(a.ativo===true?-1:1):String(a.nome||a.email||"").localeCompare(String(b.nome||b.email||""),"pt-BR"));
  $("usersTotal").textContent=users.length;
  $("usersActive").textContent=users.filter(u=>u.ativo===true).length;
  $("usersAdmins").textContent=users.filter(u=>u.ativo===true&&u.role==="admin").length;
  const q=clean($("usersSearch").value).toLocaleLowerCase("pt-BR");
  const selected=ordered.filter(u=>[u.nome,u.email,u.id].some(v=>String(v||"").toLocaleLowerCase("pt-BR").includes(q)));
  $("usersTable").innerHTML=selected.length?selected.map(u=>{
    const own=u.id===current?.uid;
    const initial=String(u.nome||u.email||"?").trim().charAt(0).toLocaleUpperCase("pt-BR");
    return '<div class="users-row"><div class="users-person"><div class="users-avatar">'+escape(initial)+'</div>'+
      '<div class="users-person-detail"><strong>'+escape(u.nome||"Sem Nome")+(own?' (Você)':'')+'</strong>'+
      '<span>'+escape(u.email||"E-mail Não Informado")+'</span></div></div>'+
      '<span class="users-role">'+(u.role==="admin"?"Administrador":"Operador")+'</span>'+
      '<span class="users-status '+(u.ativo===true?"active":"inactive")+'">'+(u.ativo===true?"● Ativo":"● Desativado")+'</span>'+
      '<div class="users-actions"><button type="button" data-users-edit="'+escape(u.id)+'" '+(own?'disabled title="Sua Conta Administradora É Protegida"':'')+'>Editar</button></div></div>';
  }).join(""):'<div class="users-empty">Nenhum Usuário Encontrado.</div>';
}
function toggleMode(){
  const existing=$("usersMethod").value==="existing";
  $("usersPassWrap").hidden=existing;$("usersUidWrap").hidden=!existing;
  $("usersCreatePass").required=!existing;$("usersCreateUid").required=existing;
  $("usersCreateHelp").textContent=existing
    ?"Crie o Login em Authentication → Users e Copie o UID. Aqui Você Vincula Esse Login ao Sistema."
    :"Para Criar Logins Diretamente, Implante a Função Administrativa createOperationalUser no Firebase. A Senha Não É Gravada no Firestore.";
}
function openNew(){
  if(!allowed())return;
  $("usersCreateForm").reset();$("usersMethod").value="new";toggleMode();
  modal("usersCreateModal",true);$("usersCreateName").focus();
}
async function create(e){
  e.preventDefault();if(!allowed()||busy)return;
  const nome=clean($("usersCreateName").value),email=clean($("usersCreateEmail").value).toLowerCase(),role=$("usersCreateRole").value;
  const manual=$("usersMethod").value==="existing";
  if(nome.length<2||nome.length>80||!email.includes("@")||!["admin","operator"].includes(role))return announce("Confira Nome, E-mail e Permissão.",true);
  busy=true;$("usersSubmitCreate").disabled=true;
  try{
    if(manual){
      const uid=clean($("usersCreateUid").value);
      if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid)||uid===current.uid)throw Error("UID Inválido. Copie-o do Firebase Authentication.");
      const target=doc(db,"usuarios",uid);
      if((await getDoc(target)).exists())throw Error("Esse UID Já Foi Cadastrado. Utilize Editar Usuário.");
      await setDoc(target,{nome,email,role,ativo:true,createdAt:serverTimestamp(),createdByUid:current.uid,updatedAt:serverTimestamp(),updatedByUid:current.uid});
      announce("Perfil Vinculado. O Usuário Já Pode Acessar com a Conta do Firebase Authentication.");
    }else{
      const password=$("usersCreatePass").value;
      if(password.length<8||password.length>128)throw Error("Informe Uma Senha Inicial de 8 a 128 Caracteres.");
      const callable=httpsCallable(cloud,"createOperationalUser");
      const result=await callable({nome,email,role,password});
      if(!result.data?.uid)throw Error("O Servidor Não Confirmou o Novo Cadastro.");
      announce("Usuário Criado e Autorizado. Compartilhe o Acesso por um Canal Seguro.");
    }
    modal("usersCreateModal",false);
  }catch(error){
    console.error("Cadastro de usuários:",error.code||error.message);
    if(!manual&&["functions/not-found","functions/unavailable","functions/internal","functions/unknown"].includes(error.code))
      announce("A Função de Criação Ainda Não Está Implantada. Utilize Vincular UID Existente ou Implante createOperationalUser.",true);
    else announce("Falha no Cadastro: "+(error.message||error.code||"Permissão Negada"),true);
  }finally{busy=false;$("usersSubmitCreate").disabled=false;$("usersCreatePass").value=""}
}
function openEdit(uid){
  if(!allowed()||uid===current.uid)return;
  const entry=users.find(u=>u.id===uid);if(!entry)return;
  $("usersEditForm").reset();$("usersEditUid").value=uid;
  $("usersEditName").value=entry.nome||"";
  $("usersEditEmail").value=entry.email||"";
  $("usersEditRole").value=entry.role==="admin"?"admin":"operator";
  $("usersEditActive").value=entry.ativo===true?"true":"false";
  modal("usersEditModal",true);
}
async function edit(e){
  e.preventDefault();if(!allowed()||busy)return;
  const uid=$("usersEditUid").value,nome=clean($("usersEditName").value),
    role=$("usersEditRole").value,ativo=$("usersEditActive").value==="true";
  if(!uid||uid===current.uid)return announce("Sua Conta Não Pode Ser Alterada por Esta Guia.",true);
  if(nome.length<2||nome.length>80||!["admin","operator"].includes(role))return announce("Dados do Usuário Inválidos.",true);
  const before=users.find(u=>u.id===uid);
  if(!before)return announce("Usuário Não Encontrado. Atualize a Página.",true);
  if((before.ativo===true&&!ativo||before.role==="admin"&&role!=="admin")&&!confirm("Confirmar a Alteração de Acesso de "+(before.nome||before.email)+"?"))return;
  busy=true;$("usersSubmitEdit").disabled=true;
  try{
    await updateDoc(doc(db,"usuarios",uid),{nome,role,ativo,updatedAt:serverTimestamp(),updatedByUid:current.uid});
    modal("usersEditModal",false);announce("Permissão e Situação Atualizadas no Firebase.");
  }catch(error){console.error(error);announce("Falha ao Editar: "+(error.code||error.message),true)}
  finally{busy=false;$("usersSubmitEdit").disabled=false}
}
async function sendReset(){
  if(!allowed()||busy)return;
  const profile=users.find(u=>u.id===$("usersEditUid").value);
  if(!profile?.email)return announce("E-mail de Login Não Informado.",true);
  if(!confirm("Solicitar E-mail de Redefinição de Senha para "+profile.email+"?"))return;
  busy=true;$("usersResetPassword").disabled=true;
  try{
    await sendPasswordResetEmail(auth,profile.email);
    announce("Solicitação Enviada ao Firebase. Confira a Caixa de Entrada do E-mail Cadastrado.");
  }catch(error){console.error(error);announce("Falha na Redefinição: "+(error.code||error.message),true)}
  finally{busy=false;$("usersResetPassword").disabled=false}
}
$("usersAdd").addEventListener("click",openNew);
$("usersReload").addEventListener("click",render);
$("usersSearch").addEventListener("input",render);
$("usersMethod").addEventListener("change",toggleMode);
$("usersCreateForm").addEventListener("submit",create);
$("usersEditForm").addEventListener("submit",edit);
$("usersCancelCreate").onclick=()=>modal("usersCreateModal",false);
$("usersCancelEdit").onclick=()=>modal("usersEditModal",false);
$("usersResetPassword").onclick=sendReset;
$("usersTable").addEventListener("click",e=>{const button=e.target.closest("[data-users-edit]");if(button)openEdit(button.dataset.usersEdit)});
for(const id of ["usersCreateModal","usersEditModal"])$(id).addEventListener("click",e=>{if(e.target===$(id))modal(id,false)});
clear();
onAuthStateChanged(auth,async login=>{
  const revision=++epoch;clear();
  if(!login){announce("Entre como Administrador para Gerenciar os Usuários.");return}
  try{
    const snap=await getDoc(doc(db,"usuarios",login.uid));
    if(revision!==epoch)return;
    if(!snap.exists()||snap.data().ativo!==true||snap.data().role!=="admin"){
      announce("Acesso Reservado à Administração da Chácara.");return;
    }
    current=login;admin=true;
    $("usersNav").classList.remove("auth-hidden");
    announce("Carregando Usuários do Firebase...");
    unsubSelf=onSnapshot(doc(db,"usuarios",login.uid),own=>{
      if(!own.exists()||own.data().ativo!==true){clear();signOut(auth)}
      else if(own.data().role!=="admin"){clear();announce("A Permissão de Administrador Foi Revogada.",true)}
    },err=>{console.error(err);announce("Erro ao Verificar Permissões.",true)});
    unsubList=onSnapshot(collection(db,"usuarios"),list=>{
      users=list.docs.map(doc=>({id:doc.id,...doc.data()}));
      render();announce("Lista de Usuários Sincronizada.");
    },err=>{console.error(err);announce("Não Foi Possível Listar Usuários. Publique as Regras do Firestore Atualizadas.",true)});
  }catch(error){console.error(error);announce("Falha ao Verificar Conta Administradora.",true)}
});
