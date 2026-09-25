-- =============================================================================
-- Conferência de Guias (/conferencia-guias) — pedido de 2026-09-24
-- =============================================================================
-- A conferência que o faturamento faz à mão: toda sessão ASSIM precisa de
-- (1) evolução escrita, (2) assinatura do responsável na folha da recepção e
-- (3) autorização liberada pelo plano. (1) e (3) o Pulsar já sabe; (2) só existe
-- no papel, e é o único fato que esta tela GRAVA.
--
-- A folha: uma por paciente por semana (seg–sex), todas as terapias em ordem
-- cronológica, 10 assinaturas por folha. A numeração das folhas é derivada no
-- cliente — não se grava, porque muda sozinha quando uma sessão entra ou sai.
--
-- ── Chave da marcação ────────────────────────────────────────────────────────
-- Colunas explícitas (paciente, data, hora, TUSS), e não `bloco_id` texto: é a
-- mesma identidade do bloco de get_auditoria_assim_periodo
-- (concat_ws('_', paciente_id, data, tuss, hora)), mas tipada — um `time` não
-- pode chegar como '8:00' de um lado e '08:00:00' do outro. Nunca agenda_id.
--
-- ── Por que a leitura é SECURITY DEFINER ─────────────────────────────────────
-- Quem usa a tela é o faturamento. get_auditoria_assim_periodo é INVOKER e lê
-- fila_autorizacoes, que é endurecida por papel: sem policy, a RLS FILTRA linhas
-- em vez de negar, e a tela mostraria menos sessões sem erro nenhum (o caso
-- 333 × 340 de 22/09). E auditoria_evolucoes guarda o texto clínico, que o
-- faturamento não deve ler. A RPC abaixo roda como dono, devolve exatamente as
-- sessões da Conferência ASSIM, e da evolução só os FATOS (existe? qual o
-- risco?) — nunca o texto. O porteiro é o próprio código da tela.
-- =============================================================================

create table if not exists public.conferencia_guias_assinadas (
  id                         uuid primary key default gen_random_uuid(),
  paciente_id                bigint not null,
  data_atendimento           date not null,
  hora_inicial               time not null,
  codigo_tuss                text not null default '',
  -- null = ainda não conferida (a linha pode existir só pelo aviso à recepção).
  status                     text check (status in ('assinada', 'sem_assinatura')),
  conferido_por              uuid references auth.users,
  conferido_por_nome         text,
  conferido_em               timestamptz,
  -- O aviso é presencial; aqui só se registra QUE foi dado, para ninguém avisar
  -- duas vezes nem esquecer. Vale para guia sem assinatura e para sem autorização.
  recepcao_avisada_em        timestamptz,
  recepcao_avisada_por       uuid references auth.users,
  recepcao_avisada_por_nome  text,
  observacao                 text,
  atualizado_em              timestamptz not null default now(),
  constraint uq_conferencia_guias_sessao unique (paciente_id, data_atendimento, hora_inicial, codigo_tuss)
);

create index if not exists idx_conferencia_guias_data
  on public.conferencia_guias_assinadas (data_atendimento);

comment on table public.conferencia_guias_assinadas is
  'Conferência da folha de assinaturas da recepção (ASSIM). Uma linha por sessão (paciente, data, hora, TUSS) — mesma identidade do bloco de get_auditoria_assim_periodo.';

alter table public.conferencia_guias_assinadas enable row level security;
alter table public.conferencia_guias_assinadas force row level security;

-- Ramo por papel obrigatório: usuario_tem_permissao() lê usuarios_permissoes e
-- IGNORA os roleDefaults do frontend — sem ele o faturamento, que recebe a tela
-- pelo papel, abriria a página e não conseguiria gravar (ver 20260922180200).
drop policy if exists conferencia_guias_assinadas_all on public.conferencia_guias_assinadas;
create policy conferencia_guias_assinadas_all on public.conferencia_guias_assinadas
  for all to authenticated
  using (public.usuario_tem_permissao('conferencia_guias')
         or public.remuneracao_has_role(array['admin', 'faturamento']))
  with check (public.usuario_tem_permissao('conferencia_guias')
              or public.remuneracao_has_role(array['admin', 'faturamento']));

revoke all on public.conferencia_guias_assinadas from anon;
grant select, insert, update, delete on public.conferencia_guias_assinadas to authenticated;

-- ── Leitura do dia ───────────────────────────────────────────────────────────
-- Por DIA, e não por período: uma semana da clínica passa de 1.000 blocos e o
-- PostgREST corta a resposta em silêncio (max_rows). O cliente chama 5 vezes.
create or replace function public.get_conferencia_guias_dia(p_data date)
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
  observacao_conferencia text
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
    c.observacao
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
  left join public.conferencia_guias_assinadas c
    on c.paciente_id = b.paciente_id::bigint
   and c.data_atendimento = b.data_atendimento
   and c.hora_inicial = b.hora_inicial
   and c.codigo_tuss = coalesce(b.codigo_tuss, '');
end;
$$;

revoke all on function public.get_conferencia_guias_dia(date) from public, anon;
grant execute on function public.get_conferencia_guias_dia(date) to authenticated;

-- ── Catálogo de /admin/permissoes ────────────────────────────────────────────
-- Sem a linha, a tela existe no código e é invisível na administração
-- (mesmo motivo de 20260922140000).
insert into public.permissoes (codigo, nome, rota, grupo, descricao) values
  ('conferencia_guias', 'Conferência de Guias', '/conferencia-guias', 'Operações',
   'Folha de assinaturas da recepção (ASSIM) conferida contra evolução e autorização, semana a semana')
on conflict (codigo) do nothing;
