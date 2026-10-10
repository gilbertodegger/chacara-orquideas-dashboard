"use strict";

const {onCall,HttpsError} = require("firebase-functions/v2/https");
const {initializeApp,getApps} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore,FieldValue} = require("firebase-admin/firestore");

if(getApps().length===0)initializeApp();

// A função só aceita chamadas autenticadas por um perfil ativo com role admin.
// Todas as decisões críticas acontecem no servidor — nunca no GitHub Pages.
exports.createOperationalUser = onCall({
  region:"southamerica-east1",
  maxInstances:3,
  timeoutSeconds:45,
  memory:"256MiB",
},async request=>{
  if(!request.auth?.uid)throw new HttpsError("unauthenticated","Faça Login como Administrador.");

  const actorUid=request.auth.uid;
  const db=getFirestore();
  const actor=await db.doc("usuarios/"+actorUid).get();
  if(!actor.exists||actor.data()?.ativo!==true||actor.data()?.role!=="admin"){
    throw new HttpsError("permission-denied","Somente o Administrador Pode Criar Contas.");
  }

  const payload=request.data||{};
  const nome=String(payload.nome||"").trim().replace(/\s+/g," ");
  const email=String(payload.email||"").trim().toLowerCase();
  const password=payload.password;
  const role=payload.role;

  if(nome.length<2||nome.length>80)throw new HttpsError("invalid-argument","Informe um Nome de 2 a 80 Caracteres.");
  if(email.length<5||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    throw new HttpsError("invalid-argument","Informe um E-mail Válido.");
  }
  if(typeof password!=="string"||password.length<8||password.length>128){
    throw new HttpsError("invalid-argument","Informe uma Senha Inicial de 8 a 128 Caracteres.");
  }
  if(!["admin","operator"].includes(role)){
    throw new HttpsError("invalid-argument","Permissão Inválida.");
  }

  let created;
  try{
    created=await getAuth().createUser({
      email,
      password,
      displayName:nome,
      emailVerified:false,
      disabled:false,
    });
  }catch(error){
    if(error.code==="auth/email-already-exists")throw new HttpsError("already-exists","O E-mail Já Tem Uma Conta no Authentication. Utilize Vincular UID Existente.");
    if(error.code==="auth/invalid-password"||error.code==="auth/invalid-email"){
      throw new HttpsError("invalid-argument","E-mail ou Senha Inválidos.");
    }
    throw new HttpsError("internal","Não Foi Possível Criar a Conta no Authentication.");
  }

  try{
    await db.doc("usuarios/"+created.uid).create({
      nome,email,role,ativo:true,
      createdByUid:actorUid,createdAt:FieldValue.serverTimestamp(),
      updatedByUid:actorUid,updatedAt:FieldValue.serverTimestamp(),
    });
  }catch(error){
    // Se o perfil não puder ser criado, remove a conta Auth recém-criada.
    try{await getAuth().deleteUser(created.uid)}catch(cleanup){console.error("Falha ao reverter criação Auth:",cleanup.code||cleanup.message)}
    throw new HttpsError("internal","Conta Não Foi Vinculada com Segurança. Confira o Firebase.");
  }

  return {uid:created.uid,email,role};
});
