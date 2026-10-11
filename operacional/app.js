import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const cfg = window.CHACARA_FIREBASE_CONFIG;

let auth, db, user;
let role = 'operator';
let items = [];
let unsubscribe = null;
let pendingId = null;
let pendingStatus = null;
let unsubscribeSettings = null;
let unsubscribeNotes = null;
let currentNotes = [];
let settings = null;
let optionEdit = { category: null, id: null };
let settingsWarning = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const toast = (message) => {
  const el = $('toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(window._noticeTimeout);
  window._noticeTimeout = setTimeout(() => { el.style.display = 'none'; }, 5000);
};

const fmt = function ptDate(raw){
  const key=dateKey(raw);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return "Sem Prazo";
  const [y,m,d]=key.split('-');
  const clock=String(raw||'').match(/T(\d{2}:\d{2})/);
  return `${d}/${m}/${y}`+(clock?` Às ${clock[1]}`:"");
};

const isEventItem=t=>['Evento','Rotina'].includes(t?.type);
const stateLabel = {
  aberta: 'Em Aberto',
  andamento: 'Em Andamento',
  concluida: 'Concluída'
};

const sectionLabel = {
  tarefas: 'Tarefas e Ocorrências',
  eventos: 'Eventos',
  agenda: 'Agenda de Eventos',
  compras: 'Lista de Compras',
  historico: 'Histórico de Atividades',
  maquinas: 'Revisão de Máquinas',
  ordenha: 'Manutenção da Ordenha',
  configuracoes: 'Configurações',
  usuarios: 'Gestão de Usuários'
};

const modal = (id, open) => {
  $(id).classList.toggle('show', open);
  if(id==='detail'&&!open&&unsubscribeNotes){unsubscribeNotes();unsubscribeNotes=null;currentNotes=[]}
};

$('today').textContent = new Date().toLocaleDateString('pt-BR', { dateStyle: 'full' });

document.querySelectorAll('[data-close]').forEach((button) => {
  button.onclick = () => modal(button.dataset.close, false);
});

document.querySelectorAll('.modal').forEach((m) => {
  m.onclick = (e) => {
    if (e.target === m) modal(m.id, false);
  };
});

document.querySelectorAll('[data-page]').forEach((button) => {
  button.onclick = () => {
    if(['configuracoes','usuarios'].includes(button.dataset.page)&&role!=='admin')return;
    document.querySelectorAll('[data-page]').forEach((x) => x.classList.toggle('active', x === button));
    document.querySelectorAll('.section').forEach((x) => x.classList.toggle('active', x.id === button.dataset.page));
    render();
  };
});

$('search').oninput = render;
$('filter').onchange = render;
$('logout').onclick = async () => { if (auth) await signOut(auth); };
$('refresh').onclick = () => { render(); toast('Dados Atualizados.'); };

let monthCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);

let selectedDay=dayISO(new Date()),viewId='',deleteId='';

function dayISO(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}

function dateKey(value){return String(value||'').slice(0,10)}

function ptDate(raw){
  const key=dateKey(raw);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return "Sem Prazo";
  const [y,m,d]=key.split('-');
  const clock=String(raw||'').match(/T(\d{2}:\d{2})/);
  return `${d}/${m}/${y}`+(clock?` Às ${clock[1]}`:"");
}

const smallPt = new Set(['a','o','as','os','um','uma','uns','umas','e','ou','de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem','até','entre','ao','aos','à','às','pelo','pela','pelos','pelas','que','se']);
const brandsPt = {firebase:'Firebase',firestore:'Firestore',github:'GitHub',google:'Google',authentication:'Authentication',html:'HTML',css:'CSS',csv:'CSV',pdf:'PDF',id:'ID',uid:'UID',ip:'IP',gea:'GEA',thi:'THI',nedap:'Nedap',iatf:'IATF'};
function capWords(text){
  let n=0;
  return String(text??'').trim().replace(/\p{L}+(?:[-’']\p{L}+)*/gu,(word)=>{
    const low=word.toLocaleLowerCase('pt-BR');
    const out=n>0&&smallPt.has(low)?low:(brandsPt[low]||low[0].toLocaleUpperCase('pt-BR')+low.slice(1));
    n++;
    return out;
  });
}


// Catálogos editáveis: valores por padrão preservados para que nenhuma implantação
// seja necessária antes da primeira configuração do administrador.
const SETTING_GROUPS=[
  {key:'setores',label:'Setores',single:'Setor'},
  {key:'responsaveis',label:'Responsáveis',single:'Responsável'},
  {key:'tipos',label:'Tipos',single:'Tipo'}
];
const DEFAULT_SETTINGS={
  setores:['Ordenha','Pátio e Acessos','Manutenção Máquinas','Manutenção Equipamentos','Confinamento','Escritório','Farmácia','Lavanderia','Alimentação','Sala do Tanque','Outros'],
  responsaveis:['Gilberto','Teodoro','Marília','Funcionário'],
  tipos:['Ocorrência','Tarefa','Evento','Rotina']
};
const PROTECTED_TYPES=new Set(['Ocorrência','Evento','Rotina']);
const configDoc=()=>doc(db,'configuracoes','opcoes');
const normalizedName=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');
const isProtected=(key,entry)=>key==='tipos'&&PROTECTED_TYPES.has(entry.nome);
const defaults=()=>Object.fromEntries(SETTING_GROUPS.map(({key})=>[key,DEFAULT_SETTINGS[key].map((nome,index)=>({id:key+'-'+String(index+1).padStart(2,'0'),nome,ativo:true}))]));
function readSettings(raw){
  const basis=defaults();
  if(!raw||typeof raw!=='object')return basis;
  for(const {key} of SETTING_GROUPS){
    const arr=raw[key];
    if(!Array.isArray(arr))continue;
    const unique=new Set();
    basis[key]=arr.filter(entry=>entry&&typeof entry==='object'&&typeof entry.id==='string'&&entry.id.length<=90&&typeof entry.nome==='string'&&entry.nome.length<=80)
      .filter(entry=>{const n=normalizedName(entry.nome);if(!n||unique.has(n))return false;unique.add(n);return true})
      .map(entry=>({id:entry.id,nome:entry.nome.trim(),ativo:entry.ativo===true}));
  }
  // Os tipos internos são usados pelas regras de segurança e pelo calendário.
  for(const type of PROTECTED_TYPES){
    const item=basis.tipos.find(v=>v.nome===type);
    if(item)item.ativo=true;
    else basis.tipos.push({id:'tipo-essencial-'+normalizedName(type),nome:type,ativo:true});
  }
  return basis;
}
settings=defaults();
function renderFormOptions(){
  for(const [elementId,key] of [['sector','setores'],['assignee','responsaveis'],['type','tipos']]){
    const select=$(elementId);
    const selected=select.value;
    const enabled=settings[key].filter(item=>item.ativo && (key!=='tipos'||role==='admin'||item.nome!=='Rotina'));
    select.replaceChildren();
    if(key==='responsaveis'){
      const empty=document.createElement('option');empty.value='';empty.textContent='Selecionar Responsável';select.append(empty);
    }
    for(const item of enabled){
      const option=document.createElement('option');option.value=item.nome;option.textContent=item.nome;select.append(option);
    }
    if([...select.options].some(option=>option.value===selected))select.value=selected;
    else if(key==='responsaveis')select.value='';
    else if(key==='tipos'&&[...select.options].some(option=>option.value==='Ocorrência'))select.value='Ocorrência';
    else select.selectedIndex=0;
  }
}
const CFG_ICONS={
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 0 3 3 0 12-12-3-3L4 17Z"/><path d="m14 7 3 3"/></svg>',
  off:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9"/><path d="M6.4 5.4a9 9 0 1 0 11.2 0"/></svg>',
  on:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  lock:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
};
function renderSettings(){
  const wrap=$('settingsCards');
  if(!wrap)return;
  wrap.innerHTML=SETTING_GROUPS.map(({key,label})=>{
    const entries=settings[key];
    const activeCount=entries.filter(item=>item.ativo).length;
    const rows=entries.map(item=>{
      const locked=isProtected(key,item);
      const editTitle=locked?'Tipo Essencial do Sistema':'Renomear Opção';
      const toggleTitle=locked?'Tipo Essencial do Sistema':item.ativo?'Desativar Opção':'Reativar Opção';
      return '<div class="config-item '+(item.ativo?'':'inactive')+'">'+
        '<span class="config-item-name">'+esc(item.nome)+'</span>'+
        (locked?'<span class="config-badge">Fixo</span>':!item.ativo?'<span class="config-badge">Inativo</span>':'')+
        '<div class="config-row-actions">'+
        '<button class="config-icon" type="button" data-option-action="edit" data-option-key="'+key+'" data-option-id="'+esc(item.id)+'" title="'+editTitle+'" aria-label="'+editTitle+': '+esc(item.nome)+'" '+(locked?'disabled':'')+'>'+CFG_ICONS.edit+'</button>'+
        '<button class="config-icon '+(item.ativo?'warning':'reactivate')+'" type="button" data-option-action="toggle" data-option-key="'+key+'" data-option-id="'+esc(item.id)+'" title="'+toggleTitle+'" aria-label="'+toggleTitle+': '+esc(item.nome)+'" '+(locked?'disabled':'')+'>'+(locked?CFG_ICONS.lock:item.ativo?CFG_ICONS.off:CFG_ICONS.on)+'</button>'+
        '</div></div>';
    }).join('');
    return '<article class="config-card"><div class="config-card-head"><div><h3>'+esc(label)+'</h3><span class="config-count">'+activeCount+' Ativas</span></div>'+
      '<button class="btn config-add" type="button" data-option-action="add" data-option-key="'+key+'" title="Adicionar '+esc(label)+'" aria-label="Adicionar '+esc(label)+'">+</button></div>'+
      '<div class="config-items">'+rows+'</div>'+
      (key==='tipos'?'<p class="config-note">Ocorrência e Evento São Essenciais para o Funcionamento do Tablet e da Agenda.</p>':'')+'</article>';
  }).join('');
  const notice=$('settingsNotice');
  if(settingsWarning){notice.textContent=settingsWarning;notice.classList.add('warn')}
  else{notice.textContent='Alterações Salvas no Firebase São Sincronizadas Automaticamente com o Tablet e os Computadores.';notice.classList.remove('warn')}
}
function openOptionEditor(category,id=null){
  if(role!=='admin'||!SETTING_GROUPS.some(x=>x.key===category))return;
  const item=id?settings[category].find(x=>x.id===id):null;
  if(id&&!item)return;
  if(item&&isProtected(category,item)){toast('Esta Opção É Essencial para o Sistema.');return}
  optionEdit={category,id};
  $('optionForm').reset();
  $('optionName').value=item?item.nome:'';
  const group=SETTING_GROUPS.find(x=>x.key===category);
  $('optionModalTitle').textContent=item?'Renomear '+group.single:'Adicionar '+group.single;
  $('optionHelp').textContent='Esta Alteração Será Usada Apenas em Novos Registros. Os Registros Antigos Permanecem Intactos.';
  modal('optionModal',true);
  $('optionName').focus();
}
async function mutateOptions(category,action,id='',value=''){
  if(role!=='admin'||!user)throw new Error('Somente o Administrador Pode Alterar Configurações.');
  if(!SETTING_GROUPS.some(group=>group.key===category))throw new Error('Categoria Inválida.');
  const fresh=String(value||'').replace(/\s+/g,' ').trim();
  if(['add','edit'].includes(action)&&(fresh.length<2||fresh.length>80))throw new Error('O Nome Deve Ter de 2 a 80 Caracteres.');
  await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(configDoc());
    const data=readSettings(snapshot.exists()?snapshot.data():null);
    const entries=data[category];
    const item=entries.find(x=>x.id===id);
    if(action==='add'){
      if(entries.length>=60)throw new Error('Limite de 60 Opções por Categoria.');
      if(entries.some(x=>normalizedName(x.nome)===normalizedName(fresh)))throw new Error('Esta Opção Já Existe. Reative-a se Estiver Inativa.');
      entries.push({id:'opt-'+String(Date.now())+'-'+Math.random().toString(36).slice(2,10),nome:fresh,ativo:true});
    }else{
      if(!item)throw new Error('Opção Não Encontrada. Atualize a Página.');
      if(isProtected(category,item))throw new Error('Esta Opção É Essencial para o Sistema.');
      if(action==='edit'){
        if(entries.some(x=>x.id!==item.id&&normalizedName(x.nome)===normalizedName(fresh)))throw new Error('Já Existe Uma Opção com Este Nome.');
        item.nome=fresh;
      }else if(action==='toggle'){
        if(item.ativo&&entries.filter(x=>x.ativo).length<=1)throw new Error('É Necessário Manter ao Menos Uma Opção Ativa.');
        item.ativo=!item.ativo;
      }else throw new Error('Operação Inválida.');
    }
    transaction.set(configDoc(),{...data,updatedByUid:user.uid,updatedAt:serverTimestamp()});
  });
}
$('settingsCards').addEventListener('click',async e=>{
  const button=e.target.closest('[data-option-action]');
  if(!button||role!=='admin')return;
  const {optionAction:action,optionKey:key,optionId:id}=button.dataset;
  if(action==='add'||action==='edit')return openOptionEditor(key,id||null);
  if(action==='toggle'){
    const item=settings[key]?.find(x=>x.id===id);
    if(!item)return;
    if(item.ativo&&!confirm('Desativar "'+item.nome+'"? Esta Opção Não Aparecerá em Novos Registros.'))return;
    button.disabled=true;
    try{await mutateOptions(key,'toggle',id);toast(item.ativo?'Opção Desativada.':'Opção Reativada.')}
    catch(error){console.error(error);toast('Não Foi Possível Salvar: '+(error.message||error.code))}
    finally{button.disabled=false}
  }
});
$('optionForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(role!=='admin'||!optionEdit.category)return;
  const btn=$('optionSave');btn.disabled=true;
  try{
    await mutateOptions(optionEdit.category,optionEdit.id?'edit':'add',optionEdit.id||'',$('optionName').value);
    modal('optionModal',false);toast('Configurações Salvas e Sincronizadas.');
  }catch(error){console.error(error);toast('Não Foi Possível Salvar: '+(error.message||error.code))}
  finally{btn.disabled=false}
});

// Cada rotina semanal é armazenada uma única vez no Firestore.
// As ocorrências de cada semana são calculadas para os dias visíveis.
const isRecurring=t=>(t?.type==='Rotina'&&['daily','weekly','monthly'].includes(t?.recurrence))||(t?.type==='Evento'&&t?.recurrence==='weekly');
const recurrenceLabel=t=>t?.recurrence==='daily'?'Todos os Dias':t?.recurrence==='monthly'?'Todo Mês':'Toda Semana';
const weekDaysLong=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
function weeklyDateText(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'Selecione a Data de Início da Rotina.';
 const [y,m,d]=date.split('-').map(Number),day=weekDaysLong[new Date(y,m-1,d,12).getDay()],freq=$('repeatFrequency').value;
 if(freq==='daily')return 'Repete Todos os Dias'+($('dueTime').value?' às '+$('dueTime').value:'')+'.';
 if(freq==='monthly')return 'Repete Todo Mês a Partir do Dia '+d+($('dueTime').value?' às '+$('dueTime').value:'')+'.';
 const plural=day.endsWith('-feira')?day.replace('-feira','s-feiras'):day+'s';
 return 'Repete '+(day==='Domingo'||day==='Sábado'?'Todos os ':'Todas as ')+plural+($('dueTime').value?' às '+$('dueTime').value:'')+'.';
}
function toggleEventRepetition(){
 const routine=$('type').value==='Rotina';
 $('eventRepeatArea').hidden=!routine;
 $('repeatUntil').required=routine;
 $('dueDate').required=routine||$('type').value==='Evento';
 $('dueDateLabel').textContent=routine?'Data de Início da Rotina *':'Prazo / Data do Evento';
 if(!routine){$('repeatFrequency').value='weekly';$('repeatUntil').value=''}
 $('repeatWeeklyDetails').hidden=!routine;
 if(routine)$('repeatSummary').textContent=weeklyDateText($('dueDate').value);
}
$('type').addEventListener('change',toggleEventRepetition);
$('repeatFrequency').addEventListener('change',toggleEventRepetition);
$('dueDate').addEventListener('change',toggleEventRepetition);
$('dueTime').addEventListener('change',toggleEventRepetition);
const isDateKey=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const utcDateIndex=d=>{const [y,m,day]=d.split('-').map(Number);return Date.UTC(y,m-1,day)/86400000};
function expandOccurrencesForDays(days){
 const daily=Object.fromEntries(days.map(day=>[day,[]])),indexes=new Map(days.map(day=>[day,utcDateIndex(day)]));
 for(const item of items){
  const start=dateKey(item.dueAt);
  if(!isDateKey(start))continue;
  if(!isRecurring(item)){
   if(daily[start])daily[start].push({...item,occurrenceDate:start,occurrenceAt:item.dueAt});
   continue;
  }
  if(item.status==='concluida')continue;
  const startIndex=utcDateIndex(start),until=isDateKey(item.recurrenceUntil)?item.recurrenceUntil:'';
  const [sy,sm,sd]=start.split('-').map(Number);
  for(const day of days){
   if(day<start||(until&&day>until))continue;
   const delta=indexes.get(day)-startIndex,[y,m,d]=day.split('-').map(Number);
   const match=item.recurrence==='daily'?delta>=0:
     item.recurrence==='weekly'?delta>=0&&delta%7===0:
     item.recurrence==='monthly'?(y-sy)*12+(m-sm)>=0&&d===Math.min(sd,new Date(y,m,0).getDate()):false;
   if(match)daily[day].push({...item,occurrenceDate:day,occurrenceAt:day+String(item.dueAt||'').slice(10)});
  }
 }
 return daily;
}

function eventType(task){return task.priority==='Crítica'?'critical':task.priority==='Urgente'?'urgent':''}

const UI_ICONS={
  search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.3 4.3"/></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  delete:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18"/></svg>'
};
function summaryCard(task){
  const badge=task.priority==="Crítica"?"critica":task.priority==="Urgente"?"urgente":"";
  const done=task.status==="concluida";
  const onlyEvent=isEventItem(task);
  return `<article class="task"><div><h3>${esc(capWords(task.title))}</h3><div class="chips">
   <span class="chip ${badge}">${esc(task.priority)}</span>
   <span class="chip ${done?'concluida':''}">${esc(onlyEvent?'Programado':stateLabel[task.status]||task.status)}</span>
   <span class="chip">${esc(task.type)}</span>${isRecurring(task)?'<span class="chip recurrence">↻ '+recurrenceLabel(task)+'</span>':''}</div>
   <div class="muted">${esc(task.sector)} · Responsável: ${esc(task.assignee||'Não Definido')} · ${esc(ptDate(task.dueAt))}</div>
   ${task.details?`<p class="muted">${esc(task.details)}</p>`:''}</div>
   <div class="actions">
   <button class="btn secondary icon-action icon-search" type="button" data-detail="${esc(task.id)}" title="Detalhes" aria-label="Detalhes">${UI_ICONS.search}</button>
   ${!onlyEvent&&!isRecurring(task)&&task.status==="aberta"?`<button class="btn secondary" data-status="andamento" data-id="${esc(task.id)}">Iniciar</button>`:""}
   ${!onlyEvent&&!done&&!isRecurring(task)?`<button class="btn icon-action icon-check" type="button" data-status="concluida" data-id="${esc(task.id)}" title="Concluir" aria-label="Concluir">${UI_ICONS.check}</button>`:""}
   ${role==="admin"?`<button class="delete-button icon-action icon-delete" type="button" data-delete="${esc(task.id)}" title="Excluir" aria-label="Excluir">${UI_ICONS.delete}</button>`:""}
   </div></article>`;
}

function renderCalendarNew(){
  const monthNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const weekNames=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const y=monthCursor.getFullYear(),m=monthCursor.getMonth();
  $('calendarMonth').textContent=monthNames[m]+' de '+y;
  const start=(new Date(y,m,1).getDay()+6)%7;
  const count=Math.ceil((start+new Date(y,m+1,0).getDate())/7)*7;
  const days=Array.from({length:count},(_,i)=>dayISO(new Date(y,m,i-start+1)));
  const daily=expandOccurrencesForDays(days);
  const now=dayISO(new Date()),cells=[];
  for(let i=0;i<count;i++){
    const d=new Date(y,m,i-start+1),day=dayISO(d),events=(daily[day]||[]).sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt)));
    const outside=d.getMonth()!==m;
    const previews=events.slice(0,2).map(t=>`<span class="calendar-event ${eventType(t)} ${isRecurring(t)?'recurring':''}">${esc(capWords(t.title))}</span>`).join('');
    const dots=events.slice(0,3).map(t=>`<span class="calendar-dot ${eventType(t)}"></span>`).join('');
    cells.push(`<button type="button" class="calendar-day ${outside?'outside':''} ${day===selectedDay?'selected':''} ${day===now?'today':''}" data-day="${day}" data-outside="${outside}" aria-pressed="${day===selectedDay}"><span class="calendar-number">${d.getDate()}</span>${previews}${events.length>2?`<span class="calendar-more">+${events.length-2} Mais</span>`:''}<span class="calendar-dots">${dots}</span></button>`);
  }
  $('calendarGrid').innerHTML=cells.join('');
  const [yy,mm,dd]=selectedDay.split('-').map(Number);const date=new Date(yy,mm-1,dd);
  $('selectedDateTitle').textContent=weekNames[date.getDay()]+', '+dd+' de '+monthNames[date.getMonth()]+' de '+yy;
  const dailyEvents=(daily[selectedDay]||[]).sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt)));
  $('selectedDateCount').textContent=dailyEvents.length+' '+(dailyEvents.length===1?'Atividade Programada':'Atividades Programadas');
  $('addCalendarEvent').classList.remove('auth-hidden');
  $('agendaList').innerHTML=dailyEvents.length?dailyEvents.map(t=>`<button type="button" class="agenda-entry ${eventType(t)}" data-detail="${esc(t.id)}" data-occurrence-date="${esc(t.occurrenceDate||'')}"><span class="mini">${esc((t.occurrenceAt||'').match(/T(\d{2}:\d{2})/)?.[1]||'Dia Inteiro')} · ${esc(t.type)} · ${esc(t.priority)}${isRecurring(t)?'<span class="repeat-indicator"> · ↻ '+recurrenceLabel(t)+'</span>':''}</span><b>${esc(capWords(t.title))}</b><span class="mini">${esc(t.sector)} · ${esc(stateLabel[t.status])}</span></button>`).join(''):'<div class="agenda-empty">Nenhuma Atividade para Este Dia.</div>';
}


let eventsPeriod='week';
let eventsAnchor=dayISO(new Date());
function activeEventWindow(){
 const [year,month,day]=eventsAnchor.split('-').map(Number),cursor=new Date(year,month-1,day,12);
 let first,last;
 if(eventsPeriod==='week'){
  first=new Date(cursor);first.setDate(first.getDate()-(first.getDay()+6)%7);
  last=new Date(first);last.setDate(first.getDate()+6);
 }else{first=new Date(year,month-1,1,12);last=new Date(year,month,0,12)}
 const days=[];for(const d=new Date(first);d<=last;d.setDate(d.getDate()+1))days.push(dayISO(d));
 return {days,start:dayISO(first),end:dayISO(last)};
}
function renderEventsNew(){
 const {days,start,end}=activeEventWindow(),daily=expandOccurrencesForDays(days);
 const entries=days.flatMap(date=>(daily[date]||[]).filter(isEventItem).map(event=>({...event,occurrenceDate:date})))
  .sort((a,b)=>String(a.occurrenceAt||a.occurrenceDate).localeCompare(String(b.occurrenceAt||b.occurrenceDate))||String(a.title).localeCompare(String(b.title),'pt-BR'));
 const range=ptDate(start)+' — '+ptDate(end);
 $('eventsQuickRange').textContent=range;$('eventsFullRange').textContent=range;
 document.querySelectorAll('[data-events-period]').forEach(button=>{
  const selected=button.dataset.eventsPeriod===eventsPeriod;
  button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
 });
 const card=item=>{
  const date=item.occurrenceDate||dateKey(item.dueAt);
  const clock=String(item.occurrenceAt||item.dueAt||'').match(/T(\d{2}:\d{2})/)?.[1]||'Dia Inteiro';
  return '<article class="ops-event-row"><div class="ops-event-when">'+esc(ptDate(date))+'<small>'+esc(clock)+'</small></div>'+
   '<div><h3 class="ops-event-title">'+esc(capWords(item.title))+'</h3><div class="ops-event-meta">'+esc(item.type)+
   ' · '+esc(item.sector||'Sem Setor')+' · '+esc(item.assignee||'Sem Responsável')+
   (isRecurring(item)?' · ↻ '+esc(recurrenceLabel(item)):'')+'</div></div>'+
   '<div class="ops-event-actions"><button type="button" data-detail="'+esc(item.id)+'" data-occurrence-date="'+esc(date)+'">Detalhes</button>'+
   (role==='admin'?'<button type="button" data-delete="'+esc(item.id)+'" title="Excluir Evento">×</button>':'')+'</div></article>';
 };
 $('eventsQuickList').innerHTML=entries.length?entries.slice(0,8).map(card).join(''):'<div class="ops-events-empty">Nenhum Evento ou Rotina Neste Período.</div>';
 $('eventsFullList').innerHTML=entries.length?entries.map(card).join(''):'<div class="ops-events-empty">Nenhum Evento ou Rotina Neste Período.</div>';
 if(entries.length>8)$('eventsQuickList').innerHTML+='<p class="ops-event-meta">Exibindo 8 de '+entries.length+' Ocorrências. Abra a Guia Eventos Para Ver Todas.</p>';
}
document.addEventListener('click',event=>{
 const toggle=event.target.closest('[data-events-period]');
 if(toggle){eventsPeriod=toggle.dataset.eventsPeriod;eventsAnchor=dayISO(new Date());renderEventsNew();return}
 let d=0;
 if(event.target.closest('[data-events-prev]'))d=-1;
 if(event.target.closest('[data-events-next]'))d=1;
 if(event.target.closest('[data-events-today]')){eventsAnchor=dayISO(new Date());renderEventsNew();return}
 if(d){
  const [y,m,day]=eventsAnchor.split('-').map(Number),cursor=new Date(y,m-1,day,12);
  if(eventsPeriod==='week')cursor.setDate(cursor.getDate()+d*7);else cursor.setMonth(cursor.getMonth()+d);
  eventsAnchor=dayISO(cursor);renderEventsNew();
 }
});
$('eventCreate').onclick=()=>openEditorNew('Evento');

function renderListsNew(){
 const executable=items.filter(t=>!isEventItem(t)),active=executable.filter(t=>t.status!=='concluida');
 $('statOpen').textContent=executable.filter(t=>t.status==='aberta').length;
 $('statProgress').textContent=executable.filter(t=>t.status==='andamento').length;
 $('statUrgent').textContent=active.filter(t=>['Crítica','Urgente'].includes(t.priority)).length;
 $('statDone').textContent=executable.filter(t=>t.status==='concluida').length;
 const filter=$('filter').value,names={ativas:'Pendentes e em Andamento',todas:'Todas as Atividades',aberta:'Em Aberto',andamento:'Em Andamento',urgentes:'Críticas / Urgentes',concluida:'Concluídas'};
 document.querySelectorAll('[data-kpi]').forEach(button=>{
  const selected=button.dataset.kpi===filter;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
 });
 $('filterSummary').innerHTML='Exibindo: '+esc(names[filter]||names.todas)+' <button type="button" class="link-btn" id="resetFilters">Limpar Filtro</button>';
 $('resetFilters').onclick=()=>{$('filter').value='ativas';$('search').value='';renderListsNew()};
 let shown=filter==='todas'?executable:filter==='ativas'?active:filter==='urgentes'?active.filter(t=>['Crítica','Urgente'].includes(t.priority)):executable.filter(t=>t.status===filter);
 const q=$('search').value.toLocaleLowerCase('pt-BR');
 shown=shown.filter(t=>[t.title,t.assignee,t.sector,t.details].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q)));
 const rank={'Crítica':0,'Urgente':1,'Normal':2,'Baixa':3};
 shown=[...shown].sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999')));
 $('taskList').innerHTML=shown.length?shown.map(summaryCard).join(''):'<div class="empty">Nenhuma Atividade Encontrada Neste Filtro.</div>';
 const done=executable.filter(t=>t.status==='concluida');
 $('historyList').innerHTML=done.length?done.map(summaryCard).join(''):'<div class="empty">Nenhuma Atividade Concluída.</div>';
}

function renderAllNew(){renderListsNew();renderCalendarNew();renderEventsNew()}

function openEditorNew(type,date){
  renderFormOptions();
  $('taskForm').reset();
  $('repeatFrequency').value='weekly';
  $('repeatUntil').value='';
  $('type').querySelectorAll('option').forEach(o=>o.disabled=role!=='admin'&&o.value==='Rotina');
  $('type').value=type||'Ocorrência';$('dueDate').value=date||'';
  toggleEventRepetition();
  $('editorTitle').textContent=type==='Evento'?'Novo Evento':type==='Rotina'?'Nova Rotina':'Nova Tarefa ou Ocorrência';
  modal('editor',true);
}

function formatNoteTime(value){
  return value?.toDate?.()?.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})||'Registrando...';
}
function noteLogRef(id){return collection(db,'tarefas',id,'atualizacoes')}
function renderTaskNotes(){
  const task=items.find(t=>t.id===viewId);
  const completed=task?.status==='concluida'||isEventItem(task);
  $('taskNoteForm').hidden=!task||completed||isRecurring(task);
  $('noteCount').textContent=currentNotes.length+' '+(currentNotes.length===1?'Atualização':'Atualizações');
  const notes=[...currentNotes];
  // Compatibilidade: exibe solução de tarefas concluídas antes da timeline.
  const legacy=task?.completionNote&&!notes.some(n=>n.tipo==='concluida');
  const html=notes.map(n=>'<article class="call-note"><div class="call-note-head"><strong>'+
    esc(n.autor||n.createdByEmail||'Usuário')+' · '+esc(n.tipo==='andamento'?'Iniciou':n.tipo==='concluida'?'Concluiu':'Nota')+
    '</strong><time>'+esc(formatNoteTime(n.createdAt))+'</time></div><p>'+esc(n.texto||'')+'</p></article>').join('');
  $('taskNotesList').innerHTML=html+(legacy?'<article class="call-note"><div class="call-note-head"><strong>'+
    esc(task.completedBy||'Responsável')+' · Concluiu</strong><time>'+esc(task.completedAtLocal||'')+'</time></div><p>'+
    esc(task.completionNote)+'</p></article>':'')||'<div class="muted">Ainda Não Existem Atualizações. O Relato Inicial Está Preservado Acima.</div>';
}
function attachTaskNotes(id){
  if(unsubscribeNotes){unsubscribeNotes();unsubscribeNotes=null}
  currentNotes=[];
  $('taskNotesList').textContent='Carregando Histórico...';
  unsubscribeNotes=onSnapshot(query(noteLogRef(id),orderBy('createdAt','asc')),snapshot=>{
    if(viewId!==id)return;
    currentNotes=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    renderTaskNotes();
  },err=>{
    console.error(err);
    $('taskNotesList').textContent='Falha ao Carregar as Notas. Atualize as Regras do Firebase.';
  });
}
$('taskNoteForm').onsubmit=async event=>{
  event.preventDefault();
  if(!user||!viewId)return;
  const task=items.find(t=>t.id===viewId),texto=$('taskNoteText').value.trim();
  if(!task||task.status==='concluida'||isEventItem(task)||isRecurring(task)){toast('O Chamado Não Está Aberto para Novas Notas.');return}
  if(!texto||texto.length>1500){toast('Informe Uma Nota de Até 1.500 Caracteres.');return}
  $('taskNoteSave').disabled=true;
  try{
    await addDoc(noteLogRef(viewId),{
      tipo:'nota',texto,autor:user.email||'Usuário',
      createdByUid:user.uid,createdByEmail:user.email||'',createdAt:serverTimestamp()
    });
    $('taskNoteText').value='';
    toast('Nota Adicionada ao Histórico do Chamado.');
  }catch(err){console.error(err);toast('Não Foi Possível Salvar a Nota: '+(err.code||err.message))}
  finally{$('taskNoteSave').disabled=false}
};

function showDetailNew(id,occurrenceDate=''){
  const t=items.find(x=>x.id===id);if(!t)return;
  viewId=id;
  $('detailTitle').textContent=capWords(t.title);
  const values=[['Tipo',t.type],['Status',isEventItem(t)?'Programado':stateLabel[t.status]||t.status],['Prioridade',t.priority],['Setor',t.sector],['Responsável',t.assignee||'Não Definido'],['Data e Horário',ptDate(occurrenceDate&&isRecurring(t)?occurrenceDate+String(t.dueAt).slice(10):t.dueAt)],...(isRecurring(t)?[['Repetição',recurrenceLabel(t)],['Fim da Repetição',t.recurrenceUntil?ptDate(t.recurrenceUntil):'Sem Data Final']]:[])];
  $('detailContent').innerHTML=(isRecurring(t)?'<p class="recurrence-explanation">↻ Atividade Recorrente. A Exclusão Remove Toda a Série.</p>':'')+'<div class="detail-grid">'+values.map(([a,b])=>'<div><strong>'+esc(a)+'</strong><span>'+esc(b)+'</span></div>').join('')+'</div><strong>Detalhes</strong><div class="detail-note">'+esc(t.details||'Sem Detalhes Adicionais.')+'</div>';
  if(t.status==='concluida'&&t.completedBy){
    $('detailContent').innerHTML+='<div class="call-original"><strong>Conclusão</strong><p>'+
      esc(t.completedBy)+' · '+esc(t.completedAtLocal||'')+'</p></div>';
  }
  $('openDelete').classList.toggle('auth-hidden',role!=='admin');
  $('taskNoteText').value='';
  modal('detail',true);
  attachTaskNotes(id);
}

function confirmDeleteNew(id){
  if(role!=='admin'){toast('A Exclusão é Restrita ao Administrador.');return}
  const t=items.find(x=>x.id===id);if(!t)return;
  deleteId=id;$('deleteDescription').textContent=t.type+': '+capWords(t.title)+' — '+(stateLabel[t.status]||t.status)+(isRecurring(t)?' — Toda a Série de Repetições Será Excluída.':'');modal('deleteConfirm',true);
}

async function deleteNowNew(){
  if(role!=='admin'||!deleteId||!user)return;
  const t=items.find(x=>x.id===deleteId);if(!t)return;
  $('confirmDelete').disabled=true;
  try{
    const existingNotes=await getDocs(noteLogRef(deleteId));
    if(existingNotes.size>400){toast('Há Muitas Notas. Contate o Administrador para Excluir com Segurança.');return}
    const batch=writeBatch(db);
    existingNotes.forEach(note=>batch.delete(note.ref));
    batch.delete(doc(db,'tarefas',deleteId));
    batch.set(doc(collection(db,'auditoria')),{taskId:deleteId,action:'exclusao',actorUid:user.uid,actorEmail:user.email,actorName:'Administrador',note:(t.type+': '+t.title).slice(0,1500),at:serverTimestamp()});
    await batch.commit();modal('deleteConfirm',false);deleteId='';toast('Atividade Excluída. Registro de Auditoria Salvo.');
  }catch(error){console.error(error);toast('Erro ao Excluir: '+(error.code||error.message)+'. Publique as Regras do Firestore 1.4.')}
  finally{$('confirmDelete').disabled=false}
}

$('new').onclick=()=>openEditorNew();

$('title').onblur=()=>{$('title').value=capWords($('title').value)};

$('search').oninput=renderListsNew;

$('filter').onchange=renderListsNew;

$('refresh').onclick=()=>{renderAllNew();toast('Dados Atualizados Automaticamente.')};

document.querySelectorAll('[data-kpi]').forEach(b=>b.onclick=()=>{$('filter').value=b.dataset.kpi;document.querySelector('[data-page="tarefas"]').click();renderListsNew();});

$('calendarPrev').onclick=()=>{monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()-1,1);renderCalendarNew()};

$('calendarNext').onclick=()=>{monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+1,1);renderCalendarNew()};

$('calendarToday').onclick=()=>{const d=new Date();selectedDay=dayISO(d);monthCursor=new Date(d.getFullYear(),d.getMonth(),1);renderCalendarNew()};

$('addCalendarEvent').onclick=()=>openEditorNew('Evento',selectedDay);

$('calendarGrid').onclick=e=>{const b=e.target.closest('[data-day]');if(!b)return;selectedDay=b.dataset.day;if(b.dataset.outside==='true'){const [y,m]=selectedDay.split('-').map(Number);monthCursor=new Date(y,m-1,1)}renderCalendarNew()};

document.addEventListener('click',e=>{const d=e.target.closest('[data-detail]');if(d){showDetailNew(d.dataset.detail,d.dataset.occurrenceDate||'');return}const remove=e.target.closest('[data-delete]');if(remove){confirmDeleteNew(remove.dataset.delete);return}const b=e.target.closest('[data-status]');if(b){pendingId=b.dataset.id;pendingStatus=b.dataset.status;$('completeForm').reset();$('completeTitle').textContent=b.dataset.status==='concluida'?'Concluir Atividade':'Iniciar Atividade';
const task=items.find(t=>t.id===pendingId);
$('actionOriginalDescription').textContent=task?.details||'Sem Descrição Original.';
$('actionRecentNotes').textContent='Carregando as Últimas Atualizações...';
const actionTaskId=pendingId;
getDocs(query(noteLogRef(actionTaskId),orderBy('createdAt','desc'),limit(5))).then(snapshot=>{
  if(actionTaskId!==pendingId||!$('complete').classList.contains('show'))return;
  const recent=snapshot.docs.map(doc=>doc.data());
  $('actionRecentNotes').textContent=recent.length?recent.map(n=>(n.autor||n.createdByEmail||'Usuário')+' ('+formatNoteTime(n.createdAt)+'): '+n.texto).join('\n'):'Ainda Não Existem Notas Adicionais.';
}).catch(error=>{
  console.error(error);
  $('actionRecentNotes').textContent='Não Foi Possível Carregar as Notas. Consulte o Histórico nos Detalhes.';
});
$('completionNoteLabel').textContent=b.dataset.status==='concluida'?'Solução / Nota de Conclusão':'Nota de Andamento (Opcional)';
modal('complete',true)}});

$('openDelete').onclick=()=>{modal('detail',false);confirmDeleteNew(viewId)};

$('confirmDelete').onclick=deleteNowNew;

function render(){renderAllNew()}

$('taskForm').onsubmit = async function(event){
  event.preventDefault();if(!user)return;
  const date=$('dueDate').value,time=$('dueTime').value;
  if(time&&!date){toast('Informe a Data Antes do Horário.');return}
  if($('type').value==='Evento'&&!date){toast('Informe A Data Do Evento.');return}
  const data={title:capWords($('title').value),type:$('type').value,priority:$('priority').value,sector:$('sector').value,assignee:$('assignee').value,dueAt:date?(time?date+'T'+time:date):'',details:$('details').value.trim(),status:'aberta',createdByUid:user.uid,createdByEmail:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  if(data.type==='Rotina'){
    if(role!=='admin'){toast('Apenas Administradores Podem Criar Rotinas.');return}
    if(!date){toast('Informe a Data de Início da Rotina.');return}
    const until=$('repeatUntil').value;
    if(!until||until<date){toast('Informe a Data de Fim da Rotina Igual ou Posterior ao Início.');return}
    data.recurrence=$('repeatFrequency').value;
    if(!['daily','weekly','monthly'].includes(data.recurrence)){toast('Frequência Inválida.');return}
    data.recurrenceUntil=until;
  }
  if(!settings.tipos.some(x=>x.ativo&&x.nome===data.type)||!settings.setores.some(x=>x.ativo&&x.nome===data.sector)){toast('Selecione Um Tipo e Setor Ativos nas Configurações.');return}
  if(data.assignee&&!settings.responsaveis.some(x=>x.ativo&&x.nome===data.assignee)){toast('Selecione Um Responsável Ativo.');return}
  if(!data.title)return;
  if(role!=='admin'&&data.type==='Rotina'){toast('Apenas Administradores Podem Criar Rotinas.');return}
  $('saveTask').disabled=true;
  try{await addDoc(collection(db,'tarefas'),data);modal('editor',false);
    if(date&&isEventItem(data)){eventsAnchor=date;document.querySelector('[data-page="eventos"]').click()}
    toast('Atividade Registrada com Sucesso.');
  }catch(error){console.error(error);toast('Falha ao Registrar: '+(error.code||error.message))}
  finally{$('saveTask').disabled=false}
};

$('completeForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!pendingId || !user) return;
  const activeTask=items.find(t=>t.id===pendingId);
  if(!activeTask||isEventItem(activeTask)||isRecurring(activeTask)||activeTask.status==='concluida')return;

  const name = $('worker').value.trim();
  if (!name) return;

  const updates = {
    status: pendingStatus,
    updatedAt: serverTimestamp(),
    lastActionByUid: user.uid,
    lastActionByEmail: user.email,
    lastActionByName: name
  };

  if (pendingStatus === 'concluida') {
    Object.assign(updates, {
      completedBy: name,
      completedByUid: user.uid,
      completedAt: serverTimestamp(),
      completedAtLocal: new Date().toLocaleString('pt-BR'),
      completionNote: $('completionNote').value.trim()
    });
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tarefas', pendingId), updates);
    batch.set(doc(noteLogRef(pendingId)),{
      tipo:pendingStatus==='concluida'?'concluida':'andamento',
      texto:$('completionNote').value.trim()||(pendingStatus==='concluida'?'Chamado Concluído.':'Chamado Iniciado.'),
      autor:name,createdByUid:user.uid,createdByEmail:user.email||'',
      createdAt:serverTimestamp()
    });
    batch.set(doc(collection(db, 'auditoria')), {
      taskId: pendingId,
      action: pendingStatus,
      actorUid: user.uid,
      actorEmail: user.email,
      actorName: name,
      note: $('completionNote').value.trim(),
      at: serverTimestamp()
    });
    await batch.commit();
    modal('complete', false);
    toast('Atividade Atualizada.');
  } catch (err) {
    console.error(err);
    toast(`Falha ao Atualizar: ${err.code || err.message}`);
  }
};

if (!cfg?.apiKey || !cfg?.projectId) {
  $('setupAlert').classList.remove('hidden');
  $('login').classList.remove('hidden');
  toast('Configuração Firebase Ausente.');
} else {
  const app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);

  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    } catch (err) {
      console.error(err);
      toast(`Falha no Login: ${err.code || err.message}`);
    }
  };

  onAuthStateChanged(auth, async (current) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeSettings) {
      unsubscribeSettings();
      unsubscribeSettings = null;
    }
    if(unsubscribeNotes){unsubscribeNotes();unsubscribeNotes=null;currentNotes=[]}
    user = current;
    items = [];

    if (!current) {
      role='operator';
      settings=defaults();
      settingsWarning='';
      $('settingsNav').classList.add('auth-hidden');
      $('usersNav').classList.add('auth-hidden');
      renderFormOptions();
      $('app').classList.add('hidden');
      $('login').classList.remove('hidden');
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, 'usuarios', current.uid));
      if (!userSnap.exists() || userSnap.data().ativo !== true) {
        await signOut(auth);
        toast('Conta sem Autorização Operacional.');
        return;
      }

      role = userSnap.data().role || 'operator';
      $('settingsNav').classList.toggle('auth-hidden',role!=='admin');
      $('usersNav').classList.toggle('auth-hidden',role!=='admin');
      if(role!=='admin'&&['configuracoes','usuarios'].includes(document.querySelector('.section.active')?.id)){
        document.querySelector('[data-page="tarefas"]').click();
      }
      settings=defaults();
      renderFormOptions();
      renderSettings();
      settingsWarning='';
      unsubscribeSettings=onSnapshot(configDoc(),snapshot=>{
        settings=readSettings(snapshot.exists()?snapshot.data():null);
        settingsWarning='';
        renderFormOptions();
        renderSettings();
      },error=>{
        console.error('Configuração Firestore:',error);
        settingsWarning='As Opções Padrão Continuam Disponíveis. Para Editar e Sincronizar, Publique as Regras Atualizadas do Firestore.';
        renderSettings();
      });
      $('userLabel').textContent = current.email;
      $('roleLabel').textContent = role === 'admin' ? 'Administrador' : 'Operador';
      $('roleInfo').textContent = role === 'admin'
        ? 'Administrador: Pode Registrar Eventos, Tarefas e Ocorrências.'
        : 'Operador: Pode Cadastrar Atividades e Eventos, Adicionar Notas e Concluir Chamados. Rotinas São Exclusivas da Administração.';
      $('login').classList.add('hidden');
      $('app').classList.remove('hidden');

      const q = query(collection(db, 'tarefas'), orderBy('createdAt', 'desc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        items = snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            ...data,
            createdAtLocal: data.createdAt?.toDate?.()?.toLocaleString('pt-BR') || '',
            dueAt: data.dueAt || ''
          };
        });
        render();
      }, (err) => {
        console.error(err);
        toast(`Erro ao Sincronizar: ${err.code || err.message}`);
      });
    } catch (err) {
      console.error(err);
      toast(`Erro de Autorização: ${err.code || err.message}`);
    }
  });
}
