-- =============================================================================
-- Diagnóstico ANTES de aplicar 20260911120000 (biofacial na auditoria diária)
-- =============================================================================
-- Só LÊ. Nenhuma destas consultas escreve nada.
--
-- Rodar bloco a bloco e guardar as saídas: as de nº 4 e 5 são o BASELINE com que
-- a verificação pós-aplicação compara.

-- ---------------------------------------------------------------------------
-- 1. proconfig das duas funções — o que precisa ser replicado no novo corpo
-- ---------------------------------------------------------------------------
-- ESPERADO: proconfig NULO nas duas (só get_tokens_mensal tem '30s'). Se vier
-- algo aqui, a migration PRECISA repetir esse SET dentro do CREATE OR REPLACE —
-- senão morre calado (reference_create_or_replace_perde_proconfig).
select proname, proconfig
from pg_proc
where proname in ('get_auditoria_assim', 'get_auditoria_assim_periodo', 'get_tokens_mensal')
order by proname;

-- ---------------------------------------------------------------------------
-- 2. Quantas sessões GANHAM o pill por dia (últimos 30 dias)
-- ---------------------------------------------------------------------------
-- São as `8-` SEM token: as com token já exibem o pill hoje pelo ramo
-- `teve_token`. Medido em 21/08/2026: 97 dos 106 casos de `8-` tinham token,
-- então o esperado aqui são UNIDADES por dia.
--
-- SE ALGUM DIA VIER COM DEZENAS: levar o número à operação ANTES do deploy. Um
-- pill que aparece sem aviso em cima de sessões antigas parece perda de dado.
-- Nenhuma linha PERDE o pill — a mudança é estritamente aditiva.
select date(aa.data_execucao) as dia, count(*) as ganham_pill
from public.autorizacoes_assim aa
where split_part(btrim(coalesce(aa.biofacial, '')), '-', 1) = '8'
  and coalesce(aa.teve_token, false) = false
  and date(aa.data_execucao) >= current_date - 30
group by 1
order by 1;

-- ---------------------------------------------------------------------------
-- 3. O caso que originou tudo — ADRIAN ARAUJO NERY, 01/09/2026 10:00
-- ---------------------------------------------------------------------------
-- ESPERADO: biofacial '8-DISPOSITIVO INDISPONIVEL', token VAZIO/nulo,
-- teve_token false, status 'Liberado'. É o que o extrato da ASSIM mostra.
-- Lembrar que o número da guia RECICLA (reference_guia_assim_nao_e_unica), por
-- isso a data entra no filtro.
select guia, status, teve_token, token, biofacial, data_execucao
from public.autorizacoes_assim
where guia = '5665'
  and date(data_execucao) = '2026-09-01';

-- ---------------------------------------------------------------------------
-- 4. BASELINE do rótulo — guardar a saída
-- ---------------------------------------------------------------------------
-- Depois de aplicar, o 'Token' indevido migra para 'Dispositivo indisponível'.
-- Nenhuma categoria pode virar NULL em massa; se virar, é o risco R6 (ver
-- bloco 5).
select forma_autorizacao, count(*)
from public.get_auditoria_assim('2026-09-01')
group by 1
order by 2 desc;

-- ---------------------------------------------------------------------------
-- 4b. BASELINE de contagem total — a migration não pode ganhar nem perder linha
-- ---------------------------------------------------------------------------
select count(*) as total_linhas_do_dia
from public.get_auditoria_assim('2026-09-01');

-- ---------------------------------------------------------------------------
-- 5. R6 — `forma_validacao_do_biofacial` devolve NULL mesmo?
-- ---------------------------------------------------------------------------
-- ARMADILHA SILENCIOSA: o terceiro degrau do COALESCE novo (`fo.forma_autorizacao`)
-- só é alcançável se esta função devolver NULL — e não uma string tipo '—' —
-- para biofacial nulo ou código desconhecido. Se devolver string, o degrau fica
-- inalcançável e RETORNO_NAO_CONFIRMADO perde a única evidência que possui.
--
-- ESPERADO: as quatro primeiras colunas NULAS; depois 'Dispositivo indisponível',
-- 'Token', 'Biometria'.
select
  public.forma_validacao_do_biofacial(null,  false) as nulo,
  public.forma_validacao_do_biofacial('',    false) as vazio,
  public.forma_validacao_do_biofacial('4-X', false) as codigo_4,
  public.forma_validacao_do_biofacial('99-NOVO', false) as codigo_novo,
  public.forma_validacao_do_biofacial('8-DISPOSITIVO INDISPONIVEL', false) as oito_sem_token,
  public.forma_validacao_do_biofacial('8-DISPOSITIVO INDISPONIVEL', true)  as oito_com_token,
  public.forma_validacao_do_biofacial('9-BIOMETRIA', false) as nove;

-- ---------------------------------------------------------------------------
-- 6. Quem mais consome o contrato das duas RPCs
-- ---------------------------------------------------------------------------
-- Procurando por OUTRO `SELECT *` sobre elas. O wrapper get_auditoria_assim já
-- é conhecido e a migration o recria junto; se aparecer mais alguém aqui, ele
-- também quebra com "structure of query does not match function result type".
select proname
from pg_proc
where prosrc ilike '%get_auditoria_assim%'
  and proname not in ('get_auditoria_assim', 'get_auditoria_assim_periodo');

select viewname
from pg_views
where definition ilike '%get_auditoria_assim%';

-- ---------------------------------------------------------------------------
-- 7. R7 — quantas linhas TROCAM de legenda com a nova precedência
-- ---------------------------------------------------------------------------
-- Onde a recepção clicou uma coisa e a ASSIM respondeu outra, o rótulo passa a
-- dizer a resposta. É o objetivo da correção, mas convém saber o tamanho.
-- Nominalmente, para poder conferir caso a caso.
select
  b.paciente_nome,
  b.data_atendimento,
  b.hora_inicial,
  b.guia,
  b.forma_autorizacao                                   as rotulo_hoje_intencao,
  public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
                                                        as rotulo_novo_resposta,
  aa.biofacial,
  aa.teve_token
from public.get_auditoria_assim('2026-09-01') b
join public.autorizacoes_assim aa
  on aa.guia = b.guia
 and date(aa.data_execucao) = b.data_atendimento
where public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token) is not null
  and public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
      is distinct from b.forma_autorizacao
order by b.hora_inicial;
