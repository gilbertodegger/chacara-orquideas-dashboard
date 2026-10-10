import {getApps,getApp,initializeApp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {getFirestore,doc,collection,setDoc,getDoc,onSnapshot,writeBatch,serverTimestamp,query,orderBy} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG);
const auth=getAuth(app), db=getFirestore(app);
const ref=doc(db,"manutencaoOrdenha","teteiras");
const pt=n=>Number(n).toLocaleString("pt-BR",{maximumFractionDigits:1});
const localDate=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const num=v=>v===null||v===undefined||v===""?null:Number(v);
const isoValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||""));
const todayIndex=s=>{const [y,m,d]=String(s).split("-").map(Number);return Date.UTC(y,m-1,d)/86400000};
const addDays=(date,delta)=>{const d=new Date(Date.UTC(...date.split("-").map((n,i)=>Number(n)-(i===1?1:0))));d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)};
const brDate=s=>isoValid(s)?s.split("-").reverse().join("/"):"—";
let operator=null,admin=false,stopSettings=null,stopHistory=null,model=null,history=[],ready=false,working=false;
const getInputs=()=>({
  conjuntos:num($("milkSetCount").value),
  ordenhasDia:3,
  vacas:num($("milkCowCount").value),
  duracoes:[$("milkDuration1").value,$("milkDuration2").value,$("milkDuration3").value].map(num),
  dataTroca:$("milkLastChange").value,
  limiteHoras:num($("milkLimitHours").value),
  limiteOrdenhas:num($("milkLimitCycles").value),
  observacoes:$("milkNotes").value.trim()
});
function alertMsg(s,warn=false){$("milkMessage").textContent=s;$("milkMessage").classList.toggle("warn",warn)}
function validate(c){
  if(c.conjuntos===null||!Number.isInteger(c.conjuntos)||c.conjuntos<1||c.conjuntos>100)throw Error("Informe a Quantidade Válida de Conjuntos.");
  if(c.vacas!==null&&(!Number.isInteger(c.vacas)||c.vacas<1||c.vacas>5000))throw Error("Informe um Número de Vacas Válido.");
  if(c.duracoes.some(n=>n!==null&&(!Number.isFinite(n)||n<=0||n>15)))throw Error("Duração de Ordenha Inválida.");
  if(c.limiteHoras!==null&&(!Number.isFinite(c.limiteHoras)||c.limiteHoras<=0))throw Error("Limite de Horas Inválido.");
  if(c.limiteOrdenhas!==null&&(!Number.isFinite(c.limiteOrdenhas)||c.limiteOrdenhas<=0))throw Error("Limite de Ordenhas Inválido.");
  if(c.dataTroca&&(!isoValid(c.dataTroca)||c.dataTroca>localDate()))throw Error("Data da Última Troca Inválida.");
  if(c.observacoes.length>1500)throw Error("Observações Muito Longas.");
  return c;
}
function calculate(c){
  const complete=c.duracoes.every(n=>n!==null&&n>0);
  const hoursDaily=complete?c.duracoes.reduce((a,b)=>a+b,0):null;
  const cowsPerSet=(c.vacas!==null&&c.conjuntos>0)?c.vacas*3/c.conjuntos:null;
  const days=isoValid(c.dataTroca)?Math.max(0,todayIndex(localDate())-todayIndex(c.dataTroca)):null;
  const usedHours=days!==null&&hoursDaily!==null?days*hoursDaily:null;
  const usedCycles=days!==null&&cowsPerSet!==null?days*cowsPerSet:null;
  const remainHours=c.limiteHoras!==null&&usedHours!==null?c.limiteHoras-usedHours:null;
  const remainCycles=c.limiteOrdenhas!==null&&usedCycles!==null?c.limiteOrdenhas-usedCycles:null;
  const daysToHours=remainHours!==null&&hoursDaily>0?remainHours/hoursDaily:null;
  const daysToCycles=remainCycles!==null&&cowsPerSet>0?remainCycles/cowsPerSet:null;
  const limits=[daysToHours,daysToCycles].filter(n=>n!==null&&Number.isFinite(n));
  const remaining=limits.length?Math.min(...limits):null;
  let status=remaining===null?"Sem Limite Configurado":remaining<=0?"Troca Vencida":remaining<=7?"Troca Próxima":"Em Dia";
  if(remaining===null&&days===null)status="Aguardando Última Troca";
  return {complete,hoursDaily,cowsPerSet,days,usedHours,usedCycles,remainHours,remainCycles,remaining,status,
    forecast:remaining!==null?addDays(localDate(),Math.max(0,Math.ceil(remaining))):null};
}
const dash=(id,val)=>$(id).textContent=val;
function present(c){
  const r=calculate(c);
  dash("milkDailyHours",r.hoursDaily!==null?pt(r.hoursDaily)+" h":"—");
  dash("milkDailyCycles",r.cowsPerSet!==null?pt(r.cowsPerSet):"—");
  dash("milkUsedHours",r.usedHours!==null?pt(r.usedHours)+" h":"—");
  dash("milkNextChange",r.forecast?brDate(r.forecast):"—");
  $("milkStatus").textContent=r.status;
  $("milkStatus").className="milk-status "+(r.remaining!==null&&r.remaining<=0?"overdue":r.remaining!==null&&r.remaining<=7?"soon":"");
  dash("milkUsedCycles",r.usedCycles!==null?pt(r.usedCycles):"—");
  dash("milkRemainingHours",r.remainHours!==null?pt(r.remainHours)+" h":"—");
  dash("milkRemainingCycles",r.remainCycles!==null?pt(r.remainCycles):"—");
  dash("milkDaysSince",r.days!==null?pt(r.days)+" Dias":"—");
  const messages=[];
  if(!r.complete)messages.push("Informe a Duração das Três Ordenhas para Estimar Horas de Uso por Conjunto.");
  if(c.vacas===null)messages.push("Informe o Número de Vacas para Estimar as Ordenhas por Conjunto.");
  if(!c.dataTroca)messages.push("Informe a Data da Última Troca para Estimar o Uso Acumulado.");
  if(c.limiteHoras===null&&c.limiteOrdenhas===null)messages.push("Informe Pelo Menos Um Limite de Troca Conforme o Fabricante.");
  dash("milkCalcExplanation",messages.length?messages.join(" "):"Cálculo Estimado a Partir da Rotina Atual, Assumida Constante Desde a Última Troca. O Indicador em Horas Considera os Conjuntos em Uso Durante Toda a Sessão; Não Mede o Tempo Real de Vácuo por Teteira.");
}
function showSaved(c){
  $("milkSetCount").value=c.conjuntos??12;$("milkCowCount").value=c.vacas??"";
  c.duracoes?.forEach((n,i)=>{if($("milkDuration"+(i+1)))$("milkDuration"+(i+1)).value=n??""});
  $("milkLastChange").value=c.dataTroca||"";
  $("milkLimitHours").value=c.limiteHoras??"";
  $("milkLimitCycles").value=c.limiteOrdenhas??"";
  $("milkNotes").value=c.observacoes||"";
  present(getInputs());
}
function resetUi(){
  showSaved({conjuntos:12,vacas:null,duracoes:[null,null,null],dataTroca:"",limiteHoras:null,limiteOrdenhas:null,observacoes:""});
}
function historyView(){
  $("milkHistoryList").innerHTML=history.length?history.map(r=>
    '<article class="milk-history-row"><strong>'+brDate(r.data)+'</strong><span>'+Number(r.conjuntos||12)+' Conjuntos Substituídos</span><p>'+String(r.observacoes||"Sem Observações").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))+'</p></article>'
  ).join(""):'<div class="machine-empty">Nenhuma Troca de Teteiras Registrada.</div>';
}
async function saveSettings(e){
  e.preventDefault();if(!admin||!operator||working)return;
  let c;try{c=validate(getInputs())}catch(error){alertMsg(error.message,true);return}
  working=true;$("milkSave").disabled=true;
  try{
    await setDoc(ref,{...c,updatedAt:serverTimestamp(),updatedByUid:operator.uid});
    alertMsg("Parâmetros da Ordenha Salvos no Firebase.");
  }catch(error){console.error(error);alertMsg("Erro ao Salvar Parâmetros: "+(error.code||error.message),true)}
  finally{working=false;$("milkSave").disabled=false}
}
function openReplacement(){
  if(!admin||!operator||!ready||!model){alertMsg("Salve os Parâmetros Antes de Registrar uma Troca.",true);return}
  $("milkChangeForm").reset();$("milkChangeDate").value=localDate();
  $("milkChangeCount").value=model.conjuntos||12;
  $("milkReplaceModal").classList.add("show");
}
async function replace(e){
  e.preventDefault();if(!operator||!admin||!ready||!model||working)return;
  const data=$("milkChangeDate").value;
  const conjuntos=num($("milkChangeCount").value);
  const observacoes=$("milkChangeNote").value.trim();
  if(!isoValid(data)||data>localDate()){alertMsg("Data de Troca Inválida.",true);return}
  if(!Number.isInteger(conjuntos)||conjuntos<1||conjuntos>model.conjuntos){alertMsg("Quantidade de Conjuntos Inválida.",true);return}
  if(conjuntos!==model.conjuntos){alertMsg("Trocas Parciais Exigem Controle Individual por Conjunto. Registre Apenas a Troca Completa.",true);return}
  if(model.dataTroca&&data<model.dataTroca){alertMsg("A Data Não Pode Ser Anterior à Última Troca.",true);return}
  working=true;$("milkChangeSubmit").disabled=true;
  try{
    const batch=writeBatch(db);
    batch.set(doc(collection(db,"manutencaoOrdenha","teteiras","trocas")),
      {data,conjuntos,observacoes,createdAt:serverTimestamp(),createdByUid:operator.uid});
    batch.update(ref,{dataTroca:data,updatedByUid:operator.uid,updatedAt:serverTimestamp()});
    await batch.commit();$("milkReplaceModal").classList.remove("show");
    alertMsg("Troca de Teteiras Registrada no Histórico.");
  }catch(error){console.error(error);alertMsg("Erro ao Registrar Troca: "+(error.code||error.message),true)}
  finally{working=false;$("milkChangeSubmit").disabled=false}
}
$("milkSetup").addEventListener("submit",saveSettings);
$("milkSetup").addEventListener("input",()=>present(getInputs()));
$("milkReplace").addEventListener("click",openReplacement);
$("milkChangeForm").addEventListener("submit",replace);
$("milkCancelChange").onclick=()=>$("milkReplaceModal").classList.remove("show");
$("milkReplaceModal").addEventListener("click",e=>{if(e.target===$("milkReplaceModal"))$("milkReplaceModal").classList.remove("show")});
resetUi();
onAuthStateChanged(auth,async user=>{
  if(stopSettings){stopSettings();stopSettings=null}
  if(stopHistory){stopHistory();stopHistory=null}
  operator=user;admin=false;model=null;ready=false;
  $("milkAdminSettings").hidden=true;$("milkReplace").hidden=true;
  if(!user){resetUi();alertMsg("Entre no Sistema para Consultar a Manutenção da Ordenha.");return}
  try{
    const profile=await getDoc(doc(db,"usuarios",user.uid));
    if(!profile.exists()||profile.data().ativo!==true)throw Error("Usuário Sem Autorização.");
    admin=profile.data().role==="admin";
    $("milkAdminSettings").hidden=!admin;$("milkReplace").hidden=!admin;
    for(const input of $("milkSetup").querySelectorAll("input,textarea"))input.disabled=!admin;
    stopSettings=onSnapshot(ref,snap=>{
      ready=snap.exists();model=ready?snap.data():null;
      showSaved(model||{conjuntos:12,vacas:null,duracoes:[null,null,null],dataTroca:"",limiteHoras:null,limiteOrdenhas:null,observacoes:""});
      alertMsg(ready?"Manutenção da Ordenha Sincronizada.":"Cadastre os Parâmetros para Iniciar o Acompanhamento.");
    },error=>{console.error(error);alertMsg("Sem Permissão para Ler a Manutenção da Ordenha. Publique as Regras Atualizadas do Firestore.",true)});
    stopHistory=onSnapshot(query(collection(db,"manutencaoOrdenha","teteiras","trocas"),orderBy("createdAt","desc")),snap=>{
      history=snap.docs.map(d=>d.data());historyView()
    },error=>{console.error(error);$("milkHistoryList").textContent="Falha ao Carregar o Histórico. Confira as Regras."});
  }catch(error){console.error(error);alertMsg("Falha na Autorização: "+error.message,true)}
});
