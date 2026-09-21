-- A tabela cadastros_pacientes_alta_clinica já foi aplicada em produção antes
-- do anexo ser desenhado (20260921200000 foi editada depois, localmente, mas
-- a versão sem a coluna já estava rodada lá). Esta migration só adiciona o
-- que faltou, sem mexer no que já existe — idempotente (IF NOT EXISTS).

alter table public.cadastros_pacientes_alta_clinica
  add column if not exists arquivo_alta_clinica_path text;

comment on column public.cadastros_pacientes_alta_clinica.arquivo_alta_clinica_path is
  'Caminho do anexo no bucket `laudos-pacientes` do Storage, sob o prefixo altas-clinicas/. Acesso só por URL assinada de 15 min. NULL = sem anexo (opcional).';
