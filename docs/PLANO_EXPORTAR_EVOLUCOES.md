# Plano — Exportar Evoluções

> Escrito em 19/10/2026. Situação: **planejamento**, sem código ainda.
> Pede 4 decisões do usuário antes de começar (seção 13).

## 1. Objetivo

Criar uma tela em **Autorização → Exportar Evoluções**, logo abaixo de Conferência de Guias. Nela a equipe:

1. filtra um período e um paciente (ou todos);
2. vê as evoluções em cards e escolhe todas ou só algumas;
3. exporta em **PDF** (relatório pronto para o convênio) ou em **CSV**.

A tela junta as evoluções do **TiTa** com as evoluções feitas no **Pulsar** (pela Grade). A origem aparece só na tela. O arquivo exportado não diz de onde veio a evolução e não cita o TiTa em nenhum lugar.

Caso típico: filtrar três meses de um paciente e gerar um PDF com dezenas de páginas.

## 2. Regras de negócio

| # | Regra |
|---|---|
| R1 | Entra só atendimento **realizado e com texto de evolução**. Falta, cancelamento e sessão sem texto ficam fora. |
| R2 | A terapia é sempre a **terapia de exibição**, em todo lugar: card, painel, filtro, PDF e CSV. O rótulo é só "Terapia". A terapia agendada entra apenas como reserva, quando a de exibição estiver vazia: `coalesce(terapia_exibicao_nome, terapia_nome)`. |
| R3 | O profissional é **quem executou** o atendimento. Se houve substituição, é o substituto. Nunca é o usuário que digitou: hoje, quando o admin evolui pelo Pulsar, `tratativa_profissional_nome` grava o nome do admin (ver 4.3). |
| R4 | O **mesmo atendimento não aparece duas vezes**. Se ele tem evolução no Pulsar e no TiTa, vale a do Pulsar. |
| R5 | **Nenhuma evolução é cortada entre duas páginas** do PDF. A única exceção é a evolução que sozinha passa de uma página inteira (seção 7.4). |
| R6 | O arquivo usa os nomes do Pulsar: Paciente (não "Favorecido"), Descrição (não "Dissertação"), Horário (não "Período" para a hora do atendimento). |
| R7 | O arquivo (PDF e CSV) **não tem a palavra TiTa** nem indica a origem da evolução. |
| R8 | Unidade operacional: `id_unidade = 280`. O sync do TiTa já busca só essa unidade, e a Grade do Pulsar é só dela. |

## 3. O que existe hoje (levantado em 19/10/2026)

### 3.1 Evoluções do TiTa

- A tela `terapeutico/auditoria-evolucoes` **não chama o TiTa**. Ela lê a cópia local `csv_grades_profissionais`, filtrando `ativo = true` e `descricao_evolucao` preenchida (`frontend/services/auditoriaEvolucoes.service.ts`).
- Quem grava essa cópia é a Edge Function `sync-grade-csv`, no modo `execucao`: janela de hoje − 45 dias até hoje, cron diário `0 7 * * *` UTC (04:00 em Brasília).
  - **Por isso, uma evolução escrita hoje no TiTa só aparece amanhã.**
- Colunas úteis da cópia: `id`, `tita_agendamento_id`, `data`, `hora_inicial`, `hora_final`, `paciente_id`, `paciente_nome`, `terapia_nome`, `terapia_exibicao_id`, `terapia_exibicao_nome`, `profissional_id`, `profissional_nome`, `profissional_cpf`, `convenio_nome`, `status_execucao`, `descricao_evolucao`.
- A cópia **não tem** CPF nem data de nascimento do paciente. Esses dados vêm de `pacientes`.
- RLS da cópia: `SELECT TO authenticated USING (true)`. Qualquer login lê. Isso é uma brecha conhecida e fica fora deste escopo (seção 12).

### 3.2 Evoluções do Pulsar (Grade)

- Tabela `grade_evolucoes`, em relação 1:1 com `grade_agendamentos` (PK `agendamento_id`). Migration `20261016180000_grade_evolucoes_terapeuticas.sql`.
- Campos: `status_execucao` (`Realizado`/`Cancelado`), `descricao_evolucao`, `tratativa_profissional_id`, `tratativa_profissional_nome`, `tratativa_criada_em`, `origem` (`pulsar`/`tita_importacao`), `tita_agendamento_id`.
- Linhas com `origem = 'tita_importacao'` são **cópia do TiTa** feita por `sp_grade_espelhar_evolucoes_tita`. **Ficam de fora**, senão o atendimento duplica (R4).
- `grade_agendamentos` traz `data`, `hora_inicio`, `hora_fim`, `paciente_id`, `terapia_nome`, `terapia_exibicao_id`, `terapia_exibicao_nome`, `tita_agendamento_id` (índice único parcial).
- Texto clínico: pela migration `20261019120000_grade_evolucao_texto_clinico_so_admin.sql`, só **admin** lê o texto e o carimbo na Grade. Quem decide como esta tela trata isso é a decisão D1.
- O carimbo do profissional (`grade_detalhe_evolucao`) já sai com `assinatura_path`, `tipo_registro`, `uf_registro`, `codigo_registro`, e é do substituto quando houve troca.

### 3.3 Paciente e profissional

- `pacientes` (PK `id_paciente`) tem `cpf`, `data_nascimento` e `tita_paciente_id` (único).
- `profissionais` tem `nome`, `tipo_registro`, `uf_registro`, `codigo_registro`, `tita_profissional_id` (único) e `assinatura_path`.
  - A assinatura fica no bucket privado `pacientes-fotos`, em `profissionais/{id}/assinatura-*`.
  - Hoje só quem tem a permissão `cadastros_profissionais` lê esse caminho.

### 3.4 Peças reutilizáveis

| Necessidade | Peça |
|---|---|
| Menu | `frontend/lib/permissions/menu.ts` (item `conferencia_guias`, linha 117) + `frontend/components/Sidebar.tsx` (bloco Autorização, linhas 666–688) |
| Rota ↔ permissão | `frontend/lib/permissions/routes.ts` (`CODIGO_PARA_ROTAS`) |
| Catálogo no banco | `npm run permissoes:gerar-catalogo` → migration `*_catalogo_permissoes_espelha_sidebar.sql` |
| Proteção da página | `frontend/proxy.ts` (automático pela rota) |
| Proteção da API | `frontend/lib/permissions/exigirPermissao.ts` (`exigirPermissao`, `respostaDeAcessoRecusado`). Hoje está só na branch `feat/seguranca-falhas-dados`; se ela não estiver na main, o molde é `lib/auditoria/auth.ts`. |
| Banco pelo servidor | `frontend/lib/supabase/service.ts` (`supabaseService`) |
| Período | `DateRangePicker` (`@/components/ui/date-range-picker`) |
| Paciente(s) / terapia(s) | `MultiSearchCombobox` (`@/components/cronograma/ui/MultiSearchCombobox`); vazio = todos, como em `acompanhamento/laudos/FiltrosLaudos.tsx` |
| Cabeçalho da tela | `useHeader().setHeader(...)`, como em `ConferenciaGuiasShell.tsx` |
| PDF | `pdf-lib` (já instalado); molde de paginação em `frontend/lib/roboSharepoint/relatorioPrestadorPdf.ts` (`novaPagina`, `garantir`, `quebrar`, `seguro`) |
| CSV | não há helper; vamos criar um pequeno em `lib/exportarEvolucoes/csv.ts` |
| Confirmação | `useConfirmacao()` (nunca `window.confirm`) |

## 4. Dados

### 4.1 Por que os dados passam por rotas `/api` do servidor

A tela não lê o banco direto do navegador. Duas rotas `/api` conferem a permissão com `exigirPermissao('exportar_evolucoes')` e chamam as funções do banco com o cliente de serviço. Os motivos:

1. **Localhost sem login:** o navegador lá é anônimo. Com `DISABLE_AUTH=true`, `exigirPermissao` libera, e as rotas funcionam no localhost. Uma chamada direta ao banco seria negada.
2. **Segurança:** as funções ficam com EXECUTE **só para `service_role`**. Nenhum login comum consegue chamá-las pelo REST.
3. **Registro:** a rota sabe quem é o usuário e grava o registro da exportação.

### 4.2 Funções no banco (migration nova)

**`exportar_evolucoes_listar(p_de date, p_ate date, p_paciente_ids bigint[] default null, p_terapias text[] default null)`**

Devolve os dados dos cards, **sem o texto**:

| coluna | TiTa | Pulsar |
|---|---|---|
| `chave` | `'tita:' \|\| csv.id` | `'pulsar:' \|\| ge.agendamento_id` |
| `origem` | `'tita'` | `'pulsar'` |
| `data` | `csv.data` | `ga.data` |
| `hora_inicio` / `hora_fim` | `csv.hora_inicial` / `hora_final` | `ga.hora_inicio` / `hora_fim` |
| `paciente_id` | `pacientes.id_paciente` (via `tita_paciente_id = csv.paciente_id`)* | `ga.paciente_id`* |
| `paciente_nome` | `pacientes.nome`, reserva `csv.paciente_nome` | idem |
| `terapia` | `coalesce(csv.terapia_exibicao_nome, csv.terapia_nome)` | `coalesce(ct_ex.nome, ga.terapia_exibicao_nome, ga.terapia_nome)` |
| `profissional_id` | `profissionais.id` (via `tita_profissional_id = csv.profissional_id`) | `ge.tratativa_profissional_id` |
| `profissional_nome` | `profissionais.nome`, reserva `csv.profissional_nome` | `profissionais.nome` (**nunca** `tratativa_profissional_nome`) |
| `substituicao` | executor ≠ agendado | idem |

\* Os vínculos de paciente marcados com asterisco serão confirmados na Etapa 1. As evoluções sem vínculo saem com `paciente_id` nulo, com o nome vindo do TiTa e com o CPF vazio no PDF.

Regras da função:

- **TiTa:** `ativo = true`, `descricao_evolucao` preenchida e status de execução "realizado". Na Etapa 1, medir quais rótulos de status aparecem junto com texto (ver a memória do rótulo "Não realizado").
- **Pulsar:** `ge.origem = 'pulsar'` e `ge.status_execucao = 'Realizado'`, com texto.
- **Sem repetição:** descartar a linha do TiTa cujo `tita_agendamento_id` aparece numa evolução do Pulsar no mesmo período.
- **Ordem:** paciente, data, hora de início.
- Período de **no máximo 12 meses** por chamada; acima disso, recusa com mensagem clara.

**`exportar_evolucoes_conteudo(p_chaves text[], p_usuario_id uuid, p_usuario_nome text, p_finalidade text)`**

- Devolve, para as chaves pedidas, tudo o que a listagem traz e mais:
  - `descricao` (texto completo, com quebras de linha preservadas);
  - `paciente_cpf`, `paciente_nascimento`, `convenio` (se D4 aprovar);
  - `profissional_registro` (texto pronto, por exemplo `CRP 06/12345`) e `assinatura_path`.
- Máximo de **500 chaves por chamada**; o front pede em lotes.
- Grava uma linha em `exportar_evolucoes_registro` com: quem, quando, `p_finalidade` (`visualizacao` | `pdf` | `csv`), quantidade, período, pacientes e as chaves.
- Uma chave que não existe ou foge às regras é simplesmente ignorada, sem dar erro.

**Tabela `exportar_evolucoes_registro`**

- Colunas: `id`, `criado_em`, `usuario_id`, `usuario_nome`, `finalidade`, `quantidade`, `periodo_de`, `periodo_ate`, `paciente_ids bigint[]`, `chaves text[]`.
- Só o servidor grava. Leitura só para admin (RLS).

Detalhes técnicos das funções: `SECURITY DEFINER`, `set search_path = public`, `REVOKE ALL FROM public, anon, authenticated`, `GRANT EXECUTE TO service_role`.

### 4.3 O nome de quem evoluiu no Pulsar

Quando o admin evolui sem substituição, `grade_registrar_evolucao` grava o profissional agendado em `tratativa_profissional_id` e o **nome do admin** em `tratativa_profissional_nome`.

- A exportação ignora esse campo e usa `profissionais.nome` pelo id.
- No painel lateral da tela pode aparecer "Registrado por: \<usuário\>" como informação interna. Isso nunca vai para o arquivo.

### 4.4 Assinaturas

A rota `POST /api/exportar-evolucoes/assinaturas` recebe `{ profissional_ids }`:

- confere a permissão `exportar_evolucoes`;
- devolve links temporários (120 s) **só para caminhos `profissionais/{id}/assinatura-*`** dos ids pedidos.

A política do bucket não muda. Cada imagem é baixada uma vez por exportação e reaproveitada em todas as páginas.

## 5. Tela

### 5.1 Lugar e acesso

- **Rota:** `/exportar-evolucoes`. Página: `frontend/app/(dashboard)/exportar-evolucoes/page.tsx`.
- **Menu:** item `exportar_evolucoes`, rótulo "Exportar Evoluções", grupo Autorização, logo depois de `conferencia_guias`. Ícone sugerido: `FileOutput` (lucide).
- **Sidebar:** incluir a rota na condição e no `defaultOpen` do grupo Autorização.
- **Permissão:** nasce sem grupo e é marcada em `/admin/permissoes` para quem deve usar.

### 5.2 Desenho (mobile primeiro)

```
┌ Exportar Evoluções ───────────────────────────────┐
│ [Período 01/07/2026 – 30/09/2026 ▾]               │
│ [Pacientes: Todos ▾]   [Terapias: Todas ▾]        │
├───────────────────────────────────────────────────┤
│ 87 evoluções · 3 pacientes                        │
│ [☐ Selecionar tudo]                     [Limpar]  │
│                                                   │
│ ── Maria S. (32) ───────────────────────────────  │
│ ┌─────────────────────────────────────────────┐   │
│ │☐ 05/10/2026 · 07:30–08:00          [TiTa]   │   │
│ │  Psicologia ABA                             │   │
│ │  Maria S. · por Sara Sousa                  │   │
│ └─────────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────────┐   │
│ │☑ 06/10/2026 · 08:00–08:40        [Pulsar]   │   │
│ │  Fonoaudiologia            [substituição]   │   │
│ │  Maria S. · por João P.                     │   │
│ └─────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────┤
│ 12 selecionadas      [Exportar CSV] [Exportar PDF]│  ← barra fixa
└───────────────────────────────────────────────────┘
```

**Filtros**
- **Período:** `DateRangePicker`. O padrão é o mês corrente, com atalhos para este mês, mês passado e últimos 3 meses. O período vai na URL (`?de=&ate=`) para dar para compartilhar.
- **Pacientes:** `MultiSearchCombobox`. Lista só quem tem evolução no período; vazio = todos.
- **Terapias:** `MultiSearchCombobox` com as terapias de exibição do período; vazio = todas.

**Cards**
- Agrupados por paciente; dentro de cada paciente, por data e horário.
- Cada card mostra: caixa de seleção, data, horário, terapia, paciente, profissional que atendeu, selo **TiTa**/**Pulsar** e o selo "substituição" quando houver.
- Tocar no card (fora da caixa) abre o **painel lateral** com o texto completo. Esse pedido usa `finalidade = 'visualizacao'` e também fica registrado.
- No cabeçalho de cada grupo, uma caixa de seleção marca todas as evoluções daquele paciente.

**Seleção**
- "Selecionar tudo" marca tudo o que o filtro trouxe; "Limpar" desmarca.
- Ao trocar o filtro, a seleção fica só com o que continua visível.

**Exportar**
- Os botões ficam desabilitados com zero selecionadas.
- Acima de **1.000 evoluções**, aparece uma confirmação (`useConfirmacao`) com a quantidade e o tempo estimado.
- Durante a geração há uma barra de progresso ("Gerando página 34…"), e a tela continua usável.

**Estados**
- Carregando: esqueleto dos cards.
- Vazio: "Nenhuma evolução neste período." Sem avisos genéricos.
- Erro: mensagem e botão "Tentar de novo".

**Desktop**
- Os filtros ficam numa linha, os cards em uma coluna larga e o painel lateral à direita.

### 5.3 Arquivos do front

```
frontend/app/(dashboard)/exportar-evolucoes/page.tsx
frontend/app/api/exportar-evolucoes/listar/route.ts
frontend/app/api/exportar-evolucoes/conteudo/route.ts
frontend/app/api/exportar-evolucoes/assinaturas/route.ts
frontend/components/exportar-evolucoes/ExportarEvolucoesShell.tsx
frontend/components/exportar-evolucoes/FiltrosExportacao.tsx
frontend/components/exportar-evolucoes/CardEvolucao.tsx
frontend/components/exportar-evolucoes/PainelEvolucao.tsx
frontend/components/exportar-evolucoes/BarraExportacao.tsx
frontend/services/exportar-evolucoes.service.ts
frontend/types/exportarEvolucoes.ts
frontend/lib/exportarEvolucoes/layout.ts        ← paginação pura (testável)
frontend/lib/exportarEvolucoes/layout.test.ts
frontend/lib/exportarEvolucoes/pdf.ts           ← desenha com pdf-lib
frontend/lib/exportarEvolucoes/csv.ts
frontend/lib/exportarEvolucoes/csv.test.ts
```

## 6. Conteúdo do PDF

```
┌──────────────────────────────────────────────────────┐
│                 CLÍNICA UNIVERSO ABA                 │
│          Relatório de Atendimentos Realizados        │
│          Período: 01/07/2026 a 30/09/2026            │
├──────────────────────────────────────────────────────┤
│ Paciente           │ CPF            │ Data de nasc.  │  ← em toda página
│ Maria S.           │ 123.456.789-00 │ 03/05/2021     │
│ Convênio: ...  (se D4)                               │
├──────────────────────────────────────────────────────┤
│ Data       │ Horário       │ Terapia        │[assin.]│
│ 05/10/2026 │ 07:30 às 08:00│ Psicologia ABA │────────│
│            │               │                │Sara S. │
│            │               │                │CRP ... │
│ Descrição                                            │
│ Texto completo da evolução, com as quebras de linha  │
│ originais...                                         │
├──────────────────────────────────────────────────────┤
│ (próximo atendimento)                                │
├──────────────────────────────────────────────────────┤
│ Emitido em 19/10/2026 às 14:32        Página 3 de 42 │
└──────────────────────────────────────────────────────┘
```

**Cabeçalho do documento** (em toda página):
- "CLÍNICA UNIVERSO ABA";
- "Relatório de Atendimentos Realizados";
- "Período: dd/mm/aaaa a dd/mm/aaaa".

**Faixa do paciente** (em toda página): Paciente, CPF formatado, Data de nascimento e, se D4 aprovar, Convênio.

**Bloco por atendimento**
- Primeira linha: Data, Horário ("07:30 às 08:00"), Terapia (de exibição) e Assinatura.
- Abaixo da assinatura vêm o nome do profissional e o registro (por exemplo `CRP 06/12345`).
- Depois vem a Descrição. O subtítulo "dd/mm/aaaa · 07:30 às 08:00" do modelo do TiTa sai, porque repete a linha de cima.

**Sem assinatura cadastrada**
- Fica uma linha em branco, com o nome e o registro embaixo.
- A tela avisa antes de gerar, no formato "3 profissionais sem assinatura no cadastro".

**Rodapé:** "Emitido em dd/mm/aaaa às hh:mm" e "Página X de Y". Sem nome de sistema.

**Nome do arquivo**
- Um paciente: `evolucoes_<paciente>_<de>_<ate>.pdf`.
- Vários pacientes: `evolucoes_<n>-pacientes_<de>_<ate>.pdf`.

**Vocabulário**

| TiTa | Pulsar |
|---|---|
| Favorecido | Paciente |
| Nome do Favorecido | Paciente |
| Dissertação | Descrição |
| Período (hora do atendimento) | Horário |
| Dados gerados por TiTa Therapy | Emitido em … |
| Múltiplos favorecidos | (cada paciente tem a própria faixa) |

## 7. Paginação (o centro do trabalho)

### 7.1 Medidas

- **Página:** A4 (595 × 842 pt), margem de 36 pt.
- **Cabeçalho do documento + faixa do paciente:** cerca de 120 pt.
- **Rodapé:** cerca de 36 pt.
- **Área útil por página:** cerca de 650 pt.

### 7.2 Algoritmo

O algoritmo fica em `layout.ts`, como função pura, sem `pdf-lib`. Isso permite testá-lo.

1. Para cada evolução, quebrar a descrição em linhas pela largura real do texto (`font.widthOfTextAtSize`), mantendo as quebras de linha originais.
2. Calcular a altura do bloco: primeira linha (a maior entre o texto e a assinatura, cerca de 70 pt) + título "Descrição" + linhas × 13 pt + espaçamento interno.
3. **Se o bloco cabe no espaço que sobra na página:** vai nela.
4. **Se não cabe, mas cabe numa página vazia:** vai inteiro para a próxima página (R5).
5. **Se não cabe nem numa página vazia** (texto muito grande; o campo aceita até 20.000 caracteres): divide em partes. Cada parte seguinte começa com "Descrição (continuação) — 05/10/2026 · 07:30 às 08:00", para continuar identificável.
6. **Troca de paciente:** sempre página nova, com a faixa do novo paciente.
7. **"Página X de Y":** desenhado depois de todas as páginas montadas.

### 7.3 Texto

- **Fonte:** Helvetica padrão do `pdf-lib` (WinAnsi, cobre todo o português).
- Caracteres fora do WinAnsi (emoji etc.) passam por `seguro()`, a mesma função de `relatorioPrestadorPdf.ts`.
- **Assinatura:** PNG ou JPG, embutida uma vez por profissional e reaproveitada em todas as páginas. Cabe numa caixa de cerca de 140 × 45 pt, mantendo a proporção.

### 7.4 Volume

- **Geração:** no navegador. Nada é salvo em servidor.
- **Busca do texto:** em lotes de 500, com barra de progresso.
- **Referência:** cerca de 3 evoluções por página. 3 meses de um paciente (~100–200 evoluções) dão ~35–70 páginas, em segundos.
- **Acima de 1.000 evoluções:** pede confirmação. A medição real de tempo fica para a Etapa 4.

## 8. CSV

- **Formato:** UTF-8 com BOM, separador `;`, todos os campos entre aspas, `"` escapado como `""`.
  - O `;` é para o Excel em português abrir as colunas certas; os CSVs atuais do projeto usam `,`.
- **Colunas:** Data; Horário início; Horário fim; Paciente; CPF; Data de nascimento; Convênio (se D4); Terapia; Profissional; Registro; Descrição.
- **Formatos dos campos:** datas em `dd/mm/aaaa`, CPF formatado. As quebras de linha da descrição ficam dentro da célula (o campo vai entre aspas).
- **Proteção contra fórmula:** uma célula que comece com `=`, `+`, `-`, `@`, tab ou CR recebe `'` na frente, para o Excel não executar fórmula.
- **Sem coluna de origem e sem a palavra TiTa** (R7).
- **Nome do arquivo:** o mesmo padrão do PDF, com `.csv`.

## 9. Segurança e LGPD

Essa fase é obrigatória em todo esforço com dados de paciente.

1. **Funções do banco:** EXECUTE só para `service_role`. Testar no PGlite que `anon` e `authenticated` recebem `permission denied`.
2. **Rotas `/api`:** `exigirPermissao('exportar_evolucoes')` em todas as três. Testar 401 sem sessão e 403 sem permissão.
3. **Assinaturas:** a rota só assina caminhos `profissionais/{id}/assinatura-*`, e o link vale 120 s.
4. **Registro de toda leitura de texto** (visualização, PDF, CSV) em `exportar_evolucoes_registro`; só admin lê esse registro.
5. **Listagem sem texto:** o texto clínico só trafega quando alguém pede visualização ou exportação.
6. **Nada salvo em servidor:** o arquivo nasce e é baixado no navegador.
7. **CSV:** proteção contra fórmula (seção 8).
8. **Verificação final:**
   - REST anônimo nas funções e na tabela nova (deve negar);
   - Security Advisor do Supabase sem alerta novo;
   - `scripts/check-seguranca-migrations.js` passando.

## 10. Etapas

| # | Etapa | Conteúdo | Pronto quando |
|---|---|---|---|
| 0 | Branch | `feat/exportar-evolucoes` a partir da `main`, já com `fix/evolucao-texto-clinico-so-admin` e `feat/seguranca-falhas-dados` (do `exigirPermissao`) mescladas. Se não estiverem, decidir a base com o usuário. | branch criada |
| 1 | Medição (só leitura) | Confirmar os vínculos de paciente e de profissional; contar evoluções com terapia de exibição vazia; listar os rótulos de status do TiTa que aparecem com texto; contar repetições TiTa↔Pulsar; medir o volume por mês | números no plano |
| 2 | Banco | migration com as 2 funções + tabela de registro + RLS/grants; teste PGlite `supabase/tests/exportar_evolucoes.pglite.mjs` | teste verde |
| 3 | Menu e permissão | `menu.ts`, `routes.ts`, `Sidebar.tsx`, migration do catálogo; `menu.test.ts` verde | item aparece para admin |
| 4 | Rotas `/api` | `listar`, `conteudo`, `assinaturas` com `exigirPermissao` | 401/403 conferidos |
| 5 | Tela | filtros, cards, seleção, painel lateral, barra fixa, mobile | uso pelo celular no localhost |
| 6 | PDF | `layout.ts` + testes, `pdf.ts`, progresso, nome do arquivo | PDF de 3 meses sem bloco cortado |
| 7 | CSV | `csv.ts` + testes | abre certo no Excel |
| 8 | Segurança | seção 9 inteira | tudo conferido |
| 9 | Build | `npm run build` real, conferir que o dev server serve o código novo | build limpo |
| 10 | Validação do usuário | teste no localhost (o banco é o de produção) | ok do usuário |
| 11 | Merge e deploy | mesclar na main; aplicar as migrations (snippet com trava); redeploy no Coolify pelo usuário; marcar a permissão nos grupos em `/admin/permissoes` | em produção |

Observação: o localhost usa o banco de produção. Até a migration ser aplicada, a tela precisa mostrar uma mensagem clara (função inexistente, erro 42883/PGRST202) em vez de quebrar.

## 11. Testes e critérios de aceite

**Testes automatizados**
- `layout.test.ts`:
  - nenhum bloco atravessa a página, exceto o que é maior que a página inteira;
  - o bloco gigante sai dividido com "continuação";
  - troca de paciente abre página nova;
  - "Página X de Y" correto.
- `csv.test.ts`: BOM, `;`, aspas, quebra de linha dentro da célula, proteção contra fórmula, ausência de "tita" no conteúdo gerado.
- PGlite:
  - sem permissão, nega;
  - a linha do TiTa repetida some quando existe a do Pulsar;
  - linha `tita_importacao` não entra;
  - falta e cancelamento não entram;
  - a terapia sai a de exibição;
  - o profissional sai o executor (não o admin que digitou);
  - o registro da exportação é gravado.

**Aceite manual**
- [ ] Item "Exportar Evoluções" logo abaixo de Conferência de Guias.
- [ ] Filtrar 3 meses de um paciente → PDF com todas as evoluções, nenhuma cortada.
- [ ] "Todos" os pacientes → cada paciente começa em página nova.
- [ ] Selecionar 2 evoluções específicas → o PDF tem só as 2.
- [ ] PDF e CSV sem "TiTa", sem "Favorecido", sem "Dissertação" e sem origem.
- [ ] Terapia sempre a de exibição (por exemplo, "Psicologia ABA" no grupo ABA).
- [ ] Assinatura e registro do profissional que atendeu; substituto quando houve troca.
- [ ] Na tela, o selo TiTa/Pulsar aparece certo.
- [ ] Funciona no celular.

## 12. Riscos e pontos conhecidos

- **Atraso de um dia no TiTa:** a evolução escrita hoje no TiTa só entra amanhã, depois do sync das 04:00. Não haverá aviso na tela; se for preciso, avaliar depois uma "atualização sob demanda".
- **Janela do sync:** só os últimos 45 dias são atualizados. Uma evolução editada no TiTa há mais de 45 dias fica com o texto antigo na cópia.
- **Vínculo de paciente:** uma evolução do TiTa sem paciente correspondente no Pulsar sai sem CPF e sem data de nascimento. A Etapa 1 mede quantas são.
- **Evolução "Sem agendamento" do TiTa:** não tem `tita_agendamento_id`. Não dá para casar com o Pulsar pelo id; entra como está (não duplica, porque não existe a contraparte no Pulsar).
- **Brecha existente:** `csv_grades_profissionais` continua legível por qualquer login. Fechar essa brecha é outro esforço (afeta a Auditoria de Evoluções), mas o caminho desta tela não depende dela.
- **Profissional sem assinatura:** sai a linha em branco, e a tela avisa antes de gerar.

## 13. Decisões pendentes (do usuário)

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | Quem pode ler o texto das evoluções nesta tela? | A permissão `exportar_evolucoes` libera o texto **só nesta tela**. Na Grade continua só admin. |
| D2 | De onde vem a assinatura do PDF? | Do Cadastro de Profissionais do Pulsar (`assinatura_path`), com nome e registro embaixo. |
| D3 | "Todos" os pacientes: um PDF único ou um .zip com um PDF por paciente? E a numeração de páginas? | PDF único, cada paciente em página nova, com a numeração **por paciente** ("Página 2 de 7"). Assim, dá para separar e mandar cada paciente ao seu convênio sem números quebrados. |
| D4 | Cabeçalho: só "CLÍNICA UNIVERSO ABA" em texto, ou com logo? Mostrar o convênio na faixa do paciente? | Texto apenas, como no modelo atual. Mostrar o convênio. |

### Respostas do usuário (19/10/2026)

- **D1:** como recomendado — a permissão `exportar_evolucoes` libera o texto só nesta tela.
- **D2:** como recomendado — assinatura do Cadastro de Profissionais.
- **D3:** como recomendado — PDF único, paciente em página nova, numeração por paciente.
- **D4:** cabeçalho só em texto; **o convênio NÃO vai no PDF**. Aparece só no **CSV** e no **card** da tela.

## 14. Medição da Etapa 1 (19/10/2026, só leitura, service_role via REST)

`csv_grades_profissionais` com `ativo = true` e texto, desde 01/01/2026:

| Medida | Resultado |
|---|---|
| Linhas | 22.018 (jul 1.559 · ago 8.212 · set 8.328 · out 3.919) — a cópia só tem dados a partir de julho |
| `status_execucao` | Realizado 21.942 · **Em Conflito 64** · vazio 12 (os 12 "Sem agendamento") |
| `possui_tratativa` | `true` em 100% |
| Terapia de exibição vazia | **0** (a reserva `terapia_nome` nunca é usada hoje) |
| Sem `tita_agendamento_id` | 12 ("Sem agendamento") |
| Paciente sem vínculo (`pacientes.tita_paciente_id`) | **0**; sem CPF 0; sem nascimento 0 |
| Profissional (executor) sem vínculo (`profissionais.tita_profissional_id`) | **0** |
| Substituição (`tratativa_profissional_id ≠ profissional_id`) | 703; `tratativa_profissional_id` nunca vazio |
| Executores distintos | 119 — **nenhum com assinatura cadastrada**; 42 sem registro profissional |
| Convênio vazio | 0 |
| `tita_agendamento_id` repetido | **9 atendimentos** com linhas idênticas (2 a 8 cópias) |
| Unidade | 100% `280` |

`grade_evolucoes`: só `tita_importacao` (1.227 Realizado, 634 Cancelado). **Nenhuma evolução `pulsar` ainda** — a repetição TiTa↔Pulsar é 0 hoje, mas a regra R4 fica.

Consequências para o código:

1. **Executor no TiTa** = `tratativa_profissional_id` (id do TiTa), reserva `profissional_id`. Substituição = os dois diferentes.
2. **Status aceito no TiTa:** `possui_tratativa = true` + texto, excluindo só os rótulos de não realização (`cancel`/`não realizad`). Entram "Em Conflito" (sessão aconteceu e foi evoluída) e o vazio dos "Sem agendamento".
3. **Sem repetição dentro do TiTa:** `distinct on (tita_agendamento_id)`, ficando a linha mais recente (`updated_at`, depois `id`).
4. **Assinatura:** hoje todo PDF sai com a linha em branco; o aviso "N profissionais sem assinatura" vai aparecer sempre até o cadastro ser preenchido.

## 15. Fora do escopo

- Fechar a leitura aberta de `csv_grades_profissionais`.
- Editar evoluções por esta tela (ela só lê).
- Enviar o arquivo direto ao convênio (e-mail/WhatsApp).
- Exportar faltas ou cancelamentos.
