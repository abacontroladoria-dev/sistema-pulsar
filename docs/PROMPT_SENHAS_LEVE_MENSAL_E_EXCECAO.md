# Prompt — Senha LEVE mensal + exceção única de substituição completa

> Preparado em 29/09/2026 para ser colado no Claude Code **quando o TI entregar o
> export corrigido** do relatório de autorizações (hoje ele traz só 2 dos ~39
> pacientes LEVE ativos). Cole tudo abaixo da linha.

---

Tela: **Status Laudos e Senhas** (`/acompanhamento/laudos`), botão **"Atualizar
senhas"**, que sobe o `relatorio_autorizacoes_assim_*.csv`. Três entregas, **nesta
ordem**, cada uma validada por mim antes da próxima. **Antes de alterar qualquer
coisa, me explique o que encontrou e o que vai fazer.**

## Contexto que você precisa saber (estado em 29/09/2026)

- As senhas ficam em `laudos_senhas_importacoes` (um upload por linha) e
  `laudos_senhas_autorizacoes` (uma autorização por upload), gravadas só pela
  função `laudos_senhas_importar`. A tela usa sempre o upload mais recente.
  Migrations: `supabase/migrations/20260930130000_laudos_senhas_assim.sql` e
  `20261001100000_laudos_senhas_meses_fechados.sql` (esta **já aplicada em
  produção** em 29/09/2026).
- **Meses fechados** (regra em vigor): cada autorização tem `competencia` = mês da
  "Data da lista". Num upload, o que é de mês anterior ao corrente (Brasília) é
  copiado intocado do upload anterior e o que o arquivo traz desses meses é
  ignorado; do mês corrente em diante vale o arquivo. As duas tabelas são
  **só-inserção**: service_role tem só SELECT/INSERT e gatilhos recusam
  UPDATE/DELETE/TRUNCATE para qualquer papel. Toda a regra mora no banco.
- Código da regra de status: `frontend/lib/laudos/senhas.ts` (`decidirLado`,
  `calcularSenhasDoLaudo`, `juntarComSenhas`), `frontend/lib/laudos/filtros.ts`
  (`RecorteSenha`, `PREDICADO_RECORTE_SENHA`, `GRAVIDADE_SENHA`,
  `contarKpisSenha`, `RECORTE_SENHA_LABEL`, `DIAS_ALERTA_VENCIMENTO`),
  `frontend/lib/laudos/convenio.ts` (`planoEhLeve`, `convenioTemSenha`).
  Texto e cor: `frontend/components/acompanhamento/laudos/senhaUi.ts`; cartão:
  `CardLaudo.tsx` (`CaixaSenha`); detalhe: `RegistrarAvisoModal.tsx`
  (`SecaoSenhas`); painel: `PainelIndicadores.tsx`. Upload: rota
  `frontend/app/api/acompanhamento-laudos/senhas/route.ts`, serviço
  `frontend/services/laudos/senhas.ts`, permissão `frontend/services/laudos/acesso.ts`,
  modal `UploadSenhasHeader.tsx`, tipos `frontend/types/laudosAcompanhamento.ts`.
  Testes: `frontend/lib/laudos/{senhas,filtros,convenio}.test.ts` (vitest).
- Painel "Senhas ASSIM e LEVE", Visão geral: Senha vigente · Senha vencida ·
  Senha vinculada ao laudo antigo · Sem senha. Fila de ação: Senha pendente ·
  Vence em até 15 dias · Sem validade · Em análise.
- Hoje a LEVE segue a regra da ASSIM. As 5 autorizações LEVE do relatório têm
  senha dentro do ROL, mas liberação e validade vazias, por isso aparecem como
  "Sem validade". Fora do ROL vazio é o normal para elas (especialidades todas
  "Dentro do ROL").

**Regras de trabalho deste projeto (obrigatórias):**
- Rode `git branch --show-current` e `git status` antes de tocar em arquivo;
  nunca trabalhe na `main`. Em 29/09/2026 todo o trabalho de Status Laudos e
  Senhas (Etapas 1–3 daqui, meses fechados, painel de 4 cards) estava na branch
  `laudos-senhas-continuacao`, **sem nenhum commit** — não presuma isso ainda
  vale; confira `git log` e `git status` primeiro. `git add` arquivo por
  arquivo, nunca `-A`/`.`.
- Não há canal para SQL direto nesta máquina. Eu aplico os `.sql` no SQL Editor.
  Entregue migration em `supabase/migrations/` + snippet `*_APLICAR.sql` em
  `supabase/snippets/` (mesmo formato de
  `20261001_laudos_senhas_meses_fechados_APLICAR.sql`: transação, livro-caixa,
  conferências com o resultado ESPERADO escrito). **Nunca `supabase db push`.**
- Teste SQL de verdade com PGlite num diretório do scratchpad
  (`npm i @electric-sql/pglite`), criando antes
  `anon`, `authenticated`, `service_role bypassrls` e `public.usuarios`. Rode a
  migration anterior + a nova, duas vezes (idempotência).
- Snippet cuja ORDEM importa (ex.: abrir a exceção) leva uma trava `RAISE` que
  só passa quando eu edito `false` → `true` — eu aplico todo `.sql` que recebo.
- O localhost grava no banco de PRODUÇÃO. Nunca faça upload por mim.
- Build limpo = pronto para eu testar, não para produção. Merge só depois que eu
  validar. Rode `npm run build` real antes de dizer que está pronto para deploy.
- Meça nos dados reais antes de afirmar (o CSV fica em `C:\Users\Maquina001\Downloads`).

---

## Etapa 0 — Conferir o export novo do TI (antes de qualquer código)

Com o CSV novo, me mostre:
1. O cabeçalho continua com as 27 colunas (o parser recusa coluna faltando)?
   O arquivo passa dos 5 MB (`TAMANHO_MAXIMO` da rota)?
2. Cobertura LEVE: quantos pacientes LEVE ativos a tela tem × quantos aparecem no
   relatório (por `ID favorecido`). Hoje: 2 de 39. Se continuar baixa, **pare e
   me avise** — o problema do export não foi resolvido.
3. Distribuição da "Data da lista" das autorizações LEVE por **dia do mês** (a
   regra abaixo depende de ser 01–07) e por mês.
4. As LEVE continuam sem data de liberação/validade?
5. Laudos com autorizações de **planos diferentes** (paciente que trocou ASSIM ↔
   LEVE): quantos? Se houver, me pergunte antes de decidir a regra deles.

---

## Etapa 1 — Senha LEVE é mensal (só código; não mexe no banco)

**A regra de negócio.** A senha da LEVE autoriza os tratamentos de UM mês: o mês
da "Data da lista". O prazo para registrar é até o **dia 07** desse mês; a partir
do **dia 08** sem a senha do mês, é vencida (confirmado pelo usuário em
29/09/2026 — a redação anterior deste prompt dizia "dia 07 já é vencida", o que
NÃO é mais a regra). A ASSIM não muda nada.

Para um laudo cuja senha é LEVE (autorizações com `plano` LEVE — `planoEhLeve`),
com `hoje` = o `hojeISO` que a tela já usa (servidor, Brasília):

| Situação | Status | Onde aparece |
|---|---|---|
| Existe autorização LEVE com Data da lista **no mês de hoje**, registrada do dia 01 ao 07 | **Senha vigente**, válida até o último dia do mês | Visão geral: Senha vigente |
| Idem, mas a Data da lista é do dia 08 em diante | **Senha vigente, com alerta** "registrada fora do prazo (após 07/MM)". Não conta como problema | Senha vigente (o alerta só no cartão e no detalhe) |
| Hoje é dia **01 a 07**, não há senha do mês, e a mais recente é do **mês anterior** | **Pendente**: "registrar a senha de MM/AAAA até 07/MM" | Fila de ação: Senha pendente |
| Hoje é dia **08 ou depois** e não há senha do mês | **Senha vencida** (problema) | Visão geral: Senha vencida |
| A mais recente é de **dois meses atrás ou mais** (qualquer dia) | **Senha vencida** — o mês anterior já ficou sem senha | Senha vencida |
| Nenhuma autorização LEVE do laudo | igual a hoje: vinculada ao laudo antigo, se houver no laudo anterior do paciente, senão Sem senha | — |

Exemplos que viram teste (cada linha = um caso):

| Hoje | Data da lista mais recente (LEVE) | Esperado |
|---|---|---|
| 29/09/2026 | 03/09/2026 | Vigente até 30/09, no prazo |
| 29/09/2026 | 07/09/2026 | Vigente, no prazo (o dia 07 ainda está no prazo) |
| 29/09/2026 | 15/09/2026 | Vigente, alerta "fora do prazo" |
| 29/09/2026 | 01/08/2026 | Vencida |
| 03/10/2026 | 05/09/2026 | Pendente — registrar até 07/10 |
| 06/10/2026 | 05/09/2026 | Pendente |
| 07/10/2026 | 30/09/2026 | Pendente (o dia 07 ainda está no prazo) |
| 08/10/2026 | 30/09/2026 | Vencida |
| 07/10/2026 | 07/10/2026 | Vigente, no prazo |
| 03/10/2026 | 15/08/2026 | Vencida (setembro ficou sem senha) |
| 29/09/2026 | (nenhuma LEVE) | Sem senha / laudo antigo, como hoje |

Diretrizes de implementação:
- **Um lugar só para a regra**: em `lib/laudos/senhas.ts`, no cálculo do lado
  "dentro". Os cards, a lista filtrada e a ordenação "Urgência da senha" leem o
  status que sai dali; não recalcule em componente. Constante nova ao lado de
  `DIAS_ALERTA_VENCIMENTO` (ex.: `DIA_LIMITE_SENHA_LEVE = 7` — o **último dia do
  prazo**; "vencida" só a partir do dia seguinte, `DIA_LIMITE_SENHA_LEVE + 1`, não
  do próprio `DIA_LIMITE_SENHA_LEVE`. Escreva a comparação como `dia >
  DIA_LIMITE_SENHA_LEVE`, nunca `dia >= DIA_LIMITE_SENHA_LEVE`, para essa troca de
  fronteira não se perder numa edição futura).
- Com várias autorizações LEVE no laudo, vale a de **Data da lista mais recente**
  (empate: "Atualizado em" mais recente). Ela é a que o cartão mostra.
- A validade exibida da LEVE é **derivada** (último dia do mês da Data da lista),
  já que o relatório não a traz. Deixe claro no código e no detalhe que ela é
  calculada, não veio do relatório. A LEVE **não** usa "Vence em até 15 dias":
  senão toda senha LEVE cairia nesse card na segunda quinzena.
- Reaproveite os status existentes (`vigente`, `pendente`, `vencida`) em vez de
  criar card novo; o alerta "fora do prazo" é um campo a mais em `SenhaDoRol`
  (ex.: `registradaForaDoPrazo: boolean`), que não muda nenhuma contagem.
- Textos (`senhaUi.ts`): o cartão da LEVE diz a competência ("Senha de set/2026").
  O pendente diz o prazo. A dica do card "Senha pendente" no painel precisa passar
  a cobrir também "senha LEVE do mês ainda não registrada (prazo dia 07)".
- Testes: todos os exemplos acima + os já existentes continuam passando.
- Meça depois nos dados reais: quantos LEVE ativos em cada status, e me mostre.

---

## Etapa 2 — Estrutura da exceção de substituição completa (banco + código)

**O que eu preciso.** Quando o TI corrigir o export, vou subir um relatório
completo de janeiro a setembro, e ele tem de **substituir tudo**, inclusive os
meses fechados. Isso acontece **uma vez só**. Depois volta o padrão de sempre:
de janeiro até o mês anterior ao corrente, congelado; do mês corrente em diante,
editável.

**O fluxo combinado:** você abre a exceção → eu subo o relatório pela tela e
confirmo → você fecha a exceção e volta ao padrão. A exceção **não tem prazo em
horas**: vale para o próximo upload e se consome sozinha nele.

Desenho recomendado (ajuste se a leitura do código mostrar algo melhor, mas me
explique antes):

1. Tabela `public.laudos_senhas_excecoes`: `id`, `motivo` (obrigatório),
   `pedida_por` (nome), `aberta_em`, `fechada_em`, `fechada_motivo`. RLS ligada e
   forçada, sem policies; nenhum privilégio para anon/authenticated; service_role
   só **SELECT**. Quem abre e fecha é o dono (postgres), pelo SQL Editor — **a
   aplicação sozinha nunca consegue abrir uma exceção.** No máximo uma aberta por
   vez (índice único parcial `where fechada_em is null`).
2. `laudos_senhas_importacoes` ganha `excecao_id` (FK, **único**: uma exceção
   serve a um upload só) e `modo` (`padrao` | `substituicao_completa` | `primeira`).
3. `laudos_senhas_importar`: depois do lock e da checagem de duplicado, procura
   uma exceção aberta e ainda não usada. Havendo, **não copia nada da base e
   aplica o arquivo inteiro** (o mesmo caminho de "primeira importação"), grava
   `excecao_id`/`modo` e devolve isso no JSON. Nada é apagado: o upload anterior
   continua no histórico (as tabelas seguem só-inserção, sem desligar gatilho).
   Arquivo duplicado (mesmo sha256) **não** consome a exceção.
4. Aviso na tela ANTES do upload: com exceção aberta, a leitura da tela (meta, só
   para quem tem acesso às senhas) informa, e o botão "Atualizar senhas" pede uma
   confirmação explícita: "Este upload vai SUBSTITUIR TODOS OS MESES, inclusive os
   fechados (exceção: <motivo>)". Sem exceção aberta, nada muda na tela.
5. Modal de resultado: no modo substituição completa, dizer isso em destaque, com
   quantas autorizações entraram e quantas do upload anterior saíram.
6. Testes no PGlite: sem exceção = regra de meses fechados intacta (repita os
   cenários de 29/09 e 01/10 da migration 20261001100000); com exceção = arquivo
   inteiro aplicado, inclusive meses fechados; a exceção não serve a um segundo
   upload; duplicado não a consome; service_role não consegue inserir nem alterar
   exceção; anon/authenticated não leem nada.

Entregue: migration + `*_APLICAR.sql` da ESTRUTURA (cria tudo, **não abre
exceção nenhuma** — aplicar não muda o comportamento), e o código. Eu aplico,
valido na tela que nada mudou e só então seguimos.

---

## Etapa 3 — Usar a exceção (uma vez) e voltar ao padrão

1. Você me entrega `*_ABRIR_EXCECAO.sql`: insere UMA exceção com motivo
   ("Reimportação completa jan–set/2026 após correção do export LEVE pelo TI") e
   quem pediu. Com trava `RAISE` que só passa editando `false` → `true`, e
   conferência mostrando a exceção aberta.
2. Eu aplico, confiro o aviso na tela e subo o relatório completo.
3. Eu te aviso. Você confere (pelos dados que conseguir ler + uma conferência SQL
   que eu rodo): o upload saiu em `modo = substituicao_completa`, com
   `excecao_id` preenchido, e o total bate com o número de autorizações do CSV
   (compare com o CSV via Python). Me mostre a cobertura LEVE e os números do
   painel depois da troca.
4. Você me entrega `*_FECHAR_EXCECAO.sql`: marca `fechada_em`/`fechada_motivo` em
   qualquer exceção aberta (usada ou não), e confere: nenhuma exceção aberta, e o
   corte atual (`laudos_senhas_mes_corte()`) de volta como régua.
5. Depois de fechada, o próximo upload normal volta a ignorar os meses fechados —
   isso já está coberto pelo teste do PGlite; confirme com a conferência SQL que
   não há exceção disponível.

Ao final, atualize a memória do projeto com o que ficou (exceção usada, data,
upload resultante) e me diga o que ainda falta para eu fazer merge.
