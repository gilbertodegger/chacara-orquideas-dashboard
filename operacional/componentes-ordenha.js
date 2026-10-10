import {getApps,getApp,initializeApp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {getFirestore,doc,getDoc,collection,onSnapshot,query,orderBy,setDoc,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
// A rotina fica no documento teteiras; cada componente tem data e histórico próprios.
const $=id=>document.getElementById(id);
const project=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG),auth=getAuth(project),db=getFirestore(project);
const defs=[{id:"kit-iq",title:"Kit IQ / Impulse Air",materials:["Borracha","Silicone"]},{id:"kit-vaso",title:"Kit Vaso (Ultraliner / Redonda)",materials:["Borracha","Silicone"]},{id:"mangueira-silicone",title:"Mangueira de Silicone",materials:["Silicone"]}];
const find=id=>defs.find(x=>x.id===id);
const specs=(id,material)=>id==="mangueira-silicone"?null:material==="Borracha"?{ciclos:2500,meses:6}:material==="Silicone"?{ciclos:5000,meses:12}:null;
const docRef=id=>doc(db,"manutencaoOrdenha","teteiras","componentes",id);
const logs=id=>collection(db,"manutencaoOrdenha","teteiras","componentes",id,"trocas");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pt=n=>Number(n).toLocaleString("pt-BR",{maximumFractionDigits:1});
const iso=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||""))&&new Date(s+"T12:00:00").toString()!=="Invalid Date"&&new Date(s+"T12:00:00").toISOString().slice(0,10)===s;
const index=s=>{const [y,m,d]=s.split("-").map(Number);return Date.UTC(y,m-1,d)/86400000};
const addDays=(s,n)=>new Date((index(s)+n)*86400000).toISOString().slice(0,10);
const addMonths=(s,n)=>{const [y,m,d]=s.split("-").map(Number);const first=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return [first.getUTCFullYear(),String(first.getUTCMonth()+1).padStart(2,"0"),String(Math.min(d,last)).padStart(2,"0")].join("-")};
const br=s=>valid(s)?s.split("-").reverse().join("/"):"—";
const data={};let user=null,admin=false,routine=null,selected="",history=[],stops=[],stopHistory=null,saving=false;
function notify(s,warn=false){$("componentMessage").textContent=s;$("componentMessage").classList.toggle("warn",warn)}
function blank(def){return {material:def.materials.length===1?def.materials[0]:"",dataTroca:"",limiteOrdenhas:null,limiteMeses:null,observacoes:""}}
function get(id){return {...blank(find(id)),...(data[id]||{})}}
function routineData(){
 const sets=Number(routine?.conjuntos||0),cows=Number(routine?.vacas||0);
 const daily=sets>0&&cows>0?cows*3/sets:null,values=routine?.duracoes;
 const hours=Array.isArray(values)&&values.length===3&&values.every(n=>n!==null&&Number(n)>0)?values.reduce((sum,n)=>sum+Number(n),0):null;
 return {sets,cows,daily,hours};
}
function estimate(def,c){
 const rt=routineData(),start=valid(c.dataTroca)?c.dataTroca:"";
 const lim=specs(def.id,c.material)||{ciclos:c.limiteOrdenhas,meses:c.limiteMeses};
 const age=start?Math.max(0,index(iso())-index(start)):null;
 const cycles=age!==null&&rt.daily!==null?age*rt.daily:null,elapsedHours=age!==null&&rt.hours!==null?age*rt.hours:null;
 const byCycles=start&&rt.daily&&lim.ciclos>0?addDays(start,Math.ceil(lim.ciclos/rt.daily)):null;
 const byMonths=start&&lim.meses>0?addMonths(start,lim.meses):null;
 const due=[byCycles,byMonths].filter(Boolean).sort()[0]||null;
 const remain=due?index(due)-index(iso()):null;
 const status=!c.material?"Selecionar Material":!start?"Sem Data":(!lim.ciclos&&!lim.meses)?"Definir Limite":!due?"Aguardando Rotina":remain<=0?"Troca Vencida":remain<=7?"Troca Próxima":"Em Dia";
 return {lim,cycles,elapsedHours,byCycles,byMonths,due,status};
}
function render(){
 const rt=routineData();
 $("componentRoutine").textContent=routine?(rt.sets||"—")+" Conjuntos · 3 Ordenhas/Dia · "+(rt.cows||"—")+" Vacas/Ordenha · "+(rt.daily===null?"—":pt(rt.daily))+" Ordenhas por Conjunto/Dia":"Salve a Rotina da Ordenha para Calcular o Uso das Peças.";
 $("componentCards").innerHTML=defs.map(def=>{
  const c=get(def.id),e=estimate(def,c);
  const css=e.status==="Em Dia"?"good":e.status==="Troca Vencida"?"overdue":e.status==="Troca Próxima"?"soon":"unknown";
  return '<article class="component-card"><div class="component-card-header"><h4>'+esc(def.title)+'</h4><span class="oil-pill '+css+'">'+esc(e.status)+'</span></div>'+
   '<p class="component-sub">Material: <strong>'+esc(c.material||"Não Informado")+'</strong> · Última Troca: <strong>'+br(c.dataTroca)+'</strong></p>'+
   '<div class="component-kpis"><div><span>Uso Estimado</span><strong>'+(e.cycles===null?"—":pt(e.cycles))+' Ordenhas</strong><small>'+(e.elapsedHours===null?"—":pt(e.elapsedHours)+" h")+' de Sessão</small></div>'+
   '<div><span>Limite</span><strong>'+(e.lim.ciclos?pt(e.lim.ciclos)+" Ordenhas":"Não Definido")+'</strong><small>'+(e.lim.meses?e.lim.meses+" Meses":"Sem Limite de Tempo")+'</small></div>'+
   '<div><span>Próxima Troca</span><strong>'+br(e.due)+'</strong><small>'+esc(e.due===e.byCycles?"Pelas Ordenhas":e.due===e.byMonths?"Pelo Tempo":"Aguardando Dados")+'</small></div></div>'+
   '<div class="component-actions"><button type="button" class="btn secondary" data-component-edit="'+def.id+'" '+(!admin?'disabled':'')+'>Configurar</button>'+
   '<button type="button" class="btn" data-component-change="'+def.id+'" '+(!admin||!data[def.id]?'disabled':'')+'>Registrar Troca</button>'+
   '<button type="button" class="btn secondary" data-component-history="'+def.id+'">Histórico</button></div>'+
   '<p class="component-note">'+(def.id==="mangueira-silicone"?"Configure os Limites da Mangueira Conforme a Especificação da Peça.":"Borracha: 2.500 Ordenhas ou 6 Meses · Silicone: 5.000 Ordenhas ou 12 Meses.")+'</p></article>';
 }).join("");
}
function modal(id,open){$(id).classList.toggle("show",open)}
function selectMaterials(id,element,value){
 const el=$(element);el.replaceChildren();
 if(find(id).materials.length>1){const first=document.createElement("option");first.value="";first.textContent="Selecionar Material";el.append(first)}
 for(const m of find(id).materials){const o=document.createElement("option");o.value=m;o.textContent=m;el.append(o)}
 el.value=value;
}
function materialChange(){
 const lim=specs(selected,$("componentMaterial").value),id=selected;
 if(lim){$("componentLimitCycles").value=lim.ciclos;$("componentLimitMonths").value=lim.meses}
 else if(id!=="mangueira-silicone"){$("componentLimitCycles").value="";$("componentLimitMonths").value=""}
 $("componentLimitCycles").readOnly=!!lim||id!=="mangueira-silicone";$("componentLimitMonths").readOnly=!!lim||id!=="mangueira-silicone";
 $("componentEditHint").textContent=lim?"Limite Automático: "+pt(lim.ciclos)+" Ordenhas ou "+lim.meses+" Meses.":id==="mangueira-silicone"?"Configure os Limites Conforme o Fabricante da Mangueira.":"Selecione o Material para Definir os Limites.";
}
function edit(id){
 if(!admin||!find(id))return;
 selected=id;const c=get(id);$("componentEditForm").reset();$("componentEditTitle").textContent="Configurar — "+find(id).title;
 selectMaterials(id,"componentMaterial",c.material);
 $("componentInstalled").value=c.dataTroca;$("componentLimitCycles").value=c.limiteOrdenhas??"";
 $("componentLimitMonths").value=c.limiteMeses??"";$("componentNotes").value=c.observacoes;
 materialChange();modal("componentEditModal",true);
}
function positive(id){const raw=$(id).value.trim();if(!raw)return null;const n=Number(raw);if(!Number.isInteger(n)||n<1||n>1000000)throw Error("Informe um Limite Inteiro Positivo.");return n}
async function save(e){
 e.preventDefault();if(!admin||!selected||saving)return;
 const id=selected,def=find(id),material=$("componentMaterial").value,date=$("componentInstalled").value;
 if(!def.materials.includes(material))return notify("Selecione o Material.",true);
 if(data[id]?.dataTroca&&data[id].material!==material)return notify("Registre a Troca para Alterar o Material Instalado.",true);
 if(date&&(!valid(date)||date>iso()))return notify("Data da Troca Inválida.",true);
 let ciclos,meses;try{ciclos=positive("componentLimitCycles");meses=positive("componentLimitMonths")}catch(ex){notify(ex.message,true);return}
 const spec=specs(id,material);if(spec){ciclos=spec.ciclos;meses=spec.meses}
 const observacoes=$("componentNotes").value.trim();if(observacoes.length>1200)return notify("Máximo de 1.200 Caracteres.",true);
 saving=true;$("componentSave").disabled=true;
 try{await setDoc(docRef(id),{material,dataTroca:date,limiteOrdenhas:ciclos,limiteMeses:meses,observacoes,updatedByUid:user.uid,updatedAt:serverTimestamp()});modal("componentEditModal",false);notify(def.title+" Salvo no Firebase.")}
 catch(ex){console.error(ex);notify("Erro ao Salvar: "+(ex.code||ex.message),true)}
 finally{saving=false;$("componentSave").disabled=false}
}
function change(id){
 if(!admin||!find(id)||!data[id])return;selected=id;const c=get(id);
 $("componentChangeForm").reset();$("componentChangeTitle").textContent="Registrar Troca — "+find(id).title;
 $("componentChangeDate").value=iso();selectMaterials(id,"componentChangeMaterial",c.material);
 $("componentChangeHint").textContent="Troca Completa do Componente. Reinicia Sua Data e a Contagem Estimada de Uso.";
 modal("componentChangeModal",true);
}
async function saveChange(e){
 e.preventDefault();if(!admin||!selected||saving)return;
 const id=selected,def=find(id),c=data[id];if(!c)return;
 const date=$("componentChangeDate").value,material=$("componentChangeMaterial").value,observacoes=$("componentChangeNotes").value.trim();
 if(!valid(date)||date>iso()||(c.dataTroca&&date<c.dataTroca))return notify("Data Inválida ou Anterior à Última Troca.",true);
 if(!def.materials.includes(material)||observacoes.length>1200)return notify("Material ou Observações Inválidas.",true);
 const spec=specs(id,material),batch=writeBatch(db);
 batch.set(docRef(id),{material,dataTroca:date,limiteOrdenhas:spec?spec.ciclos:c.limiteOrdenhas??null,limiteMeses:spec?spec.meses:c.limiteMeses??null,observacoes:c.observacoes||"",updatedByUid:user.uid,updatedAt:serverTimestamp()});
 batch.set(doc(logs(id)),{data:date,material,observacoes,createdAt:serverTimestamp(),createdByUid:user.uid});
 saving=true;$("componentChangeSave").disabled=true;
 try{await batch.commit();modal("componentChangeModal",false);notify("Troca Registrada no Histórico de "+def.title+".")}
 catch(ex){console.error(ex);notify("Não Foi Possível Registrar: "+(ex.code||ex.message),true)}
 finally{saving=false;$("componentChangeSave").disabled=false}
}
function viewHistory(id){
 if(stopHistory)stopHistory();selected=id;$("componentHistoryPanel").hidden=false;
 $("componentHistoryTitle").textContent="Histórico — "+find(id).title;
 stopHistory=onSnapshot(query(logs(id),orderBy("createdAt","desc")),snap=>{
  const items=snap.docs.map(x=>x.data());
  $("componentHistoryList").innerHTML=items.length?items.map(x=>'<div class="component-history-item"><strong>'+br(x.data)+'</strong><span>'+esc(x.material)+'</span><p>'+esc(x.observacoes||"Sem Observações")+'</p></div>').join(""):'<div class="machine-empty">Nenhuma Troca Registrada.</div>';
 },ex=>{console.error(ex);$("componentHistoryList").textContent="Falha ao Carregar o Histórico."});
}
$("componentCards").addEventListener("click",e=>{
 const el=e.target.closest("[data-component-edit],[data-component-change],[data-component-history]");if(!el)return;
 if(el.dataset.componentEdit)edit(el.dataset.componentEdit);
 else if(el.dataset.componentChange)change(el.dataset.componentChange);
 else if(el.dataset.componentHistory)viewHistory(el.dataset.componentHistory);
});
$("componentMaterial").addEventListener("change",materialChange);
$("componentEditForm").addEventListener("submit",save);
$("componentChangeForm").addEventListener("submit",saveChange);
$("componentHistoryClose").onclick=()=>{if(stopHistory){stopHistory();stopHistory=null}$("componentHistoryPanel").hidden=true};
document.querySelectorAll("[data-component-close]").forEach(el=>el.onclick=()=>modal(el.dataset.componentClose,false));
for(const id of ["componentEditModal","componentChangeModal"])$(id).onclick=e=>{if(e.target===$(id))modal(id,false)};
function disconnect(){for(const stop of stops)stop();stops=[];if(stopHistory){stopHistory();stopHistory=null}for(const id of Object.keys(data))delete data[id];routine=null;user=null;admin=false}
render();
onAuthStateChanged(auth,async current=>{
 disconnect();$("componentHistoryPanel").hidden=true;
 if(!current){notify("Entre no Sistema para Consultar os Componentes.");render();return}
 try{
  const snap=await getDoc(doc(db,"usuarios",current.uid));if(!snap.exists()||snap.data().ativo!==true){notify("Conta Não Autorizada.",true);return}
  user=current;admin=snap.data().role==="admin";
  stops.push(onSnapshot(doc(db,"manutencaoOrdenha","teteiras"),r=>{routine=r.exists()?r.data():null;render()},ex=>{console.error(ex);notify("Falha ao Ler a Rotina da Ordenha.",true)}));
  for(const def of defs)stops.push(onSnapshot(docRef(def.id),r=>{data[def.id]=r.exists()?r.data():null;render()},ex=>{console.error(ex);notify("Verifique as Regras do Firestore para Componentes.",true)}));
 }catch(ex){console.error(ex);notify("Falha de Autorização.",true)}
});
