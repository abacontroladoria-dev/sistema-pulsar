-- =============================================================================
-- Conferência de Guias: indicação de token / filipeta
-- =============================================================================
-- Pedido de 24/09/2026: a Silvana precisa ver, na folha, quais sessões
-- deixaram filipeta (token com número; erro de reconhecimento facial ou
-- dispositivo indisponível, papel sem número). Medido em 23/09: 78 das 286
-- sessões tiveram token.
--
-- Acrescenta teve_token, token, biofacial, forma_autorizacao (já devolvidos por
-- get_auditoria_assim_periodo) e o estado da Conferência de Filipetas
-- (auditoria_token_conferencias, por bloco_id). Corpo idêntico a
-- 20260924210000 exceto por essas colunas e o lateral `tc`. DROP porque o
-- RETURNS TABLE muda; o SET statement_timeout vai redeclarado.
--
-- Aplicar pelo SQL Editor: supabase/snippets/20260924_conferencia_guias_filipeta_APLICAR.sql
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
  tipo_vinculo         text,
  teve_token           boolean,
  token                text,
  biofacial            text,
  forma_autorizacao    text,
  filipeta_conferida   boolean,
  filipeta_conferida_por_nome text,
  filipeta_conferida_em timestamptz
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
    vin.tipo,
    -- As três pernas que dizem se a sessão deixou PAPEL (filipeta): o token do
    -- relatório, o biofacial 8- (dispositivo indisponível) e a forma que a
    -- recepção escolheu no robô. A decisão fica no frontend, em
    -- temPapelParaConferir (auditoria-assim/situacoes.ts) — a mesma régua da
    -- Conferência de Filipetas, para as duas telas não divergirem.
    b.teve_token::boolean,
    b.token::text,
    b.biofacial::text,
    b.forma_autorizacao::text,
    -- A conferência que a Conferência de Filipetas grava, só leitura aqui.
    -- Pela RPC porque o faturamento não lê essa tabela direto.
    coalesce(tc.conferido, false),
    tc.conferido_por_nome,
    tc.conferido_em
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
  left join lateral (
    select t.conferido, t.conferido_por_nome, t.conferido_em
    from public.auditoria_token_conferencias t
    where t.bloco_id = b.bloco_id
    order by t.conferido_em desc nulls last
    limit 1
  ) tc on true
  left join public.conferencia_guias_assinadas c
    on c.paciente_id = b.paciente_id::bigint
   and c.data_atendimento = b.data_atendimento
   and c.hora_inicial = b.hora_inicial
   and c.codigo_tuss = coalesce(b.codigo_tuss, '');
end;
$$;

revoke all on function public.get_conferencia_guias_dia(date) from public, anon;
grant execute on function public.get_conferencia_guias_dia(date) to authenticated;
