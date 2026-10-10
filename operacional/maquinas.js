import {getApps,getApp,initializeApp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,setDoc,addDoc,updateDoc,onSnapshot,query,orderBy,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const $=id=>document.getElementById(id);
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=[
  {id:"jd-5080e",marca:"John Deere",modelo:"5080E"},
  {id:"jd-3036en",marca:"John Deere",modelo:"3036EN"},
  {id:"nh-tl580",marca:"New Holland",modelo:"TL5.80"},
  {id:"nh-tm150",marca:"New Holland",modelo:"TM150"},
  {id:"cat-gerador",marca:"CAT",modelo:"Gerador"}
];
const root=window.CHACARA_FIREBASE_CONFIG;
if(!root?.projectId)throw Error("Configuração Firebase ausente");
const firebaseApp=getApps().length?getApp():initializeApp(root);
const auth=getAuth(firebaseApp), db=getFirestore(firebaseApp);
let currentUser=null,admin=false,machines=[],chosenId="",stopMachines=null,stopHistory=null,history=[],formEditingId="",parts=[],saving=false,liveReady=false;
const COLLECTION="maquinas";
const machineTodayISO=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const dateLabel=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||""))?String(s).split("-").reverse().join("/"):"Não Informada";
const machineName=m=>[m.marca,m.modelo].filter(Boolean).join(" ");
const countNum=v=>v===null||v===undefined||v===""?null:Number(v);
function message(text,warning=false){const el=$("machineMessage");el.textContent=text;el.classList.toggle("warn",warning)}
function diffDays(to){const x=new Date(to+"T12:00:00");return Math.ceil((x-new Date())/86400000)}
function plusMonths(date,n){
  const [y,m,d]=date.split("-").map(Number),month=new Date(y,m-1+n,1),last=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const target=new Date(month.getFullYear(),month.getMonth(),Math.min(d,last),12);
  return [target.getFullYear(),String(target.getMonth()+1).padStart(2,"0"),String(target.getDate()).padStart(2,"0")].join("-");
}
function computeOilStatus(m){
  const intH=countNum(m.intervaloHoras),intM=countNum(m.intervaloMeses);
  const hourValid=intH>0&&m.ultimaTrocaHoras!=null&&m.horimetroAtual!=null;
  const dateValid=intM>0&&/^\d{4}-\d{2}-\d{2}$/.test(m.ultimaTrocaData||"");
  const nextHour=hourValid?Number(m.ultimaTrocaHoras)+intH:null;
  const dueHour=hourValid?nextHour-Number(m.horimetroAtual):null;
  const nextDate=dateValid?plusMonths(m.ultimaTrocaData,intM):"";
  const remainDays=dateValid?diffDays(nextDate):null;
  if(!hourValid&&!dateValid)return {status:"Sem Referência",kind:"unknown",dueHour:null,nextDate:"",remainDays:null};
  const overdue=(hourValid&&dueHour<=0)||(dateValid&&remainDays<0);
  const near=(hourValid&&dueHour<=50)||(dateValid&&remainDays<=30);
  return {status:overdue?"Revisão Vencida":near?"Revisão Próxima":"Em Dia",kind:overdue?"overdue":near?"soon":"good",dueHour,nextDate,remainDays};
}
function metrics(){
  let overdue=0,soon=0,good=0,unknown=0;
  for(const m of machines){const s=computeOilStatus(m).kind;if(s==="overdue")overdue++;else if(s==="soon")soon++;else if(s==="good")good++;else unknown++}
  $("machineCount").textContent=machines.length;$("machineOverdue").textContent=overdue;$("machineSoon").textContent=soon;$("machineUnconfigured").textContent=unknown;
}
function renderList(){
  metrics();
  const q=$("machineSearch").value.toLocaleLowerCase("pt-BR");
  const visible=machines.filter(m=>[m.marca,m.modelo,m.numeroSerie,m.anoModelo].some(v=>String(v||"").toLocaleLowerCase("pt-BR").includes(q)));
  $("machinesGrid").innerHTML=visible.length?visible.map(m=>{
    const st=computeOilStatus(m),name=machineName(m);
    return '<button type="button" class="machine-tile '+(chosenId===m.id?"selected":"")+'" data-machine-id="'+safe(m.id)+'">'+
      '<div class="machine-tile-top"><strong>'+safe(name)+'</strong><span class="oil-pill '+st.kind+'">'+safe(st.status)+'</span></div>'+
      '<p>'+safe(m.numeroSerie?"Série: "+m.numeroSerie:"Número de Série Não Informado")+'</p>'+
      '<small>'+safe(m.horimetroAtual!=null?Number(m.horimetroAtual).toLocaleString("pt-BR")+" h":"Horímetro Não Informado")+'</small>'+
      '</button>';
  }).join(""):'<div class="machine-empty">Nenhum Equipamento Encontrado. Cadastre Equipamentos na Guia Configurações.</div>';
  renderSettingsList();
}
function renderSettingsList(){
  const region=$("machineSettingsList");if(!region)return;
  region.innerHTML=machines.length?machines.map(m=>'<div class="machine-settings-row"><div><strong>'+safe(machineName(m))+'</strong><small>'+safe(m.numeroSerie?"Série: "+m.numeroSerie:"Cadastro Pendente")+'</small></div><button class="btn secondary" data-machine-edit="'+safe(m.id)+'" type="button">Editar</button></div>').join(""):'<p class="muted">Nenhum Equipamento Cadastrado.</p>';
  const btn=$("seedMachines");btn.hidden=initials.every(entry=>machines.some(m=>m.id===entry.id));
}
function renderMachine(){
  const m=machines.find(x=>x.id===chosenId);
  $("machineDetail").hidden=!m;
  if(!m)return;
  const state=computeOilStatus(m);
  $("machineTitle").textContent=machineName(m);
  $("machineInfo").innerHTML=[
    ["Marca",m.marca||"—"],["Modelo",m.modelo||"—"],["Nº de Série",m.numeroSerie||"Não Informado"],
    ["Ano/Modelo",m.anoModelo||"Não Informado"],["Seguro",m.seguro||"Não Informado"],
    ["Horímetro Atual",m.horimetroAtual==null?"Não Informado":Number(m.horimetroAtual).toLocaleString("pt-BR")+" h"],
    ["Intervalo da Troca de Óleo",m.intervaloHoras?m.intervaloHoras+" Horas":"Não Configurado"],
    ["Intervalo por Tempo",m.intervaloMeses?m.intervaloMeses+" Meses":"Não Configurado"],
    ["Última Troca de Óleo",m.ultimaTrocaData?dateLabel(m.ultimaTrocaData):"Não Registrada"],
    ["Horímetro da Última Troca",m.ultimaTrocaHoras==null?"Não Informado":m.ultimaTrocaHoras+" h"]
  ].map(([k,v])=>'<div><span>'+safe(k)+'</span><strong>'+safe(v)+'</strong></div>').join("");
  $("machineOilStatus").className="oil-pill "+state.kind;
  $("machineOilStatus").textContent=state.status;
  $("machineNext").textContent=[
    state.dueHour!=null?"Próxima Troca: "+Number(m.ultimaTrocaHoras+m.intervaloHoras).toLocaleString("pt-BR")+" h ("+Math.round(state.dueHour)+" h Restantes)":"",
    state.nextDate?"Data-Limite: "+dateLabel(state.nextDate):""
  ].filter(Boolean).join(" • ")||"Informe o Intervalo e uma Troca Anterior para Calcular a Próxima Revisão.";
  $("machineNotes").textContent=m.observacoes||"Nenhuma Observação.";
  $("machineParts").innerHTML=Array.isArray(m.pecas)&&m.pecas.length?m.pecas.map(row=>'<tr><td>'+safe(row.codigo)+'</td><td>'+safe(row.descricao)+'</td></tr>').join(""):'<tr><td colspan="2">Nenhum Código de Peça Informado.</td></tr>';
  $("editSelectedMachine").hidden=!admin;
  $("logOilChange").hidden=!admin;
}
function showMachine(id){
  if(!machines.some(x=>x.id===id))return;
  chosenId=id;renderList();renderMachine();
  if(stopHistory){stopHistory();stopHistory=null}
  history=[];
  stopHistory=onSnapshot(query(collection(db,COLLECTION,id,"revisoes"),orderBy("createdAt","desc")),snap=>{
    history=snap.docs.map(d=>({id:d.id,...d.data()}));renderHistory()
  },err=>{console.error(err);$("machineHistory").textContent="Falha ao Carregar o Histórico. Confira as Regras do Firestore."});
}
function renderHistory(){
  $("machineHistory").innerHTML=history.length?history.map(v=>'<div class="oil-history-item"><strong>'+safe(dateLabel(v.data))+' · '+safe(v.tipo)+'</strong><span>'+safe(v.horimetro==null?"Sem Horímetro":v.horimetro+" h")+'</span><p>'+safe(v.observacoes||"Sem Observações")+'</p></div>').join(""):'<div class="machine-empty">Nenhuma Revisão Registrada.</div>';
}
const modal=(id,open)=>$(id).classList.toggle("show",open);
const blankPart=()=>({codigo:"",descricao:""});
function partsRender(){
  $("machinePartsEdit").innerHTML=parts.map((item,i)=>'<div class="parts-row"><input data-part-index="'+i+'" data-part-field="codigo" maxlength="60" placeholder="Código" aria-label="Código da Peça '+(i+1)+'" value="'+safe(item.codigo)+'"><input data-part-index="'+i+'" data-part-field="descricao" maxlength="160" placeholder="Descrição" aria-label="Descrição da Peça '+(i+1)+'" value="'+safe(item.descricao)+'"><button type="button" data-part-remove="'+i+'" class="parts-remove" aria-label="Remover Linha '+(i+1)+'" title="Remover Linha">×</button></div>').join("");
}
function openEditor(id=""){
  if(!admin)return;
  const m=machines.find(x=>x.id===id);
  formEditingId=m?.id||"";
  $("machineForm").reset();
  $("machineFormTitle").textContent=m?"Editar Equipamento":"Novo Equipamento";
  $("brand").value=m?.marca||"";$("model").value=m?.modelo||"";
  $("serial").value=m?.numeroSerie||"";$("modelYear").value=m?.anoModelo||"";
  $("insured").value=m?.seguro||"";$("machineObservations").value=m?.observacoes||"";
  $("machineHours").value=m?.horimetroAtual??"";
  $("oilIntervalHours").value=m?.intervaloHoras??"";
  $("oilIntervalMonths").value=m?.intervaloMeses??"";
  parts=Array.isArray(m?.pecas)?m.pecas.map(p=>({...p})):[blankPart()];
  if(parts.length===0)parts=[blankPart()];
  partsRender();modal("machineEditor",true);
}
function cleanNum(id){
  const v=$(id).value.trim();if(v==="")return null;
  const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error("Informe um Valor Numérico Válido.");
  return n;
}
async function saveMachine(event){
  event.preventDefault();if(!admin||saving)return;
  const marca=$("brand").value.trim(),modelo=$("model").value.trim();
  if(!marca||!modelo){message("Marca e Modelo São Obrigatórios.",true);return}
  const data={
    marca,modelo,numeroSerie:$("serial").value.trim(),anoModelo:$("modelYear").value.trim(),
    seguro:$("insured").value,observacoes:$("machineObservations").value.trim(),
    horimetroAtual:cleanNum("machineHours"),intervaloHoras:cleanNum("oilIntervalHours"),intervaloMeses:cleanNum("oilIntervalMonths"),
    pecas:parts.map(p=>({codigo:p.codigo.trim(),descricao:p.descricao.trim()})).filter(p=>p.codigo||p.descricao),
    updatedAt:serverTimestamp()
  };
  if(data.pecas.length>40){message("Limite de 40 Códigos de Peças.",true);return}
  if(data.pecas.some(p=>!p.codigo||!p.descricao)){message("Preencha Código e Descrição em Cada Linha.",true);return}
  const button=$("saveMachine");saving=true;button.disabled=true;
  try{
    if(formEditingId){
      const old=machines.find(x=>x.id===formEditingId);
      if(old?.ultimaTrocaHoras!=null&&data.horimetroAtual!=null&&data.horimetroAtual<old.ultimaTrocaHoras)throw Error("O Horímetro Atual Não Pode Ser Inferior ao da Última Troca.");
      await updateDoc(doc(db,COLLECTION,formEditingId),data);
    }else{
      await addDoc(collection(db,COLLECTION),{...data,ultimaTrocaData:"",ultimaTrocaHoras:null,createdByUid:currentUser.uid,createdAt:serverTimestamp()});
    }
    modal("machineEditor",false);message("Equipamento Salvo e Sincronizado.");
  }catch(error){console.error(error);message("Não Foi Possível Salvar: "+(error.message||error.code),true)}
  finally{saving=false;button.disabled=false}
}
function editOil(){
  const m=machines.find(x=>x.id===chosenId);if(!m||!admin)return;
  $("oilForm").reset();
  $("oilDate").value=machineTodayISO();
  $("oilHours").value=m.horimetroAtual??"";
  $("oilEquipmentName").textContent=machineName(m);
  modal("oilModal",true);
}
async function saveOil(event){
  event.preventDefault();if(!admin||!chosenId||saving)return;
  const m=machines.find(x=>x.id===chosenId);if(!m)return;
  const date=$("oilDate").value,hour=cleanNum("oilHours");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){message("Informe uma Data Válida.",true);return}
  if(date>machineTodayISO()){message("A Data da Troca Não Pode Estar no Futuro.",true);return}
  if(m.ultimaTrocaData&&date<m.ultimaTrocaData){message("A Data É Anterior à Última Troca. Corrija a Data.",true);return}
  if(hour!=null&&m.ultimaTrocaHoras!=null&&hour<m.ultimaTrocaHoras){message("O Horímetro Não Pode Ser Inferior ao da Última Troca.",true);return}
  const review={tipo:"Troca de Óleo",data:date,horimetro:hour,observacoes:$("oilNotes").value.trim(),createdAt:serverTimestamp(),createdByUid:currentUser.uid};
  const batch=writeBatch(db),oid=doc(collection(db,COLLECTION,chosenId,"revisoes"));
  batch.set(oid,review);
  const update={ultimaTrocaData:date,ultimaTrocaHoras:hour,updatedAt:serverTimestamp()};
  if(hour!=null&&(m.horimetroAtual==null||m.horimetroAtual<hour))update.horimetroAtual=hour;
  batch.update(doc(db,COLLECTION,chosenId),update);
  const button=$("saveOil");button.disabled=true;saving=true;
  try{await batch.commit();modal("oilModal",false);message("Troca de Óleo Registrada no Histórico.")}
  catch(error){console.error(error);message("Não Foi Possível Registrar: "+(error.message||error.code),true)}
  finally{button.disabled=false;saving=false}
}
async function seedMachines(){
  if(!admin)return;
  const missing=initials.filter(entry=>!machines.some(m=>m.id===entry.id));
  if(!missing.length){message("Todos os Equipamentos Iniciais Já Estão Cadastrados.");return}
  if(!confirm("Cadastrar "+missing.length+" Equipamentos Iniciais? Os Dados Desconhecidos Ficarão em Branco."))return;
  const button=$("seedMachines");button.disabled=true;
  try{
    // Evita sobrescrever documentos existentes caso outro administrador tenha criado um.
    const pending=await Promise.all(missing.map(async e=>({e,snap:await getDoc(doc(db,COLLECTION,e.id))})));
    const batch=writeBatch(db),newItems=pending.filter(x=>!x.snap.exists()).map(x=>x.e);
    for(const e of newItems){
      batch.set(doc(db,COLLECTION,e.id),{
        marca:e.marca,modelo:e.modelo,numeroSerie:"",anoModelo:"",seguro:"",
        observacoes:"",pecas:[],horimetroAtual:null,intervaloHoras:null,intervaloMeses:null,
        ultimaTrocaData:"",ultimaTrocaHoras:null,
        createdByUid:currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
    }
    if(newItems.length)await batch.commit();
    message(newItems.length+" Equipamentos Cadastrados. Complete os Dados em Configurações.");
  }catch(err){console.error(err);message("Cadastro Não Concluído: "+(err.message||err.code)+". Verifique as Regras do Firestore.",true)}
  finally{button.disabled=false}
}
function onLogin(user){
  if(stopMachines){stopMachines();stopMachines=null}
  if(stopHistory){stopHistory();stopHistory=null}
  machines=[];history=[];chosenId="";currentUser=user;admin=false;liveReady=false;
  $("machineDetail").hidden=true;
  if(!user){renderList();return}
  getDoc(doc(db,"usuarios",user.uid)).then(profile=>{
    if(!profile.exists()||profile.data().ativo!==true)return;
    admin=profile.data().role==="admin";
    $("machineGoSettings").hidden=!admin;
    $("machineSettingsAdmin").hidden=!admin;
    $("editSelectedMachine").hidden=!admin;
    $("logOilChange").hidden=!admin;
    stopMachines=onSnapshot(collection(db,COLLECTION),snapshot=>{
      machines=snapshot.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>machineName(a).localeCompare(machineName(b),"pt-BR"));
      liveReady=true;message(machines.length?"Equipamentos Sincronizados com o Firebase.":"Nenhum Equipamento Cadastrado. O Administrador Pode Adicionar os Cinco Equipamentos Iniciais.");
      renderList();
      if(chosenId&&machines.some(m=>m.id===chosenId))renderMachine();
      else if(machines.length)showMachine(machines[0].id);
      else{$("machineDetail").hidden=true;chosenId=""}
    },err=>{console.error(err);message("Falha ao Ler Máquinas. Atualize as Regras do Firestore e Tente Novamente.",true)});
  }).catch(error=>{console.error(error);message("Falha de Permissão. Verifique o Perfil do Usuário.",true)});
}
$("machineSearch").addEventListener("input",renderList);
$("machinesGrid").addEventListener("click",e=>{const t=e.target.closest("[data-machine-id]");if(t)showMachine(t.dataset.machineId)});
$("machineSettingsList").addEventListener("click",e=>{const t=e.target.closest("[data-machine-edit]");if(t)openEditor(t.dataset.machineEdit)});
$("machineNew").onclick=()=>openEditor();
$("machineGoSettings").onclick=()=>{if(admin)document.querySelector('[data-page="configuracoes"]')?.click()};
$("editSelectedMachine").onclick=()=>openEditor(chosenId);
$("logOilChange").onclick=editOil;
$("machineForm").addEventListener("submit",saveMachine);
$("oilForm").addEventListener("submit",saveOil);
$("seedMachines").onclick=seedMachines;
$("machinePartsAdd").onclick=()=>{if(parts.length>=40){message("Máximo de 40 Linhas de Peças.",true);return}parts.push(blankPart());partsRender()};
$("machinePartsEdit").addEventListener("input",e=>{
  const el=e.target.closest("[data-part-index]");if(!el)return;
  parts[Number(el.dataset.partIndex)][el.dataset.partField]=el.value
});
$("machinePartsEdit").addEventListener("click",e=>{
  const button=e.target.closest("[data-part-remove]");if(!button)return;
  parts.splice(Number(button.dataset.partRemove),1);partsRender()
});
document.querySelectorAll("[data-machine-close]").forEach(button=>button.addEventListener("click",()=>modal(button.dataset.machineClose,false)));
["machineEditor","oilModal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))modal(id,false)}));
onAuthStateChanged(auth,onLogin);
