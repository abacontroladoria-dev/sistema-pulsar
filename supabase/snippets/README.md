# snippets

SQL aplicado **à mão** no SQL Editor do Supabase, guardado aqui como registro do
que de fato entrou em produção e quando.

Estes arquivos **não são migrations** e não devem ser movidos para
`supabase/migrations/`. Cada um é um empacotamento de migrations que já existem
lá, montado para ser colado no SQL Editor de uma vez. Duplicá-los como migration
faria o mesmo DDL aparecer duas vezes no livro-caixa.

## Por que existe

`supabase db push` não seleciona arquivo: aplica todo o conjunto pendente. Neste
repositório o pendente inclui coisas que ninguém quer aplicar agora, e a
numeração fora de ordem ainda faz o CLI exigir `--include-all`, que é exatamente
"aplique tudo". Por isso o caminho para produção tem sido: colar no SQL Editor e
registrar no livro-caixa.

Todo arquivo aqui segue três regras:

- envolvido em `begin; … commit;` — é tudo ou nada, erro não deixa meio estado;
- termina inserindo em `supabase_migrations.schema_migrations` com
  `on conflict (version) do nothing`, para o CLI saber que a versão já entrou;
- é reexecutável (`add column if not exists`, `drop … if exists`,
  `create or replace`), então rodar duas vezes não quebra.

## O bloco CRM (`20260701020000`…`020400`) ESTÁ em produção

Até 2026-09-10 este README e o cabeçalho de `20260811_central_base_producao.sql`
registravam o bloco CRM como "decisão de não aplicar". **Está errado.** O
diagnóstico `crm_diagnostico_pre_exposicao.sql`, rodado em produção em
2026-09-10, mostrou o schema inteiro no ar:

| Seção | Medido em produção |
|---|---|
| 1 — grants | 6/6 tabelas com `DELETE, INSERT, SELECT, UPDATE` em `authenticated` |
| 2 — RLS | 6/6 com `rls_ativo = true` e 4 policies cada |
| 3 — volume | `pipeline_stages`=6, `teams`=3, `team_functions`=5; `deals`=0 |
| 4 — estágios | 6 estágios, `position` 0–5, org única `a0000000-…-0001` (Universo ABA), `auto_win`/`auto_lose` só nos dois `is_system` |

Duas consequências práticas:

- **Os grants não precisam de conserto.** A suposição de que o `alter default
  privileges` de `20260701020000` não teria alcançado as tabelas (o motivo pelo
  qual o schema `central` fez o grant explícito, comentário C-1) **não se
  aplica a este banco**: aqui o role que criou as tabelas foi o mesmo que rodou
  o ALTER, e a herança funcionou. Foi por isso que a migration
  `20260909150000_crm_grants_explicitos.sql` acabou sendo um no-op e não entrou.
- **O que falta para o CRM funcionar não é SQL**, é expor o schema `crm` na
  lista de schemas do PostgREST. Sem isso toda chamada devolve `PGRST106` /
  HTTP 406 (`Only the following schemas are exposed: public, graphql_public,
  central`). Com RLS fechado nas 6 tabelas, expor é seguro.

### O livro-caixa tinha só 2 das 5 versões

Conferido em 2026-09-10: `supabase_migrations.schema_migrations` continha apenas
`20260701020000` (crm_schema) e `20260701020400` (crm_seed). As três do meio
entraram no banco **sem** o INSERT correspondente:

| Versão | Nome | No banco | No livro-caixa |
|---|---|---|---|
| `20260701020000` | crm_schema | sim | sim |
| `20260701020100` | crm_tables | 6 tabelas | **ausente** |
| `20260701020200` | crm_indexes | 11 índices | **ausente** |
| `20260701020300` | crm_rls | 24 policies | **ausente** |
| `20260701020400` | crm_seed | 6 estágios | sim |

**Corrigido em 2026-09-10** por `20260910_registrar_bloco_crm_no_livro_caixa.sql`,
que só insere as três versões — não reaplica DDL. As três são reexecutáveis
(`create table / index if not exists`, e todo `create trigger`/`create policy`
precedido de `drop … if exists`), então o risco nunca foi a reaplicação delas em
si: era o resto do pendente que um `db push` levaria de carona.

Conferência depois de aplicar: as 5 versões presentes, e o banco batendo com o
que o livro-caixa passou a afirmar — `tabelas=6 · policies=24 ·
rls_desligado=0 · estagios=6`. Com `rls_desligado = 0` nas 6 tabelas, expor o
schema no PostgREST não abre dado.

`deals = 0` é esperado nesta fase, não bug: `central.contacts` tem 3 linhas,
todas `contact_type = 'other'` (zero leads), então o trigger
`crm.auto_create_deal_on_lead()` nunca teve o que disparar. Board vazio ≠ erro.

## O que já foi aplicado

| Arquivo | Conteúdo | Produção |
|---|---|---|
| `20260811_central_base_producao.sql` | 14 migrations do schema `central` — filas com lease, idempotência, FK `restrict`, grants por coluna, appointments, views | 2026-08-11 |
| `20260811_central_ai_mode_producao.sql` | `20260811100000` — troca `ai_model_mode`/`auto_response_enabled` por `ai_mode` + `ai_scheduling_enabled` | 2026-08-11 |
| `20260813_robo_seguranca_producao.sql` | `20260813100000/100100/100200` — token por máquina, `robo_config`, `robo_pacotes` e as 7 RPCs `robo_*` que tiram a service_role do PC da recepcionista | pendente |
| `20260820_tokens_mensal_inclui_erro_facial_remoto.sql` | `20260820100000` — `get_tokens_mensal` passa a incluir as sessões validadas como "Erro no Reconhecimento Facial", não só as com filipeta | pendente |
| `20260820_erro_do_robo_nao_e_glosa_remoto.sql` | `20260820170000` — `status='erro'`/`'cancelado'` da fila deixam de virar "Glosa" e passam a `SOLICITACAO_CANCELADA`, contada em "Não Solicitadas". Precisa do deploy do frontend junto | pendente |
| `20260828_forma_guia_vinculada_e_conferencia_filipetas_remoto.sql` | `20260827000004` (`get_auditoria_assim_periodo` — a 000003 sozinha não bastou; esta corrige o COALESCE de `forma_autorizacao` para dar prioridade ao vínculo) e `20260828170000` (`get_tokens_mensal` passa a excluir bloco com reclassificação ativa). 000000/000001/000002/000003 já estavam aplicadas | 2026-08-28 |
| `20260828_tokens_mensal_segue_a_guia_vinculada_remoto.sql` | `20260828180000` — `get_tokens_mensal` ganha semente/LATERAL de vínculo: sessão coberta por vínculo (GLOSA_RESOLVIDA) passa a aparecer na Conferência de Filipetas com guia/token/forma da guia VINCULADA, não da glosada. Corrige o caso Kourtney, que a 20260828170000 sozinha não alcançava | pendente |
| `20260828_detalhamento_mostra_reclassificacao_remoto.sql` | `20260828190000` — `get_auditoria_assim_periodo`/`get_auditoria_assim` passam a devolver os metadados crus da reclassificação ativa (situação anterior, justificativa, quem, quando); o detalhamento ganha seção própria "Reclassificação manual", visível mesmo quando a situação atual já não é mais glosa | pendente |
| `20260902_sync_tita_grade_horizonte_diario.sql` | `20260902100000` — o sync de horizonte completo da `grade_profissionais_tita` deixa de rodar só na segunda (`35 6 * * 1`) e passa a rodar todo dia às 06:20, junto do backfill imediato. Sem isso, do dia 1º até a primeira segunda de todo mês o mês seguinte fica inimplantável em Ocupação de Paciente | cron aplicado 2026-09-02; backfill rodado |
| `20260902_inclusao_terapia_depara_conferido.sql` | `20260902130000` — o de-para do card de inclusão de terapia, com `list_id` (901112985991) e os UUIDs cruzados com os dados reais da grade. 12 blocos: `unidade_por_sala` (a Unidade vem do PREFIXO de `sala_nome`, porque `unidade_nome` tem valor único), `convenios_sem_campo` (deixa o campo vazio em "Ainda não selecionado"/"Administrativo" sem travar a linha), `especialidade` multivalorada e `salas_sem_card`. Exige a migration `20260902120000` e o deploy da Edge Function `inclusao-terapia-clickup` com o código que lê essas chaves | aplicado 2026-09-02; `ativo=true` desde 02/09 18:34; 1º card real 03/09 14:57 |
| `20260903_APLICAR_orfas_nao_excluem_avulsa.sql` | `20260903100000` — `get_guias_orfas` para de excluir a guia de uma AVULSA: o `not exists` contra `fila_autorizacoes` passa a ignorar as linhas `avulsa = true`. Avulsa não representa sessão, logo a guia dela não está reconciliada e continua órfã — e vinculável a uma glosa. Sem isso a guia que mais precisa de triagem era a única que nunca chegava à fila, rotulada "Outra semana" sem botão de vincular (caso Miguel França De Castro, guias 26905 e 59323). Só banco: nada a deployar no frontend | aplicado 2026-09-03; contraprova: 125 guias de sessão conferidas, 0 na fila |
| `20260904_APLICAR_vagas_livres_por_unidade.sql` | `20260904100000` (`central.vw_vagas_livres` — as sessões livres com a unidade física DERIVADA do prefixo de `sala_nome`, e sem as salas que não são endereço da clínica), `20260904100100` (`listar_vagas_disponiveis` troca `p_unidade_id bigint` — que nunca filtrou nada, porque `unidade_id` é 280 em toda a grade — por `p_unidade text` que filtra NO BANCO e LANÇA 22023 em valor desconhecido) e `20260904100200` (`contar_vagas_por_terapia_e_unidade` — o resumo por especialidade passa a ser `group by` em vez de contagem sobre 500 linhas de amostra). ⚠ **DROPA e recria** `listar_vagas_disponiveis`: aplicar JUNTO do deploy do frontend, senão a tela de Agendamentos e o agente tomam PGRST202. Rodar `20260904_diagnostico_reservas_em_sala_nao_fisica.sql` ANTES e `20260904_contraprova_vagas_livres_por_unidade.sql` DEPOIS | pendente |
| `20260909_APLICAR_descricao_da_evolucao.sql` | `20260909160000` — a API `csv_grade_profissionais` passou a devolver uma 43ª coluna, "Descrição da Evolução" (o texto que o profissional escreve depois de atender), e o sync a descartava em silêncio: o parser procura coluna por NOME e o que não está na lista não é lido. Três blocos, todos obrigatórios: a coluna `descricao_evolucao`; `'descricao_evolucao'` em `v_mutaveis` do `trg_congelar_grade_passada`; e a coluna no `SET`/`jsonb_to_recordset` de `fn_aplicar_execucao_grade`. ⚠ **O bloco do trigger não é opcional** — a evolução chega em sessão de data PASSADA, que é exatamente o que o congelamento recusa; sem ele falha em 100% dos casos reais. ⚠ **Aplicar ANTES** de `supabase functions deploy sync-grade-csv`: se a function subir primeiro, o modo "execucao" manda o campo para uma RPC que ainda não tem o parâmetro. De propósito **não** projeta em `vw_grade_base` (texto clínico, view legível por qualquer `authenticated`) e **não** faz backfill — a janela de 45 dias do modo "execucao" preenche o recente e tudo daqui em diante; sessão anterior fica NULL | pendente |
| `20260908_APLICAR_falta_em_lote.sql` | `20260908100000` (colunas `motivo_falta` — lista fechada com CHECK — e `falta_lote_id` na `fila_autorizacoes`), `20260908100100` (`registrar_falta_em_lote` e `reverter_falta_em_lote`, ambas SECURITY DEFINER) e `20260908100200` (índice + `contar_faltas_do_paciente`). Introduz `tipo_falta = 'unidade'`: feriado/ponto facultativo/falta de energia deixam de ser lançados como falta DO PACIENTE e saem da assiduidade e da fila de reposição, mantendo `status = 'falta'` — um status novo vazaria por seis leituras que decidem por exclusão (`presencaReal.ts` pagaria a sessão, `sync_assim_results` a sobrescreveria com `glosa`). Dá à recepção o lançamento de falta do dia inteiro em feriado/ponto facultativo/falta de energia, que hoje custa abrir ~300 cards um a um. Pode entrar ANTES do frontend: só adiciona coluna nullable e cria função nova, nenhum `CREATE OR REPLACE` em objeto existente, logo sem janela de PGRST202. ⚠ Como é DEFINER, a função REPLICA no corpo o isolamento por unidade que `listar_central_autorizacoes` faz na leitura — sem esse bloco uma recepcionista fecharia o dia de outra unidade. Rodar `20260908_contraprova_falta_em_lote.sql` DEPOIS, com JWT de recepcionista (service_role desliga o filtro de unidade dos dois lados e o teste central passa sem testar) | aplicado 2026-09-08; conferência OK (colunas nullable, `search_path=public` nas duas funções, `anon` sem execute). Frontend ainda NÃO deployado — sem ele o banco tem as funções e ninguém as chama |
| `20260910_registrar_bloco_crm_no_livro_caixa.sql` | Só livro-caixa: insere `20260701020100` (crm_tables), `20260701020200` (crm_indexes) e `20260701020300` (crm_rls) em `supabase_migrations.schema_migrations`. Não reaplica DDL — os objetos das três já estão em produção (medido em 2026-09-10: 6 tabelas, 11 índices, 24 policies), só o INSERT ficou para trás. Sem o registro, `db push` as considera pendentes e o push empurra o pendente INTEIRO | aplicado 2026-09-10; conferencia OK: 5 versoes no livro-caixa, e o banco bate — tabelas=6, policies=24, rls_desligado=0, estagios=6 |

O segundo arquivo existe porque ficou de fora do primeiro. A consequência era
concreta: o repositório lê `ai_mode` e `ai_scheduling_enabled`, essas colunas não
existiam, o PostgREST devolvia 42703 e as abas Agente e API das Configurações
mostravam um "Internal server error" genérico.

## Runbooks

Nem tudo aqui é pacote de migration. `robo_provisionar.sql` é um **receituário**:
blocos independentes, rodados sozinhos conforme a situação — cadastrar um PC novo,
revogar uma máquina, trocar a senha da ASSIM, liberar uma versão do robô. Os blocos
que recebem segredo estão comentados e com lacunas `<...>`; preencha no SQL Editor
e **não salve o arquivo preenchido**.

## Antes de aplicar qualquer coisa daqui

O repositório é **público**. Nenhum arquivo desta pasta pode conter chave, token
ou senha — só DDL. Confira antes de adicionar.
