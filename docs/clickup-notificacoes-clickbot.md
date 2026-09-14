# Notificações no ClickUp pelo ClickBot

Como fazer o Pulsar publicar mensagens no Chat do ClickUp assinadas por
**ClickBot**, e não pela conta pessoal de alguém.

Implementado em 03/09/2026 na Edge Function `glosa-clickup`. Este documento é a
referência para reaproveitar o caminho em outras funções.

---

## O problema

O caminho direto (`api.clickup.com`) publica **em nome do dono do token**. O
`CLICKUP_TOKEN` do Pulsar é um token pessoal, então todo aviso automático chegava
assinado por uma pessoa real que não escreveu nada — e quem lia o canal
respondia a ela.

**Não há como corrigir isso pela API do ClickUp.** A API de Chat v3 não tem campo
de autor no request. Não é limitação de permissão nem de plano: o campo não
existe.

## A solução, e o que ela não resolve

O conector oficial do ClickUp no Zapier expõe a action `createChatMessage` com um
campo `send_as_bot`. Com ele, a mensagem sai como **ClickBot**.

**O nome não é escolhível.** "ClickBot" é a identidade genérica do próprio
ClickUp — a mesma que assina as automações nativas. O inventário dos 14 campos
reais da action não tem nenhum de nome ou avatar, e o pedido por bot nomeado
segue aberto no feedback do ClickUp.

Consequência prática: o autor só sabe dizer **que** é um robô. Para dizer **qual**
robô, o Pulsar carimba a origem na primeira linha do corpo:

```
_🤖 Robô de Avisos_

🚨 **BENEFÍCIO REJEITADO** · Fulano de Tal
```

Em itálico e sem negrito de propósito — é metadado, e o negrito pertence ao fato.

### A alternativa que não foi tomada

Criar uma **conta de serviço** no ClickUp (um usuário "Robô de Avisos" com licença
própria) e usar o token dela no `CLICKUP_TOKEN`. O autor viraria literalmente
"Robô de Avisos", sem Zapier, sem polling, sem código novo — só um secret.

Custa uma licença e depende de assento livre no plano. Se algum dia isso for
aceitável, é a solução mais limpa, e serve para todas as funções de uma vez.

---

## O protocolo HTTP

Nada disto está em documentação pública. Foi extraído do bundle do
`@zapier/zapier-sdk@0.107.0` e verificado por HTTP puro. **O SDK não roda em
Deno** (usa `node:fs` e `Buffer`), por isso a Edge Function fala HTTP direto.

### 1. Token (client credentials)

```
POST https://zapier.com/oauth/token/
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=<ZAPIER_CLIENT_ID>
client_secret=<ZAPIER_CLIENT_SECRET>
scope=external
audience=zapier.com
```

`audience=zapier.com` é **obrigatório** e não aparece em nenhum exemplo
publicado. Sem ele a troca falha.

Resposta traz `access_token` e `expires_in` (10h, hoje).

### 2. Header de autorização

Depende do **formato do token**, não do `token_type` da resposta:

| Token | Header |
|---|---|
| três segmentos base64url (JWT) | `Authorization: JWT <token>` |
| qualquer outra coisa | `Authorization: Bearer <token>` |

Hoje volta opaco (`Bearer`). O SDK decide por inspeção e o Pulsar faz igual, para
continuar funcionando se isso mudar.

### 3. Criar o run

```
POST https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs
```

```json
{
  "data": {
    "selected_api": "ClickUpCLIAPI@2.1.63",
    "action_key": "createChatMessage",
    "action_type": "write",
    "authentication_id": "<a conexão ClickUp autorizada no Zapier>",
    "inputs": {
      "team_id": 9011600909,
      "view_id": "8cj47gd-16891",
      "comment_type": "message",
      "comment_text": "...",
      "markdown": true,
      "send_as_bot": true
    }
  }
}
```

Devolve `202` com `data.id`.

### 4. Polling

```
GET https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs/{id}
```

Continua enquanto `HTTP 202` **ou** `data.status === "waiting"`. Na prática leva
1–2 segundos.

---

## Armadilhas

Cada uma destas custou tempo. Estão aqui para não custarem de novo.

### A URL do SDK não é uma URL

`ACTION_RUNS_PATH = "/zapier/api/actions/v1/runs"` parece um caminho, mas
`/zapier` é uma **chave de roteamento**. O SDK remove esse prefixo, troca por
`/api/v0/sdk/zapier` e manda para o subdomínio `sdkapi`:

```
/zapier/api/actions/v1/runs
  → https://sdkapi.zapier.com/api/v0/sdk/zapier/api/actions/v1/runs
```

Concatenar `zapier.com` + o path dá **405** — é o site institucional
respondendo, não a API. Foi assim que o primeiro teste falhou.

### `send_as_bot` não está no schema público

Ele chega ao conector porque `inputs` é repassado **cru, sem validação**. Isso é
o que faz funcionar, e também o que o torna frágil: pode sumir sem aviso se o
Zapier apertar a validação. Daí o fallback ser obrigatório.

Pelo mesmo motivo, **campo desconhecido em `inputs` é ignorado em silêncio** —
testar um nome de campo novo sempre exige olhar o canal, nunca o HTTP.

### HTTP 200 não prova que a mensagem saiu

Duas formas de o request ser válido e nada acontecer:

1. `errors` não-vazio no corpo do polling, **com HTTP 200** — é assim que
   "View not found" aparece.
2. Campo aceito e ignorado (acima).

Precedente no projeto: o campo `followers` da API de Chat devolvia `201` sem
notificar ninguém. **Um 2xx prova que o request era válido, não que ele fez
algo.**

### Timeout do polling não é falha

É "não sei". O run pode já ter publicado. No teste de 03/09/2026 o polling
desistiu depois de a mensagem existir, o fallback publicou de novo, e o canal
recebeu **duas mensagens marcando três pessoas**.

Regra: **entrega incerta não cai no fallback.** Reenviar por via das dúvidas
duplica, e duplicata com menção é pior que atraso.

### Nem toda duplicata é nossa

Em 14/09/2026 o canal recebeu o mesmo aviso duas vezes com **quatro dias** de
intervalo, idêntico byte a byte e as duas cópias assinadas como ClickBot. Não foi
o Pulsar: a outbox tinha uma linha só, `enviado_em` num único instante e
`tentativas = 0`.

Dois sinais separam os casos, e vale checá-los nesta ordem antes de mexer no
código:

| | duplicata do fallback | republicação no Zapier |
|---|---|---|
| intervalo | segundos, mesma rodada | qualquer um |
| autor da 2ª | **conta pessoal** | ClickBot |
| resumo do cron | `fallback_direto` / `zapier_incerto` | limpo |

Duas mensagens ambas como ClickBot significam que **as duas passaram pelo
Zapier** — e o único componente entre a função e o canal capaz de reemitir
sozinho, preservando `send_as_bot`, é o action run. Confirma-se no Zap history da
conexão, procurando dois runs de `createChatMessage` com o mesmo `comment_text`.

Por isso a mensagem termina com `_#<id da outbox> · <data>_`. O `id` é estável e
viaja junto no texto republicado: **mesmo `#id` = mesma mensagem duas vezes;
`#id` diferentes = duas glosas de verdade**, ainda que todos os campos
coincidam. Sem ele, responder "isto é duplicata?" exigia ir ao banco.

### `markdown: true`

É o equivalente ao `content_format: "text/md"` do caminho direto. Sem ele, o
negrito e a citação chegam com os asteriscos à mostra.

### O canal é um `view_id`

O Zapier chama de `team_id`/`view_id` exatamente os mesmos ids que a API v3 chama
de workspace/channel. Não são valores novos — reaproveite os que já estão em
config, em vez de criar colunas que um dia vão discordar.

---

## Como reaproveitar em outra função

1. **Secrets** (uma vez por projeto, já feito):
   `ZAPIER_CLIENT_ID` e `ZAPIER_CLIENT_SECRET` via `supabase secrets set`.

2. **Conexão do Zapier**: precisa existir uma conexão ClickUp autorizada
   (`authentication_id`). A do Pulsar está em
   `glosa_avisos_config.zapier_connection_id`.

3. **Copie o transporte** de `supabase/functions/glosa-clickup/index.ts`:
   `obterTokenZapier`, `headersZapier`, `enviarViaZapier` e o `entregar()` com
   fallback. São autocontidos.

4. **Mantenha o fallback.** Autor errado é defeito cosmético; aviso que não chega
   é contestação perdida.

5. **Ligue por config**, não por deploy — no Pulsar é
   `glosa_avisos_config.zapier_ativo`, que nasce `false`.

### Não serve para tudo

A action é de **mensagem de chat**. Não serve para criar task — é o caso da
`inclusao-terapia-clickup`, que usa `POST /api/v2/list/{id}/task` e continua no
caminho direto.

---

## Diagnóstico

O resumo em JSON da função é a única janela para isso. Campos:

| Campo | Significado |
|---|---|
| `via` | `zapier (ClickBot)` ou `direto (conta pessoal)` |
| `fallback_direto` | quantos avisos caíram no fallback — **saíram com autor errado** |
| `zapier_erro` | por que o Zapier falhou |
| `zapier_incerto` | timeout do polling; a mensagem pode ter saído |

**Estes campos são silenciosos.** O aviso chega, o resumo diz "enviado", e o
autor sai errado sem ninguém perceber — ninguém lê o resumo de um cron. Se a
autoria passar a importar de verdade, vale um alerta quando eles aparecerem.

### Scripts da investigação

- `supabase/snippets/zapier-clickbot-counterproof.mjs` — prova o caminho ponta a
  ponta, fora da Edge Function. Útil para isolar se um problema é do Zapier ou do
  Pulsar.
- `supabase/snippets/zapier-clickbot-campos.mjs` — lista os campos reais que a
  action aceita. É o jeito de descobrir campos fora do schema público, como o
  próprio `send_as_bot`.

Os dois leem o secret do ambiente e nunca o imprimem.

---

## Referências

- Migration: `supabase/migrations/20260903170000_glosa_publica_como_clickbot.sql`
- Implementação: `supabase/functions/glosa-clickup/index.ts`
- Conector: `ClickUpCLIAPI@2.1.63`, action `createChatMessage`
  ("Send Chat Message to Channel")
