# Proteção de dados — agenda, cadastros e cópias do TiTa

> Etapa 3 do plano de independência do TiTa (16/10/2026).
> Agenda, terapia e paciente juntos são **dado de saúde**, dado sensível na LGPD.
> Este documento mostra o que foi **verificado**, o que foi **corrigido** e o que **falta**.
> **Não é** uma declaração de conformidade com a LGPD.

## 1. Como verificar (repetir a cada mudança grande)

| O quê | Como | Quando |
|---|---|---|
| Invasor externo (chave anon) | `cd frontend && node scripts/seguranca-varredura-completa.mjs` | depois de aplicar migrations |
| Invasor interno (logado sem permissão) | mesmo script com `TOKEN_SEM_PERMISSAO=eyJ…` (token de um usuário sem nenhuma permissão de cadastro/agenda) | depois de aplicar migrations |
| Estado real do banco | `docs/seguranca/AUDITORIA_SEGURANCA.sql`, bloco a bloco no SQL Editor (só leitura) | mensal, e antes do corte do TiTa |
| Migration nova | CI: `scripts/check-rls.js` + `scripts/check-seguranca-migrations.js` | em todo PR |
| Lógica das RPCs | testes PGlite em `supabase/tests/*.pglite.mjs` | em toda migration nova |
| Security Advisor | painel do Supabase → Advisors → Security | mensal |

**Regra para toda migration nova** (a CI cobra a partir de `20261016000000`):
- RLS ligada; leitura por `usuario_tem_permissao('<código>')`; **sem** policy de escrita: a escrita passa só por RPC `security definer set search_path = ''`, que confere a permissão logo no começo.
- `revoke all ... from public, anon` em toda tabela, view e função; `grant` só o necessário para `authenticated`.
- Views com `security_invoker = true`.
- Nada de `using (true)`.
- Trilhas (eventos, logs) sem UPDATE nem DELETE.
- CPF, carteirinha e telefone nunca vão inteiros para log.
- Exceção consciente: comentário `-- seguranca: <motivo>` na linha.

## 2. O que foi medido em produção (16/10/2026)

**Varredura externa com a chave anon** (a que está no JavaScript do site):

| Verificação | Resultado |
|---|---|
| OpenAPI anônima | **fechada** (HTTP 401): o anon não enxerga o catálogo |
| Leitura de 237 tabelas e views (todas as criadas nas migrations) | **nenhuma linha lida**: a RLS segura tudo |
| GraphQL | não expõe tabelas ao anon |
| GRANT ao anon | **58 tabelas** ainda tinham permissão (barradas só pela RLS). Corrigido na migration `20261016120000` |
| Edge Functions de teste | `tita-compare-endpoints` e `test_env` **publicadas** (OPTIONS → 200). Ver pendência P0 |

**Ainda não medido** (precisa de você): o invasor interno (passo 1 com `TOKEN_SEM_PERMISSAO`) e o SQL de auditoria em produção.

## 3. Correções feitas nesta etapa

| # | Correção | Onde |
|---|---|---|
| C1 | Anon perde todo GRANT em tabelas, views e sequências (`public` e `central`); tabela nova não nasce aberta ao anon | migration `20261016120000_seguranca_revoga_anon_tabelas.sql` + teste PGlite |
| C2 | Log da importação de pacientes guardava CPF do paciente, CPF do responsável e carteirinha inteiros, para sempre. Agora um gatilho mascara (`***.456.789-**`, `••••1234`), e o histórico já gravado foi mascarado | migration `20261016110000_seguranca_log_pacientes_mascarado.sql` + teste PGlite |
| C3 | `/api/tita/confirmar-agendamento` (grava no TiTa) só exigia login. Agora exige usuário ativo e a permissão da tela que a chama (`cronograma_ocupacao_paciente`) | `frontend/app/api/tita/confirmar-agendamento/route.ts` |
| C4 | Logs novos das importações (`tita_importacoes`, `grade_importacoes_itens`) nascem com CPF mascarado, leitura só por permissão e escrita só por RPC | migrations `20261015190000` e `20261016100000` |
| C5 | Segunda checagem de CI para migrations: grant ao anon, `security definer` sem `search_path`, view sem `security_invoker`, `using (true)`, função sem `revoke from public` | `scripts/check-seguranca-migrations.js` + `.github/workflows/check-rls.yml` |
| C6 | Varredura externa geral e SQL de auditoria só de leitura | `frontend/scripts/seguranca-varredura-completa.mjs`, `docs/seguranca/AUDITORIA_SEGURANCA.sql` |
| C7 | Funções que o anon executava sem precisar: `fn_sync_*` (disparavam o sync do TiTa) só para a rotina interna; `guias_avulsas` e consultas da Central/Auditoria ASSIM/home só para logado. Ficam com o anon, de propósito, `robo_*` (token do robô) e `email_por_username` (tela de login) | migration `20261016130000_seguranca_funcoes_views_usuarios.sql` + teste PGlite |
| C8 | O que só existia em produção por snippet manual agora está em migration, sem recriar definições: `security_invoker` em `vw_central_terapeutica` e `vw_profissionais_disponiveis`, RLS em `usuarios`. Um banco reconstruído não nasce mais aberto | mesma migration |
| C9 | Log da importação de pacientes legível só com `cadastros_pacientes` (era qualquer login) | migration `20261016110000` |

## 4. Pendências (por gravidade)

| # | Risco | Quem age | Correção proposta |
|---|---|---|---|
| P0 | **URGENTE — Edge Function `tita-compare-endpoints` está publicada** (sondado em 16/10/2026 com OPTIONS: HTTP 200). Pelo código, ela consulta o TiTa e devolve agendas com nomes de pacientes a quem tiver a chave anon, que é pública. `test_env` também está no ar. As `cco-*-test*` não foram sondadas (escrevem no banco ao serem chamadas) | você | `supabase functions delete tita-compare-endpoints`, `test_env`, `cco-test-setup`, `cco-conciliation-engine-test`; depois rodar a varredura com `SONDAR_FUNCOES=1` |
| P1 | **Chave `service_role` exposta no histórico do GitHub.** Quem a tiver lê e escreve tudo, passando por cima da RLS | você (Vault + Coolify + Edge Functions) | Rotacionar a chave no Supabase, atualizar Coolify, Vault (`cron_service_role_key`) e secrets das Edge Functions no mesmo dia |
| P1b | **Qualquer login lê o cadastro inteiro de pacientes** (CPF, endereço, responsável): policy `pacientes_select` com `using (true)` (`20260817190000_pacientes_canonica.sql:307`). É o maior risco de invasor interno | próximo esforço, com cuidado | Vários módulos leem `pacientes` direto do navegador. Mapear quem lê, servir o necessário por RPC/visão enxuta (nome e id) e restringir a tabela a `cadastros_pacientes`. Não foi feito agora porque quebraria telas sem esse mapeamento |
| P2 | **Evolução clínica (`csv_grades_profissionais.descricao_evolucao`) legível por qualquer login** (policy de leitura ampla). A tela de Auditoria de Evoluções lê a coluna direto do navegador | decisão sua (tema Evoluções, adiado) | Tirar a coluna do GRANT de `authenticated` e servir a tela por RPC com permissão `auditoria-evolucoes`. Mexe na tela de auditoria, por isso não foi feito agora |
| P4 | `/api/laudos` exige login, mas não permissão: qualquer login lê o relatório de laudos (dado de saúde de criança) | próximo esforço | Separar quem precisa dos laudos de quem só usa a grade (o layout do Cronograma carrega a rota); depois exigir permissão |
| P5 | `central.worker_tick_config` criada sem RLS (CI `check-rls.js` acusa) | próximo esforço | `alter table central.worker_tick_config enable row level security` (só service_role usa) |
| P6 | Cópias do TiTa legíveis por qualquer login: `agenda_tita` (CPF, nascimento, carteirinha, contato do responsável), `grade_profissionais_tita` (CPF e telefone de profissional), `csv_grades_profissionais` (agenda com nome de paciente e evolução) | Etapa 4 / corte | Ao repontar os módulos para a agenda do Pulsar, fechar a leitura por permissão; no corte, elas viram arquivo morto (ou são apagadas depois do prazo de guarda) |
| P6b | `controle_terapeutico`: qualquer login pode INSERIR (`with check (true)`, `20260518140500`). Risco de integridade, não de leitura | próximo esforço | Remover a policy `controle_terapeutico_insert_authenticated` depois de conferir que só a Edge Function (service_role) grava |
| P6c | Assinaturas de profissional ficam no mesmo bucket das fotos de paciente, e quem tem `cadastros_profissionais` lê todas | próximo esforço | Bucket próprio para assinatura, leitura só pela própria pessoa e por quem emite documento |
| P7 | Admin e diretoria sem segundo fator | você | Ligar MFA (TOTP) no Supabase Auth para esses papéis |
| P8 | Usuário com permissão pode extrair a lista inteira (sem limite nem trilha de exportação) | próximo esforço | Limite de linhas por chamada nas RPCs de lista e trilha de exportação em massa |
| P9 | Saída de colaborador | rotina | Ao desligar alguém: `usuarios.ativo = false` no mesmo dia (`usuario_tem_permissao` já recusa inativo); conferir o bloco 11 do SQL de auditoria todo mês |

## 5. Matriz de acesso (estado pelas migrations, 16/10/2026)

**Confirme em produção** com o bloco 4 do SQL de auditoria: produção recebeu ajustes à mão (snippets de 17/08) que as migrations não tinham até a `20261016130000`.

| Tabela / view | Quem lê (authenticated) | Anon | Escrita |
|---|---|---|---|
| `pacientes` | **qualquer login** (`using (true)`) — P1b | sem acesso depois da C1 | `cadastros_pacientes` / papéis |
| `pacientes_importacoes_log` | `cadastros_pacientes` (C9) | sem acesso | só RPC |
| `pacientes_disponibilidade_versoes` | `cadastros_pacientes` | sem acesso | só RPC |
| `profissionais`, `profissionais_terapias_habilitadas` | `cadastros_profissionais` | sem acesso | `cadastros_profissionais` |
| `profissionais_disponibilidade_*` | `cadastros_profissionais` | sem acesso | só RPC |
| `grade_*` (agenda do Pulsar) | `cronograma_grade` | sem acesso | só RPC |
| `tita_importacoes(_itens)` | `cadastros_profissionais` | sem acesso | só RPC |
| `grade_importacoes_itens` | `cronograma_grade` | sem acesso | só RPC |
| `sistema_tita_corte` | ninguém direto (só `tita_cortado_em()`) | sem acesso | só o SQL de corte |
| `cadastros_auditoria` | por entidade (12 permissões), FORCE RLS | sem acesso | insert por permissão |
| `csv_grades_profissionais` | **qualquer login** — P6 | sem acesso depois da C1 | service_role (sync) |
| `agenda_tita` | **qualquer login** — P6 | sem acesso depois da C1 | service_role (sync) |
| `grade_profissionais_tita` | **qualquer login** — P6 | sem acesso depois da C1 | service_role (sync) |
| `controle_terapeutico` | papéis terapêutico/terapeuta/admin/diretoria/faturamento | sem acesso depois da C1 | **qualquer login insere** — P6b |
| `vw_grade_*`, `central.vw_vagas_livres` | herdam a tabela (security_invoker) | sem acesso | — |
| `vw_central_terapeutica`, `vw_profissionais_disponiveis` | herdam a tabela (security_invoker, C8) | sem acesso | — |
| `usuarios` | policies do snippet fase 3 (produção) | sem acesso | trava de autopromoção |

**Storage:** `pacientes-fotos` privado (fotos de paciente e, na pasta `profissionais/`, foto e assinatura de profissional — P6c); `central-anexos` e `central-avatares` privados (só service_role); `tv-avisos` público de propósito (cartaz, sem dado de paciente).

**Edge Functions:** `config.toml` não define `verify_jwt`, então vale o padrão (exige JWT), mas a chave anon é um JWT válido. As funções de teste (`tita-compare-endpoints` devolve agendas e nomes de pacientes do TiTa; `cco-test-setup` escreve e apaga com service_role) precisam sair do ar — P0.
