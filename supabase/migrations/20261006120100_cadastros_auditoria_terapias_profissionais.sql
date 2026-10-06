-- Acrescenta as entidades `terapia` e `profissional` à trilha de cadastros
-- (telas /cadastros/terapias e /cadastros/profissionais). Mesmo motivo de
-- 20260923140300: sem o CHECK e a RLS conhecerem o valor novo, todo insert de
-- trilha dessas telas seria rejeitado pelo banco em silêncio.
--
-- `registro_id`: id (identity, como texto) de public.cadastro_terapias e de
-- public.profissionais.
--
-- Lista completa copiada de 20260923140300 (a mais recente a reescrever este
-- CHECK/policies), só acrescentando os dois valores novos.
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
    'convenio', 'plano_saude',
    'terapia', 'profissional'
  ));

-- ===== RLS =====
-- Só os ramos `terapia` e `profissional` são novos; os demais são idênticos a
-- 20260923140300, byte a byte. Sem o atalho por papel (remuneracao_has_role):
-- quem lê a trilha de profissional vê CPF/e-mail/celular no antes/depois, então
-- vale só a permissão da tela (admin/diretoria já passam por ela).

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
    or (tabela = 'terapia'
      and public.usuario_tem_permissao('cadastros_terapias'))
    or (tabela = 'profissional'
      and public.usuario_tem_permissao('cadastros_profissionais'))
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
    or (tabela = 'terapia'
      and public.usuario_tem_permissao('cadastros_terapias'))
    or (tabela = 'profissional'
      and public.usuario_tem_permissao('cadastros_profissionais'))
  );
