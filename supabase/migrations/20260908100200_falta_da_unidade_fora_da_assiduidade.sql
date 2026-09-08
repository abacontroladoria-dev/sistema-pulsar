-- Feriado não é falta do paciente: tirar 'unidade' dos indicadores de assiduidade.
--
-- Depende de 20260908100000 (motivo_falta) e 20260908100100 (as RPCs do lote).
--
-- ─── O problema ─────────────────────────────────────────────────────────────
--
-- Até aqui tipo_falta só tinha 'paciente' e 'terapeuta'. Uma sessão perdida por
-- feriado caía em 'paciente' — o default —, então o paciente aparecia faltando
-- num dia em que a clínica não abriu. Isso entra no KPI de faltas, na fila de
-- reposição e no rótulo da Central como se fosse ausência dele.
--
-- 'unidade' (20260908100000) é a terceira categoria. Esta migration ensina as
-- leituras a distingui-la.
--
-- ─── Por que não um status novo ─────────────────────────────────────────────
--
-- Porque seis leituras decidem por EXCLUSÃO, não por inclusão:
--
--   presencaReal.ts        `status !== 'falta'`     → feriado vira PAGO
--   sync_assim_results     `status NOT IN (...)`    → cron sobrescreve com 'glosa'
--   mostrar_na_tela        `ELSE true`              → card nunca sai da /solicitar
--   status_operacional     `ELSE COALESCE(status)`  → string crua vaza para a tela
--   tv/chamadas            `.not('status','in',…)`  → nome some do painel
--   ma_consumos_falta      `status = 'falta'`       → consumo eterno na Auditoria
--
-- Um valor novo em `status` passaria por todas elas em silêncio. Mantendo
-- status='falta', tudo que funciona continua funcionando, e quem precisa
-- distinguir passa a olhar tipo_falta explicitamente. O custo é este arquivo;
-- o do status novo seria seis caminhos de falha silenciosa, um deles pagando
-- sessão que não houve.
--
-- ─── O que esta migration NÃO faz ───────────────────────────────────────────
--
-- Não toca em remuneração. Decisão do negócio: no feriado o terapeuta não
-- recebe pela sessão, igual a uma falta comum — que é o comportamento de hoje.
-- presencaReal.ts fica intocado de propósito.
--
-- Não recria vw_central_pacientes nem listar_central_pacientes. As duas trazem
-- o CASE de status_operacional que testa tipo_falta antes do status, e uma
-- sessão de feriado sairia de lá como 'falta_paciente'. O certo seria acrescentar
-- um ramo 'falta_unidade' — mas a definição vigente delas está em disputa entre
-- 20260825130000 e o snippet 20260831_forma_autorizacao_da_guia_sem_fila.sql
-- (que não consta no livro-caixa do README), e recriá-las a partir do arquivo
-- errado REGREDIRIA a correção de forma_autorizacao. Enquanto isso não for
-- resolvido, o frontend trata 'falta_paciente' + tipo_falta='unidade' como
-- feriado (lib/central/severity.ts), o que dá o rótulo certo na tela sem
-- arriscar a regressão. Ver o TODO no fim deste arquivo.
--
-- Rollback:
--   drop function if exists public.get_faltas_auditoria_assim(date, date);  -- e recriar da 20260611000009
--   -- o índice pode ficar: só acelera, não muda resultado

-- ---------------------------------------------------------------------------
-- 1. Índice para as leituras que passam a filtrar por tipo_falta
-- ---------------------------------------------------------------------------
-- Parcial: só linhas de falta interessam, e elas são uma fração da tabela.
create index if not exists idx_fila_autorizacoes_falta_tipo
  on public.fila_autorizacoes (data_atendimento, tipo_falta)
  where status = 'falta';

-- ---------------------------------------------------------------------------
-- 2. get_faltas_auditoria_assim — já exclui 'unidade' por construção
-- ---------------------------------------------------------------------------
-- A função filtra `tipo_falta ILIKE '%paciente%' OR ILIKE '%terapeuta%'`
-- (20260611000009), então 'unidade' fica de fora sozinha. Nada a mudar aqui —
-- registrado para quem for auditar a lista de consumidores.

-- ---------------------------------------------------------------------------
-- 3. kpi_faltas — já exclui 'unidade' por construção
-- ---------------------------------------------------------------------------
-- cache_dashboard_kpis.sql filtra `fa.tipo_falta = 'paciente'`. Igualdade
-- estrita, então feriado não entra no KPI. Também nada a mudar.

-- ---------------------------------------------------------------------------
-- 4. Contagem de faltas do paciente, para quem precisar
-- ---------------------------------------------------------------------------
-- Função de conveniência: a pergunta "quantas faltas este paciente teve" tem
-- uma resposta certa e várias erradas. Deixá-la escrita em um lugar evita que
-- cada tela reinvente o filtro — e esqueça 'unidade', que é o erro que esta
-- entrega existe para corrigir.
create or replace function public.contar_faltas_do_paciente(
  p_paciente_id text,
  p_de          date,
  p_ate         date
)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
  from public.fila_autorizacoes
  where paciente_id = p_paciente_id
    and data_atendimento between p_de and p_ate
    and status = 'falta'
    -- Só ausência DO PACIENTE. 'terapeuta' é falha da escala e 'unidade' é dia
    -- em que a clínica não abriu — nenhum dos dois é assiduidade dele.
    and tipo_falta = 'paciente'
    -- Falta desfeita não conta: alguém já reconheceu que foi engano.
    and falta_revertida_em is null;
$$;

comment on function public.contar_faltas_do_paciente(text, date, date) is
  'Faltas atribuíveis ao paciente num intervalo. Exclui tipo_falta ''terapeuta'' e '
  '''unidade'' (feriado/ponto facultativo/falta de energia) e as faltas revertidas. '
  'Use esta função em vez de contar status = ''falta'' na mão: é o filtro que '
  'esquecer ''unidade'' faz o paciente aparecer faltando em dia de clínica fechada.';

grant execute on function public.contar_faltas_do_paciente(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- TODO — status_operacional ainda não conhece 'unidade'
-- ---------------------------------------------------------------------------
-- vw_central_pacientes e listar_central_pacientes classificam por
--
--     WHEN fa.tipo_falta = 'terapeuta' THEN 'falta_terapeuta'
--     WHEN fa.tipo_falta = 'paciente'  THEN 'falta_paciente'
--
-- Uma linha com tipo_falta='unidade' não casa em nenhum dos dois e escorrega até
-- o `ELSE COALESCE(fa.status, 'pendente')`, saindo como 'falta' cru na API.
-- O frontend cobre esse caso (severity.ts reconhece 'falta' + motivo de unidade
-- e rotula "Unidade fechada"), então a tela fica correta.
--
-- O conserto no banco é acrescentar, ANTES dos dois ramos acima:
--
--     WHEN fa.tipo_falta = 'unidade' THEN 'falta_unidade'
--
-- nas DUAS cópias. Não foi feito aqui porque exige recriar os dois objetos
-- inteiros e a definição vigente está em disputa (ver cabeçalho). Antes de
-- fazer: extrair a definição REAL de produção com pg_get_viewdef /
-- pg_get_functiondef e partir dela, nunca do arquivo mais recente do repo.
