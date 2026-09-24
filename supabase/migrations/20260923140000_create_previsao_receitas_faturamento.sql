-- Enriquecimento de Receitas: lançamento manual de pagamentos/NF recebidos
-- dos convênios, por paciente e mês de atendimento.
--
-- Hoje o sistema só mostra receita PROJETADA (grade de sessões × cadastro de
-- valores). Não existe em lugar nenhum o registro do que foi REALMENTE pago.
-- Essa tabela é a fonte de verdade pro "Efetivado" real, digitada à mão na
-- aba "Preencher Receitas Faturadas" (/cronograma/indicadores?tab=alimentar-bd).
--
-- "ID TITA" no vocabulário do usuário = paciente_id de verdade neste sistema
-- (não tita_agendamento_id, não agenda_id) — confirmado pelo usuário em
-- 2026-09-23. Respeita a regra do AGENTS.md de nunca usar agenda_id como
-- chave principal.
--
-- Sem coluna de status do pagamento: pedido explícito do usuário, pra não
-- confundir digitação manual — só o valor pago importa pro cálculo de
-- Efetivado/Indefinido (ver frontend/lib/cronograma/receitasEfetivadas.ts).
--
-- PK simples (bigserial), sem unique composto em (paciente_id, competencia,
-- numero_nf): um paciente+mês pode ter múltiplas NFs, e uma correção vira uma
-- nova linha em vez de exigir apagar um lançamento anterior.

create table if not exists public.previsao_receitas_faturamento (
  id               bigserial primary key,
  paciente_id      bigint not null references public.pacientes(id_paciente),
  -- "YYYY-MM" — mesmo formato de previsao_receitas_historico_resumo.competencia.
  competencia      text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  numero_nf        text,
  data_pagamento   date,
  valor_pago       numeric(10,2) not null default 0,

  criado_em             timestamptz not null default now(),
  criado_por_id         uuid references public.usuarios(id),
  criado_por_nome       text,
  atualizado_em         timestamptz not null default now(),
  atualizado_por_id     uuid references public.usuarios(id),
  atualizado_por_nome   text,
  -- String já formatada em horário de Brasília, igual a
  -- laudos_acompanhamento.atualizado_em_brasilia. Coluna GERADA não serve:
  -- to_char() e AT TIME ZONE não são IMMUTABLE.
  atualizado_em_brasilia text
);

create index if not exists idx_prf_paciente_competencia
  on public.previsao_receitas_faturamento (paciente_id, competencia);
create index if not exists idx_prf_competencia
  on public.previsao_receitas_faturamento (competencia);

create or replace function public.set_previsao_receitas_faturamento_atualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.atualizado_em_brasilia :=
    to_char(new.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end;
$$;

drop trigger if exists trg_previsao_receitas_faturamento_atualizado on public.previsao_receitas_faturamento;
create trigger trg_previsao_receitas_faturamento_atualizado
  before insert or update on public.previsao_receitas_faturamento
  for each row execute function public.set_previsao_receitas_faturamento_atualizado();

comment on table public.previsao_receitas_faturamento is
  'Lançamento manual de pagamentos/NF recebidos dos convênios, por paciente e competência. Fonte de verdade do "Efetivado" real (valor realmente pago), usado junto com previsao_receitas_historico (projetado líquido de faltas) pra calcular "Indefinido (Glosa ou Receita)". Sem coluna de status: pedido do usuário, evita confusão na digitação manual.';
comment on column public.previsao_receitas_faturamento.paciente_id is
  '"ID TITA" no vocabulário do usuário — é o paciente_id do sistema, não tita_agendamento_id nem agenda_id.';
comment on column public.previsao_receitas_faturamento.competencia is
  'Mês de atendimento, "YYYY-MM" — mesma competência de previsao_receitas_historico/previsao_receitas_historico_resumo.';
