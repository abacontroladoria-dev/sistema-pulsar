# Plano — Evoluções Terapêuticas na Grade (`/cronograma/grade`)

## 1. Contexto e Diretrizes

O módulo **Grade** (`/cronograma/grade`) já opera com agenda própria no Pulsar (`grade_agendamentos`). O próximo passo é incorporar o fluxo de **Evoluções Terapêuticas e Registro de Faltas** diretamente na visão por profissional (`?visao=profissional`), preparando a base definitiva que substituirá o TiTa e alimentará futuramente `central-pacientes/` e `relacionamento-prestador/rp/`.

**Regras de negócio fixadas:**
1. **Quem pode evoluir agora:** Exclusivamente `role = 'admin'` (validado no cliente e por `public.is_admin()` no banco). Nem `diretoria` pode evoluir neste momento.
2. **Quem evolui ("Realizado por"):** Nunca é escolhido manualmente em lista. O sistema capta automaticamente o usuário logado (`auth.uid()`):
   - **Agora (fase Admin):** exibe e grava o nome do admin logado (ex.: *Realizado por Sanderson Rodrigues*).
   - **No futuro (fase Profissional Terapeuta):** o terapeuta só vê a própria agenda; quando tiver acesso liberado à agenda de outro profissional para cobrir um atendimento, ao evoluir sob o seu login o sistema captará automaticamente o nome/ID dele — caracterizando **Substituição** quando diferente do profissional agendado.
3. **Convivência e independência do TiTa:** O que já foi evoluído ou marcado como falta no TiTa entra espelhado na tabela própria do Pulsar (`origem = 'tita_importacao'`), mas **a tela da Grade lê apenas a tabela própria do Pulsar** e qualquer registro feito no Pulsar (`origem = 'pulsar'`) é soberano. Quando o TiTa for desligado (`sistema_tita_corte`), nada na Grade ou nas evoluções precisará mudar.

---

## 2. Comportamento Visual na Grade (`/cronograma/grade`)

### 2.1 Visão por Paciente (`?visao=paciente`)
- **Mantém exatamente como está.** Não exibe ícones de evolução e não abre formulário de evolução por esta visão.

### 2.2 Visão por Profissional (`?visao=profissional`) — Os 4 (+1) Ícones
Cada sessão agendada recebe ao lado um ícone de status com cor própria. A transição entre **Futuro (Azul)** e **Sem registro (Amarelo)** obedece ao minuto exato do início da sessão no fuso de Brasília (`America/Sao_Paulo`), reavaliado automaticamente na tela a cada 30 segundos:

| Estado | Cor | Ícone | Regra exata |
|---|---|---|---|
| **Agendamento futuro** | 🔵 **Azul** (`sky-600`) | `Clock` | Sem evolução e sem falta, e o horário de início ainda não passou (`agora <= data + hora_inicio`). *Ex.: são 09:59 e a sessão é às 10:00 → permanece azul.* |
| **Sem registro (já passou)** | 🟡 **Amarelo** (`amber-500`) | `ClockAlert` | Sem evolução e sem falta, e o horário de início já começou/passou (`agora > data + hora_inicio`). *Ex.: são 10:01 e a sessão é às 10:00 (ou dia anterior) → fica amarelo.* |
| **Evoluído** | 🟢 **Verde** (`emerald-600`) | `CheckCircle2` | Sessão com evolução salva (`possui_tratativa = true`) e **sem** falta apontada pela recepção. |
| **Agendamento cancelado (Falta)** | 🔴 **Vermelho** (`rose-600`) | `XCircle` | Sessão marcada como falta (**Falta do paciente** ou **Falta do profissional**), sem evolução. |
| **Inconsistência** *(Exclusivo Admin)* | 🟣 **Roxo/Violeta** (`violet-600`) | `AlertTriangle` | A **recepção marcou falta** (em `fila_autorizacoes` com `status = 'falta'` e `falta_revertida_em IS NULL`), **porém consta como Evoluído** (`possui_tratativa = true`). |

> **Regra de visibilidade para o Profissional (quando liberado no futuro):**
> A cor roxa e o rótulo "Inconsistência" **jamais aparecem para o profissional**. Para ele, a sessão aparece com o ícone **Vermelho (Falta)** e, ao abrir o painel, mostra apenas um aviso curto e direto: *"A recepção registrou falta neste atendimento."*

### 2.3 Conciliação: Cor da Terapia × Cor do Status da Evolução
Para manter a cor da terapia intacta em `CartaoSessao` (`frontend/components/cronograma/grade/pecas.tsx`) sem conflito visual com a cor do status:
- **Corpo do cartão:** permanece 100% com o fundo pastel (`--t-50`), texto (`--t-700`), borda (`--t-300`) e ícone da terapia.
- **Medalhão lateral do status:** posicionado à direita do cartão (`shrink-0`), como uma cápsula arredondada (`h-5 w-5` na grade normal, `h-6 w-6` na tela cheia) com **fundo sólido na cor do status + ícone branco + anel de isolamento `ring-2 ring-card`**. O anel na cor do fundo da superfície separa visualmente a cor do status de qualquer cor de terapia (inclusive terapias verdes, amarelas ou vermelhas).

---

## 3. Fluxo do Painel Lateral ao Clicar na Sessão (`visao=profissional`)

Quando o usuário `admin` clica em uma sessão na visão por profissional, o painel lateral (`Drawer`) exibe no topo o contexto padronizado:

> **`Planejamento do dia DD/MM/AAAA - Hora HH:MM às HH:MM - Nome da Terapia`**

### 3.1 Sessão sem registro (Azul ou Amarelo)
Exibe a pergunta **"Qual ação deseja fazer?"** com dois botões de ação:

1. 🔴 **Marcar como falta** (botão vermelho)
   - Ao clicar, exibe as duas opções diretas:
     - **Falta do paciente** (`status_execucao = 'Cancelado'`, `justificativa = 'Não realizado — paciente'`, `tipo_falta = 'paciente'`)
     - **Falta do profissional** (`status_execucao = 'Cancelado'`, `justificativa = 'Não realizado — prestador'`, `tipo_falta = 'terapeuta'`)
   - Botão **Confirmar falta**.

2. 🟢 **Evoluir** (botão verde)
   - Ao clicar, exibe os dados principais organizados:
     - **Paciente:** nome atual do cadastro
     - **Terapia:** nome da terapia (e exibição, se diferente)
     - **Data e Hora:** `DD/MM/AAAA · HH:MM às HH:MM`
     - **Realizado por:** preenchido automaticamente (somente leitura) com o nome do usuário logado (ex.: *Sanderson Rodrigues*).
   - **Campo obrigatório:** `Descrição` (`textarea` limpo e direto).
   - **Botão:** `Salvar` (não exibe o carimbo durante a digitação).

### 3.2 Sessão já Evoluída (Verde ou Inconsistência)
Quando a sessão já está evoluída e o usuário clica novamente nela:
- Abre no **visual de evolução concluída (preenchido)**:
  - Caso haja **Inconsistência**:
    - Para o `admin`: destaque curto *"Inconsistência: a recepção registrou falta, mas a sessão foi evoluída."*
    - Para o `profissional` (no futuro): aviso curto *"A recepção registrou falta neste atendimento."*
  - Dados da sessão (Paciente, Terapia, Data e Horário).
  - **Autoria e Data/Hora exata:**
    - `Realizado por: [tratativa_profissional_nome]` (se diferente do profissional agendado na grade, exibe tag **Substituição**: *"Agendado para [Profissional da Grade]"*).
    - `Evoluído em: DD/MM/AAAA às HH:MM:SS` (`tratativa_criada_em` no fuso de Brasília).
  - **Descrição:** texto da evolução formatado para leitura.
  - **Carimbo / Assinatura do Profissional:**
    - Renderiza a imagem de `profissionais.assinatura_path` (cadastrada em `/cadastros/profissionais`, via URL assinada de `useUrlAssinada`) do profissional que evoluiu (ou do profissional da sessão quando evoluído pelo admin em nome da sessão), acompanhada do nome e registro de conselho (`tipo_registro`, `uf_registro`, `codigo_registro`).
  - **Ação de correção (Admin):** botão discreto **"Editar evolução / Alterar status"** para corrigir o texto da descrição, converter para falta ou limpar o registro (registrando a alteração no histórico).

### 3.3 Sessão marcada como Falta (Vermelho)
- Exibe o status de falta registrado (**Falta do paciente** ou **Falta do profissional**), quem registrou e quando (`DD/MM/AAAA às HH:MM:SS`).
- **Ação de correção (Admin):** botão discreto **"Alterar status / Evoluir"** caso precise reverter a falta ou lançar a evolução.

---

## 4. Banco de Dados e Transição Coerente do TiTa

### 4.1 Tabela `public.grade_evolucoes`
Relacionamento 1:1 com `public.grade_agendamentos(id)`, inspirada diretamente nas colunas de execução de `csv_grades_profissionais` (`20260806100000_grade_colunas_execucao.sql` e `20260909160000_grade_descricao_da_evolucao.sql`):

```sql
create table if not exists public.grade_evolucoes (
  agendamento_id              uuid primary key references public.grade_agendamentos(id) on delete restrict,
  tita_agendamento_id         bigint,

  -- Execução / Falta (mesmo vocabulário canônico de rotulosExecucao.ts)
  status_execucao             text not null, -- 'Realizado' | 'Cancelado'
  justificativa               text,          -- 'Não realizado — paciente' | 'Não realizado — prestador'
  tipo_falta                  text,          -- 'paciente' | 'terapeuta' (ponte direta com central-pacientes)

  -- Tratativa / Evolução (inspirado em csv_grade_profissionais)
  possui_tratativa            boolean not null default false,
  tratativa_profissional_id   bigint references public.profissionais(id) on delete restrict,
  tratativa_profissional_nome text,
  tratativa_usuario_id        uuid,
  tratativa_criada_em         timestamptz,
  tratativa_origem            text not null default 'Prontuario',
  evolucao_vinculo            text not null default 'Agendamento ativo',
  descricao_evolucao          text,
  tratativas                  smallint not null default 0,
  tratativas_distintas        smallint not null default 0,

  -- Origem do registro ('pulsar' prevalece sempre sobre 'tita_importacao')
  origem                      text not null default 'pulsar',

  -- Rastreio de última ação
  registrado_por              uuid,
  registrado_por_nome         text,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now(),

  constraint grade_evol_status_check check (status_execucao in ('Realizado', 'Cancelado')),
  constraint grade_evol_tipo_falta_check check (tipo_falta is null or tipo_falta in ('paciente', 'terapeuta')),
  constraint grade_evol_origem_check check (origem in ('pulsar', 'tita_importacao')),
  constraint grade_evol_vinculo_check check (evolucao_vinculo in ('Agendamento ativo', 'Agendamento excluído', 'Sem agendamento')),
  constraint grade_evol_consistencia_check check (
    (status_execucao = 'Realizado' and possui_tratativa = true and tipo_falta is null and length(btrim(coalesce(descricao_evolucao, ''))) > 0)
    or
    (status_execucao = 'Cancelado' and possui_tratativa = false and descricao_evolucao is null)
  )
);
```

### 4.2 Como trazer o que já existe no TiTa sem depender dele no futuro
1. **A Grade nunca consulta `csv_grades_profissionais` ao abrir:** lê exclusivamente `grade_evolucoes`.
2. **Carga inicial na migration + passo na importação da Grade (`grade_importar_tita_aplicar` / `grade_importar_tita_concluir`):**
   - Para todo `grade_agendamentos` com `tita_agendamento_id`, se `csv_grades_profissionais` já tiver evolução (`possui_tratativa = true`) ou cancelamento (`status_execucao = 'Cancelado'`), faz `INSERT ... ON CONFLICT (agendamento_id) DO UPDATE ... WHERE grade_evolucoes.origem = 'tita_importacao'`.
   - Ou seja: **tudo que foi evoluído/faltou no TiTa já aparece na Grade**, mas se o `admin` (ou futuramente o terapeuta) registrar/editar no Pulsar (`origem = 'pulsar'`), o Pulsar nunca é sobrescrito pelo TiTa.
   - No dia do corte (`sistema_tita_corte`), a importação para e `grade_evolucoes` continua operando sozinha.

### 4.3 RPCs e Segurança
- **`grade_resumo_evolucoes_periodo(p_de, p_ate, p_profissionais)`:**
  - Devolve para os agendamentos do período o status de evolução (`status_execucao`, `tipo_falta`, `possui_tratativa`, `tratativa_profissional_id`, `tratativa_profissional_nome`, `tratativa_criada_em`) + `falta_recepcao` (cruzado no banco com `fila_autorizacoes` onde `status = 'falta' AND falta_revertida_em IS NULL`).
  - Se o chamador não for `admin` (no futuro, quando for o profissional), o banco já oculta a flag de inconsistência e entrega como falta da recepção.
- **`grade_detalhe_evolucao(p_agendamento_id)`:**
  - Restrita a `public.is_admin()` (e futuramente ao profissional vinculado). Devolve a `descricao_evolucao` completa + dados do carimbo (`assinatura_path`, `tipo_registro`, `uf_registro`, `codigo_registro`) do profissional.
- **`grade_registrar_evolucao(p_agendamento_id, p_descricao)`:**
  - Exclusiva para `public.is_admin()` (por enquanto).
  - Captura automaticamente `auth.uid()`, busca `u.nome` em `public.usuarios` (e eventual vínculo em `public.profissionais`), grava `status_execucao = 'Realizado'`, `possui_tratativa = true`, `tratativa_criada_em = now()`, `origem = 'pulsar'`, e registra em `grade_eventos` (`acao = 'evoluido'`).
- **`grade_registrar_falta(p_agendamento_id, p_tipo_falta)`:**
  - Exclusiva para `public.is_admin()` (por enquanto).
  - Recebe `'paciente'` ou `'terapeuta'`, grava `status_execucao = 'Cancelado'`, `justificativa` canônica (`'Não realizado — paciente'` ou `'Não realizado — prestador'`), `possui_tratativa = false`, `origem = 'pulsar'`, e registra em `grade_eventos` (`acao = 'falta_registrada'`).
- **`grade_limpar_evolucao(p_agendamento_id)`:**
  - Exclusiva para `public.is_admin()`, para quando precisar desfazer um lançamento e voltar a sessão para "sem registro" (auditado em `grade_eventos`).

---

## 5. Mapa de Transição para `central-pacientes/` e `relacionamento-prestador/rp/`

A modelagem acima foi desenhada para que a virada de chave dessas duas ferramentas seja apenas trocar a fonte de leitura:

### 5.1 `relacionamento-prestador/rp/` (`gradeRemuneracao.ts` e `relatorio.ts`)
- Hoje `buscarGradeParaRP` lê `csv_grades_profissionais` buscando exatamente:
  `status_execucao`, `justificativa`, `possui_tratativa`, `tratativa_profissional_id`, `tratativa_profissional_nome`, `tratativa_criada_em`, `tratativas`, `tratativas_distintas`.
- E `presencaReal.ts` cruza com `fila_autorizacoes` para apontar `"Evolução sem presença"` quando a recepção marcou falta e o terapeuta evoluiu.
- **Como ficará na transição:** `grade_agendamentos LEFT JOIN grade_evolucoes` já possui **todas** essas colunas com os mesmos nomes e os mesmos textos canônicos (`'Realizado'`, `'Cancelado'`, `'Não realizado — paciente'`, `'Não realizado — prestador'`). O motor `classificarSessaoReal()` continuará classificando `"Evolução normal"`, `"Substituição"`, `"Evolução sem presença"` e `"Cancelado"` sem alterar uma única linha da regra financeira.

### 5.2 `central-pacientes/` (`listar_central_pacientes`)
- Hoje faz `LEFT JOIN LATERAL public.controle_terapeutico ct` para obter:
  - `profissional_substituto_id` / `profissional_substituto_nome` / `is_substituicao`
  - `controle_status`, `confirmado_em`, `confirmado_por_nome`
- **Como ficará na transição:** em `grade_evolucoes`, quando `tratativa_profissional_id IS DISTINCT FROM agendamento.profissional_id` (ou `tratativa_profissional_nome <> agendamento.profissional_nome`), já temos a substituição pronta, além de `tratativa_criada_em` (`confirmado_em`), `tratativa_profissional_nome` (`confirmado_por_nome`) e `tipo_falta` (`'paciente'` | `'terapeuta'`).

---

## 6. Arquivos a Criar / Alterar

### Banco de Dados (`supabase/`)
- **Novo:** `supabase/migrations/20261016180000_grade_evolucoes_terapeuticas.sql`
  - Tabela `public.grade_evolucoes`, RLS/GRANTs (anon revogado, escrita só via RPC), novas ações em `grade_eventos`, backfill das evoluções/faltas existentes em `csv_grades_profissionais` e atualização de `grade_importar_tita_concluir` para espelhar novas evoluções do TiTa enquanto o corte não estiver ativo.
  - RPCs `grade_resumo_evolucoes_periodo`, `grade_detalhe_evolucao`, `grade_registrar_evolucao`, `grade_registrar_falta`, `grade_limpar_evolucao`.
  - Política de leitura da assinatura no Storage (`pacientes-fotos`) permitindo ao `admin` (e futuramente a quem consulta a evolução) ler `profissionais/{id}/assinatura-*`.
- **Novo:** `supabase/tests/grade_evolucoes_terapeuticas.pglite.mjs`
  - Testes PGlite cobrindo: bloqueio para não-admin (inclusive `diretoria`), evolução normal, substituição, falta do paciente/profissional, detecção de inconsistência com `fila_autorizacoes`, edição/reversão pelo admin e espelhamento do TiTa sem sobrescrever o Pulsar.

### Frontend (`frontend/`)
- **Novo:** `frontend/lib/grade/evolucaoStatus.ts` + `frontend/lib/grade/evolucaoStatus.test.ts`
  - Função pura que recebe a sessão, o resumo da evolução e o horário atual (`America/Sao_Paulo`) e devolve um dos 5 estados (`futuro`, `sem_registro`, `evoluido`, `cancelado`, `inconsistencia`), respeitando a regra de 09:59 (azul) vs. 10:01 (amarelo) e ocultando `inconsistencia` quando o perfil não for `admin`.
- **Novo:** `frontend/components/cronograma/grade/PainelEvolucaoSessao.tsx`
  - Drawer da sessão na visão por profissional com:
    - Cabeçalho `Planejamento do dia DD/MM/AAAA - Hora HH:MM às HH:MM - Nome da Terapia`
    - Escolha `Marcar como falta` (vermelho: paciente / profissional) vs. `Evoluir` (verde: resumo + `Realizado por` automático + `Descrição` obrigatória + `Salvar`)
    - Visualização de sessão já evoluída preenchida + Carimbo (`useUrlAssinada`) + botão discreto de editar/alterar status para o `admin`.
- **Alterados:**
  - `frontend/types/grade.ts`: tipos `ResumoEvolucaoGrade`, `DetalheEvolucaoGrade`, `EstadoEvolucaoVisual`.
  - `frontend/services/grade.service.ts` e `frontend/hooks/useGrade.ts`: chamadas às novas RPCs de evolução.
  - `frontend/components/cronograma/grade/pecas.tsx`: medalhão de status da evolução ao lado da sessão em `CartaoSessao` (somente quando `visao=profissional`).
  - `frontend/components/cronograma/grade/GradeShell.tsx`: ticker de 30s do horário atual em Brasília, passagem do status para os cartões na `visao=profissional` e abertura de `PainelEvolucaoSessao` para `admin`.

---

## 7. Etapas de Execução

| # | Etapa | Entrega |
|---|---|---|
| 1 | Banco + Testes PGlite | Migration `20261016180000_grade_evolucoes_terapeuticas.sql` (tabela, espelhamento TiTa, RPCs restritas a `admin`, Storage) + `grade_evolucoes_terapeuticas.pglite.mjs` e `check-seguranca-migrations.js` |
| 2 | Motor de Status + Testes Vitest | `frontend/lib/grade/evolucaoStatus.ts` + `evolucaoStatus.test.ts` (5 estados, virada de minuto 09:59 → 10:01, ocultação de inconsistência para não-admin) |
| 3 | Ícones na Grade (`visao=profissional`) | Medalhão de status em `CartaoSessao` conciliado com a cor da terapia + leitura de `grade_resumo_evolucoes_periodo` |
| 4 | Painel de Evolução / Falta / Carimbo | `PainelEvolucaoSessao.tsx` (fluxo `Marcar como falta`, `Evoluir` com `Realizado por` automático, leitura preenchida com carimbo e edição/reversão pelo `admin`) |
| 5 | Validação final | `npm test`, `npm run lint`, `npm run build` limpos |
