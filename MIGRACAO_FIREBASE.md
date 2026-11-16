# Synapse → Firebase (ramo de preparação)

**NÃO publique este ramo em produção sem configurar e testar o projeto Firebase.**
O site publicado pelo GitHub Pages e o projeto CRM VENDAS não são alterados por este ramo.

## Diagnóstico confirmado
- O código principal está em `index.html`.
- O estado do Synapse é salvo em IndexedDB (`ChacaraOrquideasDashboard`) e, em fallback, localStorage.
- Em Configurações, o aplicativo exporta e restaura um backup JSON completo.
- Trocar de domínio GitHub Pages → Firebase Hosting NÃO transporta IndexedDB/localStorage.
- O estado completo pode ultrapassar o limite de 1 MiB por documento Firestore; guardar snapshots JSON no Cloud Storage e deixar Firestore para autorização e dados estruturados.

## Plano de migração sem perda de dados
1. No navegador onde o Synapse atual está preenchido, abrir Configurações e baixar **Backup JSON**.
2. Salvar cópia offline e verificar que o JSON contém `payload` e `schema`.
3. Criar um **NOVO projeto Firebase** independente do CRM VENDAS (por exemplo `synapse-chacara-orquideas`; ID sujeito a disponibilidade).
4. Habilitar Authentication > Email/Password, sem cadastro público.
5. Habilitar Firestore (database padrão) e Cloud Storage. **Storage requer plano Blaze**; ativar alertas de orçamento.
6. Cadastrar administradores em Authentication pelo console.
7. Em Firestore criar `members/{UID}` com `enabled=true`, `role="admin"`. Para leitura futura: `role="reader"`.
8. Implementar interface de login, validação de `members/{UID}` e persistência do snapshot em `synapse/data/current.json`. Implementar arquivos originais sob `synapse/imports/` e backups imutáveis sob `synapse/backups/`.
9. Publicar primeiro em canal de pré-visualização do Firebase Hosting e testar em navegador limpo, com o backup.
10. Só depois liberar o URL definitivo e desativar GitHub Pages para evitar versões divergentes.

## Segurança
- Firebase Hosting serve código HTML/JS estático publicamente; a tela de login NÃO é proteção suficiente para dados. O acesso aos arquivos depende das regras no servidor (`storage.rules`) e da lista de membros no Firestore.
- O repositório atualmente é **público**, portanto nunca adicionar planilhas de rebanho, backup JSON, chaves privadas, senhas ou tokens.
- `firestore.rules` não permite que um usuário cadastre ou altere suas próprias permissões.
- Essas regras são um ponto de partida; testar no Rules Playground/Emulator antes de publicar.
- Importação inicial e sincronização multiusuário precisam ser testadas para evitar sobrescritas entre computadores.

## Próximos dados necessários
- ID do novo projeto Firebase e configuração WEB (apiKey, authDomain, projectId, storageBucket, appId, messagingSenderId).
- Backup JSON do Synapse gerado no navegador atual para testar importação.
- Lista de contas autorizadas (inicialmente um único administrador para evitar edição simultânea).
