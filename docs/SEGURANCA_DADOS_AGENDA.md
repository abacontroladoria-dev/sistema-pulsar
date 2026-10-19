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

### 3b. Branch `feat/seguranca-falhas-dados` (19/10/2026)

Antes de aplicar qualquer migration desta branch: `supabase/snippets/20261019_seguranca_prechecagem_SO_LEITURA.sql`, bloco a bloco (só leitura).

| # | Correção | Onde | Estado |
|---|---|---|---|
| C10 | Edge Functions de teste apagadas do repositório; a varredura acusa vazamento enquanto alguma responder ≠ 404 | `supabase/functions/*` + `seguranca-varredura-completa.mjs` | falta `supabase functions delete` (você) |
| C11 | `central.worker_tick_config` com RLS e sem permissão para login (dava para trocar a URL do disparo e capturar o segredo do worker) | migration `20261019140000_seguranca_correcoes_diretas.sql` + teste PGlite | migration com trava, aplicar depois do redeploy |
| C12 | `controle_terapeutico`: some a policy `with check (true)`; fica a inserção por papel | mesma migration | idem |
| C13 | Cópias do TiTa com **leitura por coluna**: o login não lê CPF, telefone, CBO, registro, `raw_json` nem observação da sala (`grade_profissionais_tita`) e não lê `profissional_cpf`/`sala_observacoes` (`csv_grades_profissionais`). `vw_profissionais_disponiveis` recriada sem essas colunas. Guarda: a migration para se alguma view de produção ler coluna revogada | mesma migration; frontend com listas explícitas (`mappings.ts`, `controle-terapeutico.service.ts`) | idem |
| C14 | CI: coluna nova em tabela com leitura por coluna exige `grant select (coluna)` no mesmo arquivo | `scripts/check-seguranca-migrations.js` (regra 6) | ativo |
| C15 | Porta única para rotas `/api` com permissão de tela: `exigirPermissao(códigos)` (usuário ativo + uma das permissões; 401/403) | `frontend/lib/permissions/exigirPermissao.ts` | no código |
| C16 | `/api/laudos` (dado de saúde de criança) exige permissão de tela que usa laudo; o layout do Cronograma deixou de buscar laudos em Indicadores, Reposição e Ocupação de Salas. `/api/tita/situacao-favorecidos` exige Ocupação Paciente ou Indicadores → Pacientes/Previsão. `/api/pdi-controle-prazos` exige Prazos PDI ou Painel do Analista | as três rotas + `CronogramaDataLayout.tsx` | no código |
| C17 | Rotas da Central/Connect (`/api/central/*`, `/api/crm/*`, via `extractUser`) exigem também usuário ativo e a permissão `connect` — antes bastava o papel da Central, e o caminho pelo JWT nem olhava `ativo` | `frontend/lib/central/auth.ts` | no código; pré-checagem 3.1 |
| C19 | Texto da evolução clínica (`csv_grades_profissionais.descricao_evolucao`) fora da leitura do login. A Auditoria de Evoluções passa a ler pela rota `/api/terapeutico/auditoria-evolucoes/grade` (cliente de serviço, depois da permissão da tela; mesmos filtros e paginação, a tela não mudou); a Grade continua por `grade_detalhe_evolucao()` | migration `20261019150000_seguranca_evolucao_coluna.sql` + teste PGlite; `lib/auditoria/gradeAuditoria.ts` | migration com trava, aplicar depois do redeploy e da `20261019140000` |
| C20 | Cadastro de pacientes só para quem tem `cadastros_pacientes` (e os papéis admin/diretoria/cronograma). As 5 telas que liam a tabela sem a permissão passam a caminhos estreitos: Grade, Ocupação Paciente, Alimentar BD → `pacientes_lista_basica` (id, id TiTa, nome, convênio, situação, foto); robô PEP → `pacientes_buscar_para_pep` (4 últimos dígitos do CPF) + vínculo por id; Connect → ficha lida no servidor com o cliente de serviço. `listar_pacientes_assim` (Autorizações Avulsas) vira invólucro com checagem, sem reescrever o corpo de produção | migrations `20261019160000_seguranca_pacientes_rpcs.sql` (sem trava, só cria funções) e `20261019160100_seguranca_pacientes_leitura_restrita.sql` (trava) + teste PGlite; `services/pacientesBasico.service.ts` | 160000 a qualquer momento; 160100 depois do redeploy e da pré-checagem 5.x |
| C18 | Edge Function `controle-terapeutico-upsert` exige `escala_terapeutica` (Central de Terapeutas) ou o papel `disponibilidade_terapeuta`; a rota morta `/api/controle-terapeutico/upsert` (repassava a chave de serviço) foi apagada | `supabase/functions/controle-terapeutico-upsert` | falta publicar a função (você); pré-checagem 3.2 |

| C21 | Segundo fator (app autenticador, TOTP): tela **Segurança da conta** (`/conta/seguranca`, menu do usuário) para cadastrar com QR e código; o login pede o código de 6 dígitos de quem cadastrou; o `proxy.ts` não deixa a sessão sem o código passar da Segurança da conta (quem tem o app sempre; admin/diretoria a partir da data). Aviso nos 7 dias antes da data | `lib/auth/segundoFator.ts` (+ teste), `components/conta/*`, `app/login/page.tsx`, `proxy.ts` | falta ligar no Supabase e definir a data |

**Segundo fator — o que você faz:**
1. Supabase → Authentication → Sign In / Providers → **Multi-Factor Authentication** → ligar **TOTP (App Authenticator)**.
2. Testar: entrar, menu do usuário → Segurança da conta → Cadastrar app autenticador → sair e entrar de novo (o login pede o código).
3. Coolify: `NEXT_PUBLIC_MFA_OBRIGATORIO_DESDE=AAAA-MM-DD` (data em que admin e diretoria passam a ser obrigados) → **rebuild** (variável `NEXT_PUBLIC_` entra no build). Sem a variável, ninguém é obrigado. Nos 7 dias antes, admin/diretoria sem o app veem a faixa de aviso.
4. **Plano B — perdeu o celular:** Supabase → Authentication → Users → a pessoa → seção *Multi-Factor Authentication* → apagar o fator. Ela entra só com a senha e cadastra de novo na Segurança da conta. Antes de apagar, confirme por outro canal que é a própria pessoa pedindo.

**Leitura por coluna — cuidado em toda migration futura:** em `grade_profissionais_tita` e `csv_grades_profissionais` o login lê só as colunas concedidas uma a uma. Coluna nova não fica legível sozinha (precisa de `grant select (nova) … to authenticated`), e `select('*')` do frontend nessas tabelas dá "permission denied".

## 4. Pendências (por gravidade)

| # | Risco | Quem age | Correção proposta |
|---|---|---|---|
| P0 | **URGENTE — Edge Function `tita-compare-endpoints` está publicada** (sondado em 16/10/2026 com OPTIONS: HTTP 200). Pelo código, ela consulta o TiTa e devolve agendas com nomes de pacientes a quem tiver a chave anon, que é pública. `test_env` também está no ar. As `cco-*-test*` não foram sondadas (escrevem no banco ao serem chamadas). **19/10: código das 4 apagado do repositório** (branch `feat/seguranca-falhas-dados`); a varredura passa a acusar VAZAMENTO enquanto qualquer uma responder diferente de 404 | você | `supabase functions delete tita-compare-endpoints`, `test_env`, `cco-test-setup`, `cco-conciliation-engine-test`; depois rodar a varredura com `SONDAR_FUNCOES=1` |
| P1 | **Chave `service_role` exposta no histórico do GitHub.** Quem a tiver lê e escreve tudo, passando por cima da RLS | você (Vault + Coolify + Edge Functions) | Roteiro passo a passo: `docs/seguranca/ROTACAO_SERVICE_ROLE.md`. Num dia combinado, depois das Fases 1–7 estáveis |
| P1b | **Qualquer login lê o cadastro inteiro de pacientes** (CPF, endereço, responsável): policy `pacientes_select` com `using (true)` (`20260817190000_pacientes_canonica.sql:307`). É o maior risco de invasor interno | você aplica | C20 (migrations `20261019160000` + `20261019160100`) |
| P2 | **Evolução clínica (`csv_grades_profissionais.descricao_evolucao`) legível por qualquer login** (policy de leitura ampla). A tela de Auditoria de Evoluções lia a coluna direto do navegador | você aplica | C19 (migration `20261019150000`) |
| P4 | `/api/laudos` exige login, mas não permissão: qualquer login lê o relatório de laudos (dado de saúde de criança) | redeploy | C16 |
| P5 | `central.worker_tick_config` criada sem RLS e com permissão total para qualquer login (CI `check-rls.js` acusa) | você aplica | C11 (migration `20261019140000`) |
| P6 | Cópias do TiTa legíveis por qualquer login: `agenda_tita` (CPF, nascimento, carteirinha, contato do responsável), `grade_profissionais_tita` (CPF e telefone de profissional), `csv_grades_profissionais` (agenda com nome de paciente e evolução) | Etapa 4 / corte | Ao repontar os módulos para a agenda do Pulsar, fechar a leitura por permissão; no corte, elas viram arquivo morto (ou são apagadas depois do prazo de guarda) |
| P6b | `controle_terapeutico`: qualquer login pode INSERIR (`with check (true)`, `20260518140500`). Risco de integridade, não de leitura | você aplica | C12 (migration `20261019140000`) |
| P6c | Assinaturas de profissional ficam no mesmo bucket das fotos de paciente, e quem tem `cadastros_profissionais` lê todas | próximo esforço | Bucket próprio para assinatura, leitura só pela própria pessoa e por quem emite documento |
| P7 | Admin e diretoria sem segundo fator | você | C21: ligar o TOTP no Supabase e definir a data em `NEXT_PUBLIC_MFA_OBRIGATORIO_DESDE` (ver abaixo) |
| P8 | Usuário com permissão pode extrair a lista inteira (sem limite nem trilha de exportação) | próximo esforço | Limite de linhas por chamada nas RPCs de lista e trilha de exportação em massa |
| P8b | `/api/tita/situacao-favorecidos` devolve nome, situação e convênio de todos os pacientes do TiTa a qualquer login | redeploy | C16 |
| P9 | Saída de colaborador | rotina | Ao desligar alguém: `usuarios.ativo = false` no mesmo dia (`usuario_tem_permissao` já recusa inativo); conferir o bloco 11 do SQL de auditoria todo mês |

**Fora da branch `feat/seguranca-falhas-dados`** (ficam para outro esforço): assinatura de profissional em bucket próprio (P6c), limite de linhas e trilha de exportação em massa (P8), rotina de saída de colaborador (P9).

## 5. Matriz de acesso (estado pelas migrations, 16/10/2026)

**Confirme em produção** com o bloco 4 do SQL de auditoria: produção recebeu ajustes à mão (snippets de 17/08) que as migrations não tinham até a `20261016130000`.

| Tabela / view | Quem lê (authenticated) | Anon | Escrita |
|---|---|---|---|
| `pacientes` | **qualquer login** (`using (true)`) — P1b. Depois da `20261019160100`: `cadastros_pacientes` + papéis admin/diretoria/cronograma; as outras telas pela lista básica | sem acesso depois da C1 | `cadastros_pacientes` / papéis |
| `pacientes_importacoes_log` | `cadastros_pacientes` (C9) | sem acesso | só RPC |
| `pacientes_disponibilidade_versoes` | `cadastros_pacientes` | sem acesso | só RPC |
| `pacientes_convenio_vigencias` | `cadastros_pacientes` (consulta por data via `convenio_do_paciente_em`, só logado) | sem acesso | só gatilho |
| `tita_favorecidos_cadastro` (cópia do cadastro do TiTa) | `cadastros_pacientes` | sem acesso | só service_role (rota de servidor e snapshot) |
| `profissionais`, `profissionais_terapias_habilitadas` | `cadastros_profissionais` | sem acesso | `cadastros_profissionais` |
| `profissionais_disponibilidade_*` | `cadastros_profissionais` | sem acesso | só RPC |
| `grade_*` (agenda do Pulsar) | `cronograma_grade` | sem acesso | só RPC |
| `tita_importacoes(_itens)` | `cadastros_profissionais` | sem acesso | só RPC |
| `grade_importacoes_itens` | `cronograma_grade` | sem acesso | só RPC |
| `sistema_tita_corte` | ninguém direto (só `tita_cortado_em()`) | sem acesso | só o SQL de corte |
| `cadastros_auditoria` | por entidade (12 permissões), FORCE RLS | sem acesso | insert por permissão |
| `csv_grades_profissionais` | **qualquer login** — P6. Depois da `20261019140000`/`150000`: leitura por coluna, sem CPF, observação da sala e texto da evolução | sem acesso depois da C1 | service_role (sync) |
| `agenda_tita` | **qualquer login** — P6 | sem acesso depois da C1 | service_role (sync) |
| `grade_profissionais_tita` | **qualquer login** — P6. Depois da `20261019140000`: leitura por coluna, sem CPF, telefone, registro, `raw_json` e observação da sala | sem acesso depois da C1 | service_role (sync) |
| `controle_terapeutico` | papéis terapêutico/terapeuta/admin/diretoria/faturamento | sem acesso depois da C1 | **qualquer login insere** — P6b; depois da `20261019140000`, só os papéis (e a Edge Function, que exige `escala_terapeutica`) |
| `vw_grade_*`, `central.vw_vagas_livres` | herdam a tabela (security_invoker) | sem acesso | — |
| `vw_central_terapeutica`, `vw_profissionais_disponiveis` | herdam a tabela (security_invoker, C8) | sem acesso | — |
| `usuarios` | policies do snippet fase 3 (produção) | sem acesso | trava de autopromoção |

**Storage:** `pacientes-fotos` privado (fotos de paciente e, na pasta `profissionais/`, foto e assinatura de profissional — P6c); `central-anexos` e `central-avatares` privados (só service_role); `tv-avisos` público de propósito (cartaz, sem dado de paciente).

**Edge Functions:** `config.toml` não define `verify_jwt`, então vale o padrão (exige JWT), mas a chave anon é um JWT válido. As funções de teste (`tita-compare-endpoints` devolve agendas e nomes de pacientes do TiTa; `cco-test-setup` escreve e apaga com service_role) precisam sair do ar — P0.
