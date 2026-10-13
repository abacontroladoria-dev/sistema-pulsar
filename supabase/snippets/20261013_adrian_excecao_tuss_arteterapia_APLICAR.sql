-- Adrian Araújo Nery (11511): Arteterapia passa a ser solicitada à ASSIM com o
-- TUSS de Terapia Ocupacional (22070427), não com o de Psicologia (22070384).
-- Mesma regra do Samuel, do Miguel e da Isabella (20261009_isabella_...).
--
-- A Arteterapia dele está no TiTa como Aplicador ABA (AE), terapia_id 2260
-- (exibição "Arteterapia (Psicologia ABA)"); não há linha 2314. Todas as 14
-- linhas 2260 dele (01/09 a 24/11) são essa Arteterapia.
--
-- vigente_desde = 14/10/2026: as sessões de 01/09 a 06/10 foram liberadas como
-- 22070384 sem glosa, e a de 13/10 11:20 está como falta (tuss 22070384). Tudo
-- isso fica antes da data; a primeira pedida como TO é a de 20/10.

INSERT INTO public.tuss_excecao_paciente (paciente_id, terapia_id, codigo_tuss, vigente_desde, motivo) VALUES
  (11511, 2260, '22070427', '2026-10-14', 'Adrian Araújo Nery — Arteterapia (Aplicador ABA (AE)) autorizada como Terapia Ocupacional')
ON CONFLICT (paciente_id, terapia_id) DO NOTHING
RETURNING id, paciente_id, terapia_id, codigo_tuss, vigente_desde;
