-- =============================================================================
-- APLICAR NO SQL EDITOR — guia de avulsa volta a ser órfã (vinculável a glosa)
-- 2026-09-03
-- =============================================================================
--
-- POR QUE
-- Guia sem sessão vinculada tem de oferecer o vínculo. As guias tiradas como
-- AVULSAS não ofereciam: get_guias_orfas as excluía por casarem com a própria
-- linha avulsa em fila_autorizacoes (janela de ±5 min), sob a regra "não repescar
-- guia que o Pulsar capturou". Mas avulsa não representa sessão nenhuma — a guia
-- dela não está reconciliada com nada. Resultado: a única guia que SEMPRE precisa
-- de triagem era a única que nunca chegava à fila, e a tela a rotulava
-- "Outra semana" sem botão de vincular.
--
-- CASO DE ORIGEM
-- Miguel França De Castro, guias 26905 (01/09 17:36) e 59323 (03/09 09:48),
-- TUSS 22070384, ambas 'Liberado', nenhuma triada, ambas para vincular a glosa.
--
-- O QUE MUDA
-- Uma cláusula em get_guias_orfas: o `not exists` contra fila_autorizacoes passa
-- a ignorar as linhas avulsas (`and fa.avulsa = false`). Nada mais.
-- Detalhamento completo do raciocínio na migration de mesmo nome:
--   supabase/migrations/20260903100000_orfas_nao_excluem_avulsa.sql
--
-- IMPACTO MEDIDO ANTES DE APLICAR (produção, 03/09/2026)
-- 8 linhas avulsas na tabela inteira; 6 concluídas com guia — 26824, 26905,
-- 36706, 36978, 54950, 59323, todas de 01 a 03/09. Cada uma casou com EXATAMENTE
-- UMA linha na janela, e todas com avulsa=true: nenhuma guia normal muda de
-- classificação. A página de avulsas é de 25/08, então isto não desenterra
-- histórico.
--
-- CONTRAPROVA JÁ FEITA
-- get_candidatas_vinculo('26905') e ('59323') já devolvem as duas glosas do
-- Miguel de 01/09 (09:20 guia 4006 e 10:00 guia 6203) com elegivel=true e
-- ja_vinculado=false, em primeiro lugar na ordenação. O vínculo é possível no
-- banco desde sempre — só a UI não oferecia o caminho.
--
-- COMO VERIFICAR DEPOIS DE APLICAR
-- Rodar o BLOCO DE VERIFICAÇÃO no fim deste arquivo. Depois, na tela:
--   /auditoria-assim/?tab=reconciliacao -> abrir a semana do Miguel França De
--   Castro -> o cartão da guia 26905 deve ler "Sem vínculo" (não "Outra semana")
--   e mostrar o botão "Ver as sessões que esta guia pode cobrir".
--
-- NADA A FAZER NO FRONTEND: o botão é derivado de `estado='sem-vinculo'`, que é
-- lido desta RPC.
-- =============================================================================

create or replace function public.get_guias_orfas(p_de date, p_ate date)
returns table (
  guia                text,
  carteirinha         text,
  paciente_id         bigint,
  paciente_nome       text,
  data_execucao       timestamp without time zone,
  codigo_tuss         text,
  status              text,
  teve_token          boolean,
  token               text,
  biofacial           text,
  ordem_autorizacao   bigint,
  sessoes_na_particao bigint
)
language sql
stable
security definer
set search_path = public
-- Declarado aqui dentro, e não por ALTER FUNCTION: `create or replace` descarta
-- o proconfig posto de fora, calado.
set statement_timeout = '15s'
as $$
  with n_sessoes as (
    select b.empresa, b.matricula, b.dep, b.data_atendimento, b.codigo_tuss,
           count(*) as n
    from public.fn_blocos_assim(p_de, p_ate) b
    group by 1,2,3,4,5
  ),
  guias as (
    select
      aa.guia,
      aa.matricula as carteirinha,
      aa.paciente_id,
      aa.paciente_nome,
      aa.data_execucao,
      aa.codigo_tuss,
      aa.status,
      aa.teve_token,
      aa.token,
      aa.biofacial,
      split_part(aa.matricula, '.', 1) as empresa,
      split_part(aa.matricula, '.', 2) as matricula_base,
      split_part(aa.matricula, '.', 3) as dep,
      row_number() over (
        partition by split_part(aa.matricula,'.',1), split_part(aa.matricula,'.',2),
                     split_part(aa.matricula,'.',3), date(aa.data_execucao), aa.codigo_tuss
        order by aa.data_execucao
      ) as ordem_autorizacao
    from public.autorizacoes_assim aa
    where aa.data_execucao is not null
      and date(aa.data_execucao) between p_de and p_ate
      and not exists (
        select 1 from public.autorizacoes_vinculos v
        where v.guia = aa.guia and v.desfeito_em is null
      )
  )
  select
    g.guia, g.carteirinha, g.paciente_id, g.paciente_nome, g.data_execucao,
    g.codigo_tuss, g.status, g.teve_token, g.token, g.biofacial,
    g.ordem_autorizacao, coalesce(ns.n, 0) as sessoes_na_particao
  from guias g
  left join n_sessoes ns
    on  ns.empresa          = g.empresa
    and ns.matricula        = g.matricula_base
    and ns.dep              = g.dep
    and ns.data_atendimento = date(g.data_execucao)
    and ns.codigo_tuss      = g.codigo_tuss
  where g.status = 'Liberado'        -- 'Liberado *' = cancelada; o resto é glosa
    and g.codigo_tuss is not null
    and g.ordem_autorizacao > coalesce(ns.n, 0)
    and not exists (
      select 1 from public.fila_autorizacoes fa
      where fa.numero_autorizacao = g.guia
        and fa.horario_autorizacao between g.data_execucao - interval '5 minutes'
                                       and g.data_execucao + interval '5 minutes'
        -- <<< A MUDANÇA: a linha AVULSA não conta como captura, porque não
        -- representa sessão nenhuma. Sem isto, a guia que mais precisa de
        -- vínculo era a única que nunca chegava à fila.
        and fa.avulsa = false
    )
  order by g.data_execucao desc, g.guia
$$;

comment on function public.get_guias_orfas(date, date) is
  'Guias ASSIM liberadas que sobraram do match posicional e ainda não foram triadas. Numera sobre o mesmo pool que get_auditoria_assim_periodo — guia triada sai antes do row_number(), senão as duas telas discordam. A janela de 5 min contra a fila é `between` sobre a coluna crua, para usar idx_fila_autorizacoes_guia_horario, e ignora as linhas avulsas: a avulsa não representa sessão, logo a guia dela não está reconciliada e continua órfã.';


-- -----------------------------------------------------------------------------
-- BLOCO DE VERIFICAÇÃO — rodar depois de aplicar (somente leitura)
-- -----------------------------------------------------------------------------

-- 1. As duas guias do Miguel têm de aparecer agora.
--    Antes de aplicar: 0 linhas nos dois dias. Depois: 1 linha em cada.
select 'guia 26905 (01/09)' as caso, count(*) as linhas,
       case when count(*) = 1 then 'OK — virou órfã, é vinculável'
            else 'FALHOU — continua fora da fila' end as veredito
from public.get_guias_orfas(date '2026-09-01', date '2026-09-01')
where guia = '26905'
union all
select 'guia 59323 (03/09)', count(*),
       case when count(*) = 1 then 'OK — virou órfã, é vinculável'
            else 'FALHOU — continua fora da fila' end
from public.get_guias_orfas(date '2026-09-03', date '2026-09-03')
where guia = '59323';

-- 2. As 6 avulsas concluídas, e mais nada de novo, na janela 01–03/09.
select o.data_execucao, o.guia, o.paciente_nome, o.codigo_tuss,
       o.ordem_autorizacao, o.sessoes_na_particao
from public.get_guias_orfas(date '2026-09-01', date '2026-09-03') o
order by o.data_execucao, o.guia;

-- 3. Contraprova de que a guia NORMAL capturada pelo Pulsar continua excluída.
--
--    ATENÇÃO AO DESENHO DESTE TESTE. A primeira versão dele pegava UMA linha
--    não-avulsa com `order by horario_autorizacao desc limit 1` — e caía numa
--    linha com `numero_autorizacao = 'N/A'`. Em 03/09, 22 de 40 linhas
--    não-avulsas recentes tinham esse valor. O join dava 0 porque não existe
--    guia chamada 'N/A' em autorizacoes_assim, e o teste "passava" sem ter
--    testado nada — passaria igual se a correção estivesse errada.
--
--    Por isso aqui: (a) exige `numero_autorizacao ~ '^\d+$'`, (b) exige que a
--    guia EXISTA em autorizacoes_assim na janela, e (c) testa o CONJUNTO todo em
--    vez de uma linha sorteada. Rodado em 03/09: 125 guias de sessão conferidas,
--    nenhuma na fila.
with normais as (
  select distinct fa.numero_autorizacao as guia
  from public.fila_autorizacoes fa
  where fa.avulsa = false
    and fa.status = 'concluido'
    and fa.numero_autorizacao ~ '^\d+$'   -- 'N/A' e afins ficam de fora
    and fa.horario_autorizacao >= date '2026-09-01'
),
existentes as (          -- só as que de fato são guia da ASSIM na janela
  select distinct aa.guia
  from public.autorizacoes_assim aa
  join normais n on n.guia = aa.guia
  where date(aa.data_execucao) between date '2026-09-01' and date '2026-09-03'
),
na_fila as (
  select o.guia
  from public.get_guias_orfas(date '2026-09-01', date '2026-09-03') o
  join existentes e on e.guia = o.guia
)
select
  (select count(*) from existentes) as guias_de_sessao_testadas,
  (select count(*) from na_fila)    as quantas_entraram_na_fila,
  case when (select count(*) from na_fila) = 0
    then 'OK — nenhuma guia de sessão entrou na fila (a mudança é só para avulsa)'
    else 'ATENÇÃO — guia normal entrou na fila; revisar' end as veredito;

-- 4. As avulsas que NÃO aparecerem na fila não são necessariamente um problema:
--    o filtro do excedente (`ordem_autorizacao > sessões da partição`) é anterior
--    e independente desta correção. Caso real de 03/09: a guia 36706 (Ysadora)
--    ficou fora porque é ordem 1 numa partição com 1 sessão — ela JÁ está casada
--    com a sessão dela pelo match posicional, então não há o que vincular. Este
--    bloco mostra, para cada avulsa com guia, se ela é excedente ou já casou.
select
  fa.numero_autorizacao as guia,
  aa.paciente_nome,
  aa.data_execucao,
  aa.status,
  (select count(*) from public.autorizacoes_assim x
    where x.matricula = aa.matricula
      and x.codigo_tuss = aa.codigo_tuss
      and date(x.data_execucao) = date(aa.data_execucao)
      and x.data_execucao <= aa.data_execucao)          as ordem_na_particao,
  (select coalesce(sum(b.quantidade_sessoes), 0)
     from public.fn_blocos_assim(date(aa.data_execucao), date(aa.data_execucao)) b
    where b.empresa     = split_part(aa.matricula,'.',1)
      and b.matricula   = split_part(aa.matricula,'.',2)
      and b.dep         = split_part(aa.matricula,'.',3)
      and b.codigo_tuss = aa.codigo_tuss)               as sessoes_na_particao,
  case when exists (
         select 1 from public.get_guias_orfas(date(aa.data_execucao), date(aa.data_execucao)) o
         where o.guia = fa.numero_autorizacao)
    then 'NA FILA — vinculável'
    else 'fora da fila — já casada por posição, ou não-excedente' end as veredito
from public.fila_autorizacoes fa
join public.autorizacoes_assim aa on aa.guia = fa.numero_autorizacao
where fa.avulsa = true
  and fa.numero_autorizacao ~ '^\d+$'
  and date(aa.data_execucao) = fa.data_atendimento
order by aa.data_execucao desc;
