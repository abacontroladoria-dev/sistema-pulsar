# Plano — Faturamento e Financeiro (ex-AXIUM) dentro do Pulsar

Atualizado em 23/10/2026. Substitui `AXIUM_MIGRACAO.md`, que trata do AXIUM antigo (insumos, NestJS).

## Decisões

- O AXIUM (Faturamento de convênios e Financeiro) vira parte do Pulsar e perde o nome. As telas entram na área **Financeiro** do seletor (`AREA_DO_ITEM` em `frontend/lib/permissions/menu.ts`), cada uma com seu código de permissão.
- Layout, login e acessos: os do Pulsar. Nada da casca, seletor ou 2FA do AXIUM.
- Cadastros (pacientes, profissionais, convênios, terapias): só no Pulsar. O faturamento usa FK para eles.
- Banco: Supabase do Pulsar. Tabelas novas criadas lá, em migrations no padrão do Pulsar. O Supabase do AXIUM só é origem da migração de dados.
- Objetivo de engenharia: **otimizar** para o Pulsar (pool de 10 conexões, Disk IO, corte de 1.000 linhas do PostgREST, build na VPS).
- **Modalidade** é dimensão separada da unidade: Clínica, AT Externo, Terceirizada. Só Clínica tem unidade e entra no rateio por unidade. AT Externo aparece como coluna própria nos painéis.
- **Sessão realizada = presença e evolução batendo** (decisão da direção, 23/10). Faltou uma das duas, a sessão é inconsistência e aparece no lançamento (alerta) e na tela de conferência. **Sessão inconsistente não conta como realizada** até ser resolvida (direção, 23/10).

## Fontes de dado

| Dado | Fonte no Pulsar |
|---|---|
| Evolução | Grade (`status_execucao = 'Realizado'`, equivalente a ter tratativa) |
| Presença, terapia do ROL | `fila_autorizacoes` com status `concluido` ou `glosa` |
| Presença, terapia fora do ROL | CSV de Presença do TiTa, importado só para essas terapias, até o app de evoluções registrar presença |
| Convênio da sessão | `pacientes_convenio_vigencias` pela data (a grade nova não tem convênio) |
| Modalidade e unidade | Atributo da **terapia** primeiro, depois tabela sala→unidade/modalidade |
| Sessões enviadas, NF, pagamento, glosa | Tabelas novas do faturamento (porte do AXIUM) |

Terapias fora do ROL da ANS não passam pela `/solicitar`, então não têm linha na fila. Hoje essa informação não está num lugar só: a `BLACKLIST_AUTORIZACAO` tem 12 nomes e não inclui Fisioterapia Aquática, Avaliação Neuropsicológica, Coordenador de Caso, Equoterapia e Psiquiatra/Neurologista. Proposta: atributo por terapia "exige presença na fila", configurável no cadastro.

## Casamento presença × evolução

1. Pelo `tita_agendamento_id`.
2. O que sobrar: por paciente + dia + terapia, por quantidade. O pareamento sessão↔guia do Pulsar é posicional e troca ids quando há várias sessões no dia.
3. O que ainda sobrar é inconsistência: "presença sem evolução" ou "evolução sem presença".

## Medições (setembro/2026, produção)

- AXIUM: 11.402 previstas, 9.043 realizadas, 314 pacientes. Pulsar: 8.362 realizadas (−7,5%).
- Amostra de 100 pacientes: todos casam pelo ID do TiTa; 50 com contagem igual; 24 das 40 diferenças são evolução pendente.
- Grade × fila: 6.207 ok, 79 glosa, 2.299 faltas coerentes, **79 presença sem evolução**, **29 evolução sem presença**, 2.038 evolução sem fila.
- Das 2.038: 1.759 AT Externo; das 279 restantes, 143 são falha de pareamento (fila do mesmo paciente no mesmo dia), 104 são Aplicador ABA Escola em sala da clínica e o resto são terapias fora do ROL ou falta real de registro.
- Cadastro: convênios com registro ANS 5 de 18; pacientes com carteirinha 389 de 644; pacientes sem ID do TiTa 2 de 644.
- Nomes de convênio divergem entre as fontes ("SULAMERICA" e "Sul América"). A sala vem no mesmo formato nas duas grades ("Unid. Realengo - Sala X", "AT Externo Escola"); o `local_id` da grade nova está vazio em 100% das linhas (medido em 23/10).

## No AXIUM, para que serve o realizado

Não gera faturamento: quem gera é **sessões enviadas** (manual ou XML TISS). O realizado alimenta os alertas R01, R02, R04 e R05, o Valor Total Realizado, o rateio por unidade e o Controle Gerencial.

## Fases

0. **Saneamento do cadastro:** registro ANS dos convênios, carteirinhas, atributos da terapia (modalidade e "exige fila"), tabela sala→unidade, de-para de convênio.
   Andamento (23/10): carteirinha vem do cadastro do TiTa (20261023160000/170000; os 6 sem carteirinha são inativos sem carteirinha no TiTa); `cadastro_terapias.modalidade` e `exige_presenca_fila` (20261023180100); `convenio_aliases` + `convenio_id_por_nome()` (20261023190100; MEMORIAL→ASSIM, UNIMED RIO→UNIMED FERJ, nenhuma grafia sem par); `unidade_da_sala()` e `modalidade_da_sala()` (20261023200000). Registro ANS preenchido em todas as operadoras (23/10, por SQL; FuSEx é assistência militar, sem ANS). Falta: decidir Fundação Itaú (só no AXIUM).
1. **Fundação:** empresas e unidades (`empresas` e `usuarios_empresas` já existem em produção), RLS por empresa via `auth.uid()`.
2. **Schema do faturamento:** lançamento, NF, pagamento, glosa, preços com vigência, prazos e retenção. Absorve `previsao_receitas_faturamento` e unifica com `cronograma_convenio_valores`.
3. **Conferência presença × evolução:** função SQL incremental (mês corrente e anterior), alerta R11 no lançamento e tela de conferência sessão a sessão.
4. **Telas do faturamento** na área Financeiro, uma por etapa, com componentes do Pulsar.
5. **Financeiro** (contas a pagar, crédito, rateio, extrato).
6. **Migração dos dados e corte:** cópia do Supabase do AXIUM casando pelo ID do TiTa, conferência dos totais mês a mês, AXIUM em somente leitura e depois desligado.

## Otimizações obrigatórias

- Cálculo da lista de lançamentos e dos painéis em RPC, devolvendo só a página ou os totais.
- Uma ida ao banco por tela; índices desde a primeira migration; RLS com `(select auth.uid())`.
- Snapshot só do fechamento mensal (não repetir `previsao_receitas_historico`, que tem 1 milhão de linhas).
- Parsers de XML e .xlsx com `import()` dinâmico.
- `pg_stat_statements` antes e depois de cada tela.

## Pendências

- Operação: lista definitiva das terapias fora do ROL; se Coordenador de Caso e Psiquiatra/Neurologista são faturados ao convênio.
- Segurança: segundo fator na área Financeiro e trilha de auditoria LGPD.
