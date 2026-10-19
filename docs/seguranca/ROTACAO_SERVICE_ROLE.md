# Rotação da chave `service_role` — roteiro

> Fase 8 da branch `feat/seguranca-falhas-dados` (pendência P1 de `docs/SEGURANCA_DADOS_AGENDA.md`).
> A chave `service_role` antiga está no histórico do GitHub. Quem a tiver lê e escreve **tudo**, passando por cima da RLS. Apagar o arquivo não resolve: só trocar a chave e desligar a antiga.

## Quando fazer

- **No mesmo dia, do começo ao fim.** Entre o passo 2 e o passo 5 o sistema funciona com as duas chaves; não deixe para o dia seguinte.
- **Fora do horário das rotinas:** não entre 02:00 e 04:30 (sync do TiTa, carga diária, snapshot). Bom horário: de manhã cedo num dia de semana, antes da recepção começar, ou no fim da tarde.
- **Depois** que as Fases 1–7 estiverem em produção e estáveis.
- Reserve ~1h30. Tenha à mão: painel do Supabase, Coolify, terminal com a CLI do Supabase logada.

## Onde a chave é usada hoje

| Lugar | Nome da variável | Quem usa |
|---|---|---|
| Coolify — app Pulsar (frontend) | `SUPABASE_SERVICE_ROLE_KEY` | rotas `/api` (laudos, PDI, Connect, Auditoria de Evoluções, TiTa…) |
| Supabase Vault | segredo `cron_service_role_key` | rotinas do `pg_cron` que chamam Edge Functions (sync da grade, painel de entrada, presença ClickUp…) |
| Edge Functions | `SUPABASE_SERVICE_ROLE_KEY` (posta pelo próprio Supabase) | quase todas as funções em `supabase/functions/` |
| Coolify — robô autorizador | `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_KEY`) | `robo-autorizador/worker.js` |
| Coolify — robô de laudos (Órbita) | `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | grava `orbita_laudos_*` (não está no repositório) |
| Máquina local | `frontend/.env.local` (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`) | localhost |
| Máquina local | `frontend/.env.local.cloud.bak` | **cópia antiga — apagar** |

O robô do SharePoint (PEP) usa a chave **pública** e o token próprio do robô, não a `service_role`.

Antes de começar, confira no Coolify se algum outro recurso tem `SUPABASE_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` nas variáveis (Projects → cada recurso → Environment Variables). Anote todos.

## 1. Criar as chaves novas

Supabase → Project Settings → **API Keys**:

1. Na aba das chaves novas, crie uma **Secret key** (`sb_secret_…`). Nome: `pulsar-servidor`.
2. Confira que existe uma **Publishable key** (`sb_publishable_…`). O frontend já tem a variável `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Não desligue nada ainda.** As chaves antigas (legadas) continuam valendo até o passo 5.

Guarde a chave nova num gerenciador de senhas. Nunca a cole em arquivo do repositório, em chat ou em card do ClickUp.

## 2. Trocar nos lugares que a usam

Faça um de cada vez e confira antes de ir para o próximo.

### 2.1 Coolify — app Pulsar
- `SUPABASE_SERVICE_ROLE_KEY` → a `sb_secret_…` nova.
- Redeploy.
- Conferir: abrir Acompanhamento de Laudos e a Auditoria de Evoluções (rotas que usam a chave). Se der erro 401/500, volte o valor antigo e me chame.

### 2.2 Vault — rotinas do pg_cron
No SQL Editor (o arquivo falha de propósito até você trocar `false` por `true`):

```sql
do $$
declare
  confirmei_que_o_valor_abaixo_e_a_chave_nova boolean := false;
begin
  if not confirmei_que_o_valor_abaixo_e_a_chave_nova then
    raise exception 'Pare: cole a chave nova no lugar de COLE_AQUI e troque false por true. Nada foi alterado.';
  end if;
  perform vault.update_secret(
    (select id from vault.secrets where name = 'cron_service_role_key'),
    'COLE_AQUI'
  );
end $$;

-- Conferir (mostra só o nome e a data, nunca o valor):
select name, updated_at from vault.secrets where name = 'cron_service_role_key';
```

**Atenção:** as rotinas mandam essa chave no cabeçalho `Authorization: Bearer …` para as Edge Functions. As chaves novas (`sb_secret_…`) **não são JWT**: uma Edge Function com verificação de JWT ligada pode recusá-las. Por isso o passo 3.1 confere as rotinas **antes** de desligar a chave antiga. Se alguma falhar com 401, volte o segredo para a chave antiga e me chame — a função precisa ser ajustada antes de seguir.

### 2.3 Edge Functions
A `SUPABASE_SERVICE_ROLE_KEY` dentro das funções é posta pelo próprio Supabase (variável reservada: a CLI não aceita `supabase secrets set` com nome começando em `SUPABASE_`).
- Supabase → Edge Functions → **Secrets**: veja que valor as funções recebem e se o painel oferece as chaves novas para elas.
- Se as funções continuarem recebendo só a chave **legada**, elas deixam de funcionar no passo 5. Nesse caso **pare antes do passo 5** e me chame: as funções passam a ler um segredo próprio (ex. `PULSAR_SECRET_KEY`, gravado com `supabase secrets set PULSAR_SECRET_KEY=…`), e isso é mudança de código.

### 2.4 Robôs no Coolify
- Robô autorizador e robô de laudos: `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_KEY` → a chave nova. Restart.
- Conferir no log do Coolify que o robô voltou a gravar (próximo ciclo).

### 2.5 Sua máquina
- `frontend/.env.local`: trocar `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_KEY` pela nova.
- **Apagar** `frontend/.env.local.cloud.bak`.
- Reiniciar o `npm run dev`.

## 3. Conferir (ainda com as duas chaves valendo)

### 3.1 Rotinas do pg_cron na próxima hora
```sql
select j.jobname, d.status, d.start_time, left(d.return_message, 120) as mensagem
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '1 hour'
order by d.start_time desc;
```
E o que as Edge Functions responderam de fato (o cron não enxerga isto):
```sql
select status_code, left(content::text, 120) as resposta, created
from net._http_response
order by created desc
limit 20;
```
Esperado: `succeeded` e respostas 200. Qualquer 401 → ver o aviso do passo 2.2.

### 3.2 Telas
- **Carregar do TiTa** (Grade → Importar do TiTa → prévia).
- **Tela de login**: sair e entrar de novo.
- Acompanhamento de Laudos, Painel Entrada Convênio, Connect (abrir uma conversa).

## 4. Chave pública (se for desligar as legadas)

Desligar as chaves legadas desliga também a **chave pública antiga** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, a que está no JavaScript do site). Antes do passo 5:
- Coolify — app Pulsar: `NEXT_PUBLIC_SUPABASE_ANON_KEY` → a `sb_publishable_…` (e confira `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Variável `NEXT_PUBLIC_` entra no build: **rebuild**, não só restart.
- Robô do SharePoint e robô autorizador: `SUPABASE_ANON_KEY` → a publishable.
- `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_ANON_KEY` → a publishable.
- Conferir de novo: login, uma tela que lê do banco pelo navegador (Grade) e a TV da recepção.

## 5. Desligar a chave antiga

Só quando 3.1, 3.2 e 4 estiverem todos certos:
- Supabase → Project Settings → API Keys → chaves **legadas** → **Disable**.
- Repetir 3.1 e 3.2 em seguida. Se algo quebrar, o painel permite religar as legadas na hora; religue e me chame.

## 6. Depois

- Rodar a varredura: `cd frontend && SONDAR_FUNCOES=1 node scripts/seguranca-varredura-completa.mjs` (com a chave pública nova no `.env.local`).
- Testar a chave antiga (do histórico do GitHub) contra `https://<projeto>.supabase.co/rest/v1/pacientes?select=id_paciente&limit=1`: tem de responder 401.
- Atualizar `docs/SEGURANCA_DADOS_AGENDA.md`: P1 → corrigido, com a data.
