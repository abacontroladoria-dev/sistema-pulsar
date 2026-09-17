-- Diagnóstico: por que 07/09 ("Unidade fechada") aparece como
-- "Retorno não confirmado" na Reconciliação.
--
-- Hipótese: o anti-join de get_auditoria_assim_periodo só reconhece
-- tipo_falta ~ '%PACIENTE%' ou '%TERAPEUTA%'. 'unidade_fechada' não casa em
-- nenhum dos dois, a linha escapa para a Conferência sem autorização, e o CASE
-- de `situacao` a classifica como RETORNO_NAO_CONFIRMADO.
--
-- (a) Como estão as linhas de 07/09 do Davi Lucas.
select id, paciente_id, data_atendimento, horario, tuss, terapia_nome,
       status, tipo_falta, motivo_falta, status_assim, data_atendimento_real
  from public.fila_autorizacoes
 where data_atendimento = date '2026-09-07'
   and paciente_id::text = '11579'
 order by horario;

-- (b) O dia inteiro, agrupado: quantas linhas de unidade_fechada existem e o
--     que elas têm em status_assim (se algum tiver 'FALTA', o anti-join já as
--     pega e a hipótese cai).
select tipo_falta,
       coalesce(status_assim, '(nulo)') as status_assim,
       count(*) as linhas
  from public.fila_autorizacoes
 where data_atendimento = date '2026-09-07'
 group by 1, 2
 order by 1, 2;

-- (c) O que a Conferência devolve hoje para esse dia.
select *
  from public.get_auditoria_assim(date '2026-09-07')
 where paciente_id::text = '11579'
 order by hora_inicial;

-- (d) O dia é feriado cadastrado?
select * from public.feriados where data = date '2026-09-07';
