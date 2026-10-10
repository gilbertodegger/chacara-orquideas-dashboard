# Administração de Usuários — Firebase

A página **Gestão de Usuários** foi publicada no GitHub Pages. O acesso é controlado por `usuarios/{UID}` no Firestore.

## Ativar regras

1. Firebase Console → Cloud Firestore → Regras.
2. Compare e publique o conteúdo de `operacional/firestore.rules` no repositório.
3. Sua conta de administrador deve ter `ativo: true` e `role: "admin"` na coleção `usuarios`.

Após isso, a guia lista perfis, altera nomes/funções e permite ativar/desativar usuários.

## Criar Login sem abrir Authentication (opcional)

É necessário implantar uma Cloud Function com o SDK Admin do Firebase, **não** adicionar credenciais de serviço ao navegador ou GitHub. Cloud Functions normalmente requer que o projeto esteja no plano Blaze (cobrança habilitada).

Na máquina com Node.js e Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
cd operacional/firebase-backend
npm install --prefix functions
firebase deploy --only functions --project chacara-orquideas
```

O arquivo `firebase.json` desta pasta aponta para a função `createOperationalUser`, com região `southamerica-east1`. O Cloud Functions SDK valida quem está autenticado e a função verifica `usuarios/{UID}` antes de criar a conta.

Após implantação, em **Gestão de Usuários → Novo Usuário → Criar Login com E-mail e Senha**, cadastre nome, e-mail, senha e permissão.

**Não salve senhas na coleção Firestore nem as envie por mensagem no GitHub.** Entregue a senha inicial ao funcionário por um canal seguro e incentive a redefinição.

## Alternativa sem Cloud Functions: Vincular UID

1. Firebase Console → Authentication → Users → Add User.
2. Crie a conta com e-mail e senha e copie o UID gerado.
3. Em Gestão de Usuários → Novo Usuário, escolha **Vincular UID Existente**.
4. Informe nome, e-mail, UID e permissão; salve.

A criação do perfil no Firestore **não cria o login Authentication**. As duas partes devem existir. A guia não permite rebaixar ou desativar a própria conta administrativa e impede exclusão direta de documentos da coleção `usuarios`.

## Permissões

- `admin`: configurações, cadastros, manutenções e edição de outros usuários.
- `operator`: registrar ocorrências e atualizar tarefas dentro das regras já existentes.
- `ativo: false`: bloqueio de leitura/escrita dos dados operacionais pelas regras do Firestore. Não exclui o registro do Authentication.

**Atenção:** o código do GitHub Pages e as funções não são implantados no Firestore automaticamente. Teste os fluxos após publicar as regras e a função. Não altere `index.html` da raiz (Dashboard Leiteiro 3.0).
