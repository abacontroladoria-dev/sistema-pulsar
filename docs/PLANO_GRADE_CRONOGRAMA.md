<!-- Plano aprovado em 07/10/2026. Branch: feat/grade-cronograma. Atualizar a tabela de etapas (seção 7) conforme cada uma for validada. -->

> **Situação em 07/10/2026 — etapas 0 a 10 implementadas, aguardando validação do usuário.**
>
> **Migrations** (aplicar nesta ordem; nenhuma está aplicada ainda):
> 1. `20261007150800_catalogo_permissoes_espelha_sidebar.sql` (gerada pelo `npm run permissoes:gerar-catalogo`): código `cronograma_grade`.
> 2. `20261008100000_grade_agenda_tabelas.sql`
> 3. `20261008100100_grade_capacidade_faixa_e_saida_profissional.sql`
> 4. `20261008100200_grade_agenda_rpcs.sql`
> 5. `20261008100300_grade_importar_tita.sql`
> 6. `20261008100400_grade_estender_series_cron.sql`
>
> Executadas e testadas no PGlite: 88 verificações (cenários de agenda, gatilhos, importação, permissões e varredura de privilégios).
>
> **Desvios do plano, decididos na execução:**
> - **Um código de permissão só** (`cronograma_grade`, para ver e editar). O gerador do catálogo só conhece códigos do menu.
> - **Leitura por RPCs** (`grade_profissionais`, `grade_faixas`, `grade_feriados`, `grade_disponibilidade_paciente`), no lugar das views. Quem agenda não tem a permissão dos cadastros.
> - **Importação aplicada em lotes de 15 profissionais.** O volume real medido é de ~3.400 sessões "Agendado" por semana (~26 mil em 2 meses); de uma vez estouraria o `statement_timeout` de 8 s.
> - **Sala não editável no v1:** vem da faixa da disponibilidade. A lista de salas exige a permissão de Profissionais.
> - **Sessão passada não pode ser excluída** (regra "de hoje em diante").
> - **Série "após N sessões"** conta só as sessões criadas (datas puladas não contam).
>
> **Comportamento antes de aplicar as migrations** (localhost = banco de produção):
> - a Grade mostra o aviso "ainda não existe neste banco";
> - o editor de disponibilidade lê sem `capacidade` e recusa gravar "Pacientes por horário" maior que 1;
> - "Inativar" inativa só o cadastro.

# Plano — Módulo **Grade** (Cronograma)

## Contexto

Hoje o Pulsar já tem Cadastro de Profissionais (com **Disponibilidade versionada**) e Cadastro de Pacientes. A agenda real ainda vive no TiTa e só é vista no Pulsar pela tabela `csv_grades_profissionais` (cópia da planilha `csv_grade_profissionais` da API), que mistura agenda com dados de ficha (CPF, CBO, registro) e de evolução/tratativas.

O objetivo é criar o módulo **Grade** dentro de Cronograma: uma agenda **própria do Pulsar**, semanal, por Profissional e por Paciente, com criar/excluir agendamentos, repetição, capacidade por horário e distinção clara entre **disponível × agendado × bloqueado**. É o primeiro passo concreto para, no futuro, dispensar o TiTa.

**Decisões já tomadas pelo usuário:**
- **Nada é escrito no TiTa.** Toda alteração feita na Grade vale **somente no Pulsar**. O TiTa só é **lido**, e só quando alguém clicar em **"Importar do TiTa"**. A página nunca lê o TiTa sozinha ao abrir.
- A grade de cada profissional vem da **Disponibilidade** do cadastro de profissionais. A importação do TiTa serve **só de base** para trazer os agendamentos existentes.
- **Capacidade mora na faixa de disponibilidade** ("Pacientes por horário", padrão 1). Hoje existe em `cronograma_capacidade_profissional_dia` (Indicadores → Profissionais → "Quantidade esperada de pacientes", ex.: Thiago 3, Rachel 2) e será migrada para a faixa.
- A visão Por Profissional tem **lista à esquerda + grade do escolhido**. Na visão Hoje, os profissionais aparecem lado a lado.
- **Auditoria completa:** quem criou, quem excluiu, quando, por quê, com histórico detalhado.
- **Inativação do profissional:** agendamento **anterior à data de saída nunca é apagado**. No momento de inativar, o usuário escolhe **manter** os agendamentos dali em diante (padrão; eles aparecem como "profissional inativo — precisa de reposição") ou **excluí-los**.

---

## 1. Modelo de dados (Supabase)

São tabelas novas, com prefixo `grade_`. **Não reaproveitar `reboot_agendamentos`**: ela aponta para `reboot_profissionais` (e não para `profissionais`), não tem terapia, sala nem auditoria, e nada a usa. Fica intocada.

### 1.1 `grade_series`: a regra de repetição ("agendamento contínuo")
Cada série é um compromisso do tipo "paciente X com profissional Y, terapia Z, toda segunda às 08:40".

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `paciente_id` | bigint → `pacientes.id_paciente` | |
| `profissional_id` | bigint → `profissionais.id` | |
| `terapia_id` | bigint → `cadastro_terapias.id` | terapia clínica |
| `terapia_exibicao_id` | bigint → `cadastro_terapias.id` | terapia de exibição (pode ser igual) |
| `dia_semana` | smallint 0–6 | 0 = domingo |
| `hora_inicio`, `hora_fim` | time | |
| `local_id` | uuid (id de `cronograma_salas`, sem FK, mesmo padrão das faixas) + `sala_nome`, `unidade_nome` (cópias) | |
| `frequencia` | text: `unica` · `semanal` · `a_cada_n_semanas` | |
| `intervalo_semanas` | smallint (1 = semanal, 2 = quinzenal…) | |
| `data_inicio` | date | |
| `data_fim` | date null | null = **contínuo** (sem término) |
| `total_sessoes` | smallint null | "termina após N sessões" |
| `situacao` | `ativa` · `encerrada` | |
| `encerrada_em/por/motivo` | | |
| `origem` | `pulsar` · `tita_importacao` | |
| `importacao_id` | uuid null | |
| `criado_em`, `criado_por`, `criado_por_nome` | | |

### 1.2 `grade_agendamentos`: **uma linha por sessão** (tabela focal da agenda)
As ocorrências são **materializadas**, não calculadas na hora. Isso permite excluir uma sessão só, guardar auditoria por sessão e, no futuro, o Controle Terapêutico (presença/falta) apontar para `grade_agendamentos.id`.

Os nomes das colunas seguem os títulos em português da planilha do TiTa. **Ficam fora:** CPF, CBO e registro (pertencem ao cadastro) e tudo de evolução, tratativa ou execução (pertencem ao futuro módulo de presença).

| grupo | colunas |
|---|---|
| Identidade | `id` uuid PK, `serie_id` uuid null → `grade_series` |
| Quando | `data` date, `dia_semana` smallint, `hora_inicio` time, `hora_fim` time, `duracao_min` smallint |
| Paciente | `paciente_id` bigint FK, `paciente_nome` (cópia no momento) |
| Profissional | `profissional_id` bigint FK, `profissional_nome` (cópia) |
| Terapia | `terapia_id`, `terapia_nome`, `terapia_exibicao_id`, `terapia_exibicao_nome` |
| Onde | `local_id`, `sala_nome`, `unidade_nome` |
| Situação | `situacao`: `agendado` · `excluido` (exclusão é sempre **lógica**; a linha nunca é apagada) |
| Exclusão | `excluido_em`, `excluido_por`, `excluido_por_nome`, `motivo_exclusao`, `escopo_exclusao` (`somente_esta` · `desta_em_diante` · `inativacao_profissional` · `importacao_tita`), `lote_id` |
| Vínculo TiTa (só leitura) | `origem` (`pulsar` · `tita_importacao`), `tita_agendamento_id` bigint (unique onde não nulo), `tita_paciente_id`, `tita_profissional_id`, `tita_terapia_id`, `importacao_id` |
| Rastreio | `criado_em`, `criado_por`, `criado_por_nome`, `atualizado_em` |

**Restrições:**
- Unique parcial `(paciente_id, data, hora_inicio) WHERE situacao='agendado'`: o paciente nunca fica em dois lugares no mesmo horário.
- A capacidade por profissional/horário é validada na RPC, com `pg_advisory_xact_lock(profissional_id, data)`.
- Trigger congela o passado: `data < hoje_brasilia()` não pode ser excluída nem alterada. É a regra "excluir de hoje em diante" e segue o padrão de `trg_congelar_grade_passada`.

**Convênio não é copiado:** vem de `pacientes` por join. Assim a tabela continua focal.

### 1.3 `grade_eventos`: auditoria, só acrescenta
Segue o padrão de `cronograma_salas_auditoria`: colunas `id`, `agendamento_id`, `serie_id`, `bloqueio_id`, `lote_id`, `acao` (`criado` · `excluido` · `serie_encerrada` · `importado` · `bloqueio_criado` · `bloqueio_excluido` · `inativacao_profissional`), `antes` jsonb, `depois` jsonb, **`resumo` legível** ("Excluída só a sessão de 14/10 08:40 — João × Ana (Fono) — motivo: …"), `feito_por`, `feito_por_nome`, `feito_em`, `feito_em_brasilia`.

Triggers recusam UPDATE e DELETE. Sem grant de escrita: só as RPCs gravam.

### 1.4 `grade_bloqueios`
Colunas: `id`, `profissional_id`, `data_inicio`, `data_fim`, `hora_inicio`/`hora_fim` (null = dia inteiro), `dias_semana` smallint[] null, `tipo` (`bloqueio` · `administrativo` · `ferias` · `outro`), `motivo`, `situacao` (`ativo` · `excluido`), `origem` (`pulsar` · `tita_importacao`), `importacao_id` e os campos de rastreio.

**Feriados não são copiados:** vêm de `public.feriados` (integral/parcial) direto no motor.

### 1.5 `grade_importacoes`
Registro de cada clique em "Importar do TiTa": `id`, `janela_inicio/fim`, `situacao` (`previa` · `aplicada` · `descartada`), `contadores` jsonb, `frescor` (último `grade_sync_dia.sincronizado_em` da janela), `feito_por/em`.

### 1.6 Alterações em tabelas existentes
- **`profissionais_disponibilidade_faixas.capacidade`** smallint not null default 1, check 1..10.
  - O `ADD COLUMN` com default não dispara os triggers de imutabilidade.
  - **Carga inicial** a partir de `cronograma_capacidade_profissional_dia`: casa o nome normalizado com `profissionais.id` e o `dow` com `dia_semana`, só em versões vigentes ou agendadas. Desliga o trigger de imutabilidade apenas dentro da migration e registra em `profissionais_disponibilidade_eventos`.
  - A RPC `profissional_disponibilidade_criar_versao` passa a aceitar `capacidade` por faixa.
- **`profissionais.data_saida`** date null, mais a RPC `profissional_inativar(p_id, p_data_saida, p_agendamentos 'manter'|'excluir', p_motivo)`. Ela:
  - grava `ativo=false` e `data_saida`;
  - encerra a disponibilidade vigente em `data_saida − 1` (reusa a lógica de `_alterar_vigencia`);
  - se a escolha for `excluir`, marca `excluido` só as sessões com `data >= data_saida`, com escopo `inativacao_profissional`;
  - **nunca toca em sessão anterior à saída**;
  - grava evento com contagens.
  - Reativar limpa `data_saida`.

### 1.7 RPCs (SECURITY DEFINER; checam `usuario_tem_permissao`)
- `grade_simular_agendamento(payload)`: devolve a lista de datas que a série geraria, cada uma com `ok` ou o conflito (`lotado`, `paciente_ocupado`, `bloqueio`, `feriado`, `fora_da_disponibilidade`, `profissional_inativo`, `paciente_alta`). É a prévia antes de confirmar.
- `grade_criar_agendamento(payload, datas_puladas[])`: cria a série e as sessões. Datas com conflito são puladas e registradas.
- `grade_excluir_agendamento(id, escopo, motivo)`:
  - `somente_esta` marca 1 sessão;
  - `desta_em_diante` marca a sessão escolhida e as seguintes da série e grava `serie.data_fim = data − 1` (ou encerra a série);
  - motivo obrigatório; data ≥ hoje.
- `grade_criar_bloqueio` / `grade_excluir_bloqueio`.
- `grade_importar_tita_previa(janela)` / `grade_importar_tita_aplicar(importacao_id, opcoes)`. Ver a seção 3.
- `grade_estender_series()`: o pg_cron noturno materializa as séries contínuas até o **horizonte de 6 meses**, sem recriar semanas excluídas.
- **Views de leitura:**
  - `vw_grade_agendamentos`: junta `profissionais.ativo/data_saida`, `cadastro_terapias.cor_hex/icone` e o convênio do paciente.
  - `vw_grade_faixas_vigentes`: leitura em massa de versões × faixas × capacidade × terapias, que hoje não existe.

### 1.8 RLS e permissões
- **Códigos novos:** `cronograma_grade` (ver) e `cronograma_grade_agendar` (criar, excluir, bloquear, importar). Entram em `frontend/lib/permissions/routes.ts`, `menu.ts`, `Sidebar.tsx` e numa migration do catálogo, no padrão de `20261006122200_catalogo_permissoes_espelha_sidebar.sql`. Os antigos `cronograma_por_paciente`/`por_profissional` continuam removidos; a página única com switch os substitui.
- **Tabelas:**
  - SELECT só com `cronograma_grade`;
  - sem INSERT/UPDATE/DELETE direto: escrita só via RPC;
  - `revoke` de anon;
  - eventos imutáveis.
- O desalinhamento cliente × banco no papel `diretoria` (`resolver.ts:48`) fica registrado. Não é corrigido aqui.

---

## 2. Motor da grade (TS puro, testável)

**`frontend/lib/grade/motor.ts`**, sem React e sem Supabase. Reaproveita `sessoesDaFaixa`, `paraMin`, `deMin` e `hojeBrasilia` de `frontend/lib/disponibilidadeProfissional.ts`.

**Entrada:**
- faixas vigentes **por data** (a versão cuja vigência cobre aquele dia);
- agendamentos com situação `agendado`;
- bloqueios;
- feriados;
- `data_saida` do profissional.

**Saída por horário:** `{ data, hora_inicio, hora_fim, capacidade, ocupados[], terapiasDaFaixa[], local, estado }`. Os estados são:

| estado | regra |
|---|---|
| `disponivel` | 0 ocupados |
| `parcial` | 0 < ocupados < capacidade (ex.: "1 de 3") |
| `lotado` | ocupados = capacidade |
| `bloqueado` | bloqueio ou feriado integral/parcial que cobre o horário |
| `fora_da_grade` | há agendamento, mas não há faixa (ex.: importado do TiTa ou disponibilidade mudou). Mostra o agendamento com aviso. |
| `inativo` | data ≥ `data_saida`; os agendamentos mantidos aparecem como **"precisa de reposição"** |

**Funções auxiliares:** `semanaDe(data)` (domingo a sábado), `mesDe(data)`, `resumoDoPeriodo()` (disponíveis, agendados, bloqueados, ocupação %) e `expandirSerie()`, que espelha a RPC para mostrar a prévia no cliente.

**Testes:** `frontend/lib/grade/motor.test.ts` com vitest (o repo já tem `"test": "vitest run"`). Cobrem:
- capacidade 1/2/3;
- intervalo de almoço;
- troca de versão de disponibilidade no meio da semana;
- feriado parcial;
- quinzenal;
- "após N sessões";
- `data_saida`;
- agendamento fora da grade.

---

## 3. Importar do TiTa (somente leitura)

Botão **"Importar do TiTa"** no cabeçalho, igual ao de `ProfissionaisCadastro.tsx:307`. Ele abre um painel lateral (`Drawer` de `components/cronograma/ui/Drawer.tsx`) com estes passos:

1. **Frescor:** mostra "Grade do TiTa sincronizada até dd/mm, às hh:mm", lendo `grade_sync_dia` com `medirFrescorGrade` de `frontend/lib/grade/fonte.ts`.
2. **Janela:** padrão de **segunda da semana atual até o fim da janela sincronizada** (≈ fim do mês seguinte). Escolhida com `DateRangePicker`.
3. **Gerar prévia:** `grade_importar_tita_previa`. Lê `csv_grades_profissionais` com `ativo`, `unidade_id = 280`, `status_agendamento = 'Agendado'` e `tita_agendamento_id` não nulo.
   - **Séries inferidas:** agrupa por (paciente TiTa, profissional TiTa, terapia, dia da semana, hora). Vira série `semanal`:
     - contínua (`data_fim` null) se aparece na última semana da janela;
     - senão termina na última data vista;
     - semanas faltando no meio viram sessões `excluido` com escopo `importacao_tita`, para o estendedor não recriá-las.
   - **Bloqueios:** linhas com os pacientes fictícios `PACS_BLOQUEIO_ADMIN` / `PACS_ADMIN` (`lib/cronograma/constants.ts:126-139`) viram `grade_bloqueios` com origem TiTa.
   - **Livres:** ignorados, porque a disponibilidade vem do cadastro. A prévia mostra só um contador "horários livres no TiTa sem faixa no Pulsar", como alerta de cadastro incompleto.
   - **Vínculos:**
     - paciente por `pacientes.tita_paciente_id`;
     - profissional por `profissionais.tita_profissional_id`;
     - terapia por `cadastro_terapias.tita_terapia_id` (fallback `normalizar_nome_terapia`).
     - O que não casar entra na lista **"Pendências de cadastro"** e não é importado.
4. **A prévia mostra grupos com contagem e lista expansível:**
   - **Novos:** aplicados.
   - **Já no Pulsar:** nada a fazer.
   - **Sumiram do TiTa:** existem no Pulsar com origem TiTa, mas não vieram. Caixa **desmarcada** por padrão ("excluir no Pulsar também").
   - **Pendências de cadastro.**
5. **Aplicar.** Os contadores ficam em `grade_importacoes`, e há um evento `importado` por lote.

**Regras invioláveis:**
- **Idempotente** por `tita_agendamento_id`.
- **O Pulsar manda:** o que foi excluído no Pulsar (linha `excluido` com o id do TiTa) **nunca volta** numa reimportação, e nada editado no Pulsar é sobrescrito.
- **Nenhuma chamada à API do TiTa:** a importação lê só a tabela já sincronizada no Supabase.

---

## 4. Interface: `/cronograma/grade`

**Endereço:** `?visao=profissional|paciente&periodo=dia|semana|mes&data=AAAA-MM-DD&id=…`. Links podem ser compartilhados, e "Voltar" funciona.

**Arquivos:**
- `frontend/app/(dashboard)/cronograma/grade/page.tsx` (fica sob o layout `CronogramaDataLayout`);
- `frontend/components/cronograma/grade/`;
- `frontend/services/grade.service.ts`;
- `frontend/hooks/useGrade.ts`;
- `frontend/types/grade.ts`.

### 4.1 Visual (inspirado em `/cadastros/profissionais`)
- **Kit pastel:**
  - `SecaoPastel`, `CabecalhoPastel`, `NumeroPastel`, `BarraPastel`, `PilulaFiltro`, `BotaoAjuda`, `avisoFeito` (`components/ui/pastel/pecas.tsx`);
  - `useConfirmacao` para toda confirmação (**nunca `window.confirm`**);
  - tokens `.pp`, `.pp-tom`, `.ua-*` de `globals.css`.
- **Peças do cadastro:**
  - `AvatarProfissional`, `ChipTerapia`, `corDoCatalogo` (`components/cadastros/profissionais/pecas.tsx`);
  - `BarraAlfabeto`, `SeletorModo` (`components/cadastros/shared/ListaCadastro.tsx`);
  - `estiloTons` (`lib/cadastros/tonsTerapia.ts`);
  - `iconesTerapia`.
- **Cores de terapia** sempre de `cadastro_terapias.cor_hex`, **nunca** de `TERAPIA_CORES`, a cópia legada.
- **Terapia de exibição:** o cartão usa a cor da terapia clínica e mostra o nome de exibição quando difere ("ABA · exibe como Psicologia ABA").
- Escrita: "do TiTa" / "no TiTa", no masculino.

### 4.2 Cabeçalho (`useHeader`)
Contém, nesta ordem:
- título "Grade";
- **switch Por Profissional | Por Paciente** (`.pp-aba`);
- seletor **Hoje · Semana · Mês** (Semana é o padrão);
- **‹ › e "Hoje"**, mais `DatePicker` para pular de data;
- **"Importar do TiTa"**, com a data da última importação;
- **"Novo agendamento"**.

O input do cabeçalho deve ficar fora do `rightContent`, que trava a digitação (lição do Acompanhamento de Laudos).

### 4.3 Coluna esquerda (lista)
- **Por Profissional:**
  - busca;
  - `MultiSearchCombobox` de terapias;
  - `UnidadeSelector`;
  - situação (ativos / inativos com agendamentos);
  - cada linha traz avatar, nome, chips de terapia e uma mini `BarraPastel` com agendados/capacidade da semana.
- **Por Paciente:**
  - busca;
  - convênio;
  - cada linha traz o nº de sessões na semana e um selo vermelho **"N sessões precisam de reposição"** (profissional inativo).
- **Celular:** a lista vira um seletor no topo.

### 4.4 Área principal
- **Cartão-resumo** (como o topo de `ProfissionalDetalhe`): faixa na cor da terapia focal, nome em destaque e 4 `NumeroPastel` (**Disponíveis · Agendados · Bloqueados · Ocupação %**).
- **Semana (principal):**
  - colunas **Dom → Sáb**; domingo e sábado ficam **estreitos e esmaecidos** quando não há faixa nem agendamento, e abrem normalmente quando há;
  - eixo de tempo em minutos (blocos posicionados), para suportar durações mistas de 30, 40, 50 ou 60 minutos;
  - base estrutural em `components/auditoria-assim/reconciliacao/GradeSemana.tsx` (coluna de hora fixa, dias em colunas).
- **Os três estados, bem visíveis** (item 4 do pedido), com legenda fixa e contagens:
  - **Disponível:** contorno tracejado verde-azulado, "+ Livre" ou "2 de 3 livres". O clique abre "Novo agendamento" já preenchido.
  - **Agendado:** cartão cheio na cor da terapia, com paciente, terapia (exibição) e sala. Com capacidade maior que 1, os pacientes aparecem empilhados com "2/3".
  - **Bloqueado:** listras diagonais cinza e o motivo. Feriado é uma faixa na coluna inteira, com o nome.
  - **Fora da grade:** cartão agendado com selo âmbar.
  - **Reposição:** cartão com contorno vermelho e o texto "Profissional inativo — precisa de reposição".
  - `PilulaFiltro` permite mostrar só Disponíveis, só Agendados etc.
- **Hoje:**
  - **Por Profissional:** colunas = profissionais filtrados × horário, com rolagem horizontal.
  - **Por Paciente:** a agenda do dia em lista.
- **Mês:** calendário Dom–Sáb. Cada dia mostra mini-barra e contagens (agendados, livres, bloqueados); o clique abre a semana daquele dia.
- **Por Paciente (semana):**
  - mesma grade, com as sessões do paciente em todos os profissionais;
  - **sombreamento da disponibilidade do paciente** (`vw_pacientes_disponibilidade_atual`; regras de `lib/disponibilidadePaciente.ts`: sem sábado, até 17:40);
  - aviso quando há sessão fora da janela informada pela família.
- **Celular (atendentes):**
  - a semana vira **abas de dia** (Seg…Sex, Dom/Sáb só se houver algo), cada uma com lista vertical de horários;
  - painéis laterais ocupam a tela inteira;
  - alvos de toque com no mínimo 44px.

### 4.5 Painéis laterais (`Drawer`, nunca página nova)
- **Detalhe do agendamento:**
  - dados completos, série ("toda segunda desde 06/10, contínua") e convênio;
  - **Histórico** (eventos da sessão e da série, com `resumo`);
  - botões **"Excluir só esta sessão"** e **"Excluir desta em diante"**. Ambos pedem motivo obrigatório, mostram prévia ("serão excluídas 12 sessões, de 14/10 a 30/12") e confirmam com `useConfirmacao`.
- **Novo agendamento:**
  - **Paciente:** `SearchCombobox`, só ativos. Avisa sobre alta, suspensão e sessão fora da disponibilidade do paciente.
  - **Profissional.**
  - **Terapia:** só as da faixa.
  - **Terapia de exibição:** sugerida pela regra existente (`terapiaExibicaoIdPorRegraFixa` em `services/tita/mappings.ts`, extraída para `lib/grade/exibicao.ts` sem dependência do TiTa); pode ser alterada.
  - **Data:** `DatePicker`.
  - **Horário:** só os livres do dia.
  - **Sala:** vem da faixa e pode ser alterada.
  - **Repetição:** Não se repete · **Toda semana (padrão)** · A cada 2 semanas · Personalizado (a cada N semanas).
  - **Término:** **Sem término, contínuo (padrão)** · Em uma data (`DatePicker`) · Após N sessões.
  - **Prévia:** "Serão criadas 26 sessões até 31/03/2027 · 2 datas puladas: 15/11 (feriado), 20/12 (bloqueio)". Depois, **Confirmar**.
- **Novo bloqueio:** profissional, período (`DateRangePicker`), dia inteiro ou horário, dias da semana, tipo e motivo.
- **Importar do TiTa** (seção 3).
- **Registro de alterações** da página: todos os eventos, com filtros `DateRangePicker`, quem, ação, profissional e paciente. É a "lixeira auditável": mostra o que foi excluído, por quem e quando.

---

## 5. Inativação do profissional (Cadastro de Profissionais)

Em `ProfissionalDetalhe.tsx:124-141`, o `confirmar` simples + `gravarDireto({ativo})` vira um **modal "Inativar profissional"** com:
- **Data de saída:** `DatePicker`, padrão hoje.
- **Agendamentos a partir da saída:**
  - ◉ **Manter** (padrão): "aparecem na Grade como *profissional inativo — precisa de reposição*";
  - ○ **Excluir**: "as sessões a partir de dd/mm saem da agenda; o histórico registra a exclusão".
- **Contagem ao vivo:** "23 sessões futuras de 9 pacientes serão afetadas".
- **Texto fixo:** "Sessões anteriores a dd/mm nunca são apagadas".
- Motivo.

A gravação usa a RPC `profissional_inativar`. A disponibilidade vigente é encerrada automaticamente na véspera da saída, para não aparecer horário livre.

---

## 6. Capacidade no editor de disponibilidade

- Em `components/cadastros/profissionais/disponibilidade/EditorDisponibilidade.tsx` (`CartaoFaixa`), entra o campo **"Pacientes por horário"**: botões − / + de 1 a 10, padrão 1.
- `LinhaDoTempo`/`SemanaLeitura` mostram "×2" e "×3" quando a capacidade passa de 1.
- `totaisDaSemana` passa a calcular **vagas** (sessões × capacidade) além de sessões.
- `AbaHistorico` mostra a mudança de capacidade entre versões.
- **Indicadores → "Quantidade esperada de pacientes":** continua lendo a tabela antiga nesta entrega. Fica registrado como próximo passo apontá-la para a faixa e aposentar `cronograma_capacidade_profissional_dia`.

---

## 7. Etapas de execução

Cada etapa termina com `npm run build` limpo e **validação do usuário no localhost**. Merge só depois disso.

**Branch:** `feat/grade-cronograma`, criada a partir do HEAD atual (`feat/cadastro-profissionais-etapa-3`, que já contém `f3cfd04e`, o TiTa no masculino, ainda fora da main). Trabalho no diretório principal; nada de worktree.

| # | Etapa | Entrega |
|---|---|---|
| 0 | Documento | `docs/PLANO_GRADE_CRONOGRAMA.md` (este plano, versão para a equipe) |
| 1 | Banco | Migrations `20261008*`: tabelas 1.1–1.5, colunas de 1.6, RPCs 1.7, views, RLS, catálogo de permissões e carga de capacidade. Execução local no **PGlite** antes de entregar. O usuário aplica; **nunca `db push`**. Snippets com ordem levam trava `RAISE`. |
| 2 | Capacidade e leitura em massa | Seção 6, `vw_grade_faixas_vigentes` e o serviço de leitura em massa. Fallback 42P01/42703/PGRST205 se a migration ainda não foi aplicada (o localhost usa o banco de produção). |
| 3 | Motor | `lib/grade/motor.ts` + testes vitest |
| 4 | Página (leitura) | Rota, permissão no menu, Por Profissional × Semana, legenda, cartão-resumo, celular |
| 5 | Importar do TiTa | Prévia, aplicação e registro. Validação: contagens batem com `vw_grade_atendimentos` na janela. |
| 6 | Por Paciente, Hoje, Mês | Inclui o sombreamento da disponibilidade do paciente |
| 7 | Criar | Painel Novo agendamento, repetição, prévia de conflitos, `grade_estender_series` + pg_cron |
| 8 | Excluir e bloquear | Só esta / desta em diante, bloqueios, Registro de alterações |
| 9 | Inativação | Modal da seção 5 + RPC |
| 10 | Segurança e polimento | Revisão obrigatória: PGlite, teste REST com anon (deve negar tudo), Security Advisor, `/security-review`. Revisão de acessibilidade e celular. |

**Fora do escopo** (anotado para depois):
- qualquer escrita no TiTa;
- presença e falta (o Controle Terapêutico vai referenciar `grade_agendamentos.id`);
- "mover ou remarcar" sessão (por ora: excluir + criar);
- fluxo guiado de reposição (por ora: selo e filtro "precisa de reposição");
- apontar Indicadores para a capacidade da faixa;
- desligar `csv_grades_profissionais`.

---

## 8. Arquivos críticos

**Novos:**
- `supabase/migrations/20261008*_grade_*.sql`
- `frontend/app/(dashboard)/cronograma/grade/page.tsx`
- `frontend/components/cronograma/grade/*`: `GradeShell`, `ListaLateral`, `GradeSemana`, `GradeDia`, `GradeMes`, `CartaoSessao`, `PainelAgendamento`, `PainelNovoAgendamento`, `PainelBloqueio`, `PainelImportarTita`, `PainelRegistro`, `Legenda`
- `frontend/lib/grade/{motor,exibicao,repeticao}.ts` + `motor.test.ts`
- `frontend/services/grade.service.ts`, `frontend/hooks/useGrade.ts`, `frontend/types/grade.ts`
- `frontend/components/cadastros/profissionais/InativarProfissionalModal.tsx`

**Alterados:**
- `frontend/lib/permissions/{routes,menu}.ts`, `frontend/components/Sidebar.tsx`
- `frontend/components/cadastros/profissionais/ProfissionalDetalhe.tsx` (inativação)
- `frontend/components/cadastros/profissionais/disponibilidade/{EditorDisponibilidade,pecasDisponibilidade,AbaHistorico}.tsx`
- `frontend/lib/disponibilidadeProfissional.ts`, `frontend/types/disponibilidadeProfissional.ts`, `frontend/services/profissionalDisponibilidade.service.ts`

**Reutilizados** (sem mudança):
- `components/ui/pastel/*`, `components/cronograma/ui/{Drawer,SearchCombobox,MultiSearchCombobox,UnidadeSelector,SegmentedTabs}.tsx`
- `components/ui/date-picker.tsx`, `date-range-picker.tsx`
- `lib/cadastros/{tonsTerapia,terapias,iconesTerapia}`, `lib/grade/fonte.ts` (frescor), `services/feriados.service.ts`, `lib/dataHoraBrasilia.ts`

---

## 9. Verificação

1. **Banco:**
   - migrations executadas no PGlite sem erro;
   - triggers recusam excluir sessão passada e alterar evento;
   - RPC recusa capacidade estourada e paciente em dois lugares;
   - anon via REST recebe 401/vazio em todas as tabelas `grade_*`.
2. **Motor:** `npm test` verde (cenários da seção 2).
3. **Importação:**
   - numa janela de 2 semanas, os agendados importados = linhas `Agendado` de `vw_grade_atendimentos`, menos as pendências de cadastro listadas;
   - reimportar não duplica;
   - sessão excluída no Pulsar não volta.
4. **Fluxos no localhost** (dev server servindo código novo: conferir o chunk em `.next/dev`):
   - criar série contínua e ver as sessões na semana e no mês;
   - excluir só uma e ver o buraco e o evento no Registro;
   - excluir desta em diante e ver a série encerrada;
   - criar bloqueio e ver o horário listrado;
   - inativar um profissional de teste nas duas opções e conferir que as sessões antes da saída ficam intactas.
5. **Capacidade:** profissional com faixa ×3 mostra "1 de 3 livres" e recusa o 4º paciente.
6. **Celular:** DevTools a 375px; abas de dia; painel em tela cheia.
7. **Garantia de que o TiTa não é tocado:** `grep` em `components/cronograma/grade`, `lib/grade` e `services/grade.service.ts` não encontra `services/tita` nem `apptita`.
8. `npm run build` e `npm run lint` limpos (o ESLint barra date nativo e multi-seleção artesanal).
