-- Atributos da terapia para o faturamento (Fase 0 de
-- docs/PLANO_INTEGRACAO_FATURAMENTO.md, 23/10/2026).
--
-- 1. modalidade: Clínica, AT Externo ou Terceirizada. Dimensão separada da
--    unidade: só Clínica tem unidade e entra no rateio por unidade. Vem da
--    TERAPIA antes da sala — medido em set/2026: 104 sessões de "Aplicador ABA
--    Escola" estavam em sala da clínica e são AT Externo.
--
-- 2. exige_presenca_fila: a presença da sessão vem da fila_autorizacoes
--    (/solicitar). false = a terapia não passa pela fila (fora do ROL da ANS ou
--    fora do ciclo de autorização), e a conferência presença × evolução não pode
--    acusar "evolução sem presença" nela. Até aqui essa informação não estava em
--    lugar nenhum: a BLACKLIST_AUTORIZACAO (config_regras_terapias) tem 12 nomes
--    e não inclui Fisioterapia Aquática, Avaliação Neuropsicológica, Coordenador
--    de Caso, Equoterapia e Psiquiatra/Neurologista. A blacklist continua
--    valendo para o que já a lê; esta coluna é a fonte do faturamento.
--
-- Valores iniciais por nome normalizado (sem acento/caixa). A lista definitiva
-- das terapias fora do ROL é pendência da operação; o resto se ajusta na tela
-- /cadastros/terapias. Terceirizada não tem nenhuma terapia conhecida ainda.
--
-- Idempotente: o preenchimento inicial só roda na primeira aplicação (quando a
-- coluna nasce), para não desfazer o que for editado na tela depois.

set lock_timeout = '5s';

do $m$
declare
  v_nova boolean := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cadastro_terapias' and column_name = 'exige_presenca_fila'
  );
begin
  alter table public.cadastro_terapias
    add column if not exists modalidade text not null default 'clinica',
    add column if not exists exige_presenca_fila boolean not null default true;

  if v_nova then
    update public.cadastro_terapias
       set modalidade = 'at_externo'
     where nome_normalizado in ('aplicador aba escola', 'aplicador aba casa');

    update public.cadastro_terapias
       set exige_presenca_fila = false
     where nome_normalizado in (
       -- BLACKLIST_AUTORIZACAO (config_regras_terapias)
       'aplicador aba escola', 'aplicador aba casa', 'aplicador suporte', 'supervisao aba',
       'alinhamento', 'apoio operacional', 'especialista tecnico de area', 'estagio',
       'facilitador tecnico', 'operacoes clinicas', 'tecnico terapeutico particular', 'triagem',
       -- Fora do ROL, sem /solicitar (medição de set/2026)
       'fisioterapia aquatica', 'avaliacao neuropsicologica', 'coordenador de caso',
       'equoterapia', 'psiquiatra/neurologista'
     );
  end if;
end
$m$;

alter table public.cadastro_terapias drop constraint if exists cadastro_terapias_modalidade_check;
alter table public.cadastro_terapias
  add constraint cadastro_terapias_modalidade_check check (modalidade in ('clinica', 'at_externo', 'terceirizada'));

comment on column public.cadastro_terapias.modalidade is
  'clinica | at_externo | terceirizada. Só clinica tem unidade e entra no rateio por unidade. Prevalece sobre a sala.';
comment on column public.cadastro_terapias.exige_presenca_fila is
  'true = a presença vem da fila_autorizacoes (/solicitar). false = fora do ROL ou fora do ciclo de autorização: sem fila por desenho.';
