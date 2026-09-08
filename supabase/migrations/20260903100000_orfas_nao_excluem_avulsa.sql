-- =============================================================================
-- A guia de uma AVULSA volta a ser órfã — porque avulsa é, por definição, a
-- autorização sem sessão
-- =============================================================================
--
-- O CASO QUE ABRIU ISTO
-- Miguel França De Castro, guias 26905 (01/09 17:36) e 59323 (03/09 09:48),
-- ambas TUSS 22070384, status 'Liberado', nenhuma triada. As duas foram tiradas
-- pela recepção como AVULSAS e, na Reconciliação, apareciam rotuladas "Outra
-- semana" sem oferecer o botão de vincular. A operação precisa vinculá-las a
-- glosas — é para isso que elas foram tiradas.
--
-- A CAUSA
-- O último `not exists` de get_guias_orfas (20260824010000:122-127) descarta
-- toda guia que tenha linha em `fila_autorizacoes` com o mesmo número e
-- `horario_autorizacao` dentro de ±5 min do `data_execucao`. A intenção,
-- registrada em 20260825130000:223, é "não repescar guia que o próprio Pulsar
-- capturou" — e o raciocínio de lá foi: "a guia de uma avulsa FOI capturada
-- pelo Pulsar, então ela tem de sair da fila de órfãs".
--
-- Esse raciocínio confunde DUAS coisas diferentes:
--
--   guia capturada numa linha de SESSÃO  -> já está reconciliada, pois a linha
--                                           da fila É a sessão que ela cobre.
--                                           Excluir está certo.
--   guia capturada numa linha AVULSA     -> não está reconciliada com NADA:
--                                           avulsa é a solicitação que não
--                                           corresponde a sessão nenhuma
--                                           (20260825130000:54). Excluir some
--                                           com o único caso que SEMPRE precisa
--                                           de vínculo manual.
--
-- Ou seja: o filtro tratava "o Pulsar tirou" como sinônimo de "já reconciliada",
-- e para a avulsa isso é falso. A regra da operação é mais simples do que o
-- filtro: guia sem sessão vinculada tem de oferecer o vínculo, não importa quem
-- a tirou.
--
-- A CORREÇÃO
-- Uma linha: o `not exists` passa a olhar só as linhas NÃO avulsas.
--
--     and fa.avulsa = false
--
-- `avulsa` é `boolean NOT NULL DEFAULT false` (20260825130000:50), então esta
-- comparação não tem armadilha de NULL — que num filtro de exclusão seria
-- exatamente o bug que aquela migration se deu o trabalho de evitar.
--
-- O que NÃO muda:
--   * a qualificação por tempo continua (o número da guia da ASSIM recicla —
--     reference_guia_assim_nao_e_unica), e continua escrita como `between` sobre
--     a coluna crua para caber em idx_fila_autorizacoes_guia_horario;
--   * `fa.avulsa = false` é um predicado de igualdade sobre coluna da mesma
--     tabela, avaliado dentro do mesmo index scan — não custa nada, e o
--     statement_timeout de 15s segue de pé;
--   * a divisão entre o que fica na CTE `guias` (afeta o row_number) e o que
--     fica no WHERE externo (só classifica) é idêntica. O `avulsa` entra no
--     WHERE externo, que é onde a exclusão que ele corrige já vivia.
--
-- BLAST RADIUS MEDIDO (03/09/2026, produção)
-- 8 linhas avulsas na tabela inteira, 6 concluídas com guia: 26905, 59323,
-- 54950, 36978, 36706, 26824 — todas de 01 a 03/09. A página de avulsas é de
-- 25/08, então isto não desenterra histórico: passam a aparecer na fila de
-- órfãs, para triagem, as avulsas que ainda não foram triadas. Cada uma segue
-- sujeita aos outros filtros da RPC (status 'Liberado', TUSS não nulo,
-- ordem_autorizacao > sessões da partição), e triar qualquer uma delas — vincular
-- ou marcar "sem sessão" — a tira da fila pelo `not exists` de
-- autorizacoes_vinculos, como qualquer outra guia.
--
-- POR QUE NÃO PRECISOU MEXER NO RESTO
-- `vincular_autorizacao` (20260821000000:541-681) já aceitaria estas guias: os
-- seus guardas não exigem que a guia esteja na fila de órfãs, e sessão em
-- `situacao='GLOSA'` é alvo ELEGÍVEL e de prioridade máxima em
-- get_candidatas_vinculo (20260821010000:139,154-161). Só a UI não oferecia o
-- caminho, e ela o oferece a partir de `estado='sem-vinculo'`
-- (useAnaliseReincidencia.ts:308-318), que é lido desta RPC. Corrigida a RPC, o
-- botão "Ver as sessões que esta guia pode cobrir" volta a aparecer sozinho.
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
-- o proconfig posto de fora, calado (20260817:CREATE OR REPLACE perde proconfig).
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
    -- Nada de filtro de `status` aqui: o WHERE roda antes da função de janela, e
    -- tirar a glosa da partição faria a liberação posterior virar ordem 1 e
    -- deixar de ser excedente — o caso da Kourtney desapareceria da tela.
    -- `status` e `codigo_tuss` são filtrados no WHERE final.
    where aa.data_execucao is not null      -- há 2 linhas de teste em produção
                                            -- (TESTE123/TESTE999) com tudo nulo
      and date(aa.data_execucao) between p_de and p_ate
      -- Idêntica à da CTE `autorizacoes` de get_auditoria_assim_periodo
      -- (20260821030000): guia já triada não compete por posição. Se as duas
      -- divergirem, a Reconciliação oferece guia que a Conferência já casou.
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
    -- e não é guia que o próprio Pulsar capturou PARA UMA SESSÃO. Comparação
    -- SEMPRE qualificada por tempo: o número da guia recicla
    -- (20260805170300:99-107). Escrita como faixa sobre a coluna crua, e não como
    -- `abs(extract(epoch ...)) <= 300`, para caber em
    -- idx_fila_autorizacoes_guia_horario (20260824000000).
    and not exists (
      select 1 from public.fila_autorizacoes fa
      where fa.numero_autorizacao = g.guia
        and fa.horario_autorizacao between g.data_execucao - interval '5 minutes'
                                       and g.data_execucao + interval '5 minutes'
        -- A linha AVULSA não conta como captura: ela não representa sessão
        -- nenhuma (20260825130000:54), então a guia dela não está reconciliada
        -- com nada e é justamente a que precisa de vínculo manual. Sem este
        -- termo, a única guia que SEMPRE precisa de triagem era a única que
        -- nunca chegava à fila — calada, rotulada "Outra semana".
        and fa.avulsa = false
    )
  order by g.data_execucao desc, g.guia
$$;

comment on function public.get_guias_orfas(date, date) is
  'Guias ASSIM liberadas que sobraram do match posicional e ainda não foram triadas. Numera sobre o mesmo pool que get_auditoria_assim_periodo — guia triada sai antes do row_number(), senão as duas telas discordam. A janela de 5 min contra a fila é `between` sobre a coluna crua, para usar idx_fila_autorizacoes_guia_horario, e ignora as linhas avulsas: a avulsa não representa sessão, logo a guia dela não está reconciliada e continua órfã.';
