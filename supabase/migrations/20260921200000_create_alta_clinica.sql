-- Alta Clínica (encerramento de TODAS as terapias): terceiro bloco da aba
-- "Altas e Individualidades" do cadastro de paciente, ao lado de Alta (por
-- especialidade) e Suspensão Temporária.
--
-- Diferente das outras duas, não é um evento 1:N por especialidade — é um
-- estado geral do paciente ("está com alta clínica hoje?"). Ainda assim
-- guardado como histórico (1:N), mesmo padrão de soft delete das demais: cada
-- confirmação vira uma linha nova, excluir marca ativo=false, nunca apaga.
-- "Vigente" para quem for consumir isso no futuro (cronograma/ocupação,
-- ainda não implementado) é a linha mais recente com ativo=true.
--
-- Sem anexo/arquivo nesta versão: ver 20260921200050, que acrescentou a
-- coluna depois desta migration já ter sido aplicada em produção — não editar
-- este arquivo de novo, senão o histórico local para de bater com o que
-- rodou lá (mesmo risco documentado em várias migrations deste projeto).

create table public.cadastros_pacientes_alta_clinica (
  id_alta_clinica       bigserial   primary key,
  id_paciente_pulsar    int8        not null references public.pacientes(id_paciente) on delete cascade,
  data_alta_clinica     date        not null,
  ativo                 boolean     not null default true,
  criado_por_usuario_id uuid        references public.usuarios(id),
  criado_por_usuario_nome text,
  criado_em             timestamptz not null default now()
);

create index cadastros_pacientes_alta_clinica_id_paciente_idx
  on public.cadastros_pacientes_alta_clinica (id_paciente_pulsar);

create index cadastros_pacientes_alta_clinica_ativas_idx
  on public.cadastros_pacientes_alta_clinica (id_paciente_pulsar)
  where ativo;

comment on table public.cadastros_pacientes_alta_clinica is
  'Alta clínica geral (encerra todas as terapias do paciente), distinta da alta por especialidade em cadastros_pacientes_altas. "Vigente" = linha mais recente com ativo=true.';
