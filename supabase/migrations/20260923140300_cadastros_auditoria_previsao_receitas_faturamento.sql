-- Acrescenta a entidade `previsao_receitas_faturamento` à trilha de
-- cadastros — mesmo motivo de 20260828150100 (laudo_acompanhamento) e
-- 20260904120100 (pdi_controle_prazos): sem o CHECK e a RLS conhecerem o
-- valor novo, todo insert de trilha da tela "Preencher Receitas Faturadas" é
-- rejeitado pelo banco em silêncio.
--
-- `registro_id` recebe o `id` (bigserial, como texto) de
-- public.previsao_receitas_faturamento.
--
-- Lista completa copiada de 20260921200200 (a mais recente a reescrever este
-- CHECK/policies), só acrescentando 'previsao_receitas_faturamento' — ver o
-- aviso no cabeçalho de 20260904120100 sobre o risco de esquecer algum valor
-- já em produção.
--
-- IDEMPOTENTE: redefine CHECK e as duas policies com a lista final completa.

-- ===== CHECK =====
alter table public.cadastros_auditoria
  drop constraint if exists cadastros_auditoria_tabela_check;

alter table public.cadastros_auditoria
  add constraint cadastros_auditoria_tabela_check
  check (tabela in (
    'paciente', 'responsavel', 'ficha_medica',
    'laudo', 'alta', 'alta_individualidade', 'suspensao_temporaria', 'alta_clinica',
    'laudo_acompanhamento',
    'pdi_controle_prazos',
    'previsao_receitas_faturamento',
    'convenio', 'plano_saude'
  ));

-- ===== RLS =====
-- Só o ramo `previsao_receitas_faturamento` é novo; os demais são idênticos
-- a 20260921200200, byte a byte. Mesma permissão/papéis da tabela de estado
-- (indicadores_alimentar_bd + admin/diretoria — ver 20260923140100).

drop policy if exists "cadastros_auditoria_select" on public.cadastros_auditoria;

create policy "cadastros_auditoria_select" on public.cadastros_auditoria
  for select to authenticated
  using (
    (tabela in ('paciente', 'responsavel', 'ficha_medica', 'laudo', 'alta', 'alta_individualidade', 'suspensao_temporaria', 'alta_clinica')
      and (
        public.usuario_tem_permissao('cadastros_pacientes')
        or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
      ))
    or (tabela in ('convenio', 'plano_saude')
      and (
        public.usuario_tem_permissao('cadastros_convenios')
        or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
      ))
    or (tabela = 'laudo_acompanhamento'
      and (
        public.usuario_tem_permissao('acompanhamento_laudos')
        or public.remuneracao_has_role(array['admin','diretoria','recepcao'])
      ))
    or (tabela = 'pdi_controle_prazos'
      and (
        public.usuario_tem_permissao('terapeutico_pdi')
        or public.remuneracao_has_role(array['admin','diretoria'])
      ))
    or (tabela = 'previsao_receitas_faturamento'
      and (
        public.usuario_tem_permissao('indicadores_alimentar_bd')
        or public.remuneracao_has_role(array['admin','diretoria'])
      ))
  );

drop policy if exists "cadastros_auditoria_insert" on public.cadastros_auditoria;

create policy "cadastros_auditoria_insert" on public.cadastros_auditoria
  for insert to authenticated
  with check (
    (tabela in ('paciente', 'responsavel', 'ficha_medica', 'laudo', 'alta', 'alta_individualidade', 'suspensao_temporaria', 'alta_clinica')
      and (
        public.usuario_tem_permissao('cadastros_pacientes')
        or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
      ))
    or (tabela in ('convenio', 'plano_saude')
      and (
        public.usuario_tem_permissao('cadastros_convenios')
        or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
      ))
    or (tabela = 'laudo_acompanhamento'
      and (
        public.usuario_tem_permissao('acompanhamento_laudos')
        or public.remuneracao_has_role(array['admin','diretoria','recepcao'])
      ))
    or (tabela = 'pdi_controle_prazos'
      and (
        public.usuario_tem_permissao('terapeutico_pdi')
        or public.remuneracao_has_role(array['admin','diretoria'])
      ))
    or (tabela = 'previsao_receitas_faturamento'
      and (
        public.usuario_tem_permissao('indicadores_alimentar_bd')
        or public.remuneracao_has_role(array['admin','diretoria'])
      ))
  );
