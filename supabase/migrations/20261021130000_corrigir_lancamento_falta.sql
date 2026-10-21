-- =============================================================================
-- Corrigir lançamento: sessão passada lançada como presença (ou com guia
-- capturada) passa a ser FALTA do paciente ou da profissional.
--
-- CASO (21/10/2026, pedido da coordenação da recepção):
--   Arthur de Paiva Ribeiro, 02/10 15:40 — guia capturada, mas a profissional
--     não atendeu: tem de ser falta da profissional.
--   Manuela Vitória Nascimento de Farias, 07/10 e 14/10 10:40 — lançadas como
--     presença; a paciente chegou atrasada e não foi atendida: falta do paciente.
--
-- POR QUE UMA RPC: nenhuma tela fazia essa troca. A /solicitar esconde a sessão
-- resolvida (`mostrar_na_tela = false` para 'concluido' e para sessão com guia)
-- e a /central-pacientes só oferecia "Reverter falta". O caminho era SQL à mão.
-- A RPC leva a correção para o painel da Central, com porteiro de papel e as
-- guardas que o SQL à mão dependia de alguém lembrar.
--
-- O QUE NÃO FAZ: não cancela a guia na ASSIM — nada no sistema faz isso. A guia
-- continua emitida e, com a linha em 'falta', vira órfã (get_guias_orfas já não
-- conta captura de linha 'falta' como pareada). Falta da profissional se triagem
-- na Reconciliação com vincular_autorizacao_falta; falta do paciente fecha como
-- 'sem_sessao'.
--
-- A VOLTA é o "Reverter falta" que já existe: a linha vai para 'cancelado' e
-- reaparece na /solicitar.
-- =============================================================================

set lock_timeout = '5s';

-- Quem corrigiu. Colunas nulas sem default: só catálogo, não varre a tabela.
ALTER TABLE public.fila_autorizacoes
  ADD COLUMN IF NOT EXISTS lancamento_corrigido_por_nome text,
  ADD COLUMN IF NOT EXISTS lancamento_corrigido_em       timestamptz;

reset lock_timeout;

COMMENT ON COLUMN public.fila_autorizacoes.lancamento_corrigido_por_nome IS
  'Quem trocou um lançamento já resolvido (presença/guia) por falta, via '
  'corrigir_lancamento_falta(). NULL = a falta foi lançada direto.';

CREATE OR REPLACE FUNCTION public.corrigir_lancamento_falta(
  p_fila_id       uuid,
  p_tipo_falta    text,
  p_justificativa text,
  p_codigo        integer default null
)
RETURNS TABLE (
  id                 uuid,
  status             text,
  tipo_falta         text,
  numero_autorizacao text,
  guia_ficou_orfa    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
declare
  v_role  text := public.fn_usuario_role();
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_f     record;
  v_guia  boolean;
  v_bloco text;
begin
  -- Mesmos papéis de vincular_autorizacao_falta: quem lança a falta na recepção
  -- é quem precisa corrigi-la.
  if v_role is null or v_role not in ('admin', 'autorizacao', 'recepcao') then
    raise exception 'Sem permissão para corrigir lançamentos' using errcode = '42501';
  end if;
  select u.nome into v_nome from public.usuarios u where u.id = v_uid;

  -- 'unidade_fechada' fica de fora: é falta de lote (feriado), não correção de
  -- uma sessão.
  if p_tipo_falta is null or p_tipo_falta not in ('paciente', 'terapeuta') then
    raise exception 'Tipo de falta inválido: % (esperado paciente ou terapeuta)',
      coalesce(p_tipo_falta, '(nulo)') using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'Justificativa obrigatória (mínimo 10 caracteres)' using errcode = '22023';
  end if;

  -- 106 é o próprio tipo terapeuta e 113 só o lote produz (mesma regra de
  -- CODIGOS_JUSTIFICATIVA_PACIENTE no front). Na falta da profissional o código
  -- é ignorado: o trigger fn_set_codigo_justificativa deriva 106.
  if p_tipo_falta = 'paciente' and p_codigo is not null
     and (p_codigo not between 101 and 113 or p_codigo in (106, 113)) then
    raise exception 'Código de justificativa inválido para falta do paciente: %', p_codigo
      using errcode = '22023';
  end if;

  select f.id, f.status, f.paciente_id, f.data_atendimento, f.horario, f.tuss,
         f.terapia_nome, f.numero_autorizacao, f.completion_type, f.avulsa
    into v_f
  from public.fila_autorizacoes f
  where f.id = p_fila_id
  for update;
  -- A Parte 2 da vw_central_pacientes (guia capturada no portal, sem linha na
  -- fila) chega aqui com id sintético (md5) e cai neste ramo.
  if not found then
    raise exception 'Esta sessão não tem lançamento no Pulsar (a guia veio direto do portal da ASSIM). Fale com o suporte.'
      using errcode = 'P0002';
  end if;

  if v_f.avulsa then
    raise exception 'Autorização avulsa não tem sessão para virar falta' using errcode = '22023';
  end if;

  -- Só lançamento resolvido. Falta já é falta (trocar o tipo = Reverter e lançar
  -- de novo); pendente/processando ainda está com o robô; cancelado/erro
  -- aparecem na /solicitar, que já tem o botão Falta.
  if v_f.status not in ('concluido', 'concluido_sem_guia') then
    raise exception 'Só sessão com presença ou guia pode ser corrigida para falta (status atual: %)',
      coalesce(v_f.status, '(nulo)') using errcode = '22023';
  end if;

  -- Sessão coberta por guia vinculada/substituição: a guia de outro lugar está
  -- afirmando que a sessão aconteceu. Mesma regra de reclassificar_situacao —
  -- desfaz o vínculo primeiro. bloco_id = pacienteId_AAAA-MM-DD_TUSS_HH:MM:SS.
  v_bloco := v_f.paciente_id::text || '_' || v_f.data_atendimento::text
          || '_' || coalesce(v_f.tuss, '') || '_' || v_f.horario::text;
  if exists (
    select 1 from public.autorizacoes_vinculos v
    where v.desfeito_em is null
      and v.tipo in ('vinculo', 'substituicao')
      and (v.bloco_id = v_bloco or v.fila_id = p_fila_id)
  ) then
    raise exception 'Esta sessão está coberta por uma guia vinculada. Desfaça o vínculo na Reconciliação antes de corrigir.'
      using errcode = '22023';
  end if;

  -- Guia real = número que não é o 'N/A' da presença fora da ASSIM.
  v_guia := v_f.numero_autorizacao is not null
            and upper(btrim(v_f.numero_autorizacao)) <> 'N/A';

  update public.fila_autorizacoes f
     set status               = 'falta',
         tipo_falta           = p_tipo_falta,
         terapia_falta        = coalesce(f.terapia_falta, f.terapia_nome),
         justificativa_falta  = btrim(p_justificativa),
         -- NULL deixa o trigger derivar (106 terapeuta, 102 paciente).
         codigo_justificativa = case when p_tipo_falta = 'paciente' then p_codigo end,
         -- Presença sem guia: tira os campos que diziam "aconteceu". Guia real
         -- fica — é o que faz ela aparecer como órfã para ser triada.
         completion_type      = case when v_guia then f.completion_type end,
         numero_autorizacao   = case when v_guia then f.numero_autorizacao end,
         completed_at         = case when v_guia then f.completed_at end,
         -- Uma reversão anterior diria "não é falta" a 6 leitores (20260916120000).
         falta_revertida_por_nome = null,
         falta_revertida_em       = null,
         lancamento_corrigido_por_nome = coalesce(v_nome, 'Usuário'),
         lancamento_corrigido_em       = now()
   where f.id = p_fila_id;

  return query
    select f.id, f.status, f.tipo_falta, f.numero_autorizacao, v_guia
    from public.fila_autorizacoes f
    where f.id = p_fila_id;
end;
$$;

REVOKE ALL ON FUNCTION public.corrigir_lancamento_falta(uuid, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_lancamento_falta(uuid, text, text, integer) TO authenticated;
