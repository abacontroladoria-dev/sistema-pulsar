-- Isabella Maria Soares De Carvalho (11628): Arteterapia passa a ser solicitada
-- à ASSIM com o TUSS de Terapia Ocupacional (22070427), não com o de Psicologia
-- (22070384). Mesma regra do Samuel e do Miguel (20260925_tuss_excecao_paciente).
--
-- A Arteterapia dela está no TiTa como Aplicador ABA (AE), terapia_id 2260
-- (exibição "Arteterapia (Psicologia ABA)") — não no 2314. A exceção é por
-- terapia_id, e todas as 16 linhas 2260 dela são essa Arteterapia.
--
-- vigente_desde = 09/10/2026: a sessão de hoje 08:40 foi pedida como Psicologia
-- e glosou (guia 154822); com a exceção desde hoje ela volta a "não solicitada"
-- para ser pedida como TO. 25/09 e 02/10 (liberadas como 22070384) ficam antes.

INSERT INTO public.tuss_excecao_paciente (paciente_id, terapia_id, codigo_tuss, vigente_desde, motivo) VALUES
  (11628, 2260, '22070427', '2026-10-09', 'Isabella Maria Soares De Carvalho — Arteterapia (Aplicador ABA (AE)) autorizada como Terapia Ocupacional')
ON CONFLICT (paciente_id, terapia_id) DO NOTHING
RETURNING id, paciente_id, terapia_id, codigo_tuss, vigente_desde;
