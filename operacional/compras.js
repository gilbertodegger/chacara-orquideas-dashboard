import {getApps,getApp,initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
// Lista compartilhada, sem data ou prazo, salva em /compras.
const el=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.CHACARA_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app),ref=collection(db,'compras');
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byName=(a,b)=>String(a.produto||'').localeCompare(String(b.produto||''),'pt-BR');
let user=null,role='operator',items=[],stop=null,editing='',busy=new Set(),epoch=0;
function message(s,error=false){el('purchaseMessage').textContent=s;el('purchaseMessage').classList.toggle('purchase-error',error)}
function resetForm(){editing='';el('purchaseForm').reset();el('purchaseSubmit').textContent='+ Adicionar Produto';el('purchaseCancel').hidden=true}
function row(id){return items.find(x=>x.id===id)}
function render(){
 const pending=items.filter(x=>x.comprado!==true).sort(byName),bought=items.filter(x=>x.comprado===true).sort(byName);
 el('purchaseTotal').textContent=String(items.length);
 el('purchasePending').textContent=String(pending.length);
 el('purchasePurchased').textContent=String(bought.length);
 el('agendaPurchaseCount').textContent=String(pending.length);
 el('purchaseList').innerHTML=items.length?[...pending,...bought].map(item=>{
  const checked=item.comprado===true,locked=busy.has(item.id);
  return '<article class="purchase-item '+(checked?'is-bought':'')+'">'+
   '<label class="purchase-check"><input type="checkbox" data-purchase-check="'+safe(item.id)+'" '+(checked?'checked ':'')+(locked?'disabled ':'')+'aria-label="Marcar Compra de '+safe(item.produto)+'"/></label>'+
   '<div class="purchase-content"><strong class="purchase-product">'+safe(item.produto)+'</strong><span class="purchase-quantity">Quantidade: '+safe(item.quantidade)+'</span></div>'+
   '<div class="purchase-controls"><button type="button" class="btn secondary" data-purchase-edit="'+safe(item.id)+'" '+(locked?'disabled':'')+'>Editar</button>'+
   (role==='admin'?'<button type="button" class="btn secondary purchase-remove" data-purchase-delete="'+safe(item.id)+'" '+(locked?'disabled':'')+' title="Excluir Produto">×</button>':'')+'</div></article>';
 }).join(''):'<div class="purchase-empty">Nenhum Produto na Lista. Adicione o Primeiro Item Acima.</div>';
 el('agendaPurchaseList').innerHTML=pending.length?pending.map(item=>'<div class="purchase-agenda-item"><span class="purchase-agenda-dot"></span><strong>'+safe(item.produto)+'</strong><span>'+safe(item.quantidade)+'</span></div>').join(''):'<div class="purchase-agenda-empty">Nenhuma Compra Pendente.</div>';
 el('purchaseForm').hidden=!user;el('purchaseNoAccess').hidden=!!user;
}
function disconnect(){
 if(stop){stop();stop=null}
 user=null;role='operator';items=[];busy.clear();resetForm();render();
}
el('purchaseForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!user)return;
 const produto=el('purchaseProduct').value.trim(),quantidade=el('purchaseQuantity').value.trim();
 if(!produto||!quantidade||produto.length>150||quantidade.length>100)return message('Preencha Produto e Quantidade nos Limites Informados.',true);
 const original=editing?row(editing):null;
 if(editing&&!original)return message('O Produto Foi Alterado. Atualize a Lista.',true);
 const key=editing||'new';if(busy.has(key))return;busy.add(key);el('purchaseSubmit').disabled=true;
 try{
  if(original){
   await updateDoc(doc(db,'compras',original.id),{produto,quantidade,updatedAt:serverTimestamp(),updatedByUid:user.uid});
   message('Produto Atualizado na Lista.');
  }else{
   await addDoc(ref,{produto,quantidade,comprado:false,compradoEm:null,createdAt:serverTimestamp(),createdByUid:user.uid,updatedAt:serverTimestamp(),updatedByUid:user.uid});
   message('Produto Adicionado à Lista de Compras.');
  }
  resetForm();
 }catch(err){console.error(err);message('Erro ao Salvar: '+(err.code||err.message),true)}
 finally{busy.delete(key);el('purchaseSubmit').disabled=false}
});
el('purchaseCancel').onclick=resetForm;
el('purchaseList').addEventListener('click',async event=>{
 const edit=event.target.closest('[data-purchase-edit]');
 if(edit){
  const item=row(edit.dataset.purchaseEdit);if(!item||!user)return;
  editing=item.id;el('purchaseProduct').value=item.produto;el('purchaseQuantity').value=item.quantidade;
  el('purchaseSubmit').textContent='Salvar Alterações';el('purchaseCancel').hidden=false;
  document.querySelector('[data-page="compras"]')?.click();el('purchaseProduct').focus();return;
 }
 const remove=event.target.closest('[data-purchase-delete]');
 if(remove){
  const item=row(remove.dataset.purchaseDelete);if(!item||!user||role!=='admin')return;
  if(!confirm('Excluir o Produto "'+item.produto+'" da Lista de Compras?'))return;
  if(busy.has(item.id))return;busy.add(item.id);
  try{await deleteDoc(doc(db,'compras',item.id));if(editing===item.id)resetForm();message('Produto Excluído da Lista.')}
  catch(err){console.error(err);message('Falha ao Excluir: '+(err.code||err.message),true)}
  finally{busy.delete(item.id)}
 }
});
el('purchaseList').addEventListener('change',async event=>{
 const checkbox=event.target.closest('[data-purchase-check]');if(!checkbox||!user)return;
 const item=row(checkbox.dataset.purchaseCheck);if(!item||busy.has(item.id))return;
 const checked=checkbox.checked;busy.add(item.id);checkbox.disabled=true;
 try{
  await updateDoc(doc(db,'compras',item.id),{comprado:checked,compradoEm:checked?serverTimestamp():null,updatedAt:serverTimestamp(),updatedByUid:user.uid});
  message(checked?'Produto Marcado Como Comprado.':'Produto Retornado à Lista de Pendentes.');
 }catch(err){checkbox.checked=!checked;console.error(err);message('Falha ao Atualizar: '+(err.code||err.message),true)}
 finally{busy.delete(item.id);checkbox.disabled=false}
});
el('purchaseAgendaOpen').onclick=()=>document.querySelector('[data-page="compras"]')?.click();
disconnect();
onAuthStateChanged(auth,async current=>{
 const token=++epoch;disconnect();
 if(!current){message('Entre no Sistema para Consultar as Compras.');return}
 try{
  const profile=await getDoc(doc(db,'usuarios',current.uid));
  if(token!==epoch)return;
  if(!profile.exists()||profile.data().ativo!==true){message('Usuário Sem Permissão para Compras.',true);return}
  user=current;role=profile.data().role==='admin'?'admin':'operator';render();
  stop=onSnapshot(ref,snapshot=>{
   if(token!==epoch)return;
   items=snapshot.docs.map(d=>({id:d.id,...d.data()}));render();message('Lista de Compras Sincronizada com o Firebase.');
  },err=>{console.error(err);message('Não Foi Possível Consultar Compras. Publique as Regras Atualizadas do Firestore.',true)});
 }catch(err){console.error(err);message('Falha ao Verificar Permissão para Compras.',true)}
});
