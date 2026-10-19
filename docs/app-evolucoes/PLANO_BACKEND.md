# Plano do backend do app de evoluções (rascunho — nada aplicado)

Levantamento feito em 19/10/2026 sobre `supabase/migrations/` e `frontend/`.
Nenhuma migration foi escrita. Ordem: Fase 0 antes de qualquer coisa.

## O que o levantamento mostrou

1. **Login por celular quebra hoje.** `handle_new_user` (último em
   `20260701135826_remote_schema.sql:1105`) insere `new.email` em
   `usuarios.email` (NOT NULL). Usuário só de telefone não tem e-mail: o insert
   falha e o Supabase desfaz a criação da conta.
2. **Cadastro aberto escolhe o próprio papel.** O mesmo trigger usa
   `raw_user_meta_data->>'role'`, que quem se cadastra controla. Entra com
   `ativo=false`, mas `trg_sync_central_role_admin` (`20260810130050`) põe
   `central_role='admin'` quando `role='admin'`, e nem `custom_access_token_hook`
   nem `central.ca_current_role()` olham `ativo`. Com cadastro público ligado,
   `signUp({..., data: {role: 'admin'}})` viraria admin da Central.
   **Produção: "Allow new users to sign up" está DESLIGADO** (conferido no
   Dashboard em 19/10/2026), então hoje não é explorável; o `config.toml` local
   (`enable_signup = true`) não reflete produção. O frontend não usa `signUp`.
3. **`usuarios.profissional_id` não está travado** pelo
   `trg_usuarios_trava_colunas_de_acesso`. Com o app, esse campo passa a decidir
   de quem é a agenda que se vê; se o grant de UPDATE for da tabela inteira, cada
   um se liga a qualquer profissional. Conferir com
   `has_column_privilege('authenticated','public.usuarios','profissional_id','UPDATE')`.
4. **Responsável logado seria `authenticated`** e leria cerca de 33 tabelas com
   policy `using (true)`, a começar por `pacientes` (CPF, endereço),
   `agenda_tita`, `csv_grades_profissionais` e `autorizacoes`.
5. **Não existe cobertura planejada na Grade.** Substituição só aparece depois,
   quando `grade_evolucoes.tratativa_profissional_id` ≠ `grade_agendamentos.profissional_id`.
   `controle_terapeutico`/`substituicoes_historico` são da era TiTa (chave TiTa).
6. **Nada grava `usuarios.profissional_id`** hoje; só `sp_grade_autor_evolucao`
   cai no e-mail do profissional como plano B.
7. Nenhuma Edge Function apaga usuário (só a rota Next `api/admin/user/delete`).

## Quem consegue entrar

O app é público na loja e a chave publishable sai dentro dele; quem quiser chama
o Supabase direto, sem o app. Por isso nenhuma barreira mora no app — todas no servidor:

| Camada | Barra |
| --- | --- |
| Cadastro público desligado (Dashboard) | criar conta por conta própria, por e-mail ou celular (inclusive chamando a API direto com `shouldCreateUser: true`) |
| Conta criada só pela clínica (lista branca) | celular/e-mail que a clínica não liberou: nem recebe código. Também impede disparo de SMS pago para números aleatórios (SMS pumping) |
| Código no celular / senha do Pulsar | quem sabe o número de outra pessoa mas não tem o aparelho |
| Hook de token + papel `responsavel` sem tabelas | conta de telefone lendo `pacientes` e afins pela API |
| `app_meu_perfil()` e RPCs checando vínculo ativo **a cada chamada** | usuário do Pulsar sem papel `terapeuta`; acesso revogado (o corte é imediato, não espera o token de 1h vencer) |
| Revogação | celular trocado no cadastro, responsável desvinculado, terapeuta desligado (`ativo=false`), número reciclado pela operadora |

Conta de demonstração das lojas: número de teste com código fixo, ligado a um
paciente `ficticio = true`, nunca a dado real.

## Fase 0 — correções de segurança (valem mesmo sem o app)

**APLICADA EM PRODUÇÃO em 19/10/2026** (ensaio desfeito antes; conferência 5/5;
hook conferido ao vivo: 2 admins e 8 ativos com `central_role` intactos).
Reversão: `supabase/snippets/20261019_seguranca_cadastro_token_profissional_REVERTER.sql`.
Migration
`20261019170000_seguranca_cadastro_token_profissional.sql`, snippet
`supabase/snippets/20261019_seguranca_cadastro_token_profissional_APLICAR.sql`,
teste `supabase/tests/seguranca_cadastro_token_profissional.pglite.mjs` (12/12).
Produção conferida (só leitura): `profissional_id` existe; 0 inativos com
`role='admin'` ou `central_role`; `handle_new_user` de produção usa
`search_path = public, extensions, pg_temp` (mantido).

- `handle_new_user`: ignorar `role` vindo do metadata (sempre `'recepcao'`,
  `ativo=false`; as rotas de admin já fazem upsert do papel depois) e **não criar
  linha em `usuarios` quando `new.email is null`** (conta de telefone = responsável).
- `custom_access_token_hook` e `ca_current_role()`: só emitir/aceitar
  `central_role` com `ativo = true`.
- `profissional_id` entra na lista da trava de colunas.
- Dashboard: "Allow new users to sign up" já está desligado em produção — manter
  assim (é a barreira 1 do app). Ajustar `config.toml` para `enable_signup = false`
  para o ambiente local não divergir. Criação de conta só pela API de admin.
- Conferir em produção se alguém já se aproveitou:
  `select id, email, role, central_role, ativo, created_at from usuarios where ativo = false and (role = 'admin' or central_role is not null)`.

## Fase 1 — papel `terapeuta`

**Escrita em 19/10/2026, ensaiada em produção (desfeito), NÃO aplicada:** migration
`20261019200000_papel_terapeuta_app.sql` + snippets `_APLICAR`/`_REVERTER` + teste
`papel_terapeuta_app.pglite.mjs` (15/15). Decisões na escrita:
- Grupo "Terapeuta (App)" (o "Terapêutico" já existe e é outro papel). Prioridade
  abaixo de todo setor: quem está num setor fica com o setor.
- **Sem CHECK "terapeuta exige profissional_id"**: o papel chega pelo gatilho do
  grupo antes de o admin escolher o profissional; o CHECK faria a entrada no grupo
  falhar. Sem profissional, `app_meu_perfil()` não devolve linha e a tela avisa.
- `profissional_id` único (índice parcial). Ligação pela rota
  `/api/admin/user/profissional` (só admin) e campo "Profissional no app" no card.
- `app_meu_perfil()` antecipada da Fase 4 (terapeuta + gestão).
- Terapeuta no Pulsar web cai em `/sem-permissao`, que diz que o acesso é pelo app.
- O app ainda não força a troca da senha temporária (`primeiro_acesso`): o
  terapeuta define a senha no Pulsar web (`/definir-senha`) antes de usar o app.

- `usuarios_role_check` + `grupos_permissoes` + prioridade em
  `sincronizar_nivel_pelos_grupos` (modelo: `20261008130000_add_role_comercial.sql`)
  e as listas do frontend (memória "papel novo encosta em 6 listas").
- `roleDefaults` do terapeuta: nenhuma tela do Pulsar web.
- Regra no banco: `role = 'terapeuta'` exige `profissional_id` (trigger; CHECK não
  alcança outra tabela). Campo "Profissional" no `CreateUserModal`/edição de usuário.
- **Não** dar `cronograma_grade` ao terapeuta: essa permissão abre as tabelas
  `grade_*` inteiras pelo RLS.
- **Gestão (admin e diretoria) também entra no app** (decidido 19/10/2026), na
  mesma área de agenda, escolhendo o profissional. Admin evolui e marca falta;
  diretoria só consulta (mesma regra da Grade web: nem diretoria evolui).

## Fase 2 — cobertura e abertura das RPCs de evolução

- Tabela nova `grade_coberturas (agendamento_id uuid PK → grade_agendamentos,
  profissional_id bigint, criado_por uuid, criado_em, removido_em)`, gravada pela
  recepção na Grade (modal de cobertura), escrita só por RPC.
- `sp_grade_pode_evoluir(p_agendamento_id)` (o gancho já previsto): admin **ou**
  terapeuta ativo cujo `profissional_id` é o da sessão ou o da cobertura ativa
  (cobertura com tabela própria: decidido 19/10/2026).
- Para o terapeuta, dentro das RPCs existentes:
  - `grade_registrar_evolucao`: só sessão já iniciada e ainda sem registro;
    `p_profissional_substituto_id` ignorado (autor é sempre ele).
  - `grade_registrar_falta`: só `tipo_falta = 'paciente'` (decidido 19/10/2026;
    falta do profissional continua sendo lançada pela gestão).
  - `grade_limpar_evolucao` e correções: continuam só admin.
- RPC nova `app_terapeuta_agenda(p_de date, p_ate date)`: sessões próprias +
  cobertas, com o status de evolução (mesmo cálculo de
  `grade_resumo_evolucoes_periodo`, sem a flag de inconsistência).

## Fase 3 — responsável (celular)

**Isolamento:** o `custom_access_token_hook` passa a trocar o claim `role`:
quem tem linha em `usuarios` continua `authenticated`; todo o resto vira o papel
Postgres novo `responsavel` (NOLOGIN, `grant responsavel to authenticator`).
O PostgREST executa como `responsavel`, que não tem grant em tabela nenhuma e
os privilégios padrão não o alcançam: só `EXECUTE` nas RPCs `app_responsavel_*`.
Falha fechada: conta sem vínculo também cai em `responsavel` e não vê nada.
Validar em ensaio (refresh de token, Storage, Realtime) antes de produção.
Plano B, se o claim de papel não se comportar: helper `eh_equipe()` nas ~39
policies `using (true)` (raio de impacto bem maior).

**Vínculo:** `responsaveis_acesso_app (user_id uuid → auth.users on delete cascade,
responsavel_id bigint → responsaveis, telefone_e164, liberado_por, liberado_em,
revogado_em, PK (user_id, responsavel_id))`. Vários `responsaveis` podem ter o
mesmo celular (CPF não é único), e o telefone é único em `auth.users`: um login
cobre todas as linhas daquele celular. FORCE RLS, sem grant direto.

**Liberação:** sem autocadastro. Botão "Liberar app" no painel do responsável
(e uma carga em lote) → rota de admin com service role → normaliza o celular para
E.164 → `auth.admin.createUser({ phone, phone_confirm: true })` → grava o vínculo.
Mudou o celular no cadastro → atualiza o telefone da conta. Antes do lançamento,
medir quantos `responsaveis.celular` normalizam para celular válido (hoje é texto
livre; a conferência atual casa pelos últimos 8 dígitos).

**Envio do código — WhatsApp pela Evolution API + SMS de reserva** (proposta):
- Send SMS Hook do Supabase → Edge Function `auth-enviar-codigo`. O hook substitui
  o envio do Supabase e recebe só `user` (com `phone`) e `sms.otp`; **não recebe o
  canal** pedido pelo app. Por isso o app tem um botão só, e o servidor decide:
  1. 1º envio do número nos últimos 10 min → WhatsApp pela Evolution, se o número
     tem WhatsApp (`chat/whatsappNumbers`) e a instância está conectada;
  2. Evolution fora do ar, número sem WhatsApp, ou 2º envio ("Não recebi: enviar
     por SMS") → SMS por um provedor oficial.
  Tabela `app_otp_envios (telefone, canal, enviado_em, ok, erro)` guarda o histórico
  (escolha do canal, auditoria e limite por número). Nunca guardar o código.
- **Instância e número só para códigos**, separados do atendimento/Maia. A
  Evolution não é API oficial: se o número de códigos for banido, perde-se só ele
  e o SMS segura o login; o número do atendimento não é arrastado junto.
- O SMS de reserva é obrigatório: é o que garante que "banimento do número ≠
  ninguém entra" (regra do `CLAUDE.md`). Provedor a escolher (Twilio, Zenvia etc.).
- Subir o limite de 30 SMS/hora do projeto. Número de teste com código fixo
  (`test_otp`) = conta de demonstração das lojas (não passa pelo hook).

**Leitura** (security definer, filtro por `pacientes_responsaveis` dos
`responsavel_id` do login, nunca texto clínico):
- `app_responsavel_pacientes()`: id, nome, data de nascimento.
- `app_responsavel_agendamentos(p_de, p_ate)`: data, horário, terapia
  (exibição), profissional, unidade/sala, só `situacao = 'agendado'`.

## Fase 4 — comum aos dois

- `app_meu_perfil()` → `(tipo text, nome text, pode_evoluir boolean)`; `tipo` em
  `'terapeuta' | 'gestao' | 'responsavel'`, nenhuma linha = sem acesso.
  Terapeuta: `role='terapeuta'`, `ativo`, `profissional_id` não nulo
  (`pode_evoluir` true). Gestão: `role` admin (true) ou diretoria (false), `ativo`.
  Responsável: vínculo não revogado (false).
  Executável por `authenticated` e `responsavel`. O app já chama esta RPC
  (`app-evolucoes/src/lib/perfil.ts`).
- Edge Function `app-excluir-conta` (exigência das lojas): responsável → revoga o
  vínculo e apaga a conta de login (cadastro e histórico do paciente ficam);
  terapeuta → desativa o acesso ao app e avisa o admin (a conta do Pulsar é da empresa).
- Testes PGlite por fase (modelo: `supabase/tests/grade_evolucoes_terapeuticas.pglite.mjs`).

## Decisões (19/10/2026)

1. Cobertura: tabela própria `grade_coberturas`.
2. Terapeuta marca só "falta do paciente".
3. Admin e diretoria entram no app (perfil `gestao`).
4. Código: WhatsApp pela Evolution em número dedicado + SMS oficial de reserva
   (proposta aceita). Provedor de SMS: o volume é baixo (sessão fica salva no
   aparelho; SMS só na reserva), então pesa mais NÃO ter mensalidade do que o preço
   unitário. Zenvia exige pacote de R$ 100/mês (até 1.000 SMS, R$ 0,10/SMS) mesmo
   sem uso — ruim para reserva. Preferir pré-pago por uso: Comtele (~R$ 0,07, real)
   ou Twilio (US$ 0,0599 ≈ R$ 0,30, dólar). Abaixo de ~330 SMS/mês o Twilio sai
   mais barato que o pacote Zenvia. Testar em chips Vivo, Claro e TIM antes de
   fechar. O hook isola o provedor: trocar = trocar uma função de envio.
   Cotação vista em 19/10/2026: pré-pago, rota premium, 500 SMS por R$ 60 (R$ 0,12).
   **Texto do SMS sem acento e com até 160 caracteres:** um acento muda a
   codificação para UCS-2, o limite cai para 70 caracteres e a mensagem vira 2 SMS
   cobrados. Modelo: `Universo ABA: seu codigo de acesso e 123456. Nao compartilhe.`
