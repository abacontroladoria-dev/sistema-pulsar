-- Reverte a falta lançada por engano: Benjamim Vilazio Kmiciak (11543),
-- 09/09/2026, Coordenador de Caso 10:40. A sessão aconteceu (grade TiTa:
-- Realizado) e foi coberta pela avulsa 136336.
--
-- Mesmo UPDATE do botão "Reverter falta" (central-pacientes/page.tsx), que ainda
-- não aparece em produção para falta SEM tipo (esta tem tipo_falta NULL).
-- Depois de rodar: a sessão volta à Conferência e a guia 136336 se vincula a ela
-- pela Reconciliação (mesmo TUSS 22070384).

UPDATE public.fila_autorizacoes
   SET status                   = 'cancelado',
       status_assim             = NULL,
       tipo_falta               = NULL,
       terapia_falta            = NULL,
       justificativa_falta      = NULL,
       motivo_falta             = NULL,
       falta_lote_id            = NULL,
       falta_revertida_por_nome = 'Reconciliação (SQL 25/09)',
       falta_revertida_em       = now(),
       cancelado_por_nome       = 'Reconciliação (SQL 25/09)',
       cancelado_em             = now()
 WHERE id = '32315bb2-e665-46e5-839f-214cca2b2086'
   AND status = 'falta'
RETURNING id, paciente_nome, data_atendimento, horario, terapia_nome, status;
