-- =============================================================================
-- APLICAR NO SQL EDITOR — cópia de
-- supabase/migrations/20260922210000_vinculo_substituicao.sql
--
-- Rodar INTEIRO, de uma vez. As três seções dependem uma da outra: a 2 e a 3
-- gravam e leem o tipo que a 1 libera no CHECK.
--
-- PRÉ-REQUISITO: 20260921100000_vinculo_falta_terapeuta.sql já aplicada. Este
-- arquivo faz DROP das duas constraints que ela criou e do índice
-- autorizacoes_vinculos_falta_ativa_uq — sem ela, o DROP falha por não existir.
--
-- DEPOIS DE APLICAR, conferir o caso que originou o trabalho (João Lucas,
-- 21/09, Fonoaudiologia 09:20): abrir a Reconciliação, desfazer o vínculo que a
-- Luana fez como "falta_terapeuta" e refazê-lo respondendo "Sim — outro
-- profissional assumiu". O badge "1 Autorização a mais" deve sumir da linha, e
-- o cartão das 09:20 deve ficar esmeralda com hachura e borda violeta.
--
-- A falta do titular NÃO é tocada por nada disto, nem aqui nem na tela: ela é
-- fato, foi lançada corretamente e continua valendo em `fila_autorizacoes`.
--
-- Não há backfill: os vínculos de 'falta_terapeuta' já gravados continuam
-- válidos e significando "ninguém assumiu". Os que forem, na verdade,
-- substituição precisam ser desfeitos e refeitos pela tela — são poucos (o tipo
-- nasceu em 21/09) e só quem triou sabe qual foi qual.
-- =============================================================================
-- =============================================================================
-- A falta que teve substituto: o quarto desfecho, 'substituicao'
-- =============================================================================
--
-- O PROBLEMA, medido em produção (João Lucas Pereira Da Silva, 21/09/2026)
-- O profissional titular faltou — isso é FATO, foi lançado corretamente pela
-- recepção e continua registrado — e OUTRO PROFISSIONAL ASSUMIU o atendimento.
-- A sessão de Fonoaudiologia das 09:20 aconteceu. Para autorizá-la pediu-se uma
-- avulsa (22070397), que a Reconciliação ofereceu triar como 'falta_terapeuta' —
-- o único desfecho que existia para um slot de falta.
--
-- O resultado é o defeito relatado: o operador faz o vínculo e a linha continua
-- dizendo "1 Autorização a mais". E o número está certo dado o que o banco sabe:
-- a falta não consome cota (`SITUACOES_SEM_SESSAO`), então a guia liberada fica
-- sem sessão embaixo, o placar acusa `liberadas − agendadas = 1`, e
-- `excedentesDoPlacar` renomeia a guia de volta como excedente. Sair da fila de
-- órfãs — o único efeito de 'falta_terapeuta' — não toca essa segunda fonte.
--
-- POR QUE UM TIPO NOVO, E NÃO PROMOVER 'falta_terapeuta'
-- Porque 'falta_terapeuta' está hoje carregando DOIS casos opostos sob um nome:
--
--   a) o titular faltou e NINGUÉM assumiu → a sessão NÃO aconteceu;
--   b) o titular faltou e OUTRO ASSUMIU   → a sessão ACONTECEU.
--
-- Nos DOIS a falta do titular é fato, foi lançada corretamente e continua
-- registrada. O que muda entre eles não é a falta: é o que veio depois dela.
-- Este arquivo não desfaz falta nenhuma — ele acrescenta o desfecho.
--
-- No caso (a) a regra de 20260921100000 está certa e deve ficar como está:
-- ninguém atendeu, assiduidade intacta. Foi escrita de propósito, com um teste
-- que avisa em voz alta contra "consertá-la" para LIBERADA. Promover o tipo
-- inteiro consertaria (b) e quebraria (a), creditando assiduidade por sessões
-- que de fato não existiram — e esse dano é invisível nesta tela, ele aparece na
-- assiduidade do paciente, noutra página.
--
-- Nenhum dado distingue (a) de (b): quem sabe é a pessoa que triou. Então a
-- triagem passa a PERGUNTAR, e a resposta vira o tipo. É a mesma escolha que
-- aquela migration já fez ao preferir um tipo novo a reusar 'vinculo': com um
-- valor próprio, cada leitor fica correto por construção em vez de depender de
-- um formato de string.
--
-- O QUE 'substituicao' AFIRMA
-- Que a sessão ACONTECEU, com outro profissional, e que esta guia a cobre. Ela
-- é, para todo efeito de cobertura, um 'vinculo' — e é por isso que os leitores
-- de cobertura passam a aceitar os DOIS tipos. O que ela guarda a mais é a
-- procedência: o horário nasceu como falta do titular, e é isso que explica por
-- que a grade do TiTa mostra falta e a Conferência mostra sessão coberta.
--
-- A FALTA DO TITULAR CONTINUA REGISTRADA — e não há o que corrigir
-- `fila_autorizacoes` continua com `status = 'falta'` e `tipo_falta` de
-- terapeuta, e está CERTO: o titular faltou mesmo. Esta migration não reverte
-- nada lá porque não houve erro lá. A falta do profissional é um fato com
-- consequências próprias (é ela que a gestão lê para acompanhar ausência de
-- equipe), e apagá-la ao registrar a substituição destruiria esse dado.
--
-- O que os dois registros dizem juntos é a história inteira: o titular faltou E
-- a sessão aconteceu com outro profissional. Nenhum dos dois sozinho é completo,
-- e é por isso que eles coexistem em vez de um sobrescrever o outro.
--
-- REVERSIBILIDADE
-- Mesma nota de 20260921100000, e pela mesma razão (desvincular é soft delete):
-- enquanto não houver linha do tipo novo basta recolocar os CHECKs antigos.
-- Depois da primeira escrita, reverter exige DROP CONSTRAINT sem recriar ou um
-- UPDATE do tipo.
-- =============================================================================


-- =============================================================================
-- 1. A tabela aceita o quarto desfecho
-- =============================================================================

alter table public.autorizacoes_vinculos
  drop constraint autorizacoes_vinculos_tipo_ck;

alter table public.autorizacoes_vinculos
  add constraint autorizacoes_vinculos_tipo_ck
    check (tipo in ('vinculo', 'sem_sessao', 'falta_terapeuta', 'substituicao'));

-- Mesma forma de 'falta_terapeuta': nasce de uma linha real de fila_autorizacoes
-- (a falta lançada pela recepção), e é o fila_id que lhe dá identidade estável.
alter table public.autorizacoes_vinculos
  drop constraint autorizacoes_vinculos_forma_ck;

alter table public.autorizacoes_vinculos
  add constraint autorizacoes_vinculos_forma_ck
    check (
      (tipo = 'vinculo'         and bloco_id is not null) or
      (tipo = 'sem_sessao'      and bloco_id is null and fila_id is null) or
      (tipo = 'falta_terapeuta' and bloco_id is not null and fila_id is not null) or
      (tipo = 'substituicao'    and bloco_id is not null and fila_id is not null)
    );

comment on column public.autorizacoes_vinculos.tipo is
  'vinculo = cobre o bloco; sem_sessao = autorização extra, sem sessão correspondente; falta_terapeuta = o TITULAR faltou e NINGUÉM assumiu, então não houve sessão (vínculo puro); substituicao = o titular faltou e OUTRO PROFISSIONAL assumiu, então a sessão aconteceu e a guia a cobre. Nos dois últimos a falta do titular é fato e continua registrada — o que os separa é ter havido substituto ou não.';

-- Uma falta recebe no máximo uma triagem ativa, seja ela qual for.
--
-- O índice de 20260921100000 chaveava só 'falta_terapeuta'. Com dois tipos
-- possíveis sobre o mesmo slot, ele deixaria passar uma falta marcada ao mesmo
-- tempo como "ninguém cobriu" e "houve substituto" — as duas afirmações opostas
-- que esta migration existe para separar, convivendo na mesma linha da fila.
drop index if exists public.autorizacoes_vinculos_falta_ativa_uq;

create unique index if not exists autorizacoes_vinculos_falta_ativa_uq
  on public.autorizacoes_vinculos (fila_id)
  where desfeito_em is null and tipo in ('falta_terapeuta', 'substituicao');


-- =============================================================================
-- 2. vincular_autorizacao_substituicao — a escrita
-- =============================================================================
-- Irmã de vincular_autorizacao_falta, com as MESMAS dez guardas: a entrada é a
-- mesma (uma falta de terapeuta, identificada por fila_id), e o que muda é só o
-- que se AFIRMA ao gravar. Uma função própria, e não um parâmetro booleano em
-- vincular_autorizacao_falta, porque o nome da função é o que aparece no log e
-- nas permissões — `..._falta(p_houve_substituto => true)` esconderia atrás de
-- um argumento a diferença que decide assiduidade.
create or replace function public.vincular_autorizacao_substituicao(
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
  -- 1) permissão
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

  -- 3) a guia ainda não foi triada
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

  -- 5) É FALTA DE TERAPEUTA. Substituição só faz sentido sobre a ausência do
  --    profissional: quem falta e é substituído é ele. Falta do paciente não se
  --    cobre com substituto, e unidade fechada não abriu para ninguém.
  if coalesce(v_f.tipo_falta, '') not ilike '%terapeuta%' then
    raise exception 'Só falta de TERAPEUTA pode ser marcada como substituição (esta é: %)',
      coalesce(nullif(btrim(v_f.tipo_falta), ''), '(sem tipo de falta)')
      using errcode = '22023';
  end if;

  -- 6) a falta não foi adiantada
  if v_f.data_atendimento_real is not null then
    raise exception 'Esta sessão foi marcada como adiantada para % — ela voltou à Conferência como sessão, e o vínculo correto é o de sessão.',
      v_f.data_atendimento_real using errcode = '22023';
  end if;

  -- 7) mesmo TUSS
  if v_f.tuss is distinct from v_g.codigo_tuss then
    raise exception 'TUSS divergente: guia % é %, falta é %',
      p_guia, v_g.codigo_tuss, coalesce(v_f.tuss, '(nulo)') using errcode = '22023';
  end if;

  -- 8) mesmo beneficiário
  if v_f.paciente_id::bigint is distinct from v_g.paciente_id then
    raise exception 'Beneficiário divergente: guia % é do paciente %, falta é do paciente %',
      p_guia, v_g.paciente_id, v_f.paciente_id using errcode = '22023';
  end if;

  -- 9) dentro da janela retroativa
  if v_f.data_atendimento > date(v_g.data_execucao)
  or v_f.data_atendimento < date(v_g.data_execucao) - p_janela_dias then
    raise exception 'Falta de % fora da janela de % dias da autorização (%)',
      v_f.data_atendimento, p_janela_dias, date(v_g.data_execucao) using errcode = '22023';
  end if;

  -- 10) a falta ainda não foi triada por outra guia (qualquer um dos dois tipos)
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.fila_id = p_fila_id and v.desfeito_em is null
               and v.tipo in ('falta_terapeuta', 'substituicao')) then
    raise exception 'Esta falta já tem uma autorização registrada' using errcode = '23505';
  end if;

  v_bloco := 'falta_' || v_f.paciente_id::text
                      || '_' || v_f.data_atendimento::text
                      || '_' || v_f.horario::text
                      || '_' || v_f.tuss;

  insert into public.autorizacoes_vinculos
    (guia, tipo, bloco_id, fila_id, guia_original, observacao,
     vinculado_por, vinculado_por_id)
  values
    (p_guia, 'substituicao', v_bloco, p_fila_id, v_f.numero_autorizacao,
     nullif(btrim(p_observacao), ''), coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.vincular_autorizacao_substituicao(text, uuid, text, integer) is
  'Registra que num slot de FALTA DO TITULAR outro profissional assumiu e a sessão aconteceu, coberta por esta guia. Diferente de vincular_autorizacao_falta: aqui a sessão É considerada coberta (sai de "autorização a mais" e deixa de pedir trabalho). NÃO mexe em fila_autorizacoes: a falta do titular é fato, foi lançada corretamente e continua valendo — os dois registros juntos dizem a história inteira (o titular faltou E a sessão aconteceu com substituto). Desfaz-se por desvincular_autorizacao.';

revoke all on function public.vincular_autorizacao_substituicao(text, uuid, text, integer) from public;
grant execute on function public.vincular_autorizacao_substituicao(text, uuid, text, integer) to authenticated;


-- =============================================================================
-- 3. get_candidatas_vinculo — a falta já triada como substituição some da oferta
-- =============================================================================
-- Uma linha só muda: o LATERAL `vin` do ramo `faltas` filtrava
-- `tipo = 'falta_terapeuta'`, e com isso uma falta já marcada como substituição
-- voltaria a aparecer ELEGÍVEL para uma segunda guia — a RPC de escrita a
-- recusaria (guarda 10), mas só depois do clique, com um 23505 na cara de quem
-- triou. `ja_vinculado` e `elegivel` precisam saber dos dois tipos.
--
-- CREATE OR REPLACE sem DROP: o retorno não muda, só o corpo. E o SET
-- statement_timeout é reposto porque CREATE OR REPLACE descarta proconfig.
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
  tipo_falta         text
)
language plpgsql
stable
security definer
set search_path = public
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
      nullif(btrim(substring(coalesce(a.motivo_glosa, a.descricao_erro, '') from '^\s*(\d{3,5})\s*-')), '') as mg_cod,
      nullif(btrim(regexp_replace(coalesce(a.motivo_glosa, a.descricao_erro, ''), '^\s*\d{3,5}\s*-\s*', '')), '') as mg_desc,
      a.observacao
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
      (vin.guia is null and c.situacao <> 'LIBERADA') as elegivel,
      c.data_atendimento_real,
      null::text as tipo_falta,
      c.data_efetiva
    from cand_efetiva c
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
    where c.data_efetiva between v_ate - p_janela_dias and v_ate
  ),
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
      coalesce(f.justificativa_falta, f.motivo_falta) as observacao,
      f.id                                         as fila_id,
      (vin.guia is not null)                       as ja_vinculado,
      (vin.guia is null)                           as elegivel,
      null::date                                   as data_atendimento_real,
      f.tipo_falta,
      f.data_atendimento                           as data_efetiva
    from public.fila_autorizacoes f
    -- OS DOIS TIPOS. Ver o cabeçalho da seção: filtrar só 'falta_terapeuta'
    -- reofereceria como elegível uma falta já triada como substituição.
    left join public.autorizacoes_vinculos vin
      on vin.fila_id = f.id and vin.desfeito_em is null
     and vin.tipo in ('falta_terapeuta', 'substituicao')
    where f.data_atendimento between v_de and v_ate
      and f.paciente_id::bigint = v_g.paciente_id
      and f.tuss                = v_g.codigo_tuss
      and f.tipo_falta ilike '%terapeuta%'
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
    round(extract(epoch from (v_g.data_execucao - (t.data_efetiva + t.hora_inicial))) / 3600.0, 2) as distancia_horas,
    t.ja_vinculado, t.elegivel, t.data_atendimento_real, t.tipo_falta
  from todas t
  order by
    case
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
  'Candidatas de uma guia órfã: sessões do mesmo beneficiário e TUSS na janela retroativa (default 7 dias) medida sobre coalesce(data_atendimento_real, data_atendimento), MAIS as faltas de TERAPEUTA da mesma janela (20260921100000), que a guia pode ter autorizado — sem cobrir sessão (falta_terapeuta) ou cobrindo-a, se houve substituto (substituicao, 20260922210000). Varre um dia a mais para alcançar sessões adiantadas. Nunca vincula — só ordena por relevância.';

revoke all on function public.get_candidatas_vinculo(text, integer) from public;
grant execute on function public.get_candidatas_vinculo(text, integer) to authenticated;
