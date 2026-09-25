-- Conferência de Guias: número da guia que cobriu a sessão pela Reconciliação — 24/09/2026
--
-- APLICA a migration 20260924210000_conferencia_guias_guia_vinculo numa
-- transação e registra a versão no livro-caixa. Pré-requisito: a
-- 20260924200000 (snippet 20260924_conferencia_guias_APLICAR.sql), já aplicada.
--
-- Caso que motivou: sessão com SUBSTITUIÇÃO (João Lucas P. da S., 21/09 09:20)
-- aparecia "Liberada" sem número de guia. Só recria a função de leitura da
-- tela; nenhuma tabela é tocada. Reexecutável.

begin;

-- =============================================================================
-- Conferência de Guias: a guia que cobriu a sessão pela Reconciliação
-- =============================================================================
-- Relatado da tela em 24/09/2026: João Lucas Pereira da Silva, 21/09 09:20,
-- "Liberada" sem número de guia. A sessão é uma SUBSTITUIÇÃO (falta do
-- terapeuta, outra fono atendeu com a avulsa 321907): get_auditoria_assim_periodo
-- promove a situação a LIBERADA pelo vínculo, mas a coluna `guia` do bloco é o
-- pareamento posicional — vazia ali, e a guia RECUSADA na glosa resolvida.
--
-- Acrescenta `guia_vinculo` e `tipo_vinculo`. Corpo idêntico a 20260924200000
-- exceto por essas duas colunas e o lateral `vin`. DROP porque o RETURNS TABLE
-- muda; o SET statement_timeout vai redeclarado (CREATE perde o proconfig).
-- =============================================================================

drop function if exists public.get_conferencia_guias_dia(date);

create function public.get_conferencia_guias_dia(p_data date)
returns table (
  bloco_id             text,
  paciente_id          text,
  paciente_nome        text,
  carteirinha          text,
  data_atendimento     date,
  hora_inicial         time,
  codigo_tuss          text,
  terapias             text,
  profissionais        text,
  quantidade_sessoes   bigint,
  guia                 text,
  status_assim         text,
  situacao             text,
  observacao           text,
  data_atendimento_real date,
  grade_total          bigint,
  grade_com_evolucao   bigint,
  risco_evolucao       text,
  status_conferencia   text,
  conferido_por_nome   text,
  conferido_em         timestamptz,
  recepcao_avisada_em  timestamptz,
  recepcao_avisada_por_nome text,
  observacao_conferencia text,
  guia_vinculo         text,
  tipo_vinculo         text
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
-- As colunas de saída têm os mesmos nomes das colunas lidas (paciente_id,
-- situacao…); sem isto uma referência sem prefixo vira erro de ambiguidade.
#variable_conflict use_column
begin
  if not (public.usuario_tem_permissao('conferencia_guias')
          or public.remuneracao_has_role(array['admin', 'faturamento'])) then
    raise exception 'sem permissão para a Conferência de Guias' using errcode = '42501';
  end if;

  return query
  select
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.carteirinha,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.terapias,
    b.profissionais,
    b.quantidade_sessoes,
    b.guia,
    b.status_assim,
    b.situacao,
    b.observacao,
    b.data_atendimento_real,
    coalesce(ev.total, 0),
    coalesce(ev.com_evolucao, 0),
    -- O pior veredito entre as linhas da grade no horário (dois profissionais
    -- na mesma sessão existem). Nulo = nenhuma foi auditada ainda.
    case ev.pior_risco
      when 3 then 'risco_relevante'
      when 2 then 'risco_especifico'
      when 1 then 'sem_risco'
    end,
    c.status,
    c.conferido_por_nome,
    c.conferido_em,
    c.recepcao_avisada_em,
    c.recepcao_avisada_por_nome,
    c.observacao,
    vin.guia,
    vin.tipo
  from public.get_auditoria_assim_periodo(p_data, p_data) b
  -- Paciente + data + hora casou 806 de 806 blocos em 01, 15 e 23/09/2026.
  -- Sem TUSS de propósito: a grade não tem TUSS, tem terapia_nome, e o nome
  -- não bate com o `terapias` agregado do bloco.
  left join lateral (
    select
      count(*) as total,
      count(*) filter (where nullif(btrim(g.descricao_evolucao), '') is not null) as com_evolucao,
      max(case ae.status_risco
            when 'risco_relevante' then 3
            when 'risco_especifico' then 2
            when 'sem_risco' then 1
          end) as pior_risco
    from public.csv_grades_profissionais g
    left join public.auditoria_evolucoes ae on ae.grade_id = g.id
    where g.ativo
      and g.paciente_id = b.paciente_id::bigint
      and g.data = b.data_atendimento
      and g.hora_inicial = b.hora_inicial
  ) ev on true
  -- A guia que cobriu a sessão pela Reconciliação. A coluna `guia` do bloco é
  -- só o pareamento posicional: vazia na substituição (a falta do terapeuta
  -- não tem guia) e a RECUSADA na glosa resolvida. Os mesmos dois tipos que
  -- afirmam cobertura em get_auditoria_assim_periodo.
  --
  -- Duas chaves porque a substituição é gravada sobre o bloco SINTÉTICO da
  -- falta (o mesmo formato de listarFaltasAuditoria no frontend); o vínculo
  -- comum, sobre o bloco real. O do bloco real ganha se houver os dois.
  left join lateral (
    select v.guia, v.tipo
    from public.autorizacoes_vinculos v
    where v.desfeito_em is null
      and v.tipo in ('vinculo', 'substituicao')
      and v.bloco_id in (
        b.bloco_id,
        concat('falta_', b.paciente_id, '_', b.data_atendimento, '_', b.hora_inicial, '_', b.codigo_tuss)
      )
    order by (v.bloco_id = b.bloco_id) desc, v.vinculado_em desc
    limit 1
  ) vin on true
  left join public.conferencia_guias_assinadas c
    on c.paciente_id = b.paciente_id::bigint
   and c.data_atendimento = b.data_atendimento
   and c.hora_inicial = b.hora_inicial
   and c.codigo_tuss = coalesce(b.codigo_tuss, '');
end;
$$;

revoke all on function public.get_conferencia_guias_dia(date) from public, anon;
grant execute on function public.get_conferencia_guias_dia(date) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260924210000', 'conferencia_guias_guia_vinculo')
on conflict (version) do nothing;

commit;

-- Conferência (rode depois): deve trazer guia_vinculo = 321907, tipo substituicao.
-- (Rodar como postgres no SQL Editor cai no porteiro da função; por isso a
-- conferência lê a tabela de vínculos direto.)
select 'livro-caixa' as item, count(*)::text as valor from supabase_migrations.schema_migrations where version = '20260924210000'
union all
select 'coluna nova', count(*)::text from information_schema.parameters
 where specific_schema = 'public' and specific_name like 'get_conferencia_guias_dia%' and parameter_name = 'guia_vinculo'
union all
select 'vínculo do caso', string_agg(guia || ' ' || tipo, ', ') from public.autorizacoes_vinculos
 where bloco_id = 'falta_11635_2026-09-21_09:20:00_22070397' and desfeito_em is null;
-- Esperado: 1, 1, "321907 substituicao".
