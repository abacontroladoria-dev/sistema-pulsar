-- Auditorias gravadas antes de 06/10 ficaram com o profissional AGENDADO.
-- Na substituição, a evolução é de quem executou (tratativa_profissional_id).
-- Rodar no SQL Editor. Idempotente.

UPDATE public.auditoria_evolucoes a
SET profissional_id   = g.tratativa_profissional_id,
    profissional_nome = COALESCE(g.tratativa_profissional_nome, a.profissional_nome),
    updated_at        = now()
FROM public.csv_grades_profissionais g
WHERE g.id = a.grade_id
  AND g.tratativa_profissional_id IS NOT NULL
  AND a.profissional_id IS DISTINCT FROM g.tratativa_profissional_id;
