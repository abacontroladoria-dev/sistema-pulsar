-- ═════════════════════════════════════════════════════════════════════════════
-- DESFAZER da 20261019180100 (cadastro de pacientes só com permissão).
-- NÃO APLIQUE sem necessidade: reabre a leitura de CPF, endereço e responsável
-- de TODOS os pacientes para qualquer usuário logado.
--
-- Use só se uma tela quebrar por falta de leitura de `pacientes` e a correção
-- não puder esperar. Depois de aplicar, me avise: a tela quebrada precisa ser
-- ajustada e a 20261019180100 reaplicada.
--
-- Trava: troque `false` por `true` abaixo para o arquivo rodar.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  quero_reabrir_a_leitura_de_pacientes boolean := false;
begin
  if not quero_reabrir_a_leitura_de_pacientes then
    raise exception 'Pare: este arquivo REABRE a leitura do cadastro de pacientes para qualquer login. Nada foi alterado.';
  end if;
end $$;

drop policy if exists pacientes_select on public.pacientes;
create policy pacientes_select on public.pacientes
  for select to authenticated
  using (true);
