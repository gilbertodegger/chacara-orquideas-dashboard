import {getApps,getApp,initializeApp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {getFirestore,doc,getDoc,collection,onSnapshot,query,orderBy,getDocs,setDoc,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
// A rotina fica no documento teteiras; cada componente tem data e histórico próprios.
const $=id=>document.getElementById(id);
const project=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG),auth=getAuth(project),db=getFirestore(project);
const starter=[{id:"kit-iq",title:"Kit IQ / Impulse Air",materials:["Borracha","Silicone"]},{id:"kit-vaso",title:"Kit Vaso (Ultraliner / Redonda)",materials:["Borracha","Silicone"]},{id:"mangueira-silicone",title:"Mangueira de Silicone",materials:["Silicone"]}];
let defs=[...starter];const isStarter=id=>starter.some(d=>d.id===id);
const collectionRef=()=>collection(db,"manutencaoOrdenha","teteiras","componentes");
const find=id=>defs.find(x=>x.id===id);
const specs=(id,material)=>!["kit-iq","kit-vaso"].includes(id)?null:material==="Borracha"?{ciclos:2500,meses:6}:material==="Silicone"?{ciclos:5000,meses:12}:null;
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
const data={};let user=null,admin=false,routine=null,selected="",history=[],stops=[],stopHistory=null,saving=false,showInactive=false;
function notify(s,warn=false){$("componentMessage").textContent=s;$("componentMessage").classList.toggle("warn",warn)}
function blank(def){return {title:def.title,material:def.materials.length===1?def.materials[0]:"",dataTroca:"",limiteOrdenhas:null,limiteMeses:null,observacoes:"",ativo:true}}
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
 const visible=defs.filter(def=>showInactive||data[def.id]?.ativo!==false);
 $("componentCards").innerHTML=visible.map(def=>{
  const c=get(def.id),e=estimate(def,c);
  const css=e.status==="Em Dia"?"good":e.status==="Troca Vencida"?"overdue":e.status==="Troca Próxima"?"soon":"unknown";
  return '<article class="component-card"><div class="component-card-header"><h4>'+esc(def.title)+'</h4><span class="oil-pill '+css+'">'+esc(e.status)+'</span></div>'+
   '<p class="component-sub">Material: <strong>'+esc(c.material||"Não Informado")+'</strong> · Última Troca: <strong>'+br(c.dataTroca)+'</strong></p>'+
   '<div class="component-kpis"><div><span>Uso Estimado</span><strong>'+(e.cycles===null?"—":pt(e.cycles))+' Ordenhas</strong><small>'+(e.elapsedHours===null?"—":pt(e.elapsedHours)+" h")+' de Sessão</small></div>'+
   '<div><span>Limite</span><strong>'+(e.lim.ciclos?pt(e.lim.ciclos)+" Ordenhas":"Não Definido")+'</strong><small>'+(e.lim.meses?e.lim.meses+" Meses":"Sem Limite de Tempo")+'</small></div>'+
   '<div><span>Próxima Troca</span><strong>'+br(e.due)+'</strong><small>'+esc(e.due===e.byCycles?"Pelas Ordenhas":e.due===e.byMonths?"Pelo Tempo":"Aguardando Dados")+'</small></div></div>'+
   '<div class="component-actions"><button type="button" class="btn secondary" data-component-edit="'+esc(def.id)+'" '+(!admin?'disabled':'')+'>Editar</button>'+
   '<button type="button" class="btn" data-component-change="'+esc(def.id)+'" '+(!admin||!data[def.id]||data[def.id]?.ativo===false?'disabled':'')+'>Registrar Troca</button>'+
   '<button type="button" class="btn secondary" data-component-history="'+esc(def.id)+'">Histórico</button>'+
   (admin?'<button type="button" class="review-delete" data-component-toggle="'+esc(def.id)+'" title="'+(c.ativo===false?'Restaurar Componente':'Excluir Componente')+'" aria-label="'+(c.ativo===false?'Restaurar':'Excluir')+' '+esc(def.title)+'">'+(c.ativo===false?'↺':'×')+'</button>':'')+'</div>'+
   '<p class="component-note">'+(["kit-iq","kit-vaso"].includes(def.id)?"Borracha: 2.500 Ordenhas ou 6 Meses · Silicone: 5.000 Ordenhas ou 12 Meses.":"Defina os Limites Conforme a Especificação do Componente.")+'</p></article>';
 }).join("")||'<div class="machine-empty">Nenhum Componente Ativo. Clique em + Adicionar Componente.</div>';
 $("componentCreate").hidden=!admin;
 $("componentShowInactive").hidden=!admin;
 $("componentShowInactive").textContent=showInactive?"Ocultar Excluídos":"Mostrar Excluídos";
}
function modal(id,open){$(id).classList.toggle("show",open)}
function selectMaterials(id,element,value){
 const el=$(element);el.replaceChildren();
 if(find(id).materials.length>1){const first=document.createElement("option");first.value="";first.textContent="Selecionar Material";el.append(first)}
 for(const m of (find(id)?.materials||["Borracha","Silicone","Outro"])){const o=document.createElement("option");o.value=m;o.textContent=m;el.append(o)}
 el.value=value;
}
function materialChange(){
 const lim=specs(selected,$("componentMaterial").value),id=selected;
 if(lim){$("componentLimitCycles").value=lim.ciclos;$("componentLimitMonths").value=lim.meses}
 else if(isStarter(id)&&id!=="mangueira-silicone"){$("componentLimitCycles").value="";$("componentLimitMonths").value=""}
 $("componentLimitCycles").readOnly=!!lim||isStarter(id)&&id!=="mangueira-silicone";$("componentLimitMonths").readOnly=!!lim||isStarter(id)&&id!=="mangueira-silicone";
 $("componentEditHint").textContent=lim?"Limite Automático: "+pt(lim.ciclos)+" Ordenhas ou "+lim.meses+" Meses.":id==="mangueira-silicone"||!isStarter(id)?"Configure os Limites Conforme o Fabricante da Peça.":"Selecione o Material para Definir os Limites.";
}
function edit(id){
 if(!admin||!find(id))return;
 selected=id;const c=get(id);$("componentEditForm").reset();$("componentEditTitle").textContent="Editar — "+find(id).title;
 $("componentName").value=String(c.title||find(id).title);
 selectMaterials(id,"componentMaterial",c.material);
 $("componentInstalled").value=c.dataTroca;$("componentLimitCycles").value=c.limiteOrdenhas??"";
 $("componentLimitMonths").value=c.limiteMeses??"";$("componentNotes").value=c.observacoes;
 materialChange();modal("componentEditModal",true);
}
function createComponent(){
 if(!admin||saving)return;
 selected="__new__";$("componentEditForm").reset();$("componentEditTitle").textContent="Adicionar Componente";
 $("componentName").value="";
 const selector=$("componentMaterial");selector.replaceChildren();
 for(const mat of ["Borracha","Silicone","Outro"]){const op=document.createElement("option");op.value=mat;op.textContent=mat;selector.append(op)}
 $("componentInstalled").value="";$("componentLimitCycles").value="";$("componentLimitMonths").value="";
 $("componentNotes").value="";$("componentLimitCycles").readOnly=false;$("componentLimitMonths").readOnly=false;
 $("componentEditHint").textContent="Informe o Material e os Limites Segundo o Fabricante. Os Limites Podem Ficar em Branco.";
 modal("componentEditModal",true);
}
function positive(id){const raw=$(id).value.trim();if(!raw)return null;const n=Number(raw);if(!Number.isInteger(n)||n<1||n>1000000)throw Error("Informe um Limite Inteiro Positivo.");return n}
async function save(e){
 e.preventDefault();if(!admin||!selected||saving)return;
 const creating=selected==="__new__",id=creating?doc(collectionRef()).id:selected,def=creating?{id,title:"",materials:["Borracha","Silicone","Outro"]}:find(id);
 const title=$("componentName").value.trim(),material=$("componentMaterial").value,date=$("componentInstalled").value;
 if(!title||title.length>100)return notify("Informe um Nome de Até 100 Caracteres.",true);
 if(defs.some(d=>d.id!==id&&d.title.toLocaleLowerCase("pt-BR")===title.toLocaleLowerCase("pt-BR")&&data[d.id]?.ativo!==false))return notify("Já Existe um Componente Ativo com Esse Nome.",true);
 if(!def?.materials.includes(material))return notify("Selecione o Material.",true);
 if(data[id]?.dataTroca&&data[id].material!==material)return notify("Registre a Troca para Alterar o Material Instalado.",true);
 if(date&&(!valid(date)||date>iso()))return notify("Data da Troca Inválida.",true);
 let ciclos,meses;try{ciclos=positive("componentLimitCycles");meses=positive("componentLimitMonths")}catch(ex){notify(ex.message,true);return}
 const preset=specs(id,material);if(preset){ciclos=preset.ciclos;meses=preset.meses}
 const observacoes=$("componentNotes").value.trim();if(observacoes.length>1200)return notify("Máximo de 1.200 Caracteres.",true);
 saving=true;$("componentSave").disabled=true;
 try{
  await setDoc(docRef(id),{title,material,dataTroca:date,limiteOrdenhas:ciclos,limiteMeses:meses,observacoes,ativo:true,updatedByUid:user.uid,updatedAt:serverTimestamp()});
  modal("componentEditModal",false);notify(title+" Salvo no Firebase.");
 }catch(ex){console.error(ex);notify("Erro ao Salvar: "+(ex.code||ex.message),true)}
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
 batch.set(docRef(id),{title:c.title||def.title,material,dataTroca:date,limiteOrdenhas:spec?spec.ciclos:c.limiteOrdenhas??null,limiteMeses:spec?spec.meses:c.limiteMeses??null,observacoes:c.observacoes||"",ativo:true,updatedByUid:user.uid,updatedAt:serverTimestamp()});
 batch.set(doc(logs(id)),{data:date,material,observacoes,
  anteriorDataTroca:c.dataTroca||'',anteriorMaterial:c.material,
  anteriorLimiteOrdenhas:c.limiteOrdenhas??null,anteriorLimiteMeses:c.limiteMeses??null,
  createdAt:serverTimestamp(),createdByUid:user.uid});
 saving=true;$("componentChangeSave").disabled=true;
 try{await batch.commit();modal("componentChangeModal",false);notify("Troca Registrada no Histórico de "+def.title+".")}
 catch(ex){console.error(ex);notify("Não Foi Possível Registrar: "+(ex.code||ex.message),true)}
 finally{saving=false;$("componentChangeSave").disabled=false}
}
function viewHistory(id){
 if(stopHistory)stopHistory();selected=id;$("componentHistoryPanel").hidden=false;
 $("componentHistoryTitle").textContent="Histórico — "+find(id).title;
 stopHistory=onSnapshot(query(logs(id),orderBy("createdAt","desc")),snap=>{
  history=snap.docs.map(x=>({id:x.id,...x.data()}));
  $("componentHistoryList").innerHTML=history.length?history.map(x=>'<div class="component-history-item"><strong>'+br(x.data)+'</strong><span>'+esc(x.material)+'</span><p>'+esc(x.observacoes||"Sem Observações")+'</p>'+
  (admin?'<button class="review-delete" type="button" data-component-review-delete="'+esc(x.id)+'" title="Excluir Troca" aria-label="Excluir Troca de '+br(x.data)+'">×</button>':'')+'</div>').join(""):'<div class="machine-empty">Nenhuma Troca Registrada.</div>';
 },ex=>{console.error(ex);$("componentHistoryList").textContent="Falha ao Carregar o Histórico."});
}
function byRecency(a,b){return String(b.data||'').localeCompare(String(a.data||''))||Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0)}
async function deleteComponentReview(reviewId){
 if(!admin||!user||saving||!find(selected))return;
 const item=history.find(x=>x.id===reviewId);if(!item)return;
 if(!confirm('Excluir a Troca de '+br(item.data)+' do '+find(selected).title+'? A Exclusão Será Auditada.'))return;
 saving=true;
 try{
  const all=await getDocs(logs(selected));
  const entries=all.docs.map(d=>({id:d.id,...d.data()})).sort(byRecency);
  if(!entries.some(x=>x.id===reviewId))throw Error('Lançamento Não Encontrado.');
  const newest=entries[0]?.id===reviewId,older=entries.filter(x=>x.id!==reviewId).sort(byRecency)[0];
  const batch=writeBatch(db);batch.delete(doc(logs(selected),reviewId));
  if(newest){
    const c=get(selected),mat=older?.material||item.anteriorMaterial||c.material,preset=specs(selected,mat);
    batch.set(docRef(selected),{title:c.title||find(selected).title,material:mat,
      dataTroca:older?.data||item.anteriorDataTroca||'',
      limiteOrdenhas:preset?.ciclos??(older?.anteriorLimiteOrdenhas??item.anteriorLimiteOrdenhas??c.limiteOrdenhas??null),
      limiteMeses:preset?.meses??(older?.anteriorLimiteMeses??item.anteriorLimiteMeses??c.limiteMeses??null),
      observacoes:c.observacoes||'',ativo:c.ativo!==false,updatedByUid:user.uid,updatedAt:serverTimestamp()});
  }
  batch.set(doc(collection(db,'auditoriaManutencao')),{origem:'componente',registroId:reviewId,referenciaId:selected,
    descricao:find(selected).title,data:item.data||'',actorUid:user.uid,actorEmail:user.email||'',at:serverTimestamp()});
  await batch.commit();notify('Troca Excluída. '+(newest?'A Última Troca Foi Recalculada.':'Histórico Atualizado.'));
 }catch(ex){console.error(ex);notify('Falha ao Excluir Troca: '+(ex.code||ex.message),true)}
 finally{saving=false}
}
async function toggleComponent(id){
 if(!admin||!user||saving||!find(id))return;
 const c=get(id),deleting=c.ativo!==false;
 if(!confirm((deleting?'Excluir':'Restaurar')+' o Componente "'+find(id).title+'"? '+(deleting?'O Histórico Será Mantido para Recuperação.':'')))return;
 saving=true;
 try{
  const batch=writeBatch(db);
  batch.set(docRef(id),{title:c.title||find(id).title,material:c.material,dataTroca:c.dataTroca||'',
    limiteOrdenhas:c.limiteOrdenhas??null,limiteMeses:c.limiteMeses??null,
    observacoes:c.observacoes||'',ativo:!deleting,updatedByUid:user.uid,updatedAt:serverTimestamp()});
  batch.set(doc(collection(db,'auditoriaManutencao')),{origem:'cadastro_componente',registroId:id,referenciaId:id,
    descricao:(deleting?'Excluído: ':'Restaurado: ')+find(id).title,data:iso(),
    actorUid:user.uid,actorEmail:user.email||'',at:serverTimestamp()});
  await batch.commit();notify('Componente '+(deleting?'Excluído da Lista Ativa.':'Restaurado.') );
 }catch(ex){console.error(ex);notify('Falha na Operação: '+(ex.code||ex.message),true)}
 finally{saving=false}
}
$("componentCards").addEventListener("click",e=>{
 const el=e.target.closest("[data-component-edit],[data-component-change],[data-component-history],[data-component-toggle]");if(!el)return;
 if(el.dataset.componentEdit)edit(el.dataset.componentEdit);
 else if(el.dataset.componentChange)change(el.dataset.componentChange);
 else if(el.dataset.componentHistory)viewHistory(el.dataset.componentHistory);
 else if(el.dataset.componentToggle)toggleComponent(el.dataset.componentToggle);
});
$("componentMaterial").addEventListener("change",materialChange);
$("componentEditForm").addEventListener("submit",save);
$("componentChangeForm").addEventListener("submit",saveChange);
$("componentHistoryClose").onclick=()=>{if(stopHistory){stopHistory();stopHistory=null}$("componentHistoryPanel").hidden=true};
$("componentHistoryList").addEventListener("click",e=>{const b=e.target.closest('[data-component-review-delete]');if(b)deleteComponentReview(b.dataset.componentReviewDelete)});
$("componentCreate").addEventListener("click",createComponent);
$("componentShowInactive").addEventListener("click",()=>{showInactive=!showInactive;render()});
document.querySelectorAll("[data-component-close]").forEach(el=>el.onclick=()=>modal(el.dataset.componentClose,false));
for(const id of ["componentEditModal","componentChangeModal"])$(id).onclick=e=>{if(e.target===$(id))modal(id,false)};
function disconnect(){for(const stop of stops)stop();stops=[];if(stopHistory){stopHistory();stopHistory=null}for(const id of Object.keys(data))delete data[id];defs=[...starter];routine=null;user=null;admin=false;showInactive=false}
render();
onAuthStateChanged(auth,async current=>{
 disconnect();$("componentHistoryPanel").hidden=true;
 if(!current){notify("Entre no Sistema para Consultar os Componentes.");render();return}
 try{
  const snap=await getDoc(doc(db,"usuarios",current.uid));if(!snap.exists()||snap.data().ativo!==true){notify("Conta Não Autorizada.",true);return}
  user=current;admin=snap.data().role==="admin";
  stops.push(onSnapshot(doc(db,"manutencaoOrdenha","teteiras"),r=>{routine=r.exists()?r.data():null;render()},ex=>{console.error(ex);notify("Falha ao Ler a Rotina da Ordenha.",true)}));
  stops.push(onSnapshot(collectionRef(),snap=>{
    for(const id of Object.keys(data))delete data[id];
    for(const d of snap.docs)data[d.id]=d.data();
    defs=[...starter.map(d=>({...d,title:data[d.id]?.title||d.title})),
      ...snap.docs.filter(d=>!isStarter(d.id)).map(d=>({id:d.id,title:d.data().title||'Componente sem Nome',materials:['Borracha','Silicone','Outro']}))];
    render();notify('Componentes Sincronizados com a Rotina.');
  },ex=>{console.error(ex);notify('Verifique as Regras do Firestore para os Componentes.',true)}));
 }catch(ex){console.error(ex);notify("Falha de Autorização.",true)}
});
