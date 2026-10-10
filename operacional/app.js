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

const fmt = (value) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Sem prazo';

const stateLabel = {
  aberta: 'Aberta',
  andamento: 'Em andamento',
  concluida: 'Concluída'
};

const sectionLabel = {
  tarefas: 'Central de tarefas, ocorrências e agenda',
  agenda: 'Compromissos e tarefas com prazo',
  historico: 'Acompanhamento das atividades concluídas'
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

$('new').onclick = () => {
  $('taskForm').reset();
  $('type').querySelectorAll('option').forEach((option) => {
    option.disabled = role !== 'admin' && option.value !== 'Ocorrência';
  });
  $('editorTitle').textContent = role === 'admin'
    ? 'Nova tarefa, evento ou ocorrência'
    : 'Nova ocorrência';
  modal('editor', true);
};

function taskCard(task) {
  const priorityClass = task.priority === 'Crítica'
    ? 'critica'
    : task.priority === 'Urgente'
      ? 'urgente'
      : '';

  return `
    <article class="task">
      <div>
        <h3>${esc(task.title)}</h3>
        <div class="chips">
          <span class="chip ${priorityClass}">${esc(task.priority)}</span>
          <span class="chip ${task.status === 'concluida' ? 'concluida' : ''}">${esc(stateLabel[task.status] || task.status)}</span>
          <span class="chip">${esc(task.type)}</span>
        </div>
        <div class="muted">
          ${esc(task.sector)} · Responsável: ${esc(task.assignee || 'Não definido')} · ${esc(fmt(task.dueAt))}<br>
          ${esc(task.details || 'Sem detalhes adicionais.')}
        </div>
      </div>
      <div class="actions">
        ${task.status === 'aberta' ? `<button class="btn secondary" data-status="andamento" data-id="${task.id}">Iniciar</button>` : ''}
        ${task.status !== 'concluida' ? `<button class="btn" data-status="concluida" data-id="${task.id}">Concluir</button>` : ''}
      </div>
    </article>`;
}

function render() {
  const active = items.filter((item) => item.status !== 'concluida');
  $('statOpen').textContent = active.filter((item) => item.status === 'aberta').length;
  $('statProgress').textContent = active.filter((item) => item.status === 'andamento').length;
  $('statUrgent').textContent = active.filter((item) => ['Urgente', 'Crítica'].includes(item.priority)).length;
  $('statDone').textContent = items.filter((item) => item.status === 'concluida').length;

  let shown = $('filter').value === 'todas' ? [...items] : active;
  if ($('filter').value === 'criticas') shown = active.filter((item) => ['Urgente', 'Crítica'].includes(item.priority));
  if ($('filter').value === 'minhas' && user?.email) {
    shown = active.filter((item) => (item.assignee || '').toLowerCase().includes(user.email.toLowerCase()));
  }

  const search = $('search').value.toLowerCase();
  shown = shown.filter((item) =>
    [item.title, item.sector, item.assignee, item.details]
      .some((value) => String(value || '').toLowerCase().includes(search))
  ).sort((a, b) => {
    const priorityOrder = { Crítica: 0, Urgente: 1, Normal: 2, Baixa: 3 };
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      || String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'));
  });

  $('taskList').innerHTML = shown.length
    ? shown.map(taskCard).join('')
    : '<div class="empty">Nenhuma tarefa encontrada.</div>';

  $('historyList').innerHTML = items.some((item) => item.status === 'concluida')
    ? items.filter((item) => item.status === 'concluida').map(taskCard).join('')
    : '<div class="empty">Nenhuma conclusão.</div>';

  const agenda = items.filter((item) => item.dueAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  $('agendaList').innerHTML = agenda.length
    ? agenda.map((item) => `
      <div class="agenda-item">
        <b>${esc(fmt(item.dueAt))}</b> · ${esc(item.title)}
        <div class="muted">${esc(item.sector)} · ${esc(stateLabel[item.status])}</div>
      </div>`).join('')
    : '<div class="empty">Nenhum prazo cadastrado.</div>';

  document.querySelectorAll('[data-status]').forEach((button) => {
    button.onclick = () => {
      pendingId = button.dataset.id;
      pendingStatus = button.dataset.status;
      $('completeForm').reset();
      $('completeTitle').textContent = pendingStatus === 'concluida'
        ? 'Concluir atividade'
        : 'Iniciar atividade';
      modal('complete', true);
    };
  });
}

$('taskForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!user) return;

  const data = {
    title: $('title').value.trim(),
    type: $('type').value,
    priority: $('priority').value,
    sector: $('sector').value,
    assignee: $('assignee').value.trim(),
    dueAt: $('due').value || '',
    details: $('details').value.trim(),
    status: 'aberta',
    createdByUid: user.uid,
    createdByEmail: user.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (!data.title) return;
  if (role !== 'admin' && data.type !== 'Ocorrência') {
    toast('Operadores só podem criar ocorrências.');
    return;
  }

  try {
    await addDoc(collection(db, 'tarefas'), data);
    modal('editor', false);
    toast('Registro salvo com sucesso.');
  } catch (err) {
    console.error(err);
    toast(`Falha ao registrar: ${err.code || err.message}`);
  }
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
