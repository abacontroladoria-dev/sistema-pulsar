# API de Faltas — integração com sistemas parceiros

Endpoint de leitura das faltas registradas no Pulsar, para que um sistema
externo lance as mesmas faltas do lado dele.

É **pull**: o parceiro consulta quando quiser. O Pulsar não conhece a URL dele,
não mantém fila de entrega e não fica refém da disponibilidade do outro lado.

---

## Endpoint

```
GET https://<host-do-pulsar>/api/integracao/faltas
Authorization: Bearer <token>
```

O token é individual por parceiro, revogável isoladamente, e viaja no header —
nunca na URL, portanto nunca em log de acesso.

É **server-to-server**. Nenhuma rota deste projeto envia cabeçalhos CORS, então
uma chamada feita direto do navegador é bloqueada. Isso é intencional: um Bearer
estático que viajasse no browser estaria no bundle do parceiro, ou seja, público.

### Parâmetros (query string)

| Parâmetro  | Tipo    | Padrão | Descrição |
|------------|---------|--------|-----------|
| `desde`    | ISO 8601 | — | Só o que mudou depois deste instante. Omita na primeira carga. |
| `desde_id` | inteiro | — | Segunda metade do cursor. Sempre junto com `desde`. |
| `limite`   | 1–1000  | 500 | Tamanho da página. |

Limite de **60 requisições por minuto** por token. Ao estourar, a resposta é
`429` com `Retry-After`.

### Resposta

```json
{
  "faltas": [
    {
      "tita_agendamento_id": 3377324,
      "paciente_id": 24815,
      "profissional_id": 8690,
      "data_atendimento": "2026-09-10",
      "horario": "14:20:00",
      "terapia_nome": "Terapia Ocupacional",
      "tipo_falta": "paciente",
      "codigo_justificativa": 102,
      "justificativa": "não vem",
      "ativa": true,
      "status": "falta",
      "atualizado_em": "2026-09-10T17:55:00.772Z"
    }
  ],
  "tem_mais": false,
  "proximo_desde": "2026-09-10T17:55:00.772Z",
  "proximo_desde_id": 3377324
}
```

| Campo | Significado |
|-------|-------------|
| `tita_agendamento_id` | **A chave.** É o `id` do agendamento no TiTa. Veja abaixo. |
| `paciente_id` | Id do paciente no TiTa (o `favorecido.id`). |
| `profissional_id` | Id do profissional no TiTa. **Pode vir `null`** — veja abaixo. |
| `data_atendimento`, `horario` | Quando era a sessão. |
| `terapia_nome` | Terapia da sessão. |
| `tipo_falta` | `paciente`, `terapeuta` ou `unidade_fechada` (a clínica não abriu). |
| `codigo_justificativa` | O motivo, na lista 101–113 (a mesma do seu sistema). |
| `justificativa` | Texto livre digitado pela recepção. Pode ser `null`. |
| `ativa` | `true` = a falta vale agora. `false` = **estorne**. Veja abaixo. |
| `status` | Estado cru da linha no Pulsar (diagnóstico). |
| `atualizado_em` | Instante UTC da última alteração. Metade do cursor. |

---

## A chave casa com o TiTa

`tita_agendamento_id` **não é um id interno do Pulsar**. É literalmente o campo
`id` de cada item de `agenda_favorecido[]` na resposta de
`GET /api/integracao/agendamento` do TiTa — o mesmo valor que aparece como a
coluna `id agendamento` no CSV `csv_grade_profissionais`.

Se o seu sistema lê a API do TiTa, você **já tem esse número**. É só casar pelo
id, sem depender de nome de paciente, data ou horário.

Verificado em produção (2026-09-14): 8.036 faltas com a chave e 8.036 valores
distintos — **a chave é única**, não repete.

---

## `ativa` — e por que você precisa estornar

Uma falta registrada no Pulsar **pode deixar de valer**, de três formas:

1. a recepção reverte a falta (o paciente chegou atrasado, ou foi engano);
2. um feriado lançado em lote é revertido;
3. a guia é liberada na ASSIM e o sistema cancela a falta **automaticamente**.

Em qualquer uma delas a linha volta a aparecer aqui com **`"ativa": false`** e um
`atualizado_em` novo. Trate isso como **estorno** do lançamento anterior daquele
`tita_agendamento_id`.

Use `ativa` como o estado atual — não tente inferir pelo `status`, que existe só
para diagnóstico.

**Faça upsert pela chave, nunca insert cego.** Além dos estornos, manutenções
internas no Pulsar podem recarimbar linhas antigas, que então reaparecem no
cursor. Um sistema idempotente por `tita_agendamento_id` absorve isso sem
duplicar nada.

---

## Códigos de justificativa (101–113)

A recepcionista escolhe no ato do registro, na mesma lista que o seu sistema usa:

| Código | Rótulo |
|---|---|
| 101 | Atestado / internação / falecimento |
| 102 | Ausência de justificativa |
| 103 | Conflito com cronograma |
| 104 | Conflito terapêutico |
| 105 | Consultas / compromissos |
| 106 | Falta do profissional |
| 107 | Férias / Viagem |
| 108 | Logística / deslocamento / clima |
| 109 | Pendência Administrativa |
| 110 | Saúde da criança |
| 111 | Saúde do responsável |
| 112 | Solicitação de liberação por parte do responsável |
| 113 | Feriado / Recesso Clínica |

Alguns casos são derivados pelo sistema, sem perguntar nada. Quando a clínica não
abre, a recepção escolhe o motivo do fechamento e o código sai dele:

| Situação no Pulsar | Código |
|---|---|
| `tipo_falta = 'terapeuta'` | **106** Falta do profissional |
| Feriado / ponto facultativo | **113** Feriado / Recesso Clínica |
| Falta de energia / evento climático | **108** Logística / deslocamento / clima |
| Outro motivo de fechamento | **109** Pendência Administrativa |

O último merece nota: "Outro" é o fechamento que ninguém classificou
(dedetização, obra, greve de transporte). Ele **não** vai como 113 — dizer
"Feriado" num dia que não é feriado afirmaria um fato que você pode conferir
contra o calendário e não encontrar. 109 é o mais próximo de "a clínica não pôde
abrir por uma questão interna".

Faltas registradas antes desta funcionalidade receberam o código pelo mesmo
critério; as de paciente ficaram em **102**, que é literalmente o que o texto
livre daquela época dizia ("n vem", "faltou").

### ⚠️ `tipo_falta = 'unidade_fechada'` — leia antes de importar

São dias em que **a clínica não abriu** (feriado, recesso, falta de energia).
**O paciente não faltou.** O Pulsar mantém essas linhas fora da assiduidade do
paciente em todos os cálculos internos, e o seu sistema deveria fazer o mesmo.

**Isso é um quarto da carga.** Na primeira sincronização (corte 2026-09-01):

| | Linhas | |
|---|---|---|
| Faltas reais (paciente + terapeuta) | 997 | 75% |
| **`unidade_fechada` — a clínica não abriu** | **336** | **25%** |
| Total | 1.333 | |

As 336 vêm de um único dia: o feriado de 07/09. Um feriado derruba a agenda
inteira de uma vez, então esse padrão vai se repetir a cada data comemorativa.

Se o seu sistema tratar essas linhas como falta do paciente, **o número de
faltas dele fica 33% acima do real** já na primeira carga — e cada paciente
atendido naquele dia leva uma falta que nunca aconteceu.

Filtrar é uma linha. Qualquer um destes serve:

```
tipo_falta !== 'unidade_fechada'     // recomendado: explícito
codigo_justificativa !== 113         // 113 = Feriado/Recesso Clínica
```

Enviamos em vez de omitir porque o dado é útil: ele explica uma agenda vazia,
justifica a ausência sem cobrança, e evita que alguém do seu lado vá procurar o
que aconteceu naquele dia. Mas a decisão de contá-lo ou não é sua.

---

## Paginação

O cursor é o **par** (`proximo_desde`, `proximo_desde_id`). Devolva os dois.

```
1ª chamada:  /api/integracao/faltas
2ª chamada:  /api/integracao/faltas?desde=<proximo_desde>&desde_id=<proximo_desde_id>
```

Repita enquanto `tem_mais` for `true`. Guarde o último cursor recebido e use-o na
sincronização seguinte — assim você recebe só o que mudou.

**Por que o cursor tem duas partes:** milhares de faltas compartilham o mesmo
`atualizado_em` (uma manutenção interna carimbou 3.858 linhas no mesmo instante).
Paginar só pelo tempo faria você perder, em silêncio, todas as que não coubessem
na primeira página daquele instante.

---

## Limites conhecidos

**Recorte histórico.** O endpoint entrega faltas a partir de uma data de corte
(padrão **2026-09-01**). Faltas anteriores não são enviadas: a chave do TiTa só
passou a ser preenchida de forma confiável em meados de 2026, e linha sem chave
você não teria como casar. A data é ajustável — peça se precisar de mais passado.

**`profissional_id` nulo em ~13%.** O id vem da agenda do TiTa, e quando o
agendamento é alterado ou removido lá, a versão antiga deixa de ter profissional
associado. A falta continua sendo enviada, só sem esse campo — preferimos
entregá-la incompleta a escondê-la.

**~0,2% das faltas recentes não têm `tita_agendamento_id`** e não são enviadas.
Sem a chave, não há como você casar do lado de lá.

---

## Erros

| HTTP | Quando |
|------|--------|
| 401 | Token ausente, malformado, inexistente ou revogado. Mensagem sempre igual, de propósito. |
| 400 | `desde` não é ISO 8601, `desde_id` não é inteiro, ou `limite` fora de 1–1000. |
| 429 | Mais de 60 requisições por minuto. Respeite o `Retry-After`. |
| 500 | Falha na consulta. O detalhe fica no log do Pulsar, não na resposta. |

---

## Exemplo

```bash
# Primeira carga
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/integracao/faltas?limite=500"

# Incremental
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/integracao/faltas?desde=2026-09-14T00:00:00Z&desde_id=3377324"
```

---

## Do lado do Pulsar

- View: `public.vw_integracao_faltas` — a projeção; não expõe CPF, carteirinha
  nem guia
- Migrations: `20260914160000_codigo_justificativa_falta.sql`,
  `20260914170000_integracao_faltas_view_e_rpc.sql`
- Gerar/revogar token, mudar a data de corte:
  `supabase/snippets/integracao_faltas_provisionar.sql`
- Vigiar a cobertura: `supabase/snippets/faltas_integracao_cobertura.sql`
- Rota: `frontend/app/api/integracao/faltas/route.ts`

A rota é fina de propósito: quem autentica e decide quais colunas saem é a RPC
`integracao_faltas` (`SECURITY DEFINER`) sobre a view — a regra mora no banco,
onde um bug de rota não consegue vazar coluna a mais de `fila_autorizacoes`.
