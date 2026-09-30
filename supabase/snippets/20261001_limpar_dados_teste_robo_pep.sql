-- Limpeza depois da demonstração do robô SharePoint → PEP (etapa 5 do plano).
--
-- Apaga o que a pasta de TESTE do SharePoint gerou nas tabelas sp_pep_* e as
-- entregas PEP registradas para o par de teste. Não toca em nada de prestador
-- ou paciente real: tudo é filtrado pelos nomes de teste abaixo.
--
-- Rode SÓ depois de:
--   1. o Bernardo apagar a pasta "Prestador de Serviço - Teste Robô PEP (…)"
--      no SharePoint;
--   2. conferir a PRÉVIA abaixo (primeiro SELECT) — ela tem que listar só
--      coisas de teste.

-- ---------------------------------------------------------------------------
-- PRÉVIA — o que seria apagado.
-- ---------------------------------------------------------------------------
select 'sp_pep_itens' as tabela, count(*) from public.sp_pep_itens
 where prestador_nome ilike 'Profissional Teste Robô PEP%' or paciente_nome ilike 'Paciente Teste Robô PEP%'
    or caminho ilike 'Prestador de Serviço - Teste Robô PEP%'
union all
select 'sp_pep_pastas', count(*) from public.sp_pep_pastas
 where id = (select id from public.sp_pep_pastas where nome ilike 'Prestador de Serviço - Teste Robô PEP%' limit 1)
    or prestador_pasta_id = (select id from public.sp_pep_pastas where nome ilike 'Prestador de Serviço - Teste Robô PEP%' limit 1)
union all
select 'pep_registros_entrega', count(*) from public.pep_registros_entrega
 where prestador_nome ilike 'Profissional Teste Robô PEP%' or paciente_nome ilike 'Paciente Teste Robô PEP%'
union all
select 'pep_planejamento_semestral', count(*) from public.pep_planejamento_semestral
 where prestador_nome ilike 'Profissional Teste Robô PEP%' or paciente_nome ilike 'Paciente Teste Robô PEP%';

-- ---------------------------------------------------------------------------
-- APAGAR — trave aberta só depois de conferir a prévia.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  conferi_a_previa boolean := false;
  v_pasta text;
BEGIN
  IF NOT conferi_a_previa THEN
    RAISE EXCEPTION 'Pare: confira a PRÉVIA acima e troque false por true. Nada foi alterado.';
  END IF;

  SELECT id INTO v_pasta FROM public.sp_pep_pastas
   WHERE nome ILIKE 'Prestador de Serviço - Teste Robô PEP%' LIMIT 1;

  DELETE FROM public.sp_pep_itens
   WHERE prestador_nome ILIKE 'Profissional Teste Robô PEP%' OR paciente_nome ILIKE 'Paciente Teste Robô PEP%'
      OR (v_pasta IS NOT NULL AND prestador_pasta_id = v_pasta);
  DELETE FROM public.sp_pep_vinculos
   WHERE pasta_id IN (SELECT id FROM public.sp_pep_pastas WHERE id = v_pasta OR prestador_pasta_id = v_pasta);
  DELETE FROM public.sp_pep_pacientes WHERE prestador_pasta_id = v_pasta;
  DELETE FROM public.sp_pep_prestadores WHERE pasta_id = v_pasta;
  DELETE FROM public.sp_pep_pastas WHERE id = v_pasta OR prestador_pasta_id = v_pasta;

  DELETE FROM public.pep_registros_entrega
   WHERE prestador_nome ILIKE 'Profissional Teste Robô PEP%' OR paciente_nome ILIKE 'Paciente Teste Robô PEP%';
  DELETE FROM public.pep_planejamento_semestral
   WHERE prestador_nome ILIKE 'Profissional Teste Robô PEP%' OR paciente_nome ILIKE 'Paciente Teste Robô PEP%';
  DELETE FROM public.pep_apuracao_mensal
   WHERE prestador_nome ILIKE 'Profissional Teste Robô PEP%' OR paciente_nome ILIKE 'Paciente Teste Robô PEP%';
END $$;
