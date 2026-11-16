// Synapse: autenticação e armazenamento em nuvem (ambiente de migração).
// O backend controla o acesso aos dados; esconder a página não substitui regras Firebase.
import { firebaseConfig } from "./synapse-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, orderBy, setDoc, writeBatch, runTransaction, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const panel = document.createElement("section");
panel.id = "synapseAccess";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Acesso ao Synapse");
panel.innerHTML =
  '<div class="synapse-access-card">' +
    '<p class="synapse-access-eyebrow">CHÁCARA DAS ORQUÍDEAS</p>' +
    '<h1>SYNAPSE</h1>' +
    '<p>Entre com sua conta autorizada para acessar os dados.</p>' +
    '<form id="synapseAccessForm">' +
      '<label>E-mail<input type="email" id="synapseAccessEmail" required autocomplete="username"></label>' +
      '<label>Senha<input type="password" id="synapseAccessPassword" required autocomplete="current-password"></label>' +
      '<button type="submit" id="synapseAccessButton">Entrar</button>' +
    '</form>' +
    '<p id="synapseAccessMessage" aria-live="polite">Aguardando autenticação…</p>' +
  '</div>';
document.body.appendChild(panel);
const form = document.getElementById("synapseAccessForm");
const msg = document.getElementById("synapseAccessMessage");
const button = document.getElementById("synapseAccessButton");
let auth = null;
let latestUser = null;
let started = false;

function showMessage(value) {
  msg.textContent = String(value || "");
}
function lock() {
  document.documentElement.classList.add("synapse-locked");
  panel.hidden = false;
}
function unlock() {
  panel.hidden = true;
  document.documentElement.classList.remove("synapse-locked");
}
function cloudError(error) {
  console.error("[Synapse Firebase]", error);
  return (error && error.message) ? error.message : "Falha na conexão com o Firebase.";
}
lock();

if (!firebaseConfig.apiKey || !firebaseConfig.projectId ||
    !firebaseConfig.authDomain || !firebaseConfig.storageBucket || !firebaseConfig.appId) {
  showMessage("Projeto Firebase ainda não configurado. Não publique este ambiente.");
  button.disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  const db = getFirestore(app);

  // Persistência por campo do dashboard:
  // - cada campo alterado recebe uma revisão imutável em documentos menores;
  // - o manifesto é atualizado por transação e rejeita versões divergentes;
  // - Firestore é a única fonte operacional (não há dependência do Cloud Storage).
  const manifestRef = doc(db, "synapse", "current");
  const CHARS_PER_PART = 65000; // Pior caso UTF-8 abaixo do limite de 1 MiB/documento.
  const MAX_PARTS_PER_FIELD = 450;
  const MAX_FILE_BYTES = 16 * 1024 * 1024;
  const allowedField = /^[A-Z][A-Z0-9_]{0,79}$/;
  const savedFields = new Map();
  let activeVersion = null;
  let manifestFields = {};
  let migrationReady = false;
  let saveQueue = Promise.resolve();
  let unsubscribeCurrent = null;
  let remoteVersionChanged = false;

  function stringHash(value) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      .then(bytes => Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2, "0")).join(""));
  }
  function splitValue(value) {
    const chunks = [];
    for (let i = 0; i < value.length; i += CHARS_PER_PART) {
      chunks.push(value.slice(i, i + CHARS_PER_PART));
    }
    if (!chunks.length) chunks.push("");
    if (chunks.length > MAX_PARTS_PER_FIELD) {
      throw new Error("Campo muito grande para o Firestore. Não salve: exporte o Backup JSON.");
    }
    return chunks;
  }
  function showRemoteNotice() {
    if (document.getElementById("synapseRemoteNotice")) return;
    const notice = document.createElement("div");
    notice.id = "synapseRemoteNotice";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;max-width:520px;z-index:99999;background:#fff7e4;border:2px solid #b8860b;padding:14px;border-radius:12px;color:#563d0c;box-shadow:0 9px 25px #0002";
    notice.innerHTML = '<strong>O Synapse foi alterado em outro dispositivo.</strong><p>Por segurança, o salvamento está bloqueado neste computador. Baixe um Backup JSON das alterações locais e recarregue a página para sincronizar.</p><button type="button" id="synapseRemoteReload">Recarregar dados</button>';
    document.body.appendChild(notice);
    document.getElementById("synapseRemoteReload").onclick = () => location.reload();
  }
  function monitorRemoteVersion() {
    if (unsubscribeCurrent) unsubscribeCurrent();
    unsubscribeCurrent = onSnapshot(manifestRef, snapshot => {
      if (!snapshot.exists() || !activeVersion) return;
      if (snapshot.data().version !== activeVersion) {
        remoteVersionChanged = true;
        showRemoteNotice();
      }
    }, error => console.warn("Falha ao acompanhar atualizações remotas", error));
  }
  async function readCurrent() {
    const snap = await getDoc(manifestRef);
    if (!snap.exists()) {
      activeVersion = null;
      manifestFields = {};
      savedFields.clear();
      return null;
    }
    const manifest = snap.data();
    if (!manifest || manifest.format !== "synapse-fields-v1" ||
        !manifest.fields || typeof manifest.fields !== "object") {
      throw new Error("O banco contém um manifesto incompatível. A migração foi interrompida.");
    }
    const fields = manifest.fields;
    const payload = { schema: Number(manifest.schema || 1), savedAt: manifest.savedAt || "" };
    const names = Object.keys(fields);
    if (names.some(name => !allowedField.test(name))) throw new Error("Nome de campo inválido.");
    const records = await Promise.all(names.map(async name => {
      const entry = fields[name];
      if (!entry || !entry.revision || !Number.isInteger(entry.parts) ||
          entry.parts < 1 || entry.parts > MAX_PARTS_PER_FIELD) throw new Error("Manifesto incompleto: " + name);
      const list = await getDocs(query(
        collection(db, "synapse_revisions", entry.revision, "parts"),
        orderBy("position")
      ));
      if (list.size !== entry.parts) throw new Error("Faltam partes em " + name);
      const chunks = [];
      list.forEach(part => {
        const value = part.data();
        if (value.position !== chunks.length || typeof value.content !== "string") {
          throw new Error("Partes fora de ordem em " + name);
        }
        chunks.push(value.content);
      });
      const json = chunks.join("");
      if (await stringHash(json) !== entry.sha256) throw new Error("Falha de integridade: " + name);
      return [name, json, JSON.parse(json)];
    }));
    savedFields.clear();
    for (const [name, json, value] of records) {
      savedFields.set(name, json);
      payload[name] = value;
    }
    manifestFields = fields;
    activeVersion = manifest.version;
    remoteVersionChanged = false;
    migrationReady = true;
    monitorRemoteVersion();
    return payload;
  }

  function writeCurrent(payload) {
    if (!latestUser || latestUser.role !== "admin") {
      return Promise.reject(new Error("Somente o administrador pode salvar."));
    }
    if (!migrationReady) {
      return Promise.reject(new Error("Importe primeiro o Backup JSON no sistema novo."));
    }
    if (remoteVersionChanged) {
      return Promise.reject(new Error("Outro dispositivo atualizou o banco. Exporte o backup local e recarregue."));
    }
    // A fila impede que salvamentos do mesmo navegador disputem o manifesto.
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const fields = Object.keys(payload).filter(name => name !== "schema" && name !== "savedAt");
      if (fields.some(name => !allowedField.test(name))) throw new Error("Campo inválido no estado do dashboard.");
      if (!fields.length) throw new Error("Backup sem dados para gravar.");
      const updated = {};
      const changedJson = new Map();
      for (const field of fields) {
        const json = JSON.stringify(payload[field]);
        if (json === undefined) throw new Error("Campo indefinido: " + field);
        if (savedFields.get(field) !== json) changedJson.set(field, json);
      }
      if (!changedJson.size) return;
      const newFields = { ...manifestFields };
      // Cada revisão é imutável; o manifesto permanece intacto até concluir TODOS os envios.
      for (const [field, json] of changedJson) {
        const parts = splitValue(json);
        const revision = crypto.randomUUID();
        const sha256 = await stringHash(json);
        await setDoc(doc(db, "synapse_revisions", revision), {
          fieldName: field, parts: parts.length, sha256,
          ownerUid: latestUser.uid, createdAt: serverTimestamp()
        });
        for (let i = 0; i < parts.length; i += 8) {
          const batch = writeBatch(db);
          parts.slice(i, i + 8).forEach((content, offset) => {
            const position = i + offset;
            batch.set(doc(db, "synapse_revisions", revision, "parts",
              String(position).padStart(5, "0")), { position, content });
          });
          await batch.commit();
        }
        newFields[field] = { revision, parts: parts.length, sha256 };
      }
      const nextVersion = crypto.randomUUID();
      const expectedVersion = activeVersion;
      await runTransaction(db, async transaction => {
        const current = await transaction.get(manifestRef);
        const serverVersion = current.exists() ? current.data().version : null;
        if (serverVersion !== expectedVersion) {
          remoteVersionChanged = true;
          showRemoteNotice();
          throw new Error("Conflito: outra sessão atualizou o Synapse. Nada foi sobrescrito.");
        }
        transaction.set(manifestRef, {
          format: "synapse-fields-v1",
          version: nextVersion,
          fields: newFields,
          schema: Number(payload.schema || 1),
          savedAt: new Date().toISOString(),
          updatedBy: latestUser.uid,
          updatedAt: serverTimestamp()
        });
      });
      activeVersion = nextVersion;
      manifestFields = newFields;
      for (const [field, json] of changedJson) savedFields.set(field, json);
    });
    return saveQueue;
  }

  // O navegador jamais recebe as credenciais OAuth do Google Drive.
  // O endpoint valida o ID Token no servidor e só permite upload de administrador.
  async function archiveImportedFile(file) {
    if (!latestUser || latestUser.role !== "admin") throw new Error("Sem permissão para arquivar arquivos.");
    if (!file || !file.size) return;
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("Arquivo maior que 16 MiB: arquive manualmente no Drive e registre a pendência.");
    }
    const token = await auth.currentUser.getIdToken();
    const url = "https://southamerica-east1-" + firebaseConfig.projectId +
      ".cloudfunctions.net/synapseArchiveImport";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (!response.ok) throw new Error("Arquivamento no Drive falhou (HTTP " + response.status + ").");
  }
  document.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" ||
        input.id === "dashboardRestoreInput" || !input.files || !input.files[0]) return;
    archiveImportedFile(input.files[0]).catch(error => {
      console.error("Arquivo não arquivado no Google Drive:", error);
      if (typeof toast === "function") toast("Importação local feita; arquivo original NÃO foi salvo no Drive.");
    });
  }, true);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    showMessage("Verificando acesso…");
    try {
      await signInWithEmailAndPassword(
        auth,
        document.getElementById("synapseAccessEmail").value.trim(),
        document.getElementById("synapseAccessPassword").value
      );
    } catch (error) {
      console.warn("Falha no login", error.code || error);
      showMessage("Não foi possível entrar. Verifique as credenciais e sua autorização.");
      button.disabled = false;
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      latestUser = null;
      started = false;
      lock();
      showMessage("Acesso restrito a usuários cadastrados.");
      button.disabled = false;
      return;
    }
    try {
      lock();
      showMessage("Carregando dados autorizados…");
      const member = await getDoc(doc(db, "members", user.uid));
      const role = member.exists() && member.data().enabled === true
        ? member.data().role : null;
      if (role !== "admin") {
        await signOut(auth);
        throw new Error("Conta sem permissão no Synapse.");
      }
      latestUser = { uid: user.uid, role };
      window.synapseCloud = {
        readCurrent, writeCurrent, archiveImportedFile, role,
        authorizeFirstRestore() {
          if (!latestUser || latestUser.role !== "admin") throw new Error("Sem autorização.");
          migrationReady = true;
        }
      };
      if (!started) {
        started = true;
        if (typeof window.synapseStartDashboard !== "function") {
          throw new Error("Inicialização do Synapse não encontrada.");
        }
        await window.synapseStartDashboard();
      }
      unlock();
      if (!document.getElementById("synapseCloudLogout")) {
        const logout = document.createElement("button");
        logout.id = "synapseCloudLogout";
        logout.type = "button";
        logout.className = "btn";
        logout.textContent = "Sair";
        logout.addEventListener("click", async () => {
          lock();
          await signOut(auth);
          location.reload();
        });
        (document.querySelector(".actions") || document.querySelector(".topbar") || document.body)
          .appendChild(logout);
      }
    } catch (error) {
      started = false;
      window.synapseCloud = null;
      lock();
      showMessage(cloudError(error));
      button.disabled = false;
    }
  }, (error) => {
    lock();
    showMessage(cloudError(error));
    button.disabled = false;
  });
}
