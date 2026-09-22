-- Classificação de motivo -> tipo_falta/codigo_justificativa para
-- faltas_historico_csv. Espelha a taxonomia de fila_autorizacoes
-- (tipo_falta: 'paciente'|'terapeuta'|'unidade_fechada'; codigo_justificativa:
-- 101-113, ver 20260914160000_codigo_justificativa_falta.sql), só para
-- consistência e auditoria.
--
-- ATENÇÃO: esta classificação é só rótulo. A dedução de receita em
-- faltas_historico_csv é decidida exclusivamente por presenca_bool = false,
-- NUNCA por tipo_falta — é o mesmo comportamento hoje em produção
-- (fila_autorizacoes.status='falta' deduz sempre, sem filtrar por tipo,
-- conforme 20260908100200_falta_da_unidade_fora_da_assiduidade.sql linha
-- 34-36: "não toca em remuneração... no feriado o terapeuta não recebe pela
-- sessão, igual a uma falta comum").
--
-- Lista de motivos mapeada a partir dos 6 CSVs reais (Jan-Jun/2026,
-- relatorio_faltas_detalhado do Órbita). Motivo novo/desconhecido não
-- trava nada: cai no ELSE, fica tipo_falta='paciente' (é falta, é falta),
-- codigo_justificativa NULL, motivo_classificado=false — aparece no
-- relatório do import para quem quiser mapear depois.

create or replace function public.classificar_falta_historico_csv(
  p_motivo   text,
  p_presenca boolean
)
returns table(tipo_falta text, codigo_justificativa smallint, motivo_classificado boolean)
language sql
immutable
set search_path = public
as $$
  select
    case when p_presenca then null else
      case upper(btrim(coalesce(p_motivo, '')))
        when 'ATESTADO / INTERNAÇÃO / FALECIMENTO'                   then 'paciente'
        when 'AUSÊNCIA DE JUSTIFICATIVA'                             then 'paciente'
        when 'CONFLITO COM CRONOGRAMA'                               then 'paciente'
        when 'CONFLITO TERAPÊUTICO'                                  then 'paciente'
        when 'CONSULTAS / COMPROMISSOS'                              then 'paciente'
        when 'FALTA DO PROFISSIONAL'                                 then 'terapeuta'
        when 'FÉRIAS/VIAGEM'                                         then 'paciente'
        when 'LOGÍSTICA / DESLOCAMENTO / CLIMA'                      then 'paciente'
        when 'PENDÊNCIA ADMINISTRATIVA'                              then 'paciente'
        when 'SAÚDE DA CRIANÇA'                                      then 'paciente'
        when 'SAÚDE DO RESPONSÁVEL'                                  then 'paciente'
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL'     then 'paciente'
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO COORDENADOR'     then 'paciente'
        when 'FERIADO/RECESSO CLÍNICA'                               then 'unidade_fechada'
        when 'FERIADO/RECESSO CLINICA'                               then 'unidade_fechada'
        else 'paciente'
      end
    end,
    case when p_presenca then null else
      case upper(btrim(coalesce(p_motivo, '')))
        when 'ATESTADO / INTERNAÇÃO / FALECIMENTO'                   then 101::smallint
        when 'AUSÊNCIA DE JUSTIFICATIVA'                             then 102::smallint
        when 'CONFLITO COM CRONOGRAMA'                               then 103::smallint
        when 'CONFLITO TERAPÊUTICO'                                  then 104::smallint
        when 'CONSULTAS / COMPROMISSOS'                              then 105::smallint
        when 'FALTA DO PROFISSIONAL'                                 then 106::smallint
        when 'FÉRIAS/VIAGEM'                                         then 107::smallint
        when 'LOGÍSTICA / DESLOCAMENTO / CLIMA'                      then 108::smallint
        when 'PENDÊNCIA ADMINISTRATIVA'                              then 109::smallint
        when 'SAÚDE DA CRIANÇA'                                      then 110::smallint
        when 'SAÚDE DO RESPONSÁVEL'                                  then 111::smallint
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL'     then 112::smallint
        when 'FERIADO/RECESSO CLÍNICA'                               then 113::smallint
        when 'FERIADO/RECESSO CLINICA'                               then 113::smallint
        else null
      end
    end,
    p_presenca or upper(btrim(coalesce(p_motivo, ''))) in (
      'ATESTADO / INTERNAÇÃO / FALECIMENTO', 'AUSÊNCIA DE JUSTIFICATIVA',
      'CONFLITO COM CRONOGRAMA', 'CONFLITO TERAPÊUTICO', 'CONSULTAS / COMPROMISSOS',
      'FALTA DO PROFISSIONAL', 'FÉRIAS/VIAGEM', 'LOGÍSTICA / DESLOCAMENTO / CLIMA',
      'PENDÊNCIA ADMINISTRATIVA', 'SAÚDE DA CRIANÇA', 'SAÚDE DO RESPONSÁVEL',
      'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL',
      'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO COORDENADOR',
      'FERIADO/RECESSO CLÍNICA', 'FERIADO/RECESSO CLINICA'
    );
$$;

comment on function public.classificar_falta_historico_csv(text, boolean) is
  'Mapa motivo_raw (relatorio_faltas_detalhado do Órbita) -> tipo_falta/'
  'codigo_justificativa, só para auditoria/consistência com o vocabulário de '
  'fila_autorizacoes. NUNCA usar este resultado para decidir dedução de '
  'receita — isso é decidido só por presenca_bool. Motivo fora da lista '
  'conhecida cai em tipo_falta=''paciente'', codigo NULL, '
  'motivo_classificado=false (reportado no import, não bloqueia).';

-- ─── Normalização em lote, para o import do CSV histórico ───────────────────
--
-- O script importar-faltas-historico-csv.js precisa casar ~90 mil linhas do
-- CSV contra public.pacientes por nome. Chamar public.normalizar_nome_paciente
-- uma vez por linha via PostgREST seria uma requisição por linha; esta função
-- aceita a lista inteira de nomes distintos do CSV numa chamada só e devolve o
-- par (nome bruto, nome normalizado), reaproveitando a MESMA função de
-- normalização já materializada em pacientes.nome_normalizado — nunca reimplementar
-- essa lógica em JS (ver comentário de 20260817190000_pacientes_canonica.sql
-- sobre o bug Sant'Anna vs Santanna causado por duplicação divergente).
create or replace function public.normalizar_nomes_paciente_lote(p_nomes text[])
returns table(nome_raw text, nome_normalizado text)
language sql
immutable
set search_path = public
as $$
  select n, public.normalizar_nome_paciente(n)
  from unnest(p_nomes) as n;
$$;

comment on function public.normalizar_nomes_paciente_lote(text[]) is
  'Aplica public.normalizar_nome_paciente a uma lista de nomes em lote (para '
  'imports que precisam casar por nome sem ID direto, ex. '
  'importar-faltas-historico-csv.js). Nunca duplicar a lógica de normalização '
  'em JS — sempre passar pela função canônica via esta wrapper.';
