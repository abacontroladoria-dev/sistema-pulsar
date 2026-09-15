# API de Faltas — integração com sistemas parceiros

Endpoint de leitura das faltas registradas no Pulsar, para que um sistema
externo lance as mesmas faltas do lado dele.

É **pull**: o parceiro consulta quando quiser. O Pulsar não conhece a URL dele,
não mantém fila de entrega e não fica refém da disponibilidade do outro lado.

---

## Endpoint

```
GET https://orbitaautomacao.com.br/api/integracao/faltas/
Authorization: Bearer <token>
```

### ⚠️ A barra final é obrigatória

Repare no `/` depois de `faltas`. O Pulsar roda com `trailingSlash: true`, então
a URL **sem** a barra não devolve os dados: ela devolve um **308 redirect** para
a versão com barra.

Isso costuma aparecer como **404** no Postman e em clientes HTTP que não seguem
o redirect, ou como **401** em clientes que seguem mas **não repassam o header
`Authorization`** entre hosts/requisições — a maioria não repassa, por segurança.
Nos dois casos o problema é a barra, não o token.

```
✅ /api/integracao/faltas/
✅ /api/integracao/faltas/?limite=500
❌ /api/integracao/faltas          → 308
❌ /api/integracao/faltas?limite=500  → 308
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
| `agendamento_id` | lista de inteiros | — | Consulta pontual: só estes `tita_agendamento_id`. Máx. 200. |
| `paciente_id` | lista de inteiros | — | Consulta pontual: só estes pacientes. Máx. 200. |
| `data_de` | `YYYY-MM-DD` | — | Sessões a partir deste dia (inclusive). |
| `data_ate` | `YYYY-MM-DD` | — | Sessões até este dia (inclusive). |

Limite de **60 requisições por minuto** por token. Ao estourar, a resposta é
`429` com `Retry-After`.

### Os dois modos de uso

**Modo sincronização** — sem filtro nenhum, com `desde`/`desde_id`. É como manter
sua base em dia: você recebe tudo que mudou, inclusive estornos.

**Modo consulta pontual** — com qualquer filtro (`agendamento_id`,
`paciente_id`, `data_de`, `data_ate`). É como perguntar "esse agendamento
faltou?" ou "quais faltas houve em setembro?".

```
# um agendamento
/api/integracao/faltas/?agendamento_id=1882480

# vários de uma vez (até 200) — evita 200 chamadas e o 429
/api/integracao/faltas/?agendamento_id=1882480,1887765,1887869

# todas as faltas de um paciente
/api/integracao/faltas/?paciente_id=11556

# os dois juntos restringem (E, não OU)
/api/integracao/faltas/?paciente_id=11556&agendamento_id=1887765

# um mês fechado — para reconciliar competência
/api/integracao/faltas/?data_de=2026-09-01&data_ate=2026-09-30

# um dia específico: os dois iguais
/api/integracao/faltas/?data_de=2026-09-07&data_ate=2026-09-07

# um lado aberto: de 10/09 em diante
/api/integracao/faltas/?data_de=2026-09-10

# data combina com id — todas as faltas desse paciente em setembro
/api/integracao/faltas/?paciente_id=11556&data_de=2026-09-01&data_ate=2026-09-30
```

#### Sobre as datas

`data_de`/`data_ate` filtram **`data_atendimento`** — o dia em que a sessão
aconteceria, não quando o registro mudou no Pulsar. Quem filtra por "quando
mudou" é o cursor `desde`.

A diferença aparece assim: uma falta de 01/09 corrigida hoje tem
`data_atendimento = 2026-09-01` e `atualizado_em = hoje`. Ela entra em
`?data_de=2026-09-01&data_ate=2026-09-30` e **não** entra num `desde` de uma hora
atrás, se não tiver mudado de novo nesse intervalo.

O intervalo é **fechado nos dois lados** (`data_de <= dia <= data_ate`). Formato
`YYYY-MM-DD` apenas — data com fuso é recusada com `400`, porque
`2026-09-01T00:00:00-03:00` viraria 31/08 em UTC e tiraria um dia do seu
intervalo sem avisar.

`data_de` **não libera histórico** anterior à data de corte do seu token: o corte
é sempre o mais restritivo. Pedir julho com corte em setembro devolve `[]`, não
erro. Se precisar de mais passado, peça — é um ajuste do nosso lado.

Intervalo invertido (`data_de` depois de `data_ate`) é **`400`**, não resposta
vazia: `[]` ali seria lido como "não houve falta no período" quando a verdade é
que os parâmetros estão trocados.

#### ⚠️ Qualquer filtro ignora o cursor — de propósito

Quando você passa **qualquer** um dos quatro filtros (`agendamento_id`,
`paciente_id`, `data_de`, `data_ate`), os parâmetros `desde`/`desde_id` são
**descartados** e a resposta traz o estado atual do que você pediu, sempre. A
resposta também **não traz** `proximo_desde`/`proximo_desde_id`.

É uma regra só, para não haver o que decorar: **filtro = consulta pontual**.

Isso existe para que a resposta vazia tenha um significado único:

> `"faltas": []` sob filtro significa **"não há falta que satisfaça o que você
> pediu"** — e nunca "há, mas não mudou desde o seu cursor".

Se o filtro compusesse com o cursor, perguntar "o agendamento X faltou?" com um
cursor antigo guardado devolveria `[]` para uma falta que existe, e você
concluiria o oposto do verdadeiro.

**Não use o modo pontual para sincronizar.** Ele não informa estornos que você
ainda não conhece — só responde sobre ids que você já sabe perguntar. Para manter
a base em dia, o cursor continua sendo o caminho.

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

Verificado em produção (2026-09-15): 8.171 faltas com a chave e 8.171 valores
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
| Faltas reais (paciente + terapeuta) | 1.019 | 75% |
| **`unidade_fechada` — a clínica não abriu** | **336** | **25%** |
| Total | 1.367 | |

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

## Sessão combinada: duas linhas, uma ausência

Alguns pacientes têm **duas terapias no mesmo horário**, com profissionais
diferentes — por exemplo "Aplicador ABA (AE)" e "Coordenador de Caso" às 11:20.
No TiTa isso são **dois agendamentos**, cada um com seu `id`.

Do lado do Pulsar a recepção registra **uma** falta: o paciente não veio uma vez.
Mas como você precisa marcar os dois agendamentos, a API entrega **uma linha por
agendamento**:

```json
{ "tita_agendamento_id": 3195192, "terapia_nome": "Aplicador ABA (AE)",
  "profissional_id": 8742,  "codigo_justificativa": 102, "ativa": true,
  "data_atendimento": "2026-09-10", "horario": "11:20:00" }

{ "tita_agendamento_id": 3535628, "terapia_nome": "Coordenador de Caso",
  "profissional_id": 10981, "codigo_justificativa": 102, "ativa": true,
  "data_atendimento": "2026-09-10", "horario": "11:20:00" }
```

Cada linha traz **o profissional da sua própria sessão** e o `terapia_nome`
específico — não a lista combinada.

**As duas compartilham `justificativa` e `codigo_justificativa`**, porque é a
mesma ausência descrita duas vezes. Se você contar assiduidade do paciente,
**são duas linhas mas uma falta só**: agrupe por (paciente, data, horário) antes
de somar, ou o número dele fica inflado.

Nada muda no seu upsert: a chave continua sendo `tita_agendamento_id`, e ela
segue única — cada linha aponta para um agendamento distinto.

---

## Paginação

O cursor é o **par** (`proximo_desde`, `proximo_desde_id`). Devolva os dois.

```
1ª chamada:  /api/integracao/faltas/
2ª chamada:  /api/integracao/faltas/?desde=<proximo_desde>&desde_id=<proximo_desde_id>
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

**Faltas cujo agendamento foi excluído no TiTa não são enviadas.** É o único caso
restante de falta sem `tita_agendamento_id` — cerca de 3 por mês. Acontece assim:
uma rotina remove o agendamento do TiTa, e minutos depois a recepção registra a
falta do que ainda via na tela. A sessão existiu e o atendimento foi cobrado como
ausência do nosso lado, mas o agendamento correspondente não existe mais para
você casar, então preferimos não enviar a inventar uma chave.

Se notar um buraco na sua base — uma falta que a clínica relata e você não
recebeu — este é o primeiro motivo a considerar; é só perguntar que conferimos a
sessão específica.

---

## Erros

| HTTP | Quando |
|------|--------|
| 401 | Token ausente, malformado, inexistente ou revogado. Mensagem sempre igual, de propósito. |
| 400 | `desde` não é ISO 8601; `desde_id` não é inteiro; `limite` fora de 1–1000; mais de 200 ids em `agendamento_id`/`paciente_id`; `data_de`/`data_ate` fora de `YYYY-MM-DD` ou com intervalo invertido. |
| 429 | Mais de 60 requisições por minuto. Respeite o `Retry-After`. |
| 500 | Falha na consulta. O detalhe fica no log do Pulsar, não na resposta. |

---

## Exemplo

```bash
# Primeira carga
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://orbitaautomacao.com.br/api/integracao/faltas/?limite=500"

# Incremental
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://orbitaautomacao.com.br/api/integracao/faltas/?desde=2026-09-14T00:00:00Z&desde_id=3377324"
```

---

## Do lado do Pulsar

- View: `public.vw_integracao_faltas` — a projeção; não expõe CPF, carteirinha
  nem guia
- Migrations: `20260914160000_codigo_justificativa_falta.sql`,
  `20260914170000_integracao_faltas_view_e_rpc.sql`,
  `20260915120000_integracao_faltas_hardening.sql`,
  `20260915140000_integracao_faltas_filtro_por_id.sql`,
  `20260915160000_integracao_faltas_filtro_por_data.sql`,
  `20260915180000_integracao_faltas_sessao_combinada.sql`,
  `20260915200000_revoke_execute_fn_agendamentos.sql`
- Gerar/revogar token, mudar a data de corte:
  `supabase/snippets/integracao_faltas_provisionar.sql`
- Vigiar a cobertura: `supabase/snippets/faltas_integracao_cobertura.sql`
- Rota: `frontend/app/api/integracao/faltas/route.ts`

A rota é fina de propósito: quem autentica e decide quais colunas saem é a RPC
`integracao_faltas` (`SECURITY DEFINER`) sobre a view — a regra mora no banco,
onde um bug de rota não consegue vazar coluna a mais de `fila_autorizacoes`.
