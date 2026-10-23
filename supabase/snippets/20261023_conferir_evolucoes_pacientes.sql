-- Confere se cada sessão já realizada tem evolução (ou falta) registrada.
-- Somente leitura. Ajuste o período em "periodo" (padrão: mês corrente até ontem).
-- Fonte: grade_agendamentos × grade_evolucoes (espelho do TiTa + registros do Pulsar).

-- 1) Resumo por convênio (inclui Particular)
with periodo as (
  select date_trunc('month', current_date)::date de, (current_date - 1) ate
), s as (
  select a.id, a.paciente_id,
         coalesce(nullif(btrim(p.convenio_nome),''),'(sem convênio)') conv,
         e.agendamento_id is not null tem_reg,
         coalesce(e.possui_tratativa,false) evoluida,
         coalesce(e.status_execucao,'') = 'Cancelado' falta
  from public.grade_agendamentos a
  cross join periodo pe
  left join public.pacientes p on p.id_paciente = a.paciente_id
  left join public.grade_evolucoes e on e.agendamento_id = a.id
  where a.situacao='agendado' and a.data between pe.de and pe.ate
)
select conv, count(distinct paciente_id) pacientes, count(*) sessoes,
       count(*) filter (where evoluida) evoluidas,
       count(*) filter (where falta) faltas,
       count(*) filter (where not tem_reg) sem_registro,
       round(100.0*count(*) filter (where not tem_reg)/count(*),1) pct_sem
from s group by conv order by sessoes desc;

-- 2) Pacientes com sessão realizada no período e NENHUMA evolução (lista de cobrança)
with periodo as (
  select date_trunc('month', current_date)::date de, (current_date - 1) ate
)
select coalesce(p.nome, a.paciente_nome) paciente,
       coalesce(nullif(btrim(p.convenio_nome),''),'(sem convênio)') convenio,
       count(*) sessoes,
       count(*) filter (where e.possui_tratativa) evoluidas,
       count(*) filter (where e.agendamento_id is null) sem_registro,
       string_agg(distinct a.profissional_nome, ', ') profissionais
from public.grade_agendamentos a
cross join periodo pe
left join public.pacientes p on p.id_paciente = a.paciente_id
left join public.grade_evolucoes e on e.agendamento_id = a.id
where a.situacao='agendado' and a.data between pe.de and pe.ate
group by 1,2
having count(*) filter (where e.possui_tratativa) = 0
   and count(*) filter (where e.agendamento_id is null) > 0
order by sem_registro desc, paciente;
