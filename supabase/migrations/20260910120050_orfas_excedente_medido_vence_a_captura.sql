-- =============================================================================
-- "O Pulsar capturou" só significa "reconciliada" quando a partição não tem
-- sessão sobrando — excedente MEDIDO volta a ser órfã
-- =============================================================================
--
-- O CASO QUE ABRIU ISTO
-- Ysadora Corcino Aranda Da Costa, 02/09, TUSS 22070384. Duas guias liberadas:
--
--   36706  11:04  avulsa=true   "Realizando a autorização novamente a pedido da
--                                Victória pois a anterior deu reincidência."
--   48470  15:38  avulsa=false  tita_agendamento_id=2395460, sessão das 15:40
--
-- Uma sessão só na partição (`11742_2026-09-02_22070384_15:40:00`). A 48470
-- aparecia na Reconciliação rotulada "Não identificada", sem oferecer o botão de
-- vincular — e ela é precisamente a reautorização da GLOSA 1601 de 01/09 15:40
-- (guia 20893): `get_candidatas_vinculo('48470')` já devolve essa sessão como a
-- única candidata elegível, prioridade máxima. A operação precisa vinculá-la;
-- só a UI não oferecia o caminho.
--
-- A CAUSA — a inversão que o `row_number()` produz
-- A ordem é por `data_execucao`, então a AVULSA das 11:04 ficou ordem 1 e a guia
-- normal das 15:38 ficou ordem 2. Com `n = 1`, quem sobra do match posicional é
-- a 48470 — a certa, porque a avulsa é a que por definição não cobre sessão. Mas
-- a 48470 é a única das duas que tem linha de SESSÃO na fila, e é justamente
-- essa linha que o último `not exists` usa para descartá-la ("guia que o próprio
-- Pulsar capturou"). Resultado: as duas saem da fila de órfãs — uma pelo
-- `avulsa = false` de 20260903100000, a outra por captura — e a tela cai no
-- `else` que rotula "Não identificada".
--
-- O filtro pressupõe: capturada pelo Pulsar numa linha de sessão => já
-- reconciliada, pois a linha da fila É a sessão que ela cobre. Isso vale quando
-- há sessão para todas as liberações. Não vale quando as liberações do dia
-- EXCEDEM as sessões: aí uma delas necessariamente não cobre nada, por
-- aritmética, e a captura não diz qual.
--
-- A CORREÇÃO
-- O `not exists` da fila passa a valer só onde a premissa dele vale — partição
-- sem excedente medido:
--
--     and (coalesce(ns.n, 0) = 0 or not exists (... fila ...))
--
-- Lido em voz alta: guia capturada pelo Pulsar continua fora da fila de órfãs,
-- EXCETO quando a partição tem sessões conhecidas e ainda assim sobraram
-- liberações — o excedente foi medido contra a agenda real, não inferido de
-- grade ausente.
--
-- POR QUE O `n = 0` FICA DE FORA (e por que isto não é o oposto da correção)
-- `n = 0` é a partição em que a grade não sabe de sessão nenhuma, e é aí que o
-- filtro ganha o seu sustento. Medido em produção (01/08 a 09/09, dia a dia):
-- sem o filtro da fila, 4.820 guias passariam por `ordem > n`; 4.796 delas são
-- descartadas por captura. Praticamente todo o volume é `ordem = 1 / n = 0` —
-- autorização normal de um dia cuja grade ainda não sincronizou. Liberar essas
-- entulharia a fila de trabalho com centenas de linhas por dia, que é o motivo
-- pelo qual o filtro foi escrito.
--
-- BLAST RADIUS MEDIDO (10/09/2026, produção, 01/08 a 09/09 dia a dia)
-- 13 guias liberadas são descartadas por captura mesmo tendo `ordem > n`. Delas,
-- por `sessoes_na_particao`:
--
--   n = 0  -> 12 guias  (11 com ordem 1, 1 com ordem 2)  — seguem fora
--   n >= 1 ->  1 guia   (48470, ordem 2 de 1)            — volta a ser órfã
--
-- Ou seja: esta migration desenterra UMA linha nos últimos 40 dias, que é o caso
-- reportado. Não é uma abertura de comporta — é o recorte exato em que "capturada"
-- deixa de implicar "reconciliada". As 12 de `n = 0` continuam caladas de
-- propósito: `ag=null` ou TUSS que não bate com a agenda, isto é, o ruído que o
-- filtro existe para conter.
--
-- O que NÃO muda:
--   * a qualificação por tempo (o número da guia recicla —
--     reference_guia_assim_nao_e_unica) e o `between` sobre a coluna crua, para
--     caber em idx_fila_autorizacoes_guia_horario;
--   * o `fa.avulsa = false` de 20260903100000;
--   * a divisão entre a CTE `guias` (afeta o row_number) e o WHERE externo (só
--     classifica). `ns.n` já é lido no WHERE externo, na linha imediatamente
--     acima, pelo mesmo left join — o novo termo não acrescenta leitura nenhuma;
--   * `vincular_autorizacao` e `get_candidatas_vinculo`, que já aceitam esta
--     guia (a 48470 tem candidata elegível hoje). Como em 20260903100000, o que
--     faltava era só a UI oferecer o caminho, e ela o oferece a partir de
--     `estado = 'sem-vinculo'` (useAnaliseReincidencia.ts), lido desta RPC.
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
    -- Guia capturada pelo próprio Pulsar PARA UMA SESSÃO sai da fila de órfãs —
    -- a linha da fila É a sessão que ela cobre. Só que essa leitura vale onde a
    -- premissa vale: quando as liberações do dia EXCEDEM as sessões conhecidas
    -- (`ns.n >= 1` junto do `ordem > n` acima), uma delas não cobre nada por
    -- aritmética, e a captura não diz qual — então a guia volta a precisar de
    -- triagem manual. Com `ns.n = 0` a grade não sabe de sessão nenhuma e o
    -- excedente é aparente, não medido: é o ramo que sustenta o filtro (4.796
    -- das 4.820 descartas medidas em 40 dias são desse tipo).
    --
    -- Comparação SEMPRE qualificada por tempo: o número da guia recicla
    -- (20260805170300:99-107). Escrita como faixa sobre a coluna crua, e não como
    -- `abs(extract(epoch ...)) <= 300`, para caber em
    -- idx_fila_autorizacoes_guia_horario (20260824000000).
    and (
      coalesce(ns.n, 0) >= 1
      or not exists (
        select 1 from public.fila_autorizacoes fa
        where fa.numero_autorizacao = g.guia
          and fa.horario_autorizacao between g.data_execucao - interval '5 minutes'
                                         and g.data_execucao + interval '5 minutes'
          -- A linha AVULSA não conta como captura: ela não representa sessão
          -- nenhuma (20260825130000:54), então a guia dela não está reconciliada
          -- com nada e é justamente a que precisa de vínculo manual
          -- (20260903100000).
          and fa.avulsa = false
      )
    )
  order by g.data_execucao desc, g.guia
$$;

comment on function public.get_guias_orfas(date, date) is
  'Guias ASSIM liberadas que sobraram do match posicional e ainda não foram triadas. Numera sobre o mesmo pool que get_auditoria_assim_periodo — guia triada sai antes do row_number(), senão as duas telas discordam. A exclusão por captura do Pulsar (janela de 5 min, `between` sobre a coluna crua para usar idx_fila_autorizacoes_guia_horario, ignorando linhas avulsas) só vale onde a premissa dela vale: quando a partição tem sessões conhecidas e ainda assim sobraram liberações, o excedente foi MEDIDO contra a agenda real e a guia volta a ser órfã — capturada pelo Pulsar não implica reconciliada.';
