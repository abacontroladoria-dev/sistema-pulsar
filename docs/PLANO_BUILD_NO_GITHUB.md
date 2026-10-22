# Plano: compilar o Pulsar no GitHub, não no servidor

**Status:** aprovado como direção em 22/10/2026, **ainda não implementado**.

## Por que

Em 22/10/2026, entre 15:33 e 16:40, tudo o que roda no servidor de produção ficou fora do ar: Pulsar, Coolify, os números da Evolution, a TV e os workers da Maia. A causa foram **dois deploys disparados ao mesmo tempo no Coolify**. Dois `next build` juntos não cabem nos 3,8 GB da VPS (`aba-prod-01`, HostGator, IP 143.95.211.211), e o servidor travou. Depois do reboot, a rede da HostGator ainda ficou bloqueada até o suporte liberar.

Hoje o build roda **dentro do servidor de produção**, disputando memória com o que está atendendo pacientes. Um build sozinho consome perto de 2 GB, e o servidor tem uns 1,7 GB livres em operação normal.

## Contornos já aplicados

São contornos, não solução:

- **Coolify → Servers → localhost → Advanced → Number of concurrent builds = 1.** Um segundo deploy entra na fila em vez de rodar junto.
- **Variável de build `NODE_OPTIONS=--max-old-space-size=2048`** no app do Pulsar, que limita o build a 2 GB.
- **Um usuário do Coolify por pessoa** (Teams → Members), para saber quem disparou cada deploy.

## O que muda

| | Hoje | Com build no GitHub |
|---|---|---|
| Onde compila | No servidor de produção | Numa máquina do GitHub Actions, descartada no fim |
| Risco de derrubar produção no deploy | Alto | Nenhum: o servidor só baixa a imagem pronta |
| Troca no servidor | ~3 min de build, com tudo lento | ~30 s (baixar a imagem e reiniciar) |
| Build quebrado | Falha no servidor | Falha no GitHub; produção não é tocada |
| Custo | — | Grátis até 2.000 min/mês de Actions (cerca de 400 builds) |

## Como fazer

O repositório já tem o que precisa: `frontend/Dockerfile` (multi-stage, `output: 'standalone'` no `next.config`).

1. **Workflow `.github/workflows/deploy.yml`**: a cada push na `main`, faz `docker build` de `frontend/` e publica em `ghcr.io/abacontroladoria-dev/sistema-pulsar`, com as tags `:<sha>` e `:latest`.
   - As variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` e `NEXT_PUBLIC_MACHINE_ID` entram como `--build-arg`, vindas de **Variables** do repositório (são públicas, vão no JavaScript do navegador).
   - Nenhum segredo de servidor entra na imagem: service role, OpenAI, Meta e afins continuam no Coolify, aplicados quando o container roda, como já é hoje.
2. **Último passo do workflow**: chamar o webhook de deploy do app no Coolify (URL + token de API guardados em **Secrets** do repositório).
3. **No servidor**: `docker login ghcr.io` com um token do GitHub só de leitura de pacotes (`read:packages`), para o Coolify conseguir baixar a imagem privada.
4. **No Coolify**: o app do Pulsar troca de "construir do repositório" para **Docker Image** (`ghcr.io/abacontroladoria-dev/sistema-pulsar:latest`). As variáveis de ambiente do app ficam onde estão.

**Ordem sem tirar do ar:**
1. Subir o workflow sem o passo do webhook e conferir que a imagem é gerada.
2. Trocar o tipo do app no Coolify e fazer um deploy manual com a imagem.
3. Só então ligar o webhook e desligar o "Auto Deploy" do repositório no Coolify. Se os dois ficarem ligados, o servidor volta a compilar.

**Atenção:** há mais de um app no Coolify apontando para este repositório. Decidir o destino de cada um antes de trocar.

## Passo seguinte (opcional, maior)

O mesmo arranjo abre caminho para um **servidor reserva em outro provedor**, com a Cloudflare na frente do domínio trocando de servidor sozinha quando o principal cair (Load Balancing, ~US$ 5/mês).

- O Pulsar troca sem problema, porque os dados estão no Supabase.
- A Evolution não troca sozinha: cada número só conecta num lugar, e a sessão fica no servidor. Ela depende de backup da sessão ou de escanear o QR Code de novo.
