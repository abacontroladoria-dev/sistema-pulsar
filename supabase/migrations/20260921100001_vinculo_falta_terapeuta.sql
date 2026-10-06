-- =============================================================================
-- A guia órfã passa a poder ser a autorização de uma FALTA DE TERAPEUTA
-- =============================================================================
--
-- O PROBLEMA
-- A Reconciliação só oferece como alvo uma sessão AGENDADA. Existe um caso real
-- sem desfecho: a guia foi autorizada para um horário em que o TERAPEUTA faltou.
-- Ela não cobre sessão nenhuma, e marcá-la como 'sem_sessao' ("autorização
-- extra") apaga o que se sabe — que ela tem origem conhecida, aquele slot de
-- falta. O resultado hoje é uma guia que volta à fila de órfãs todo dia sem ter
-- para onde ir, ou um descarte que mente sobre o que aconteceu.
--
-- O QUE ESTA MIGRATION FAZ, E O QUE ELA DELIBERADAMENTE NÃO FAZ
-- Cria um terceiro desfecho de triagem: 'falta_terapeuta'. Ele é VÍNCULO PURO.
--
--   A falta CONTINUA SENDO FALTA. Nenhuma sessão é criada. Assiduidade, cota,
--   glosa e KPIs não mudam. Nada vira LIBERADA.
--
-- O único efeito é duplo e pequeno: a guia sai da fila de órfãs, e o slot da
-- falta passa a mostrar de onde veio a autorização.
--
-- POR QUE UM TIPO NOVO, E NÃO 'vinculo' COM O BLOCO SINTÉTICO DA FALTA
-- Porque TODO leitor que decide cobertura já filtra `tipo = 'vinculo'` — o
-- LATERAL `vin` de get_auditoria_assim_periodo, o `vin` de
-- get_candidatas_vinculo, o índice único de bloco, e do lado do cliente
-- `situacaoComVinculo`, `cobertaPorAvulsa` e `guiasSubstituidas`. Com um tipo
-- novo eles ficam corretos POR CONSTRUÇÃO. Reusando 'vinculo', a proteção
-- passaria a depender de o bloco sintético `falta_…` nunca casar por acidente
-- com um bloco real — garantia de FORMATO DE STRING, não de tipo.
--
-- Levantamento feito antes de escolher (a memória do projeto avisa que "o CHECK
-- protege a escrita e nada protege a leitura"): dos 16 leitores de
-- autorizacoes_vinculos, 9 ficam corretos sem tocar em nada, 3 deles por dupla
-- proteção. Os que mudam estão nesta migration e no frontend, um a um.
--
-- A CONSEQUÊNCIA ASSUMIDA DE OLHOS ABERTOS
-- Dois lugares tiram a guia triada do pareamento posicional, e NÃO filtram tipo:
--   20260827000001:293 (get_auditoria_assim_periodo)
--   20260910120050:143 (get_guias_orfas)
-- Então a guia vinculada a uma falta deixa de competir no row_number() do dia da
-- data_execucao. Se ela estava casada POR POSIÇÃO com alguma sessão daquele dia,
-- essa sessão volta a aparecer descoberta.
--
-- Isso é aceito, e sem mitigação no banco, por três razões:
--   1. é correto — o pareamento posicional é heurística, o vínculo manual é
--      informação melhor. Se alguém afirma que a guia autorizou a falta de
--      quinta, então ela NÃO cobriu a sessão que o row_number() lhe atribuiu, e
--      revelar isso é o trabalho desta tela;
--   2. é o que 'sem_sessao' já faz desde 2026-08 — mesmo predicado, mesmo
--      efeito. Tratar diferente seria inconsistente;
--   3. a alternativa desfaz o requisito: filtrar aquele NOT EXISTS por tipo
--      manteria a guia no pool E vinculada à falta (a mesma guia cobrindo duas
--      coisas) e — por ser o MESMO predicado em get_guias_orfas — ela não sairia
--      da fila de órfãs, que é o objetivo do trabalho.
-- A mitigação é de UI: o modal de confirmação diz isso por extenso antes do
-- clique, para que o efeito seja anunciado em vez de descoberto pela grade.
--
-- REVERSIBILIDADE — ler antes de precisar
-- Enquanto não houver NENHUMA linha do tipo novo, basta recolocar os CHECKs
-- antigos. Depois da primeira escrita não basta: desvincular_autorizacao é SOFT
-- delete (a linha fica, com desfeito_em preenchido) e um CHECK vale para as
-- linhas existentes, não só para as novas. A partir daí reverter exige DROP
-- CONSTRAINT sem recriar, ou um UPDATE do tipo.
-- =============================================================================


-- =============================================================================
-- 1. A tabela aceita o terceiro desfecho
-- =============================================================================

alter table public.autorizacoes_vinculos
  drop constraint autorizacoes_vinculos_tipo_ck;

alter table public.autorizacoes_vinculos
  add constraint autorizacoes_vinculos_tipo_ck
    check (tipo in ('vinculo', 'sem_sessao', 'falta_terapeuta'));

-- O tipo define a forma da linha. A falta TEM fila_id — ela nasce de uma linha
-- real de fila_autorizacoes, que é a sua identidade —, e exigi-lo aqui é o que
-- impede um 'falta_terapeuta' órfão de linha, cujo bloco sintético não poderia
-- ser reconferido contra nada.
alter table public.autorizacoes_vinculos
  drop constraint autorizacoes_vinculos_forma_ck;

alter table public.autorizacoes_vinculos
  add constraint autorizacoes_vinculos_forma_ck
    check (
      (tipo = 'vinculo'         and bloco_id is not null) or
      (tipo = 'sem_sessao'      and bloco_id is null and fila_id is null) or
      (tipo = 'falta_terapeuta' and bloco_id is not null and fila_id is not null)
    );

comment on column public.autorizacoes_vinculos.tipo is
  'vinculo = cobre o bloco; sem_sessao = autorização extra, sem sessão correspondente; falta_terapeuta = autorizou um horário em que o TERAPEUTA faltou (vínculo puro: a falta continua falta, nada vira coberto).';

-- Uma falta é autorizada por no máximo uma guia ativa.
--
-- Chaveia por fila_id e NÃO por bloco_id: o bloco sintético embute o horário, e
-- se a recepção editar o horário da falta o bloco muda — o índice deixaria de
-- proteger exatamente quando o dado se mexe. fila_id é a identidade estável.
--
-- Índice próprio, e não uma ampliação de autorizacoes_vinculos_bloco_ativo_uq:
-- aquele existe para a Conferência nunca somar duas coberturas no mesmo bloco, e
-- os dois espaços de chave não se cruzam (um bloco `falta_…` nunca é um bloco
-- real). Ampliá-lo misturaria as duas garantias numa só.
create unique index if not exists autorizacoes_vinculos_falta_ativa_uq
  on public.autorizacoes_vinculos (fila_id)
  where desfeito_em is null and tipo = 'falta_terapeuta';


-- =============================================================================
-- 2. get_candidatas_vinculo — as faltas de terapeuta entram como candidatas
-- =============================================================================
-- Corpo idêntico ao de 20260916120300 exceto pelo CTE `faltas`, pela união, pela
-- coluna `tipo_falta` no retorno e pelo `vin` ampliado. Recriado inteiro porque
-- é plpgsql.
--
-- DE ONDE VEM A FALTA
-- Não de get_faltas_auditoria_assim: aquela é por DIA (multiplicaria as 9 fatias
-- já pesadas) e não filtra beneficiário. Aqui se lê fila_autorizacoes direto,
-- num statement só sobre a janela inteira, repetindo os predicados daquela
-- função (20260916130100:503-518) — inclusive a BLACKLIST e o
-- data_atendimento_real, que exclui a sessão adiantada (ela já voltou como bloco
-- REAL e seria oferecida duas vezes, em estados opostos).
--
-- O beneficiário casa por paciente_id, sem precisar de carteirinha:
-- autorizacoes_assim carrega paciente_id (é o que get_guias_orfas usa) e
-- fila_autorizacoes também. `::bigint` no lado da fila — a coluna é texto ali
-- (o cast do lado certo é dívida conhecida deste módulo).
--
-- SÓ TERAPEUTA, por decisão do domínio: falta do paciente e unidade fechada
-- ficam de fora. A guarda é repetida na RPC de escrita — esta aqui decide o que
-- a tela OFERECE, aquela decide o que o banco ACEITA.
--
-- DROP antes do CREATE: o retorno ganha `tipo_falta` e CREATE OR REPLACE não
-- muda tipo de retorno (42P13).
drop function if exists public.get_candidatas_vinculo(text, integer);

create or replace function public.get_candidatas_vinculo(
  p_guia         text,
  p_janela_dias  integer default 7
)
returns table (
  bloco_id           text,
  paciente_id        text,
  paciente_nome      text,
  data_atendimento   date,
  hora_inicial       time without time zone,
  codigo_tuss        text,
  terapias           text,
  profissionais      text,
  quantidade_sessoes bigint,
  situacao           text,
  guia_atual         text,
  status_assim       text,
  motivo_glosa_codigo    text,
  motivo_glosa_descricao text,
  observacao         text,
  fila_id            uuid,
  distancia_horas    numeric,
  ja_vinculado       boolean,
  elegivel           boolean,
  data_atendimento_real date,
  -- Nulo nas sessões. Quando presente, a candidata é uma FALTA e a tela sabe que
  -- o gesto ali não é "cobrir" e sim "registrar a autorização".
  tipo_falta         text
)
language plpgsql
stable
security definer
set search_path = public
-- Reposto explicitamente: CREATE OR REPLACE FUNCTION descarta proconfig, e sem o
-- SET a função voltaria ao default e penduraria a tela na fatia patológica.
set statement_timeout = '55s'
as $$
declare
  v_g       record;
  v_empresa text;
  v_matric  text;
  v_dep     text;
  v_de      date;
  v_ate     date;
begin
  if p_janela_dias is null or p_janela_dias < 0 or p_janela_dias > 60 then
    raise exception 'Janela inválida: % (esperado 0..60)', p_janela_dias
      using errcode = '22023';
  end if;

  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status,
         aa.paciente_id
    into v_g
  from public.autorizacoes_assim aa
  where aa.guia = p_guia;

  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia
      using errcode = 'P0002';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS — não é reconciliável', p_guia
      using errcode = '22023';
  end if;

  v_empresa := split_part(v_g.matricula, '.', 1);
  v_matric  := split_part(v_g.matricula, '.', 2);
  v_dep     := split_part(v_g.matricula, '.', 3);
  v_ate     := date(v_g.data_execucao);
  v_de      := v_ate - p_janela_dias;

  return query
  with cand as (
    select
      a.bloco_id, a.paciente_id, a.paciente_nome, a.data_atendimento,
      a.hora_inicial, a.codigo_tuss, a.terapias, a.profissionais,
      a.quantidade_sessoes, a.situacao,
      a.guia         as guia_atual,
      a.status_assim,
      -- motivo_glosa da RPC já vem resolvido pelo de-para glosa_codigos; aqui só
      -- separamos código e texto com a mesma regra de frontend/lib/glosa.ts:27-40
      nullif(btrim(substring(coalesce(a.motivo_glosa, a.descricao_erro, '') from '^\s*(\d{3,5})\s*-')), '') as mg_cod,
      nullif(btrim(regexp_replace(coalesce(a.motivo_glosa, a.descricao_erro, ''), '^\s*\d{3,5}\s*-\s*', '')), '') as mg_desc,
      a.observacao
    -- +1 dia para ALCANÇAR o bloco de uma sessão adiantada, que mora na data
    -- agendada (posterior à execução da guia). Quem decide se ele entra é o
    -- filtro por data efetiva abaixo, não esta varredura.
    from generate_series(v_de, v_ate + 1, interval '1 day') g(dia)
    cross join lateral public.get_auditoria_assim_periodo(g.dia::date, g.dia::date) a
    where a.empresa     = v_empresa
      and a.matricula   = v_matric
      and a.dep         = v_dep
      and a.codigo_tuss = v_g.codigo_tuss
  ),
  cand_efetiva as (
    select c.*, coalesce(dr.data_atendimento_real, c.data_atendimento) as data_efetiva,
           dr.data_atendimento_real
    from cand c
    left join lateral (
      select f.data_atendimento_real
      from public.fila_autorizacoes f
      where f.paciente_id      = c.paciente_id
        and f.data_atendimento = c.data_atendimento
        and f.horario          = c.hora_inicial
        and f.data_atendimento_real is not null
      order by coalesce(f.updated_at, f.created_at) desc
      limit 1
    ) dr on true
  ),
  -- As sessões, no formato final. Separadas para poderem ser unidas às faltas.
  sessoes as (
    select
      c.bloco_id,
      c.paciente_id,
      c.paciente_nome,
      c.data_atendimento,
      c.hora_inicial,
      c.codigo_tuss,
      c.terapias,
      c.profissionais,
      c.quantidade_sessoes,
      c.situacao,
      c.guia_atual,
      c.status_assim,
      c.mg_cod,
      c.mg_desc,
      c.observacao,
      fa.id as fila_id,
      (vin.guia is not null) as ja_vinculado,
      -- Elegível = ainda não coberta e ainda não vinculada. LIBERADA fica visível
      -- de propósito, marcada como não-elegível: é a informação que faz o operador
      -- perceber que a guia é extra e usar "sem sessão correspondente" (39% das
      -- órfãs medidas caem nesse caso).
      (vin.guia is null and c.situacao <> 'LIBERADA') as elegivel,
      c.data_atendimento_real,
      null::text as tipo_falta,
      c.data_efetiva
    from cand_efetiva c
    -- a linha da fila daquela sessão, pelos 4 campos naturais que a RPC usa
    -- (20260820150000:443-447)
    left join lateral (
      select f.id
      from public.fila_autorizacoes f
      where f.paciente_id      = c.paciente_id
        and f.data_atendimento = c.data_atendimento
        and f.tuss             = c.codigo_tuss
        and f.horario          = c.hora_inicial
      order by coalesce(f.updated_at, f.created_at) desc
      limit 1
    ) fa on true
    left join public.autorizacoes_vinculos vin
      on vin.bloco_id = c.bloco_id and vin.desfeito_em is null and vin.tipo = 'vinculo'
    -- A janela sobre a data efetiva. Mesma regra retroativa de sempre: é o
    -- espelho exato da guarda 6 de vincular_autorizacao. Descarta o dia extra
    -- que o generate_series varreu sem ter data real.
    where c.data_efetiva between v_ate - p_janela_dias and v_ate
  ),
  -- As faltas de TERAPEUTA do mesmo beneficiário e TUSS na janela.
  --
  -- O bloco_id é o SINTÉTICO, montado exatamente como o cliente o monta em
  -- frontend/services/auditoria-assim.service.ts (paciente, data, HORA, TUSS —
  -- ordem diferente do bloco real, e cinco pedaços). É por essa string que o
  -- cartão da falta é encontrado na grade; se os dois lados divergirem, o cartão
  -- simplesmente não fica clicável, sem erro nenhum. Há teste no cliente
  -- travando o formato.
  faltas as (
    select
      'falta_' || f.paciente_id::text
               || '_' || f.data_atendimento::text
               || '_' || f.horario::text
               || '_' || f.tuss                    as bloco_id,
      f.paciente_id::text                          as paciente_id,
      f.paciente_nome,
      f.data_atendimento,
      f.horario                                    as hora_inicial,
      f.tuss                                       as codigo_tuss,
      f.terapia_nome                               as terapias,
      (select string_agg(distinct at2.profissional_nome, ' | ' order by at2.profissional_nome)
       from public.agenda_tita at2
       where at2.paciente_id      = f.paciente_id::bigint
         and at2.data_atendimento = f.data_atendimento
         and at2.hora_inicial     = f.horario)     as profissionais,
      null::bigint                                 as quantidade_sessoes,
      'FALTA_TERAPEUTA'::text                      as situacao,
      null::text                                   as guia_atual,
      null::text                                   as status_assim,
      null::text                                   as mg_cod,
      null::text                                   as mg_desc,
      -- O que a recepção escreveu ao registrar a falta. É o que dá ao operador
      -- como decidir se ESTA falta é mesmo a que a guia autorizou.
      coalesce(f.justificativa_falta, f.motivo_falta) as observacao,
      f.id                                         as fila_id,
      (vin.guia is not null)                       as ja_vinculado,
      -- Uma falta nunca é LIBERADA; o que a torna inelegível é já ter sido
      -- autorizada por outra guia.
      (vin.guia is null)                           as elegivel,
      null::date                                   as data_atendimento_real,
      f.tipo_falta,
      f.data_atendimento                           as data_efetiva
    from public.fila_autorizacoes f
    left join public.autorizacoes_vinculos vin
      on vin.fila_id = f.id and vin.desfeito_em is null and vin.tipo = 'falta_terapeuta'
    where f.data_atendimento between v_de and v_ate
      and f.paciente_id::bigint = v_g.paciente_id
      and f.tuss                = v_g.codigo_tuss
      and f.tipo_falta ilike '%terapeuta%'
      -- Sessão adiantada já voltou como bloco real e está no ramo `sessoes`.
      and f.data_atendimento_real is null
      and f.terapia_nome not ilike '%Equoterapia%'
      and f.terapia_nome not ilike '%Fisioterapia Aquática%'
      and f.terapia_nome not ilike '%Avaliação Neuropsicológica%'
      and not exists (
        select 1 from public.agenda_tita at
        join public.config_regras_terapias r
          on at.terapia_nome ilike ('%' || r.terapia_nome || '%')
        where r.categoria = 'BLACKLIST_AUTORIZACAO' and r.ativo = true
          and at.paciente_id      = f.paciente_id::bigint
          and at.data_atendimento = f.data_atendimento
          and at.hora_inicial     = f.horario
      )
  ),
  todas as (
    select * from sessoes
    union all
    select * from faltas
  )
  select
    t.bloco_id, t.paciente_id, t.paciente_nome, t.data_atendimento, t.hora_inicial,
    t.codigo_tuss, t.terapias, t.profissionais, t.quantidade_sessoes, t.situacao,
    t.guia_atual, t.status_assim, t.mg_cod, t.mg_desc, t.observacao, t.fila_id,
    -- Distância medida da data EFETIVA: numa sessão adiantada é ela que descreve
    -- quando o atendimento ocorreu, e é por ela que a ordenação faz sentido.
    round(extract(epoch from (v_g.data_execucao - (t.data_efetiva + t.hora_inicial))) / 3600.0, 2) as distancia_horas,
    t.ja_vinculado, t.elegivel, t.data_atendimento_real, t.tipo_falta
  from todas t
  order by
    case
      -- A falta vem por último de propósito, depois de todo veredito: a sessão
      -- agendada e descoberta é sempre o alvo mais provável, e a falta é o
      -- desfecho de exceção. Oferecê-la antes convidaria ao clique errado.
      when t.tipo_falta is not null       then 7
      when t.situacao = 'GLOSA'                  then 1
      when t.situacao = 'NAO_SOLICITADA'         then 2
      when t.situacao = 'RETORNO_NAO_CONFIRMADO' then 3
      when t.situacao = 'SINCRONIZANDO'          then 4
      when t.situacao = 'CANCELADA'              then 5
      else 6
    end,
    abs(extract(epoch from (v_g.data_execucao - (t.data_efetiva + t.hora_inicial)))),
    t.hora_inicial;
end;
$$;

comment on function public.get_candidatas_vinculo(text, integer) is
  'Candidatas de uma guia órfã: sessões do mesmo beneficiário e TUSS na janela retroativa (default 7 dias) medida sobre coalesce(data_atendimento_real, data_atendimento), MAIS as faltas de TERAPEUTA da mesma janela (20260921100000), que a guia pode ter autorizado sem cobrir sessão. Varre um dia a mais para alcançar sessões adiantadas. Nunca vincula — só ordena por relevância.';

revoke all on function public.get_candidatas_vinculo(text, integer) from public;
grant execute on function public.get_candidatas_vinculo(text, integer) to authenticated;


-- =============================================================================
-- 3. vincular_autorizacao_falta — a escrita, com as guardas
-- =============================================================================
-- RPC PRÓPRIA, e não um ramo dentro de vincular_autorizacao. Daquelas 8 guardas,
-- 6 dependem do formato do bloco real e de fn_blocos_assim (parse do bloco,
-- existência na Conferência, beneficiário e TUSS lidos do bloco, unicidade por
-- bloco, coerência do fila_id com o bloco). Um `if p_bloco_id like 'falta\_%'`
-- pularia seis das oito: o que sobra não é a mesma função com um desvio, é outra
-- função morando dentro de um if. E a chave de entrada é outra — a falta é
-- identificada por fila_id, não por bloco. Uma assinatura que recebe p_bloco_id
-- e o ignora mente sobre o que faz.
--
-- O bloco_id é montado AQUI, a partir da linha da fila, e nunca aceito do
-- cliente: é o que impede o formato de divergir do que a grade usa como chave.
create or replace function public.vincular_autorizacao_falta(
  p_guia        text,
  p_fila_id     uuid,
  p_observacao  text    default null,
  p_janela_dias integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_role  text := public.fn_usuario_role();
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_g     record;
  v_f     record;
  v_bloco text;
  v_id    uuid;
begin
  -- 1) permissão. Mesmos três papéis das RPCs irmãs.
  if v_role is null or v_role not in ('admin', 'autorizacao', 'recepcao') then
    raise exception 'Sem permissão para vincular autorizações'
      using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = v_uid;

  if p_janela_dias is null or p_janela_dias < 0 or p_janela_dias > 60 then
    raise exception 'Janela inválida: % (esperado 0..60)', p_janela_dias
      using errcode = '22023';
  end if;

  -- 2) a guia existe, está liberada e é reconciliável
  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status,
         aa.paciente_id
    into v_g
  from public.autorizacoes_assim aa where aa.guia = p_guia;
  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia using errcode = 'P0002';
  end if;
  if v_g.status is distinct from 'Liberado' then
    raise exception 'Guia % não está liberada (status: %). Só autorização liberada cobre sessão.',
      p_guia, coalesce(v_g.status, '(nulo)') using errcode = '22023';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS', p_guia using errcode = '22023';
  end if;

  -- 3) a guia ainda não foi triada (vinculada, descartada ou já posta noutra falta)
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.guia = p_guia and v.desfeito_em is null) then
    raise exception 'Guia % já foi triada. Desfaça o vínculo atual antes de refazer.', p_guia
      using errcode = '23505';
  end if;

  -- 4) a falta existe
  select f.id, f.paciente_id, f.paciente_nome, f.data_atendimento, f.horario,
         f.tuss, f.tipo_falta, f.data_atendimento_real, f.numero_autorizacao
    into v_f
  from public.fila_autorizacoes f where f.id = p_fila_id;
  if not found then
    raise exception 'Linha de fila % não existe', p_fila_id using errcode = 'P0002';
  end if;

  -- 5) É FALTA DE TERAPEUTA. Esta guarda é o que sustenta o escopo: sem ela a
  --    função aceitaria falta do paciente e unidade fechada pela porta dos
  --    fundos, e nenhuma delas foi decidida.
  if coalesce(v_f.tipo_falta, '') not ilike '%terapeuta%' then
    raise exception 'Só falta de TERAPEUTA pode receber a autorização de uma guia (esta é: %)',
      coalesce(nullif(btrim(v_f.tipo_falta), ''), '(sem tipo de falta)')
      using errcode = '22023';
  end if;

  -- 6) a falta não foi adiantada. Se foi, ela já voltou como bloco REAL na
  --    Conferência e o caminho certo é vincular_autorizacao.
  if v_f.data_atendimento_real is not null then
    raise exception 'Esta sessão foi marcada como adiantada para % — ela voltou à Conferência como sessão, e o vínculo correto é o de sessão.',
      v_f.data_atendimento_real using errcode = '22023';
  end if;

  -- 7) mesmo TUSS. Como na v.1 do vínculo, não se reconcilia entre TUSS.
  if v_f.tuss is distinct from v_g.codigo_tuss then
    raise exception 'TUSS divergente: guia % é %, falta é %',
      p_guia, v_g.codigo_tuss, coalesce(v_f.tuss, '(nulo)') using errcode = '22023';
  end if;

  -- 8) mesmo beneficiário
  if v_f.paciente_id::bigint is distinct from v_g.paciente_id then
    raise exception 'Beneficiário divergente: guia % é do paciente %, falta é do paciente %',
      p_guia, v_g.paciente_id, v_f.paciente_id using errcode = '22023';
  end if;

  -- 9) dentro da janela retroativa. Espelho da guarda 6 de vincular_autorizacao;
  --    aqui sem coalesce com a data real, que a guarda 6 acima já provou nula.
  if v_f.data_atendimento > date(v_g.data_execucao)
  or v_f.data_atendimento < date(v_g.data_execucao) - p_janela_dias then
    raise exception 'Falta de % fora da janela de % dias da autorização (%)',
      v_f.data_atendimento, p_janela_dias, date(v_g.data_execucao) using errcode = '22023';
  end if;

  -- 10) a falta ainda não foi autorizada por outra guia. Redundante com o índice
  --     único, e aqui só para a mensagem ser legível em vez de um 23505 cru.
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.fila_id = p_fila_id and v.desfeito_em is null
               and v.tipo = 'falta_terapeuta') then
    raise exception 'Esta falta já tem uma autorização registrada' using errcode = '23505';
  end if;

  -- O bloco sintético, no formato que a grade usa como chave do cartão.
  v_bloco := 'falta_' || v_f.paciente_id::text
                      || '_' || v_f.data_atendimento::text
                      || '_' || v_f.horario::text
                      || '_' || v_f.tuss;

  insert into public.autorizacoes_vinculos
    (guia, tipo, bloco_id, fila_id, guia_original, observacao,
     vinculado_por, vinculado_por_id)
  values
    (p_guia, 'falta_terapeuta', v_bloco, p_fila_id, v_f.numero_autorizacao,
     nullif(btrim(p_observacao), ''), coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.vincular_autorizacao_falta(text, uuid, text, integer) is
  'Registra que uma guia ASSIM órfã foi a autorização por trás de um slot de FALTA DE TERAPEUTA. VÍNCULO PURO: não cria sessão, não muda situação, não afeta assiduidade, cota, glosa nem KPIs. O único efeito é a guia sair da fila de órfãs e o slot passar a mostrar de onde veio a autorização. Desfaz-se por desvincular_autorizacao, como os demais.';

revoke all on function public.vincular_autorizacao_falta(text, uuid, text, integer) from public;
grant execute on function public.vincular_autorizacao_falta(text, uuid, text, integer) to authenticated;
