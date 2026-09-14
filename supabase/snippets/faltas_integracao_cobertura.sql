-- ============================================================
-- Saude do endpoint de faltas do parceiro                 [consulta]
--
-- POR QUE ISTO EXISTE
-- O endpoint entrega a falta chaveada por `tita_agendamento_id`. Quem
-- NAO tem esse campo fica invisivel para o parceiro — nao ha chave para
-- casar do lado dele.
--
-- O campo nao e escrito pela UI no fluxo individual: quem preenche e o
-- trigger `trg_set_tita_agendamento_id`, casando paciente/data/horario
-- contra `agenda_tita`. Sem match, fica NULL.
--
-- Medicao de 2026-09-14: 246 nulos em 8.282 faltas (3,0%), mas 89% deles
-- sao de abril/maio (anteriores ao backfill 20260701163444). De setembro:
-- 2 em 1.264 (0,2%). Por isso existe `data_corte` — o passivo antigo nao
-- entra. Se o numero RECENTE subir, o trigger parou de casar e o parceiro
-- esta perdendo falta em silencio.
-- ============================================================

-- 1. Panorama do que a view entrega
select count(*)                                    as linhas_na_view,
       count(*) filter (where ativa)               as ativas,
       count(*) filter (where not ativa)           as inativas_para_estorno,
       count(*) filter (where profissional_id is null) as sem_profissional,
       min(data_atendimento)                       as mais_antiga,
       max(data_atendimento)                       as mais_recente
  from public.vw_integracao_faltas;

-- 2. A chave e unica na view?
--    Se voltar QUALQUER linha, o parceiro sobrescreve registro errado.
--    (O LEFT JOIN com agenda_tita nao deve duplicar: o unique index
--     agenda_tita_unico_active garante 1 linha ativa por agendamento.)
select tita_agendamento_id, count(*) as vezes
  from public.vw_integracao_faltas
 group by 1
having count(*) > 1
 order by 2 desc;

-- 3. Faltas SEM chave por mes — as que nunca chegam ao parceiro
select date_trunc('month', data_atendimento)::date as mes,
       count(*)                                    as sem_chave
  from public.fila_autorizacoes
 where (status = 'falta' or tipo_falta is not null or falta_revertida_em is not null)
   and tita_agendamento_id is null
 group by 1
 order by 1 desc;

-- 4. Taxa de perda por mes (o numero que importa vigiar)
with base as (
  select date_trunc('month', data_atendimento)::date as mes,
         count(*)                                     as total,
         count(*) filter (where tita_agendamento_id is null) as sem_chave
    from public.fila_autorizacoes
   where status = 'falta' or tipo_falta is not null or falta_revertida_em is not null
   group by 1
)
select mes, total, sem_chave,
       round(100.0 * sem_chave / nullif(total, 0), 2) as pct_perdido
  from base
 order by mes desc;

-- 5. Simular uma data de corte antes de mudar o token
--    Troque a data e veja quantas linhas entram e quantas se perdem.
select count(*)                                            as entregues,
       count(*) filter (where tita_agendamento_id is null) as perdidas_sem_chave
  from public.fila_autorizacoes
 where (status = 'falta' or tipo_falta is not null or falta_revertida_em is not null)
   and data_atendimento >= date '2026-09-01';

-- 6. Distribuicao dos codigos de justificativa entregues
select codigo_justificativa,
       count(*) as linhas,
       count(*) filter (where ativa) as ativas
  from public.vw_integracao_faltas
 group by 1
 order by 2 desc;

-- 7. Amostra das que ficaram sem chave, para investigar o match do trigger
select id, paciente_id, data_atendimento, horario, terapia_falta, tipo_falta, created_at
  from public.fila_autorizacoes
 where (status = 'falta' or tipo_falta is not null or falta_revertida_em is not null)
   and tita_agendamento_id is null
 order by data_atendimento desc
 limit 30;
