-- =============================================================================
-- A guia AVULSA sai da disputa por posição — ela é a última da partição, sempre
-- =============================================================================
--
-- O CASO
-- Ysadora Corcino Aranda Da Costa, 02/09, TUSS 22070384, uma sessão só (15:40).
-- Duas guias liberadas na partição:
--
--   36706  11:04  avulsa=true   ag=null   "Realizando a autorização novamente a
--                                          pedido da Victória pois a anterior
--                                          deu reincidência."
--   48470  15:38  avulsa=false  ag=2395460, sessão das 15:40
--
-- O pareamento posicional ordena por `data_execucao`, então a AVULSA das 11:04
-- ficou ordem 1 e casou com a sessão das 15:40, e a guia que era de fato daquela
-- sessão sobrou. A Conferência ASSIM registra o próprio desmentido: a sessão das
-- 15:40 saiu com `guia = 36706` e `diferenca_minutos = -276` — a autorização
-- teria saído 4h36 ANTES do atendimento —, enquanto as outras duas sessões do
-- mesmo dia têm `-1`. E a Central de Atendimentos, que não usa esta janela,
-- mostra a mesma sessão com `horario_autorizacao = 15:38:37`, a guia certa. Duas
-- telas discordando sobre a mesma sessão.
--
-- A CAUSA
-- `data_execucao` é o instante em que a ASSIM registrou a guia
-- (reference_data_execucao_assim), e para a avulsa esse instante não tem relação
-- nenhuma com sessão nenhuma — é quando a recepção pediu a refação. Usá-lo para
-- ordenar a disputa por posição supõe que toda guia da partição concorre pelas
-- sessões dela, e a avulsa é precisamente a guia que NÃO concorre: ela é, por
-- definição, a autorização que não corresponde a sessão alguma
-- (20260825130000:54). Deixá-la competir faz duas coisas erradas de uma vez —
-- ela toma a sessão de outra guia, e a guia legítima é empurrada para o
-- excedente.
--
-- A CORREÇÃO
-- Uma coluna no `ORDER BY` da janela, à frente de `data_execucao`:
--
--     ORDER BY (av.guia IS NOT NULL), aa.data_execucao
--
-- `false` ordena antes de `true` em ASC, então guia normal vem primeiro e a
-- avulsa vai para o fim da partição, onde ela pertence: se sobrar sessão sem
-- guia, nenhuma avulsa a rouba; se faltar, a avulsa é a que cai no excedente e
-- vira órfã — que é o desfecho correto, porque ela é a que precisa de vínculo
-- manual.
--
-- Note que isto NÃO exclui a avulsa da partição, e a distinção importa: excluí-la
-- mudaria a numeração de todas as outras (o `row_number()` renumera), e uma guia
-- fora da partição deixa de ser contada como excedente — que é o mecanismo pelo
-- qual a Reconciliação a oferece para triagem. Ela continua na partição, apenas
-- em último lugar.
--
-- ONDE — três leituras, e só três
-- Seis funções vivas fazem pareamento posicional. Três delas nunca veem uma
-- avulsa na janela, porque excluem do pool toda guia com linha em
-- `fila_autorizacoes` (±7 dias) e a avulsa sempre tem uma:
--
--   listar_central_autorizacoes  (20260821060000:230-235)  -> não afetada
--   registrar_falta_em_lote      (20260908100100:297-301)  -> não afetada
--   listar_central_pacientes     (20260825130000:703-708)  -> não afetada
--
-- As três que numeram a avulsa junto das normais são as corrigidas aqui:
--
--   get_guias_orfas               pool: NOT EXISTS autorizacoes_vinculos
--   get_auditoria_assim_periodo   pool: NOT EXISTS autorizacoes_vinculos
--   get_tokens_mensal             pool: nenhum
--
-- As duas primeiras são mantidas deliberadamente idênticas (20260910120000:140)
-- — se divergirem, a Reconciliação oferece guia que a Conferência já casou. A
-- terceira compartilha o texto da janela sem compartilhar o pré-filtro de
-- vínculo, e é corrigida junto porque a Conferência de Filipetas decide papel
-- pela guia pareada por posição (`mt.*` no COALESCE de 20260903010000:370-371):
-- com a avulsa na posição errada, a filipeta era atribuída à sessão errada.
--
-- `get_candidatas_vinculo` não tem janela própria — chama
-- get_auditoria_assim_periodo em laço (20260821010000:109-114) e herda a
-- correção sozinha.
--
-- COMO A AVULSA É RECONHECIDA
-- A guia não carrega `avulsa`; a marca vive em `fila_autorizacoes`. O de-para sai
-- de `public.guias_avulsas(date, date)`, criada aqui: uma função só, para que as
-- três leituras não repitam a regra e não possam divergir dela.
--
-- A qualificação por TEMPO é obrigatória e não decorativa: o número da guia da
-- ASSIM recicla (reference_guia_assim_nao_e_unica — 4.652 repetidos em 12.883
-- linhas). A guia 48470, por exemplo, aparece em quatro linhas da fila, de
-- quatro pacientes diferentes (Davi 02/07, João Miguel 04/08, Ysadora 02/09,
-- Alice sem horário). Sem a janela de ±5 min, marcar "48470 é avulsa" contaminaria
-- pacientes que nada têm a ver com o caso. A janela é escrita como `between`
-- sobre a coluna crua para caber em idx_fila_autorizacoes_guia_horario
-- (20260824000000), o mesmo índice que o `not exists` de get_guias_orfas usa.
--
-- CUSTO
-- Praticamente nulo, e medido: 9 linhas com `avulsa = true` em 33.491 da fila, 7
-- delas com guia e horário. Existe índice parcial `idx_fila_avulsa ON
-- fila_autorizacoes (…) WHERE avulsa` (20260825130000:62-64), então a função
-- varre só essas 9. O resultado entra por LEFT JOIN materializado, e não como
-- subselect correlacionado no ORDER BY — que rodaria uma vez por linha de
-- `autorizacoes_assim` (o mês inteiro em get_tokens_mensal, ~4.900 linhas, sob
-- statement_timeout de 30s). Esta tabela já esgotou o pool de conexões uma vez
-- (24/08/2026, project_incidente_pool_guias_orfas); não é lugar para trabalho
-- por linha.
--
-- BLAST RADIUS MEDIDO (10/09/2026, produção)
-- 7 linhas avulsas com guia existem na tabela inteira. Para cada uma, verifiquei
-- se há guia normal DEPOIS dela na mesma partição (carteirinha + dia + TUSS) —
-- que é a condição para a inversão acontecer:
--
--   36706  Ysadora            02/09 11:04  -> 48470 @ 15:38   INVERSÃO
--   136336 Benjamim Vilaziok  09/09 10:42  -> nenhuma
--   59323  Miguel França      03/09 09:48  -> nenhuma
--   36978  Sara Ferreira      02/09 11:06  -> nenhuma
--   54950  Davi Lucas         02/09 17:46  -> nenhuma
--   26824  Bryan Thadeu       01/09 17:33  -> nenhuma
--   26905  Miguel França      01/09 17:36  -> nenhuma
--
-- Uma inversão em sete avulsas. As outras seis são a última liberação do dia na
-- partição delas, então já ficavam por último e a correção não as move — a
-- avulsa costuma ser tirada DEPOIS da tentativa que falhou. A da Ysadora é
-- atípica: a refação foi de manhã e a sessão real da tarde só foi autorizada às
-- 15:38.
--
-- Ou seja: esta migration corrige UMA sessão hoje e fecha a porta para as
-- próximas. O volume é baixo porque a página de avulsas é de 25/08; conforme ela
-- for usada, o padrão "refação de manhã, sessão de tarde" reaparece.
--
-- O QUE NÃO MUDA
--   * a partição (empresa, matrícula, dep, dia, TUSS) das três funções, e as
--     três chaves distintas que existem em produção — consolidá-las é outro
--     assunto, de risco muito diferente;
--   * `data_execucao` continua sendo o desempate entre guias normais, que é o
--     comportamento de 100% das partições sem avulsa;
--   * o pré-filtro de vínculo de cada função, e a ausência dele em
--     get_tokens_mensal;
--   * `fn_blocos_assim`, que é o lado das sessões e não tem janela;
--   * o `NOT EXISTS` de `guias_sem_fila` em listar_central_pacientes
--     (20260825130000:222-225), onde "a guia da avulsa FOI capturada pelo Pulsar"
--     é a leitura CERTA: ali a pergunta é se a linha sintética duplicaria a
--     autorização na tela, e duplicaria.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O de-para: que guias, na janela pedida, são de uma solicitação avulsa
-- ---------------------------------------------------------------------------
-- `p_de`/`p_ate` são dias de `data_execucao`, os mesmos que a leitura chamadora
-- já usa. A folga de 1 dia nas pontas cobre a autorização da virada (a guia
-- registrada 23:58 cuja linha na fila caiu 00:01), sem a qual a marca sumiria
-- justamente no caso de borda.
CREATE OR REPLACE FUNCTION public.guias_avulsas(p_de date, p_ate date)
RETURNS TABLE (guia text, horario_autorizacao timestamp without time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT fa.numero_autorizacao, fa.horario_autorizacao
  FROM public.fila_autorizacoes fa
  WHERE fa.avulsa                                   -- usa idx_fila_avulsa
    AND fa.numero_autorizacao  IS NOT NULL
    AND fa.horario_autorizacao IS NOT NULL
    AND fa.horario_autorizacao >= (p_de - 1)::timestamp
    AND fa.horario_autorizacao <  (p_ate + 2)::timestamp
$$;

COMMENT ON FUNCTION public.guias_avulsas(date, date) IS
  'Guias que saíram de uma solicitação AVULSA (/autorizacoes-avulsas), com o instante em que foram tiradas. Definição ÚNICA da marca, consumida pelas três leituras que fazem pareamento posicional (get_guias_orfas, get_auditoria_assim_periodo, get_tokens_mensal) para mandar a avulsa para o fim da partição: ela não corresponde a sessão nenhuma, logo não pode disputar posição com quem corresponde. Casar SEMPRE por guia + tempo (±5 min): o número da guia da ASSIM recicla — a 48470 aparece em quatro pacientes diferentes.';

GRANT EXECUTE ON FUNCTION public.guias_avulsas(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_guias_orfas — a avulsa vai para o fim, e por isso VIRA a órfã
-- ---------------------------------------------------------------------------
-- Corpo idêntico a 20260910120000, com duas mudanças: a CTE `avulsas` e a
-- coluna nova no ORDER BY da janela.
--
-- O efeito no caso da Ysadora: a 48470 (normal, 15:38) passa a ser ordem 1 e
-- casa com a sessão das 15:40 — desaparecendo desta fila, porque deixou de ser
-- excedente. A 36706 (avulsa) passa a ser ordem 2 e VIRA a órfã, que é o
-- desfecho correto: é ela que não cobre sessão nenhuma e precisa da triagem
-- "Nenhuma — é autorização extra". A tela deixa de pedir vínculo para a guia
-- errada.
CREATE OR REPLACE FUNCTION public.get_guias_orfas(p_de date, p_ate date)
RETURNS TABLE (
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
-- Declarado aqui dentro, e não por ALTER FUNCTION: `create or replace` descarta
-- o proconfig posto de fora, calado (20260817:CREATE OR REPLACE perde proconfig).
SET statement_timeout = '15s'
AS $$
  with n_sessoes as (
    select b.empresa, b.matricula, b.dep, b.data_atendimento, b.codigo_tuss,
           count(*) as n
    from public.fn_blocos_assim(p_de, p_ate) b
    group by 1,2,3,4,5
  ),
  avulsas as (
    select guia, horario_autorizacao from public.guias_avulsas(p_de, p_ate)
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
        -- A AVULSA por último. `false` ordena antes de `true`, então a guia
        -- normal fica com as sessões e a avulsa cai no excedente — onde ela
        -- pertence, porque não cobre sessão nenhuma (20260825130000:54). Sem
        -- isto, uma refação tirada de manhã tomava a sessão da tarde e a guia
        -- legítima virava "Não identificada" (caso Ysadora, 02/09).
        order by (av.guia is not null), aa.data_execucao
      ) as ordem_autorizacao
    from public.autorizacoes_assim aa
    -- Marca a avulsa SEM tirá-la da partição: excluí-la renumeraria as outras e
    -- a faria deixar de contar como excedente, que é justamente o mecanismo que
    -- a leva para a triagem. Casamento por guia + tempo porque o número recicla.
    left join avulsas av
      on  av.guia = aa.guia
      and av.horario_autorizacao between aa.data_execucao - interval '5 minutes'
                                     and aa.data_execucao + interval '5 minutes'
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
    -- das 4.820 descartas medidas em 40 dias são desse tipo). Ver 20260910120000.
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

COMMENT ON FUNCTION public.get_guias_orfas(date, date) IS
  'Guias ASSIM liberadas que sobraram do match posicional e ainda não foram triadas. Numera sobre o mesmo pool e na MESMA ORDEM que get_auditoria_assim_periodo — guia triada sai antes do row_number() e a avulsa ordena por último (public.guias_avulsas), senão as duas telas discordam sobre qual guia é a excedente. A exclusão por captura do Pulsar (janela de 5 min, `between` sobre a coluna crua para usar idx_fila_autorizacoes_guia_horario, ignorando linhas avulsas) só vale onde a premissa dela vale: quando a partição tem sessões conhecidas e ainda assim sobraram liberações, o excedente foi MEDIDO contra a agenda real e a guia volta a ser órfã.';

-- ---------------------------------------------------------------------------
-- 3. get_auditoria_assim_periodo — a Conferência para de atribuir a guia errada
-- ---------------------------------------------------------------------------
-- Corpo idêntico à definição viva (20260828190000), com a CTE `avulsas`, o LEFT
-- JOIN que a marca e a coluna nova no ORDER BY da janela das guias. Nada mais.
--
-- O efeito no caso da Ysadora: a sessão de 02/09 15:40 passa a sair com
-- `guia = 48470` e `diferenca_minutos = -1` (a autorização saiu 1 min antes do
-- atendimento) em vez de `guia = 36706` com `-276`. A ordem tem de ser a MESMA
-- de get_guias_orfas — as duas numeram sobre o mesmo pool de propósito.
--
-- `get_candidatas_vinculo` chama esta função em laço dia-a-dia
-- (20260821010000:109-114) e herda a correção sem ser tocada.

-- Sem os `DROP FUNCTION` que 20260828190000 trazia: a assinatura não muda, então
-- `CREATE OR REPLACE` basta — e dropar aqui seria pior que inútil. Duas funções
-- vivas chamam esta (`get_candidatas_vinculo` em laço dia-a-dia,
-- `refresh_auditoria_assim_resumo` para materializar o resumo), e um DROP no meio
-- da transação ou falha por dependência ou passa deixando a chamadora apontando
-- para o vazio. Aquela migration precisava do DROP porque MUDOU o RETURNS
-- (acrescentou as quatro colunas de reclassificação); esta não muda nada da
-- assinatura.
CREATE OR REPLACE FUNCTION public.get_auditoria_assim_periodo(p_data_inicio date, p_data_fim date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  WITH avulsas AS (
    SELECT guia, horario_autorizacao FROM public.guias_avulsas(p_data_inicio, p_data_fim)
  ),
  blocos_auditoria AS (
    WITH agenda_tita_tuss AS (
      SELECT
        at.paciente_id,
        at.paciente_nome,
        at.data_atendimento,
        at.hora_inicial,
        at.terapia_nome,
        at.terapia_exibicao_nome,
        at.profissional_nome,
        at.convenio_nome,
        at.numero_carteirinha,
        substring(at.numero_carteirinha, 1, 6)                                   AS empresa,
        substring(at.numero_carteirinha, 7, 7)                                   AS matricula,
        right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)           AS dep,
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
      FROM agenda_tita at
      WHERE at.data_atendimento BETWEEN p_data_inicio AND p_data_fim
        AND at.ativo = true
        AND at.convenio_nome ILIKE '%assim%'
        AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo','Notificação Prévia'])
    ),
    agenda_filtrada AS (
      SELECT a.*
      FROM agenda_tita_tuss a
      WHERE a.codigo_tuss IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM config_regras_terapias r
          WHERE r.categoria = 'BLACKLIST_AUTORIZACAO'
            AND r.ativo = true
            AND a.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
        )
    ),
    agenda_sem_falta AS (
      SELECT a.*
      FROM agenda_filtrada a
      WHERE NOT EXISTS (
        SELECT 1 FROM fila_autorizacoes f
        WHERE f.paciente_id::bigint = a.paciente_id
          AND f.data_atendimento = a.data_atendimento
          AND f.horario = a.hora_inicial
          AND (
            (f.status IS DISTINCT FROM 'glosa'
             AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
          )
      )
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Escola%'
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Casa%'
        AND a.terapia_nome NOT ILIKE '%Aplicador Suporte%'
        AND a.terapia_nome NOT ILIKE '%Supervisão ABA%'
    )
    SELECT
      concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) AS bloco_id,
      asf.paciente_id::text,
      asf.paciente_nome,
      asf.empresa,
      asf.matricula,
      asf.dep,
      concat_ws('.', asf.empresa, asf.matricula, asf.dep) AS carteirinha,
      asf.data_atendimento,
      asf.hora_inicial,
      asf.codigo_tuss,
      asf.convenio_nome,
      string_agg(DISTINCT asf.terapia_exibicao_nome, ' | ' ORDER BY asf.terapia_exibicao_nome) AS terapias,
      string_agg(DISTINCT asf.profissional_nome,     ' | ' ORDER BY asf.profissional_nome)     AS profissionais,
      count(*) AS quantidade_sessoes
    FROM agenda_sem_falta asf
    GROUP BY asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
             asf.data_atendimento, asf.hora_inicial, asf.codigo_tuss, asf.convenio_nome
  ),
  fila_operacional AS (
    SELECT DISTINCT ON (f.paciente_id, f.data_atendimento, f.horario, f.tuss)
      f.empresa, f.matricula, f.dep, f.paciente_id, f.data_atendimento, f.horario,
      f.tuss AS codigo_tuss,
      COALESCE(f.updated_at, f.created_at) AS ultimo_updated_at,
      f.criado_por,
      f.forma_autorizacao,
      f.horario_autorizacao,
      f.status,
      f.status_assim,
      f.numero_autorizacao,
      f.numero_autorizacao_origem,
      f.error_message,
      CASE
        WHEN f.status = 'glosa' AND f.status_assim ~ '^\s*\d{3,5}\s*-'
          THEN btrim(split_part(f.status_assim, '-', 1))
      END AS glosa_codigo,
      CASE
        WHEN f.status = 'glosa'
          THEN nullif(btrim(regexp_replace(f.status_assim, '^\s*\d{3,5}\s*-\s*', '')), '')
      END AS glosa_descricao
    FROM fila_autorizacoes f
    WHERE f.data_atendimento BETWEEN p_data_inicio AND p_data_fim
      AND NOT (
        (f.status IS DISTINCT FROM 'glosa'
         AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
      )
    ORDER BY f.paciente_id, f.data_atendimento, f.horario, f.tuss,
             COALESCE(f.updated_at, f.created_at) DESC
  ),
  match_temporal AS (
    WITH sessoes AS (
      SELECT
        b1.bloco_id, b1.paciente_id, b1.paciente_nome, b1.empresa, b1.matricula, b1.dep,
        b1.carteirinha, b1.data_atendimento, b1.hora_inicial, b1.codigo_tuss,
        b1.convenio_nome, b1.terapias, b1.profissionais, b1.quantidade_sessoes,
        row_number() OVER (
          PARTITION BY b1.empresa, b1.matricula, b1.dep, b1.data_atendimento, b1.codigo_tuss
          ORDER BY b1.hora_inicial
        ) AS ordem_sessao
      FROM blocos_auditoria b1
    ),
    autorizacoes AS (
      SELECT
        aa.guia, aa.matricula, aa.paciente_nome, aa.data_execucao, aa.data_autorizacao,
        aa.status, aa.codigo_tuss, aa.codigo_erro, aa.descricao_erro,
        aa.teve_token, aa.updated_at, aa.token, aa.status_tratado, aa.matricula_limpa, aa.paciente_id,
        aa.biofacial,
        split_part(aa.matricula, '.', 1)               AS empresa,
        split_part(aa.matricula, '.', 2)               AS matricula_base,
        split_part(aa.matricula, '.', 3)               AS dep,
        row_number() OVER (
          PARTITION BY split_part(aa.matricula,'.',1), split_part(aa.matricula,'.',2),
                       split_part(aa.matricula,'.',3), date(aa.data_execucao), aa.codigo_tuss
          -- A AVULSA por último: ela não corresponde a sessão nenhuma
          -- (20260825130000:54), então não pode disputar posição com quem
          -- corresponde. `false` ordena antes de `true`. Mesma ordem de
          -- get_guias_orfas, obrigatoriamente (20260910130000).
          ORDER BY (av.guia IS NOT NULL), aa.data_execucao
        ) AS ordem_autorizacao
      FROM autorizacoes_assim aa
      -- Marca sem EXCLUIR: tirar a avulsa da partição renumeraria as outras.
      -- Por guia + tempo, porque o número da guia recicla.
      LEFT JOIN avulsas av
        ON  av.guia = aa.guia
        AND av.horario_autorizacao BETWEEN aa.data_execucao - interval '5 minutes'
                                       AND aa.data_execucao + interval '5 minutes'
      WHERE date(aa.data_execucao) BETWEEN p_data_inicio AND p_data_fim
        AND NOT EXISTS (
          SELECT 1 FROM public.autorizacoes_vinculos v
          WHERE v.guia = aa.guia AND v.desfeito_em IS NULL
        )
    )
    SELECT DISTINCT ON (s.bloco_id)
      s.bloco_id,
      a.guia, a.status, a.codigo_erro, a.descricao_erro, a.data_execucao, a.updated_at,
      a.teve_token, a.token, a.biofacial,
      EXTRACT(epoch FROM a.data_execucao::time - s.hora_inicial) / 60 AS diferenca_minutos
    FROM sessoes s
    LEFT JOIN autorizacoes a
      ON  a.empresa        = s.empresa
      AND a.matricula_base  = s.matricula
      AND a.dep            = s.dep
      AND date(a.data_execucao) = s.data_atendimento
      AND a.codigo_tuss    = s.codigo_tuss
      AND a.ordem_autorizacao = s.ordem_sessao
    ORDER BY s.bloco_id, a.updated_at DESC
  )
  SELECT
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.empresa,
    b.matricula,
    b.dep,
    b.carteirinha,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.convenio_nome,
    b.terapias,
    b.profissionais,
    b.quantidade_sessoes,
    COALESCE(mt.guia, fo.numero_autorizacao)               AS guia,
    COALESCE(mt.status, fo.status_assim)                   AS status_assim,
    er.codigo                                              AS codigo_erro,
    ed.descricao                                           AS descricao_erro,
    mt.data_execucao AT TIME ZONE 'America/Sao_Paulo'     AS data_execucao,
    mt.updated_at    AT TIME ZONE 'America/Sao_Paulo'     AS autorizacao_updated_at,
    mt.diferenca_minutos,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL               THEN ovr.situacao_nova
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'  THEN 'GLOSA_RESOLVIDA'
      WHEN vin.guia IS NOT NULL                        THEN 'LIBERADA'
      ELSE sb.base
    END                                                   AS situacao,
    CASE
      WHEN ovr.situacao_nova IN ('FALTA', 'FALTA_TERAPEUTA') THEN 7
      WHEN ovr.situacao_nova = 'CANCELADA'            THEN 5
      WHEN ovr.situacao_nova = 'NAO_SOLICITADA'       THEN 1
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA' THEN 6
      WHEN vin.guia IS NOT NULL                       THEN 6
      WHEN sb.base = 'GLOSA'                          THEN 2
      WHEN sb.base = 'CANCELADA'                      THEN 5
      WHEN sb.base = 'LIBERADA'                       THEN 6
      WHEN sb.base = 'SOLICITACAO_CANCELADA'          THEN 1
      WHEN sb.base = 'SINCRONIZANDO'                  THEN 4
      WHEN sb.base = 'RETORNO_NAO_CONFIRMADO'         THEN 3
      WHEN sb.base = 'NAO_SOLICITADA'                 THEN 1
      ELSE 1
    END                                                   AS prioridade,
    (CURRENT_DATE - b.data_atendimento)::integer          AS dias_atraso,
    ((mt.status = 'Liberado')
      OR (fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL)
      OR vin.guia IS NOT NULL)                            AS possui_autorizacao,
    (fo.paciente_id IS NOT NULL)                          AS possui_solicitacao,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL
        THEN concat(ob.base, ' · Reclassificado de ', ovr.situacao_anterior,
                    ' para ', ovr.situacao_nova, ' por ', ovr.reclassificado_por,
                    ' em ', to_char(ovr.reclassificado_em AT TIME ZONE 'America/Sao_Paulo',
                                    'DD/MM/YYYY HH24:MI'),
                    ' — ', ovr.justificativa)
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'
        THEN concat(ob.base, ' · Coberta pela guia ', vin.guia,
                    ' de ', to_char(vin.data_execucao, 'DD/MM/YYYY HH24:MI'),
                    ' — vínculo por ', vin.vinculado_por)
      WHEN vin.guia IS NOT NULL
        THEN concat('Autorização confirmada pela ASSIM (guia ', vin.guia,
                    ', vínculo por ', vin.vinculado_por, ')')
      ELSE ob.base
    END                                                   AS observacao,
    agm.motivo_glosa,
    mt.teve_token,
    mt.token,
    fo.criado_por,
    COALESCE(
      fo.forma_autorizacao,
      public.forma_validacao_do_biofacial(mt.biofacial, mt.teve_token)
    )                                                     AS forma_autorizacao,
    fo.horario_autorizacao,
    CASE
      WHEN fo.numero_autorizacao IS NOT NULL THEN fo.numero_autorizacao_origem
      WHEN mt.guia               IS NOT NULL THEN 'relatorio'
      ELSE NULL
    END                                                   AS guia_origem,
    -- ── Metadados crus da reclassificação, para o modal montar sua própria
    -- seção em vez de depender só da frase concatenada em `observacao`.
    -- NULL em todo bloco sem reclassificação ativa.
    ovr.situacao_anterior                                 AS reclassificacao_situacao_anterior,
    ovr.justificativa                                      AS reclassificacao_justificativa,
    ovr.reclassificado_por                                 AS reclassificacao_por,
    ovr.reclassificado_em                                  AS reclassificacao_em
  FROM blocos_auditoria b
  LEFT JOIN match_temporal mt        ON mt.bloco_id = b.bloco_id
  LEFT JOIN fila_operacional fo
    ON  fo.paciente_id      = b.paciente_id
    AND fo.data_atendimento = b.data_atendimento
    AND fo.codigo_tuss      = b.codigo_tuss
    AND fo.horario          = b.hora_inicial
  LEFT JOIN auditoria_glosa_motivos agm ON agm.bloco_id = b.bloco_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        mt.codigo_erro,
        CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
             THEN btrim(split_part(mt.status, '-', 1)) END,
        fo.glosa_codigo
      ) AS codigo,
      CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
           THEN nullif(btrim(regexp_replace(
                  regexp_replace(mt.status, '^\s*\d{3,5}\s*-\s*', ''),
                  '\s*\*\s*$', '')), '')
      END AS descricao_relatorio
  ) er ON true
  LEFT JOIN public.glosa_codigos gc ON gc.codigo = er.codigo
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      mt.descricao_erro,
      gc.descricao,
      fo.glosa_descricao,
      er.descricao_relatorio,
      fo.error_message
    ) AS descricao
  ) ed ON true
  LEFT JOIN LATERAL (
    SELECT v.guia, v.guia_original, v.vinculado_por, v.vinculado_em, aa2.data_execucao
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia
    WHERE v.bloco_id = b.bloco_id
      AND v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
    LIMIT 1
  ) vin ON true
  LEFT JOIN LATERAL (
    SELECT o.situacao_anterior, o.situacao_nova, o.justificativa,
           o.reclassificado_por, o.reclassificado_em
    FROM public.auditoria_situacao_overrides o
    WHERE o.bloco_id = b.bloco_id
      AND o.desfeito_em IS NULL
    LIMIT 1
  ) ovr ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
                                                              THEN 'GLOSA'
          WHEN mt.status = 'Liberado *'                      THEN 'CANCELADA'
          WHEN mt.status = 'Liberado'                        THEN 'LIBERADA'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
                                                              THEN 'LIBERADA'
          WHEN fo.status = 'glosa'                            THEN 'GLOSA'
          WHEN fo.status IN ('erro', 'cancelado')             THEN 'SOLICITACAO_CANCELADA'
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
                                                              THEN 'SINCRONIZANDO'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
                                                              THEN 'RETORNO_NAO_CONFIRMADO'
          ELSE                                                     'NAO_SOLICITADA'
    END AS base
  ) sb ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
            THEN concat('Glosa: ',
                   COALESCE(er.codigo, mt.status, 'Erro não identificado'),
                   CASE WHEN ed.descricao IS NOT NULL THEN concat(' - ', ed.descricao) ELSE '' END)
          WHEN mt.status = 'Liberado' AND mt.teve_token = true
            THEN concat('TOKEN - ', mt.token)
          WHEN mt.status = 'Liberado'    THEN 'Autorização confirmada pela ASSIM'
          WHEN mt.status = 'Liberado *'  THEN 'Autorização cancelada'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
            THEN 'Autorização confirmada pela ASSIM'
          WHEN fo.status = 'glosa'
            THEN concat('Glosa: ',
                   COALESCE(
                     nullif(concat_ws(' - ', er.codigo, ed.descricao), ''),
                     fo.error_message,
                     'Erro não identificado'))
          WHEN fo.status = 'erro'
            THEN COALESCE(fo.error_message, 'A solicitação não chegou ao fim na ASSIM.')
          WHEN fo.status = 'cancelado'
            THEN COALESCE(fo.error_message, 'Solicitação cancelada antes da conclusão.')
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
            THEN 'Solicitação enviada.'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
            THEN 'Solicitação enviada, mas o retorno da ASSIM ainda não foi confirmado.'
          ELSE 'Nenhuma solicitação encontrada'
    END AS base
  ) ob ON true
  WHERE COALESCE(b.terapias, '') NOT ILIKE '%Equoterapia%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Fisioterapia Aquática%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Avaliação Neuropsicológica%'
  ORDER BY prioridade, hora_inicial
$function$
;

comment on function public.get_auditoria_assim_periodo(date, date) is
  'Conferência ASSIM por período. Considera public.autorizacoes_vinculos e public.auditoria_situacao_overrides. Devolve guia_origem e os metadados crus da reclassificação ativa (reclassificacao_situacao_anterior, reclassificacao_justificativa, reclassificacao_por, reclassificacao_em), para o detalhamento mostrar a decisão em vez de só a situação final.';

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim_periodo(date, date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_auditoria_assim(p_data date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM public.get_auditoria_assim_periodo(p_data, p_data)
$function$
;

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim(date) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_tokens_mensal — a filipeta segue a guia certa
-- ---------------------------------------------------------------------------
-- Corpo idêntico à definição viva (20260903010000), com as mesmas três
-- mudanças. A janela da CTE `avulsas` é o mês de `p_mes`, derivada como
-- `auth_mes` já deriva a dela.
--
-- Esta função é corrigida junto porque decide papel e forma pela guia pareada
-- por POSIÇÃO: `mt.*` é o fallback de `COALESCE(vin.guia, mt.guia)` e
-- `COALESCE(vin.token, mt.token)` (20260903010000:370-371) e alimenta
-- `forma_autorizacao` e os três gates do WHERE final. Com a avulsa na posição
-- errada, a Conferência de Filipetas cobrava (ou dispensava) o papel da sessão
-- errada. Ela NÃO compartilha o pré-filtro de vínculo das outras duas — isso
-- fica como está, é outro assunto.

CREATE OR REPLACE FUNCTION public.get_tokens_mensal(p_mes date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, terapias text, profissionais text, guia text, token text, data_execucao timestamp with time zone, criado_por text, forma_autorizacao text)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '30s'
AS $function$
  WITH avulsas AS (
    SELECT guia, horario_autorizacao
    FROM public.guias_avulsas(
      date_trunc('month', p_mes)::date,
      (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date
    )
  ),
  auth_mes AS (
    SELECT
      aa.guia, aa.matricula, aa.data_execucao, aa.status, aa.codigo_tuss,
      aa.codigo_erro, aa.descricao_erro, aa.teve_token, aa.token, aa.updated_at,
      -- Projetado a partir de 20260903000000: as Sementes 1-3 nunca precisaram
      -- do biofacial de uma guia sem vínculo; a Semente 4 precisa.
      aa.biofacial,
      split_part(aa.matricula, '.', 1) AS empresa,
      split_part(aa.matricula, '.', 2) AS matricula_base,
      split_part(aa.matricula, '.', 3) AS dep,
      date(aa.data_execucao)           AS dia
    FROM autorizacoes_assim aa
    WHERE date(aa.data_execucao) >= date_trunc('month', p_mes)::date
      AND date(aa.data_execucao) <  (date_trunc('month', p_mes) + interval '1 month')::date
  ),
  -- Semente 1: partições que tiveram filipeta.
  chaves_token AS (
    SELECT DISTINCT empresa, matricula_base, dep, dia, codigo_tuss
    FROM auth_mes
    WHERE teve_token = true
  ),
  -- Semente 2: sessões validadas com erro de reconhecimento facial. A forma
  -- vive na fila (é onde a recepção grava), e a fila não tem carteirinha —
  -- então a chave de partição vem da agenda, pela mesma derivação usada no
  -- resto da função. ILIKE por tolerância a acento/caixa da opção gravada.
  fila_facial AS (
    SELECT DISTINCT f.paciente_id, f.data_atendimento, f.tuss
    FROM fila_autorizacoes f
    WHERE f.data_atendimento >= date_trunc('month', p_mes)::date
      AND f.data_atendimento <  (date_trunc('month', p_mes) + interval '1 month')::date
      AND f.forma_autorizacao ILIKE '%reconhecimento facial%'
  ),
  chaves_facial AS (
    SELECT DISTINCT
      substring(at.numero_carteirinha, 1, 6)                         AS empresa,
      substring(at.numero_carteirinha, 7, 7)                         AS matricula_base,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)  AS dep,
      at.data_atendimento                                            AS dia,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
    FROM agenda_tita at
    JOIN fila_facial ff
      ON  ff.paciente_id::bigint = at.paciente_id
      AND ff.data_atendimento    = at.data_atendimento
    WHERE at.ativo = true
      AND at.convenio_nome ILIKE '%assim%'
      AND public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome)
            IS NOT DISTINCT FROM ff.tuss
  ),
  -- Semente 3: blocos cobertos por vínculo cuja guia VINCULADA teve filipeta ou
  -- erro facial. A fila (Semente 2) só enxerga a forma que a RECEPÇÃO gravou
  -- para a guia GLOSADA — nunca sabe que aquela glosa foi resolvida por outra
  -- guia. A chave de partição vem de agenda_tita, pela mesma derivação das
  -- outras sementes.
  vinculos_mes AS (
    SELECT
      v.bloco_id, v.guia,
      aa.teve_token, aa.biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa ON aa.guia = v.guia
    WHERE v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
      AND date(aa.data_execucao) >= date_trunc('month', p_mes)::date
      AND date(aa.data_execucao) <  (date_trunc('month', p_mes) + interval '1 month')::date
      AND (
        aa.teve_token = true
        OR public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
             ILIKE '%reconhecimento facial%'
        -- Prefixo `8-`, com ou sem token (20260903000000).
        OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) = '8'
      )
  ),
  chaves_vinculo AS (
    SELECT DISTINCT
      substring(at.numero_carteirinha, 1, 6)                         AS empresa,
      substring(at.numero_carteirinha, 7, 7)                         AS matricula_base,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)  AS dep,
      at.data_atendimento                                            AS dia,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
    FROM agenda_tita at
    JOIN vinculos_mes vm
      ON  vm.bloco_id = concat_ws('_', at.paciente_id, at.data_atendimento,
            public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome),
            at.hora_inicial)
    WHERE at.ativo = true
      AND at.convenio_nome ILIKE '%assim%'
  ),
  -- Semente 4: partições cujo biofacial diz `8-DISPOSITIVO INDISPONIVEL`,
  -- COM OU SEM TOKEN. Sem dispositivo a ASSIM cai no #checkBday e emite a
  -- filipeta (20260821080000:101-105): o papel é consequência do `8-`, e o
  -- token é consequência do papel. Quando o token existe a Semente 1 já pegava;
  -- quando não existe (9 de 106 casos medidos em 21/08/2026) a partição não
  -- entrava por porta nenhuma, e a sessão sumia calada.
  --
  -- Casa pelo PREFIXO: o rótulo vem truncado em 25 chars e o vocabulário não é
  -- fechado (reference_biofacial_no_extrato_assim).
  chaves_dispositivo AS (
    SELECT DISTINCT empresa, matricula_base, dep, dia, codigo_tuss
    FROM auth_mes
    WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) = '8'
  ),
  chaves AS (
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_token
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_facial
    WHERE codigo_tuss IS NOT NULL
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_vinculo
    WHERE codigo_tuss IS NOT NULL
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_dispositivo
    WHERE codigo_tuss IS NOT NULL
  ),
  dias_alvo AS (
    SELECT DISTINCT dia FROM chaves
  ),
  autorizacoes AS (
    SELECT
      a.guia, a.status, a.codigo_erro, a.descricao_erro, a.data_execucao,
      a.updated_at, a.teve_token, a.token, a.codigo_tuss,
      -- Carregado a partir de 20260903000000 para o WHERE final poder ler o
      -- biofacial da guia pareada por POSIÇÃO (e não só o da vinculada).
      a.biofacial,
      a.empresa, a.matricula_base, a.dep,
      row_number() OVER (
        PARTITION BY a.empresa, a.matricula_base, a.dep, a.dia, a.codigo_tuss
        -- A AVULSA por último: ela não corresponde a sessão nenhuma
        -- (20260825130000:54). Com ela na posição errada, a filipeta era
        -- atribuída à sessão errada, porque `mt.*` (a guia pareada por
        -- POSIÇÃO) é o fallback do COALESCE que decide papel e forma.
        -- Mesma regra de get_guias_orfas (20260910130000).
        ORDER BY (av.guia IS NOT NULL), a.data_execucao
      ) AS ordem_autorizacao
    FROM auth_mes a
    -- Marca sem EXCLUIR: tirar a avulsa da partição renumeraria as outras.
    LEFT JOIN avulsas av
      ON  av.guia = a.guia
      AND av.horario_autorizacao BETWEEN a.data_execucao - interval '5 minutes'
                                     AND a.data_execucao + interval '5 minutes'
    JOIN chaves k
      ON  k.empresa        = a.empresa
      AND k.matricula_base = a.matricula_base
      AND k.dep            = a.dep
      AND k.dia            = a.dia
      AND k.codigo_tuss    IS NOT DISTINCT FROM a.codigo_tuss
  ),
  blocos_auditoria AS (
    WITH agenda_tita_tuss AS (
      SELECT
        at.paciente_id,
        at.paciente_nome,
        at.data_atendimento,
        at.hora_inicial,
        at.terapia_nome,
        at.terapia_exibicao_nome,
        at.profissional_nome,
        at.convenio_nome,
        at.numero_carteirinha,
        substring(at.numero_carteirinha, 1, 6)                                   AS empresa,
        substring(at.numero_carteirinha, 7, 7)                                   AS matricula,
        right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)           AS dep,
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
      FROM agenda_tita at
      WHERE at.data_atendimento IN (SELECT dia FROM dias_alvo)
        AND at.ativo = true
        AND at.convenio_nome ILIKE '%assim%'
        AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo','Notificação Prévia'])
        -- Semi-join contra o conjunto de carteirinhas alvo: derruba a maior
        -- parte das linhas ANTES dos NOT EXISTS caros abaixo.
        AND EXISTS (
          SELECT 1 FROM chaves k
          WHERE k.empresa        = substring(at.numero_carteirinha, 1, 6)
            AND k.matricula_base = substring(at.numero_carteirinha, 7, 7)
            AND k.dep            = right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)
        )
    ),
    agenda_filtrada AS (
      SELECT a.*
      FROM agenda_tita_tuss a
      WHERE a.codigo_tuss IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM config_regras_terapias r
          WHERE r.categoria = 'BLACKLIST_AUTORIZACAO'
            AND r.ativo = true
            AND a.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
        )
    ),
    agenda_sem_falta AS (
      SELECT a.*
      FROM agenda_filtrada a
      WHERE NOT EXISTS (
        SELECT 1 FROM fila_autorizacoes f
        WHERE f.paciente_id::bigint = a.paciente_id
          AND f.data_atendimento = a.data_atendimento
          AND f.horario = a.hora_inicial
          AND (
            upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
          )
      )
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Escola%'
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Casa%'
        AND a.terapia_nome NOT ILIKE '%Aplicador Suporte%'
        AND a.terapia_nome NOT ILIKE '%Supervisão ABA%'
    )
    SELECT
      concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) AS bloco_id,
      asf.paciente_id::text,
      asf.paciente_nome,
      asf.empresa,
      asf.matricula,
      asf.dep,
      asf.data_atendimento,
      asf.hora_inicial,
      asf.codigo_tuss,
      string_agg(DISTINCT asf.terapia_exibicao_nome, ' | ' ORDER BY asf.terapia_exibicao_nome) AS terapias,
      string_agg(DISTINCT asf.profissional_nome,     ' | ' ORDER BY asf.profissional_nome)     AS profissionais
    FROM agenda_sem_falta asf
    -- convenio_nome entra no GROUP BY só para manter paridade exata com
    -- get_auditoria_assim_periodo: sem ele, dois convênios "assim" grafados
    -- diferente fundiriam num bloco só e mudariam a numeração do pareamento.
    GROUP BY asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
             asf.data_atendimento, asf.hora_inicial, asf.codigo_tuss, asf.convenio_nome
  ),
  fila_operacional AS (
    SELECT DISTINCT ON (f.paciente_id, f.data_atendimento, f.horario, f.tuss)
      f.paciente_id, f.data_atendimento, f.horario,
      f.tuss AS codigo_tuss,
      f.criado_por,
      f.forma_autorizacao
    FROM fila_autorizacoes f
    WHERE f.data_atendimento IN (SELECT dia FROM dias_alvo)
      AND NOT (
        upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
      )
    ORDER BY f.paciente_id, f.data_atendimento, f.horario, f.tuss,
             COALESCE(f.updated_at, f.created_at) DESC
  ),
  match_temporal AS (
    WITH sessoes AS (
      SELECT
        b1.*,
        row_number() OVER (
          PARTITION BY b1.empresa, b1.matricula, b1.dep, b1.data_atendimento, b1.codigo_tuss
          ORDER BY b1.hora_inicial
        ) AS ordem_sessao
      FROM blocos_auditoria b1
    )
    SELECT DISTINCT ON (s.bloco_id)
      s.bloco_id,
      -- `a.biofacial` carregado a partir de 20260903000000.
      a.guia, a.status, a.teve_token, a.token, a.data_execucao, a.biofacial
    FROM sessoes s
    LEFT JOIN autorizacoes a
      ON  a.empresa        = s.empresa
      AND a.matricula_base = s.matricula
      AND a.dep            = s.dep
      AND date(a.data_execucao) = s.data_atendimento
      AND a.codigo_tuss    = s.codigo_tuss
      AND a.ordem_autorizacao = s.ordem_sessao
    ORDER BY s.bloco_id, a.updated_at DESC
  )
  SELECT
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.terapias,
    b.profissionais,
    -- ── Guia, token e forma seguem o vínculo quando ele existe ────────────────
    -- Mesma ordem que get_auditoria_assim_periodo estabeleceu em 20260827000004:
    -- vínculo primeiro (é quem de fato autorizou e deixou o papel), posicional
    -- como fallback de sempre. Bloco sem vínculo não muda — `vin.*` vem tudo
    -- NULL e o COALESCE cai direto no valor de `mt`.
    COALESCE(vin.guia, mt.guia)             AS guia,
    COALESCE(vin.token, mt.token)           AS token,
    mt.data_execucao,
    fo.criado_por,
    -- ── Ordem do COALESCE: vínculo PRIMEIRO ────────────────────────────────
    -- Mesmo erro que 20260827000003 cometeu e 20260827000004 corrigiu na RPC
    -- diária: `fo.forma_autorizacao` é a resposta que a recepção deu para a
    -- guia GLOSADA (aqui, 'QR Code' da 9229) e nunca é nula quando a sessão foi
    -- solicitada pelo Pulsar — então um COALESCE com `fo` na frente nunca chega
    -- a avaliar `vin`. O vínculo tem de vir primeiro; `fo` continua como
    -- fallback para todo bloco sem vínculo, que é a maioria.
    COALESCE(
      public.forma_validacao_do_biofacial(vin.biofacial, vin.teve_token),
      -- Degrau que faltava (20260903010000): o biofacial da guia pareada por
      -- POSIÇÃO. Sem ele, bloco sem vínculo caía direto em `fo` e a tela
      -- mostrava o clique da recepção no lugar da resposta da ASSIM — 4 das 6
      -- linhas do `8-` sem token liam 'Token'/'QR Code' sem ter token.
      public.forma_validacao_do_biofacial(mt.biofacial,  mt.teve_token),
      fo.forma_autorizacao
    )                                        AS forma_autorizacao
  FROM blocos_auditoria b
  JOIN match_temporal mt ON mt.bloco_id = b.bloco_id
  LEFT JOIN fila_operacional fo
    ON  fo.paciente_id      = b.paciente_id
    AND fo.data_atendimento = b.data_atendimento
    AND fo.codigo_tuss      = b.codigo_tuss
    AND fo.horario          = b.hora_inicial
  -- ── Vínculo ativo deste bloco ──────────────────────────────────────────────
  -- Mesmo desenho do LATERAL `vin` de get_auditoria_assim_periodo: por bloco,
  -- não por partição, porque o vínculo é uma afirmação sobre UMA sessão.
  LEFT JOIN LATERAL (
    SELECT v.guia, aa2.teve_token, aa2.token, aa2.biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia
    WHERE v.bloco_id = b.bloco_id
      AND v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
    LIMIT 1
  ) vin ON true
  -- ── Reclassificação manual ────────────────────────────────────────────────
  -- A mesma tabela que get_auditoria_assim_periodo já consome desde
  -- 20260827000001, e que esta função passou a consumir em 20260828170000.
  -- Nenhum destino de reclassificação mantém o bloco como "papel a conferir".
  LEFT JOIN LATERAL (
    SELECT o.situacao_nova
    FROM public.auditoria_situacao_overrides o
    WHERE o.bloco_id = b.bloco_id
      AND o.desfeito_em IS NULL
    LIMIT 1
  ) ovr ON true
  WHERE (
      COALESCE(vin.teve_token, mt.teve_token) = true
      -- ── O ramo da FILA exclui a RECUSA ───────────────────────────────────
      -- Ver o cabeçalho desta migration: `fo.forma_autorizacao` é intenção da
      -- recepção, registrada ANTES da resposta da ASSIM. Sob recusa não saiu
      -- filipeta, e pedir conferência de um papel inexistente não tem resposta
      -- possível.
      --
      -- O teste de `vin.guia` preserva a Semente 3 — bloco com vínculo não é
      -- julgado pelo status da guia glosada que `mt` pareou.
      OR (
        fo.forma_autorizacao ILIKE '%reconhecimento facial%'
        AND vin.guia IS NULL
        -- Testa RECUSA, não liberação — e a diferença entre as duas é o que
        -- salva 19 linhas de julho/2026. Sem guia pareada, `mt.status` é NULL:
        -- a resposta da ASSIM é DESCONHECIDA, não negativa. É o
        -- RETORNO_NAO_CONFIRMADO, onde o registro da recepção é a única
        -- evidência que existe e o papel provavelmente está lá. Só a recusa
        -- explícita prova que filipeta não saiu.
        --
        -- Mesma forma do CASE de `situacao` em get_auditoria_assim_periodo
        -- (`status <> ALL (ARRAY[...])`), para as duas RPCs classificarem a
        -- resposta da ASSIM pela mesma régua. 'Liberado *' (cancelada) fica:
        -- a guia existiu e o papel saiu antes do cancelamento.
        AND NOT (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado', 'Liberado *']))
      )
      OR public.forma_validacao_do_biofacial(vin.biofacial, vin.teve_token)
           ILIKE '%reconhecimento facial%'
      -- ── `8-DISPOSITIVO INDISPONIVEL` exige filipeta (20260903000000) ─────
      -- Vínculo primeiro, posicional como fallback — a mesma precedência de
      -- guia/token/forma acima. Sem gate de recusa: biofacial é campo do
      -- RELATÓRIO da ASSIM (resposta), não do modal da recepção (intenção);
      -- ver o cabeçalho desta migration.
      --
      -- Pelo PREFIXO, não pelo rótulo de `forma_validacao_do_biofacial`, que
      -- devolve 'Token' quando o `8-` veio com token e perderia 97 dos 106
      -- casos medidos — justamente o inverso do pedido.
      OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) = '8'
    )
    AND ovr.situacao_nova IS NULL
    AND COALESCE(b.terapias, '') NOT ILIKE '%Equoterapia%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Fisioterapia Aquática%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Avaliação Neuropsicológica%'
  ORDER BY b.data_atendimento, b.hora_inicial, b.paciente_nome
$function$
;

comment on function public.get_tokens_mensal(date) is
  'Conferência de Filipetas: sessões do mês com filipeta, erro de reconhecimento facial ou biofacial 8-DISPOSITIVO INDISPONIVEL (com ou sem token, porque o papel do #checkBday e consequencia do 8- e nao do token) que a ASSIM não RECUSOU (considerando a guia VINCULADA quando existe vínculo ativo, não só a fila), exceto as cobertas por reclassificação manual ativa (public.auditoria_situacao_overrides). Sessão recusada não deixa papel e por isso não entra; sessão SEM resposta da ASSIM (retorno não confirmado) entra, porque ali o papel provavelmente existe. forma_autorizacao segue a ordem vinculo -> posicional -> fila: os dois primeiros sao a RESPOSTA da ASSIM (biofacial do relatorio), a fila e a INTENCAO da recepcao e so vale quando a ASSIM nao respondeu ou trouxe codigo desconhecido.';
