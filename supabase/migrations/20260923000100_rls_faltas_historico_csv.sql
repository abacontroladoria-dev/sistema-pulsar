-- RLS de faltas_historico_csv: dado financeiro sensível (alimenta dedução de
-- receita por paciente), mesmo padrão de previsao_receitas_historico
-- (20260728190000_restringir_rls_previsao_receitas_historico.sql).

alter table public.faltas_historico_csv enable row level security;

create policy "faltas_historico_csv_select"
  on public.faltas_historico_csv for select
  to authenticated
  using (public.remuneracao_has_role(array['admin','diretoria']));

create policy "faltas_historico_csv_write"
  on public.faltas_historico_csv for all
  to service_role
  using (true) with check (true);
