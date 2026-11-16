// Synapse: autenticação e armazenamento em nuvem (ambiente de migração).
// O backend controla o acesso aos dados; esconder a página não substitui regras Firebase.
import { firebaseConfig } from "./synapse-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage, ref, getBlob, uploadBytes } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

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
  const storage = getStorage(app);

  const currentPath = "synapse/data/current.json";
  let saveQueue = Promise.resolve();
  let lastSaved = "";
  let lastArchiveDay = "";

  async function readCurrent() {
    try {
      const blob = await getBlob(ref(storage, currentPath));
      const value = JSON.parse(await blob.text());
      if (!value || typeof value !== "object" || !value.DATA) {
        throw new Error("Snapshot do Synapse inválido; operação interrompida.");
      }
      lastSaved = JSON.stringify(value);
      return value;
    } catch (error) {
      if (error && error.code === "storage/object-not-found") return null;
      throw error;
    }
  }

  function writeCurrent(payload) {
    if (!latestUser || latestUser.role !== "admin") {
      return Promise.reject(new Error("Somente o administrador pode salvar dados."));
    }
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSaved) return saveQueue;
    // Serializa os envios do navegador para evitar escrita fora de ordem.
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const blob = new Blob([snapshot], { type: "application/json" });
      await uploadBytes(ref(storage, currentPath), blob, {contentType: "application/json"});
      lastSaved = snapshot;
      const day = new Date().toISOString().slice(0,10);
      if (lastArchiveDay !== day) {
        await uploadBytes(ref(storage, "synapse/backups/" + day + "-" +
          latestUser.uid + ".json"), blob, {contentType: "application/json"});
        lastArchiveDay = day;
      }
    });
    return saveQueue;
  }

  async function archiveImportedFile(file) {
    if (!latestUser || latestUser.role !== "admin") return;
    if (!file || !file.size || file.size > 50 * 1024 * 1024) return;
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-130);
    const suffix = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() :
      String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    const path = "synapse/imports/" + new Date().toISOString().slice(0,10) +
      "/" + suffix + "_" + safeName;
    await uploadBytes(ref(storage, path), file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: { originalFileName: file.name, uploadedBy: latestUser.uid }
    });
  }

  // Os arquivos originais são guardados no Storage. O estado interpretado
  // continua a ser persistido por dashboardSaveData() no snapshot JSON.
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "file" ||
        el.id === "dashboardRestoreInput" || !el.files || !el.files[0]) return;
    archiveImportedFile(el.files[0]).catch(error =>
      console.warn("Não foi possível arquivar o arquivo original", error));
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
      if (role !== "admin" && role !== "reader") {
        await signOut(auth);
        throw new Error("Conta sem permissão no Synapse.");
      }
      latestUser = { uid: user.uid, role };
      window.synapseCloud = { readCurrent, writeCurrent, archiveImportedFile, role };
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
      if (role === "reader") {
        showMessage("Modo leitura.");
        // Modo leitor será habilitado apenas após validação de controles
        // que alteram dados. O primeiro acesso operacional deve ser admin.
        document.documentElement.dataset.synapseRole = "reader";
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
