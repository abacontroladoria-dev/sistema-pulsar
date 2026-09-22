-- Conferência ASSIM mostrava números diferentes para o papel `faturamento`:
-- total 333 em vez de 340, faltas zeradas e "não solicitadas" inflada.
-- Causa: `faturamento` não tem policy de SELECT em fila_autorizacoes, e as RPCs
-- da tela rodam como INVOKER — a RLS filtra linhas em silêncio, sem erro.
--
-- Rodar no SQL Editor do Supabase (produção). Idempotente: pode rodar de novo.
-- Espelha supabase/migrations/20260922200000_rls_fila_autorizacoes_faturamento.sql
-- Aplicar por aqui em vez de `db push`, que empurraria todo o pendente.

drop policy if exists fila_autorizacoes_faturamento_select on public.fila_autorizacoes;

create policy fila_autorizacoes_faturamento_select
  on public.fila_autorizacoes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and u.role = 'faturamento'
        and u.ativo = true
    )
  );

-- Conferência 1: os papéis com SELECT na fila. Deve listar `faturamento`
-- junto de recepcao, terapeutico, autorizacao, diretoria, rp e admin.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'fila_autorizacoes' AND cmd = 'SELECT'
ORDER BY policyname;

-- Conferência 2 (na tela, que é o que vale): a Silvana abre
-- /auditoria-assim?tab=auditoria em 22/09/2026 e o TOTAL DE SESSÕES deve bater
-- com o dos outros usuários, com Faltas Paciente e Faltas Terapeuta populadas.
-- Pode ser preciso recarregar a página (F5).
