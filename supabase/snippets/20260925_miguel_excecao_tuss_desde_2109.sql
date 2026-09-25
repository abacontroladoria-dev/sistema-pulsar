-- Miguel Rodrigues De Queiroz (11692): a exceção de TUSS do Aplicador ABA (AE)
-- (terapia 2260 -> TO 22070427) passa a valer desde 21/09/2026, não 25/09.
--
-- Por quê: a sessão de SEG 21/09 13:40 (AE) foi autorizada como Psicologia
-- (22070384, guia 329568) e a ASSIM aceitou porque havia cota de Psicologia na
-- semana — cota que era da Coordenação de Caso de QUI 24/09 14:20, que então
-- glosou (1601). A recepção tirou uma avulsa de TO (422932) para a segunda,
-- liberando a guia de Psicologia para a quinta.
--
-- Com a exceção desde 21/09, a sessão de 13:40 vira TO no Pulsar, a segunda
-- fica com 2 sessões de Psicologia para 3 guias, e a última (334308) sobra como
-- órfã — é ela que se vincula à quinta. A 422932 se vincula à segunda 13:40.
--
-- Alcance: só 21/09 muda (as sessões de AE de 07/09 e 14/09 ficam antes da data).
-- Arteterapia (2314) não é tocada: o Miguel não tem sessão dela no período.

UPDATE public.tuss_excecao_paciente
   SET vigente_desde = DATE '2026-09-21'
 WHERE paciente_id = 11692
   AND terapia_id  = 2260
RETURNING id, paciente_id, terapia_id, codigo_tuss, vigente_desde;
