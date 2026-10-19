-- ═════════════════════════════════════════════════════════════════════════════
-- Segurança — cadastro de pacientes só para quem tem a permissão (Fase 5,
-- parte 2 de 2, branch feat/seguranca-falhas-dados)
--
-- TRAVA: aplicar SÓ DEPOIS de
--   1. a 20261019160000 (RPCs da lista básica, busca do PEP, Autorizações
--      Avulsas) aplicada, e
--   2. o redeploy do frontend desta branch (Grade, Ocupação Paciente, Alimentar
--      BD, PEP e Connect deixam de ler a tabela direto), e
--   3. a pré-checagem 5.x (supabase/snippets/20261019_seguranca_prechecagem_SO_LEITURA.sql)
--      conferida: quem perderia a leitura recebeu a permissão pelo grupo.
-- O primeiro bloco falha de propósito até você trocar `false` por `true`.
--
-- O que muda: some a policy `pacientes_select using (true)` (20260817190000):
-- qualquer login lia CPF, endereço e responsável de todos os pacientes. Ficam
-- lendo a tabela:
--   • quem tem `cadastros_pacientes` (policy nova, explícita, e a
--     pacientes_write_cadastro de 20260826100500);
--   • os papéis admin/diretoria/cronograma (pacientes_write, 20260817190000);
--   • as funções security definer e a service_role.
-- As demais telas usam a lista básica (pacientes_lista_basica).
--
-- Desfazer (se uma tela quebrar): recriar a policy antiga —
--   create policy pacientes_select on public.pacientes for select to authenticated using (true);
--
-- Idempotente. Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

do $$
declare
  rpcs_aplicadas_e_frontend_publicado boolean := false;
begin
  if not rpcs_aplicadas_e_frontend_publicado then
    raise exception 'Pare: aplique a 20261019160000, publique o frontend da branch feat/seguranca-falhas-dados, confira a pré-checagem 5.x e troque false por true no topo. Nada foi alterado.';
  end if;
  if to_regprocedure('public.pacientes_lista_basica(bigint[], bigint[])') is null then
    raise exception 'Pare: a 20261019160000 (pacientes_lista_basica) não está aplicada neste banco. Nada foi alterado.';
  end if;
end $$;

drop policy if exists pacientes_select on public.pacientes;
drop policy if exists pacientes_select_cadastro on public.pacientes;

create policy pacientes_select_cadastro on public.pacientes
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

-- Conferência: nenhuma policy de leitura aberta sobrou. Esperado: nenhuma linha.
do $$
declare
  v_abertas text;
begin
  select string_agg(policyname, ', ') into v_abertas
  from pg_policies
  where schemaname = 'public' and tablename = 'pacientes'
    and cmd in ('SELECT', 'ALL')
    and coalesce(qual, 'true') in ('true', '(true)');
  if v_abertas is not null then
    raise exception 'Pare: ainda há policy que libera a leitura de pacientes a qualquer login: %', v_abertas;
  end if;
end $$;
