# Amigo secreto da Família Santos

Site de Natal com área de organizador. Qualquer pessoa abre o mesmo link, escolhe o próprio nome, escreve os gostos e descobre quem tirou.

## Como funciona

**Para a família (`/`)**
1. A pessoa escolhe o nome numa lista. Nomes já escolhidos aparecem desabilitados como "(já escolhido)".
2. Ela escreve os gostos e ideias de presente. Esse texto fica salvo para quem tirou ela.
3. Quando o sorteio já foi feito, ela abre o presente e vê quem tirou e os gostos dessa pessoa.
4. O aparelho guarda um código secreto. Só esse aparelho consegue rever o resultado. Ninguém consegue escolher o mesmo nome de novo.
5. Se algo der errado, aparece o botão "Avisar o organizador".

**Para o organizador (`/admin`, com senha)**
- Cadastra os nomes e as regras de quem não pode tirar quem.
- Faz o sorteio. O resultado fica só no servidor e o painel não mostra quem tirou quem.
- Acompanha quem escolheu o nome, quem escreveu os gostos e quem abriu o presente.
- Libera um nome se a pessoa trocou de celular ou escolheu o nome errado.
- Lê os avisos de erro enviados pela família.
- Baixa e restaura uma cópia de segurança em JSON.

## Rodar no computador

Precisa do Node 18 ou mais novo. Não tem nada para instalar.

```bash
ADMIN_PASSWORD=escolha-uma-senha node server.js
```

Abra `http://localhost:3000` (família) e `http://localhost:3000/admin` (organizador).

## Publicar na internet

O servidor precisa guardar um arquivo (`data/familia.json`), então escolha um host que rode Node e mantenha disco. Qualquer um destes serve:

| Host | O que fazer |
| --- | --- |
| **Railway** | Novo projeto a partir do repositório. Crie um Volume montado em `/data` e defina `DATA_DIR=/data`. |
| **Fly.io** | `fly launch` usando o `Dockerfile`. Crie um volume com `fly volumes create dados` e monte em `/data`. |
| **Render** | Web Service com o `Dockerfile` e um Disk em `/data`. O Disk é pago. Sem ele os dados somem quando o serviço reinicia. |
| **Servidor próprio** | `node server.js` atrás de um proxy com HTTPS. |

Variáveis de ambiente:

- `ADMIN_PASSWORD`: senha do painel. **Obrigatória na prática.** Sem ela o servidor cria uma senha temporária e mostra nos logs.
- `DATA_DIR`: pasta onde ficam os dados. Aponte para o disco persistente (por exemplo `/data`).
- `PORT`: o host normalmente define sozinho.

Depois de publicar, entre em `/admin`, cadastre os nomes, defina data e local da ceia e mande o link da página inicial para a família.

## Cuidados

- **Faça backup antes do Natal.** No painel, "Baixar backup". Em hosts sem disco persistente, os dados somem quando o serviço reinicia, e o backup é o que salva.
- O arquivo de backup guarda também o resultado do sorteio. Quem participa não deve abri-lo.
- Mudar a lista de nomes ou as regras depois do sorteio descarta o resultado. Faça os ajustes antes.
- Use HTTPS (os hosts acima já entregam). A senha do painel e os códigos dos participantes trafegam na conexão.
- O painel limita tentativas de senha (8 a cada 10 minutos por endereço).
