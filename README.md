# Amigo secreto da Família Santos

Site de Natal com área de organizador. Qualquer pessoa abre o mesmo link, escolhe o próprio nome, escreve os gostos e descobre quem tirou.

## Como funciona

**Para a família (`index.html`)**
1. A pessoa escolhe o nome numa lista. Nomes já escolhidos aparecem desabilitados como "(já escolhido)".
2. Ela escreve os gostos e ideias de presente. Esse texto fica salvo para quem tirou ela.
3. Quando o sorteio já foi feito, ela abre o presente e vê quem tirou e os gostos dessa pessoa.
4. O aparelho guarda um código secreto. Só esse aparelho consegue rever o resultado, e ninguém consegue escolher o mesmo nome de novo.
5. Se algo der errado, aparece o botão "Avisar o organizador".

**Para o organizador (`admin.html`, com senha)**
- Cadastra os nomes e as regras de quem não pode tirar quem.
- Faz o sorteio. O resultado fica só no banco e o painel não mostra quem tirou quem.
- Acompanha quem escolheu o nome, quem escreveu os gostos e quem abriu o presente.
- Libera um nome se a pessoa trocou de celular ou escolheu o nome errado.
- Lê os avisos de erro enviados pela família.
- Baixa e restaura uma cópia de segurança em JSON.

## Como as peças se encaixam

| Peça | Onde fica | Pasta |
| --- | --- | --- |
| Site (HTML, CSS, JS) | GitHub Pages | `docs/` |
| API | Função do Supabase chamada `amigo` | `supabase/functions/amigo/` |
| Dados | Postgres do Supabase, tabela `app_estado` | `supabase/migrations/` |

A função do Supabase não consegue entregar páginas HTML no navegador, por isso o site fica no GitHub Pages e conversa com a função.

## Publicar, passo a passo

### 1. Criar o projeto no Supabase
Crie um projeto em [supabase.com](https://supabase.com). Anote o **Reference ID** (Project Settings > General).

### 2. Criar a tabela
Opção A, pelo navegador: abra **SQL Editor**, cole o conteúdo de `supabase/migrations/20261107000000_amigo_secreto.sql` e clique em Run.

Opção B, pelo terminal:
```bash
npx supabase login
npx supabase link --project-ref SEU-REFERENCE-ID
npx supabase db push
```

### 3. Definir a senha do organizador
```bash
npx supabase secrets set ADMIN_PASSWORD="escolha-uma-senha-forte"
```
Sem essa senha ninguém entra no painel. Use uma senha longa, porque o limite de tentativas é por instância da função.

### 4. Publicar a função
```bash
npx supabase functions deploy amigo --no-verify-jwt
```
O `--no-verify-jwt` é necessário porque o app tem o próprio login. A função fica em:
`https://SEU-REFERENCE-ID.supabase.co/functions/v1/amigo`

### 5. Ligar o site à função
Edite `docs/config.js` e troque `SEU-PROJETO` pelo Reference ID:
```js
window.API_BASE = 'https://abcdefgh.supabase.co/functions/v1/amigo';
```
Faça commit e push.

### 6. Ligar o GitHub Pages
No GitHub: **Settings > Pages > Build and deployment**. Em *Source* escolha **Deploy from a branch**, branch `main`, pasta `/docs`. Salve.

O site fica em `https://isamassarioli.github.io/amigox_natal/` e o painel em `.../admin.html`. Páginas do GitHub Pages em repositório privado exigem plano pago. Em repositório público é grátis. Se preferir manter o repositório privado, Netlify, Vercel e Cloudflare Pages também servem a pasta `docs/`.

### 7. Usar
Abra `admin.html`, entre com a senha, cadastre os nomes, defina data e local da ceia, faça o sorteio e mande o link da página inicial para a família.

## Cuidados

- **Faça backup antes do Natal.** No painel, "Baixar backup". O arquivo guarda também o resultado do sorteio, então quem participa não deve abri-lo.
- No plano gratuito o Supabase **pausa projetos sem uso por cerca de uma semana**. Entre no painel do Supabase perto do Natal para conferir que está ativo.
- Mudar a lista de nomes ou as regras depois do sorteio descarta o resultado. Faça os ajustes antes.
- A tabela `app_estado` tem RLS ligado e nenhuma policy, então a chave pública do Supabase não lê nem grava nela. Só a função acessa.
- Para aceitar chamadas só do seu site, defina `npx supabase secrets set ALLOWED_ORIGIN="https://isamassarioli.github.io"`.
- O código secreto do organizador fica no navegador. Use "Sair" em aparelhos que não são seus.

## Testar localmente

```bash
npx supabase start
npx supabase functions serve amigo --no-verify-jwt --env-file ./.env
```
Com um `.env` contendo `ADMIN_PASSWORD=...`. Depois aponte o `docs/config.js` para `http://127.0.0.1:54321/functions/v1/amigo` e abra `docs/index.html` por um servidor estático.
