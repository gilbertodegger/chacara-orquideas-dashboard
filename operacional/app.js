import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const cfg = window.CHACARA_FIREBASE_CONFIG;

let auth, db, user;
let role = 'operator';
let items = [];
let unsubscribe = null;
let pendingId = null;
let pendingStatus = null;

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

const stateLabel = {
  aberta: 'Em Aberto',
  andamento: 'Em Andamento',
  concluida: 'Concluída'
};

const sectionLabel = {
  tarefas: 'Tarefas E Ocorrências',
  agenda: 'Agenda De Eventos',
  historico: 'Histórico De Atividades'
};

const modal = (id, open) => $(id).classList.toggle('show', open);

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
    document.querySelectorAll('[data-page]').forEach((x) => x.classList.toggle('active', x === button));
    document.querySelectorAll('.section').forEach((x) => x.classList.toggle('active', x.id === button.dataset.page));
    $('sectionName').textContent = sectionLabel[button.dataset.page] || 'Gestão operacional';
    render();
  };
});

$('search').oninput = render;
$('filter').onchange = render;
$('logout').onclick = async () => { if (auth) await signOut(auth); };
$('refresh').onclick = () => { render(); toast('Dados atualizados.'); };

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

function capWords(text){return String(text||'').trim().replace(/(^|[\s\/-])(\p{L})/gu,(_,p,l)=>p+l.toLocaleUpperCase('pt-BR'))}

function eventType(task){return task.priority==='Crítica'?'critical':task.priority==='Urgente'?'urgent':''}

function summaryCard(task){
  const badge=task.priority==="Crítica"?"critica":task.priority==="Urgente"?"urgente":"";
  const done=task.status==="concluida";
  return `<article class="task"><div><h3>${esc(capWords(task.title))}</h3><div class="chips">
   <span class="chip ${badge}">${esc(task.priority)}</span>
   <span class="chip ${done?'concluida':''}">${esc(stateLabel[task.status]||task.status)}</span>
   <span class="chip">${esc(task.type)}</span></div>
   <div class="muted">${esc(task.sector)} · Responsável: ${esc(task.assignee||'Não Definido')} · ${esc(ptDate(task.dueAt))}</div>
   ${task.details?`<p class="muted">${esc(task.details)}</p>`:''}</div>
   <div class="actions">
   <button class="btn secondary small-btn" data-detail="${esc(task.id)}">Detalhes</button>
   ${task.status==="aberta"?`<button class="btn secondary" data-status="andamento" data-id="${esc(task.id)}">Iniciar</button>`:""}
   ${!done?`<button class="btn" data-status="concluida" data-id="${esc(task.id)}">Concluir</button>`:""}
   ${role==="admin"?`<button class="delete-button" data-delete="${esc(task.id)}">Excluir</button>`:""}
   </div></article>`;
}

function renderCalendarNew(){
  const monthNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const weekNames=['Domingo','Segunda-Feira','Terça-Feira','Quarta-Feira','Quinta-Feira','Sexta-Feira','Sábado'];
  const y=monthCursor.getFullYear(),m=monthCursor.getMonth();
  $('calendarMonth').textContent=monthNames[m]+' De '+y;
  const start=(new Date(y,m,1).getDay()+6)%7;
  const count=Math.ceil((start+new Date(y,m+1,0).getDate())/7)*7;
  const daily={};for(const t of items){const d=dateKey(t.dueAt);if(/^\d{4}-\d{2}-\d{2}$/.test(d))(daily[d]||=[]).push(t)}
  const now=dayISO(new Date()),cells=[];
  for(let i=0;i<count;i++){
    const d=new Date(y,m,i-start+1),day=dayISO(d),events=(daily[day]||[]).sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt)));
    const outside=d.getMonth()!==m;
    const previews=events.slice(0,2).map(t=>`<span class="calendar-event ${eventType(t)}">${esc(capWords(t.title))}</span>`).join('');
    const dots=events.slice(0,3).map(t=>`<span class="calendar-dot ${eventType(t)}"></span>`).join('');
    cells.push(`<button type="button" class="calendar-day ${outside?'outside':''} ${day===selectedDay?'selected':''} ${day===now?'today':''}" data-day="${day}" data-outside="${outside}" aria-pressed="${day===selectedDay}"><span class="calendar-number">${d.getDate()}</span>${previews}${events.length>2?`<span class="calendar-more">+${events.length-2} Mais</span>`:''}<span class="calendar-dots">${dots}</span></button>`);
  }
  $('calendarGrid').innerHTML=cells.join('');
  const [yy,mm,dd]=selectedDay.split('-').map(Number);const date=new Date(yy,mm-1,dd);
  $('selectedDateTitle').textContent=weekNames[date.getDay()]+', '+dd+' De '+monthNames[date.getMonth()]+' De '+yy;
  const dailyEvents=(daily[selectedDay]||[]).sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt)));
  $('selectedDateCount').textContent=dailyEvents.length+' '+(dailyEvents.length===1?'Atividade Programada':'Atividades Programadas');
  $('addCalendarEvent').classList.toggle('auth-hidden',role!=='admin');
  $('agendaList').innerHTML=dailyEvents.length?dailyEvents.map(t=>`<button type="button" class="agenda-entry ${eventType(t)}" data-detail="${esc(t.id)}"><span class="mini">${esc((t.dueAt||'').match(/T(\d{2}:\d{2})/)?.[1]||'Dia Inteiro')} · ${esc(t.type)} · ${esc(t.priority)}</span><b>${esc(capWords(t.title))}</b><span class="mini">${esc(t.sector)} · ${esc(stateLabel[t.status])}</span></button>`).join(''):'<div class="agenda-empty">Nenhuma Atividade Para Este Dia.</div>';
}

function renderListsNew(){
  const active=items.filter(t=>t.status!=='concluida');
  $('statOpen').textContent=items.filter(t=>t.status==='aberta').length;
  $('statProgress').textContent=items.filter(t=>t.status==='andamento').length;
  $('statUrgent').textContent=active.filter(t=>['Crítica','Urgente'].includes(t.priority)).length;
  $('statDone').textContent=items.filter(t=>t.status==='concluida').length;
  const filter=$('filter').value;
  const names={ativas:'Pendentes E Em Andamento',todas:'Todas As Atividades',aberta:'Em Aberto',andamento:'Em Andamento',urgentes:'Críticas / Urgentes',concluida:'Concluídas'};
  document.querySelectorAll('[data-kpi]').forEach(b=>{const selected=b.dataset.kpi===filter;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected))});
  $('filterSummary').innerHTML='Exibindo: '+esc(names[filter]||names.todas)+' <button type="button" class="link-btn" id="resetFilters">Limpar Filtro</button>';
  $('resetFilters').onclick=()=>{$('filter').value='ativas';$('search').value='';renderListsNew()};
  let shown=filter==='todas'?items:filter==='ativas'?active:filter==='urgentes'?active.filter(t=>['Crítica','Urgente'].includes(t.priority)):items.filter(t=>t.status===filter);
  const query=$('search').value.toLocaleLowerCase('pt-BR');
  shown=shown.filter(t=>[t.title,t.assignee,t.sector,t.details].some(x=>String(x||'').toLocaleLowerCase('pt-BR').includes(query)));
  const rank={'Crítica':0,'Urgente':1,'Normal':2,'Baixa':3};
  shown=[...shown].sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999')));
  $('taskList').innerHTML=shown.length?shown.map(summaryCard).join(''):'<div class="empty">Nenhuma Atividade Encontrada Neste Filtro.</div>';
  const done=items.filter(t=>t.status==='concluida');
  $('historyList').innerHTML=done.length?done.map(summaryCard).join(''):'<div class="empty">Nenhuma Atividade Concluída.</div>';
}

function renderAllNew(){renderListsNew();renderCalendarNew()}

function openEditorNew(type,date){
  $('taskForm').reset();
  $('type').querySelectorAll('option').forEach(o=>o.disabled=role!=='admin'&&o.value!=='Ocorrência');
  $('type').value=type||'Ocorrência';$('dueDate').value=date||'';
  $('editorTitle').textContent=type==='Evento'?'Novo Evento':'Nova Tarefa Ou Ocorrência';
  modal('editor',true);
}

function showDetailNew(id){
  const t=items.find(x=>x.id===id);if(!t)return;
  viewId=id;
  $('detailTitle').textContent=capWords(t.title);
  const values=[['Tipo',t.type],['Status',stateLabel[t.status]||t.status],['Prioridade',t.priority],['Setor',t.sector],['Responsável',t.assignee||'Não Definido'],['Data E Horário',ptDate(t.dueAt)]];
  $('detailContent').innerHTML='<div class="detail-grid">'+values.map(([a,b])=>'<div><strong>'+esc(a)+'</strong><span>'+esc(b)+'</span></div>').join('')+'</div><strong>Detalhes</strong><div class="detail-note">'+esc(t.details||'Sem Detalhes Adicionais.')+'</div>';
  $('openDelete').classList.toggle('auth-hidden',role!=='admin');modal('detail',true)
}

function confirmDeleteNew(id){
  if(role!=='admin'){toast('A Exclusão É Restrita Ao Administrador.');return}
  const t=items.find(x=>x.id===id);if(!t)return;
  deleteId=id;$('deleteDescription').textContent=t.type+': '+capWords(t.title)+' — '+(stateLabel[t.status]||t.status);modal('deleteConfirm',true);
}

async function deleteNowNew(){
  if(role!=='admin'||!deleteId||!user)return;
  const t=items.find(x=>x.id===deleteId);if(!t)return;
  $('confirmDelete').disabled=true;
  try{const batch=writeBatch(db);
    batch.delete(doc(db,'tarefas',deleteId));
    batch.set(doc(collection(db,'auditoria')),{taskId:deleteId,action:'exclusao',actorUid:user.uid,actorEmail:user.email,actorName:'Administrador',note:(t.type+': '+t.title).slice(0,1500),at:serverTimestamp()});
    await batch.commit();modal('deleteConfirm',false);deleteId='';toast('Atividade Excluída. Registro De Auditoria Salvo.');
  }catch(error){console.error(error);toast('Erro Ao Excluir: '+(error.code||error.message)+'. Publique As Regras Do Firestore 1.4.')}
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

$('addCalendarEvent').onclick=()=>{if(role==='admin')openEditorNew('Evento',selectedDay)};

$('calendarGrid').onclick=e=>{const b=e.target.closest('[data-day]');if(!b)return;selectedDay=b.dataset.day;if(b.dataset.outside==='true'){const [y,m]=selectedDay.split('-').map(Number);monthCursor=new Date(y,m-1,1)}renderCalendarNew()};

document.addEventListener('click',e=>{const d=e.target.closest('[data-detail]');if(d){showDetailNew(d.dataset.detail);return}const remove=e.target.closest('[data-delete]');if(remove){confirmDeleteNew(remove.dataset.delete);return}const b=e.target.closest('[data-status]');if(b){pendingId=b.dataset.id;pendingStatus=b.dataset.status;$('completeForm').reset();$('completeTitle').textContent=b.dataset.status==='concluida'?'Concluir Atividade':'Iniciar Atividade';modal('complete',true)}});

$('openDelete').onclick=()=>{modal('detail',false);confirmDeleteNew(viewId)};

$('confirmDelete').onclick=deleteNowNew;

function render(){renderAllNew()}

$('taskForm').onsubmit = async function(event){
  event.preventDefault();if(!user)return;
  const date=$('dueDate').value,time=$('dueTime').value;
  if(time&&!date){toast('Informe A Data Antes Do Horário.');return}
  if($('type').value==='Evento'&&!date){toast('Informe A Data Do Evento.');return}
  const data={title:capWords($('title').value),type:$('type').value,priority:$('priority').value,sector:$('sector').value,assignee:$('assignee').value,dueAt:date?(time?date+'T'+time:date):'',details:$('details').value.trim(),status:'aberta',createdByUid:user.uid,createdByEmail:user.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  if(!data.title)return;
  if(role!=='admin'&&data.type!=='Ocorrência'){toast('Apenas Administradores Podem Criar Tarefas E Eventos.');return}
  $('saveTask').disabled=true;
  try{await addDoc(collection(db,'tarefas'),data);modal('editor',false);
    if(date&&data.type==='Evento'){const [y,m]=date.split('-').map(Number);selectedDay=date;monthCursor=new Date(y,m-1,1);document.querySelector('[data-page="agenda"]').click()}
    toast('Atividade Registrada Com Sucesso.');
  }catch(error){console.error(error);toast('Falha Ao Registrar: '+(error.code||error.message))}
  finally{$('saveTask').disabled=false}
};

$('completeForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!pendingId || !user) return;

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
    toast('Atividade atualizada.');
  } catch (err) {
    console.error(err);
    toast(`Falha ao atualizar: ${err.code || err.message}`);
  }
};

if (!cfg?.apiKey || !cfg?.projectId) {
  $('setupAlert').classList.remove('hidden');
  $('login').classList.remove('hidden');
  toast('Configuração Firebase ausente.');
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
      toast(`Falha no login: ${err.code || err.message}`);
    }
  };

  onAuthStateChanged(auth, async (current) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    user = current;
    items = [];

    if (!current) {
      $('app').classList.add('hidden');
      $('login').classList.remove('hidden');
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, 'usuarios', current.uid));
      if (!userSnap.exists() || userSnap.data().ativo !== true) {
        await signOut(auth);
        toast('Conta sem autorização operacional.');
        return;
      }

      role = userSnap.data().role || 'operator';
      $('userLabel').textContent = current.email;
      $('roleLabel').textContent = role === 'admin' ? 'Administrador' : 'Operador';
      $('roleInfo').textContent = role === 'admin'
        ? 'Administrador: pode registrar eventos, tarefas e ocorrências.'
        : 'Operador: pode registrar ocorrências e concluir atividades.';
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
        toast(`Erro ao sincronizar: ${err.code || err.message}`);
      });
    } catch (err) {
      console.error(err);
      toast(`Erro de autorização: ${err.code || err.message}`);
    }
  });
}
