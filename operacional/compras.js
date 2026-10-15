import {getApps,getApp,initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp,runTransaction} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
// Lista compartilhada, sem data ou prazo, salva em /compras.
const el=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app);
const purchasesRef=collection(db,'compras'),catalogRef=collection(db,'catalogoProdutos');
const ordersRef=collection(db,'pedidosCompra'),orderCounterRef=doc(db,'contadores','pedidosCompra');
const upper=s=>String(s??'').trim().toLocaleUpperCase('pt-BR');
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byName=(a,b)=>upper(a.produto||a.nome).localeCompare(upper(b.produto||b.nome),'pt-BR');
let user=null,role='operator',userName='',items=[],catalog=[],orders=[],stopPurchases=null,stopCatalog=null,stopOrders=null;
const basketSelection=new Set();
let orderSaving=false;
let editing='',editingCatalog='',hiddenBought=false,busy=new Set(),catalogBusy=false,authEpoch=0;
function message(s,error=false){el('purchaseMessage').textContent=s;el('purchaseMessage').classList.toggle('purchase-error',error)}
function catalogMessage(s,error=false){el('catalogMessage').textContent=s;el('catalogMessage').classList.toggle('purchase-error',error)}
function resetForm(){editing='';el('purchaseForm').reset();el('purchaseSubmit').textContent='+ Adicionar Produto';el('purchaseCancel').hidden=true}
function resetCatalogForm(){editingCatalog='';el('catalogForm').reset();el('catalogSubmit').textContent='+ Cadastrar Produto';el('catalogCancel').hidden=true}
function row(id){return items.find(x=>x.id===id)}
// Cadastros antigos não guardavam o nome do autor. Não inferir sua identidade.
function authorName(item){
 if(item.createdByName)return String(item.createdByName);
 if(item.createdByUid&&item.createdByUid===user?.uid)return userName;
 if(item.createdByUid)return 'UID '+String(item.createdByUid).slice(0,12)+'…';
 return 'NÃO INFORMADO (REGISTRO ANTIGO)';
}
function finisherName(item){
 if(item.comprado!==true)return '—';
 if(item.completedByName)return String(item.completedByName);
 if(item.completedByUid&&item.completedByUid===user?.uid)return userName;
 if(item.completedByUid)return 'UID '+String(item.completedByUid).slice(0,12)+'…';
 return 'NÃO INFORMADO (COMPRA ANTIGA)';
}
function uppercaseInput(input){
 const start=input.selectionStart,end=input.selectionEnd;
 input.value=input.value.toLocaleUpperCase('pt-BR');
 if(start!==null&&end!==null)try{input.setSelectionRange(start,end)}catch{}
}
for(const id of ['purchaseProduct','purchaseQuantity','catalogName'])el(id).addEventListener('input',e=>uppercaseInput(e.target));
function renderPurchases(){
 const pending=items.filter(x=>x.comprado!==true).sort(byName),bought=items.filter(x=>x.comprado===true).sort(byName);
 const pendingIds=new Set(pending.map(item=>item.id));
 for(const id of basketSelection)if(!pendingIds.has(id))basketSelection.delete(id);
 el('agendaPurchaseCount').textContent=String(pending.length);
 el('purchaseHideBought').checked=hiddenBought;
 const shown=hiddenBought?pending:[...pending,...bought];
 el('purchaseList').innerHTML=shown.length?shown.map(item=>{
  const checked=item.comprado===true,locked=busy.has(item.id);
  return '<article class="purchase-item '+(checked?'is-bought':'')+'">'+
   '<label class="purchase-check"><input type="checkbox" data-purchase-check="'+safe(item.id)+'" '+(checked?'checked ':'')+(locked?'disabled ':'')+'aria-label="Marcar ou Desmarcar '+safe(upper(item.produto))+'"/></label>'+
   '<div class="purchase-content"><strong class="purchase-product">'+safe(upper(item.produto))+'</strong><span class="purchase-quantity">QUANTIDADE: '+safe(upper(item.quantidade))+'</span></div>'+
   '<div class="purchase-right"><div class="purchase-controls">'+
    (!checked?'<label class="purchase-basket-toggle"><input type="checkbox" data-basket-select="'+safe(item.id)+'" '+(basketSelection.has(item.id)?'checked ':'')+(locked?'disabled ':'')+'aria-label="Incluir '+safe(upper(item.produto))+' na cesta"/> Cesta</label>':'')+
    '<button type="button" class="btn secondary" data-purchase-edit="'+safe(item.id)+'" '+(locked?'disabled':'')+'>Editar</button>'+
   '<button type="button" class="btn secondary purchase-remove" data-purchase-delete="'+safe(item.id)+'" '+(locked?'disabled':'')+' title="Excluir Produto" aria-label="Excluir '+safe(upper(item.produto))+'">×</button></div>'+
   '<div class="purchase-authors"><span>ADICIONADO POR: <strong>'+safe(upper(authorName(item)))+'</strong></span>'+
   '<span>CONCLUÍDO POR: <strong>'+safe(upper(finisherName(item)))+'</strong></span></div></div></article>';
 }).join(''):'<div class="purchase-empty">'+(hiddenBought&&items.length?'Nenhuma Compra Pendente. Desmarque Ocultar Comprados para Ver os Itens Comprados.':'Nenhum Produto na Lista. Adicione o Primeiro Item Acima.')+'</div>';
 el('agendaPurchaseList').innerHTML=pending.length?pending.map(item=>'<div class="purchase-agenda-item"><span class="purchase-agenda-dot"></span><strong>'+safe(upper(item.produto))+'</strong><span>'+safe(upper(item.quantidade))+'</span></div>').join(''):'<div class="purchase-agenda-empty">Nenhuma Compra Pendente.</div>';
 el('purchaseForm').hidden=!user;el('purchaseNoAccess').hidden=!!user;
 el('purchaseCatalogOpen').disabled=!user;
 renderBasket();
}
function renderCatalogAdmin(){
 el('catalogAdminSection').hidden=role!=='admin'||!user;
 if(role!=='admin')return;
 const entries=[...catalog].sort(byName);
 el('catalogCount').textContent=String(entries.filter(x=>x.ativo!==false).length);
 el('catalogAdminList').innerHTML=entries.length?entries.map(item=>
  '<div class="catalog-admin-row '+(item.ativo===false?'is-inactive':'')+'"><strong>'+safe(upper(item.nome))+'</strong>'+
  '<span>'+(item.ativo===false?'Inativo':'Ativo')+'</span><div class="catalog-admin-actions">'+
  '<button type="button" data-catalog-edit="'+safe(item.id)+'" class="btn secondary">Editar</button>'+
  '<button type="button" data-catalog-toggle="'+safe(item.id)+'" class="btn secondary">'+(item.ativo===false?'Reativar':'Desativar')+'</button></div></div>'
 ).join(''):'<div class="purchase-empty">Nenhum Nome Pré-Cadastrado. Cadastre o Primeiro Produto Acima.</div>';
}
function matchingCatalog(){
 const term=upper(el('purchaseCatalogSearch').value),active=catalog.filter(item=>item.ativo!==false);
 return active.filter(item=>upper(item.nome).includes(term)).sort(byName);
}
function renderCatalogSearch(){
 const matches=matchingCatalog();
 el('purchaseCatalogChoices').innerHTML=matches.length?matches.map(item=>
  '<button type="button" class="catalog-choice" data-catalog-select="'+safe(item.id)+'">'+
  '<span>'+safe(upper(item.nome))+'</span><span aria-hidden="true">›</span></button>'
 ).join(''):'<div class="purchase-empty">Nenhum Produto Encontrado. Você Também Pode Digitar um Novo Nome Diretamente no Campo Produto.</div>';
}
function openCatalog(){if(!user)return;el('purchaseCatalogSearch').value='';renderCatalogSearch();el('purchaseCatalogModal').classList.add('show');el('purchaseCatalogSearch').focus()}
function closeCatalog(){el('purchaseCatalogModal').classList.remove('show')}
function disconnect(){
 if(stopPurchases){stopPurchases();stopPurchases=null}
 if(stopCatalog){stopCatalog();stopCatalog=null}
 if(stopOrders){stopOrders();stopOrders=null}
 user=null;role='operator';userName='';items=[];catalog=[];orders=[];basketSelection.clear();
 busy.clear();catalogBusy=false;hiddenBought=false;orderSaving=false;
 resetForm();resetCatalogForm();closeCatalog();renderPurchases();renderCatalogAdmin();renderOrders();
}
el('purchaseForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!user)return;
 const produto=upper(el('purchaseProduct').value),quantidade=upper(el('purchaseQuantity').value);
 if(!produto||!quantidade||produto.length>150||quantidade.length>100)return message('Preencha Produto e Quantidade nos Limites Informados.',true);
 const original=editing?row(editing):null;
 if(editing&&!original)return message('Produto Não Encontrado. Atualize a Lista.',true);
 const key=editing||'new';if(busy.has(key))return;busy.add(key);el('purchaseSubmit').disabled=true;
 try{
  if(original){
   await updateDoc(doc(db,'compras',original.id),{produto,quantidade,updatedAt:serverTimestamp(),updatedByUid:user.uid});
   message('Produto Atualizado na Lista.');
  }else{
   await addDoc(purchasesRef,{
    produto,quantidade,comprado:false,compradoEm:null,
    createdAt:serverTimestamp(),createdByUid:user.uid,createdByName:userName,
    completedByUid:null,completedByName:null,
    updatedAt:serverTimestamp(),updatedByUid:user.uid
   });
   message('Produto Adicionado à Lista de Compras.');
  }
  resetForm();
 }catch(err){console.error(err);message('Erro ao Salvar: '+(err.code||err.message),true)}
 finally{busy.delete(key);el('purchaseSubmit').disabled=false}
});
el('purchaseCancel').onclick=resetForm;
el('purchaseHideBought').addEventListener('change',event=>{hiddenBought=event.target.checked;renderPurchases()});
el('purchaseList').addEventListener('click',async event=>{
 const edit=event.target.closest('[data-purchase-edit]');
 if(edit){
  const item=row(edit.dataset.purchaseEdit);if(!item||!user)return;
  editing=item.id;el('purchaseProduct').value=upper(item.produto);el('purchaseQuantity').value=upper(item.quantidade);
  el('purchaseSubmit').textContent='Salvar Alterações';el('purchaseCancel').hidden=false;
  document.querySelector('[data-page="compras"]')?.click();el('purchaseProduct').focus();return;
 }
 const remove=event.target.closest('[data-purchase-delete]');
 if(remove){
  const item=row(remove.dataset.purchaseDelete);if(!item||!user)return;
  if(!confirm('Excluir o Produto "'+upper(item.produto)+'" da Lista de Compras?'))return;
  if(busy.has(item.id))return;busy.add(item.id);
  try{await deleteDoc(doc(db,'compras',item.id));if(editing===item.id)resetForm();message('Produto Excluído da Lista.')}
  catch(err){console.error(err);message(err.code==='permission-denied'?'A Exclusão Exige Publicar as Regras Atualizadas do Firestore.':'Falha ao Excluir: '+(err.code||err.message),true)}
  finally{busy.delete(item.id)}
 }
});
// Operadores podem marcar e desmarcar, desde que ativos no Firestore.
el('purchaseList').addEventListener('change',async event=>{
 const basketCheck=event.target.closest('[data-basket-select]');
 if(basketCheck){
  const item=row(basketCheck.dataset.basketSelect);
  if(!item||item.comprado===true||!user)return;
  if(basketCheck.checked){
   if(basketSelection.size>=60){basketCheck.checked=false;return message('Cada Pedido Pode Ter Até 60 Produtos.',true)}
   basketSelection.add(item.id);
  }else basketSelection.delete(item.id);
  renderBasket();
  return;
 }
 const checkbox=event.target.closest('[data-purchase-check]');if(!checkbox||!user)return;
 const item=row(checkbox.dataset.purchaseCheck);if(!item||busy.has(item.id))return;
 const checked=checkbox.checked;busy.add(item.id);checkbox.disabled=true;
 try{
  await updateDoc(doc(db,'compras',item.id),{
   comprado:checked,compradoEm:checked?serverTimestamp():null,
   completedByUid:checked?user.uid:null,completedByName:checked?userName:null,
   updatedAt:serverTimestamp(),updatedByUid:user.uid
  });
  message(checked?'Produto Marcado Como Comprado.':'Produto Retornado à Lista de Pendentes.');
 }catch(err){checkbox.checked=!checked;console.error(err);message('Falha ao Atualizar: '+(err.code||err.message),true)}
 finally{busy.delete(item.id);checkbox.disabled=false}
});
el('purchaseAgendaOpen').onclick=()=>document.querySelector('[data-page="compras"]')?.click();
el('purchaseCatalogOpen').onclick=openCatalog;
el('purchaseCatalogClose').onclick=closeCatalog;
el('purchaseCatalogModal').addEventListener('click',event=>{if(event.target===el('purchaseCatalogModal'))closeCatalog()});
el('purchaseCatalogSearch').addEventListener('input',renderCatalogSearch);
el('purchaseCatalogChoices').addEventListener('click',event=>{
 const button=event.target.closest('[data-catalog-select]');if(!button)return;
 const selected=catalog.find(x=>x.id===button.dataset.catalogSelect&&x.ativo!==false);
 if(!selected)return;
 el('purchaseProduct').value=upper(selected.nome);closeCatalog();el('purchaseQuantity').focus();
});
el('catalogForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!user||role!=='admin'||catalogBusy)return;
 const nome=upper(el('catalogName').value);
 if(!nome||nome.length>150)return catalogMessage('Informe um Nome de Produto com até 150 Caracteres.',true);
 const duplicate=catalog.find(x=>x.id!==editingCatalog&&upper(x.nome)===nome);
 if(duplicate)return catalogMessage('Já Existe um Produto com Esse Nome. Edite ou Reative o Cadastro Existente.',true);
 const existing=editingCatalog?catalog.find(x=>x.id===editingCatalog):null;
 if(editingCatalog&&!existing)return catalogMessage('Produto do Catálogo Não Encontrado.',true);
 catalogBusy=true;el('catalogSubmit').disabled=true;
 try{
  if(existing){
   await updateDoc(doc(db,'catalogoProdutos',existing.id),{nome,updatedAt:serverTimestamp(),updatedByUid:user.uid});
   catalogMessage('Nome do Produto Atualizado no Catálogo.');
  }else{
   await addDoc(catalogRef,{nome,ativo:true,createdAt:serverTimestamp(),createdByUid:user.uid,updatedAt:serverTimestamp(),updatedByUid:user.uid});
   catalogMessage('Produto Pré-Cadastrado. Já Pode Ser Selecionado na Lupa.');
  }
  resetCatalogForm();
 }catch(err){console.error(err);catalogMessage('Não Foi Possível Salvar no Catálogo: '+(err.code||err.message),true)}
 finally{catalogBusy=false;el('catalogSubmit').disabled=false}
});
el('catalogCancel').onclick=resetCatalogForm;
el('catalogAdminList').addEventListener('click',async event=>{
 const edit=event.target.closest('[data-catalog-edit]');
 if(edit){
  const item=catalog.find(x=>x.id===edit.dataset.catalogEdit);if(!item||role!=='admin')return;
  editingCatalog=item.id;el('catalogName').value=upper(item.nome);
  el('catalogSubmit').textContent='Salvar Nome';el('catalogCancel').hidden=false;el('catalogName').focus();return;
 }
 const toggle=event.target.closest('[data-catalog-toggle]');
 if(!toggle||role!=='admin'||catalogBusy||!user)return;
 const item=catalog.find(x=>x.id===toggle.dataset.catalogToggle);if(!item)return;
 const active=item.ativo!==false;
 if(!confirm((active?'Desativar':'Reativar')+' "'+upper(item.nome)+'" no Catálogo? As Compras Já Registradas Não Serão Alteradas.'))return;
 catalogBusy=true;
 try{
  await updateDoc(doc(db,'catalogoProdutos',item.id),{ativo:!active,updatedAt:serverTimestamp(),updatedByUid:user.uid});
  catalogMessage('Produto '+(active?'Desativado.':'Reativado.')+' A Lista de Compras Existente Foi Preservada.');
 }catch(err){console.error(err);catalogMessage('Falha ao Alterar Cadastro: '+(err.code||err.message),true)}
 finally{catalogBusy=false}
});
disconnect();
onAuthStateChanged(auth,async current=>{
 const token=++authEpoch;disconnect();
 if(!current){message('Entre no Sistema para Consultar as Compras.');return}
 try{
  const profile=await getDoc(doc(db,'usuarios',current.uid));
  if(token!==authEpoch)return;
  if(!profile.exists()||profile.data().ativo!==true){message('Usuário Sem Permissão para Compras.',true);return}
  user=current;role=profile.data().role==='admin'?'admin':'operator';
  userName=String(profile.data().nome||current.displayName||current.email||'USUÁRIO').trim().slice(0,80);
  renderPurchases();renderCatalogAdmin();
  stopPurchases=onSnapshot(purchasesRef,snapshot=>{
   if(token!==authEpoch)return;
   items=snapshot.docs.map(d=>({id:d.id,...d.data()}));renderPurchases();message('Lista de Compras Sincronizada com o Firebase.');
  },err=>{console.error(err);message('Não Foi Possível Consultar Compras: '+(err.code||err.message),true)});
  stopCatalog=onSnapshot(catalogRef,snapshot=>{
   if(token!==authEpoch)return;
   catalog=snapshot.docs.map(d=>({id:d.id,...d.data()}));renderCatalogAdmin();
   if(el('purchaseCatalogModal').classList.contains('show'))renderCatalogSearch();
   if(role==='admin')catalogMessage('Catálogo de Produtos Sincronizado com o Firebase.');
  },err=>{console.error(err);catalogMessage('Catálogo Indisponível. Publique as Regras do Firestore para catalogoProdutos.',true)});
 }catch(err){console.error(err);message('Falha ao Verificar Permissão: '+(err.code||err.message),true)}
});
