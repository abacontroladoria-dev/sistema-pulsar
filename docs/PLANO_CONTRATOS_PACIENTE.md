# Planejamento — Contratos do Paciente + Status Contratos (D4Sign + Evolution)

## Estado da implementação (branch `feat/contratos-paciente`, 08/10/2026)

| Fase | Situação |
|---|---|
| 0 — Modelo de dados | Feita: `supabase/migrations/20261008160000_pacientes_contratos.sql` (**não aplicada**) |
| 1 — Aba Contratos | Feita (modo manual: criar, editar rascunho, marcar assinado, cancelar — SEM PDF, ver abaixo) |
| 2 — Status Contratos | Feita: `/acompanhamento/contratos`, código `status_contratos` |
| 3 — D4Sign | **Colega** — ganchos prontos (abaixo) |
| 4 — WhatsApp | **Colega** |
| 5 — Segurança | PGlite feito (`supabase/tests/pacientes_contratos.pglite.mjs`, 50+ checagens); falta anon REST + Security Advisor **depois de aplicar** |
| 6 — Documento preenchido | Feita (09/10): `20261009160000_pacientes_contratos_documento.sql` (**não aplicada**; aplicar DEPOIS da 160000) + modelos + rota. Ver abaixo |

### Fase 6 — documento preenchido a partir dos modelos do jurídico (09/10/2026)

- Modelos originais em `contratos-pacientes/` (amarelo = campo, verde = instrução a apagar).
  `node scripts/contratos/preparar-modelos.mjs` (em `frontend/`) aceita revisões, tira
  comentários e instruções e troca cada campo por etiqueta única, conferindo a ORDEM dos
  campos — versão nova do modelo com campo fora de lugar faz o script parar. Saída:
  `frontend/lib/contratos/modelos/*.docx` (lidos do disco; `outputFileTracingIncludes`).
- Etiquetas e pendências: `lib/contratos/documento/montarDados.ts` (puro, testado em
  `documento.test.ts` contra os modelos reais). Preenchimento: docxtemplater.
- `GET /api/contratos/{id}/documento/` (só `cadastros_pacientes`) gera o .docx na hora —
  nada é guardado. Cadastro incompleto → 422 com a lista do que falta.
- Banco: `numero` (sequência única, formato em `sp_contratos_formatar_numero`), valores
  do Neuro, tipo novo `termo_uso_imagem` vinculado a um contrato de Terapias (vence com
  ele) e `autorizacoes_imagem` (marcadas ANTES do envio — a D4Sign não deixa marcar caixa).
- Tela: "Gerar contrato de Avaliação Neuropsicológica" / "Gerar Termo de uso de imagem"
  na aba; Visualizar (prévia via mammoth) e Baixar .docx no detalhe.
- O que é padrão não se digita (decisão do usuário, 09/10): valor = pacote Particular à
  vista, avulsa = valor por sessão Particular (`cronograma_convenio_valores`), 10 sessões,
  início hoje, vencimento +3 meses (Neuro) — num resumo, com "Alterar" para exceção. O
  formulário fica com Uso de imagem e Observação.
- A fase 3 (D4Sign) envia este mesmo .docx — a D4Sign aceita .docx, sem conversor no servidor.
- A 160000 tinha `delete from storage.buckets`, que o Supabase de produção RECUSA (42501,
  trigger `storage.protect_delete`): agora vai num bloco que tolera a recusa. O bucket
  `contratos-pacientes` (vazio) existe em produção — apagar pelo painel, em Storage.

Decisões da seção 12 adotadas como sugerido (renovação = vários por tipo, o atual é o mais
recente não cancelado; A vencer = 30 dias; "Sem contrato" = na grade do TiTa sem Terapias
valendo hoje) — EXCETO a decisão 2 (PDF por upload), revertida: ver abaixo.

Desvios do plano, de propósito:
- **SEM PDF neste tema** (decisão do usuário, 09/10/2026, revertendo a decisão 2 da seção 12):
  o contrato do paciente não guarda, anexa nem baixa arquivo nenhum. Não existe bucket, nem rota
  de upload/download, nem campo "Documento" no painel de detalhe. O documento em si vai viver na
  D4Sign (fase 3) — quando ela existir, a tela mostra o *status* da assinatura, não o PDF.
  As colunas `arquivo_original_path`/`arquivo_original_nome`/`arquivo_assinado_path` e a função
  `contratos_registrar_arquivo` que a migration chegou a ter foram removidas (com `alter table
  drop column`/`drop function` explícitos, para quem já tinha a versão antiga aplicada).
- **Signatários** só são legíveis com `cadastros_pacientes` (guardam CPF/celular; a Status
  Contratos não usa).
- **Assinado → Cancelado** é permitido (rescisão). Nunca volta a Rascunho.
- **Sem filtro de unidade** na Status Contratos: a grade que a alimenta já é toda da unidade 280.
- Status e vigência são filtrados pelos **cards de indicador** (como em Status Laudos), não por lista suspensa.
- **"Cadastro"** (Ativo/Inativo/Fictício) e **"Possui agendamentos"** (Sim/Não) são filtros
  SEPARADOS na Status Contratos (decisão do usuário, 08/10/2026) — não um só "Grade do TiTa".
- **"Sem contrato" não exige mais ter agendamento** (decisão do usuário, 08/10/2026): o ideal é
  cobrar o contrato no dia em que começa o TRATAMENTO terapêutico, e não quando há apenas
  Triagem (avaliação de entrada). Regra final: cobra contrato de Terapias de todo paciente,
  EXCETO quem tem agendamento só de Triagem (`grade_pacientes_com_terapia_real()`,
  `20261008170000`). Quem não tem agendamento nenhum também cobra. Ver `dispensadoDeContrato` /
  `semContratoDeTerapias` em `frontend/lib/contratos/filtros.ts` — é a MESMA regra do cartão e do
  card de indicador.

### Ganchos para a fase 3/4 (colega)

- Mudar status **só** por `contratos_registrar_evento_externo(p_contrato_id, p_tipo_evento,
  p_status_novo, p_detalhe jsonb, p_origem 'd4sign'|'sistema', p_campos jsonb)` — service_role.
  Valida a transição, é idempotente (mesmo status + mesmo último evento = no-op) e grava o evento.
  `p_campos` aceita só: `d4sign_documento_uuid`, `d4sign_cofre_uuid`, `link_expira_em`, `assinado_em`.
- Matriz de transição: `sp_contratos_transicao_ok` no banco = `TRANSICOES` em
  `frontend/lib/contratos/status.ts` (o teste PGlite compara as duas).
- SEM PDF/bucket neste tema (ver acima): se a fase 3 precisar guardar o PDF final da D4Sign, é
  um bucket e um caminho de leitura NOVOS, fora do escopo desta migration.
- Acesso nas rotas: `lerAcessoContratos()` em `frontend/services/contratos/acesso.ts` (`editar` = `cadastros_pacientes`).
- Log cru do webhook: `public.d4sign_webhook_logs` (service_role).
- Signatários: inserir em `pacientes_contratos_signatarios` (service_role) com o retrato do
  responsável no envio. A aba já lista o que estiver lá; sem linhas, mostra quem *vai* assinar
  (financeiro → filiação 1).
- Botões "em breve" já estão no painel de detalhe (`DetalheContratoPainel.tsx`): Enviar para
  assinatura, Reenviar link, Ver status das assinaturas.
- "Expirado" já é calculado na leitura (`statusEfetivo`) enquanto o job diário não existe.

---

## 1. Contexto

Hoje o cadastro do paciente (`/cadastros/pacientes/[id]`) tem as abas Cadastro,
Ficha médica, Laudo, Altas e Individualidades, Escola e Disponibilidade. Não
existe controle de contrato do paciente: as tabelas `remuneracao_contratos*` e a
tela `/cadastros/contratos` são de **prestadores** e não se misturam com isto.

O objetivo é:

1. Criar a aba **Contratos** no cadastro do paciente, controlando:
   - Tipo: **Avaliação Neuropsicológica**, **Terapias**, **Técnico Terapêutico Particular**
   - Data de início
   - Data de vencimento
   - Se foi assinado ou não
2. Criar a tela **Status Contratos** no sidebar (grupo Pacientes), no mesmo molde
   de "Status Laudos e Senhas".
3. Deixar o terreno pronto para o colega integrar a assinatura digital:
   Sistema → D4Sign (documento + link) → Evolution API (WhatsApp) → responsável
   assina → webhook D4Sign → sistema marca **Assinado**.

Decisão já tomada: **não construir assinatura própria**. Só integrar D4Sign + Evolution.

## 2. Divisão de trabalho

| Quem | Fases | Depende de D4Sign? |
|---|---|---|
| Você | 0 (dados), 1 (aba), 2 (Status Contratos), 5 (segurança) | Não |
| Colega | 3 (D4Sign + webhook), 4 (Evolution/WhatsApp) | Sim |

O ponto de encontro entre os dois é o **modelo de dados (fase 0)** e a função
pura de transição de status (`lib/contratos/status.ts`). Fechando isso primeiro,
os dois trabalham em paralelo sem pisar um no outro.

Até a integração existir, a aba funciona no modo **manual**: a equipe cria o
contrato, anexa o PDF e marca "assinado" com a data. Quando a D4Sign entrar, o
mesmo registro passa a ser atualizado pelo webhook.

## 3. Dois eixos diferentes — não misturar

| Eixo | O que responde | Valores | Onde vive |
|---|---|---|---|
| **Status da assinatura** | Em que pé está o processo de assinar? | Rascunho → Enviado → Aguardando assinatura → Assinado; Recusado / Cancelado / Expirado | Coluna `status` (gravada) |
| **Vigência** | O contrato está valendo? | Vigente, A vencer (≤ 30 dias), Vencido, Ainda não iniciado | **Calculada** a partir das datas, nunca gravada |

Atenção: "Expirado" é o **link de assinatura** que venceu sem ninguém assinar.
"Vencido" é o **contrato** que passou da data de vencimento. São coisas distintas
e a tela precisa mostrar as duas.

Significado de cada status:

- **Rascunho** — criado no Pulsar, ainda não foi para a D4Sign.
- **Enviado** — documento subiu para a D4Sign e os signatários foram cadastrados.
- **Aguardando assinatura** — link entregue ao responsável pelo WhatsApp.
- **Assinado** — D4Sign avisou que o documento foi finalizado (ou marcação manual).
- **Recusado** — signatário recusou na D4Sign.
- **Cancelado** — equipe cancelou (no Pulsar e na D4Sign).
- **Expirado** — passou o prazo do link sem assinatura.

## 4. Fase 0 — Modelo de dados (base para os dois)

Migration nova `supabase/migrations/2026MMDDhhmmss_pacientes_contratos.sql`.
Padrões copiados de `20261005160000_pacientes_disponibilidade.sql` (RPC
`security definer` + checagem de permissão + revoke/grant explícitos).

### 4.1 `public.pacientes_contratos`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | bigint identity PK | |
| `paciente_id` | bigint FK `pacientes(id_paciente)` | chave do paciente é bigint, não uuid |
| `tipo` | text CHECK | `avaliacao_neuropsicologica`, `terapias`, `tecnico_terapeutico_particular` |
| `data_inicio` | date not null | |
| `data_vencimento` | date not null | CHECK `data_vencimento >= data_inicio` |
| `status` | text CHECK | os 7 status da seção 3 |
| `assinado_em` | timestamptz | preenchido ao virar Assinado |
| `origem_assinatura` | text CHECK | `manual` ou `d4sign` |
| `arquivo_original_path` | text | PDF no bucket privado |
| `arquivo_assinado_path` | text | PDF final da D4Sign |
| `d4sign_documento_uuid` | text unique | preenchido pelo colega |
| `d4sign_cofre_uuid` | text | |
| `link_expira_em` | timestamptz | base para "Expirado" |
| `observacao` | text | |
| `ativo` | boolean default true | soft delete, como Altas |
| `criado_por_usuario_id/_nome`, `criado_em`, `atualizado_em` | | padrão das outras tabelas |

### 4.2 `public.pacientes_contratos_signatarios`

`id`, `contrato_id` FK, `responsavel_id` FK `responsaveis(id)`, **retrato** de
`nome/cpf/email/celular` no momento do envio (o cadastro do responsável pode mudar
depois), `d4sign_signatario_key`, `status` (`pendente`/`assinado`/`recusado`),
`assinado_em`, `link_enviado_em`, `envios` (contador de reenvios).

Fonte do signatário: `public.responsaveis` + `public.pacientes_responsaveis`
(`tipo = 'financeiro'`, cair para `filiacao_1` se não houver). As colunas
`pacientes.responsavel_*` são legado do TiTa — **não usar**.

### 4.3 `public.pacientes_contratos_eventos` (histórico)

Só insere, nunca altera (trigger que recusa UPDATE/DELETE, como em Disponibilidade).
Colunas: `contrato_id`, `tipo` (`criado`, `arquivo_anexado`, `enviado_d4sign`,
`link_enviado_whatsapp`, `link_reenviado`, `assinado`, `recusado`, `cancelado`,
`expirado`, `assinado_manual`, `status_corrigido`), `status_antes`, `status_depois`,
`detalhe jsonb`, `origem` (`usuario`/`d4sign`/`sistema`), `usuario_id/_nome`,
`criado_em_brasilia`.

### 4.4 `public.d4sign_webhook_logs`

Payload cru de todo POST recebido, `processado`, `erro`. Só service_role. Modelo:
`central.provider_webhook_logs` (`20260924180300_central_provider_webhook_logs.sql`).

### 4.5 Escrita só por RPC

O browser **não** faz UPDATE em `status`. Funções `security definer` com
`auth.uid() is not null and usuario_tem_permissao('cadastros_pacientes')`:

- `contratos_criar(paciente_id, tipo, data_inicio, data_vencimento, observacao)` → Rascunho
- `contratos_editar_rascunho(...)` → só enquanto Rascunho
- `contratos_marcar_assinado_manual(id, assinado_em)` → só de Rascunho/Aguardando
- `contratos_cancelar(id, motivo)`
- `contratos_registrar_evento_externo(...)` → **só service_role**, usada pelo webhook do colega

Toda RPC grava a linha em `pacientes_contratos_eventos` na mesma transação.
Transição inválida (ex.: Assinado → Rascunho) = `raise exception`.

### 4.6 RLS e storage

- SELECT nas 3 tabelas: `usuario_tem_permissao('cadastros_pacientes') or usuario_tem_permissao('status_contratos')`.
- `revoke all` de public/anon/authenticated → `grant select` a authenticated; `force row level security`.
- EXECUTE das RPCs revogado de PUBLIC e anon.
- Bucket **privado** `contratos-pacientes`, só service_role. Caminho
  `{paciente_id}/{contrato_id}/{original|assinado}-{timestamp}.pdf` — **sem nome
  do paciente** no caminho (modelo: `anexo-storage.repository.ts`). Download por
  rota de API com URL assinada de 300 s.

### 4.7 Regras puras compartilhadas

`frontend/lib/contratos/status.ts` + `status.test.mts`:
- `transicaoPermitida(de, para)`
- `vigencia(data_inicio, data_vencimento, hoje)` → vigente / a_vencer / vencido / nao_iniciado
- rótulos e cores de cada status

Usado pela aba, pela tela de Status e pelo webhook — uma regra só.

## 5. Fase 1 — Aba Contratos no cadastro do paciente

### Arquivos

- [PacienteDetalhe.tsx](frontend/components/cadastros/pacientes/PacienteDetalhe.tsx):
  incluir `"contratos"` no tipo `Aba` (L28), no array de `SegmentedTabs` (L188-195)
  e um ramo novo no ternário antes do `AbaAltasIndividualidades`. A aba salva
  sozinha → fica **fora** de `editando`/`dirtyCount` (mesmo tratamento de Escola e
  Disponibilidade, comentários L251-257).
- [page.tsx](frontend/app/(dashboard)/cadastros/pacientes/[id]/page.tsx): aceitar
  `?aba=contratos` (L26-33) — a tela Status Contratos vai linkar direto para cá.
- Novo `frontend/components/cadastros/pacientes/secoes/AbaContratos.tsx`
- Nova pasta `secoes/contratos/`: `ListaContratos.tsx`, `NovoContratoPainel.tsx`,
  `DetalheContratoPainel.tsx`, `LinhaDoTempo.tsx`
- Novo `frontend/services/pacienteContratos.service.ts` (leitura pelo client do
  browser, escrita só via RPC; retorno vazio de RPC = falha, como em
  `pacienteDisponibilidade.service.ts`)

### Tela

- Lista de contratos do paciente, agrupada por tipo, com dois selos por linha:
  status da assinatura + vigência.
- Botão **Novo contrato** → painel lateral com Tipo, Data de início, Data de
  vencimento (ambos `DatePicker` de `@/components/ui/date-picker`), Observação,
  anexo do PDF.
- Clique no contrato → painel de detalhe: dados, signatários, linha do tempo
  (eventos), ações.
- Ações da fase 1: **Marcar como assinado** (com data), **Cancelar**, **Baixar PDF**.
- Ações da fase 3/4 (aparecem desabilitadas com "em breve" até o colega ligar):
  **Enviar para assinatura**, **Reenviar link**, **Ver status das assinaturas**,
  **Baixar contrato assinado**.

### Regras do projeto a respeitar

- Confirmações com `useConfirmacao()` (`frontend/components/ui/pastel/confirmacao.tsx`) — **sem `window.confirm`**.
- Calendário só `DatePicker`; nada de `<input type="date">`.
- Mobile-first; side panel em vez de página nova.
- **localhost usa o banco de produção**: o service precisa tolerar a migration
  ainda não aplicada (códigos `42P01`, `42883`, `PGRST202`, `PGRST205`) mostrando
  aviso em vez de quebrar a ficha.

## 6. Fase 2 — Tela Status Contratos

### Rota e permissão

- Rota: `/acompanhamento/contratos`
- Código de permissão novo: **`status_contratos`** (não reutilizar
  `cadastros_contratos`, que já é a tela de contratos de prestador).

### Arquivos

- [menu.ts](frontend/lib/permissions/menu.ts): item `{ codigo: 'status_contratos', label: 'Status Contratos', grupo: G.pacientes.nome, path: '/acompanhamento/contratos', icon: ... }` logo após `acompanhamento_laudos` (L103).
- [routes.ts](frontend/lib/permissions/routes.ts): `status_contratos: ['/acompanhamento/contratos']`.
- [Sidebar.tsx](frontend/components/Sidebar.tsx): **três lugares** no grupo
  Pacientes — condição de visibilidade (L555-556), `defaultOpen` (L560) e o
  `<Item codigo="status_contratos" />` (perto de L576-578).
- `npm run permissoes:gerar-catalogo` → gera a migration do catálogo.
- Snippet `supabase/snippets/2026MMDD_grupos_status_contratos_APLICAR.sql`
  adicionando o código aos grupos (Recepção, RP, Diretoria…), **com a trava
  `RAISE` que só passa trocando false→true**.
- `frontend/app/(dashboard)/acompanhamento/contratos/page.tsx` (molde:
  `acompanhamento/laudos/page.tsx`, com `?busca=`).
- `frontend/components/acompanhamento/contratos/`: `StatusContratosShell.tsx`,
  `FiltrosContratos.tsx`, `PainelIndicadores.tsx`, `CardContrato.tsx`.
- `frontend/lib/contratos/filtros.ts` + teste (molde: `lib/laudos/filtros.ts`).
- `frontend/app/api/status-contratos/route.ts` + `frontend/services/contratos/acesso.ts`
  e `frontend/services/contratos/status.ts` (`server-only`, molde:
  `services/laudos/acesso.ts` e `services/laudos/acompanhamento.ts`, inclusive a
  leitura paginada de pacientes — PostgREST corta em 1000 linhas sem erro).

### Conteúdo

- **Indicadores (cards):** Sem contrato · Rascunho · Aguardando assinatura ·
  Assinado vigente · A vencer (30 dias) · Vencido · Recusado/Expirado.
- **Filtros:** tipo de contrato, status, vigência, unidade, convênio, busca por nome.
- **Cartão por paciente:** nome, um selo por tipo de contrato, data de vencimento
  mais próxima, link "Abrir cadastro" → `/cadastros/pacientes/{id}?aba=contratos`.
- Filtragem e paginação no cliente (como Laudos), 75 por página.

## 7. Fase 3 — Integração D4Sign (colega)

> Endpoints e códigos do webhook abaixo devem ser **conferidos na documentação
> oficial da D4Sign** antes de codar.

### Configuração (variáveis de runtime no Coolify, nunca `NEXT_PUBLIC_`)

`D4SIGN_BASE_URL`, `D4SIGN_TOKEN_API`, `D4SIGN_CRYPT_KEY`, `D4SIGN_COFRE_UUID`,
`D4SIGN_WEBHOOK_SECRET`. Documentar os nomes em `frontend/.env.example`.

### Módulo

`frontend/modules/contratos/d4sign/` com `import 'server-only'`:
- `d4sign.api.ts` — cliente HTTP com timeout (molde: `modules/atendimento/providers/evolution.api.ts`).
- `d4sign.service.ts` — subir PDF ao cofre, cadastrar signatários, registrar
  webhook do documento, disparar envio **sem e-mail da D4Sign** (quem entrega é o
  WhatsApp), obter link do signatário, baixar PDF final, cancelar.

### Rotas

- `POST /api/contratos/[id]/enviar/` → Rascunho → Enviado → (fase 4) Aguardando
- `POST /api/contratos/[id]/reenviar/`
- `POST /api/contratos/[id]/cancelar/`
- `POST /api/contratos/[id]/consultar-d4sign/` → reconsulta status (para webhook perdido)
- `GET  /api/contratos/[id]/download/` → URL assinada 300 s

Todas checam login + `cadastros_pacientes` com o helper da fase 2. Barra no fim do
caminho é obrigatória (`trailingSlash: true`).

### Webhook

`frontend/app/api/webhooks/d4sign/[secret]/route.ts`, molde
`app/api/central/webhooks/evolution/[secret]/route.ts`:

1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
2. Segredo na URL comparado com `segredoConfere` (`lib/central/webhook-signature.ts`);
   se a D4Sign mandar HMAC, validar também.
3. Grava payload cru em `d4sign_webhook_logs`.
4. **Não confia no payload:** reconsulta o documento na API da D4Sign e só então
   chama `contratos_registrar_evento_externo`.
5. Idempotente (mesmo evento duas vezes não duplica nada).
6. Assinado → baixa o PDF final para o bucket e grava `arquivo_assinado_path`.
7. Erro → 503 para a D4Sign tentar de novo; sucesso → `processado = true`.

### Expirado

Job diário (pg_cron, padrão `20260901180000_central_worker_tick_cron.sql` com
segredo no Vault) marca Expirado o que passou de `link_expira_em` ainda em
Aguardando. Alternativa mais simples: calcular na leitura até o job existir.

## 8. Fase 4 — Envio pelo WhatsApp (colega)

- Reaproveitar `modules/atendimento/providers/evolution.provider.ts`
  (`sendMessage` → `/message/sendText/{instancia}`) e `evolution.api.ts`. Nada de
  cliente novo.
- Instância definida por `CONTRATOS_EVOLUTION_CHANNEL_ID` (canal já existente em
  `central.channel_connections`).
- Telefone do signatário = `responsaveis.celular` (retrato salvo no signatário).
- Mensagem curta, sem dado clínico: saudação + nome do paciente + link D4Sign.
- Envio OK → evento `link_enviado_whatsapp` + status Aguardando. Falha → continua
  Enviado e a aba mostra "WhatsApp não entregue — Reenviar".
- Reenviar = mesmo link (ou link novo se expirado), incrementa `envios`.

## 9. Fase 5 — Segurança (obrigatória)

- PGlite: usuário sem permissão não lê contratos; não muda status por UPDATE
  direto; não chama `contratos_registrar_evento_externo`; transição inválida falha.
- REST com chave anon: zero linhas em todas as tabelas novas e no bucket.
- Security Advisor do Supabase limpo para os objetos novos.
- Webhook: segredo errado → 401; payload forjado com uuid real → não muda nada,
  pois o status vem da reconsulta à D4Sign.
- Nenhum CPF/telefone em log de servidor; caminho do arquivo sem nome do paciente.

## 10. Ordem de entrega e cuidados de processo

1. Branch nova `feat/contratos-paciente` **a partir da main** (a
   `feat/grade-cronograma` atual tem alterações não commitadas — não misturar).
   Conferir `git branch --show-current` antes de editar; trabalhar no diretório
   principal; `git add` arquivo a arquivo.
2. Fase 0 → revisar com o colega → aplicar migration (você aplica; nunca `db push`).
3. Fases 1 e 2 (você) em paralelo com 3 e 4 (colega).
4. Fase 5.
5. `npm run build` real + `npm run lint` antes de pedir validação.
6. Merge na main **só depois da sua validação**; redeploy no Coolify por você.

## 11. Verificação ponta a ponta

1. Ficha de um paciente fictício → aba Contratos → criar contrato Terapias
   (início hoje, vencimento +12 meses) → aparece Rascunho / Vigente.
2. Marcar como assinado manualmente → status Assinado, evento na linha do tempo.
3. Criar contrato com vencimento em 10 dias → Status Contratos mostra em "A vencer".
4. Status Contratos: filtros, contadores e link "Abrir cadastro" caindo na aba certa.
5. Usuário sem `status_contratos` não vê o item no sidebar e recebe 403 na API.
6. (Colega) Ambiente sandbox D4Sign: enviar → WhatsApp chega no número de teste →
   assinar → webhook → Assinado + PDF assinado baixável. Repetir com recusa e
   cancelamento.
7. Celular: aba e tela de status usáveis em 375 px.

## 12. Decisões a validar antes de começar

| # | Pergunta | Sugestão |
|---|---|---|
| 1 | Um paciente pode ter vários contratos do mesmo tipo (renovação)? | Sim; o "atual" é o mais recente não cancelado |
| 2 | O PDF vem pronto (upload) ou o sistema gera a partir de um modelo? | Upload na primeira versão; modelo preenchido depois |
| 3 | Quem assina: só o responsável financeiro, ou também a clínica/testemunha? | Responsável financeiro; clínica a confirmar com o jurídico |
| 4 | Antecedência do "A vencer"? | 30 dias |
| 5 | Quem conta como "Sem contrato" no Status? | Paciente ativo com terapia na grade e sem contrato Terapias vigente |
| 6 | Prazo do link até virar Expirado? | 7 dias |
| 7 | Quem pode criar/editar? | Quem tem `cadastros_pacientes`; Status Contratos só leitura |
